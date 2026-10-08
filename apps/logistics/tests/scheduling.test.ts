import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingScheduleOperation,
  decodePlacementAuthority,
  mergePlacementAuthority,
  nativePlacementVersions,
  canStartPendingSchedule,
  canStartPlacement,
  collectionTargetForGroup,
  decodeConfirmedSchedulePosition,
  directResizeEnabled,
  effectivePlacement,
  confirmedPlacementIsSuperseded,
  confirmedResponseConverged,
  groupAssignmentRoute,
  markUncertainPlacement,
  placementRefreshOutcome,
  projectedCollectionScheduleCommand,
  projectedDeliveryScheduleCommand,
  queuePlacementConverged,
  reconcileUncertainPlacement,
  retireConvergedPlacementAuthorities,
  resolveNextAvailableScheduleStart,
  replaceLoadTiming,
  replaceStopTiming,
  validateOperationalSchedule,
  addSchedulableMinutes,
  scheduleEndMinutes,
  LAST_SCHEDULABLE_MINUTE,
  LAST_INTERVAL_END_MINUTE,
  settlePendingScheduleOperation,
  scheduleIntervalsOverlap,
  uncertainPlacementTimeout,
  uncertainPlacementWindowExpired,
} from "../lib/scheduling";

test("assigned untimed delivery commands retain every canonical load and captured version", () => {
  const authority = { loadIds: ["load:a", "load:b"], expectedLoadVersions: { "load:a": 7, "load:b": 4 } };
  const before = structuredClone(authority);
  assert.deepEqual(projectedDeliveryScheduleCommand(authority, "run:two", "10:45", "11:15"), {
    action: "reschedule-delivery-loads", loadIds: ["load:a", "load:b"], expectedLoadVersions: { "load:a": 7, "load:b": 4 }, targetRunId: "run:two", lane: "delivery", scheduledTime: "10:45", scheduledEnd: "11:15",
  });
  assert.deepEqual(authority, before);
  assert.equal(projectedDeliveryScheduleCommand({ ...authority, expectedLoadVersions: { "load:a": 7 } }, "run:two", "10:45"), undefined);
  assert.equal(projectedDeliveryScheduleCommand({ ...authority, loadIds: ["load:a", "load:a"] }, "run:two", "10:45"), undefined);
  assert.equal(projectedDeliveryScheduleCommand({ ...authority, loadIds: [] }, "run:two", "10:45"), undefined);
});

test("native timing replacement is mutually exclusive and drops an omitted old window end", () => {
  const window = { canonicalId: "stop:1", plannedWindow: { startTime: "09:00", endTime: "09:30" }, version: 1 };
  assert.deepEqual(replaceStopTiming(window, { plannedArrivalTime: "10:00" }), { canonicalId: "stop:1", version: 1, plannedArrivalTime: "10:00" });
  const arrival = { canonicalId: "stop:1", plannedArrivalTime: "10:00", version: 1 };
  assert.deepEqual(replaceStopTiming(arrival, { plannedWindow: { startTime: "11:00", endTime: "11:45" } }), { canonicalId: "stop:1", version: 1, plannedWindow: { startTime: "11:00", endTime: "11:45" } });
  assert.deepEqual(replaceStopTiming(window, { plannedWindow: { startTime: "11:00" } }), { canonicalId: "stop:1", version: 1, plannedWindow: { startTime: "11:00" } });
});

test("load lane timing replacement removes omitted end without touching the other lane", () => {
  const load = { id: "load:1", scheduledTime: "10:00", scheduledEnd: "10:45", collectionScheduledTime: "14:00", collectionScheduledEnd: "14:30", collectionRunId: "run:2" };
  assert.deepEqual(replaceLoadTiming(load, "delivery", { start: "11:00" }), { id: "load:1", collectionScheduledTime: "14:00", collectionScheduledEnd: "14:30", collectionRunId: "run:2", scheduledTime: "11:00" });
  assert.deepEqual(replaceLoadTiming(load, "collection", {}), { id: "load:1", scheduledTime: "10:00", scheduledEnd: "10:45", collectionRunId: "run:2" });
});

test("shared schedule bounds cover the full schedulable day with 15-minute windows", () => {
  assert.equal(LAST_SCHEDULABLE_MINUTE, 23 * 60 + 45);
  assert.equal(validateOperationalSchedule("00:00"), undefined);
  assert.equal(validateOperationalSchedule("23:45"), undefined);
  assert.equal(validateOperationalSchedule("23:46"), "Schedule times must be between 00:00 and 23:45.");
  assert.equal(validateOperationalSchedule("24:00"), "Schedule times must be between 00:00 and 23:45.");
  assert.equal(validateOperationalSchedule("10:00", "10:15"), undefined);
  assert.equal(validateOperationalSchedule("10:00", "10:14"), "A scheduled window must be at least 15 minutes.");
});

test("explicit end-of-day windows stop at 23:45 while arrival occupancy can end at midnight", () => {
  const conflict = [{ start: "23:30", end: "23:45" }];
  assert.equal(addSchedulableMinutes("23:30", 15), "23:45");
  assert.equal(addSchedulableMinutes("23:45", 15), undefined);
  assert.equal(scheduleEndMinutes("23:45"), LAST_INTERVAL_END_MINUTE);
  assert.equal(LAST_INTERVAL_END_MINUTE, 24 * 60);
  assert.equal(scheduleIntervalsOverlap({ start: "23:45" }, { start: "23:59" }), true);
  assert.equal(scheduleIntervalsOverlap({ start: "23:45" }, { start: "24:00" }), false);
  assert.equal(resolveNextAvailableScheduleStart("23:30", undefined, conflict), "23:45");
  assert.throws(() => resolveNextAvailableScheduleStart("23:30", "23:45", conflict), /operational day/i);
});

test("touching windows are adjacent; ordinary collision placement keeps first-fit settlement", () => {
  assert.equal(scheduleIntervalsOverlap({ start: "10:00", end: "10:30" }, { start: "10:30", end: "11:00" }), false);
  assert.equal(scheduleIntervalsOverlap({ start: "10:00", end: "10:30" }, { start: "10:15", end: "11:00" }), true);
  assert.equal(resolveNextAvailableScheduleStart("10:00", "10:30", [{ start: "10:00", end: "10:30" }]), "10:30");
});

test("native placement authority chains fresh stop and both run versions", () => {
  const decoded = decodePlacementAuthority({
    placementAuthority: {
      stopId: "stop-1",
      stopRunId: "run-target",
      stopVersion: 8,
      runVersions: { "run-source": 5, "run-target": 12 },
    },
  }, "stop-1");
  assert.deepEqual(decoded, {
    stopId: "stop-1",
    stopRunId: "run-target",
    stopVersion: 8,
    runVersions: { "run-source": 5, "run-target": 12 },
  });
  const merged = mergePlacementAuthority(undefined, decoded!);
  assert.deepEqual(nativePlacementVersions(merged, {
    stopRunId: "run-source",
    stopVersion: 3,
    runVersions: { "run-source": 3, "run-target": 9 },
  }, "run-target"), {
    sourceRunId: "run-target",
    expectedRunVersion: 12,
    expectedStopVersion: 8,
  });
});

test("same-run follow-up prefers response authority over stale planner versions", () => {
  const authority = decodePlacementAuthority({
    placementAuthority: {
      stopId: "stop-1", stopRunId: "run-1", stopVersion: 4,
      runVersions: { "run-1": 7 },
    },
  }, "stop-1");
  assert.deepEqual(nativePlacementVersions(authority, {
    stopRunId: "run-1", stopVersion: 2, runVersions: { "run-1": 5 },
  }, "run-1"), {
    sourceRunId: "run-1", expectedRunVersion: 7, expectedStopVersion: 4,
  });
  assert.equal(decodePlacementAuthority({ placementAuthority: { stopId: "other", stopRunId: "run-1", stopVersion: 4, runVersions: { "run-1": 7 } } }, "stop-1"), undefined);
  assert.equal(decodePlacementAuthority({ placementAuthority: { stopId: "stop-1", stopRunId: "run-1", stopVersion: Number.NaN, runVersions: { "run-1": 7 } } }, "stop-1"), undefined);
});

const responseAuthority = {
  stopId: "stop-1", stopRunId: "run-target", stopVersion: 8,
  runVersions: { "run-source": 5, "run-target": 12 },
};
const responseStop = { canonicalId: "stop-1", runId: "run-target", version: 8 };
const responseRuns = [{ runId: "run-source", version: 5 }, { runId: "run-target", version: 12 }];
const retire = (
  stop = responseStop,
  runs = responseRuns,
  busy: ReadonlySet<string> = new Set<string>(),
) => retireConvergedPlacementAuthorities({ "stop-1": responseAuthority }, [stop], runs, busy);

test("response authority still overrides a stale canonical refeed for rapid chaining", () => {
  const remaining = retire({ ...responseStop, version: 7 }, responseRuns);
  assert.equal(remaining["stop-1"], responseAuthority);
  assert.deepEqual(nativePlacementVersions(remaining["stop-1"], {
    stopRunId: "run-source", stopVersion: 7,
    runVersions: { "run-source": 4, "run-target": 11 },
  }, "run-source"), {
    sourceRunId: "run-target", expectedRunVersion: 12,
    expectedTargetRunVersion: 5, expectedStopVersion: 8,
  });
});

test("equal or newer canonical stop and all runs retire response authority", () => {
  assert.deepEqual(retire(), {});
  assert.deepEqual(retire({ ...responseStop, version: 9 }, responseRuns.map((run) => ({ ...run, version: run.version + 1 }))), {});
});

test("canonical stop alone cannot retire authority while an affected run is stale or missing", () => {
  assert.equal(retire(responseStop, [{ runId: "run-source", version: 4 }, responseRuns[1]])["stop-1"], responseAuthority);
  assert.equal(retire(responseStop, [responseRuns[1]])["stop-1"], responseAuthority);
  assert.equal(retire({ ...responseStop, runId: "run-source" })["stop-1"], responseAuthority);
});

test("cross-run authority waits for both source and target run versions", () => {
  assert.equal(retire(responseStop, [responseRuns[0], { ...responseRuns[1], version: 11 }])["stop-1"], responseAuthority);
  assert.equal(retire(responseStop, [{ ...responseRuns[0], version: 4 }, responseRuns[1]])["stop-1"], responseAuthority);
  assert.deepEqual(retire(), {});
});

test("after retirement a later independent run increment supplies canonical v3", () => {
  const remaining = retire();
  assert.deepEqual(nativePlacementVersions(remaining["stop-1"], {
    stopRunId: "run-target", stopVersion: 8,
    runVersions: { "run-source": 5, "run-target": 13 },
  }, "run-target"), {
    sourceRunId: "run-target", expectedRunVersion: 13, expectedStopVersion: 8,
  });
});

test("active or queued same-stop command keeps response tokens through chained execution", () => {
  assert.equal(retire(responseStop, responseRuns, new Set(["stop-1"]))["stop-1"], responseAuthority);
  assert.deepEqual(retire(responseStop, responseRuns, new Set(["stop-2"])), {});
});

test("retirement requires the canonical stop even when run versions are current", () => {
  assert.equal(retireConvergedPlacementAuthorities({ "stop-1": responseAuthority }, [], responseRuns, new Set())["stop-1"], responseAuthority);
});

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

test("successful native response remains identity-locked until stop and affected run versions converge", () => {
  const operation = {
    ...createPendingScheduleOperation("stop-1", { runId: "run-1", lane: "delivery", start: "09:00" }, { runId: "run-2", lane: "delivery", start: "10:00" }, "op-1", {
      source: "stop",
      stopVersionAtStart: 4,
      runVersionsAtStart: { "run-1": 7, "run-2": 3 },
    }),
    state: "confirmed-response" as const,
    serverStopVersion: 5,
  };
  assert.equal(confirmedResponseConverged(operation, { exists: true, stopVersion: 4, runVersions: { "run-1": 7, "run-2": 3 } }), false);
  assert.equal(confirmedResponseConverged(operation, { exists: true, stopVersion: 5, runVersions: { "run-1": 8, "run-2": 3 } }), false, "both source and target run versions must advance");
  assert.equal(confirmedResponseConverged(operation, { exists: true, stopVersion: 5, runVersions: { "run-1": 8, "run-2": 4 } }), true);
  assert.equal(canStartPlacement("stop-1", { "stop-1": operation }), false);
  assert.equal(canStartPlacement("stop-2", { "stop-1": operation }), true, "unrelated work remains interactive");
});

test("projected confirmed response unlocks only on a newer projection sequence", () => {
  const operation = {
    ...createPendingScheduleOperation("projection-stop:load-1", undefined, { runId: "run-1", lane: "delivery", start: "09:00" }, "op-1", { source: "projection", projectionSequenceAtStart: 12 }),
    state: "confirmed-response" as const,
  };
  assert.equal(confirmedResponseConverged(operation, { exists: true, projectionSequence: 12 }), false);
  assert.equal(confirmedResponseConverged(operation, { exists: true, projectionSequence: 13 }), true);
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
  const uncertain = markUncertainPlacement(operation, server, true, 4);
  assert.equal(uncertain.state, "uncertain");
  assert.equal(uncertain.responseConfirmed, true);
  assert.equal(uncertain.serverStopVersion, 4);
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

test("Inspector outstanding projected Collection uses collection rescheduling, not delivery assignment", () => {
  assert.equal(groupAssignmentRoute(true), "collection");
  assert.equal(groupAssignmentRoute(false), "delivery");
  const target = collectionTargetForGroup("projection-collection:load-77", [], []);
  assert.deepEqual(target, { kind: "projection", loadId: "load-77" });
  if (target?.kind !== "projection") throw new Error("Expected a projected collection target");
  const command = projectedCollectionScheduleCommand(target.loadId, "run-2", "14:00", "14:30");
  assert.deepEqual(command, {
    action: "reschedule-delivery-load",
    loadId: "load-77",
    scheduledTime: "14:00",
    targetRunId: "run-2",
    lane: "collection",
    scheduledEnd: "14:30",
  });
  assert.notEqual(command.action, "assign-job-to-load");
});

test("Inspector outstanding native Collection resolves its linked stop for schedule or move", () => {
  assert.deepEqual(collectionTargetForGroup("group-1", [{ runId: "run-1", stopId: "delivery-1" }], [
    { stopId: "delivery-1", runId: "run-1", linkedStopId: "collection-1", linkedOperation: "delivery" },
    { stopId: "collection-1", runId: "run-1", linkedOperation: "collection" },
  ]), { kind: "native", stopId: "collection-1", runId: "run-1" });
});

test("successful queue assignment stays locked across a stale or still-actionable read", () => {
  const operation = { ...createPendingScheduleOperation("projection-job:job-1", { runId: "planning-queue", lane: "delivery", start: "09:00" }, { runId: "run-1", lane: "delivery", start: "09:00" }, "queue-op", { source: "queue", projectionSequenceAtStart: 20 }), state: "confirmed-response" as const };
  assert.equal(queuePlacementConverged(operation, { projectionBacked: true, projectionSequence: 20, exists: true, actionable: true }), false);
  assert.equal(queuePlacementConverged(operation, { projectionBacked: true, projectionSequence: 21, exists: true, actionable: true }), false);
  assert.equal(queuePlacementConverged(operation, { projectionBacked: true, projectionSequence: 21, exists: false, actionable: false }), true);
  assert.equal(uncertainPlacementTimeout(markUncertainPlacement(operation, operation.proposed, true)).retainLock, true);
});

test("body-less unchanged authority remains checking until the bounded window expires", () => {
  const canonical = { runId: "run-1", lane: "delivery" as const, start: "09:00" };
  const operation = markUncertainPlacement(createPendingScheduleOperation("stop-1", canonical, { runId: "run-2", lane: "delivery", start: "10:00" }, "uncertain-op", { source: "stop", stopVersionAtStart: 5 }));
  assert.equal(operation.responseConfirmed, false);
  assert.equal(reconcileUncertainPlacement(operation, canonical, { source: "stop", stopVersion: 5 }), "pending");
  assert.equal(uncertainPlacementWindowExpired(1), false);
  assert.equal(uncertainPlacementWindowExpired(2), false);
  assert.equal(uncertainPlacementWindowExpired(3), true);
  assert.deepEqual(uncertainPlacementTimeout(operation), {
    retainLock: false,
    preserveConfirmedResponse: false,
    message: "Could not confirm whether this was saved. Refresh and retry.",
  });
});

test("a late successful canonical convergence wins before the bounded checking window expires", () => {
  const requested = { runId: "run-2", lane: "delivery" as const, start: "10:00" };
  const operation = markUncertainPlacement(createPendingScheduleOperation("stop-1", { runId: "run-1", lane: "delivery", start: "09:00" }, requested, "late-op", { source: "stop", stopVersionAtStart: 5 }));
  assert.equal(reconcileUncertainPlacement(operation, { runId: "run-1", lane: "delivery", start: "09:00" }, { source: "stop", stopVersion: 5 }), "pending");
  assert.equal(reconcileUncertainPlacement(operation, requested, { source: "stop", stopVersion: 6 }), "confirmed");
  assert.equal(uncertainPlacementWindowExpired(2), false);
});
