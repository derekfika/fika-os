import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANONICAL_ALLERGEN_KEYS,
  CANONICAL_ALLERGEN_COLUMNS,
  enforceNoKeyExclusivity,
  normaliseOperationalAllergens,
  toLegacyAllergens,
  toggleOperationalAllergen,
} from "../../shared/allergen-contract";

test("all canonical allergen states survive the Menu Planning to CPU adapter round trip", () => {
  const source = Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map((key, index) => [key, index === 0 ? "clear" : index % 2 ? "contains" : "may_contain"])) as Record<string, "clear" | "contains" | "may_contain">;
  assert.deepEqual(normaliseOperationalAllergens(toLegacyAllergens(source)), source);
});

test("legacy CPU allergen keys map to their governed canonical meanings", () => {
  assert.equal(normaliseOperationalAllergens({ otherNuts: "contains" }).tree_nuts, "contains");
  assert.equal(normaliseOperationalAllergens({ noKeyAllergens: "contains" }).no_key_allergens, "contains");
});

test("canonical matrix columns are complete and ordered", () => {
  assert.deepEqual(CANONICAL_ALLERGEN_COLUMNS.map(([key]) => key), CANONICAL_ALLERGEN_KEYS);
});

test("no-key allergens remain mutually exclusive with named allergens", () => {
  const named = enforceNoKeyExclusivity({ no_key_allergens: "clear", milk: "contains" });
  assert.equal(named.no_key_allergens, "clear");
  const noKey = toggleOperationalAllergen({ milk: "contains" }, "no_key_allergens");
  assert.equal(noKey.no_key_allergens, "contains");
  assert.equal(noKey.milk, "clear");
});

test("contains and may_contain remain distinct", () => {
  const value = normaliseOperationalAllergens({ milk: "contains", sesame: "may_contain" });
  assert.equal(value.milk, "contains");
  assert.equal(value.sesame, "may_contain");
});
