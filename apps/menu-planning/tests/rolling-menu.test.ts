import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { applyEntryPatch, assertWeekDateAvailable, createEntry, duplicateWeek, emptyWeek, getWeek, importWorkbook, publishWeek, saveSnapshot, validateWeek, ROLLING_SLOTS } from "../lib/rolling-menu";
import { createCanonicalMenuItem, listCanonicalMenuItems } from "../lib/canonical-menu-repository";
import type { RollingEntry } from "../lib/rolling-menu-types";

test("rolling menu importer preserves slots, destination quantities and source evidence", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["PRODUCT", "DISH", "Angel Court", "MNK", "Total"],
    ["SALAD 1", "Green salad", 3, 2, 5],
    ["HOT MEAT", "Roast chicken", 1, 0, 1],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "mon");
  const workbook = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const result = importWorkbook(workbook, "WC 17_08_2026.xlsx");
  assert.equal(result.recognisedEntries, 2);
  assert.equal(result.snapshot.week.weekCommencing, "2026-08-17");
  assert.deepEqual(result.snapshot.entries[0].allocations.map(a => [a.destinationLabel, a.quantity]), [["Angel Court", 3], ["MNK", 2]]);
  assert.equal(result.snapshot.entries[0].portions, 5);
  assert.deepEqual(result.snapshot.entries[0].allergens, {});
  assert.equal(result.snapshot.entries[0].source?.workbook, "WC 17_08_2026.xlsx");
  assert.equal(result.snapshot.entries[0].slot, "SALAD 1");
});

test("blank rolling week has seven days and the governed slot catalogue", () => {
  const week = emptyWeek("2026-08-17");
  assert.equal(week.days.length, 7);
  assert.ok(ROLLING_SLOTS.includes("SALAD 6"));
  assert.equal(validateWeek(week).length, 1);
});

test("week lifecycle prevents collisions, publishes once, and duplicates published weeks as drafts", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const before = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const suffix = Date.now();
  const sourceDate = `2097-01-${String((suffix % 20) + 1).padStart(2, "0")}`;
  const duplicateDate = `2097-02-${String((suffix % 20) + 1).padStart(2, "0")}`;
  try {
    const source = emptyWeek(sourceDate);
    saveSnapshot(source);
    const original = getWeek(source.week.id);
    assert.throws(() => assertWeekDateAvailable(sourceDate), (error: any) => error.status === 409 && error.message.includes("A menu already exists"));
    assert.throws(() => duplicateWeek(source.week.id, sourceDate), (error: any) => error.status === 409);
    assert.deepEqual(getWeek(source.week.id), original);

    const published = publishWeek(source.week.id);
    assert.equal(published.week.status, "published");
    const version = published.week.version;
    const auditCount = published.week.audit.length;
    assert.throws(() => publishWeek(source.week.id), (error: any) => error.status === 409 && error.message.includes("already published"));
    assert.equal(getWeek(source.week.id).week.version, version);
    assert.equal(getWeek(source.week.id).week.audit.length, auditCount);
    assert.throws(() => createEntry(source.week.id, source.days[0].id, "SALAD 1", "Dish"), (error: any) => error.status === 409);

    const copied = duplicateWeek(source.week.id, duplicateDate);
    assert.equal(copied.week.status, "draft");
    assert.equal(copied.week.version, 1);
    assert.deepEqual(copied.week.audit.map(event => event.action), ["week-created"]);
  } finally {
    if (before) await writeFile(rollingFile, before); else await rm(rollingFile, { force: true });
  }
});

const reviewedEntry = (): RollingEntry => ({ id: "entry:1", dayId: "day:1", date: "2026-08-17", slot: "SALAD 1", itemId: "dish-a", itemLabel: "Dish A", portions: 40, allocations: [{ destinationLabel: "Haleon", quantity: 40 }], allergens: { milk: "contains" }, mayContainNotes: "Shared kitchen", audit: [] });

test("changing dish clears the previous menu-entry allergen review but preserves operations", () => {
  const entry = reviewedEntry();
  applyEntryPatch(entry, { itemId: "dish-b", itemLabel: "Dish B" });
  assert.equal(entry.itemId, "dish-b");
  assert.equal(entry.itemLabel, "Dish B");
  assert.deepEqual(entry.allergens, {});
  assert.equal(entry.mayContainNotes, "");
  assert.equal(entry.portions, 40);
  assert.deepEqual(entry.allocations, [{ destinationLabel: "Haleon", quantity: 40 }]);
});

test("selecting the same dish preserves its allergen review", () => {
  const entry = reviewedEntry();
  applyEntryPatch(entry, { itemId: "dish-a", itemLabel: "Dish A" });
  assert.deepEqual(entry.allergens, { milk: "contains" });
  assert.equal(entry.mayContainNotes, "Shared kitchen");
  assert.notEqual(entry.allergenReviewInvalidated, true);
});

test("a changed dish remains a publication blocker until reviewed again", () => {
  const entry = reviewedEntry();
  applyEntryPatch(entry, { itemId: "dish-b", itemLabel: "Dish B" });
  const snapshot = { week: emptyWeek("2026-08-17").week, days: [], entries: [entry] };
  assert.ok(validateWeek(snapshot).some(error => error.includes("explicit allergen review")));
  applyEntryPatch(entry, { allergens: { no_key_allergens: "contains" }, mayContainNotes: "", allergenReviewInvalidated: false });
  assert.equal(validateWeek(snapshot).some(error => error.includes("explicit allergen review")), false);
});

test("locally created dishes persist once and rolling entries keep the same canonical ID", async () => {
  const canonicalFile = join(process.cwd(), "local-data", "menu-planning", "canonical-menu-items.json");
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const canonicalBefore = existsSync(canonicalFile) ? await readFile(canonicalFile) : undefined;
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const name = `Durable Test Dish ${Date.now()}`;
  try {
    const created = await createCanonicalMenuItem({ displayName: name, category: "Salad", description: "Test description", preparationNotes: "Test notes", allergenEvidence: [{ allergen: "sesame", value: "contains", source: "test", reviewedBy: "test", reviewedAt: new Date().toISOString() }] });
    const reloadedCatalogue = await listCanonicalMenuItems();
    assert.equal(reloadedCatalogue.find(item => item.canonicalId === created.canonicalId)?.displayName, created.displayName);
    assert.equal((await createCanonicalMenuItem({ displayName: name, category: "Salad" })).canonicalId, created.canonicalId);
    const week = emptyWeek(`2099-01-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
    saveSnapshot(week);
    createEntry(week.week.id, week.days[0].id, "SALAD 1", created.displayName, "test", created.canonicalId);
    const reloadedWeek = getWeek(week.week.id);
    assert.equal(reloadedWeek.entries[0].itemId, created.canonicalId);
  } finally {
    if (canonicalBefore) await writeFile(canonicalFile, canonicalBefore); else await rm(canonicalFile, { force: true });
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
  }
});
