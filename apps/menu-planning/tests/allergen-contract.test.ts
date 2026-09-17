import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRollingEntryPatch } from "../lib/rolling-command";
import {
  CANONICAL_ALLERGEN_KEYS,
  CANONICAL_ALLERGEN_COLUMNS,
  deriveNoKeyAllergens,
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

test("no-key state is derived from named allergen completeness", () => {
  const clear = deriveNoKeyAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.filter(key => key !== "no_key_allergens").map(key => [key, "clear"])));
  assert.equal(clear.no_key_allergens, "contains");
  assert.equal(deriveNoKeyAllergens({ milk: "contains" }).no_key_allergens, "clear");
  assert.equal(deriveNoKeyAllergens({ milk: "may_contain" }).no_key_allergens, "clear");
  assert.equal(deriveNoKeyAllergens({ milk: "clear" }).no_key_allergens, "unrecorded");
});

test("saving an allergen patch persists the derived no-key state and explicit review", () => {
  const entry = { id: "entry:allergens", dayId: "day:allergens", date: "2026-09-14", slot: "SOUP", itemLabel: "Soup", portions: 1, allocations: [], allergens: {}, audit: [] } as any;
  applyRollingEntryPatch(entry, { allergens: { milk: "contains" } });
  assert.equal(entry.allergens.no_key_allergens, "clear");
  assert.equal(entry.allergenReviewInvalidated, false);
  applyRollingEntryPatch(entry, { allergens: Object.fromEntries(CANONICAL_ALLERGEN_KEYS.filter(key => key !== "no_key_allergens").map(key => [key, "clear"])) });
  assert.equal(entry.allergens.no_key_allergens, "contains");
});

test("saving a sparse explicit no-key decision preserves that decision", () => {
  const entry = { id: "entry:explicit-no-key", dayId: "day:allergens", date: "2026-09-14", slot: "SOUP", itemLabel: "Soup", portions: 1, allocations: [], allergens: {}, audit: [] } as any;
  applyRollingEntryPatch(entry, { allergens: { no_key_allergens: "contains" } });
  assert.equal(entry.allergens.no_key_allergens, "contains");
  assert.equal(entry.allergens.milk, undefined);
  assert.equal(entry.allergenReviewInvalidated, false);
});
