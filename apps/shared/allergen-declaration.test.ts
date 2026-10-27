import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmRow } from "./allergen-review";
import {
  EXPLICIT_REVIEW_SEMANTICS, confirmRowExplicit, declareNoKey, explicitConfirmationInvalidatedBy, isExplicitRowConfirmed, isNoKeyDeclared,
  namedPositives, reopenRowExplicit, rowDeclarationState, rowReviewStatus, selectNamedAllergen, storedExplicitAllergens, withdrawNoKey,
} from "./allergen-declaration";

const actor = "Chef Sam";
const now = "2026-10-27T09:00:00.000Z";
const identity = "Hot lunch";

test("a completely blank row is blank, cannot be checked, and does not assume No key allergens", () => {
  assert.equal(rowDeclarationState({}), "blank");
  assert.equal(isNoKeyDeclared({}), false);
  assert.throws(() => confirmRowExplicit({ allergens: {}, identity, actor, now }), /declare No key allergens/);
  assert.equal(rowReviewStatus({ allergens: {}, identity }), "unchecked");
});

test("explicit No key declaration, then Mark checked, records every named allergen as confirmed Clear with chef and time", () => {
  const declared = declareNoKey({});
  if (!declared.ok) assert.fail("expected the declaration to be accepted");
  assert.equal(rowDeclarationState(declared.allergens), "declared");
  const confirmed = confirmRowExplicit({ allergens: declared.allergens, identity, actor, now });
  assert.equal(confirmed.allergens.no_key_allergens, "contains");
  assert.equal(confirmed.allergens.peanuts, "clear");
  assert.equal(confirmed.allergens.sulphites, "clear");
  assert.equal(Object.keys(confirmed.allergens).length, 15);
  assert.deepEqual([confirmed.review.confirmedBy, confirmed.review.confirmedAt, confirmed.review.semantics], [actor, now, EXPLICIT_REVIEW_SEMANTICS]);
  assert.equal(isExplicitRowConfirmed({ allergens: confirmed.allergens, review: confirmed.review, identity }), true);
});

test("selecting the declaration alone is pending, never checked", () => {
  const declared = declareNoKey({});
  if (!declared.ok) assert.fail("expected the declaration to be accepted");
  assert.equal(rowReviewStatus({ allergens: declared.allergens, declaration: { declared: true, declaredBy: actor, declaredAt: now }, identity }), "unchecked");
});

test("named Contains and May contain are kept, blanks become Clear, and No key is Clear", () => {
  const confirmed = confirmRowExplicit({ allergens: { milk: "contains", gluten: "may_contain" }, identity, actor, now });
  assert.equal(confirmed.allergens.milk, "contains");
  assert.equal(confirmed.allergens.gluten, "may_contain");
  assert.equal(confirmed.allergens.fish, "clear");
  assert.equal(confirmed.allergens.no_key_allergens, "clear");
  assert.deepEqual(namedPositives(confirmed.allergens), { gluten: "may_contain", milk: "contains" });
  assert.equal(isExplicitRowConfirmed({ allergens: confirmed.allergens, review: confirmed.review, identity }), true);
});

test("declaring No key over recorded positives is refused without erasing them", () => {
  const input = { milk: "contains" as const };
  const result = declareNoKey(input);
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.positives, { milk: "contains" });
  assert.deepEqual(input, { milk: "contains" });
});

test("selecting a named allergen while No key is declared needs a deliberate acknowledgement and preserves the declaration until then", () => {
  const declared = declareNoKey({});
  if (!declared.ok) assert.fail("expected the declaration to be accepted");
  const refused = selectNamedAllergen(declared.allergens, "milk", "contains");
  assert.deepEqual(refused, { ok: false, reason: "no_key_declared" });
  assert.equal(isNoKeyDeclared(declared.allergens), true);
  const accepted = selectNamedAllergen(declared.allergens, "milk", "contains", { acknowledgeNoKeyWithdrawal: true });
  if (!accepted.ok) assert.fail("expected the selection to be accepted");
  assert.equal(accepted.allergens.milk, "contains");
  assert.equal(isNoKeyDeclared(accepted.allergens), false);
});

test("a conflicting row can never be confirmed", () => {
  assert.equal(rowDeclarationState({ no_key_allergens: "contains", milk: "contains" }), "conflict");
  assert.throws(() => confirmRowExplicit({ allergens: { no_key_allergens: "contains", milk: "may_contain" }, identity, actor, now }), /conflicts/);
  assert.equal(rowReviewStatus({ allergens: { no_key_allergens: "contains", milk: "contains" }, declaration: { declared: true }, identity }), "conflict");
});

test("repeated Mark checked is idempotent in content and fingerprint", () => {
  const first = confirmRowExplicit({ allergens: { eggs: "contains" }, identity, actor, now });
  const second = confirmRowExplicit({ allergens: first.allergens, identity, actor, now: "2026-10-27T09:05:00.000Z" });
  assert.deepEqual(second.allergens, first.allergens);
  assert.equal(second.review.inputFingerprint, first.review.inputFingerprint);
});

test("a material change after confirmation invalidates the check", () => {
  const confirmed = confirmRowExplicit({ allergens: { eggs: "contains" }, identity, actor, now });
  const row = { allergens: confirmed.allergens, review: confirmed.review, identity };
  assert.equal(isExplicitRowConfirmed(row), true);
  assert.equal(isExplicitRowConfirmed({ ...row, allergens: { ...confirmed.allergens, eggs: "may_contain" } }), false);
  assert.equal(isExplicitRowConfirmed({ ...row, identity: "Cold lunch" }), false);
  assert.equal(isExplicitRowConfirmed({ ...row, mayContainNotes: "Made on shared line" }), false);
  assert.equal(explicitConfirmationInvalidatedBy(confirmed.review, { identity, allergens: { ...confirmed.allergens, eggs: "may_contain" } }), true);
  assert.equal(explicitConfirmationInvalidatedBy(confirmed.review, { identity, allergens: confirmed.allergens }), false);
  const declared = confirmRowExplicit({ allergens: { no_key_allergens: "contains" }, identity, actor, now });
  assert.equal(isExplicitRowConfirmed({ allergens: withdrawNoKey(declared.allergens), review: declared.review, identity }), false);
});

test("reopening reverts confirmed Clears, keeps positives and a pending declaration", () => {
  const checked = confirmRowExplicit({ allergens: { milk: "contains" }, identity, actor, now });
  assert.deepEqual(reopenRowExplicit(checked.allergens), { milk: "contains" });
  const declared = confirmRowExplicit({ allergens: { no_key_allergens: "contains" }, identity, actor, now });
  assert.deepEqual(reopenRowExplicit(declared.allergens), { no_key_allergens: "contains" });
});

test("legacy semantics-2 rows keep their check but are never reinterpreted as an explicit No key declaration", () => {
  const legacy = confirmRow({ allergens: { milk: "contains" }, identity, actor, now });
  assert.equal(rowReviewStatus({ allergens: legacy.allergens, review: legacy.review, identity }), "checked_legacy");
  const legacyAllClear = confirmRow({ allergens: {}, identity, actor, now });
  assert.equal(legacyAllClear.allergens.no_key_allergens, "contains", "legacy derived value");
  assert.equal(rowReviewStatus({ allergens: legacyAllClear.allergens, review: legacyAllClear.review, identity }), "checked_legacy");
  assert.equal("no_key_allergens" in storedExplicitAllergens(legacyAllClear.allergens, { review: legacyAllClear.review }), false);
  assert.equal(rowDeclarationState(storedExplicitAllergens(legacyAllClear.allergens, { review: legacyAllClear.review })), "blank");
});

test("a legacy all-clear row without a review stays unchecked and is not a declaration", () => {
  const imported = { no_key_allergens: "contains" as const, milk: "clear" as const, eggs: "clear" as const };
  assert.equal(rowReviewStatus({ allergens: imported, identity }), "unchecked");
  assert.equal(rowDeclarationState(storedExplicitAllergens(imported, {})), "blank");
});

test("contradictory or sparse stored maps never throw and never infer a declaration", () => {
  assert.equal(rowDeclarationState({ noKeyAllergens: "contains", milk: "contains" }), "conflict");
  assert.equal(rowDeclarationState({ milk: "clear", eggs: "clear" }), "blank");
  assert.equal(rowDeclarationState(undefined), "blank");
});

test("an unattributed or unnamed confirmation is refused", () => {
  assert.throws(() => confirmRowExplicit({ allergens: { milk: "contains" }, identity: " ", actor, now }), /named dish/);
  assert.throws(() => confirmRowExplicit({ allergens: { milk: "contains" }, identity, actor: " ", now }), /authenticated reviewer/);
});
