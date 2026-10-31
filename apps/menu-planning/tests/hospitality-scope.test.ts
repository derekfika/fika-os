import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The local store resolves under process.cwd(); isolate it before the repository is imported.
const originalCwd = process.cwd();
let directory = "";
let repository: typeof import("../lib/canonical-menu-repository");
let source: typeof import("../lib/catalogue-source");
let catalogue: typeof import("../lib/catalogue");

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hospitality-scope-"));
  process.chdir(directory);
  repository = await import("../lib/canonical-menu-repository");
  source = await import("../lib/catalogue-source");
  catalogue = await import("../lib/catalogue");
});
after(async () => { process.chdir(originalCwd); await rm(directory, { recursive: true, force: true }); });

test("hospitality dishes are created once per catalogue Item and never reach the Week Planner reads", async () => {
  const planner = await repository.createCanonicalMenuItem({ displayName: "Roast potatoes", category: "Starch/Side" }, "tester-one");
  const created = await repository.createHospitalityDish({ dishId: "hospitality-dish:item-1", displayName: "Chicken skewer", classification: "finger-food" }, "rotations:sam");
  assert.equal(created.outcome, "created_new");
  assert.equal(created.item.operationalScope, "HOSPITALITY_ROTATIONS");
  assert.equal(created.item.hospitalityClass, "finger-food");
  // Allergen state starts unrecorded: never Clear.
  assert.deepEqual(created.item.allergenEvidence, []);
  assert.equal(created.item.mayContainReviewed, false);

  const again = await repository.createHospitalityDish({ dishId: "hospitality-dish:item-1", displayName: "Chicken skewer", classification: "finger-food" }, "rotations:sam");
  assert.equal(again.outcome, "matched_existing");

  const visible = await repository.listCanonicalMenuItems();
  assert.deepEqual(visible.map(item => item.canonicalId), [planner.canonicalId]);
  const everything = await repository.listCanonicalMenuItems({ scope: "all" });
  assert.deepEqual(everything.map(item => item.canonicalId).sort(), [planner.canonicalId, "hospitality-dish:item-1"].sort());
  assert.equal((await repository.listCanonicalMenuItemsByIds(["hospitality-dish:item-1", planner.canonicalId])).length, 1);
  assert.equal((await repository.listCanonicalMenuItemsByIds(["hospitality-dish:item-1"], { scope: "all" })).length, 1);
  assert.equal(await repository.getCanonicalMenuItemById("hospitality-dish:item-1"), undefined);
  assert.equal((await repository.getCanonicalMenuItemById("hospitality-dish:item-1", { scope: "all" }))?.displayName, "Chicken skewer");
  assert.deepEqual((await catalogue.listCatalogueEntries()).map(entry => entry.id), [planner.canonicalId]);
});

test("the Menu Planning source hash ignores hospitality dishes so the planner package stays source-bound", async () => {
  const visible = await repository.listCanonicalMenuItems();
  const everything = await repository.listCanonicalMenuItems({ scope: "all" });
  assert.notEqual(visible.length, everything.length);
  assert.equal(source.catalogueSourceHash(everything), source.catalogueSourceHash(visible));
});

test("a same-named planner dish does not match the hospitality record, and an ID clash is refused", async () => {
  const planner = await repository.createCanonicalMenuItem({ displayName: "Chicken skewer", category: "Hot Main" }, "tester-two");
  assert.equal(planner.outcome, "created_new");
  assert.notEqual(planner.canonicalId, "hospitality-dish:item-1");
  await assert.rejects(repository.createHospitalityDish({ dishId: planner.canonicalId, displayName: "Another", classification: "canapes" }, "rotations:sam"), error => (error as { status?: number }).status === 409);
  await assert.rejects(repository.createHospitalityDish({ dishId: "hospitality-dish:item-2", displayName: "Chicken skewer", classification: "canapes" }, "rotations:sam"), error => (error as { status?: number }).status === 409);
});
