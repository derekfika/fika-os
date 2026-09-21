import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_ALLERGEN_KEYS, type CanonicalAllergenMap } from "../../shared/allergen-contract";
import { allergenReviewCompletionMessage, checkpointAllergenReviewRow, completeAllergenReviewMap, unresolvedNamedAllergenKeys } from "../app/lib/allergen-review-state";

const allClear = (): CanonicalAllergenMap => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, "clear" as const]));

test("complete named review derives No-key contains even when its hydrated value is unrecorded", () => {
  const states = { ...allClear(), no_key_allergens: "unrecorded" as const };
  const result = completeAllergenReviewMap(states);
  assert.equal(result.complete, true);
  assert.equal(result.states.no_key_allergens, "contains");
});

test("named contains and may-contain states derive No-key clear", () => {
  assert.equal(completeAllergenReviewMap({ ...allClear(), gluten: "contains" }).states.no_key_allergens, "clear");
  assert.equal(completeAllergenReviewMap({ ...allClear(), milk: "may_contain" }).states.no_key_allergens, "clear");
});

test("any named unrecorded state blocks completion and reports exactly the unresolved columns", () => {
  const states = { ...allClear(), milk: "unrecorded" as const, sesame: "unrecorded" as const, no_key_allergens: "unrecorded" as const };
  const result = completeAllergenReviewMap(states);
  assert.equal(result.complete, false);
  assert.deepEqual(result.unresolvedKeys, ["sesame", "milk"]);
  assert.match(allergenReviewCompletionMessage(result.unresolvedKeys), /Resolve 2 Not recorded allergen states before marking this dish checked\./);
  assert.match(allergenReviewCompletionMessage(result.unresolvedKeys), /Sesame, Milk/);
  assert.deepEqual(unresolvedNamedAllergenKeys(states), ["sesame", "milk"]);
});

test("a complete row is checked once, edits reopen it, and the final row marks the plan planned", () => {
  const rowStates = { "dish:one": allClear(), "dish:two": allClear() };
  const first = checkpointAllergenReviewRow(rowStates, new Set(), "dish:one", 2);
  assert.equal(first.blocked, false);
  assert.equal(first.action, "save-plan");
  assert.deepEqual([...first.checkedRows], ["dish:one"]);
  assert.equal(first.states["dish:one"].no_key_allergens, "contains");

  const reopened = checkpointAllergenReviewRow(first.states, first.checkedRows, "dish:one", 2);
  assert.equal(reopened.action, "save-plan");
  assert.deepEqual([...reopened.checkedRows], []);

  const final = checkpointAllergenReviewRow(first.states, new Set(["dish:one"]), "dish:two", 2);
  assert.equal(final.action, "mark-planned");
  assert.deepEqual([...final.checkedRows].sort(), ["dish:one", "dish:two"]);
  assert.equal(final.states["dish:one"].no_key_allergens, "contains");
  assert.equal(final.states["dish:two"].no_key_allergens, "contains");
});
