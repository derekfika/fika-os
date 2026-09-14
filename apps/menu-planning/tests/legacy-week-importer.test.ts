import assert from "node:assert/strict";
import test from "node:test";
import { applyDishResolutions, parseWorkbookWeekCommencing, repairArchivedWeekDishIdentities, resolveDishNames, safeDishKey } from "../lib/legacy-week-importer";
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

test("explicitly created canonical dishes resolve immediately and remain aliasable", () => {
  const catalogue = [dish("dish:new", "New Source Dish")];
  const snapshot = { week: { id: "rolling-week:2026-08-31", weekCommencing: "2026-08-31", weekEnding: "2026-09-06", status: "draft" as const, version: 1, dayIds: ["day:1"], entryIds: ["entry:1"], sourceFiles: ["WC 31_08_2026.xlsx"], audit: [] }, days: [{ id: "day:1", date: "2026-08-31", dayName: "Monday", entryIds: ["entry:1"] }], entries: [{ id: "entry:1", dayId: "day:1", date: "2026-08-31", slot: "SALAD 1", itemLabel: "New Source Dish", portions: 0, allocations: [], allergens: {}, source: { workbook: "WC 31_08_2026.xlsx", sheet: "Monday", range: "A4" }, audit: [] }] };
  const result = applyDishResolutions(snapshot, [{ sourceName: "New Source Dish", canonicalId: "dish:new", remember: true }], catalogue);
  assert.equal(result.entries[0].itemId, "dish:new");
  assert.equal(result.entries[0].itemLabel, "New Source Dish");
  assert.equal(catalogue.length, 1);
});

test("archived catalogue records cannot be resolved or committed for new imports", () => {
  const archived = dish("dish:old", "Old Potato Salad"); archived.reviewStatus = "archived";
  const active = dish("dish:new", "New Potato Salad", ["Old Potato Salad"]);
  assert.equal(resolveDishNames(["Old Potato Salad"], [archived, active])[0].canonicalId, "dish:new");
  const snapshot = { week: { id: "rolling-week:2026-08-31", weekCommencing: "2026-08-31", weekEnding: "2026-09-06", status: "draft" as const, version: 1, dayIds: ["day:1"], entryIds: ["entry:1"], sourceFiles: [], audit: [] }, days: [{ id: "day:1", date: "2026-08-31", dayName: "Monday", entryIds: ["entry:1"] }], entries: [{ id: "entry:1", dayId: "day:1", date: "2026-08-31", slot: "SALAD 1", itemLabel: "Old Potato Salad", itemId: "dish:old", portions: 1, allocations: [], allergens: {}, audit: [] }] };
  assert.throws(() => applyDishResolutions(snapshot, [{ sourceName: "Old Potato Salad", canonicalId: "dish:old" }], [archived, active]), /active Dish Library/);
  const report = repairArchivedWeekDishIdentities(snapshot, [archived, active]);
  assert.equal(report.repaired.length, 1);
  assert.equal(snapshot.entries[0].itemId, "dish:old", "dry-run report must not mutate the source snapshot");
  assert.equal(report.snapshot.entries[0].itemId, "dish:new");
});

test("one-week repair reports active, missing, no-id and ambiguous identities without fuzzy matching", () => {
  const active = dish("dish:active", "Jerk Marinated Chicken Thigh", ["Chicken Jerk"]);
  const alias = dish("dish:alias", "House Slaw", ["Old Slaw"]);
  const duplicate = dish("dish:duplicate", "Ambiguous Dish", ["Legacy Ambiguous"]);
  const duplicate2 = dish("dish:duplicate-2", "Another Dish", ["Legacy Ambiguous"]);
  const archived = dish("dish:archived", "Old Dish"); archived.reviewStatus = "archived";
  const snapshot = { week: { id: "rolling-week:2026-09-14", weekCommencing: "2026-09-14", weekEnding: "2026-09-20", status: "draft" as const, version: 4, dayIds: ["day:1"], entryIds: ["active", "missing", "alias", "none", "ambiguous", "blocked"], sourceFiles: [], audit: [] }, days: [{ id: "day:1", date: "2026-09-14", dayName: "Monday", entryIds: ["active", "missing", "alias", "none", "ambiguous", "blocked"] }], entries: [
    { id: "active", dayId: "day:1", date: "2026-09-14", slot: "SALAD 1", itemLabel: active.displayName, itemId: active.canonicalId, portions: 2, allocations: [{ destinationLabel: "Site", quantity: 2 }], allergens: {}, audit: [] },
    { id: "missing", dayId: "day:1", date: "2026-09-14", slot: "SALAD 1", itemLabel: active.displayName, itemId: "dish:missing", portions: 3, allocations: [{ destinationLabel: "Site", quantity: 3 }], allergens: {}, audit: [] },
    { id: "alias", dayId: "day:1", date: "2026-09-14", slot: "SALAD 1", itemLabel: "Old Slaw", itemId: "dish:missing-alias", portions: 4, allocations: [{ destinationLabel: "Site", quantity: 4 }], allergens: {}, audit: [] },
    { id: "none", dayId: "day:1", date: "2026-09-14", slot: "SALAD 1", itemLabel: active.displayName, portions: 5, allocations: [{ destinationLabel: "Site", quantity: 5 }], allergens: {}, audit: [] },
    { id: "ambiguous", dayId: "day:1", date: "2026-09-14", slot: "SALAD 1", itemLabel: "Legacy Ambiguous", itemId: "dish:missing-ambiguous", portions: 6, allocations: [{ destinationLabel: "Site", quantity: 6 }], allergens: {}, audit: [] },
    { id: "blocked", dayId: "day:1", date: "2026-09-14", slot: "SALAD 1", itemLabel: "Unknown Dish", itemId: "dish:missing-unknown", portions: 7, allocations: [{ destinationLabel: "Site", quantity: 7 }], allergens: {}, audit: [] },
  ] };
  const before = structuredClone(snapshot.entries);
  const report = repairArchivedWeekDishIdentities(snapshot, [active, alias, duplicate, duplicate2, archived]);
  assert.deepEqual(report.activeUnchanged, ["active"]);
  assert.deepEqual(report.repaired.map(item => [item.entryId, item.reason]), [["missing", "missing-to-active"], ["alias", "missing-to-active"], ["none", "no-id-to-active"]]);
  assert.equal(report.blocked.find(item => item.entryId === "ambiguous")?.classification, "ambiguous");
  assert.equal(report.blocked.find(item => item.entryId === "blocked")?.classification, "missing-unresolved");
  assert.equal(report.repaired.length + report.blocked.length, 5);
  assert.deepEqual(snapshot.entries, before, "dry-run must not mutate any entry state");
  assert.equal(report.snapshot.entries.find(item => item.id === "missing")?.itemId, active.canonicalId);
  assert.equal(report.snapshot.entries.find(item => item.id === "missing")?.portions, 3);
  assert.equal(report.snapshot.entries.find(item => item.id === "missing")?.allocations[0].quantity, 3);
});
