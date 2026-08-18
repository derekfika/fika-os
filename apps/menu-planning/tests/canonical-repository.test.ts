import test from "node:test";
import assert from "node:assert/strict";
import { canonicalFromSourceCandidate } from "../lib/canonical-menu-repository";
import type { MenuItem } from "../lib/domain";

const candidate = { canonicalId: "menu-item:source-1", sourceName: "Brian workbook", displayName: "Test dish", description: "Evidence", preparationDescription: "", category: "Salad", subcategory: "Salad 1", ingredients: [], methodSteps: [], yieldDescription: "10 portions", weekId: "source-week", dayId: "monday", sourceReference: { workbook: "Brian.xlsx", sheet: "Menu", range: "A1" }, revision: 1, reviewStatus: "unreviewed", recipeStatus: "draft", allergenEvidence: [], mayContainReviewed: false, audit: [] } as MenuItem;

test("source promotion preserves evidence and never auto-approves", () => {
  const item = canonicalFromSourceCandidate(candidate, "tester", "2026-01-01T00:00:00.000Z");
  assert.equal(item.reviewStatus, "unreviewed");
  assert.equal(item.recipeStatus, "draft");
  assert.equal(item.sourceReference.workbook, "Brian.xlsx");
  assert.equal(item.audit.at(-1)?.action, "menu-item-promoted-from-source-candidate");
});
