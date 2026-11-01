import assert from "node:assert/strict";
import test from "node:test";
import { applyHospitalityCellClick } from "../app/ui/allergen-cell-state";
import { confirmAllergenReviewMap } from "../app/lib/allergen-review-state";
import { stampAllergenReviews } from "../app/lib/allergen-review-stamp";
import { allergenMatrixContentHash } from "../lib/cpu-allergen-release";
import type { PlannedMenuItem, PlannedSubItem } from "../app/lib/production-plan";
import { isExplicitRowConfirmed } from "../../shared/allergen-declaration";
import { rowAttestation, isRowVerified } from "../app/lib/allergen-explicit";
const isRowConfirmed = (row: { allergens: Record<string, unknown> | undefined; review?: unknown; identity: string }) => isExplicitRowConfirmed(row as Parameters<typeof isExplicitRowConfirmed>[0]);

const sub = (extra: Partial<PlannedSubItem> = {}): PlannedSubItem => ({ id: "s1", name: "Leek soup", quantity: 4, allergens: { milk: "contains" }, note: "", evidenceStatus: "not_completed", ...extra });
const item = (...subItems: PlannedSubItem[]): PlannedMenuItem => ({ id: "m1", sourceLineId: "line:1", name: "Soup", note: "", subItems });
const at = "2026-10-24T11:00:00.000Z";
const confirmed = (extra: Partial<PlannedSubItem> = {}) => sub({ allergens: confirmAllergenReviewMap({ milk: "contains" }).states, evidenceStatus: "completed", ...extra });

test("completing a row stamps the reviewer and time server-side", () => {
  const [stamped] = stampAllergenReviews([item(sub())], [item(confirmed())], "Chef A", at)[0].subItems;
  assert.equal(stamped.allergenReview?.confirmedBy, "Chef A");
  assert.equal(stamped.allergenReview?.confirmedAt, at);
  assert.ok(isRowConfirmed({ allergens: stamped.allergens, review: stamped.allergenReview, identity: stamped.name }));
});

test("a client-supplied confirmation record is discarded", () => {
  const forged = { status: "confirmed", semantics: 3, confirmedBy: "Someone else", confirmedAt: "2020-01-01T00:00:00.000Z", statement: "recipe-ingredients-allergens-verified", inputFingerprint: "x" } as never;
  const [row] = stampAllergenReviews([item(sub())], [item(sub({ allergenReview: forged }))], "Chef A", at)[0].subItems;
  assert.equal(row.allergenReview, undefined, "an uncompleted row carries no confirmation");
  const [done] = stampAllergenReviews([item(sub())], [item(confirmed({ allergenReview: forged }))], "Chef A", at)[0].subItems;
  assert.equal(done.allergenReview?.confirmedBy, "Chef A");
});

test("an unchanged re-save keeps the original reviewer and time", () => {
  const first = stampAllergenReviews([item(sub())], [item(confirmed())], "Chef A", at);
  const again = stampAllergenReviews(first, [item(confirmed())], "Chef B", "2026-10-24T12:00:00.000Z");
  assert.equal(again[0].subItems[0].allergenReview?.confirmedBy, "Chef A");
  assert.equal(again[0].subItems[0].allergenReview?.confirmedAt, at);
});

test("editing then re-confirming a row stamps a new reviewer; an edited, unconfirmed row carries none", () => {
  const first = stampAllergenReviews([item(sub())], [item(confirmed())], "Chef A", at);
  const edited = applyHospitalityCellClick(first[0].subItems[0].allergens, "eggs");
  const unconfirmed = stampAllergenReviews(first, [item(sub({ allergens: edited }))], "Chef B", at);
  assert.equal(unconfirmed[0].subItems[0].allergenReview, undefined);
  assert.equal(unconfirmed[0].subItems[0].allergens.sesame, undefined, "derived Clears reverted");
  const reconfirmed = stampAllergenReviews(first, [item(sub({ allergens: confirmAllergenReviewMap(edited).states, evidenceStatus: "completed" }))], "Chef B", "2026-10-24T12:00:00.000Z");
  assert.equal(reconfirmed[0].subItems[0].allergenReview?.confirmedBy, "Chef B");
});

test("legacy completed rows without a record stay unstamped while unchanged", () => {
  const legacy = [item(confirmed())];
  const kept = stampAllergenReviews(legacy, [item(confirmed())], "Chef A", at);
  assert.equal(kept[0].subItems[0].allergenReview, undefined);
});

test("signed-release safeguards: confirmation metadata never changes the matrix hash, but a material edit does", () => {
  const plain = [item(confirmed())];
  const stamped = stampAllergenReviews([item(sub())], plain, "Chef A", at);
  assert.equal(allergenMatrixContentHash(stamped), allergenMatrixContentHash(plain), "stamping a row cannot invalidate or alter signed evidence");
  const edited = [item(sub({ allergens: applyHospitalityCellClick(stamped[0].subItems[0].allergens, "eggs"), evidenceStatus: "not_completed" }))];
  assert.notEqual(allergenMatrixContentHash(edited), allergenMatrixContentHash(stamped), "an edit changes the signed hash, which makes the release authority mismatch and revoke");
});

test("row badge is text-first: Not reviewed, Checked (legacy), Checked, not yet saved, and Checked by <reviewer>", async () => {
  const { rowReviewBadge } = await import("../app/ui/allergen-cell-state");
  const complete = confirmAllergenReviewMap({ milk: "contains" }).states;
  assert.equal(rowReviewBadge({ evidenceStatus: "not_completed", allergens: complete }).text, "Not reviewed");
  assert.equal(rowReviewBadge({ evidenceStatus: "completed", allergens: { milk: "contains" } }).text, "Not reviewed", "a completed flag over an incomplete map is never shown as checked");
  assert.equal(rowReviewBadge({ evidenceStatus: "completed", allergens: complete }).text, "Checked (legacy)");
  assert.equal(rowReviewBadge({ evidenceStatus: "completed", allergens: complete }, true).text, "Checked, not yet saved");
  const stamped = rowReviewBadge({ evidenceStatus: "completed", allergens: complete, allergenReview: { confirmedBy: "Chef A", confirmedAt: "2026-10-24T11:00:00.000Z" } });
  assert.equal(stamped.tone, "checked");
  assert.match(stamped.text, /^Checked by Chef A, 24 Oct, 12:00$/, "shown in Europe/London time (BST)");
});

test("an unnamed sub-item is identified by its menu item name and is stamped", () => {
  const unnamed = (extra: Partial<PlannedSubItem> = {}) => item(confirmed({ name: "", ...extra }));
  const [row] = stampAllergenReviews([item(sub({ name: "" }))], [unnamed()], "Chef A", at)[0].subItems;
  assert.equal(row.allergenReview?.confirmedBy, "Chef A");
  assert.ok(isRowConfirmed({ allergens: row.allergens, review: row.allergenReview, identity: "Soup" }));
  const again = stampAllergenReviews([item(row)], [unnamed()], "Chef B", "2026-10-24T12:00:00.000Z")[0].subItems[0];
  assert.equal(again.allergenReview?.confirmedBy, "Chef A", "an unchanged unnamed row keeps its stamp");
});

const noKey = (extra: Partial<PlannedSubItem> = {}) => sub({ allergens: { no_key_allergens: "contains" }, noKeyDeclaration: { declared: true, declaredBy: "Forged", declaredAt: "2020-01-01T00:00:00.000Z" }, ...extra });

test("a deliberate No Key tick is stamped with the authenticated actor and time, never the client's", () => {
  const [row] = stampAllergenReviews([item(sub())], [item(noKey())], "Chef A", at)[0].subItems;
  assert.equal(row.noKeyDeclaration?.declaredBy, "Chef A");
  assert.equal(row.noKeyDeclaration?.declaredAt, at);
  assert.equal(row.allergens.no_key_allergens, "contains");
  assert.equal(rowAttestation(row), "declared");
});

test("a blank row sent as completed is demoted: no Clear values, not completed, not verified", () => {
  const fakeComplete = sub({ allergens: confirmAllergenReviewMap({}).states, evidenceStatus: "completed" });
  const [row] = stampAllergenReviews([item(sub({ allergens: {} }))], [item(fakeComplete)], "Chef A", at)[0].subItems;
  assert.equal(row.evidenceStatus, "not_completed");
  assert.deepEqual(row.allergens, {});
  assert.equal(row.allergenReview, undefined);
  assert.equal(isRowVerified(row as never), false);
});

test("a bare no_key_allergens value without the tick intent is never a declaration", () => {
  const [row] = stampAllergenReviews([item(sub())], [item(sub({ allergens: { no_key_allergens: "contains" }, evidenceStatus: "completed" }))], "Chef A", at)[0].subItems;
  assert.equal(row.noKeyDeclaration, undefined);
  assert.equal(row.evidenceStatus, "not_completed");
  assert.equal(isRowVerified(row as never), false);
});

test("a completed No Key row gets a semantics-3 review; named allergens beat a No Key flag", () => {
  const [done] = stampAllergenReviews([item(sub())], [item(noKey({ evidenceStatus: "completed" }))], "Chef A", at)[0].subItems;
  assert.equal(done.allergenReview?.confirmedBy, "Chef A");
  assert.ok(isRowVerified(done as never));
  const [mixed] = stampAllergenReviews([item(sub())], [item(noKey({ allergens: { no_key_allergens: "contains", milk: "contains" } }))], "Chef A", at)[0].subItems;
  assert.equal(mixed.noKeyDeclaration, undefined, "selecting an allergen withdraws No Key");
  assert.equal(mixed.allergens.milk, "contains", "recorded CONTAINS is preserved");
  assert.notEqual(mixed.allergens.no_key_allergens, "contains");
});

test("legacy derived No Key row echoed unchanged is preserved verbatim and stays unverified", () => {
  const legacyAllergens = { ...confirmAllergenReviewMap({}).states, ...Object.fromEntries(["peanuts", "milk", "gluten"].map(k => [k, "clear"])), no_key_allergens: "contains" } as unknown as Record<string, never>;
  const legacy = sub({ allergens: legacyAllergens, evidenceStatus: "completed" });
  const [kept] = stampAllergenReviews([item(legacy)], [item(legacy)], "Chef A", at)[0].subItems;
  assert.deepEqual(kept.allergens, legacyAllergens);
  assert.equal(kept.noKeyDeclaration, undefined, "not auto-attested");
  assert.equal(rowAttestation(kept as never), "legacy_unverified");
  assert.equal(isRowVerified(kept as never), false);
});

test("save/reopen round trip keeps a declared row and its stamp across JSON", () => {
  const saved = stampAllergenReviews([item(sub())], [item(noKey({ evidenceStatus: "completed" }))], "Chef A", at);
  const reopened = JSON.parse(JSON.stringify(saved)) as typeof saved;
  const again = stampAllergenReviews(reopened, reopened, "Chef B", "2026-10-24T12:00:00.000Z")[0].subItems[0];
  assert.equal(again.noKeyDeclaration?.declaredBy, "Chef A");
  assert.equal(again.allergenReview?.confirmedBy, "Chef A");
  assert.ok(isRowVerified(again as never));
});

test("editing a checked No Key row to an allergen invalidates the old confirmation", () => {
  const first = stampAllergenReviews([item(sub())], [item(noKey({ evidenceStatus: "completed" }))], "Chef A", at);
  const edited = stampAllergenReviews(first, [item(sub({ allergens: { eggs: "contains" } }))], "Chef B", at)[0].subItems[0];
  assert.equal(edited.allergenReview, undefined);
  assert.equal(edited.noKeyDeclaration, undefined);
});
