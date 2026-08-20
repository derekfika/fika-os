import assert from "node:assert/strict";
import { copyFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { addMenuSlot, applyEntryPatch, assertWeekDateAvailable, attachCanonicalDishIds, createEntry, defaultWeekForDate, duplicateWeek, emptyWeek, getWeek, importWorkbook, publishWeek, removeMenuSlot, saveSnapshot, updateEntry, validateWeek, ROLLING_SLOTS } from "../lib/rolling-menu";
import { createCanonicalMenuItem, listCanonicalMenuItems } from "../lib/canonical-menu-repository";
import { createPublishedMenuDay, currentPublishedDays, getMenuPublication, listMenuPublicationEvents, listMenuPublications, publicationPreview, publicationState, publishedDayMatrixHtml, replayMenuPublicationOutbox, withdrawPublishedMenuDay, withdrawPublishedMenuWeek, type MenuPublicationSignoff } from "../lib/menu-publication";
import { resolveAllergenSnapshot } from "../lib/allergen-resolution";
import type { RollingEntry } from "../lib/rolling-menu-types";

process.env.MENU_PLANNING_DB_PATH = join(process.cwd(), "local-data", "menu-planning", "operational.test.sqlite");

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

test("planner default week prefers the current service week over distant future test data", () => {
  const current = emptyWeek("2026-08-17").week;
  const future = emptyWeek("2099-01-12").week;
  assert.equal(defaultWeekForDate([future, current], "2026-08-19")?.weekCommencing, "2026-08-17");
});

test("Menu Planning persistence failure is not presented as an empty publication list", () => {
  const databaseFile = join(process.cwd(), "local-data", "menu-planning", "operational.test.sqlite");
  const backupFile = `${databaseFile}.failure-backup`;
  const hadDatabase = existsSync(databaseFile);
  if (hadDatabase) copyFileSync(databaseFile, backupFile);
  try {
    if (existsSync(databaseFile)) unlinkSync(databaseFile);
    writeFileSync(databaseFile, "corrupt persistence");
    assert.throws(() => listMenuPublications(), (error: any) => error.status === 503 && /unavailable/i.test(error.message));
  } finally {
    if (existsSync(databaseFile)) unlinkSync(databaseFile);
    if (hadDatabase) { copyFileSync(backupFile, databaseFile); unlinkSync(backupFile); }
  }
});

test("blank rolling week has seven days and the governed slot catalogue", () => {
  const week = emptyWeek("2026-08-17");
  assert.equal(week.days.length, 7);
  assert.ok(ROLLING_SLOTS.includes("SALAD 6"));
  assert.equal(validateWeek(week).length, 1);
});

test("publication readiness enforces governed destinations and allocation invariants", () => {
  const base = emptyWeek("2095-01-06");
  const entry = (overrides: Partial<RollingEntry> = {}): RollingEntry => ({ id: "entry:integrity", dayId: base.days[0].id, date: base.days[0].date, slot: "SALAD 1", itemId: "dish:integrity", itemLabel: "Integrity Dish", portions: 10, allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 10 }], allergens: { no_key_allergens: "contains" }, audit: [], ...overrides });
  const check = (overrides: Partial<RollingEntry>) => validateWeek({ ...base, entries: [entry(overrides)] });
  assert.ok(check({ allocations: [{ destinationLabel: "Unknown venue", quantity: 10 }] }).some(error => error.includes("unresolved destination")));
  assert.ok(check({ portions: 11 }).some(error => error.includes("must equal portions")));
  assert.ok(check({ allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 5 }, { destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 5 }] }).some(error => error.includes("duplicate destination")));
  assert.ok(check({ allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 0 }] }).some(error => error.includes("positive quantity")));
  assert.deepEqual(check({}), []);
});

test("historical unresolved destination data remains readable but cannot publish unchanged", () => {
  const week = emptyWeek("2095-02-03");
  const entry: RollingEntry = { id: "entry:historical", dayId: week.days[0].id, date: week.days[0].date, slot: "SOUP", itemId: "dish:historical", itemLabel: "Historical Dish", portions: 10, allocations: [{ destinationLabel: "Legacy venue", quantity: 10 }], allergens: { no_key_allergens: "contains" }, audit: [] };
  const snapshot = { ...week, entries: [entry] };
  assert.equal(snapshot.entries[0].allocations[0].destinationId, undefined);
  assert.ok(validateWeek(snapshot).some(error => error.includes("unresolved destination")));
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
    const amended = createEntry(source.week.id, source.days[0].id, "SALAD 1", "Dish");
    assert.equal(amended.entries[0].itemLabel, "Dish");

    const copied = duplicateWeek(source.week.id, duplicateDate);
    assert.equal(copied.week.status, "draft");
    assert.equal(copied.week.version, 1);
    assert.deepEqual(copied.week.audit.map(event => event.action), ["week-created"]);
  } finally {
    if (before) await writeFile(rollingFile, before); else await rm(rollingFile, { force: true });
  }
});

test("menu days publish independently and revisions supersede only that day", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  const week = emptyWeek(`2096-03-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`);
  try {
    saveSnapshot(week);
    const add = (dayIndex: number, label: string) => { const result = createEntry(week.week.id, week.days[dayIndex].id, "SALAD 1", label, "test", `dish:${label}`); return result.entries.find(entry => entry.dayId === week.days[dayIndex].id)!; };
    const monday = add(0, "Monday Dish"); const tuesday = add(1, "Tuesday Dish"); const thursday = add(3, "Thursday Dish");
    for (const entry of [monday, tuesday, thursday]) updateEntryForTest(week.week.id, entry.id);
    const sign = (dayId: string): MenuPublicationSignoff => { const day = publicationPreview(getWeek(week.week.id), dayId)[0]; const signature = { printedName: "Signed Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" }; return { date: day.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: day.contentHash }; };
    const mondayPublication = createPublishedMenuDay(week.week.id, week.days[0].id, sign(week.days[0].id), "test");
    assert.equal(getWeek(week.week.id).week.dayStatuses?.[week.days[0].id], "published");
    const publicationEvents = listMenuPublicationEvents();
    assert.ok(publicationEvents.some(event => event.eventType === "menu.day.published" && event.sourceVersion === 1));
    assert.ok(publicationEvents.some(event => event.eventType === "fulfilment.requirement.created"));
    const replayed = await replayMenuPublicationOutbox(() => undefined);
    assert.equal(replayed.failed, 0);
    assert.equal((await replayMenuPublicationOutbox(() => { throw new Error("duplicate delivery"); })).delivered, 0);
    assert.equal(getWeek(week.week.id).week.status, "partially_published");
    addMenuSlot(week.week.id, "SALAD 7");
    removeMenuSlot(week.week.id, "SALAD 7");
    assert.equal(getMenuPublication(mondayPublication.publicationId)?.days.find(day => day.sourceDayId === week.days[0].id)?.status, "published");
    const tuesdayPublication = createPublishedMenuDay(week.week.id, week.days[1].id, sign(week.days[1].id), "test");
    assert.equal(tuesdayPublication.days.find(day => day.sourceDayId === week.days[0].id)?.status, "published");
    const mondayVersion = mondayPublication.days.find(day => day.sourceDayId === week.days[0].id)?.version;
    assert.equal(mondayVersion, 1);
    const firstThursdaySignoff = sign(week.days[3].id);
    const firstThursday = createPublishedMenuDay(week.week.id, week.days[3].id, firstThursdaySignoff, "test");
    const firstThursdaySnapshot = getMenuPublication(firstThursday.publicationId)?.days.find(day => day.sourceDayId === week.days[3].id);
    assert.equal(firstThursdaySnapshot?.version, 1);
    assert.equal(publicationState(getWeek(week.week.id))[week.days[3].id].hasUnpublishedChanges, false);
    updateEntryForTest(week.week.id, thursday.id, "Thursday Dish Revised");
    const pending = publicationState(getWeek(week.week.id))[week.days[3].id];
    assert.equal(pending.hasCurrentPublication, true);
    assert.equal(pending.hasUnpublishedChanges, true);
    assert.equal(getMenuPublication(firstThursday.publicationId)?.days.find(day => day.sourceDayId === week.days[3].id)?.entries[0].dishName, "Thursday Dish");
    assert.equal(currentPublishedDays(getMenuPublication(firstThursday.publicationId)!).find(day => day.sourceDayId === week.days[3].id)?.version, 1);
    assert.throws(() => createPublishedMenuDay(week.week.id, week.days[3].id, firstThursdaySignoff, "test"), (error: any) => error.status === 409 && error.message.includes("current day content"));
    const revised = createPublishedMenuDay(week.week.id, week.days[3].id, sign(week.days[3].id), "test");
    const history = getMenuPublication(revised.publicationId)!.days.filter(day => day.sourceDayId === week.days[3].id);
    assert.deepEqual(history.map(day => [day.version, day.status]), [[1, "superseded"], [2, "published"]]);
    assert.equal(getMenuPublication(revised.publicationId)!.days.find(day => day.sourceDayId === week.days[0].id)?.version, 1);
    assert.equal(getWeek(week.week.id).week.status, "published");
    assert.throws(() => createPublishedMenuDay(week.week.id, week.days[3].id, sign(week.days[3].id), "test"), (error: any) => error.status === 409);
    const changedHash = publicationPreview(getWeek(week.week.id), week.days[3].id)[0].contentHash;
    assert.equal(changedHash, history[1].contentHash);
  } finally {
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
    if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true });
  }
});

test("published day matrix keeps all canonical allergen columns", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  const week = emptyWeek(`2096-04-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    saveSnapshot(week); const created = createEntry(week.week.id, week.days[0].id, "SALAD 1", "Matrix Dish", "test", "dish:matrix"); const entry = created.entries.find(value => value.dayId === week.days[0].id)!;
  updateEntryForTest(week.week.id, entry.id); const day = publicationPreview(getWeek(week.week.id), week.days[0].id)[0]; const signature = { printedName: "Signed Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" }; const publication = createPublishedMenuDay(week.week.id, week.days[0].id, { date: day.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: day.contentHash }, "test");
    const html = publishedDayMatrixHtml(publication.days.find(value => value.status === "published")!);
    for (const label of ["No key allergens", "Peanuts", "Tree nuts", "Gluten", "Sesame", "Molluscs", "Fish", "Soya", "Celery", "Shellfish", "Eggs", "Milk", "Mustard", "Lupin", "Sulphites"]) assert.match(html, new RegExp(label));
  } finally {
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
    if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true });
  }
});

test("canonical allergen evidence resolves identically for planner readiness and publication", () => {
  const entry: RollingEntry = { id: "entry:canonical", dayId: "day:canonical", date: "2026-08-17", slot: "SALAD 1", itemId: "dish:canonical", itemLabel: "Canonical Dish", portions: 10, allocations: [{ destinationLabel: "Haleon", quantity: 10 }], allergens: {}, audit: [] };
  const dish = { canonicalId: "dish:canonical", displayName: "Canonical Dish", allergenEvidence: [{ allergen: "sesame", value: "contains" as const }], mayContainReviewed: true };
  const resolved = resolveAllergenSnapshot(entry, dish);
  assert.equal(resolved.unresolved.length, 0);
  assert.equal(resolved.allergens.sesame, "contains");
  const invalidated = resolveAllergenSnapshot({ ...entry, allergenReviewInvalidated: true }, dish);
  assert.ok(invalidated.unresolved.length > 0);
  const unknown = resolveAllergenSnapshot(entry, { ...dish, allergenEvidence: [{ allergen: "sesame", value: "unknown" as const }] });
  assert.ok(unknown.unresolved.length > 0);
  assert.notEqual(unknown.allergens.sesame, "contains");
});

test("withdrawal removes a day from the current projection and republishing creates the next version", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  const week = emptyWeek(`2096-05-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    saveSnapshot(week); const created = createEntry(week.week.id, week.days[1].id, "SOUP", "Withdrawable Dish", "test", "dish:withdrawable"); const entry = created.entries.find(value => value.dayId === week.days[1].id)!; updateEntryForTest(week.week.id, entry.id); const preview = publicationPreview(getWeek(week.week.id), week.days[1].id)[0]; const signature = { printedName: "Production Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" }; const signoff = { date: preview.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: preview.contentHash };
    const first = createPublishedMenuDay(week.week.id, week.days[1].id, signoff, "test"); const dayId = first.days.find(day => day.sourceDayId === week.days[1].id)!.publicationDayId; const withdrawn = withdrawPublishedMenuDay(first.publicationId, dayId, "Correction required", "test"); const withdrawnDay = withdrawn.days.find(day => day.publicationDayId === dayId)!; assert.equal(withdrawnDay.status, "withdrawn"); assert.equal(currentPublishedDays(withdrawn).length, 0); assert.equal(withdrawnDay.withdrawal?.reason, "Correction required"); assert.ok(listMenuPublicationEvents().some(event => event.eventType === "menu.day.withdrawn" && event.sourceVersion === 1));
    const republishedPreview = publicationPreview(getWeek(week.week.id), week.days[1].id)[0]; const republished = createPublishedMenuDay(week.week.id, week.days[1].id, { ...signoff, dayContentHash: republishedPreview.contentHash }, "test"); assert.equal(republished.days.filter(day => day.sourceDayId === week.days[1].id).at(-1)?.version, 2);
  } finally { if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true }); if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true }); }
});

test("week withdrawal withdraws every currently published day and preserves a reason", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  const week = emptyWeek(`2096-06-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    const withdrawalEventsBefore = listMenuPublicationEvents().filter(event => event.eventType === "menu.day.withdrawn").length;
    saveSnapshot(week);
    const entries = [0, 2].map(index => { const created = createEntry(week.week.id, week.days[index].id, "SOUP", `Week Dish ${index}`, "test", `dish:week-${index}`); const entry = created.entries.find(value => value.dayId === week.days[index].id)!; updateEntryForTest(week.week.id, entry.id); return index; });
    const signature = { printedName: "Production Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" };
    let publication = createPublishedMenuDay(week.week.id, week.days[entries[0]].id, (() => { const preview = publicationPreview(getWeek(week.week.id), week.days[entries[0]].id)[0]; return { date: preview.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: preview.contentHash }; })(), "test");
    const preview = publicationPreview(getWeek(week.week.id), week.days[entries[1]].id)[0];
    publication = createPublishedMenuDay(week.week.id, week.days[entries[1]].id, { date: preview.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: preview.contentHash }, "test");
    const withdrawn = withdrawPublishedMenuWeek(publication.publicationId, "Week cancelled by operations", "test");
    assert.equal(currentPublishedDays(withdrawn).length, 0);
    const withdrawnCount = withdrawn.days.filter(day => day.status === "withdrawn").length;
    assert.ok(withdrawnCount >= 2);
    assert.ok(withdrawn.days.filter(day => day.status === "withdrawn").every(day => day.withdrawal?.reason === "Week cancelled by operations"));
    assert.equal(listMenuPublicationEvents().filter(event => event.eventType === "menu.day.withdrawn").length - withdrawalEventsBefore, withdrawnCount);
  } finally { if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true }); if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true }); }
});

function updateEntryForTest(weekId: string, entryId: string, label?: string) {
  return updateEntry(weekId, entryId, { ...(label ? { itemLabel: label, itemId: `dish:${label}` } : {}), portions: 10, allocations: [{ destinationLabel: "Haleon", quantity: 10 }], allergens: { no_key_allergens: "contains" }, allergenReviewInvalidated: false });
}

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

test("exact imported dish names receive their existing canonical identity before publication", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const week = emptyWeek(`2099-02-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    saveSnapshot(week);
    createEntry(week.week.id, week.days[0].id, "SALAD 1", "Existing Canonical Dish", "test");
    assert.equal(getWeek(week.week.id).entries[0].itemId, undefined);
    assert.equal(attachCanonicalDishIds([{ canonicalId: "dish:existing", displayName: "Existing Canonical Dish", reviewStatus: "unreviewed" }]), 1);
    assert.equal(getWeek(week.week.id).entries[0].itemId, "dish:existing");
  } finally {
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
  }
});
