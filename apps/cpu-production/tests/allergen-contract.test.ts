import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CANONICAL_ALLERGEN_KEYS, CANONICAL_ALLERGEN_COLUMNS, normaliseOperationalAllergens } from "../../shared/allergen-contract";

test("legacy CPU saved allergen data is readable as canonical data", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/legacy-allergen-plan.json", import.meta.url), "utf8")) as Record<string, { menuItems?: Array<{ subItems?: Array<{ allergens?: Record<string, string> }> }> }>;
  const source = Object.values(fixture).flatMap(plan => plan.menuItems || []).flatMap(item => item.subItems || []).find(item => item.allergens && ("noKeyAllergens" in item.allergens || "otherNuts" in item.allergens || "no_key_allergens" in item.allergens || "tree_nuts" in item.allergens));
  assert.ok(source);
  const converted = normaliseOperationalAllergens(source.allergens);
  assert.equal(converted.tree_nuts, "may_contain");
  assert.equal(converted.no_key_allergens, "clear");
  assert.equal(converted.milk, "unrecorded", "legacy unknown evidence must not become clear");
});

test("CPU matrix uses every canonical allergen column", () => {
  assert.deepEqual(CANONICAL_ALLERGEN_COLUMNS.map(([key]) => key), CANONICAL_ALLERGEN_KEYS);
});
