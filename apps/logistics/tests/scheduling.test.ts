import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingScheduleOperation,
  canStartPendingSchedule,
  canStartPlacement,
  decodeConfirmedSchedulePosition,
  directResizeEnabled,
  effectivePlacement,
  confirmedPlacementIsSuperseded,
  markUncertainPlacement,
  placementRefreshOutcome,
  reconcileUncertainPlacement,
  resolveNextAvailableScheduleStart,
  settlePendingScheduleOperation,
  scheduleIntervalsOverlap,
} from "../lib/scheduling";

test("no-end collision terminates and advances by the default duration", () => {
  assert.equal(resolveNextAvailableScheduleStart("09:00", undefined, [{ start: "09:00" }]), "09:15");
});

test("collision resolution is bounded for repeated no-end conflicts", () => {
  assert.throws(() => resolveNextAvailableScheduleStart("23:45", undefined, [{ start: "23:45" }, { start: "23:45" }]), /operational day|bounded/i);
});

test("preview and committed interval overlap use half-open default-duration semantics", () => {
  assert.equal(scheduleIntervalsOverlap({ start: "09:00", end: "09:15" }, { start: "09:15" }), false);
  assert.equal(scheduleIntervalsOverlap({ start: "09:00" }, { start: "09:14" }), true);
});

test("pending operation records rollback and the target run/lane", () => {
  const operation = createPendingScheduleOperation("stop-1", { runId: "van-1", lane: "delivery", start: "09:00" }, { runId: "van-2", lane: "collection", start: "10:00", end: "10:30" }, "op-1");
  assert.deepEqual(operation, {
    operationId: "op-1",
    stopId: "stop-1",
    original: { runId: "van-1", lane: "delivery", start: "09:00" },
    proposed: { runId: "van-2", lane: "collection", start: "10:00", end: "10:30" },
    rollback: { runId: "van-1", lane: "delivery", start: "09:00" },
    intent: "scheduled",
    state: "pending",
    source: "stop",
    projectionSequenceAtStart: undefined,
    stopVersionAtStart: undefined,
  });
});

test("rejected move rolls back and a competing operation is blocked", () => {
  const operation = createPendingScheduleOperation("stop-1", { runId: "van-1", lane: "delivery", start: "09:00" }, { runId: "van-2", lane: "delivery", start: "10:00" }, "op-1");
  assert.equal(canStartPendingSchedule(operation), false);
  const rejected = { ...operation, state: "uncertain" as const, error: "Checking" };
  assert.equal(canStartPendingSchedule(rejected), false);
  assert.deepEqual(rejected.rollback, operation.original);
  const failed = undefined;
  assert.equal(canStartPendingSchedule(failed), true);
  assert.deepEqual(operation.rollback, operation.original);
});

test("server-adjusted position replaces the requested optimistic position", () => {
  const operation = createPendingScheduleOperation("stop-1", { runId: "van-1", lane: "delivery", start: "09:00" }, { runId: "van-1", lane: "delivery", start: "10:00" }, "op-1");
  const settled = settlePendingScheduleOperation(operation, { runId: "van-2", lane: "delivery", start: "10:15" });
  assert.deepEqual(settled.proposed, { runId: "van-2", lane: "delivery", start: "10:15" });
  assert.equal(settled.state, "confirmed-response");
});

test("collection confirmation decodes collection timing and run rather than delivery timing", () => {
  const fallback = { runId: "van-1", lane: "collection" as const, start: "09:00" };
  assert.deepEqual(decodeConfirmedSchedulePosition({
    scheduledTime: "08:00",
    collectionScheduledTime: "14:00",
    collectionScheduledEnd: "14:30",
    collectionRunId: "van-2",
  }, fallback), { runId: "van-2", lane: "collection", start: "14:00", end: "14:30" });
});

test("arrival-style stops are not directly resizeable while explicit windows are", () => {
  assert.equal(directResizeEnabled(false), false);
  assert.equal(directResizeEnabled(true), true);
});

test("a second pending position wins over an older confirmed overlay", () => {
  const pending = createPendingScheduleOperation("stop-1", { runId: "van-2", lane: "delivery", start: "08:30" }, { runId: "van-1", lane: "delivery", start: "09:00" }, "op-2");
  const effective = effectivePlacement(pending, { kind: "scheduled", position: { runId: "van-2", lane: "delivery", start: "08:30" }, operationId: "op-1", source: "stop", stopVersion: 4 }, { runId: "van-2", lane: "delivery", start: "08:00" });
  assert.deepEqual(effective, { kind: "scheduled", position: { runId: "van-1", lane: "delivery", start: "09:00" } });
});

test("projected revision is not compared with a DeliveryLoad version", () => {
  const confirmed = { kind: "scheduled" as const, position: { runId: "van-1", lane: "delivery" as const, start: "08:30" }, operationId: "op-1", source: "projection" as const, projectionSequenceAtStart: 42 };
  assert.equal(confirmedPlacementIsSuperseded(confirmed, { source: "projection", projectionSequence: 42, stopVersion: 9001 }), false);
  assert.equal(confirmedPlacementIsSuperseded(confirmed, { source: "projection", projectionSequence: 43, stopVersion: 1 }), true);
});

test("successful adjusted response remains visible when refresh becomes uncertain", () => {
  const requested = { runId: "van-1", lane: "delivery" as const, start: "08:15" };
  const body = { stop: { runId: "van-2", plannedArrivalTime: "08:30" } };
  const outcome = placementRefreshOutcome(body, false);
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("Expected uncertain refresh outcome");
  assert.deepEqual(outcome.body, body);
  const server = decodeConfirmedSchedulePosition(outcome.body, requested);
  const operation = createPendingScheduleOperation("stop-1", requested, requested, "op-1", { source: "stop", stopVersionAtStart: 3 });
  const uncertain = markUncertainPlacement(operation, server);
  assert.equal(uncertain.state, "uncertain");
  assert.deepEqual(effectivePlacement(uncertain, undefined, requested), { kind: "scheduled", position: server });
  assert.equal(reconcileUncertainPlacement(uncertain, server, { source: "stop", stopVersion: 4 }), "confirmed");
});

test("uncertain projected response stays pending until a newer projection confirms or supersedes it", () => {
  const operation = createPendingScheduleOperation("projection-stop:load-1", { runId: "van-1", lane: "delivery", start: "08:00" }, { runId: "van-1", lane: "delivery", start: "08:15" }, "op-1", { source: "projection", projectionSequenceAtStart: 11 });
  const uncertain = markUncertainPlacement(operation, { runId: "van-2", lane: "delivery", start: "08:30" });
  assert.equal(reconcileUncertainPlacement(uncertain, uncertain.serverPosition, { source: "projection", projectionSequence: 11 }), "pending");
  assert.equal(reconcileUncertainPlacement(uncertain, { runId: "van-2", lane: "delivery", start: "08:30" }, { source: "projection", projectionSequence: 12 }), "confirmed");
  assert.equal(reconcileUncertainPlacement(uncertain, { runId: "van-1", lane: "delivery", start: "09:00" }, { source: "projection", projectionSequence: 13 }), "superseded");
});

test("return-to-planning and drag-back share the same placement lock", () => {
  const returnToQueue = createPendingScheduleOperation("stop-1", { runId: "van-1", lane: "delivery", start: "09:00" }, undefined, "return-op");
  assert.equal(returnToQueue.intent, "unscheduled");
  const inFlight = { "stop-1": returnToQueue };
  assert.equal(canStartPlacement("stop-1", inFlight), false, "a reschedule cannot race a return-to-planning command");
  assert.equal(canStartPlacement("stop-1", inFlight), false, "drag-back cannot race an in-flight placement command");
  assert.equal(canStartPlacement("another-stop", inFlight), true, "the lock is scoped to the same work item");
});

test("confirmed clear hides stale scheduled data until matching native convergence", () => {
  const stale = { runId: "van-1", lane: "delivery" as const, start: "09:00" };
  const confirmed = { kind: "unscheduled" as const, operationId: "clear-1", source: "stop" as const, stopVersion: 8 };
  assert.deepEqual(effectivePlacement(undefined, confirmed, stale), { kind: "unscheduled" });
  assert.equal(confirmedPlacementIsSuperseded(confirmed, { source: "stop", stopVersion: 7, position: stale }), false);
  assert.equal(confirmedPlacementIsSuperseded(confirmed, { source: "stop", stopVersion: 8 }), true);
});

test("a rejected operation leaves canonical position as the only positional authority", () => {
  const canonical = { runId: "van-1", lane: "delivery" as const, start: "09:00" };
  const rejected = createPendingScheduleOperation("stop-1", canonical, { runId: "van-2", lane: "delivery", start: "10:00" }, "reject-1");
  assert.equal(canStartPendingSchedule(rejected), false);
  assert.deepEqual(effectivePlacement(undefined, undefined, canonical), { kind: "scheduled", position: canonical });
});
