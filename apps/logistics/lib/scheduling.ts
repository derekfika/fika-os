export const DEFAULT_SCHEDULE_DURATION_MINUTES = 15;

export type ScheduleInterval = {
  id?: string;
  start: string;
  end?: string;
};

export type SchedulePosition = {
  runId: string;
  lane: "delivery" | "collection";
  start: string;
  end?: string;
};

export function decodeConfirmedSchedulePosition(
  result: boolean | Record<string, unknown>,
  fallback: SchedulePosition,
): SchedulePosition {
  if (!result || typeof result !== "object") return fallback;
  const body = result as Record<string, unknown>;
  const value = (body.stop && typeof body.stop === "object" ? body.stop : body) as Record<string, unknown>;
  const plannedWindow = value.plannedWindow as { startTime?: unknown; endTime?: unknown } | undefined;
  const collection = fallback.lane === "collection";
  const laneStart = value[collection ? "collectionScheduledTime" : "scheduledTime"];
  const start = typeof plannedWindow?.startTime === "string"
    ? plannedWindow.startTime
    : collection && typeof laneStart === "string"
      ? laneStart
      : typeof value.plannedArrivalTime === "string"
        ? value.plannedArrivalTime
        : typeof laneStart === "string"
          ? laneStart
          : fallback.start;
  const end = typeof plannedWindow?.endTime === "string"
    ? plannedWindow.endTime
    : typeof value[collection ? "collectionScheduledEnd" : "scheduledEnd"] === "string"
      ? value[collection ? "collectionScheduledEnd" : "scheduledEnd"] as string
      : undefined;
  const runValue = collection ? value.collectionRunId : value.runId;
  return { runId: typeof runValue === "string" ? runValue : fallback.runId, lane: fallback.lane, start, ...(end ? { end } : {}) };
}

export type PendingScheduleOperation = {
  operationId: string;
  stopId: string;
  original?: SchedulePosition;
  proposed?: SchedulePosition;
  intent: "scheduled" | "unscheduled";
  state: "pending" | "saving" | "confirmed-response" | "uncertain";
  rollback?: SchedulePosition;
  source: "stop" | "projection" | "queue";
  projectionSequenceAtStart?: number;
  stopVersionAtStart?: number;
  serverPosition?: SchedulePosition;
  serverStopVersion?: number;
  responseConfirmed?: boolean;
  error?: string;
};

export type ConfirmedPlacement =
  | { kind: "scheduled"; position: SchedulePosition; operationId: string; source: "stop" | "projection" | "queue"; stopVersion?: number; projectionSequenceAtStart?: number }
  | { kind: "unscheduled"; operationId: string; source: "stop" | "projection" | "queue"; stopVersion?: number; projectionSequenceAtStart?: number };

export type EffectivePlacement = { kind: "scheduled"; position: SchedulePosition } | { kind: "unscheduled" };
export type PlacementRefreshOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; uncertain: true; message: string; body: Record<string, unknown> };

export const UNCERTAIN_PLACEMENT_MAX_ATTEMPTS = 3;

export function uncertainPlacementWindowExpired(attempt: number): boolean {
  return attempt >= UNCERTAIN_PLACEMENT_MAX_ATTEMPTS;
}

export function uncertainPlacementTimeout(operation: PendingScheduleOperation): { retainLock: boolean; preserveConfirmedResponse: boolean; message: string } {
  if (operation.responseConfirmed && operation.source === "queue") {
    return { retainLock: true, preserveConfirmedResponse: true, message: "Saved; waiting for the updated planning queue." };
  }
  if (operation.responseConfirmed) {
    return { retainLock: false, preserveConfirmedResponse: true, message: "Saved; the schedule view is still catching up. Refresh to confirm." };
  }
  return { retainLock: false, preserveConfirmedResponse: false, message: "Could not confirm whether this was saved. Refresh and retry." };
}

export function collectionTargetForGroup(
  groupKey: string,
  refs: Array<{ runId?: string; stopId?: string }>,
  stops: Array<{ stopId: string; runId: string; linkedStopId?: string; linkedOperation?: string }>,
): { kind: "projection"; loadId: string } | { kind: "native"; stopId: string; runId: string } | undefined {
  const prefix = "projection-collection:";
  if (groupKey.startsWith(prefix)) return { kind: "projection", loadId: groupKey.slice(prefix.length) };
  const deliveryStop = refs
    .filter((ref): ref is { runId: string; stopId: string } => Boolean(ref.runId && ref.stopId))
    .map((ref) => stops.find((stop) => stop.runId === ref.runId && stop.stopId === ref.stopId))
    .find((stop) => stop?.linkedOperation === "delivery" && stop.linkedStopId);
  const collectionStop = deliveryStop?.linkedStopId
    ? stops.find((stop) => stop.stopId === deliveryStop.linkedStopId)
    : undefined;
  return collectionStop ? { kind: "native", stopId: collectionStop.stopId, runId: collectionStop.runId } : undefined;
}

export function groupAssignmentRoute(collectionPending: boolean): "collection" | "delivery" {
  return collectionPending ? "collection" : "delivery";
}

export function projectedCollectionScheduleCommand(loadId: string, targetRunId: string, scheduledTime: string, scheduledEnd?: string) {
  return {
    action: "reschedule-delivery-load" as const,
    loadId,
    scheduledTime,
    targetRunId,
    lane: "collection" as const,
    ...(scheduledEnd ? { scheduledEnd } : {}),
  };
}

export function queuePlacementConverged(
  operation: PendingScheduleOperation,
  snapshot: { projectionBacked: boolean; projectionSequence?: number; exists: boolean; actionable: boolean },
): boolean {
  if (operation.source !== "queue" || operation.state !== "confirmed-response") return false;
  if (!snapshot.exists) return true;
  if (snapshot.actionable) return false;
  if (!snapshot.projectionBacked) return true;
  return operation.projectionSequenceAtStart !== undefined
    && snapshot.projectionSequence !== undefined
    && snapshot.projectionSequence > operation.projectionSequenceAtStart;
}

export function placementRefreshOutcome(body: Record<string, unknown>, dayRefreshSucceeded: boolean): PlacementRefreshOutcome {
  return dayRefreshSucceeded
    ? { ok: true, body }
    : { ok: false, uncertain: true, message: "The schedule command may have been saved; checking the authoritative day before deciding.", body };
}

export function effectivePlacement(
  pending: PendingScheduleOperation | undefined,
  confirmed: ConfirmedPlacement | undefined,
  canonical: SchedulePosition | undefined,
): EffectivePlacement | undefined {
  if (pending) return pending.intent === "unscheduled" || !pending.proposed ? { kind: "unscheduled" } : { kind: "scheduled", position: pending.proposed };
  if (confirmed) return confirmed.kind === "unscheduled" ? { kind: "unscheduled" } : { kind: "scheduled", position: confirmed.position };
  return canonical ? { kind: "scheduled", position: canonical } : undefined;
}

export function sameSchedulePosition(left: SchedulePosition | undefined, right: SchedulePosition | undefined): boolean {
  return Boolean(left && right && left.runId === right.runId && left.lane === right.lane && left.start === right.start && left.end === right.end);
}

export function confirmedPlacementIsSuperseded(
  confirmed: ConfirmedPlacement,
  snapshot: { source: "stop" | "projection"; exists?: boolean; stopVersion?: number; projectionSequence?: number; position?: SchedulePosition },
): boolean {
  if (confirmed.source === "projection") {
    return snapshot.source === "projection" && confirmed.projectionSequenceAtStart !== undefined && snapshot.projectionSequence !== undefined && snapshot.projectionSequence > confirmed.projectionSequenceAtStart;
  }
  if (confirmed.source !== "stop" || snapshot.source !== "stop") return false;
  if (confirmed.kind === "unscheduled") return snapshot.exists === false || (snapshot.stopVersion !== undefined && confirmed.stopVersion !== undefined && snapshot.stopVersion >= confirmed.stopVersion);
  return sameSchedulePosition(snapshot.position, confirmed.position) || Boolean(snapshot.stopVersion !== undefined && confirmed.stopVersion !== undefined && snapshot.stopVersion > confirmed.stopVersion);
}

export function reconcileUncertainPlacement(
  operation: PendingScheduleOperation,
  canonical: SchedulePosition | undefined,
  snapshot: { source: "stop" | "projection"; stopVersion?: number; projectionSequence?: number },
): "confirmed" | "superseded" | "pending" {
  if (operation.source === "projection") {
    if (snapshot.source !== "projection" || operation.projectionSequenceAtStart === undefined || snapshot.projectionSequence === undefined || snapshot.projectionSequence <= operation.projectionSequenceAtStart) return "pending";
    return sameSchedulePosition(canonical, operation.serverPosition || operation.proposed) ? "confirmed" : "superseded";
  }
  if (operation.source === "queue") {
    if (operation.projectionSequenceAtStart !== undefined && snapshot.projectionSequence !== undefined && snapshot.projectionSequence > operation.projectionSequenceAtStart) return "superseded";
    return "pending";
  }
  if (operation.source !== "stop" || snapshot.source !== "stop") return "pending";
  if (operation.intent === "unscheduled") {
    if (!canonical && snapshot.stopVersion !== undefined && snapshot.stopVersion >= (operation.stopVersionAtStart ?? 0)) return "confirmed";
  } else if (sameSchedulePosition(canonical, operation.serverPosition || operation.proposed)
    && snapshot.stopVersion !== undefined
    && snapshot.stopVersion > (operation.stopVersionAtStart ?? 0)) {
    return "confirmed";
  }
  if (snapshot.stopVersion !== undefined && snapshot.stopVersion > (operation.stopVersionAtStart ?? 0)) return "superseded";
  return "pending";
}

export function markUncertainPlacement(
  operation: PendingScheduleOperation,
  bestKnownPosition?: SchedulePosition,
  responseConfirmed = false,
  serverStopVersion?: number,
): PendingScheduleOperation {
  return {
    ...operation,
    ...(operation.intent === "scheduled" && bestKnownPosition ? { proposed: bestKnownPosition, serverPosition: bestKnownPosition } : {}),
    responseConfirmed,
    ...(serverStopVersion !== undefined ? { serverStopVersion } : {}),
    state: "uncertain",
    error: "Checking authoritative placement",
  };
}

export function scheduleClockMinutes(value: string | undefined): number | undefined {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return undefined;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export function scheduleTimeFromMinutes(value: number): string {
  const total = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function scheduleEndMinutes(start: string, end?: string): number | undefined {
  const startMinutes = scheduleClockMinutes(start);
  if (startMinutes === undefined) return undefined;
  const explicitEnd = scheduleClockMinutes(end);
  return explicitEnd ?? Math.min(23 * 60 + 59, startMinutes + DEFAULT_SCHEDULE_DURATION_MINUTES);
}

export function scheduleIntervalsOverlap(left: ScheduleInterval, right: ScheduleInterval): boolean {
  const leftStart = scheduleClockMinutes(left.start);
  const rightStart = scheduleClockMinutes(right.start);
  const leftEnd = scheduleEndMinutes(left.start, left.end);
  const rightEnd = scheduleEndMinutes(right.start, right.end);
  if (leftStart === undefined || rightStart === undefined || leftEnd === undefined || rightEnd === undefined) return false;
  return leftStart < rightEnd && rightStart < leftEnd;
}

/**
 * Resolve a requested start against a bounded set of intervals. Every
 * collision advances by at least one scheduling quantum, including intervals
 * without an explicit end. A bounded failure is preferable to hanging a
 * request when an invalid/cyclic set is ever supplied.
 */
export function resolveNextAvailableScheduleStart(
  requestedStart: string,
  requestedEnd: string | undefined,
  conflicts: ScheduleInterval[],
): string {
  const requestedStartMinutes = scheduleClockMinutes(requestedStart);
  const requestedEndMinutes = scheduleEndMinutes(requestedStart, requestedEnd);
  if (requestedStartMinutes === undefined || requestedEndMinutes === undefined) return requestedStart;
  const duration = Math.max(DEFAULT_SCHEDULE_DURATION_MINUTES, requestedEndMinutes - requestedStartMinutes);
  const maxSteps = Math.max(1, conflicts.length + 1);
  let candidate = requestedStartMinutes;

  for (let step = 0; step < maxSteps; step += 1) {
    const candidateInterval = { start: scheduleTimeFromMinutes(candidate), end: scheduleTimeFromMinutes(candidate + duration) };
    const conflict = conflicts.find((item) => scheduleIntervalsOverlap(candidateInterval, item));
    if (!conflict) {
      if (candidate + duration > 23 * 60 + 59) throw new Error("No available schedule remains within the operational day.");
      return scheduleTimeFromMinutes(candidate);
    }
    const conflictEnd = scheduleEndMinutes(conflict.start, conflict.end);
    const next = Math.max(candidate + DEFAULT_SCHEDULE_DURATION_MINUTES, conflictEnd ?? candidate + DEFAULT_SCHEDULE_DURATION_MINUTES);
    if (next <= candidate) throw new Error("Schedule collision resolution could not advance.");
    candidate = next;
  }

  throw new Error("Schedule collision resolution exceeded its bounded limit.");
}

export function createPendingScheduleOperation(
  stopId: string,
  original: SchedulePosition | undefined,
  proposed: SchedulePosition | undefined,
  operationId = `schedule:${stopId}:${Date.now()}`,
  metadata: { source?: "stop" | "projection" | "queue"; projectionSequenceAtStart?: number; stopVersionAtStart?: number } = {},
): PendingScheduleOperation {
  return { operationId, stopId, original, proposed, intent: proposed ? "scheduled" : "unscheduled", rollback: original, state: "pending", source: metadata.source || "stop", projectionSequenceAtStart: metadata.projectionSequenceAtStart, stopVersionAtStart: metadata.stopVersionAtStart };
}

export function canStartPendingSchedule(operation: PendingScheduleOperation | undefined): boolean {
  return !operation;
}

export function canStartPlacement(stopId: string, operations: Record<string, PendingScheduleOperation>): boolean {
  return canStartPendingSchedule(operations[stopId]);
}

export function effectivePendingSchedulePosition(operation: PendingScheduleOperation): SchedulePosition | undefined {
  return operation.proposed;
}

export function settlePendingScheduleOperation(operation: PendingScheduleOperation, confirmed: SchedulePosition | undefined): PendingScheduleOperation {
  return { ...operation, proposed: confirmed, intent: confirmed ? "scheduled" : "unscheduled", state: "confirmed-response", error: undefined };
}

export function directResizeEnabled(hasExplicitWindow: boolean): boolean {
  return hasExplicitWindow;
}
