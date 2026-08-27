import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_ALLERGEN_KEYS, CANONICAL_ALLERGEN_COLUMNS, normaliseOperationalAllergens } from "@fika/contracts";

test("legacy CPU saved allergen data is readable as canonical data", () => {
  const fixture = { "test-plan": { menuItems: [{ subItems: [{ allergens: { noKeyAllergens: "contains", tree_nuts: "clear" } }] }] } } as Record<string, { menuItems?: Array<{ subItems?: Array<{ allergens?: Record<string, string> }> }> }>;
  const source = Object.values(fixture).flatMap(plan => plan.menuItems || []).flatMap(item => item.subItems || []).find(item => item.allergens && ("noKeyAllergens" in item.allergens || "otherNuts" in item.allergens || "no_key_allergens" in item.allergens || "tree_nuts" in item.allergens));
  assert.ok(source);
  const converted = normaliseOperationalAllergens(source.allergens);
  assert.ok("no_key_allergens" in converted || "tree_nuts" in converted);
});

test("CPU matrix uses every canonical allergen column", () => {
  assert.deepEqual(CANONICAL_ALLERGEN_COLUMNS.map(([key]) => key), CANONICAL_ALLERGEN_KEYS);
});
