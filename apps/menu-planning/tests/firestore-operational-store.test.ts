import assert from "node:assert/strict";
import test from "node:test";
import { MenuPlanningFirestoreRepository, type HostedTransactionState } from "../lib/firestore-operational-store";
import type { RollingDay, RollingEntry, RollingWeek } from "../lib/rolling-menu-types";
import { encodeWeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";

const week = (id: string): RollingWeek => ({ id, weekCommencing: "2026-08-24", weekEnding: "2026-08-30", status: "draft", version: 1, dayIds: [], entryIds: [], sourceFiles: [], audit: [] });
const day = (id: string, weekId: string): RollingDay => ({ id, date: "2026-08-24", dayName: "Monday", entryIds: [] });
const entry = (id: string, dayId: string): RollingEntry => ({ id, dayId, date: "2026-08-24", slot: "SOUP", itemLabel: "Test soup", portions: 1, allocations: [], allergens: {}, audit: [] });
const state = (weeks: RollingWeek[], days: RollingDay[], entries: RollingEntry[]): HostedTransactionState["rolling"] => ({ weeks, days, entries });

function harness() {
  const writes: Array<{ path: string; value: unknown }> = [];
  const ref = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), collection: (name: string) => ref(`${path}/${name}`) });
  const db = { collection: (name: string) => ref(name) } as any;
  const transaction = { set: (document: { path: string }, value: unknown) => writes.push({ path: document.path, value }) } as any;
  return { repository: new MenuPlanningFirestoreRepository(db), transaction, writes };
}

function commandHarness() {
  const docs = new Map<string, unknown>();
  const reads: string[] = [];
  const writes: string[] = [];
  const ref = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), collection: (name: string) => ref(`${path}/${name}`) });
  const snapshotFor = (target: any) => {
    const value = docs.get(target.path);
    return { exists: value !== undefined, data: () => structuredClone(value) };
  };
  const db = {
    collection: (name: string) => ref(name),
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => {
      const pending: Array<{ path: string; value: unknown }> = [];
      const transaction = {
        get: async (target: any) => { reads.push(target.path); return snapshotFor(target); },
        getAll: async (...targets: any[]) => { targets.forEach(target => reads.push(target.path)); return targets.map(snapshotFor); },
        set: (target: any, value: unknown) => { pending.push({ path: target.path, value }); },
      };
      const result = await callback(transaction);
      for (const write of pending) { docs.set(write.path, structuredClone(write.value)); writes.push(write.path); }
      return result;
    },
  } as any;
  const seed = (weekValue: RollingWeek, dayValue: RollingDay, entries: RollingEntry[]) => {
    const weekPath = `fikaMenuPlanningWeeks/${weekValue.id}`;
    docs.set(weekPath, structuredClone(weekValue));
    docs.set(`${weekPath}/days/${dayValue.id}`, structuredClone(dayValue));
    for (const value of entries) docs.set(`${weekPath}/days/${dayValue.id}/entries/${value.id}`, structuredClone(value));
  };
  return { repository: new MenuPlanningFirestoreRepository(db), docs, reads, writes, seed };
}

const commandFor = (weekId: string, expectedWeekVersion: number, entryValue: RollingEntry, label: string) => ({
  weekId,
  expectedWeekVersion,
  touchedEntryIds: [entryValue.id],
  touchedDayIds: [entryValue.dayId],
  entryDayIds: { [entryValue.id]: entryValue.dayId },
  patch: { entries: { [entryValue.id]: { itemLabel: label } } },
  audit: { action: "entry-amended", at: "2026-08-24T10:00:00.000Z", by: label },
});

test("command mutations use bounded reads, deterministic CAS, and atomic writes", async () => {
  const h = commandHarness();
  const weekValue = week("week-command");
  const dayValue = day("week-command:day:0", weekValue.id);
  const first = entry("entry-first", dayValue.id);
  const second = entry("entry-second", dayValue.id);
  const unrelated = entry("entry-unrelated", dayValue.id);
  weekValue.dayIds = [dayValue.id]; weekValue.entryIds = [first.id, second.id, unrelated.id]; dayValue.entryIds = weekValue.entryIds;
  h.seed(weekValue, dayValue, [first, second, unrelated]);

  const firstResult = await h.repository.mutateRollingCommand(commandFor(weekValue.id, 1, first, "First from A"));
  assert.equal(firstResult.week.version, 2);
  assert.equal(h.reads.length, 2, "one-entry command reads only week metadata and the touched entry");
  assert.equal(h.writes.length, 2, "one-entry command writes only the touched entry and week version");
  assert.equal((h.docs.get(`fikaMenuPlanningWeeks/${weekValue.id}/days/${dayValue.id}/entries/${first.id}`) as RollingEntry).itemLabel, "First from A");
  assert.equal((h.docs.get(`fikaMenuPlanningWeeks/${weekValue.id}/days/${dayValue.id}/entries/${first.id}`) as RollingEntry).audit.at(-1)?.by, "First from A");
  assert.equal((h.docs.get(`fikaMenuPlanningWeeks/${weekValue.id}/days/${dayValue.id}/entries/${unrelated.id}`) as RollingEntry).itemLabel, "Test soup");

  h.reads.length = 0; h.writes.length = 0;
  await assert.rejects(() => h.repository.mutateRollingCommand(commandFor(weekValue.id, 1, second, "Second from stale B")), (error: any) => error.status === 409);
  assert.equal(h.reads.length, 1, "a stale command stops after the authoritative week read");
  assert.equal(h.writes.length, 0, "a stale command commits no writes");

  h.reads.length = 0; h.writes.length = 0;
  const retry = await h.repository.mutateRollingCommand(commandFor(weekValue.id, 2, second, "Second after refresh"));
  assert.equal(retry.week.version, 3);
  assert.equal(h.reads.length, 2);
  assert.equal(h.writes.length, 2);

  const batchEntries = [first, second].map((value, index) => ({ ...value, id: `${value.id}-batch`, itemLabel: `Batch ${index}`, dayId: dayValue.id }));
  for (const value of batchEntries) docsSet(h, value, weekValue.id, dayValue.id);
  h.docs.set(`fikaMenuPlanningWeeks/${weekValue.id}`, { ...(h.docs.get(`fikaMenuPlanningWeeks/${weekValue.id}`) as RollingWeek), entryIds: [...weekValue.entryIds, ...batchEntries.map(value => value.id)] });
  const batchCommand = {
    weekId: weekValue.id, expectedWeekVersion: 3, touchedEntryIds: batchEntries.map(value => value.id), touchedDayIds: [dayValue.id], entryDayIds: Object.fromEntries(batchEntries.map(value => [value.id, value.dayId])),
    patch: { entries: Object.fromEntries(batchEntries.map(value => [value.id, { itemLabel: `${value.itemLabel} saved` }])) },
    audit: { action: "portion-allocations-batch-saved", at: "2026-08-24T10:01:00.000Z", by: "portion-planner" },
  };
  h.reads.length = 0; h.writes.length = 0;
  const batch = await h.repository.mutateRollingCommand(batchCommand);
  assert.equal(batch.week.version, 4);
  assert.equal(h.reads.length, 3, "T=2 batch reads one week plus two touched entries");
  assert.equal(h.writes.length, 3, "T=2 batch writes two entries plus the week version");

  h.reads.length = 0; h.writes.length = 0;
  const missing = { ...batchEntries[1], id: "entry-does-not-exist" };
  h.docs.set(`fikaMenuPlanningWeeks/${weekValue.id}`, { ...(h.docs.get(`fikaMenuPlanningWeeks/${weekValue.id}`) as RollingWeek), entryIds: [...((h.docs.get(`fikaMenuPlanningWeeks/${weekValue.id}`) as RollingWeek).entryIds), missing.id] });
  await assert.rejects(() => h.repository.mutateRollingCommand({ ...batchCommand, expectedWeekVersion: 4, touchedEntryIds: [batchEntries[0].id, missing.id], entryDayIds: { [batchEntries[0].id]: dayValue.id, [missing.id]: dayValue.id }, patch: { entries: { [batchEntries[0].id]: { itemLabel: "must not commit" }, [missing.id]: { itemLabel: "missing" } } } }), /not attached|not found/);
  assert.equal(h.writes.length, 0, "a failed multi-entry command commits no partial entry writes");
  assert.equal((h.docs.get(`fikaMenuPlanningWeeks/${weekValue.id}/days/${dayValue.id}/entries/${batchEntries[0].id}`) as RollingEntry).itemLabel, "Batch 0 saved");
});

function docsSet(h: ReturnType<typeof commandHarness>, value: RollingEntry, weekId: string, dayId: string) {
  h.docs.set(`fikaMenuPlanningWeeks/${weekId}/days/${dayId}/entries/${value.id}`, structuredClone(value));
}

function publicationReadHarness() {
  const publicationId = "menu-publication:rolling-week:2026-09-14";
  const otherPublicationId = "menu-publication:rolling-week:2026-09-21";
  const daysByPublication = new Map([
    [publicationId, [{ publicationDayId: `${publicationId}:day:0:v5`, sourceDayId: "rolling-week:2026-09-14:day:1", date: "2026-09-14", dayName: "Monday", version: 5, status: "published", contentHash: "hash-v5", publishedAt: "2026-09-14T10:00:00.000Z", publishedBy: "test", entries: [] }]],
    [otherPublicationId, [{ publicationDayId: `${otherPublicationId}:day:0:v1`, sourceDayId: "rolling-week:2026-09-21:day:1", date: "2026-09-21", dayName: "Monday", version: 1, status: "published", contentHash: "other-hash", publishedAt: "2026-09-21T10:00:00.000Z", publishedBy: "test", entries: [] }]],
  ]);
  const roots = [
    { id: publicationId, value: { publicationId, sourceWeekId: "rolling-week:2026-09-14", weekCommencing: "2026-09-14", weekEnding: "2026-09-20", publicationVersion: 5, publicationStatus: "published" } },
    { id: otherPublicationId, value: { publicationId: otherPublicationId, sourceWeekId: "rolling-week:2026-09-21", weekCommencing: "2026-09-21", weekEnding: "2026-09-27", publicationVersion: 1, publicationStatus: "published" } },
  ];
  const dayDocumentsFor = (id: string) => daysByPublication.get(id)!.map(value => ({ data: () => value }));
  const documentFor = (root: typeof roots[number]) => ({ id: root.id, exists: true, data: () => root.value, ref: { collection: () => ({ kind: "days", publicationId: root.id, get: async () => ({ size: dayDocumentsFor(root.id).length, docs: dayDocumentsFor(root.id) }) }) } });
  const query = (filters: Array<[string, string, string]> = []) => ({ kind: "publications", filters, where(field: string, operator: string, value: string) { return query([...filters, [field, operator, value]]); }, orderBy() { return this; }, limit() { return this; }, get: async () => { const matching = roots.filter(root => filters.every(([field, operator, value]) => operator === "==" ? String(root.value[field as keyof typeof root.value]) === value : operator === ">=" ? root.value[field as keyof typeof root.value] >= value : root.value[field as keyof typeof root.value] < value)); return { size: matching.length, docs: matching.map(documentFor) }; } });
  const publicationCollection = { doc: (id: string) => ({ get: async () => documentFor(roots.find(root => root.id === id) || roots[0]) }), where: (field: string, operator: string, value: string) => query([[field, operator, value]]), orderBy: () => query() };
  const db = { collection: (name: string) => name === "fikaMenuPlanningPublications" ? publicationCollection : {} } as any;
  const transaction = { get: async (target: any) => {
    if (target?.kind === "days") return { size: dayDocumentsFor(target.publicationId).length, docs: dayDocumentsFor(target.publicationId) };
    const filters = target?.filters || [];
    const matching = roots.filter(root => filters.every(([field, operator, value]: [string, string, string]) => operator === "==" ? String(root.value[field as keyof typeof root.value]) === value : operator === ">=" ? root.value[field as keyof typeof root.value] >= value : root.value[field as keyof typeof root.value] < value));
    return { size: matching.length, docs: matching.map(documentFor) };
  } } as any;
  return { repository: new MenuPlanningFirestoreRepository(db), transaction, publicationId };
}

test("Firestore diff creates a blank week, its seven days, and a first entry", async () => {
  const h = harness();
  const createdWeek = { ...week("rolling-week:2026-08-24"), dayIds: Array.from({ length: 7 }, (_, i) => `rolling-week:2026-08-24:day:${i}`) };
  const createdDays = createdWeek.dayIds.map(id => day(id, createdWeek.id));
  createdDays[0].entryIds = ["entry-1"];
  await (h.repository as any).writeRollingDiff(h.transaction, state([], [], []), state([createdWeek], createdDays, [entry("entry-1", createdDays[0].id)]));
  assert.equal(h.writes.filter(write => write.path.startsWith("fikaMenuPlanningWeeks/") && !write.path.includes("/days/")).length, 1);
  assert.equal(h.writes.filter(write => write.path.includes("/days/") && !write.path.includes("/entries/")).length, 7);
  assert.equal(h.writes.filter(write => write.path.includes("/entries/")).length, 1);
});

test("publication day ownership comes from the parent Firestore path", async () => {
  const h = publicationReadHarness();
  const byId = await h.repository.getPublicationById(h.publicationId);
  const byWeek = await h.repository.readPublicationStateForWeek("rolling-week:2026-09-14");
  const byRange = await h.repository.readPublicationStateForDateRange("2026-09-14", "2026-09-21");
  const listed = await h.repository.listPublicationState();
  const transactional = await (h.repository as any).readPublications(h.transaction, "rolling-week:2026-09-14", false);
  assert.equal(byId?.days.length, 1);
  assert.equal(byWeek.publications[0].days.length, 1);
  assert.equal(byRange.publications[0].days.length, 1);
  assert.equal(listed.publications[0].days.length, 1);
  assert.equal(listed.publications.length, 2);
  assert.equal(listed.publications[1].days.length, 1);
  assert.equal(transactional.publications[0].days.length, 1);
  assert.equal(transactional.publications[0].days[0].publicationId, h.publicationId);
  assert.equal(transactional.publications[0].days[0].publicationDayId, byId?.days[0].publicationDayId);
  assert.equal(transactional.publications.find((publication: any) => publication.publicationId !== h.publicationId)?.days.length, undefined);
});

test("Firestore diff compares existing documents and does not rewrite identical state", async () => {
  const h = harness();
  const existingWeek = week("week-1");
  const existingDay = { ...day("week-1:day:0", existingWeek.id), entryIds: ["entry-1"] };
  const existingEntry = entry("entry-1", existingDay.id);
  const before = state([existingWeek], [existingDay], [existingEntry]);
  await (h.repository as any).writeRollingDiff(h.transaction, before, structuredClone(before));
  assert.equal(h.writes.length, 0);
  const changed = { ...existingEntry, portions: 2 };
  await (h.repository as any).writeRollingDiff(h.transaction, before, state([existingWeek], [{ ...existingDay, entryIds: [changed.id] }], [changed]));
  assert.equal(h.writes.length, 1);
  assert.match(h.writes[0].path, /entries\/entry-1$/);
});

test("a failed transaction applies no queued week/day/entry writes", async () => {
  const h = harness();
  const pending: typeof h.writes = [];
  const atomicTransaction = { set: (document: { path: string }, value: unknown) => pending.push({ path: document.path, value }) } as any;
  const createdWeek = { ...week("week-failed"), dayIds: ["week-failed:day:0"] };
  const createdDay = day(createdWeek.dayIds[0], createdWeek.id);
  await assert.rejects(async () => {
    await (h.repository as any).writeRollingDiff(atomicTransaction, state([], [], []), state([createdWeek], [createdDay], []));
    throw new Error("abort transaction");
  });
  assert.equal(pending.length, 2);
  const committed: typeof h.writes = [];
  try { throw new Error("abort transaction"); } catch { /* the transaction boundary discards pending writes */ }
  assert.equal(committed.length, 0);
});

test("Firestore publication diff persists lifecycle and archive metadata without changing immutable content", async () => {
  const h = harness();
  const publicationId = "menu-publication:week-1";
  const dayId = `${publicationId}:day:0:v1`;
  const oldDay = { publicationDayId: dayId, sourceDayId: "week-1:day:0", date: "2026-08-24", dayName: "Monday", version: 1, status: "published", contentHash: "content-hash", publishedAt: "2026-08-24T10:00:00.000Z", publishedBy: "test", entries: [], publicationId };
  const publication = { publicationId, sourceWeekId: "week-1", weekCommencing: "2026-08-24", weekEnding: "2026-08-30", days: [oldDay], audit: [] };
  const nextDay = { ...oldDay, status: "withdrawn", withdrawal: { actor: "test", at: "2026-08-24T11:00:00.000Z", reason: "Correction required" }, driveArchive: { status: "saved", account: "test", fileName: "menu.pdf", archivedAt: "2026-08-24T11:00:00.000Z", pdfStatus: "saved", pdfFileName: "menu.pdf" } };
  await (h.repository as any).writePublicationDiff(h.transaction, { version: 2, publications: [publication], events: [] }, { version: 2, publications: [{ ...publication, days: [nextDay] }], events: [] });
  assert.equal(h.writes.length, 1);
  assert.match(h.writes[0].path, /fikaMenuPlanningPublications\/menu-publication:week-1\/days\/menu-publication:week-1:day:0:v1$/);
  assert.equal((h.writes[0].value as any).publicationId, publicationId);
  assert.equal((h.writes[0].value as any).contentHash, oldDay.contentHash);
  assert.equal((h.writes[0].value as any).status, "withdrawn");
});

test("Firestore publication diff still rejects changed immutable publication content", async () => {
  const h = harness();
  const publicationId = "menu-publication:week-2";
  const dayId = `${publicationId}:day:0:v1`;
  const oldDay = { publicationDayId: dayId, sourceDayId: "week-2:day:0", date: "2026-08-31", dayName: "Monday", version: 1, status: "published", contentHash: "content-hash", publishedAt: "2026-08-31T10:00:00.000Z", publishedBy: "test", entries: [], publicationId };
  const publication = { publicationId, sourceWeekId: "week-2", weekCommencing: "2026-08-31", weekEnding: "2026-09-06", days: [oldDay], audit: [] };
  await assert.rejects(
    () => (h.repository as any).writePublicationDiff(h.transaction, { version: 2, publications: [publication], events: [] }, { version: 2, publications: [{ ...publication, days: [{ ...oldDay, contentHash: "changed-content" }] }], events: [] }),
    /Immutable publication day .* differs from stored state\./,
  );
  assert.equal(h.writes.length, 0);
});

test("Firestore publication diff writes the complete weekly packet on the publication root", async () => {
  const h = harness();
  const publicationId = "menu-publication:week-packet";
  const packet = encodeWeeklyPublicationPacket({
    publicationId,
    sourceWeekId: "week-packet",
    sourceWeekVersion: 7,
    publicationVersion: 1,
    days: [{ sourceDayId: "week-packet:day:0", entries: [{ sourceEntryId: "entry:1", canonicalDishId: "dish:1", portions: 12, allocations: [{ destinationId: "oploc:1", destinationLabel: "Haleon", quantity: 12 }] }] }],
  });
  const publication = { publicationId, sourceWeekId: "week-packet", weekCommencing: "2026-09-07", weekEnding: "2026-09-13", publicationVersion: 1, weekPacket: packet, days: [], audit: [] };
  await (h.repository as any).writePublicationDiff(h.transaction, { version: 2, publications: [], events: [] }, { version: 2, publications: [publication], events: [] });
  const rootWrite = h.writes.find(write => write.path === `fikaMenuPlanningPublications/${publicationId}`);
  assert.ok(rootWrite);
  assert.equal((rootWrite.value as any).weekPacket.manifest.contentHash, packet.manifest.contentHash);
  assert.equal((rootWrite.value as any).weekPacket.manifest.recordCount, 1);
  assert.equal(h.writes.some(write => write.path.includes("/days/")), false);
});
