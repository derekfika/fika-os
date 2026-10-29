import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { checkedDishes, menuPackageMatchesSource } from "../lib/hospitality-rotations/resources";
import { rotationHandlers } from "../lib/hospitality-rotations/http";
import { RotationStore } from "../lib/hospitality-rotations/store";

test("rotation resource selection exposes only canonical dish picker fields", () => {
  const dishes = checkedDishes({ entries: [
    { id: "dish:one", kind: "canonical", name: "Roast potatoes", category: "Sides", status: "approved", item: { revision: 4, methodSteps: ["private recipe"] } },
    { id: "dish:two", kind: "legacy", name: "Old record", category: "Other", item: { revision: 1 } },
    { id: "dish:three", kind: "canonical", name: "Archived", category: "Other", status: "archived", item: { revision: 1 } },
    { id: "dish:bad", kind: "canonical", name: "Bad revision", category: "Other", item: { revision: "1" } },
  ] });
  assert.deepEqual(dishes, [{ id: "dish:one", name: "Roast potatoes", category: "Sides", revision: 4 }]);
});

test("Dish Library picker accepts only the current source-bound package identity", () => {
  const source = { sourceRevision: 7, sourceHash: "abc123", packageState: { status: "current", sourceRevision: 7, sourceHash: "abc123", packageHash: "gziphash" } };
  const manifest = { dataset: "snapshots/menu-planning/catalogue", packageVersion: 7, schemaVersion: 1, contractVersion: "menu-planning.catalogue.v1", objectName: "snapshot.gz", compression: "gzip" as const, contentHash: "gziphash", compressedSize: 10, uncompressedSize: 100, recordCount: 4, generatedAt: "2026-10-29T00:00:00.000Z", sourceVersion: "catalogue-r7-abc123", sourceHash: "abc123" };
  assert.equal(menuPackageMatchesSource(source, manifest), true);
  assert.equal(menuPackageMatchesSource({ ...source, packageState: { ...source.packageState, status: "pending" } }, manifest), false);
  assert.equal(menuPackageMatchesSource(source, { ...manifest, contentHash: "other" }), false);
  assert.equal(menuPackageMatchesSource(source, { ...manifest, packageVersion: 6 }), false);
});

test("resource mode is Manage-authorised and never runs its loader before authorisation", async () => {
  const actions: string[] = [];
  let loaded = false;
  const handlers = rotationHandlers({} as RotationStore, async (_request, action) => {
    actions.push(action);
    if (action !== "Manage") throw Object.assign(new Error("forbidden"), { status: 403 });
    return { id: "manager" } as never;
  }, async () => { loaded = true; return { dishes: [], items: [] }; });
  const response = await handlers.GET(new NextRequest("http://localhost/api/hospitality-rotations?mode=resources"));
  assert.equal(response.status, 200);
  assert.deepEqual(actions, ["Manage"]);
  assert.equal(loaded, true);

  loaded = false;
  const denied = rotationHandlers({} as RotationStore, async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); }, async () => { loaded = true; return { dishes: [], items: [] }; });
  const deniedResponse = await denied.GET(new NextRequest("http://localhost/api/hospitality-rotations?mode=resources"));
  assert.equal(deniedResponse.status, 403);
  assert.equal(loaded, false);
});
