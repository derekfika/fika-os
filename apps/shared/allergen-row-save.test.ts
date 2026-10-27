import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRowSave, canSignAllergenDay, coalesceRowEdits, rowRevision, type StoredAllergenRow } from "./allergen-row-save";
import { confirmRow, isRowConfirmed } from "./allergen-review";
import { enforceNoKeyExclusivity, normaliseOperationalAllergens } from "./allergen-contract";
import { confirmRowExplicit, rowReviewStatus } from "./allergen-declaration";

const base: StoredAllergenRow = { rowId: "r1", identity: "Hot lunch", allergens: { milk: "contains" } };
const edit = (expected: string, id: string, allergens: Record<string, unknown> = { milk: "contains", eggs: "may_contain" }) => ({ rowId: "r1", clientRequestId: id, expectedRowRevision: expected, next: { identity: "Hot lunch", allergens } });

test("a row save with the current revision applies and moves the revision", () => {
  const result = applyRowSave(base, edit(rowRevision(base), "a"));
  if (!result.ok) assert.fail("expected success");
  assert.equal(result.replay, false);
  assert.notEqual(result.revision, rowRevision(base));
});

test("a stale revision conflicts and returns the current row without overwriting it", () => {
  const first = applyRowSave(base, edit(rowRevision(base), "a"));
  if (!first.ok) assert.fail("expected success");
  const second = applyRowSave(first.row, edit(rowRevision(base), "b", { milk: "clear" }));
  if (second.ok || second.reason !== "conflict") assert.fail("expected a conflict");
  assert.deepEqual(second.current.allergens, { milk: "contains", eggs: "may_contain" });
});

test("a retried request is an idempotent replay, not a second write", () => {
  const first = applyRowSave(base, edit(rowRevision(base), "a"));
  if (!first.ok) assert.fail("expected success");
  const retry = applyRowSave(first.row, edit(rowRevision(base), "a"));
  if (!retry.ok) assert.fail("expected success");
  assert.equal(retry.replay, true);
  assert.equal(retry.revision, first.revision);
});

test("a new row uses the revision 'new'; an unnamed row is refused", () => {
  assert.equal(applyRowSave(undefined, edit("new", "a")).ok, true);
  assert.equal(applyRowSave(undefined, { ...edit("new", "a"), next: { identity: " ", allergens: {} } }).ok, false);
});

test("edits to different rows never conflict with each other", () => {
  const other: StoredAllergenRow = { rowId: "r2", identity: "Cold lunch", allergens: {} };
  assert.equal(applyRowSave(base, edit(rowRevision(base), "a")).ok, true);
  assert.equal(applyRowSave(other, { rowId: "r2", clientRequestId: "c", expectedRowRevision: rowRevision(other), next: { identity: "Cold lunch", allergens: { fish: "contains" } } }).ok, true);
});

test("rapid edits to one row coalesce to the newest and keep cross-row order", () => {
  const out = coalesceRowEdits([{ rowId: "a", v: 1 }, { rowId: "b", v: 1 }, { rowId: "a", v: 2 }, { rowId: "a", v: 3 }]);
  assert.deepEqual(out, [{ rowId: "b", v: 1 }, { rowId: "a", v: 3 }]);
});

test("signing is blocked while any row is saving or failed", () => {
  assert.equal(canSignAllergenDay(["saved", "unchecked"]), true);
  assert.equal(canSignAllergenDay(["saved", "saving"]), false);
  assert.equal(canSignAllergenDay(["failed"]), false);
});

test("saving an explicit-confirmed row preserves its review, so the check survives the round trip", () => {
  const confirmed = confirmRowExplicit({ allergens: { no_key_allergens: "contains" }, identity: "Hot lunch", actor: "Chef Sam", now: "2026-10-27T09:00:00.000Z" });
  const saved = applyRowSave(undefined, { rowId: "r1", clientRequestId: "x", expectedRowRevision: "new", next: { identity: "Hot lunch", allergens: confirmed.allergens, review: confirmed.review } });
  if (!saved.ok) assert.fail("expected success");
  assert.equal(rowReviewStatus({ allergens: saved.row.allergens, review: saved.row.review, identity: "Hot lunch" }), "checked");
});

// Compatibility: the new modules must not change what legacy consumers compute from legacy records.
test("compatibility: legacy semantics-2 confirmation and normalisation are unchanged by the new modules", () => {
  const legacy = confirmRow({ allergens: { milk: "contains" }, identity: "Hot lunch", actor: "Chef Sam", now: "2026-10-26T09:00:00.000Z" });
  assert.equal(isRowConfirmed({ allergens: legacy.allergens, review: legacy.review, identity: "Hot lunch" }), true);
  assert.equal(legacy.review.semantics, 2);
  assert.equal(enforceNoKeyExclusivity({ milk: "contains", no_key_allergens: "contains" }).no_key_allergens, "clear");
  assert.equal(typeof normaliseOperationalAllergens({ milk: "clear" }).no_key_allergens, "string", "legacy normalisation still derives No Key");
});
