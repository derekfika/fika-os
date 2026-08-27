import assert from "node:assert/strict";
import test from "node:test";
import { MenuPlanningFirestoreRepository, type HostedTransactionState } from "../lib/firestore-operational-store";
import type { RollingDay, RollingEntry, RollingWeek } from "../lib/rolling-menu-types";

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
