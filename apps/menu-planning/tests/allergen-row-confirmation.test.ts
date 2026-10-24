import assert from "node:assert/strict";
import test from "node:test";
import { canonicalAllergenMatrixForHash } from "../../shared/allergen-matrix-hash";
import { confirmRow, isRowConfirmed, reopenRow, rowFingerprint, rowPositives } from "../../shared/allergen-review";
import { CANONICAL_ALLERGEN_KEYS, isCompleteOperationalAllergenMap } from "../../shared/allergen-contract";
import { resolveAllergenSnapshot } from "../lib/allergen-resolution";
import { applyRollingEntryPatch } from "../lib/rolling-command";

const NAMED = CANONICAL_ALLERGEN_KEYS.filter(key => key !== "no_key_allergens");
const ctx = { actor: "chef@fika.test", at: "2026-10-24T10:00:00.000Z" };
const entry = (extra: Record<string, unknown> = {}) => ({ id: "entry:1", dayId: "day:1", date: "2026-11-17", slot: "SOUP", itemLabel: "Leek soup", portions: 4, allocations: [], allergens: {}, audit: [], ...extra }) as any;

test("a blank row stays unrecorded and is never reviewed before confirmation", () => {
  const plain = entry();
  applyRollingEntryPatch(plain, { allergens: { milk: "contains" } }, ctx);
  assert.equal(plain.allergens.eggs, undefined);
  assert.equal(isCompleteOperationalAllergenMap(plain.allergens), false);
  const resolved = resolveAllergenSnapshot(plain);
  assert.equal(resolved.evidenceStatus, "unreviewed");
  assert.ok(resolved.unresolved.length > 0);
});

test("confirming keeps explicit positives, records blanks as clear and stamps the reviewer", () => {
  const row = entry();
  applyRollingEntryPatch(row, { allergens: { milk: "contains", gluten: "may_contain" }, confirmAllergenReview: true }, ctx);
  assert.equal(row.allergens.milk, "contains");
  assert.equal(row.allergens.gluten, "may_contain");
  assert.equal(row.allergens.eggs, "clear");
  assert.equal(row.allergens.no_key_allergens, "clear");
  assert.equal(row.allergenReview.confirmedBy, ctx.actor);
  assert.equal(row.allergenReview.confirmedAt, ctx.at);
  assert.equal(row.allergenReview.semantics, 2);
  assert.equal(resolveAllergenSnapshot(row).evidenceStatus, "confirmed");
});

test("a confirmed row with nothing marked derives no_key_allergens as the inverted contains", () => {
  const row = entry();
  applyRollingEntryPatch(row, { allergens: {}, confirmAllergenReview: true }, ctx);
  for (const key of NAMED) assert.equal(row.allergens[key], "clear");
  assert.equal(row.allergens.no_key_allergens, "contains");
});

test("confirmation is refused without an actor or a dish name", () => {
  assert.throws(() => applyRollingEntryPatch(entry(), { confirmAllergenReview: true }), /reviewer/);
  assert.throws(() => applyRollingEntryPatch(entry({ itemLabel: "  " }), { confirmAllergenReview: true }, ctx), /named dish/);
});

test("a client cannot forge the confirmation record", () => {
  const row = entry();
  const forged = confirmRow({ allergens: {}, identity: "Leek soup", actor: "someone", now: ctx.at }).review;
  applyRollingEntryPatch(row, { allergens: { milk: "contains" }, allergenReview: forged } as any, ctx);
  assert.equal(row.allergenReview, undefined);
});

test("a material edit reopens the row and derived clears revert to unrecorded", () => {
  const row = entry();
  applyRollingEntryPatch(row, { allergens: { milk: "contains" }, confirmAllergenReview: true }, ctx);
  applyRollingEntryPatch(row, { allergens: { milk: "contains", eggs: "may_contain" } }, ctx);
  assert.equal(row.allergenReview, undefined);
  assert.equal(row.allergens.gluten, undefined);
  assert.equal(row.allergens.eggs, "may_contain");
  assert.equal(resolveAllergenSnapshot(row).evidenceStatus, "unreviewed");
});

test("renaming the dish or changing the may-contain note invalidates; a quantity edit does not", () => {
  const row = entry();
  applyRollingEntryPatch(row, { allergens: { milk: "contains" }, confirmAllergenReview: true }, ctx);
  applyRollingEntryPatch(row, { portions: 9 }, ctx);
  assert.ok(row.allergenReview, "quantity-only edit keeps the confirmation");
  applyRollingEntryPatch(row, { mayContainNotes: "Made near nuts" }, ctx);
  assert.equal(row.allergenReview, undefined);
  const renamed = entry();
  applyRollingEntryPatch(renamed, { allergens: { milk: "contains" }, confirmAllergenReview: true }, ctx);
  applyRollingEntryPatch(renamed, { itemLabel: "Leek and potato soup" }, ctx);
  assert.equal(renamed.allergenReview, undefined);
  assert.deepEqual(renamed.allergens, {});
  assert.equal(renamed.allergenReviewInvalidated, true);
});

test("a stale stored confirmation never resolves as confirmed", () => {
  const row = entry();
  applyRollingEntryPatch(row, { allergens: { milk: "contains" }, confirmAllergenReview: true }, ctx);
  row.itemLabel = "Different dish";
  assert.equal(resolveAllergenSnapshot(row).evidenceReason, "menu-entry-review-stale");
});

test("legacy fully explicit rows without a review record keep their meaning", () => {
  const legacy = entry({ allergenReviewInvalidated: false, allergens: Object.fromEntries([...NAMED.map(key => [key, "clear"]), ["no_key_allergens", "contains"]]) });
  assert.equal(resolveAllergenSnapshot(legacy).evidenceStatus, "confirmed");
  assert.equal(isRowConfirmed({ allergens: legacy.allergens, identity: legacy.itemLabel }), false, "new semantics need a review record");
});

test("shared helpers: fingerprint stability, reopen and the signed matrix hash input ignores review metadata", () => {
  const a = rowFingerprint("Leek Soup", { milk: "contains", eggs: "clear" }, "");
  assert.equal(a, rowFingerprint("leek soup ", { milk: "contains" }, " "));
  assert.notEqual(a, rowFingerprint("leek soup", { milk: "may_contain" }, ""));
  const confirmed = confirmRow({ allergens: { milk: "contains" }, identity: "Leek soup", actor: "c", now: ctx.at });
  assert.deepEqual(rowPositives(reopenRow(confirmed.allergens)), { milk: "contains" });
  assert.equal(reopenRow(confirmed.allergens).eggs, undefined);
  const item = (extra: object) => canonicalAllergenMatrixForHash([{ sourceLineId: "l1", name: "Leek soup", subItems: [{ name: "Leek soup", quantity: 4, allergens: confirmed.allergens, ...extra }] }] as never);
  assert.deepEqual(item({}), item({ review: confirmed.review }), "confirmation metadata is excluded from the signed matrix hash input");
});
