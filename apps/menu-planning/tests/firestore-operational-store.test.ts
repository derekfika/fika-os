import assert from "node:assert/strict";
import test from "node:test";
import { MenuPlanningFirestoreRepository, type HostedTransactionState } from "../lib/firestore-operational-store";
import { markEventDeadLetter, markEventDelivered, markEventFailed, outboxRecord, resetEventForReplay, type DurableDomainEvent } from "../lib/fika-contracts";
import type { RollingDay, RollingEntry, RollingWeek } from "../lib/rolling-menu-types";
import { encodeWeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";
import { OperationBudget } from "../../../test-support/operation-budget";

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

function createOnlyHarness() {
  const docs = new Map<string, unknown>();
  const reads: string[] = [];
  const writes: string[] = [];
  const ref = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), collection: (name: string) => ref(`${path}/${name}`) });
  const db = {
    collection: (name: string) => ref(name),
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => {
      const pending: Array<{ path: string; value: unknown }> = [];
      const transaction = {
        get: async (target: any) => { reads.push(target.path); const value = docs.get(target.path); return { exists: value !== undefined, data: () => structuredClone(value) }; },
        create: (target: any, value: unknown) => { if (docs.has(target.path) || pending.some(write => write.path === target.path)) throw Object.assign(new Error("already exists"), { code: 6 }); pending.push({ path: target.path, value }); },
      };
      const result = await callback(transaction);
      if (pending.some(write => docs.has(write.path))) throw Object.assign(new Error("already exists"), { code: 6 });
      for (const write of pending) { docs.set(write.path, structuredClone(write.value)); writes.push(write.path); }
      return result;
    },
  } as any;
  return { repository: new MenuPlanningFirestoreRepository(db), docs, reads, writes };
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

const event = (id: string, status: "pending" | "delivered" | "failed", sourceVersion: number, nextAttemptAt?: string): DurableDomainEvent => ({
  eventId: id, eventType: "production.materialise", sourceAggregateId: "aggregate:one", sourceVersion, occurredAt: "2026-08-24T10:00:00.000Z", schemaVersion: "0.1.0", payload: {},
  delivery: { status, attempts: status === "failed" ? 1 : 0, ...(nextAttemptAt ? { nextAttemptAt } : {}), ...(status === "delivered" ? { deliveredAt: "2026-08-24T10:00:00.000Z" } : {}) },
});

function boundedQueueHarness(events: DurableDomainEvent[]) {
  const eventDocs = new Map(events.map(value => [value.eventId, structuredClone(value)]));
  const outboxDocs = new Map(events.map(value => [value.eventId, outboxRecord(value)]));
  const budget = new OperationBudget();
  const query = (collection: string, filters: Array<[string, string, unknown]> = [], ordering: Array<[string, "asc" | "desc"]> = [], limitCount?: number, cursor?: unknown[]): any => ({
    kind: "query", collection, filters, ordering, limitCount, cursor,
    where(field: string, operator: string, value: unknown) { return query(collection, [...filters, [field, operator, value]], ordering, limitCount, cursor); },
    orderBy(field: string, direction: "asc" | "desc" = "asc") { return query(collection, filters, [...ordering, [field, direction]], limitCount, cursor); },
    limit(value: number) { return query(collection, filters, ordering, value, cursor); },
    startAfter(...values: unknown[]) { return query(collection, filters, ordering, limitCount, values); },
  });
  const document = (collection: string, id: string) => ({ kind: "document", collection, id, path: `${collection}/${id}` });
  const valueAt = (value: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value);
  const db = {
    collection: (name: string) => ({
      where: (field: string, operator: string, value: unknown) => query(name, [[field, operator, value]]),
      orderBy: (field: string, direction: "asc" | "desc" = "asc") => query(name, [], [[field, direction]]),
      doc: (id: string) => document(name, id),
    }),
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => {
      const pending: Array<{ target: any; value: any }> = [];
      const transaction = {
        get: async (target: any) => {
          if (target.kind === "document") {
            budget.read();
            const value = target.collection === "fikaMenuPlanningEvents" ? eventDocs.get(target.id) : outboxDocs.get(target.id);
            return { id: target.id, exists: value !== undefined, data: () => structuredClone(value) };
          }
          let values = [...(target.collection === "fikaMenuPlanningEvents" ? eventDocs.values() : outboxDocs.values())];
          values = values.filter(value => target.filters.every(([field, operator, expected]: [string, string, unknown]) => {
            const actual = valueAt(value as Record<string, unknown>, field);
            return operator === "in" ? (expected as unknown[]).includes(actual) : operator === "==" ? actual === expected : operator === "<=" ? String(actual || "") <= String(expected) : true;
          }));
          if (target.ordering.length) values.sort((left, right) => { for (const [field, direction] of target.ordering) { const a = field === "__name__" ? String((left as any).eventId) : String(valueAt(left as Record<string, unknown>, field) || ""); const b = field === "__name__" ? String((right as any).eventId) : String(valueAt(right as Record<string, unknown>, field) || ""); const comparison = a.localeCompare(b); if (comparison) return comparison * (direction === "desc" ? -1 : 1); } return 0; });
          if (target.cursor?.length) values = values.filter(value => { const fields = target.ordering.map(([field]: [string, string]) => field === "__name__" ? String((value as any).eventId) : String(valueAt(value as Record<string, unknown>, field) || "")); for (let index = 0; index < fields.length; index += 1) { const comparison = fields[index].localeCompare(String(target.cursor[index] || "")); if (comparison) return comparison > 0; } return false; });
          if (target.limitCount !== undefined) values = values.slice(0, target.limitCount);
          budget.queryReturned(values.length);
          return { size: values.length, docs: values.map(value => ({ id: (value as any).eventId, exists: true, data: () => structuredClone(value) })) };
        },
        set: (target: any, value: unknown) => pending.push({ target, value }),
      };
      const result = await callback(transaction);
      for (const write of pending) {
        if (write.target.collection === "fikaMenuPlanningEvents") eventDocs.set(write.target.id, structuredClone(write.value));
        else outboxDocs.set(write.target.id, structuredClone(write.value));
      }
      return result;
    },
  } as any;
  return { repository: new MenuPlanningFirestoreRepository(db), eventDocs, outboxDocs, budget, get attemptedReads() { return budget.counts.attemptedReads; }, resetReads() { budget.counts.attemptedReads = 0; budget.counts.returnedDocuments = 0; budget.counts.queueCandidates = 0; } };
}

const queued = (id: string, status: "pending" | "delivered" | "failed", sourceVersion: number, dueAt: string, predecessorEventId?: string, sourceAggregateId = "aggregate:one") => {
  const value = event(id, status, sourceVersion, dueAt);
  return { ...value, sourceAggregateId, ...(predecessorEventId ? { predecessorEventId } : {}), delivery: { ...value.delivery, nextAttemptAt: dueAt, nextEligibleAt: dueAt } };
};

test("indexed outbox claims are bounded, non-starving, and independent of delivered history", async () => {
  const at = new Date("2026-08-24T10:00:00.000Z");
  const history = Array.from({ length: 1000 }, (_, index) => event(`historic-${index}`, "delivered", index + 1));
  const pending = queued("pending-now", "pending", 1001, at.toISOString());
  const failed = queued("failed-retry", "failed", 1002, at.toISOString());
  const future = queued("future", "pending", 1003, "2026-08-25T10:00:00.000Z");
  const h = boundedQueueHarness([...history, pending, failed, future]);
  const claimed = await h.repository.claimNextEvent("worker-a", at);
  assert.equal(claimed?.eventId, pending.eventId);
  assert.equal(h.attemptedReads, 5, "cursor marker + 2 indexed candidates + 2 bounded authoritative event reads");
  assert.equal(claimed?.delivery.leaseOwner, "worker-a");
  assert.ok(claimed?.delivery.leaseExpiresAt);

  h.resetReads();
  const manyFuture = Array.from({ length: 100 }, (_, index) => queued(`future-window-${index}`, "pending", index + 1, "2026-08-25T10:00:00.000Z"));
  const dueOutsideWindow = queued("due-outside-window", "pending", 101, at.toISOString());
  const starvation = boundedQueueHarness([...manyFuture, dueOutsideWindow]);
  const recovered = await starvation.repository.claimNextEvent("worker-b", at);
  assert.equal(recovered?.eventId, dueOutsideWindow.eventId, "an indexed due query reaches work outside the legacy candidate window");
  assert.ok(starvation.attemptedReads <= 60, `one page claim remains bounded: ${starvation.attemptedReads} reads`);

  const page = boundedQueueHarness(Array.from({ length: 25 }, (_, index) => queued(`page-${index}`, "pending", index + 1, at.toISOString())));
  assert.ok((await page.repository.claimNextEvent("worker-page", at))?.eventId);
  assert.equal(page.attemptedReads, 51, "25 eligible events are one indexed page plus 25 bounded authoritative event reads, not 25 x 100 scans");
  assert.equal(page.budget.counts.queueCandidates, 25);
});

test("outbox leases expire, retries remain durable, and aggregate predecessors are bounded", async () => {
  const at = new Date("2026-08-24T10:00:00.000Z");
  const predecessor = queued("predecessor", "pending", 1, "2026-08-25T10:00:00.000Z");
  const successor = queued("successor", "pending", 2, at.toISOString(), predecessor.eventId);
  const independent = queued("independent", "pending", 1, at.toISOString(), undefined, "aggregate:two");
  const h = boundedQueueHarness([predecessor, successor, independent]);
  const first = await h.repository.claimNextEvent("worker-a", at);
  assert.equal(first?.eventId, independent.eventId, "an independent aggregate is not blocked by a predecessor");
  await h.repository.updateEvent(first!.eventId, current => markEventDelivered(current, at.toISOString()));
  const blocked = await h.repository.claimNextEvent("worker-b", at);
  assert.equal(blocked, undefined, "a successor cannot overtake an undelivered predecessor");
  h.eventDocs.set(predecessor.eventId, markEventDelivered(predecessor, at.toISOString()));
  h.outboxDocs.set(predecessor.eventId, outboxRecord(markEventDelivered(predecessor, at.toISOString())));
  const next = await h.repository.claimNextEvent("worker-b", at);
  assert.equal(next?.eventId, successor.eventId);

  const leaseEvent = queued("lease-event", "pending", 1, at.toISOString());
  const leaseHarness = boundedQueueHarness([leaseEvent]);
  assert.equal((await leaseHarness.repository.claimNextEvent("worker-a", at))?.eventId, leaseEvent.eventId);
  assert.equal(await leaseHarness.repository.claimNextEvent("worker-b", at), undefined, "a live lease is exclusive");
  assert.equal((await leaseHarness.repository.claimNextEvent("worker-b", new Date("2026-08-24T10:01:01.000Z")))?.eventId, leaseEvent.eventId, "an expired lease is recoverable");

  const retry = queued("retry-event", "failed", 1, at.toISOString());
  const retryHarness = boundedQueueHarness([retry]);
  const retryClaim = await retryHarness.repository.claimNextEvent("worker-retry", at);
  const failedAgain = await retryHarness.repository.updateEvent(retryClaim!.eventId, current => ({ ...current, delivery: { ...current.delivery, status: "failed", attempts: current.delivery.attempts + 1, nextAttemptAt: "2026-08-24T10:00:30.000Z", nextEligibleAt: "2026-08-24T10:00:30.000Z", claimId: undefined, leaseOwner: undefined, claimedAt: undefined, leaseExpiresAt: undefined } }));
  assert.equal(failedAgain?.delivery.status, "failed");
  assert.equal((await retryHarness.repository.claimNextEvent("worker-retry", new Date("2026-08-24T10:00:29.000Z"))), undefined);
  assert.equal((await retryHarness.repository.claimNextEvent("worker-retry", new Date("2026-08-24T10:00:30.000Z")))?.eventId, retry.eventId);

  const redelivery = queued("stable-event", "pending", 1, at.toISOString());
  const redeliveryHarness = boundedQueueHarness([redelivery]);
  const firstDelivery = await redeliveryHarness.repository.claimNextEvent("worker-stable", at);
  await redeliveryHarness.repository.updateEvent(firstDelivery!.eventId, current => markEventDelivered(current, at.toISOString()));
  assert.equal(await redeliveryHarness.repository.claimNextEvent("worker-stable-retry", new Date("2026-08-24T10:02:00.000Z")), undefined, "the stable event identity is harmless after delivery is durably recorded");
});

test("dead-letter state is explicit and never eligible for a claim", async () => {
  const value = queued("dead-letter", "pending", 1, "2026-08-24T10:00:00.000Z");
  const dead = markEventDeadLetter(value, "manual repair required", "2026-08-24T10:00:00.000Z");
  const h = boundedQueueHarness([dead]);
  assert.equal(dead.delivery.status, "dead-letter");
  assert.equal(await h.repository.claimNextEvent("worker", new Date("2026-08-24T10:01:00.000Z")), undefined);
});

test("compatibility claims advance across bounded pages and dead predecessors are explicit", async () => {
  const at = new Date("2026-08-24T10:00:00.000Z");
  const futureLegacy = Array.from({ length: 60 }, (_, index) => queued(`legacy-future-${index}`, "pending", index + 1, "2026-08-25T10:00:00.000Z"));
  const due = queued("legacy-z-due-behind-pages", "pending", 61, at.toISOString());
  const h = boundedQueueHarness([...futureLegacy, due]);
  for (const value of [...futureLegacy, due]) h.outboxDocs.set(value.eventId, structuredClone(value) as any);
  const claimed = await h.repository.claimNextEvent("worker-pages", at);
  assert.equal(claimed?.eventId, due.eventId, "bounded compatibility pages reach due legacy work behind future rows");
  assert.ok(h.attemptedReads <= 105, "compatibility scanning remains capped at four 25-record pages plus bounded authority reads");

  const predecessor = queued("dead-predecessor", "pending", 1, at.toISOString());
  const successor = queued("dead-successor", "pending", 2, at.toISOString(), predecessor.eventId);
  const independent = queued("independent-after-dead", "pending", 1, at.toISOString(), undefined, "aggregate:independent");
  const deadHarness = boundedQueueHarness([predecessor, successor, independent]);
  deadHarness.eventDocs.set(predecessor.eventId, markEventDeadLetter(predecessor, "permanent downstream failure", at.toISOString()));
  deadHarness.outboxDocs.set(predecessor.eventId, outboxRecord(markEventDeadLetter(predecessor, "permanent downstream failure", at.toISOString())) as any);
  const independentClaim = await deadHarness.repository.claimNextEvent("worker-independent", at);
  assert.equal(independentClaim?.eventId, independent.eventId);
  assert.equal((deadHarness.eventDocs.get(successor.eventId) as DurableDomainEvent).delivery.status, "dead-letter", "a successor records predecessor terminal cause instead of remaining blocked forever");
});

test("a full page of blocked successors advances to eligible work behind it", async () => {
  const at = new Date("2026-08-24T10:00:00.000Z");
  const predecessors = Array.from({ length: 25 }, (_, index) => queued(`predecessor-page-${index}`, "pending", index + 1, "2026-08-25T10:00:00.000Z"));
  const blocked = predecessors.map((predecessor, index) => queued(`blocked-page-${String(index).padStart(2, "0")}`, "pending", index + 1, at.toISOString(), predecessor.eventId));
  const eligible = queued("z-eligible-behind-blocked-page", "pending", 99, at.toISOString(), undefined, "aggregate:eligible");
  const h = boundedQueueHarness([...predecessors, ...blocked, eligible]);
  assert.equal(await h.repository.claimNextEvent("worker-blocked", at), undefined);
  assert.equal((await h.repository.claimNextEvent("worker-behind", at))?.eventId, eligible.eventId);
  assert.ok(h.attemptedReads <= 110, "two fixed pages remain bounded while the cursor advances");
});

test("automatic retry exhaustion dead-letters and deliberate replay preserves identity", async () => {
  const at = new Date("2026-08-24T10:00:00.000Z");
  const value = queued("retry-exhaustion", "pending", 1, at.toISOString());
  const h = boundedQueueHarness([value]);
  let current: DurableDomainEvent = value;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    current = markEventFailed(current, `failure-${attempt}`, at.toISOString());
    h.eventDocs.set(value.eventId, current);
    h.outboxDocs.set(value.eventId, outboxRecord(current));
    if (attempt < 10) assert.equal(current.delivery.status, "failed");
  }
  assert.equal(current.delivery.status, "dead-letter");
  assert.equal(await h.repository.claimNextEvent("worker", new Date("2026-08-24T12:00:00.000Z")), undefined);
  const replayed = resetEventForReplay(current, at.toISOString(), "operator replay");
  assert.equal(replayed.eventId, value.eventId);
  assert.equal(replayed.sourceAggregateId, value.sourceAggregateId);
  assert.equal(replayed.delivery.status, "pending");
  h.eventDocs.set(value.eventId, replayed); h.outboxDocs.set(value.eventId, outboxRecord(replayed));
  assert.equal((await h.repository.claimEventById(value.eventId, "worker-replay", at)).event?.eventId, value.eventId);
});

test("baseline: the old outbox claim scans the candidate window and aggregate history", () => {
  const historical = Array.from({ length: 150 }, (_, index) => event(`delivered-${index}`, "delivered", index + 1));
  const pending = event("pending-151", "pending", 151);
  const failed = event("failed-152", "failed", 152, "2026-08-24T09:59:00.000Z");
  const oldClaim = (values: DurableDomainEvent[], at: Date) => {
    let reads = 0;
    const candidates = values.filter(value => value.delivery.status === "pending" || value.delivery.status === "failed").slice(0, 100);
    reads += candidates.length;
    const candidate = candidates.filter(value => !value.delivery.nextAttemptAt || new Date(value.delivery.nextAttemptAt) <= at).sort((a, b) => a.sourceVersion - b.sourceVersion).find(value => {
      const history = values.filter(previous => previous.sourceAggregateId === value.sourceAggregateId);
      reads += history.length;
      return !history.some(previous => previous.sourceVersion < value.sourceVersion && previous.delivery.status !== "delivered");
    });
    return { eventId: candidate?.eventId, reads };
  };
  assert.deepEqual(oldClaim([...historical, pending, failed], new Date("2026-08-24T10:00:00.000Z")), { eventId: pending.eventId, reads: 154 });

  const future = Array.from({ length: 100 }, (_, index) => event(`future-${index}`, "pending", index + 1, "2026-08-25T10:00:00.000Z"));
  const dueOutsideWindow = event("due-outside-window", "pending", 101);
  assert.deepEqual(oldClaim([...future, dueOutsideWindow], new Date("2026-08-24T10:00:00.000Z")), { eventId: undefined, reads: 100 });
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

test("Firestore create-only transaction reads one target and writes a complete bounded snapshot", async () => {
  const h = createOnlyHarness();
  const snapshot = { week: { ...week("rolling-week:create-only"), dayIds: ["rolling-week:create-only:day:0"], entryIds: ["entry:create-only"] }, days: [day("rolling-week:create-only:day:0", "rolling-week:create-only")], entries: [entry("entry:create-only", "rolling-week:create-only:day:0")] };
  await h.repository.createRollingSnapshot(snapshot);
  assert.deepEqual(h.reads, ["fikaMenuPlanningWeeks/rolling-week:create-only"]);
  assert.equal(h.writes.length, 3, "one week, one day, and one entry are atomically created");
  await assert.rejects(() => h.repository.createRollingSnapshot(snapshot), (error: any) => error.status === 409);
  assert.equal(h.writes.length, 3, "an existing target receives no replacement writes");
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
