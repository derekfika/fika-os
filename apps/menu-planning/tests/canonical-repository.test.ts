import test from "node:test";
import assert from "node:assert/strict";
import { amendCanonicalMenuItemRecord, canonicalFromSourceCandidate } from "../lib/canonical-menu-repository";
import type { MenuItem } from "../lib/domain";

const candidate = { canonicalId: "menu-item:source-1", sourceName: "Brian workbook", displayName: "Test dish", description: "Evidence", preparationDescription: "", category: "Salad", subcategory: "Salad 1", ingredients: [], methodSteps: [], yieldDescription: "10 portions", weekId: "source-week", dayId: "monday", sourceReference: { workbook: "Brian.xlsx", sheet: "Menu", range: "A1" }, revision: 1, reviewStatus: "unreviewed", recipeStatus: "draft", allergenEvidence: [], mayContainReviewed: false, audit: [] } as MenuItem;

test("source promotion preserves evidence and never auto-approves", () => {
  const item = canonicalFromSourceCandidate(candidate, "tester", "2026-01-01T00:00:00.000Z");
  assert.equal(item.reviewStatus, "unreviewed");
  assert.equal(item.recipeStatus, "draft");
  assert.equal(item.sourceReference.workbook, "Brian.xlsx");
  assert.equal(item.audit.at(-1)?.action, "menu-item-promoted-from-source-candidate");
});

test("hosted dish amendment keeps stable identity and existing allergen evidence", () => {
  const original = { ...candidate, canonicalId: "dish:stable", displayName: "Old name", sourceName: "Old name", category: "Fish", revision: 4, allergenEvidence: [{ allergen: "fish", value: "contains" as const, source: "review", reviewedBy: "reviewer", reviewedAt: "2026-01-01T00:00:00.000Z" }], mayContainReviewed: true, audit: [] };
  const amended = amendCanonicalMenuItemRecord(original, [original], { displayName: "Corrected name", category: "Fish", description: "Updated description", ingredients: [{ name: "Cod", quantity: 2, unit: "kg" }], methodSteps: ["Bake gently"] }, "staff:42", "2026-10-21T12:00:00.000Z");
  assert.equal(amended.canonicalId, "dish:stable");
  assert.equal(amended.displayName, "Corrected Name");
  assert.equal(amended.category, "Fish");
  assert.equal(amended.revision, 5);
  assert.deepEqual(amended.allergenEvidence, original.allergenEvidence);
  assert.deepEqual(amended.ingredients, [{ name: "Cod", quantity: 2, unit: "kg" }]);
  assert.deepEqual(amended.methodSteps, ["Bake gently"]);
  assert.equal(amended.audit.at(-1)?.by, "staff:42");
});

test("dish amendment rejects ungoverned categories and duplicate active names", () => {
  const first = { ...candidate, canonicalId: "dish:first", displayName: "First dish", sourceName: "First dish", audit: [] };
  const second = { ...candidate, canonicalId: "dish:second", displayName: "Second dish", sourceName: "Second dish", audit: [] };
  assert.throws(() => amendCanonicalMenuItemRecord(first, [first], { displayName: "First dish", category: "Side" }, "staff:42"), error => (error as { status?: number }).status === 422);
  assert.throws(() => amendCanonicalMenuItemRecord(first, [first], { displayName: "First dish", category: "Salad", ingredients: [{ name: "   " }] }, "staff:42"), error => (error as { status?: number }).status === 422);
  assert.throws(() => amendCanonicalMenuItemRecord(first, [first, second], { displayName: "Second dish", category: "Salad" }, "staff:42"), error => (error as { status?: number }).status === 409);
});
