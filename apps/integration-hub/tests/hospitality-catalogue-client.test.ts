import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import test from "node:test";
import { loadHospitalityCatalogue, validCachedRecord, type CachedCatalogue, type CatalogueCacheStore, type CatalogueLoadDeps, type CatalogueManifest } from "../lib/hospitality-catalogue-client";
import { CATALOGUE_PACKAGE_CONTRACT, CATALOGUE_PACKAGE_SCHEMA_VERSION, type CataloguePackage } from "../lib/hospitality-effective-offering";
import { CATALOGUE_CLIENT_SCHEMA_VERSION } from "@fika/server-shared/hospitality-catalogue-client";

const catalogue = (marker: string): CataloguePackage => ({ schemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION, contract: CATALOGUE_PACKAGE_CONTRACT, items: [{ id: marker, name: marker, category: "Food", defaultPrices: [], dietaryInformation: [], allergenInformation: [] }], exceptions: [], oplocs: [{ id: "oploc:a", label: "A" }] });
const sizes = new Map<string, number>();
const encode = (value: CataloguePackage) => { const bytes = gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }); const hash = createHash("sha256").update(bytes).digest("hex"); sizes.set(hash, bytes.length); return { bytes: new Uint8Array(bytes), hash }; };
const manifestFor = (hash: string, schemaVersion = CATALOGUE_PACKAGE_SCHEMA_VERSION): CatalogueManifest => ({ dataset: "integration-hub/hospitality-catalogue", packageVersion: 1, schemaVersion, contractVersion: CATALOGUE_PACKAGE_CONTRACT, objectName: `integration-hub/hospitality-catalogue/v1-${hash}.json.gz`, compression: "gzip", contentHash: hash, compressedSize: sizes.get(hash) || 1, uncompressedSize: 2, recordCount: 1, generatedAt: "2026-10-17T00:00:00.000Z" });

function harness(options: { cached?: unknown; manifest?: CatalogueManifest | Error; packages?: Record<string, Uint8Array>; readThrows?: boolean; writeThrows?: boolean } = {}) {
  const counters = { manifest: 0, download: 0, writes: 0, clears: 0 };
  let record: unknown = options.cached;
  const store: CatalogueCacheStore = {
    async read() { if (options.readThrows) throw new Error("IDB broken"); return record; },
    async write(value: CachedCatalogue) { if (options.writeThrows) throw new Error("quota"); counters.writes++; record = value; },
    async clear() { counters.clears++; record = undefined; },
  };
  const deps: CatalogueLoadDeps = {
    store,
    async fetchManifest() { counters.manifest++; if (options.manifest instanceof Error) throw options.manifest; return options.manifest!; },
    async fetchPackageBytes(hash) { counters.download++; const bytes = options.packages?.[hash]; if (!bytes) throw new Error("not found"); return bytes; },
    async sha256Hex(bytes) { return createHash("sha256").update(bytes).digest("hex"); },
    async gunzipText(bytes) { return gunzipSync(bytes).toString("utf8"); },
  };
  return { deps, counters, current: () => record };
}
const cachedRecord = (value: CataloguePackage, hash: string): CachedCatalogue => ({ id: "current", clientSchemaVersion: CATALOGUE_CLIENT_SCHEMA_VERSION, packageSchemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION, contentHash: hash, payloadHash: createHash("sha256").update(JSON.stringify(value)).digest("hex"), packageVersion: 1, generatedAt: "2026-10-16T00:00:00.000Z", catalogue: value });

test("first load downloads once, verifies the hash, caches it; the next startup is a cache hit with NO package download", async () => {
  const pkg = catalogue("v1"); const { bytes, hash } = encode(pkg);
  const h = harness({ manifest: manifestFor(hash), packages: { [hash]: bytes } });
  const first = await loadHospitalityCatalogue(h.deps);
  assert.equal(first.source, "network"); assert.equal(first.downloaded, true); assert.deepEqual(first.catalogue, pkg); assert.equal(h.counters.download, 1); assert.equal(h.counters.writes, 1);
  const second = await loadHospitalityCatalogue(h.deps);
  assert.equal(second.source, "cache"); assert.equal(second.downloaded, false); assert.equal(h.counters.download, 1, "cache hit: the package is not downloaded again"); assert.equal(h.counters.manifest, 2, "only the tiny manifest is checked");
});

test("a changed content hash downloads and replaces the package", async () => {
  const oldPkg = catalogue("old"), newPkg = catalogue("new"); const old = encode(oldPkg), fresh = encode(newPkg);
  const h = harness({ cached: cachedRecord(oldPkg, old.hash), manifest: manifestFor(fresh.hash), packages: { [fresh.hash]: fresh.bytes } });
  const result = await loadHospitalityCatalogue(h.deps);
  assert.equal(result.source, "network"); assert.equal(result.catalogue.items[0].id, "new"); assert.equal((h.current() as CachedCatalogue).contentHash, fresh.hash, "the old package is replaced, not accumulated");
});

test("an incompatible schema version in the cache is ignored and replaced; new code never hydrates the old structure", async () => {
  const pkg = catalogue("v1"); const { bytes, hash } = encode(pkg);
  const stale = { ...cachedRecord(pkg, hash), clientSchemaVersion: 0, catalogue: { ...pkg, schemaVersion: 0 } };
  const h = harness({ cached: stale, manifest: manifestFor(hash), packages: { [hash]: bytes } });
  const result = await loadHospitalityCatalogue(h.deps);
  assert.equal(result.source, "network", "same hash but incompatible cache: redownload"); assert.ok(result.notes.some(note => /incompatible/.test(note))); assert.equal(h.counters.clears >= 1, true);
  assert.equal(validCachedRecord(h.current()), true);
  assert.equal(validCachedRecord(stale), false);
});

test("a corrupted or missing cache falls back safely to a fresh download", async () => {
  const pkg = catalogue("v1"); const { bytes, hash } = encode(pkg);
  for (const cached of [{ id: "current", junk: true }, "garbage", { ...cachedRecord(pkg, hash), catalogue: { items: "nope" } }, { ...cachedRecord(pkg, "not-a-hash") }, null, undefined]) {
    const h = harness({ cached, manifest: manifestFor(hash), packages: { [hash]: bytes } });
    const result = await loadHospitalityCatalogue(h.deps); assert.equal(result.source, "network"); assert.deepEqual(result.catalogue, pkg);
  }
  const broken = harness({ readThrows: true, manifest: manifestFor(hash), packages: { [hash]: bytes } });
  const recovered = await loadHospitalityCatalogue(broken.deps); assert.equal(recovered.source, "network"); assert.ok(recovered.notes.some(note => /could not be read/.test(note)));
});

test("an unreachable manifest never passes a cached catalogue off as current; with no cache it fails", async () => {
  const pkg = catalogue("v1"); const { hash } = encode(pkg);
  const withCache = harness({ cached: cachedRecord(pkg, hash), manifest: new Error("offline") });
  const result = await loadHospitalityCatalogue(withCache.deps);
  assert.equal(result.source, "cache-unverified"); assert.ok(result.notes.some(note => /out of date/.test(note)));
  await assert.rejects(loadHospitalityCatalogue(harness({ manifest: new Error("offline") }).deps), /offline/);
});

test("a changed manifest whose package is unreachable uses a valid cache only as explicitly unverified", async () => {
  const cached = catalogue("previous"), fresh = catalogue("next"), old = encode(cached), next = encode(fresh);
  const h = harness({ cached: cachedRecord(cached, old.hash), manifest: manifestFor(next.hash) });
  const result = await loadHospitalityCatalogue(h.deps);
  assert.equal(result.source, "cache-unverified"); assert.equal(result.contentHash, old.hash); assert.equal(result.downloaded, false);
  assert.ok(result.notes.some(note => /could not be downloaded/.test(note)));
});

test("cache payload changes without its checksum are discarded", async () => {
  const original = catalogue("original"), changed = catalogue("tampered"), pkg = encode(original);
  const h = harness({ cached: { ...cachedRecord(original, pkg.hash), catalogue: changed }, manifest: manifestFor(pkg.hash), packages: { [pkg.hash]: pkg.bytes } });
  const result = await loadHospitalityCatalogue(h.deps);
  assert.equal(result.source, "network"); assert.equal(result.catalogue.items[0].id, "original");
});

test("integrity and schema failures are refused, and a failed cache write is not fatal", async () => {
  const pkg = catalogue("v1"); const { bytes, hash } = encode(pkg);
  const tampered = new Uint8Array(bytes); tampered[10] ^= 0xff;
  await assert.rejects(loadHospitalityCatalogue(harness({ manifest: manifestFor(hash), packages: { [hash]: tampered } }).deps), (error: Error & { code?: string }) => error.code === "CATALOGUE_INTEGRITY_FAILURE");
  await assert.rejects(loadHospitalityCatalogue(harness({ manifest: manifestFor(hash, 99) }).deps), (error: Error & { code?: string }) => error.code === "CATALOGUE_SCHEMA_MISMATCH");
  const noQuota = await loadHospitalityCatalogue(harness({ manifest: manifestFor(hash), packages: { [hash]: bytes }, writeThrows: true }).deps);
  assert.equal(noQuota.source, "network"); assert.ok(noQuota.notes.some(note => /could not be saved/.test(note)));
});

test("normal startup performs no Firestore access at all (the loader has no Firestore dependency)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(`${process.cwd()}/../../packages/server-shared/src/hospitality-catalogue-client.ts`, "utf8");
  assert.doesNotMatch(source, /from "[^"]*(firebase|firestore|firebase-admin)[^"]*"/i); assert.doesNotMatch(source, /integrationHubCanonical|collection\(/);
  assert.match(source, /CATALOGUE_CLIENT_CACHE_DB = `fika-hospitality-booking-catalogue-v/, "client schema uses an app-owned versioned IndexedDB name");
  assert.match(source, /payloadHash/);
});

test("new clients accept original v1 during coordinated rollout and cache its actual schema", async () => {
  const pkg = { ...catalogue("legacy"), schemaVersion: 1, contract: "fika.hospitality-catalogue-package.v1" }; const { bytes, hash } = encode(pkg);
  const h = harness({ manifest: { ...manifestFor(hash, 1), contractVersion: pkg.contract }, packages: { [hash]: bytes } });
  assert.equal((await loadHospitalityCatalogue(h.deps)).catalogue.schemaVersion, 1);
  assert.equal(validCachedRecord(h.current()), true); assert.equal((await loadHospitalityCatalogue(h.deps)).source, "cache");
});
test("scope restrictions cannot be hidden in v1 and manifest/payload contracts must agree", async () => {
  const pkg = { ...catalogue("scope"), schemaVersion: 1, contract: "fika.hospitality-catalogue-package.v1" }; pkg.items[0].allowedOplocIds = ["oploc:a"];
  const data = encode(pkg); const h = harness({ manifest: { ...manifestFor(data.hash, 1), contractVersion: pkg.contract }, packages: { [data.hash]: data.bytes } });
  await assert.rejects(loadHospitalityCatalogue(h.deps), /unexpected structure/);
  const current = encode(catalogue("new")); const bad = harness({ manifest: { ...manifestFor(current.hash, 1), contractVersion: pkg.contract }, packages: { [current.hash]: current.bytes } });
  await assert.rejects(loadHospitalityCatalogue(bad.deps), /unexpected structure/);
});
