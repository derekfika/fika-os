import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodeReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { buildCataloguePackage, CATALOGUE_MANIFEST_KEY, publishCataloguePackage, type PackageSource } from "../lib/hospitality-catalogue-package";
import { resolveSiteCatalogue, type CataloguePackage } from "../lib/hospitality-effective-offering";
import type { CanonicalRecord } from "../lib/types";

const wrap = (entityType: string, canonicalId: string, record: Record<string, unknown>, lifecycleStatus = "published") => ({ canonicalId, entityType, record: { version: 1, canonicalId, ...record }, dataHash: "x", lifecycleStatus, publicationStatus: "published" }) as unknown as CanonicalRecord;
const item = (id: string, extra: Record<string, unknown> = {}) => wrap("Hospitality Menu Item", id, { name: id, category: "Food", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [], ...extra });
const offering = (id: string, itemId: string, oplocId: string, extra: Record<string, unknown> = {}) => wrap("Hospitality Menu Offering", id, { hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard", lifecycleState: "active", ...extra });
const price = (id: string, scope: { itemId?: string; offeringId?: string }, amount: number) => wrap("Hospitality Menu Price", id, { ...(scope.itemId ? { hospitalityMenuItemId: scope.itemId } : { hospitalityMenuOfferingId: scope.offeringId }), amount, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
const oploc = (id: string) => wrap("OPLOC", id, { approvedName: `Site ${id}`, lifecycleState: "active" });
const TODAY = "2026-10-17";
const sites = Array.from({ length: 19 }, (_, index) => oploc(`oploc:${String(index).padStart(2, "0")}`));
const source = (extra: Partial<PackageSource> = {}): PackageSource => ({ items: Array.from({ length: 46 }, (_, i) => item(`hospitality-menu-item:${i}`)), offerings: [], prices: Array.from({ length: 46 }, (_, i) => price(`hospitality-menu-price:${i}`, { itemId: `hospitality-menu-item:${i}` }, 3 + i / 10)), oplocs: sites, routing: [{ menuItemId: "hospitality-menu-item:0", workstreams: ["hospitality"], version: 1 }], ...extra });

function memoryStore() {
  const objects = new Map<string, Uint8Array>(); const manifests = new Map<string, ReadPackageManifest>(); let puts = 0;
  const store: ReadPackageStore = { async putImmutable(name, bytes) { if (!objects.has(name)) { objects.set(name, new Uint8Array(bytes)); puts++; } }, async get(name) { return objects.get(name); }, async has(name) { return objects.has(name); }, async getManifest(key) { return manifests.get(key); }, async putManifest(key, manifest) { manifests.set(key, manifest); } };
  return { store, objects, manifests, puts: () => puts };
}

test("the package is compact and sparse: Items once, company defaults once, NO Item x OPLOC matrix", () => {
  const pkg = buildCataloguePackage(source(), TODAY);
  assert.equal(pkg.items.length, 46); assert.equal(pkg.oplocs.length, 19); assert.equal(pkg.exceptions.length, 0, "46 items x 19 sites, zero exception records");
  const bytes = Buffer.byteLength(JSON.stringify(pkg)); assert.ok(bytes < 20_000, `package stays small (${bytes} bytes)`);
  // 46 x 19 = 874 combinations resolve locally from 46 + 19 records
  assert.equal(resolveSiteCatalogue(pkg, "oploc:07", { serviceDate: TODAY }).length, 46);
});

test("removing one of 19 sites for one Item adds exactly ONE exception; redundant legacy records and archived Items never appear", () => {
  const blocked = offering("hospitality-menu-offering:b", "hospitality-menu-item:3", "oploc:05", { available: false });
  const redundant = offering("hospitality-menu-offering:r", "hospitality-menu-item:4", "oploc:05");           // states nothing: not an exception
  const retired = offering("hospitality-menu-offering:t", "hospitality-menu-item:5", "oploc:05", { available: false, lifecycleState: "archived", retiredReason: "item-archived" });
  const pkg = buildCataloguePackage(source({ offerings: [blocked, redundant, retired], items: [...source().items, item("hospitality-menu-item:gone", { lifecycleState: "archived" })] }), TODAY);
  assert.deepEqual(pkg.exceptions.map(entry => entry.id), ["hospitality-menu-offering:b"]);
  assert.ok(!pkg.items.some(entry => entry.id === "hospitality-menu-item:gone"));
  assert.equal(resolveSiteCatalogue(pkg, "oploc:05", { serviceDate: TODAY }).some(entry => entry.itemId === "hospitality-menu-item:3"), false);
  assert.equal(resolveSiteCatalogue(pkg, "oploc:06", { serviceDate: TODAY }).some(entry => entry.itemId === "hospitality-menu-item:3"), true);
});

test("only published records feed the package; inactive OPLOCs are left out; malformed prices fail closed in the resolver", () => {
  const draft = item("hospitality-menu-item:draft"); (draft as { lifecycleStatus: string }).lifecycleStatus = "draft";
  const inactive = wrap("OPLOC", "oploc:dead", { approvedName: "Dead", lifecycleState: "decommissioned" });
  const bad = wrap("Hospitality Menu Price", "hospitality-menu-price:bad", { hospitalityMenuItemId: "hospitality-menu-item:0", amount: "3", currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
  const pkg = buildCataloguePackage(source({ items: [...source().items, draft], oplocs: [...sites, inactive], prices: [...source().prices.filter(p => p.record.hospitalityMenuItemId !== "hospitality-menu-item:0"), bad] }), TODAY);
  assert.ok(!pkg.items.some(entry => entry.id === "hospitality-menu-item:draft")); assert.ok(!pkg.oplocs.some(entry => entry.id === "oploc:dead"));
  assert.equal(resolveSiteCatalogue(pkg, "oploc:01", { serviceDate: TODAY }).some(entry => entry.itemId === "hospitality-menu-item:0"), false, "a non-numeric price makes the item unbookable");
});

test("deterministic: identical catalogue content yields the identical package, hash and (no new) object identity", async () => {
  const first = memoryStore(); const pkg = buildCataloguePackage(source(), TODAY);
  assert.deepEqual(buildCataloguePackage(source(), TODAY), pkg, "same input, same package");
  assert.equal(JSON.stringify(buildCataloguePackage(source({ items: [...source().items].reverse(), prices: [...source().prices].reverse() }), TODAY)), JSON.stringify(pkg), "input order does not matter");
  const a = await publishCataloguePackage(pkg, first.store); assert.equal(a.status, "published"); assert.equal(a.manifest.packageVersion, 1);
  const b = await publishCataloguePackage(buildCataloguePackage(source(), TODAY), first.store);
  assert.equal(b.status, "unchanged"); assert.equal(b.manifest.contentHash, a.manifest.contentHash); assert.equal(b.manifest.packageVersion, 1, "no needless version bump"); assert.equal(first.puts(), 1, "no second object stored");
  const changed = buildCataloguePackage(source({ prices: source().prices.map((p, i) => i === 0 ? price("hospitality-menu-price:0", { itemId: "hospitality-menu-item:0" }, 9.99) : p) }), TODAY);
  const c = await publishCataloguePackage(changed, first.store); assert.equal(c.status, "published"); assert.notEqual(c.manifest.contentHash, a.manifest.contentHash); assert.equal(c.manifest.packageVersion, 2); assert.equal(first.puts(), 2);
});

test("gzip artifact: content-addressed immutable object, hash over the compressed bytes, round-trips through the storage adapter", async () => {
  const { store, objects, manifests } = memoryStore(); const pkg = buildCataloguePackage(source(), TODAY);
  const { manifest } = await publishCataloguePackage(pkg, store);
  assert.match(manifest.objectName, /^integration-hub\/hospitality-catalogue\/v1-[0-9a-f]{64}\.json\.gz$/); assert.ok(manifest.objectName.includes(manifest.contentHash));
  const stored = objects.get(manifest.objectName)!;
  assert.equal(createHash("sha256").update(stored).digest("hex"), manifest.contentHash, "the stored compressed bytes hash to the manifest identity");
  assert.equal(stored[0], 0x1f); assert.equal(stored[1], 0x8b, "gzip magic");
  assert.deepEqual(decodeReadPackage<CataloguePackage>(manifest, stored), pkg); assert.deepEqual(JSON.parse(gunzipSync(stored).toString("utf8")), pkg);
  assert.ok(manifest.compressedSize < manifest.uncompressedSize / 3, "sparse JSON gzips extremely well");
  assert.equal(manifests.get(CATALOGUE_MANIFEST_KEY)!.schemaVersion, 1); assert.equal(manifest.compression, "gzip");
  const tampered = new Uint8Array(stored); tampered[tampered.length - 9] ^= 0xff;
  assert.throws(() => decodeReadPackage(manifest, tampered), /integrity check failed/, "integrity failure stays fail-closed");
});
