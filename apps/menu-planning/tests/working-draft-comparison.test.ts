import assert from "node:assert/strict";
import test from "node:test";
import { buildPublishedDay, compareWorkingWeekToPublication, type MenuPublication } from "../lib/menu-publication";
import type { MenuItem } from "../lib/domain";
import type { RollingDay, RollingEntry, RollingSnapshot } from "../lib/rolling-menu-types";

const date = "2026-11-02";
const day: RollingDay = { id: "week:day:monday", date, dayName: "Monday", entryIds: [] };
const dishes = ["dish:salad", "dish:soup", "dish:main"].map(canonicalId => ({ canonicalId, displayName: canonicalId, sourceName: canonicalId, category: "Menu", weekId: "week", dayId: day.id, sourceReference: { workbook: "test", sheet: "test" }, revision: 1, reviewStatus: "approved", allergenEvidence: [{ allergen: "nuts", value: "contains", source: "test" }], mayContainReviewed: true, audit: [] })) as MenuItem[];
function entry(id: string, dishId: string, slot: string, allocations: Array<[string, number]>, dishName = dishId): RollingEntry {
  return { id, dayId: day.id, date, slot, itemId: dishId, itemLabel: dishName, portions: allocations.reduce((sum, [, quantity]) => sum + quantity, 0), allocations: allocations.map(([destinationId, quantity]) => ({ destinationId, destinationLabel: destinationId.replace("oploc:", "Site "), quantity })), allergens: {}, audit: [] };
}
function snapshot(entries: RollingEntry[]): RollingSnapshot {
  const currentDay = { ...day, entryIds: entries.map(value => value.id) };
  return { week: { id: "week", weekCommencing: date, weekEnding: "2026-11-08", status: "published", version: 9, dayIds: [day.id], entryIds: entries.map(value => value.id), sourceFiles: [], audit: [] }, days: [currentDay], entries };
}
function publicationFor(entries: RollingEntry[]): MenuPublication {
  const source = snapshot(entries);
  const preview = buildPublishedDay(source, source.days[0], dishes);
  return { publicationId: "publication:week", sourceWeekId: "week", weekCommencing: date, weekEnding: "2026-11-08", publicationVersion: 4, days: [{ publicationDayId: "publication:week:day:monday:v3", sourceDayId: day.id, date, dayName: "Monday", version: 3, status: "published", contentHash: preview.contentHash, publishedAt: "2026-11-01T12:00:00.000Z", publishedBy: "test", entries: preview.entries }], audit: [] };
}
function compare(baseline: RollingEntry[], working: RollingEntry[]) {
  return compareWorkingWeekToPublication(snapshot(working), publicationFor(baseline), [], dishes).changeSet;
}

test("unchanged published demand has no operations and retains source lineage", () => {
  const baseline = [entry("entry:salad", "dish:salad", "SALAD 1", [["oploc:a", 12], ["oploc:b", 8]])];
  const changeSet = compare(baseline, structuredClone(baseline));
  assert.deepEqual(changeSet.operations, []);
  assert.equal(changeSet.publicationId, "publication:week");
  assert.equal(changeSet.publicationVersion, 4);
  assert.equal(changeSet.sourceWeekVersion, 9);
  assert.deepEqual(changeSet.days.map(value => [value.publicationDayId, value.publicationDayVersion]), [["publication:week:day:monday:v3", 3]]);
});

test("portion increases and decreases are scoped to day, site and stable dish", () => {
  const baseline = [entry("entry:soup", "dish:soup", "SOUP", [["oploc:a", 10], ["oploc:b", 6]])];
  const working = [entry("entry:soup", "dish:soup", "SOUP", [["oploc:a", 14], ["oploc:b", 2]])];
  const changes = compare(baseline, working).operations;
  assert.deepEqual(changes.map(value => [value.kind, value.siteId, value.before?.quantity, value.after?.quantity]), [
    ["quantity_changed", "governed:oploc:a", 10, 14],
    ["quantity_changed", "governed:oploc:b", 6, 2],
  ]);
  assert.equal(changes[0].after?.entries[0].canonicalDishId, "dish:soup");
  assert.equal(changes[0].after?.entries[0].allergens.no_key_allergens, "contains");
  assert.equal(changes[0].after?.entries[0].allergenEvidenceStatus, "confirmed");
});

test("a same-cell dish substitution is represented as one replacement with both evidence snapshots", () => {
  const baseline = [entry("entry:main", "dish:main", "HOT MEAT", [["oploc:a", 20]])];
  const working = [entry("entry:main", "dish:soup", "HOT MEAT", [["oploc:a", 20]])];
  const [change] = compare(baseline, working).operations;
  assert.equal(change.kind, "replaced");
  assert.equal(change.before?.dishId, "dish:main");
  assert.equal(change.after?.dishId, "dish:soup");
  assert.equal(change.before?.entries[0].sourceEntryId, "entry:main");
  assert.equal(change.after?.entries[0].sourceEntryId, "entry:main");
});

test("removals and additions are independent at each site", () => {
  const baseline = [entry("entry:main", "dish:main", "HOT MEAT", [["oploc:a", 5], ["oploc:b", 7]])];
  const working = [entry("entry:main", "dish:main", "HOT MEAT", [["oploc:b", 7]]), entry("entry:soup", "dish:soup", "SOUP", [["oploc:a", 3]])];
  assert.deepEqual(compare(baseline, working).operations.map(value => [value.kind, value.siteId, value.before?.dishId, value.after?.dishId]), [
    ["removed", "governed:oploc:a", "dish:main", undefined],
    ["added", "governed:oploc:a", undefined, "dish:soup"],
  ]);
});
