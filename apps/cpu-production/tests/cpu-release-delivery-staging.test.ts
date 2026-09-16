import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "firebase-admin/firestore";
import type { ProductionPlan } from "../app/lib/production-plan";
import { appendCpuChangeInTransaction } from "../lib/cpu-projection-repository";
import { CPU_PROPAGATION_OUTBOX_COLLECTION, listCpuOutboxForTests, resetCpuOutboxForTests, type CpuDurableDeliveryInput } from "../lib/cpu-durable-outbox";
import { createProductionPlanRepository } from "../lib/production-plan-repository";

const propagation = {
  eventId: "cpu-change:release-delivery:v1",
  sourceEntityId: "production-plan:release-delivery",
  serviceDate: "2026-09-14",
  sourceVersion: 7,
  changedAt: "2026-09-14T10:00:00.000Z",
  changeType: "release-current",
  order: { origin: "menu_planning", destinationOplocId: "oploc:xchange" },
  logistics: true,
};

const delivery = (eventId = "cpu-release:release-1:oploc:xchange") : CpuDurableDeliveryInput => ({
  eventId,
  sourceAggregateId: "cpu-allergen-release:2026-09-14:v3",
  sourceVersion: 3,
  occurredAt: "2026-09-14T10:00:00.000Z",
  consumer: "delivered-in",
  route: "/api/internal/cpu-release-event",
  body: { releaseId: "cpu-allergen-release:2026-09-14:v3", orderId: "production-order:xchange" },
});

type Snapshot = { exists: boolean; data: () => Record<string, unknown> | undefined };
type RecordedWrite = { path: string; data: unknown };

function fakeTransaction(options: { receiptEvent?: Record<string, unknown>; existingEventIds?: string[] } = {}) {
  const reads: string[] = [];
  const creates: RecordedWrite[] = [];
  const sets: RecordedWrite[] = [];
  const existingEventIds = new Set(options.existingEventIds || []);
  const transaction = {
    get: async (ref: { path: string; id: string }): Promise<Snapshot> => {
      reads.push(ref.path);
      if (ref.path.includes("fikaCpuProductionChangeReceiptsV1") && options.receiptEvent) return { exists: true, data: () => ({ event: options.receiptEvent }) };
      if (ref.path.includes(CPU_PROPAGATION_OUTBOX_COLLECTION) && existingEventIds.has(ref.id)) return { exists: true, data: () => ({}) };
      return { exists: false, data: () => undefined };
    },
    create: (ref: { path: string }, data: unknown) => creates.push({ path: ref.path, data }),
    set: (ref: { path: string }, data: unknown) => sets.push({ path: ref.path, data }),
  } as unknown as Transaction;
  return { transaction, reads, creates, sets };
}

function outboxCreates(writes: RecordedWrite[]) {
  return writes.filter(write => write.path.includes(CPU_PROPAGATION_OUTBOX_COLLECTION));
}

test("a CPU change with standalone deliveries stages the release obligation", async () => {
  const recorded = fakeTransaction();
  await appendCpuChangeInTransaction(recorded.transaction, { entityType: "productionPlan", entityId: "plan:standalone-delivery", changeType: "release-current", actorId: "test", changedAt: propagation.changedAt, deliveries: [delivery()] });
  const writes = outboxCreates(recorded.creates);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path.endsWith(`/${delivery().eventId}`), true);
  assert.equal((writes[0].data as { eventType: string }).eventType, "cpu.consumer.release");
});

test("propagation plus standalone deliveries stages both event families", async () => {
  const recorded = fakeTransaction();
  await appendCpuChangeInTransaction(recorded.transaction, { entityType: "productionPlan", entityId: propagation.sourceEntityId, changeType: propagation.changeType, actorId: "test", changedAt: propagation.changedAt, propagation, deliveries: [delivery("cpu-release:release-1:oploc:xchange:with-propagation")] });
  const writes = outboxCreates(recorded.creates);
  assert.equal(writes.length, 3);
  assert.equal(writes.filter(write => (write.data as { eventType: string }).eventType === "cpu.consumer.invalidate").length, 2);
  assert.equal(writes.filter(write => (write.data as { eventType: string }).eventType === "cpu.consumer.release").length, 1);
});

test("a duplicate receipt re-establishes a missing delivery without duplicating an existing one", async () => {
  const input = { entityType: "productionPlan", entityId: "plan:duplicate-delivery", changeType: "release-current", actorId: "test", changedAt: propagation.changedAt, idempotencyKey: "release-delivery:duplicate", deliveries: [delivery("cpu-release:duplicate")] };
  const missing = fakeTransaction({ receiptEvent: { entityType: "productionPlan", sequence: 42 } });
  const existing = fakeTransaction({ receiptEvent: { entityType: "productionPlan", sequence: 42 }, existingEventIds: ["cpu-release:duplicate"] });
  await appendCpuChangeInTransaction(missing.transaction, input);
  await appendCpuChangeInTransaction(existing.transaction, input);
  assert.equal(outboxCreates(missing.creates).length, 1);
  assert.equal(outboxCreates(existing.creates).length, 0);
  assert.equal(missing.sets.length, 0);
  assert.equal(existing.sets.length, 0);
});

test("no propagation and no deliveries retains the existing CPU change path", async () => {
  const recorded = fakeTransaction();
  await appendCpuChangeInTransaction(recorded.transaction, { entityType: "productionPlan", entityId: "plan:no-delivery", changeType: "status-only", actorId: "test", changedAt: "2026-09-14T10:00:00.000Z" });
  assert.equal(outboxCreates(recorded.creates).length, 0);
  assert.equal(recorded.reads.filter(path => path.includes(CPU_PROPAGATION_OUTBOX_COLLECTION)).length, 0);
});

test("standalone delivery writes use the supplied transaction", async () => {
  const recorded = fakeTransaction();
  resetCpuOutboxForTests();
  await appendCpuChangeInTransaction(recorded.transaction, { entityType: "productionPlan", entityId: "plan:transactional-delivery", changeType: "release-current", actorId: "test", changedAt: propagation.changedAt, deliveries: [delivery("cpu-release:transactional")] });
  assert.equal(outboxCreates(recorded.creates).length, 1);
  assert.equal(listCpuOutboxForTests().length, 0, "transaction-bound staging must not enqueue through the process-local path");
});

test("the memory ProductionPlan repository preserves standalone delivery semantics", async () => {
  const previousStore = process.env.FIKA_CPU_PLAN_STORE;
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  resetCpuOutboxForTests();
  const plan = { id: "production-plan:memory-delivery", orderId: "production-order:memory-delivery", status: "planned" as const, menuItems: [], planningNotes: "", updatedAt: "2026-09-14T10:00:00.000Z", updatedBy: "test", audit: [] } satisfies ProductionPlan;
  try {
    await createProductionPlanRepository().saveAndAppendCpuChange(plan, undefined, { entityType: "productionPlan", entityId: plan.id, changeType: "release-current", actorId: "test", changedAt: plan.updatedAt, deliveries: [delivery("cpu-release:memory")] });
    assert.deepEqual(listCpuOutboxForTests().map(event => event.eventId), ["cpu-release:memory"]);
  } finally {
    if (previousStore === undefined) delete process.env.FIKA_CPU_PLAN_STORE;
    else process.env.FIKA_CPU_PLAN_STORE = previousStore;
    resetCpuOutboxForTests();
  }
});
