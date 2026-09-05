import assert from "node:assert/strict";
import test from "node:test";
import { applyDishResolutions, parseWorkbookWeekCommencing, resolveDishNames, safeDishKey } from "../lib/legacy-week-importer";
import type { MenuItem } from "../lib/domain";

const dish = (id: string, name: string, sourceAliases?: string[]): MenuItem => ({ canonicalId: id, sourceName: name, displayName: name, sourceAliases, category: "salad", weekId: "catalogue", dayId: "", sourceReference: { workbook: "catalogue", sheet: "dishes" }, revision: 1, reviewStatus: "approved", allergenEvidence: [], mayContainReviewed: true, audit: [] });

test("safe dish matching resolves exact, aliases and normalised names without creating dishes", () => {
  const catalogue = [dish("dish:potato", "New Potato Salad with Herb Vinaigrette", ["new potato salad"]), dish("dish:carrot", "Roasted Heritage Carrots")];
  const resolutions = resolveDishNames(["new potato salad", " ROASTED   HERITAGE-CARROTS ", "Unknown dish", "Unknown dish"], catalogue);
  assert.equal(resolutions.find(item => item.sourceName === "new potato salad")?.canonicalId, "dish:potato");
  assert.equal(resolutions.find(item => item.sourceName.includes("ROASTED"))?.canonicalId, "dish:carrot");
  assert.equal(resolutions.find(item => item.sourceName === "Unknown dish")?.occurrences, 2);
  assert.equal(catalogue.length, 2);
  assert.equal(safeDishKey("Roast Carrot, Edamame & Sesame"), safeDishKey("roast carrot edamame and sesame"));
});

test("fuzzy suggestions are never automatic and unresolved names block commit", () => {
  const catalogue = [dish("dish:potato", "New Potato Salad with Herb Vinaigrette")];
  const resolution = resolveDishNames(["New Potato Salad with Herb Vinaigrette-ish"], catalogue)[0];
  assert.ok(resolution.suggestions.length || resolution.kind === "unresolved");
  assert.equal(resolution.canonicalId, undefined);
});

test("workbook filenames support common dates and normalise to Monday", () => {
  assert.equal(parseWorkbookWeekCommencing("WC 31_08_2026.xlsx"), "2026-08-31");
  assert.equal(parseWorkbookWeekCommencing("WC 11.05.26 (1).xlsx"), "2026-05-11");
  assert.equal(parseWorkbookWeekCommencing("weekly-menu.xlsx"), undefined);
});

test("manual resolution applies stable canonical identity and cannot increase catalogue count", () => {
  const snapshot = { week: { id: "rolling-week:2026-08-31", weekCommencing: "2026-08-31", weekEnding: "2026-09-06", status: "draft" as const, version: 1, dayIds: ["day:1"], entryIds: ["entry:1"], sourceFiles: ["WC 31_08_2026.xlsx"], audit: [] }, days: [{ id: "day:1", date: "2026-08-31", dayName: "Monday", entryIds: ["entry:1"] }], entries: [{ id: "entry:1", dayId: "day:1", date: "2026-08-31", slot: "SALAD 1", itemLabel: "Old potato salad", portions: 1, allocations: [], allergens: {}, audit: [] }] };
  const catalogue = [dish("dish:potato", "New Potato Salad with Herb Vinaigrette")];
  const before = catalogue.length;
  const result = applyDishResolutions(snapshot, [{ sourceName: "Old potato salad", canonicalId: "dish:potato" }], catalogue);
  assert.equal(result.entries[0].itemId, "dish:potato");
  assert.equal(result.entries[0].itemLabel, "New Potato Salad with Herb Vinaigrette");
  assert.equal(catalogue.length, before);
  assert.equal(safeDishKey(result.entries[0].itemLabel), safeDishKey(catalogue[0].displayName));
});
