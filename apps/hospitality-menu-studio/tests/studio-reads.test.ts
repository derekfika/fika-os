import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import type { CachedCatalogue, CatalogueLoadDeps, CatalogueManifest } from "@fika/server-shared/hospitality-catalogue-client";
import { CATALOGUE_PACKAGE_CONTRACT, CATALOGUE_PACKAGE_SCHEMA_VERSION, type CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import { StudioReads } from "../components/studio-reads";
import { StudioReadResource } from "../components/studio-read-resource";
import { indexAdminCatalogue } from "../components/studio-catalogue-index";

const scope = "test-scope";
const packagePath = "/api/catalogue/public-package";
const summaryPath = "/api/studio/product-menus";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function packageFor(name: string) {
  const catalogue: CataloguePackage = {
    schemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION, contract: CATALOGUE_PACKAGE_CONTRACT,
    items: [{ id: "fixture-product", name, category: "Lunch", defaultPrices: [], dietaryInformation: [], allergenInformation: [] }],
    exceptions: [], oplocs: [{ id: "fixture-site", label: "Fixture site" }],
  };
  const plain = Buffer.from(JSON.stringify(catalogue));
  const bytes = gzipSync(plain);
  const contentHash = hash(bytes);
  const manifest: CatalogueManifest = {
    dataset: "hospitality-booking/catalogue", packageVersion: 1, schemaVersion: catalogue.schemaVersion, contractVersion: catalogue.contract,
    objectName: "hospitality-booking/catalogue/" + contentHash + ".json.gz", compression: "gzip", contentHash,
    compressedSize: bytes.length, uncompressedSize: plain.length, recordCount: 1, generatedAt: "2026-11-26T09:00:00Z",
  };
  return { bytes, manifest };
}

function publicHarness() {
  let cache: CachedCatalogue | undefined;
  let current = packageFor("First lunch");
  let status = 200;
  let corruptDownload = false;
  const calls: string[] = [];
  const dependencies = (): CatalogueLoadDeps => ({
    store: { read: async () => cache, clear: async () => { cache = undefined; }, write: async value => { cache = value; } },
    fetchManifest: async () => { throw new Error("Use the scoped manifest request"); },
    fetchPackageBytes: async () => { throw new Error("Use the scoped package request"); },
    sha256Hex: async bytes => hash(bytes),
    gunzipText: async bytes => gunzipSync(bytes).toString(),
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("x-fika-studio-scope"), scope);
    const url = String(input);
    calls.push(url);
    if (status !== 200) return new Response(null, { status });
    if (url === `${summaryPath}?includeCatalogueManifest=1`) return Response.json({ items: [], nextCursor: null, catalogueManifest: current.manifest });
    if (url === packagePath) return Response.json(current.manifest);
    if (url === packagePath + "/" + current.manifest.contentHash) {
      const bytes = new Uint8Array(current.bytes);
      if (corruptDownload) bytes[0] ^= 0xff;
      return new Response(bytes);
    }
    throw new Error("Unexpected request: " + url);
  };
  return {
    calls, session: () => new StudioReads(scope, fetch, dependencies),
    change(name: string) { current = packageFor(name); },
    setStatus(value: number) { status = value; },
    corruptCache() { cache!.catalogue.items[0].name = "Damaged local value"; },
    corruptDownload() { corruptDownload = true; },
    mismatchSchema() { current.manifest.schemaVersion = 99; },
  };
}

test("cold Builder combines the summary page and manifest, then concurrent and warm navigation reuse both", async () => {
  const fixture = publicHarness();
  const reads = fixture.session();
  await Promise.all([reads.loadBuilder(), reads.loadBuilder()]);
  assert.deepEqual(fixture.calls.map(call => call.startsWith(packagePath + "/") ? "gzip" : call),
    [summaryPath + "?includeCatalogueManifest=1", "gzip"]);
  const original = reads.catalogue.snapshot().value;
  await reads.loadBuilder();
  assert.equal(fixture.calls.length, 2);
  assert.equal(reads.catalogue.snapshot().value, original);

  const warm = fixture.session();
  const [catalogue] = await warm.loadBuilder();
  assert.equal(catalogue.productsById.get("fixture-product")?.name, "First lunch");
  assert.deepEqual(fixture.calls.slice(2), [summaryPath + "?includeCatalogueManifest=1"]);
});

test("a changed manifest refreshes the package; failed refresh and invalid package never display cached data as current", async () => {
  const fixture = publicHarness();
  const reads = fixture.session();
  await reads.loadPublic();
  fixture.change("Second lunch");
  assert.equal((await reads.loadPublic(true)).products[0].name, "Second lunch");
  fixture.setStatus(503);
  await assert.rejects(reads.loadPublic(true), /could not be verified/);
  assert.equal(reads.catalogue.snapshot().value, undefined);
  fixture.setStatus(200);
  fixture.change("Third lunch");
  fixture.corruptDownload();
  await assert.rejects(reads.loadPublic(true), /integrity/);
  assert.equal(reads.catalogue.snapshot().value, undefined);
});

test("damaged local storage is replaced from verified bytes and incompatible manifests stay closed", async () => {
  const fixture = publicHarness();
  await fixture.session().loadPublic();
  fixture.corruptCache();
  const reads = fixture.session();
  assert.equal((await reads.loadPublic()).products[0].name, "First lunch");
  assert.equal(fixture.calls.filter(call => call.startsWith(packagePath + "/")).length, 2);
  fixture.mismatchSchema();
  await assert.rejects(reads.loadPublic(true), /unsupported contract/);
  assert.equal(reads.catalogue.snapshot().value, undefined);
});

function adminPayload(canManage = true) {
  return {
    canManage, generatedAt: "2026-11-26T09:00:00Z", rows: [], oplocs: [], reviewGroups: [], counts: { active: 0, archived: 0, needsReview: 0, routingRequired: 0 },
    canonicalisation: { itemsAwaitingConsolidation: 0, mergeGroupsReady: 0, reviewGroups: 0 },
  };
}

test("admin revalidation joins pending calls and reloads only after a version or capability change", async () => {
  let version = "version-1";
  let canManage = true;
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/version")) return Response.json({ schemaVersion: 1, version, canManage });
    return Response.json(adminPayload(canManage), { headers: { "X-Fika-Catalogue-Version": version } });
  };
  const reads = new StudioReads(scope, fetch);
  await Promise.all([reads.loadAdmin(), reads.loadAdmin()]);
  assert.deepEqual(calls, ["/api/catalogue"]);
  await reads.loadAdmin("verify");
  assert.deepEqual(calls, ["/api/catalogue", "/api/catalogue/version"]);
  version = "version-2";
  await reads.loadAdmin("verify");
  assert.deepEqual(calls.slice(2), ["/api/catalogue/version", "/api/catalogue"]);
  canManage = false;
  assert.equal((await reads.loadAdmin("verify")).canManage, false);
});

test("session loss clears privileged state and superseded responses cannot replace a newer receipt", async () => {
  const reads = new StudioReads(scope, async () => new Response(null, { status: 401 }));
  reads.admin.set(adminPayload());
  await reads.fetch("/api/studio");
  assert.equal(reads.admin.snapshot().value, undefined);
  assert.match(reads.admission.snapshot().value!, /session or access has changed/);
  await assert.rejects(reads.loadAdmin(), /Reopen Studio/);

  const resource = new StudioReadResource<string>();
  let finish!: (value: string) => void;
  const old = new Promise<string>(resolve => { finish = resolve; });
  const request = resource.load(() => old, 1000);
  resource.set("new");
  finish("old");
  await assert.rejects(request, /replaced/);
  assert.equal(resource.snapshot().value, "new");
  assert.equal(await resource.load(async () => "fresh", -1), "fresh");
});

test("Dish Library pages share confirmed edits and overlapping immutable revisions are fetched once", async () => {
  const calls: string[] = [];
  const dish = { id: "fixture-dish", version: 1, name: "Dish", category: "other", temperature: null,
    customerDescription: "", kitchenDescription: "", assortment: null, updatedAt: "2026-11-26T09:00:00Z" } as const;
  const reads = new StudioReads(scope, async input => {
    const url = String(input);
    calls.push(url);
    return Response.json({ items: [dish], nextCursor: null });
  });
  await Promise.all([reads.loadDishPage(), reads.loadDishPage()]);
  reads.rememberDish({ ...dish, version: 2, name: "Updated dish" });
  assert.equal((await reads.loadDishPage()).items[0].name, "Updated dish");
  const [first, second] = await Promise.all([reads.loadRevisions([dish.id + "@1"]), reads.loadRevisions([dish.id + "@1"])]);
  assert.equal(first[0].version, 1);
  assert.deepEqual(second, first);
  assert.equal(calls.length, 2);
  assert.equal(indexAdminCatalogue(adminPayload()).rowsById.size, 0);
});
