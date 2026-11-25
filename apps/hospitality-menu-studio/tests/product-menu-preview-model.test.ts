import assert from "node:assert/strict";
import test from "node:test";
import { initialProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";
import { previewChoices, previewScopeMatches } from "../components/product-menu-preview-model";

test("preview week follows UK calendar dates through DST and repeating cycles", () => {
  const configuration = initialProductMenuConfiguration({ kind: "rotation", anchorMonday: "2026-03-23", cycleWeeks: 3 });
  const week = (date: string) => { const result = previewChoices(configuration, date); return result && "week" in result ? result.week : undefined; };
  assert.equal(week("2026-03-29"), 1);
  assert.equal(week("2026-03-30"), 2);
  assert.equal(week("2026-04-13"), 1);
  assert.equal(previewChoices(configuration, "2026-02-30"), undefined);
});

test("preview scope rejects stale or non-draft responses", () => {
  const scope = { itemId: "item", siteId: "site", eventDate: "2026-11-25", draftOnly: true };
  assert.equal(previewScopeMatches(scope, "item", "site", "2026-11-25"), true);
  assert.equal(previewScopeMatches(scope, "item", "other", "2026-11-25"), false);
  assert.equal(previewScopeMatches({ ...scope, draftOnly: false }, "item", "site", "2026-11-25"), false);
});
