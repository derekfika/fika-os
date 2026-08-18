import assert from "node:assert/strict";
import test from "node:test";
import { localMnkMenuCatalogue } from "../lib/local-mnk-menu";

test("MNK conversion covers every source item and retains deterministic source IDs", () => {
  assert.equal(localMnkMenuCatalogue.source.itemCount, 43);
  assert.equal(localMnkMenuCatalogue.items.length, localMnkMenuCatalogue.source.itemCount);
  assert.equal(new Set(localMnkMenuCatalogue.items.map(item => item.source.sourceItemId)).size, 43);
  assert.equal(localMnkMenuCatalogue.items.find(item => item.source.sourceItemId === "mini_pastries")?.canonicalId, "hospitality-menu-item:mnk:mini_pastries");
});
test("MNK conversion preserves inactive handling and reports missing canonical enrichment", () => {
  assert.equal(localMnkMenuCatalogue.items.every(item => item.lifecycleState === "active"), true);
  assert.ok(localMnkMenuCatalogue.validationReport.missingCanonicalFields.some(item => item.field === "vatRate"));
  assert.ok(localMnkMenuCatalogue.validationReport.missingCanonicalFields.some(item => item.field === "allergenInformation"));
});
test("MNK conversion retains source choice groups and ordering constraints", () => {
  const water = localMnkMenuCatalogue.items.find(item => item.source.sourceItemId === "belu_water");
  assert.equal(water?.optionGroups[0]?.id, "water");
  assert.equal(water?.orderingConstraints.noticeRequiredDays, 3);
});
