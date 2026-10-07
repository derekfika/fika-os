import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogueSourceHash } from "../lib/catalogue-source";
import { migrateLegacyCatalogueSourceIdentity } from "../lib/catalogue-manifest";
import type { MenuItem } from "../lib/domain";

const items = [{ canonicalId: "dish:b", displayName: "B", allergens: { milk: "CONTAINS", egg: "UNRECORDED" }, revision: 3 }, { canonicalId: "dish:a", displayName: "A", revision: 2 }] as unknown as MenuItem[];
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}

test("Firestore map ordering and record ordering preserve source identity; business changes invalidate it", () => {
  const roundtrip = reverseKeys(JSON.parse(JSON.stringify(items))) as MenuItem[];
  assert.equal(catalogueSourceHash(items), catalogueSourceHash(roundtrip.reverse()));
  assert.notEqual(catalogueSourceHash(items), catalogueSourceHash([{ ...items[0], revision: 4 }, items[1]]));
  assert.notEqual(catalogueSourceHash(items), catalogueSourceHash([{ ...items[0], allergens: { milk: "CONTAINS", egg: "CLEAR" } } as unknown as MenuItem, items[1]]));
});

test("legacy source migration advances only manifest metadata once and reads authoritative records in the transaction", async () => {
  let manifest: Record<string, any> = { sourceRevision: 5, sourceHash: "legacy-order-dependent", lastMutationBy: "original-actor", packageState: { status: "pending" } };
  let writes = 0, catalogueReads = 0;
  const dishes = structuredClone(items);
  const ref = { id: "catalogue" };
  const query = { where() { return this; }, limit(bound: number) { assert.equal(bound, 1501); return this; } };
  const db = { collection(name: string) { return name === "fikaMenuPlanningCatalogueManifests" ? { doc() { return ref; } } : query; },
    async runTransaction(action: (tx: any) => Promise<void>) {
      let wrote = false;
      await action({ async get(target: unknown) {
        assert.equal(wrote, false, "all reads must precede writes");
        if (target === ref) return { exists: true, data: () => structuredClone(manifest) };
        catalogueReads += 1;
        return { size: dishes.length, docs: dishes.map(record => ({ data: () => ({ record: reverseKeys(record) }) })) };
      }, set(target: unknown, value: Record<string, any>) { assert.equal(target, ref); wrote = true; writes += 1; manifest = { ...manifest, ...value }; } });
    } };
  await migrateLegacyCatalogueSourceIdentity(db as any);
  assert.equal(writes, 1);
  assert.equal(catalogueReads, 1);
  assert.equal(manifest.sourceRevision, 6);
  assert.equal(manifest.sourceHashVersion, 2);
  assert.equal(manifest.sourceHash, catalogueSourceHash(items));
  assert.equal(manifest.packageState.status, "pending");
  assert.equal(manifest.lastMutationBy, "original-actor");
  assert.deepEqual(dishes, items);
  await migrateLegacyCatalogueSourceIdentity(db as any);
  assert.equal(writes, 1);
  assert.equal(catalogueReads, 1, "modern manifests do not rescan the catalogue");
});

test("a modern manifest is never repaired merely because its hash is unexpected", async () => {
  let writes = 0;
  const db = { collection() { return { doc: () => ({}) }; }, async runTransaction(action: (tx: any) => Promise<void>) {
    await action({ get: async () => ({ exists: true, data: () => ({ sourceHashVersion: 2, sourceRevision: 6, sourceHash: "unexpected" }) }), set() { writes += 1; } });
  } };
  await migrateLegacyCatalogueSourceIdentity(db as any);
  assert.equal(writes, 0);
});
