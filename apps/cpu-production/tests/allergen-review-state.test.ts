import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_ALLERGEN_KEYS, type CanonicalAllergenMap } from "../../shared/allergen-contract";
import { PENDING_DECLARATION, classifyRowAllergens } from "../app/lib/allergen-explicit";
import { checkpointAllergenReviewRow, completeAllergenReviewMap, confirmAllergenReviewMap, unresolvedNamedAllergenKeys } from "../app/lib/allergen-review-state";

const allClear = (): CanonicalAllergenMap => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, "clear" as const]));

test("complete named review never derives No-key; its hydrated value stays as recorded", () => {
  const states = { ...allClear(), no_key_allergens: "unrecorded" as const };
  const result = completeAllergenReviewMap(states);
  assert.equal(result.complete, true);
  assert.equal(result.states.no_key_allergens, "unrecorded", "all named clear never becomes No Key Allergens");
});

test("named contains and may-contain states leave the No-key slot untouched", () => {
  assert.equal(completeAllergenReviewMap({ ...allClear(), no_key_allergens: "unrecorded", gluten: "contains" }).states.no_key_allergens, "unrecorded");
  assert.equal(completeAllergenReviewMap({ ...allClear(), no_key_allergens: "unrecorded", milk: "may_contain" }).states.no_key_allergens, "unrecorded");
});

test("one explicit CPU confirmation converts sparse named states to clear without changing positive evidence", () => {
  const sparse: CanonicalAllergenMap = Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, "unrecorded" as const]));
  sparse.peanuts = "contains";
  sparse.fish = "may_contain";
  sparse.milk = "clear";
  const confirmed = confirmAllergenReviewMap(sparse);
  assert.equal(confirmed.complete, true);
  assert.equal(confirmed.unresolvedKeys.length, 11);
  assert.equal(confirmed.states.peanuts, "contains");
  assert.equal(confirmed.states.fish, "may_contain");
  assert.equal(confirmed.states.milk, "clear");
  assert.equal(confirmed.states.gluten, "clear");
  assert.equal(confirmed.states.tree_nuts, "clear");
  assert.equal(confirmed.states.no_key_allergens, "clear");
});

test("hydration-safe completion never converts unrecorded values", () => {
  const sparse = { milk: "unrecorded" as const, no_key_allergens: "unrecorded" as const };
  const preview = completeAllergenReviewMap(sparse);
  assert.equal(preview.complete, false);
  assert.equal(preview.states.milk, "unrecorded");
  assert.equal(preview.states.no_key_allergens, "unrecorded");
});

test("any named unrecorded state blocks completion and reports exactly the unresolved columns", () => {
  const states = { ...allClear(), milk: "unrecorded" as const, sesame: "unrecorded" as const, no_key_allergens: "unrecorded" as const };
  const result = completeAllergenReviewMap(states);
  assert.equal(result.complete, false);
  assert.deepEqual(result.unresolvedKeys, ["sesame", "milk"]);
  assert.deepEqual(unresolvedNamedAllergenKeys(states), ["sesame", "milk"]);
});

test("a declared row is checked once, edits reopen it, and the final row marks the plan planned", () => {
  const rowStates = { "dish:one": { no_key_allergens: "contains" as const }, "dish:two": { gluten: "contains" as const } };
  const first = checkpointAllergenReviewRow(rowStates, new Set(), "dish:one", 2, new Set(["dish:one"]));
  assert.equal(first.blocked, false);
  assert.equal(first.action, "save-plan");
  assert.deepEqual([...first.checkedRows], ["dish:one"]);
  assert.equal(first.states["dish:one"].no_key_allergens, "contains");

  const reopened = checkpointAllergenReviewRow(first.states, first.checkedRows, "dish:one", 2, new Set(["dish:one"]));
  assert.equal(reopened.action, "save-plan");
  assert.deepEqual([...reopened.checkedRows], []);
  assert.equal(reopened.states["dish:one"].no_key_allergens, "contains", "the deliberate tick survives reopening");
  assert.equal(reopened.states["dish:one"].milk, undefined, "confirmed Clears revert to blank on reopen");

  const final = checkpointAllergenReviewRow(first.states, new Set(["dish:one"]), "dish:two", 2);
  assert.equal(final.action, "mark-planned");
  assert.deepEqual([...final.checkedRows].sort(), ["dish:one", "dish:two"]);
  assert.equal(final.states["dish:one"].no_key_allergens, "contains");
  assert.equal(final.states["dish:two"].no_key_allergens, "clear", "a row with a named allergen is never No Key");
  assert.equal(final.states["dish:two"].gluten, "contains");
});

test("a blank row cannot be marked checked (checkpoint is blocked and nothing changes)", () => {
  const blocked = checkpointAllergenReviewRow({ "dish:blank": {} }, new Set(), "dish:blank", 1);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.checkedRows.size, 0);
  assert.deepEqual(blocked.states["dish:blank"], {});
});

test("a legacy automatic No Key / all-clear row cannot be checked without a deliberate tick", () => {
  const blocked = checkpointAllergenReviewRow({ "dish:legacy": allClear() }, new Set(), "dish:legacy", 1);
  assert.equal(blocked.blocked, true);
  assert.equal(confirmAllergenReviewMap(allClear()).blocked, "legacy_unverified");
});

test("transitions: blank -> allergen -> No Key -> allergen -> last allergen removed -> blank", async () => {
  const { applyHospitalityCellClick } = await import("../app/ui/allergen-cell-state");
  let row: Record<string, never> | Record<string, string> = {};
  row = applyHospitalityCellClick(row as never, "gluten");
  assert.deepEqual(row, { gluten: "contains" });
  row = applyHospitalityCellClick(row as never, "no_key_allergens");
  assert.equal((row as never as Record<string, string>).no_key_allergens, "contains");
  assert.equal((row as never as Record<string, string>).gluten, undefined, "ticking No Key clears named allergens");
  row = applyHospitalityCellClick(row as never, "milk");
  assert.deepEqual(row, { milk: "contains" }, "selecting an allergen clears No Key");
  row = applyHospitalityCellClick(applyHospitalityCellClick(row as never, "milk"), "milk");
  assert.deepEqual(row, {}, "removing the last allergen returns to BLANK, never No Key");
  assert.equal(classifyRowAllergens(row), "blank");
  assert.equal(classifyRowAllergens(applyHospitalityCellClick({}, "no_key_allergens"), { declaration: PENDING_DECLARATION }), "declared");
  assert.equal(classifyRowAllergens(applyHospitalityCellClick(applyHospitalityCellClick({}, "no_key_allergens"), "no_key_allergens", { declaration: PENDING_DECLARATION })), "blank", "unticking No Key returns to blank");
});
