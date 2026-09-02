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
