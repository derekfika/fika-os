import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OperationBudget, assertOperationBudget, assertSameOperationShape } from "../../../test-support/operation-budget";
import { MenuPlanningFirestoreRepository } from "../lib/firestore-operational-store";
import { readCatalogueDocumentsByIds } from "../lib/canonical-menu-repository";
import type { RollingDay, RollingEntry, RollingWeek } from "../lib/rolling-menu-types";

const makeWeek = (entryIds: string[], dayIds = ["week:budget:day:0"]): RollingWeek => ({
  id: "week:budget",
  weekCommencing: "2026-09-14",
  weekEnding: "2026-09-20",
  status: "draft",
  version: 1,
  dayIds,
  entryIds,
  sourceFiles: [],
  audit: [],
});
const makeDay = (id = "week:budget:day:0", entryIds: string[] = []): RollingDay => ({ id, date: "2026-09-14", dayName: "Monday", entryIds });
const makeEntry = (id: string, dayId = "week:budget:day:0"): RollingEntry => ({ id, dayId, date: "2026-09-14", slot: "SOUP", itemLabel: id, portions: 1, allocations: [], allergens: {}, audit: [] });

function mutationHarness(entryCount: number) {
  const budget = new OperationBudget();
  const docs = new Map<string, unknown>();
  const ref = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), collection: (name: string) => ref(`${path}/${name}`) });
  const weekId = "week:budget";
  const dayId = `${weekId}:day:0`;
  const entries = Array.from({ length: entryCount }, (_, index) => makeEntry(`${weekId}:entry:${index}`, dayId));
  docs.set(`fikaMenuPlanningWeeks/${weekId}`, makeWeek(entries.map(entry => entry.id)));
  docs.set(`fikaMenuPlanningWeeks/${weekId}/days/${dayId}`, makeDay(dayId, entries.map(entry => entry.id)));
  for (const entry of entries) docs.set(`fikaMenuPlanningWeeks/${weekId}/days/${dayId}/entries/${entry.id}`, entry);
  const snapshot = (target: any) => ({ exists: docs.has(target.path), data: () => structuredClone(docs.get(target.path)) });
  const db = {
    collection: (name: string) => ref(name),
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => {
      const pending: Array<{ target: any; value: unknown }> = [];
      const transaction = {
        get: async (target: any) => { budget.read(1, "transaction"); return snapshot(target); },
        getAll: async (...targets: any[]) => { budget.read(targets.length, "transaction"); return targets.map(snapshot); },
        set: (target: any, value: unknown) => { pending.push({ target, value }); budget.write(); },
      };
      const result = await callback(transaction);
      for (const write of pending) docs.set(write.target.path, structuredClone(write.value));
      return result;
    },
  } as any;
  return { repository: new MenuPlanningFirestoreRepository(db), budget, docs, weekId, dayId, entries };
}

const entryCommand = (weekId: string, entry: RollingEntry, expectedWeekVersion: number, label: string) => ({
  weekId,
  expectedWeekVersion,
  touchedEntryIds: [entry.id],
  touchedDayIds: [entry.dayId],
  entryDayIds: { [entry.id]: entry.dayId },
  patch: { entries: { [entry.id]: { itemLabel: label } } },
  audit: { action: "entry-amended", at: "2026-09-15T10:00:00.000Z", by: "person:manager" },
});

test("working-week command budgets are independent of fixture growth", async () => {
  const small = mutationHarness(10);
  const large = mutationHarness(500);
  await small.repository.mutateRollingCommand(entryCommand(small.weekId, small.entries[0], 1, "small"));
  await large.repository.mutateRollingCommand(entryCommand(large.weekId, large.entries[0], 1, "large"));
  assert.deepEqual(small.budget.snapshot(), large.budget.snapshot());
  assert.equal(small.budget.counts.attemptedReads, 2);
  assert.equal(small.budget.counts.writes, 2);
  assertOperationBudget("one-entry mutation", small.budget.counts.attemptedReads, 2, "reads");
  assertOperationBudget("one-entry mutation", small.budget.counts.writes, 2, "writes");
});

test("batch entry commands scale only with touched entries", async () => {
  const makeBatch = async (entryCount: number) => {
    const h = mutationHarness(entryCount);
    const touched = h.entries.slice(0, 2);
    await h.repository.mutateRollingCommand({
      weekId: h.weekId,
      expectedWeekVersion: 1,
      touchedEntryIds: touched.map(entry => entry.id),
      touchedDayIds: [h.dayId],
      entryDayIds: Object.fromEntries(touched.map(entry => [entry.id, h.dayId])),
      patch: { entries: Object.fromEntries(touched.map(entry => [entry.id, { portions: entry.portions + 1 }])) },
      audit: { action: "portion-allocations-batch-saved", at: "2026-09-15T10:00:00.000Z", by: "person:manager" },
    });
    return h.budget.snapshot();
  };
  const small = await makeBatch(10);
  const large = await makeBatch(500);
  assertSameOperationShape("batch entry mutation", small, large);
  assert.equal(small.attemptedReads, 3);
  assert.equal(small.writes, 3);
});

test("stale working-week commands fail closed with bounded reads and no writes", async () => {
  const h = mutationHarness(500);
  h.docs.set(`fikaMenuPlanningWeeks/${h.weekId}`, { ...makeWeek(h.entries.map(entry => entry.id)), version: 2 });
  await assert.rejects(() => h.repository.mutateRollingCommand(entryCommand(h.weekId, h.entries[0], 1, "stale")), (error: any) => error.status === 409);
  assertOperationBudget("stale CAS", h.budget.counts.attemptedReads, 1, "reads");
  assert.equal(h.budget.counts.writes, 0);
});

test("targeted catalogue ID lookup is bounded by K, not catalogue size", async () => {
  const ids = ["dish:1", "dish:2", "dish:3", "dish:missing"];
  const readShape = async (catalogueSize: number) => {
    const budget = new OperationBudget();
    const records = new Map(Array.from({ length: catalogueSize }, (_, index) => [`dish:${index}`, { id: `dish:${index}`, exists: true, data: () => ({ kind: "dish", record: { canonicalId: `dish:${index}` } }) }]));
    await readCatalogueDocumentsByIds(ids, async batch => {
      return batch.map(id => { budget.documentRead(records.has(id)); return records.get(id); });
    });
    return budget.snapshot();
  };
  const small = await readShape(20);
  const large = await readShape(2000);
  assertSameOperationShape("catalogue targeted lookup", small, large);
  assert.equal(small.attemptedReads, ids.length);
  assert.equal(small.missingDocuments, 1);
});

test("normal publication remains targeted and does not reconcile the catalogue", () => {
  const publication = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.match(publication, /listCanonicalMenuItemsByIds/);
  assert.doesNotMatch(publication, /syncRollingEntries|reconcileCatalogueFromRollingEntries/);
  const publishRoute = route.slice(route.indexOf('if (action === "publish")'));
  assert.doesNotMatch(publishRoute, /listCanonicalMenuItems\(|listCatalogueEntries\(|reconcileCatalogueFromRollingEntries/);
});
