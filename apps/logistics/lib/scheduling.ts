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
  original: SchedulePosition;
  proposed: SchedulePosition;
  state: "pending" | "saving" | "confirmed-response" | "uncertain";
  rollback: SchedulePosition;
  error?: string;
};

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
  original: SchedulePosition,
  proposed: SchedulePosition,
  operationId = `schedule:${stopId}:${Date.now()}`,
): PendingScheduleOperation {
  return { operationId, stopId, original, proposed, rollback: original, state: "pending" };
}

export function canStartPendingSchedule(operation: PendingScheduleOperation | undefined): boolean {
  return !operation;
}

export function effectivePendingSchedulePosition(operation: PendingScheduleOperation): SchedulePosition {
  return operation.proposed;
}

export function settlePendingScheduleOperation(operation: PendingScheduleOperation, confirmed: SchedulePosition): PendingScheduleOperation {
  return { ...operation, proposed: confirmed, state: "confirmed-response", error: undefined };
}

export function directResizeEnabled(hasExplicitWindow: boolean): boolean {
  return hasExplicitWindow;
}
