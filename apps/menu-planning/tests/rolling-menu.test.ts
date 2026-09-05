// The test file deliberately exercises the Promise-based application boundary;
// runtime assertions below are the source of truth for these integration-style
// cases and are executed by the package test script.
// @ts-nocheck
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { addMenuSlot, applyEntryPatch, assertWeekDateAvailable, attachCanonicalDishIds, createEntry, defaultWeekForDate, duplicateWeek, emptyWeek, getWeek, importWorkbook, normaliseRollingSnapshotDestinations, operationalDateLondon, planningWeekCommencing, planningWeekFromQuery, publishWeek, removeMenuSlot, saveSnapshot, updateEntry, validateWeek, ROLLING_SLOTS } from "../lib/rolling-menu";
import { hasPlannedDishes } from "../lib/rolling-menu-types";
import { createCanonicalMenuItem, listCanonicalMenuItems } from "../lib/canonical-menu-repository";
import { buildCompiledPublicationSnapshot, buildPublishedDay, createPublishedMenuDay, createPublishedMenuWeek, currentPublishedDays, getCompiledPublicationSnapshot, getMenuPublication, listMenuPublicationEvents, listMenuPublications, publicationPreview, publicationState, publishedDayMatrixHtml, replayMenuPublicationOutbox, withdrawPublishedMenuDay, withdrawPublishedMenuWeek, type MenuPublicationSignoff } from "../lib/menu-publication";
import { resolveAllergenSnapshot } from "../lib/allergen-resolution";
import type { RollingEntry } from "../lib/rolling-menu-types";
import { decodeWeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";

const isolatedDatabaseDirectory = mkdtempSync(join(tmpdir(), "fika-menu-planning-test-"));
process.env.MENU_PLANNING_DB_PATH = join(isolatedDatabaseDirectory, "operational.sqlite");
process.env.MENU_PLANNING_TEST_MODE = "1";
process.on("exit", () => rmSync(isolatedDatabaseDirectory, { recursive: true, force: true }));

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

test("Hub-provided historical OPLOC IDs are canonicalised before Menu Planning persistence", () => {
  const week = emptyWeek("2026-08-17");
  week.entries = [{ id: "entry:alias", dayId: week.days[0].id, date: week.days[0].date, slot: "SALAD 1", itemLabel: "Alias Dish", portions: 10, allocations: [{ destinationId: "oploc:old", destinationLabel: "Old label", quantity: 10 }], allergens: {}, audit: [] }];
  const normalised = normaliseRollingSnapshotDestinations(week, [{ canonicalId: "oploc:current", label: "Current label", legacyIds: ["oploc:old"] }]);
  assert.deepEqual(normalised.entries[0].allocations[0], { destinationId: "oploc:current", destinationLabel: "Current label", quantity: 10 });
});

test("planner default week prefers the current service week over distant future test data", () => {
  const current = emptyWeek("2026-08-17").week;
  const future = emptyWeek("2029-01-12").week;
  assert.equal(defaultWeekForDate([future, current], "2026-08-19")?.weekCommencing, "2026-08-17");
});

test("planning weeks anchor to Monday using Europe/London operational dates", () => {
  assert.equal(operationalDateLondon(new Date("2026-09-05T10:00:00.000Z")), "2026-09-05");
  assert.equal(operationalDateLondon(new Date("2026-09-06T23:30:00.000Z")), "2026-09-07");
  assert.equal(planningWeekCommencing("2026-09-05"), "2026-08-31");
  assert.equal(planningWeekCommencing("2026-09-07"), "2026-09-07");
  assert.equal(planningWeekFromQuery("not-a-date", "2026-09-05"), "2026-08-31");
  assert.equal(planningWeekFromQuery("rolling-week:2026-09-05"), "2026-08-31");
});

test("Menu Planning persistence failure is not presented as an empty publication list", async () => {
  const originalDatabasePath = process.env.MENU_PLANNING_DB_PATH;
  const databaseFile = join(isolatedDatabaseDirectory, "persistence-failure.sqlite");
  const backupFile = `${databaseFile}.failure-backup`;
  const hadDatabase = existsSync(databaseFile);
  if (hadDatabase) copyFileSync(databaseFile, backupFile);
  try {
    process.env.MENU_PLANNING_DB_PATH = databaseFile;
    if (existsSync(databaseFile)) unlinkSync(databaseFile);
    writeFileSync(databaseFile, "corrupt persistence");
    await assert.rejects(() => listMenuPublications(), (error: any) => error.status === 503 && /unavailable/i.test(error.message));
  } finally {
    if (existsSync(databaseFile)) unlinkSync(databaseFile);
    if (hadDatabase) { copyFileSync(backupFile, databaseFile); unlinkSync(backupFile); }
    process.env.MENU_PLANNING_DB_PATH = originalDatabasePath;
  }
});

test("blank rolling week has seven days and the governed slot catalogue", () => {
  const week = emptyWeek("2026-08-17");
  assert.equal(week.days.length, 7);
  assert.ok(ROLLING_SLOTS.includes("SALAD 6"));
  assert.equal(validateWeek(week).length, 1);
});

test("only weeks with planned dishes are selectable", () => {
  const blank = emptyWeek("2026-08-17").week;
  const planned = emptyWeek("2026-08-24").week;
  planned.entryIds = ["rolling-week:2026-08-24:entry:1"];
  assert.equal(hasPlannedDishes(blank), false);
  assert.equal(hasPlannedDishes(planned), true);
});

test("publication readiness enforces governed destinations and allocation invariants", () => {
  const base = emptyWeek("2025-01-06");
  const entry = (overrides: Partial<RollingEntry> = {}): RollingEntry => ({ id: "entry:integrity", dayId: base.days[0].id, date: base.days[0].date, slot: "SALAD 1", itemId: "dish:integrity", itemLabel: "Integrity Dish", portions: 10, allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 10 }], allergens: { no_key_allergens: "contains" }, audit: [], ...overrides });
  const check = (overrides: Partial<RollingEntry>) => validateWeek({ ...base, entries: [entry(overrides)] });
  assert.ok(check({ allocations: [{ destinationLabel: "Unknown venue", quantity: 10 }] }).some(error => error.includes("unresolved destination")));
  assert.ok(check({ portions: 11 }).some(error => error.includes("must equal portions")));
  assert.ok(check({ allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 5 }, { destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 5 }] }).some(error => error.includes("duplicate destination")));
  assert.ok(check({ allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 0 }] }).some(error => error.includes("positive quantity")));
  assert.deepEqual(check({}), []);
});

test("historical unresolved destination data remains readable but cannot publish unchanged", () => {
  const week = emptyWeek("2025-02-03");
  const entry: RollingEntry = { id: "entry:historical", dayId: week.days[0].id, date: week.days[0].date, slot: "SOUP", itemId: "dish:historical", itemLabel: "Historical Dish", portions: 10, allocations: [{ destinationLabel: "Legacy venue", quantity: 10 }], allergens: { no_key_allergens: "contains" }, audit: [] };
  const snapshot = { ...week, entries: [entry] };
  assert.equal(snapshot.entries[0].allocations[0].destinationId, undefined);
  assert.ok(validateWeek(snapshot).some(error => error.includes("unresolved destination")));
});

test("historical Haleon destination IDs are normalized when a week is read", async () => {
  const week = emptyWeek(`2031-01-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  await saveSnapshot(week);
  const created = await createEntry(week.week.id, week.days[0].id, "SALAD 1", "Legacy Haleon dish", "test", "dish:legacy-haleon");
  await updateEntry(week.week.id, created.entries[0].id, { portions: 10, allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 10 }] });
  const readBack = await getWeek(week.week.id);
  assert.equal(readBack.entries[0].allocations[0].destinationId, "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b");
});

test("an explicit destination ID is not replaced by display-label matching", () => {
  const snapshot = emptyWeek("2026-09-07");
  snapshot.entries.push({ id: "entry:live-oploc", dayId: snapshot.days[2].id, date: snapshot.days[2].date, slot: "SALAD 1", itemLabel: "Test salad", portions: 5, allocations: [{ destinationId: "oploc:stale-haleon", destinationLabel: "Haleon", quantity: 5 }], allergens: {}, audit: [] });
  const normalised = normaliseRollingSnapshotDestinations(snapshot, [{ canonicalId: "oploc:new-haleon", label: "Haleon" }]);
  assert.equal(normalised.entries[0].allocations[0].destinationId, "oploc:stale-haleon");
});

test("an unidentified allocation follows the live Hub OPLOC before the static compatibility table", () => {
  const snapshot = emptyWeek("2026-09-07");
  snapshot.entries.push({ id: "entry:live-oploc-label", dayId: snapshot.days[2].id, date: snapshot.days[2].date, slot: "SALAD 1", itemLabel: "Test salad", portions: 5, allocations: [{ destinationLabel: "Haleon", quantity: 5 }], allergens: {}, audit: [] });
  const normalised = normaliseRollingSnapshotDestinations(snapshot, [{ canonicalId: "oploc:new-haleon", label: "Haleon" }]);
  assert.equal(normalised.entries[0].allocations[0].destinationId, "oploc:new-haleon");
});

test("week lifecycle prevents collisions, publishes once, and duplicates published weeks as drafts", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const before = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const suffix = Date.now();
  const sourceDate = `2027-01-${String((suffix % 20) + 1).padStart(2, "0")}`;
  const duplicateDate = `2027-02-${String((suffix % 20) + 1).padStart(2, "0")}`;
  try {
    const source = emptyWeek(sourceDate);
    await saveSnapshot(source);
    const original = await getWeek(source.week.id);
    await assert.rejects(() => assertWeekDateAvailable(sourceDate), (error: any) => error.status === 409 && error.message.includes("A menu already exists"));
    await assert.rejects(() => duplicateWeek(source.week.id, sourceDate), (error: any) => error.status === 409);
    assert.deepEqual(await getWeek(source.week.id), original);

    const published = await publishWeek(source.week.id);
    assert.equal(published.week.status, "published");
    const version = published.week.version;
    const auditCount = published.week.audit.length;
    await assert.rejects(() => publishWeek(source.week.id), (error: any) => error.status === 409 && error.message.includes("already published"));
    assert.equal((await getWeek(source.week.id)).week.version, version);
    assert.equal((await getWeek(source.week.id)).week.audit.length, auditCount);
    const amended = await createEntry(source.week.id, source.days[0].id, "SALAD 1", "Dish");
    assert.equal(amended.entries[0].itemLabel, "Dish");

    const copied = await duplicateWeek(source.week.id, duplicateDate);
    assert.equal(copied.week.status, "draft");
    assert.equal(copied.week.version, 1);
    assert.deepEqual(copied.week.audit.map(event => event.action), ["week-created"]);
  } finally {
    if (before) await writeFile(rollingFile, before); else await rm(rollingFile, { force: true });
  }
});

test("duplicate week copies populated source while retaining intentional blank days and no publication state", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const before = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  try {
    const source = emptyWeek("2027-03-01");
    await saveSnapshot(source);
    const created = await createEntry(source.week.id, source.days[0].id, "SALAD 1", "Historic dish", "test", "dish:historic");
    const copied = await duplicateWeek(source.week.id, "2027-03-08");
    assert.equal(copied.week.weekCommencing, "2027-03-08");
    assert.equal(copied.week.status, "draft");
    assert.equal(copied.entries.length, 1);
    assert.equal(copied.entries[0].dayId, copied.days[0].id);
    assert.equal(copied.days[1].entryIds.length, 0);
    assert.notEqual(copied.entries[0].id, created.entries[0].id);
    assert.equal((copied.week as any).publishedAt, undefined);
    assert.equal((copied.week as any).publicationId, undefined);
  } finally {
    if (before) await writeFile(rollingFile, before); else await rm(rollingFile, { force: true });
  }
});

test("menu days publish independently and revisions supersede only that day", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  const week = emptyWeek(`2026-03-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`);
  try {
    await saveSnapshot(week);
    const add = async (dayIndex: number, label: string) => { const result = await createEntry(week.week.id, week.days[dayIndex].id, "SALAD 1", label, "test", `dish:${label}`); return result.entries.find(entry => entry.dayId === week.days[dayIndex].id)!; };
    const monday = await add(0, "Monday Dish"); const tuesday = await add(1, "Tuesday Dish"); const thursday = await add(3, "Thursday Dish");
    for (const entry of [monday, tuesday, thursday]) await updateEntryForTest(week.week.id, entry.id);
    const sign = async (dayId: string): Promise<MenuPublicationSignoff> => { const day = publicationPreview(await getWeek(week.week.id), dayId)[0]; const signature = { printedName: "Signed Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" }; return { date: day.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: day.contentHash }; };
    const sourceWeekVersion = (await getWeek(week.week.id)).week.version;
    const mondayPublication = await createPublishedMenuDay(week.week.id, week.days[0].id, await sign(week.days[0].id), "test");
    const mondayCompiledSnapshot = await getCompiledPublicationSnapshot(mondayPublication.publicationId, 1);
    assert.equal(mondayCompiledSnapshot?.publicationVersion, 1);
    assert.equal(mondayCompiledSnapshot?.sourceWeekVersion, sourceWeekVersion);
    assert.equal(mondayCompiledSnapshot?.days.length, 1);
    assert.match(mondayCompiledSnapshot?.contentHash || "", /^[a-f0-9]{64}$/);
    assert.equal((await getWeek(week.week.id)).week.dayStatuses?.[week.days[0].id], "published");
    const publicationEvents = await listMenuPublicationEvents();
    assert.ok(publicationEvents.some(event => event.eventType === "menu.day.published" && event.sourceVersion === 1));
    assert.ok(publicationEvents.some(event => event.eventType === "production.materialise"));
    const replayed = await replayMenuPublicationOutbox(() => undefined);
    assert.equal(replayed.failed, 0);
    assert.equal((await replayMenuPublicationOutbox(() => { throw new Error("duplicate delivery"); })).delivered, 0);
    assert.equal((await getWeek(week.week.id)).week.status, "partially_published");
    await addMenuSlot(week.week.id, "SALAD 7");
    await removeMenuSlot(week.week.id, "SALAD 7");
    assert.equal((await getMenuPublication(mondayPublication.publicationId))?.days.find(day => day.sourceDayId === week.days[0].id)?.status, "published");
    const tuesdayPublication = await createPublishedMenuDay(week.week.id, week.days[1].id, await sign(week.days[1].id), "test");
    assert.equal(tuesdayPublication.days.find(day => day.sourceDayId === week.days[0].id)?.status, "published");
    const mondayVersion = mondayPublication.days.find(day => day.sourceDayId === week.days[0].id)?.version;
    assert.equal(mondayVersion, 1);
    const firstThursdaySignoff = await sign(week.days[3].id);
    const firstThursday = await createPublishedMenuDay(week.week.id, week.days[3].id, firstThursdaySignoff, "test");
    const firstThursdaySnapshot = (await getMenuPublication(firstThursday.publicationId))?.days.find(day => day.sourceDayId === week.days[3].id);
    assert.equal(firstThursdaySnapshot?.version, 1);
    assert.equal((await publicationState(await getWeek(week.week.id)))[week.days[3].id]?.hasUnpublishedChanges, false);
    await updateEntryForTest(week.week.id, thursday.id, "Thursday Dish Revised");
    const pending = (await publicationState(await getWeek(week.week.id)))[week.days[3].id];
    assert.equal(pending.hasCurrentPublication, true);
    assert.equal(pending.hasUnpublishedChanges, true);
    assert.equal((await getMenuPublication(firstThursday.publicationId))?.days.find(day => day.sourceDayId === week.days[3].id)?.entries[0].dishName, "Thursday Dish");
    assert.equal(currentPublishedDays((await getMenuPublication(firstThursday.publicationId))!).find(day => day.sourceDayId === week.days[3].id)?.version, 1);
    await assert.rejects(() => createPublishedMenuDay(week.week.id, week.days[3].id, firstThursdaySignoff, "test"), (error: any) => error.status === 409 && error.message.includes("current day content"));
    const revised = await createPublishedMenuDay(week.week.id, week.days[3].id, await sign(week.days[3].id), "test");
    const history = (await getMenuPublication(revised.publicationId))!.days.filter(day => day.sourceDayId === week.days[3].id);
    assert.deepEqual(history.map(day => [day.version, day.status]), [[1, "superseded"], [2, "published"]]);
    assert.equal((await getMenuPublication(revised.publicationId))!.days.find(day => day.sourceDayId === week.days[0].id)?.version, 1);
    assert.equal((await getWeek(week.week.id)).week.status, "published");
    await assert.rejects(async () => createPublishedMenuDay(week.week.id, week.days[3].id, await sign(week.days[3].id), "test"), (error: any) => error.status === 409);
    const changedHash = publicationPreview(await getWeek(week.week.id), week.days[3].id)[0].contentHash;
    assert.equal(changedHash, history[1].contentHash);
    assert.deepEqual(await getCompiledPublicationSnapshot(revised.publicationId, 1), mondayCompiledSnapshot);
    assert.equal((await getCompiledPublicationSnapshot(revised.publicationId))?.publicationVersion, 4);
  } finally {
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
    if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true });
  }
});

test("compiled publication snapshots reject oversized payloads before persistence", () => {
  const huge = "x".repeat(950 * 1024);
  assert.throws(() => buildCompiledPublicationSnapshot({ publicationId: "publication:large", sourceWeekId: "week:large", weekCommencing: "2026-05-04", weekEnding: "2026-05-08", publicationVersion: 1, days: [{ publicationDayId: "day:large", sourceDayId: "day:large", date: "2026-05-04", dayName: "Monday", version: 1, status: "published", publishedAt: "2026-05-04T10:00:00.000Z", publishedBy: "test", contentHash: "hash", entries: [{ sourceEntryId: "entry:large", slot: "SOUP", dishName: huge, portions: 1, allocations: [], allergens: {} }] }], audit: [] }, 1), (error: any) => error.status === 413);
});

test("week publication is atomic and creates one immutable five-day publication", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  const week = emptyWeek(`2030-01-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    await saveSnapshot(week);
    let firstEntryId = "";
    for (const [index, day] of week.days.slice(0, 4).entries()) { const created = await createEntry(week.week.id, day.id, "SOUP", `Atomic week dish ${index}`, "test", `dish:atomic-${index}`,); const entryId = created.entries.find(value => value.dayId === day.id)!.id; if (index === 0) firstEntryId = entryId; await updateEntryForTest(week.week.id, entryId); }
    const publication = await createPublishedMenuWeek(week.week.id, {}, "test");
    assert.equal(currentPublishedDays(publication).length, 5);
    assert.equal((await getWeek(week.week.id)).week.status, "published");
    assert.ok(publication.days.every(day => day.status === "published"));
    assert.ok(publication.weekPacket);
    assert.equal(publication.weekPacket.manifest.recordCount, 5);
    assert.equal(publication.weekPacket.manifest.packageVersion, 1);
    assert.ok(publication.weekPacket.payloadBase64.length > 0);
    const packet = decodeWeeklyPublicationPacket(publication.weekPacket);
    assert.equal(packet.publicationId, publication.publicationId);
    assert.equal(packet.days.length, 5);
    assert.ok(packet.days.slice(0, 4).every(day => day.entries.every(entry => entry.sourceEntryId && entry.allocations.every(allocation => allocation.quantity === 10))));
    assert.equal(packet.days[4].entries.length, 0);
    assert.ok(publication.days.every(day => !day.allergenSignoff));
    const firstPacketByte = publication.weekPacket.payloadBase64[0] === "A" ? "B" : "A";
    assert.throws(() => decodeWeeklyPublicationPacket({ ...publication.weekPacket, payloadBase64: `${firstPacketByte}${publication.weekPacket.payloadBase64.slice(1)}` } as never), /integrity/i);
    await assert.rejects(() => createPublishedMenuWeek(week.week.id, {}, "test"), (error: any) => error.status === 409);
    await updateEntryForTest(week.week.id, firstEntryId, "Atomic week dish amended");
    const amendment = await createPublishedMenuWeek(week.week.id, {}, "test");
    assert.equal(amendment.publicationVersion, 2);
    assert.notEqual(amendment.weekPacket?.manifest.contentHash, publication.weekPacket.manifest.contentHash);
    assert.equal(decodeWeeklyPublicationPacket(amendment.weekPacket!).publicationVersion, 2);
    const withdrawnDayId = amendment.days.find(day => day.sourceDayId === week.days[0].id && day.status === "published")!.publicationDayId;
    const afterDayWithdrawal = await withdrawPublishedMenuDay(amendment.publicationId, withdrawnDayId, "Withdraw first day", "test");
    assert.ok(afterDayWithdrawal.weekPacket);
    assert.equal(decodeWeeklyPublicationPacket(afterDayWithdrawal.weekPacket!).days.some(day => day.publicationDayId === withdrawnDayId), false);
    assert.notEqual(afterDayWithdrawal.compiledSnapshotId, amendment.compiledSnapshotId);
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
  const week = emptyWeek(`2026-04-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    await saveSnapshot(week); const created = await createEntry(week.week.id, week.days[0].id, "SALAD 1", "Matrix Dish", "test", "dish:matrix"); const entry = created.entries.find(value => value.dayId === week.days[0].id)!;
  await updateEntryForTest(week.week.id, entry.id); const day = publicationPreview(await getWeek(week.week.id), week.days[0].id)[0]; const signature = { printedName: "Signed Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" }; const publication = await createPublishedMenuDay(week.week.id, week.days[0].id, { date: day.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: day.contentHash }, "test");
    const html = publishedDayMatrixHtml(publication.days.find(value => value.status === "published")!);
    for (const label of ["No key allergens", "Peanuts", "Tree nuts", "Gluten", "Sesame", "Molluscs", "Fish", "Soya", "Celery", "Shellfish", "Eggs", "Milk", "Mustard", "Lupin", "Sulphites"]) assert.match(html, new RegExp(label));
  } finally {
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
    if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true });
  }
});

test("canonical allergen evidence resolves identically for planner readiness and publication", async () => {
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
  const week = emptyWeek(`2026-05-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    await saveSnapshot(week); const created = await createEntry(week.week.id, week.days[1].id, "SOUP", "Withdrawable Dish", "test", "dish:withdrawable"); const entry = created.entries.find(value => value.dayId === week.days[1].id)!; await updateEntryForTest(week.week.id, entry.id); const preview = publicationPreview(await getWeek(week.week.id), week.days[1].id)[0]; const signature = { printedName: "Production Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" }; const signoff = { date: preview.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: preview.contentHash };
    const first = await createPublishedMenuDay(week.week.id, week.days[1].id, signoff, "test"); const dayId = first.days.find(day => day.sourceDayId === week.days[1].id)!.publicationDayId; const withdrawn = await withdrawPublishedMenuDay(first.publicationId, dayId, "Correction required", "test"); const withdrawnDay = withdrawn.days.find(day => day.publicationDayId === dayId)!; assert.equal(withdrawnDay.status, "withdrawn"); assert.equal(currentPublishedDays(withdrawn).length, 0); assert.equal(withdrawnDay.withdrawal?.reason, "Correction required"); assert.ok((await listMenuPublicationEvents()).some(event => event.eventType === "menu.day.withdrawn" && event.sourceVersion === 1));
    const republishedPreview = publicationPreview(await getWeek(week.week.id), week.days[1].id)[0]; const republished = await createPublishedMenuDay(week.week.id, week.days[1].id, { ...signoff, dayContentHash: republishedPreview.contentHash }, "test"); assert.equal(republished.days.filter(day => day.sourceDayId === week.days[1].id).at(-1)?.version, 2);
  } finally { if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true }); if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true }); }
});

test("week withdrawal withdraws every currently published day and preserves a reason", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  const week = emptyWeek(`2026-06-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    const withdrawalEventsBefore = (await listMenuPublicationEvents()).filter(event => event.eventType === "menu.day.withdrawn").length;
    await saveSnapshot(week);
    const entries: number[] = []; for (const index of [0, 2]) { const created = await createEntry(week.week.id, week.days[index].id, "SOUP", `Week Dish ${index}`, "test", `dish:week-${index}`); const entry = created.entries.find(value => value.dayId === week.days[index].id)!; await updateEntryForTest(week.week.id, entry.id); entries.push(index); }
    const signature = { printedName: "Production Chef", signatureDataUrl: "data:image/png;base64,c2ln", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" };
    const firstPreview = publicationPreview(await getWeek(week.week.id), week.days[entries[0]].id)[0];
    let publication = await createPublishedMenuDay(week.week.id, week.days[entries[0]].id, { date: firstPreview.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: firstPreview.contentHash }, "test");
    const preview = publicationPreview(await getWeek(week.week.id), week.days[entries[1]].id)[0];
    publication = await createPublishedMenuDay(week.week.id, week.days[entries[1]].id, { date: preview.date, productionChef: signature, headChefSiteManager: { ...signature, printedName: "Head Chef" }, dayContentHash: preview.contentHash }, "test");
    const withdrawn = await withdrawPublishedMenuWeek(publication.publicationId, "Week cancelled by operations", "test");
    assert.equal(currentPublishedDays(withdrawn).length, 0);
    assert.equal(withdrawn.weekPacket, undefined);
    assert.equal(withdrawn.compiledSnapshotId, undefined);
    const withdrawnCount = withdrawn.days.filter(day => day.status === "withdrawn").length;
    assert.ok(withdrawnCount >= 2);
    assert.ok(withdrawn.days.filter(day => day.status === "withdrawn").every(day => day.withdrawal?.reason === "Week cancelled by operations"));
    assert.equal((await listMenuPublicationEvents()).filter(event => event.eventType === "menu.day.withdrawn").length - withdrawalEventsBefore, withdrawnCount);
  } finally { if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true }); if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true }); }
});

function updateEntryForTest(weekId: string, entryId: string, label?: string) {
  return updateEntry(weekId, entryId, { ...(label ? { itemLabel: label, itemId: `dish:${label}` } : {}), portions: 10, allocations: [{ destinationLabel: "Haleon", quantity: 10 }], allergens: { no_key_allergens: "contains" }, allergenReviewInvalidated: false });
}

const reviewedEntry = (): RollingEntry => ({ id: "entry:1", dayId: "day:1", date: "2026-08-17", slot: "SALAD 1", itemId: "dish-a", itemLabel: "Dish A", portions: 40, allocations: [{ destinationLabel: "Haleon", quantity: 40 }], allergens: { milk: "contains" }, mayContainNotes: "Shared kitchen", audit: [] });

function containsUndefined(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (value && typeof value === "object") return Object.values(value).some(item => item === undefined || containsUndefined(item));
  return false;
}

test("publication and production graphs omit absent optional Firestore fields", async () => {
  const week = emptyWeek(`2029-03-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const publicationFile = join(process.cwd(), "local-data", "menu-planning", "menu-publications.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const publicationBefore = existsSync(publicationFile) ? await readFile(publicationFile) : undefined;
  try {
    await saveSnapshot(week);
    const created = await createEntry(week.week.id, week.days[0].id, "SALAD 1", "Serialization Dish", "test", "dish:serialization");
    const entry = created.entries.find(value => value.dayId === week.days[0].id)!;
    await updateEntryForTest(week.week.id, entry.id);
    const preview = publicationPreview(await getWeek(week.week.id), week.days[0].id)[0];
    const optionalPreview = buildPublishedDay({ week: week.week, days: week.days, entries: [{ ...entry, itemId: undefined, mayContainNotes: undefined, allocations: [{ destinationLabel: "Unmapped venue", quantity: 10 }] }] }, week.days[0]);
    assert.equal("mayContainNotes" in optionalPreview.entries[0], false);
    assert.equal("canonicalDishId" in optionalPreview.entries[0], false);
    assert.equal("destinationId" in optionalPreview.entries[0].allocations[0], false);
    assert.equal(containsUndefined(optionalPreview), false);
    assert.equal(containsUndefined(preview), false);
    const signature = { printedName: "Production Chef", signedAt: "2026-08-19T12:00:00.000Z", actor: "test", attestation: "Reviewed" };
    const publication = await createPublishedMenuDay(week.week.id, week.days[0].id, { date: preview.date, productionChef: signature, headChefSiteManager: signature, dayContentHash: preview.contentHash }, "test");
    assert.equal(containsUndefined(publication), false);
    const events = (await listMenuPublicationEvents()).filter(event => event.sourceAggregateId.includes(week.week.id));
    assert.ok(events.length >= 2);
    assert.ok(events.every(event => containsUndefined(event) === false));
    assert.equal((await publicationState(await getWeek(week.week.id)))[week.days[0].id].hasUnpublishedChanges, false);
  } finally {
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
    if (publicationBefore) await writeFile(publicationFile, publicationBefore); else await rm(publicationFile, { force: true });
  }
});

test("changing dish clears the previous menu-entry allergen review but preserves operations", async () => {
  const entry = reviewedEntry();
  applyEntryPatch(entry, { itemId: "dish-b", itemLabel: "Dish B" });
  assert.equal(entry.itemId, "dish-b");
  assert.equal(entry.itemLabel, "Dish B");
  assert.deepEqual(entry.allergens, {});
  assert.equal(entry.mayContainNotes, "");
  assert.equal(entry.portions, 40);
  assert.deepEqual(entry.allocations, [{ destinationLabel: "Haleon", quantity: 40 }]);
});

test("selecting the same dish preserves its allergen review", async () => {
  const entry = reviewedEntry();
  applyEntryPatch(entry, { itemId: "dish-a", itemLabel: "Dish A" });
  assert.deepEqual(entry.allergens, { milk: "contains" });
  assert.equal(entry.mayContainNotes, "Shared kitchen");
  assert.notEqual(entry.allergenReviewInvalidated, true);
});

test("a changed dish does not block Menu Planning publication for allergen sign-off", async () => {
  const entry = reviewedEntry();
  applyEntryPatch(entry, { itemId: "dish-b", itemLabel: "Dish B" });
  const snapshot = { week: emptyWeek("2026-08-17").week, days: [], entries: [entry] };
  assert.equal(validateWeek(snapshot).some(error => error.includes("explicit allergen review")), false);
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
    const week = emptyWeek(`2029-01-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
    await saveSnapshot(week);
    await createEntry(week.week.id, week.days[0].id, "SALAD 1", created.displayName, "test", created.canonicalId);
    const reloadedWeek = await getWeek(week.week.id);
    assert.equal(reloadedWeek.entries[0].itemId, created.canonicalId);
  } finally {
    if (canonicalBefore) await writeFile(canonicalFile, canonicalBefore); else await rm(canonicalFile, { force: true });
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
  }
});

test("exact imported dish names receive their existing canonical identity before publication", async () => {
  const rollingFile = join(process.cwd(), "local-data", "menu-planning", "rolling-menu-weeks.json");
  const rollingBefore = existsSync(rollingFile) ? await readFile(rollingFile) : undefined;
  const week = emptyWeek(`2029-02-${String((Date.now() % 20) + 1).padStart(2, "0")}`);
  try {
    await saveSnapshot(week);
    await createEntry(week.week.id, week.days[0].id, "SALAD 1", "Existing Canonical Dish", "test");
    assert.equal((await getWeek(week.week.id)).entries[0].itemId, undefined);
    assert.equal(await attachCanonicalDishIds([{ canonicalId: "dish:existing", displayName: "Existing Canonical Dish", reviewStatus: "unreviewed" }]), 1);
    assert.equal((await getWeek(week.week.id)).entries[0].itemId, "dish:existing");
  } finally {
    if (rollingBefore) await writeFile(rollingFile, rollingBefore); else await rm(rollingFile, { force: true });
  }
});
