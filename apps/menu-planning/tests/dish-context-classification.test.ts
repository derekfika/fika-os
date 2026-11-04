import test from "node:test";
import assert from "node:assert/strict";
import { addUseTag } from "../lib/dish-context-classification";
import type { MenuItem } from "../lib/domain";
test("context classification adds a stable many-use tag and preserves primary category, all prior uses and safety evidence", () => {
  const item = { canonicalId: "dish:almonds", displayName: "Toasted Almonds", category: "uncategorised", revision: 7, reviewStatus: "approved", tagIds: ["dish-tag:type:dessert"], allergenEvidence: [{ allergen: "nuts", value: "contains" }], audit: [] } as unknown as MenuItem;
  const before = JSON.stringify(item); const tagged = addUseTag(item, "dish-tag:type:menu-use-garnish", "person:1", "2026-11-04T12:00:00Z");
  assert.equal(JSON.stringify(item), before); assert.equal(tagged.canonicalId, item.canonicalId); assert.equal(tagged.category, item.category); assert.equal(tagged.reviewStatus, "approved"); assert.deepEqual(tagged.allergenEvidence, item.allergenEvidence); assert.deepEqual(tagged.tagIds, ["dish-tag:type:dessert", "dish-tag:type:menu-use-garnish"]); assert.equal(tagged.revision, 8); assert.equal(tagged.audit.at(-1)?.by, "person:1");
  assert.equal(addUseTag(tagged, "dish-tag:type:menu-use-garnish", "person:1"), tagged);
});
