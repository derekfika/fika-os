import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDigestsMatch, canonicalProductionDigestSet } from "@fika/server-shared/canonical-production-digest";
import { DURABLE_OUTBOX_MAX_ATTEMPTS } from "@fika/server-shared/durable-outbox";
import { stableDocumentId } from "../lib/canonical-editor";
import { cpuProjectionIdempotencyKey, type CpuProjectionHandoff } from "../lib/cpu-projection-client";
import { cpuProjectionOutboxEvent, deliverCpuProjection, deliverCpuProjectionForOrder, replayCpuProjectionOutbox, resetCpuProjectionDeadLetter, summariseCpuProjectionOutbox } from "../lib/cpu-projection-outbox";
import { db } from "../lib/firebase-admin";
import { materialiseExternalProductionOrder, materialisedProductionId } from "../lib/production-domain";

const actor = { uid: "integration-materialiser", name: "Integration Materialiser", role: "integration-admin" as const, synthetic: true as const };
const outbox = () => db.collection("fikaCpuProjectionOutboxV1");
const orders = () => db.collection("fikaProductionOrdersV1");
const hash = (character: string) => character.repeat(64);

const inputFor = (sourceEntityId: string, over: Record<string, unknown> = {}) => ({
  sourceDomain: "menu-planning" as const, sourceEntityId, destinationOplocId: "oploc:haleon", serviceDate: "2026-10-12", sourceVersion: 1, sourceContentHash: hash("a"), status: "published" as const,
  lines: [{ sourceLineId: "line:one", itemName: "Owned item", quantity: 10, unit: "portion" }], ...over,
});

async function cleanup(orderId: string) {
  const batch = db.batch();
  batch.delete(orders().doc(stableDocumentId(orderId)));
  for (const collection of ["fikaCpuProjectionOutboxV1", "fikaDomainEventsV1", "fikaDomainEventInboxV1"]) for (const document of (await db.collection(collection).where("sourceAggregateId", "==", orderId).get()).docs) batch.delete(document.ref);
  for (const document of (await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get()).docs) batch.delete(document.ref);
  await batch.commit();
}
const outboxFor = async (orderId: string) => (await outbox().where("sourceAggregateId", "==", orderId).get()).docs.map(document => document.data()).sort((a, b) => a.sourceVersion - b.sourceVersion);
const makeDue = async (eventId: string) => { const ref = outbox().doc(eventId); const current = (await ref.get()).data()!; await ref.set({ ...current, nextEligibleAt: "2000-01-01T00:00:00.000Z", delivery: { ...current.delivery, nextAttemptAt: "2000-01-01T00:00:00.000Z", nextEligibleAt: "2000-01-01T00:00:00.000Z" } }); };

test("CPU change identity is the canonical order version, never a source/publication version", () => {
  const order = { canonicalId: "production-order:v1:menu-planning:rolling-week:2026-10-05:day:5:oploc:x", version: 6 };
  assert.equal(cpuProjectionIdempotencyKey(order), `cpu-projection:${order.canonicalId}:v6`);
  assert.notEqual(cpuProjectionIdempotencyKey(order), cpuProjectionIdempotencyKey({ ...order, version: 7 }));
  // Two canonical versions that carry the SAME source version (a withdrawal after an amendment) are distinct CPU changes.
  const base = { canonicalId: order.canonicalId, serviceDate: "2026-10-09", updatedAt: "2026-10-07T17:23:35.801Z", createdAt: "2026-10-07T13:56:16.229Z" };
  const amended = cpuProjectionOutboxEvent({ ...base, version: 5, status: "menu_available" })!;
  const withdrawn = cpuProjectionOutboxEvent({ ...base, version: 6, status: "cancelled" })!;
  assert.notEqual(amended.eventId, withdrawn.eventId);
  assert.equal(withdrawn.payload.changeType, "withdrawn"); assert.equal(withdrawn.payload.revision, 6); assert.equal(amended.payload.changeType, "amended");
  assert.equal(cpuProjectionOutboxEvent({ ...base, serviceDate: undefined as unknown as string, version: 2, status: "menu_available" }), undefined, "no service date -> nothing for the CPU to refresh");
});

test("materialising an order stages exactly one durable CPU obligation per canonical version, atomically with the order", async () => {
  const sourceEntityId = `cpu-outbox-stage:${Date.now()}:${process.pid}`;
  const orderId = materialisedProductionId(inputFor(sourceEntityId));
  try {
    const first = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId));
    const second = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId, { sourceVersion: 2, sourceContentHash: hash("b"), status: "amended" }));
    const duplicate = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId, { sourceVersion: 2, sourceContentHash: hash("b"), status: "amended" }));
    assert.equal(duplicate.duplicate, true);
    const events = await outboxFor(orderId);
    assert.deepEqual(events.map(event => event.eventId), [`cpu-projection:${orderId}:v1`, `cpu-projection:${orderId}:v2`], "one per canonical version; a duplicate delivery adds none");
    assert.deepEqual(events.map(event => event.payload.changeType), ["created", "amended"]);
    assert.ok(events.every(event => event.outboxStatus === "pending" && event.delivery.status === "pending"), "committed but not yet acknowledged by the CPU -> pending, not delivered");
    assert.equal(first.order.version, 1); assert.equal(second.order.version, 2);
  } finally { await cleanup(orderId); }
});

test("a failed CPU handoff stays pending/failed and retryable - never reported as delivered - and converges without duplicate CPU changes", async () => {
  const sourceEntityId = `cpu-outbox-retry:${Date.now()}:${process.pid}`;
  const orderId = materialisedProductionId(inputFor(sourceEntityId));
  try {
    const { order } = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId));
    const eventId = `cpu-projection:${orderId}:v1`;
    const received: CpuProjectionHandoff[] = [];
    // 1. CPU is down: in-request attempt fails.
    const down = await deliverCpuProjectionForOrder(order, undefined, async () => { throw new Error("CPU projection handoff failed (409)."); });
    assert.equal(down.state, "pending"); assert.equal(down.deliveryStatus, "failed"); assert.equal(down.attempts, 1); assert.match(down.lastError!, /409/);
    assert.equal((await summariseCpuProjectionOutbox()).outstanding.some(event => event.eventId === eventId && event.status === "failed"), true, "visible to operators");
    // 2. It is not due again immediately (existing 30 s retry convention): no second attempt, no false delivery.
    const early = await deliverCpuProjection(eventId, async handoff => { received.push(handoff); return { applied: true }; });
    assert.equal(early?.delivery.status, "failed"); assert.equal(received.length, 0);
    // 3. The scheduled tick retries when due and the CPU acknowledges: delivered with the exact canonical-version handoff.
    await makeDue(eventId);
    const tick = await replayCpuProjectionOutbox(50, async handoff => { received.push(handoff); return { applied: true }; });
    assert.ok(tick.events.some(event => event.eventId === eventId && event.status === "delivered"));
    assert.deepEqual(received.filter(handoff => handoff.entityId === orderId).map(handoff => [handoff.revision, handoff.idempotencyKey]), [[1, eventId]]);
    // 4. Converged: further ticks and in-request calls never send it again.
    await replayCpuProjectionOutbox(50, async handoff => { received.push(handoff); return { applied: true }; });
    const again = await deliverCpuProjectionForOrder(order, undefined, async handoff => { received.push(handoff); return { applied: true }; });
    assert.equal(again.state, "delivered");
    assert.equal(received.filter(handoff => handoff.entityId === orderId).length, 1, "exactly one CPU change for this canonical version");
  } finally { await cleanup(orderId); }
});

test("a handoff that exhausts its retries is dead-lettered visibly (still pending, never delivered) and can be reset for review", async () => {
  const sourceEntityId = `cpu-outbox-dead:${Date.now()}:${process.pid}`;
  const orderId = materialisedProductionId(inputFor(sourceEntityId));
  try {
    const { order } = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId));
    const eventId = `cpu-projection:${orderId}:v1`;
    const failing = async () => { throw new Error("CPU unavailable"); };
    let result = await deliverCpuProjectionForOrder(order, undefined, failing);
    for (let attempt = 1; attempt < DURABLE_OUTBOX_MAX_ATTEMPTS; attempt += 1) { await makeDue(eventId); result = { ...result, ...(await deliverCpuProjectionForOrder(order, undefined, failing)) }; }
    assert.equal(result.state, "pending"); assert.equal(result.deliveryStatus, "dead-letter"); assert.equal(result.attempts, DURABLE_OUTBOX_MAX_ATTEMPTS);
    assert.equal((await summariseCpuProjectionOutbox()).deadLetter >= 1, true);
    await resetCpuProjectionDeadLetter({ eventId, reason: "CPU restored", actorId: "test" });
    const received: CpuProjectionHandoff[] = [];
    const delivered = await deliverCpuProjection(eventId, async handoff => { received.push(handoff); return { applied: true }; });
    assert.equal(delivered?.delivery.status, "delivered"); assert.equal(received.length, 1);
  } finally { await cleanup(orderId); }
});

test("stale v1/v2 withdrawal replays cannot overwrite the v3 restoration (the 7 Oct sequence) and add no CPU change", async () => {
  const sourceEntityId = `cpu-outbox-stale:${Date.now()}:${process.pid}`;
  const orderId = materialisedProductionId(inputFor(sourceEntityId));
  const v = (version: number, status: "published" | "amended" | "withdrawn", contentHash: string) => inputFor(sourceEntityId, { sourceVersion: version, sourceContentHash: contentHash, status });
  try {
    await materialiseExternalProductionOrder(actor, v(1, "published", hash("1")));
    await materialiseExternalProductionOrder(actor, v(1, "withdrawn", hash("1")));
    await materialiseExternalProductionOrder(actor, v(2, "amended", hash("1")));
    await materialiseExternalProductionOrder(actor, v(2, "withdrawn", hash("1")));
    const v3 = await materialiseExternalProductionOrder(actor, v(3, "amended", hash("3")));
    assert.equal(v3.order.status, "menu_available"); assert.equal(v3.order.sourceVersion, 3); assert.equal(v3.order.version, 5);
    // Late redelivery of the older withdrawals (what happened on 7 Oct):
    for (const stale of [v(2, "withdrawn", hash("1")), v(1, "withdrawn", hash("1")), v(2, "amended", hash("1")), v(1, "published", hash("1"))]) {
      const replay = await materialiseExternalProductionOrder(actor, stale);
      assert.equal(replay.duplicate, true);
      assert.deepEqual(replay.order, v3.order);
    }
    const persisted = (await orders().doc(stableDocumentId(orderId)).get()).data();
    assert.deepEqual([persisted?.status, persisted?.sourceVersion, persisted?.version, persisted?.sourceContentHash], ["menu_available", 3, 5, hash("3")]);
    assert.deepEqual((await outboxFor(orderId)).map(event => event.eventId), [1, 2, 3, 4, 5].map(version => `cpu-projection:${orderId}:v${version}`), "the stale replays created no CPU change");
  } finally { await cleanup(orderId); }
});

test("replaying the current v3 publication restores an order that stale replay had cancelled, and tells the CPU with a NEW canonical-version change", async () => {
  const sourceEntityId = `cpu-outbox-repair:${Date.now()}:${process.pid}`;
  const orderId = materialisedProductionId(inputFor(sourceEntityId));
  try {
    const seeded = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId, { sourceVersion: 3, sourceContentHash: hash("3"), status: "amended" }));
    // State left behind by the pre-guard Hub build: cancelled at a STALE source version/hash, canonical version 7.
    const corrupted = { ...seeded.order, version: 7, currentRevision: 7, status: "cancelled", sourceVersion: 1, sourceContentHash: hash("1") };
    await orders().doc(stableDocumentId(orderId)).set(corrupted);
    const restored = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId, { sourceVersion: 3, sourceContentHash: hash("3"), status: "amended" }));
    assert.equal(restored.duplicate, false);
    assert.deepEqual([restored.order.status, restored.order.sourceVersion, restored.order.version, restored.order.sourceContentHash], ["menu_available", 3, 8, hash("3")]);
    const events = await outboxFor(orderId);
    const repair = events.find(event => event.eventId === `cpu-projection:${orderId}:v8`);
    assert.ok(repair, "a new CPU change exists for canonical version 8");
    assert.equal(repair!.payload.changeType, "amended"); assert.equal(repair!.payload.revision, 8); assert.equal(repair!.delivery.status, "pending");
    // ...and the same v3 replayed again is a no-op, while a stale v1 cancel still cannot win.
    assert.equal((await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId, { sourceVersion: 3, sourceContentHash: hash("3"), status: "amended" }))).duplicate, true);
    assert.equal((await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId, { sourceVersion: 1, sourceContentHash: hash("1"), status: "withdrawn" }))).duplicate, true);
    assert.equal((await orders().doc(stableDocumentId(orderId)).get()).data()?.status, "menu_available");
  } finally { await cleanup(orderId); }
});

test("replaying an already-materialised canonical version heals a handoff that predates the durable outbox", async () => {
  const sourceEntityId = `cpu-outbox-legacy:${Date.now()}:${process.pid}`;
  const orderId = materialisedProductionId(inputFor(sourceEntityId));
  try {
    const { order } = await materialiseExternalProductionOrder(actor, inputFor(sourceEntityId));
    await outbox().doc(`cpu-projection:${orderId}:v1`).delete(); // as if the order was materialised before the outbox existed
    const received: CpuProjectionHandoff[] = [];
    const healed = await deliverCpuProjectionForOrder(order, undefined, async handoff => { received.push(handoff); return { applied: true }; });
    assert.equal(healed.state, "delivered"); assert.equal(received.length, 1); assert.equal(received[0].revision, 1);
  } finally { await cleanup(orderId); }
});

test("the canonical digest changes when an order is cancelled even though a projection would filter it out", () => {
  const live = [{ canonicalId: "o1", version: 5, status: "menu_available", serviceDate: "2026-10-05" }, { canonicalId: "o2", version: 5, status: "menu_available", serviceDate: "2026-10-06" }];
  const cancelled = live.map(order => ({ ...order, version: 7, status: "cancelled" }));
  const before = canonicalProductionDigestSet(live); const after = canonicalProductionDigestSet(cancelled);
  assert.notEqual(before.digest, after.digest);
  assert.equal(before.count, after.count, "the count alone would not have noticed");
  assert.deepEqual(Object.keys(before.days), ["2026-10-05", "2026-10-06"]);
  assert.equal(canonicalDigestsMatch(before, canonicalProductionDigestSet([...live].reverse())), true, "order of input does not matter");
  assert.equal(canonicalDigestsMatch(before, after), false);
  assert.equal(canonicalDigestsMatch(undefined, after), false, "a projection with no digest is unknown, never consistent");
});
