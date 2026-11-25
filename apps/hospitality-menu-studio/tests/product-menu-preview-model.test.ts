import assert from "node:assert/strict";
import test from "node:test";
import { initialProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";
import { evaluatePreviewSelection, previewChoices, previewDateForWeek, previewScopeMatches } from "../components/product-menu-preview-model";

test("preview week follows UK calendar dates through DST and repeating cycles", () => {
  const configuration = initialProductMenuConfiguration({ kind: "rotation", anchorMonday: "2026-03-23", cycleWeeks: 3 });
  const week = (date: string) => { const result = previewChoices(configuration, date); return result && "week" in result ? result.week : undefined; };
  assert.equal(week("2026-03-29"), 1);
  assert.equal(week("2026-03-30"), 2);
  assert.equal(week("2026-04-13"), 1);
  assert.equal(previewChoices(configuration, "2026-02-30"), undefined);
  assert.equal(previewDateForWeek(configuration, "2026-03-29", 1), "2026-04-05");
  assert.equal(previewDateForWeek(configuration, "2026-04-05", 0), "2026-03-29");
  assert.equal(previewDateForWeek(configuration, "2026-04-05", 3), undefined);
});

test("preview applies allocation, guest and unit minima before estimating the net total", () => {
  const base: Parameters<typeof evaluatePreviewSelection>[0] = { dishIds: ["a", "b"], presentation: "dropdown", quantities: { a: 4 }, minimumDish: 2, minimumTotal: 4, minimumGuests: 3, guests: "3", unitPrice: 3.95, supported: true };
  assert.deepEqual(evaluatePreviewSelection(base), { totalQuantity: 4, validSelection: true, validGuests: true, valid: true, netTotal: 15.8 });
  const cases: Array<Partial<typeof base>> = [{ guests: "2" }, { quantities: { a: 1 } }, { quantities: { a: 2, b: 2 } }, { quantities: { x: 4 } }, { supported: false }];
  for (const patch of cases) assert.equal(evaluatePreviewSelection({ ...base, ...patch }).netTotal, undefined);
});

test("preview scope rejects stale or non-draft responses", () => {
  const scope = { itemId: "item", siteId: "site", eventDate: "2026-11-25", draftOnly: true };
  assert.equal(previewScopeMatches(scope, "item", "site", "2026-11-25"), true);
  assert.equal(previewScopeMatches(scope, "item", "other", "2026-11-25"), false);
  assert.equal(previewScopeMatches({ ...scope, draftOnly: false }, "item", "site", "2026-11-25"), false);
});
