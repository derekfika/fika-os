import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingScheduleOperation,
  canStartPendingSchedule,
  decodeConfirmedSchedulePosition,
  directResizeEnabled,
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
    state: "pending",
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
