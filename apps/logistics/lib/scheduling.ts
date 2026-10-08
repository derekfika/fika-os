export const DEFAULT_SCHEDULE_DURATION_MINUTES = 15;
export const DEFAULT_DELIVERY_LOAD_DURATION_MINUTES = 30;
export const SCHEDULE_SLOT_MINUTES = 15;
export const LAST_SCHEDULABLE_MINUTE = 23 * 60 + 45;
export const LAST_INTERVAL_END_MINUTE = 24 * 60;

export type CanonicalStopTiming = {
  plannedArrivalTime?: string;
  plannedWindow?: { startTime: string; endTime?: string };
};

/** Replace both mutually-exclusive native timing fields as one value. */
export function replaceStopTiming<T extends CanonicalStopTiming>(stop: T, timing: CanonicalStopTiming): Omit<T, keyof CanonicalStopTiming> & CanonicalStopTiming {
  const { plannedArrivalTime: _arrival, plannedWindow: _window, ...withoutTiming } = stop;
  return { ...withoutTiming, ...timing } as Omit<T, keyof CanonicalStopTiming> & CanonicalStopTiming;
}

export type LoadScheduleTiming = { start?: string; end?: string };

/** Remove only the chosen load lane's timing before setting its replacement. */
export function replaceLoadTiming<T extends object>(
  load: T,
  lane: "delivery" | "collection",
  timing: LoadScheduleTiming,
): T {
  const value = load as T & { scheduledTime?: string; scheduledEnd?: string; collectionScheduledTime?: string; collectionScheduledEnd?: string };
  if (lane === "delivery") {
    const { scheduledTime: _start, scheduledEnd: _end, ...withoutTiming } = value;
    return { ...withoutTiming, ...(timing.start ? { scheduledTime: timing.start } : {}), ...(timing.end ? { scheduledEnd: timing.end } : {}) } as T;
  }
  const { collectionScheduledTime: _start, collectionScheduledEnd: _end, ...withoutTiming } = value;
  return { ...withoutTiming, ...(timing.start ? { collectionScheduledTime: timing.start } : {}), ...(timing.end ? { collectionScheduledEnd: timing.end } : {}) } as T;
}

export function validateOperationalSchedule(start: string, end?: string): string | undefined {
  const startMinute = scheduleClockMinutes(start);
  const endMinute = end === undefined ? undefined : scheduleClockMinutes(end);
  if (startMinute === undefined || startMinute > LAST_SCHEDULABLE_MINUTE) return "Schedule times must be between 00:00 and 23:45.";
  if (end !== undefined && (endMinute === undefined || endMinute > LAST_SCHEDULABLE_MINUTE)) return "Schedule times must be between 00:00 and 23:45.";
  if (endMinute !== undefined && endMinute - startMinute < SCHEDULE_SLOT_MINUTES) return "A scheduled window must be at least 15 minutes.";
  return undefined;
}

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

export type PlacementAuthority = {
  stopId: string;
  stopRunId: string;
  stopVersion: number;
  runVersions: Record<string, number>;
};

export function decodePlacementAuthority(body: Record<string, unknown>, expectedStopId: string): PlacementAuthority | undefined {
  const value = body.placementAuthority;
  if (!value || typeof value !== "object") return undefined;
  const authority = value as Record<string, unknown>;
  if (authority.stopId !== expectedStopId || typeof authority.stopRunId !== "string" || typeof authority.stopVersion !== "number" || !Number.isFinite(authority.stopVersion) || authority.stopVersion < 0) return undefined;
  if (!authority.runVersions || typeof authority.runVersions !== "object") return undefined;
  const runVersions = Object.fromEntries(Object.entries(authority.runVersions as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0));
  return Object.keys(runVersions).length
    ? { stopId: expectedStopId, stopRunId: authority.stopRunId, stopVersion: authority.stopVersion, runVersions }
    : undefined;
}

export function mergePlacementAuthority(previous: PlacementAuthority | undefined, update: PlacementAuthority): PlacementAuthority {
  return {
    ...previous,
    ...update,
    runVersions: { ...previous?.runVersions, ...update.runVersions },
  };
}

/** Retire response tokens only after the planner has observed every affected version. */
export function retireConvergedPlacementAuthorities(
  authorities: Record<string, PlacementAuthority>,
  stops: ReadonlyArray<{ canonicalId: string; runId: string; version: number }>,
  runs: ReadonlyArray<{ runId: string; version: number }>,
  busyStopIds: ReadonlySet<string>,
): Record<string, PlacementAuthority> {
  const stopById = new Map(stops.map((stop) => [stop.canonicalId, stop]));
  const runById = new Map(runs.map((run) => [run.runId, run]));
  let remaining = authorities;
  for (const [stopId, authority] of Object.entries(authorities)) {
    if (busyStopIds.has(stopId)) continue;
    const stop = stopById.get(stopId);
    if (!stop || stop.runId !== authority.stopRunId || stop.version < authority.stopVersion) continue;
    if (!Object.entries(authority.runVersions).every(([runId, version]) => {
      const run = runById.get(runId);
      return run !== undefined && run.version >= version;
    })) continue;
    if (remaining === authorities) remaining = { ...authorities };
    delete remaining[stopId];
  }
  return remaining;
}

export function nativePlacementVersions(
  authority: PlacementAuthority | undefined,
  fallback: { stopRunId: string; stopVersion: number; runVersions: Record<string, number> },
  targetRunId: string,
): { sourceRunId: string; expectedRunVersion?: number; expectedTargetRunVersion?: number; expectedStopVersion: number } {
  const sourceRunId = authority?.stopRunId || fallback.stopRunId;
  const sourceVersion = authority?.runVersions[sourceRunId] ?? fallback.runVersions[sourceRunId];
  const targetVersion = authority?.runVersions[targetRunId] ?? fallback.runVersions[targetRunId];
  return {
    sourceRunId,
    ...(sourceVersion !== undefined ? { expectedRunVersion: sourceVersion } : {}),
    ...(sourceRunId !== targetRunId && targetVersion !== undefined ? { expectedTargetRunVersion: targetVersion } : {}),
    expectedStopVersion: authority?.stopVersion ?? fallback.stopVersion,
  };
}

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
  runVersionsAtStart?: Record<string, number>;
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

export function projectedCollectionScheduleCommand(loadId: string | string[], targetRunId: string, scheduledTime: string, scheduledEnd?: string) {
  return {
    ...(Array.isArray(loadId) ? { action: "reschedule-delivery-loads" as const, loadIds: loadId } : { action: "reschedule-delivery-load" as const, loadId }),
    scheduledTime,
    targetRunId,
    lane: "collection" as const,
    ...(scheduledEnd ? { scheduledEnd } : {}),
  };
}

export function projectedDeliveryScheduleCommand(authority: { loadIds: string[]; expectedLoadVersions: Record<string, number> }, targetRunId: string, scheduledTime: string, scheduledEnd?: string) {
  if (!authority.loadIds.length || new Set(authority.loadIds).size !== authority.loadIds.length || authority.loadIds.some(id => !Number.isInteger(authority.expectedLoadVersions[id]) || authority.expectedLoadVersions[id] < 0)) return undefined;
  return { action: "reschedule-delivery-loads" as const, loadIds: [...authority.loadIds], expectedLoadVersions: Object.fromEntries(authority.loadIds.map(id => [id, authority.expectedLoadVersions[id]])), targetRunId, lane: "delivery" as const, scheduledTime, ...(scheduledEnd ? { scheduledEnd } : {}) };
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

export function confirmedResponseConverged(
  operation: PendingScheduleOperation,
  snapshot: {
    projectionSequence?: number;
    stopVersion?: number;
    runVersions?: Record<string, number>;
    exists: boolean;
  },
): boolean {
  if (operation.state !== "confirmed-response") return false;
  const hasNewProjection = operation.projectionSequenceAtStart !== undefined
    && snapshot.projectionSequence !== undefined
    && snapshot.projectionSequence > operation.projectionSequenceAtStart;
  if (operation.source === "projection") return hasNewProjection;
  if (!snapshot.exists) return hasNewProjection;
  if (operation.source !== "stop" || snapshot.stopVersion === undefined) return false;
  if (operation.stopVersionAtStart === undefined || snapshot.stopVersion <= operation.stopVersionAtStart) return false;
  if (operation.serverStopVersion !== undefined && snapshot.stopVersion < operation.serverStopVersion) return false;
  const runVersionsAtStart = Object.entries(operation.runVersionsAtStart || {});
  return runVersionsAtStart.length > 0 && runVersionsAtStart.every(([runId, startingVersion]) => {
    const currentVersion = snapshot.runVersions?.[runId];
    return currentVersion !== undefined && currentVersion > startingVersion;
  });
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
  if (hours === 24 && minutes === 0) return LAST_INTERVAL_END_MINUTE;
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export function scheduleTimeFromMinutes(value: number): string {
  const total = Math.max(0, Math.min(LAST_SCHEDULABLE_MINUTE, Math.round(value)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Add a duration only when the resulting persisted schedule time stays in-day. */
export function addSchedulableMinutes(value: string, duration: number): string | undefined {
  const start = scheduleClockMinutes(value);
  if (start === undefined || start > LAST_SCHEDULABLE_MINUTE || !Number.isInteger(duration) || duration < 0) return undefined;
  const end = start + duration;
  if (end > LAST_SCHEDULABLE_MINUTE) return undefined;
  return scheduleTimeFromMinutes(end);
}

function intervalEndFromMinutes(value: number): string {
  if (value >= LAST_INTERVAL_END_MINUTE) return "24:00";
  const total = Math.max(0, Math.min(LAST_INTERVAL_END_MINUTE, Math.round(value)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function scheduleEndMinutes(start: string, end?: string): number | undefined {
  const startMinutes = scheduleClockMinutes(start);
  if (startMinutes === undefined) return undefined;
  const explicitEnd = scheduleClockMinutes(end);
  return explicitEnd ?? Math.min(LAST_INTERVAL_END_MINUTE, startMinutes + DEFAULT_SCHEDULE_DURATION_MINUTES);
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
    const candidateInterval = { start: scheduleTimeFromMinutes(candidate), end: intervalEndFromMinutes(candidate + duration) };
    const conflict = conflicts.find((item) => scheduleIntervalsOverlap(candidateInterval, item));
    if (!conflict) {
      const latestEnd = requestedEnd === undefined ? LAST_INTERVAL_END_MINUTE : LAST_SCHEDULABLE_MINUTE;
      if (candidate > LAST_SCHEDULABLE_MINUTE || candidate + duration > latestEnd) throw new Error("No available schedule remains within the operational day.");
      return scheduleTimeFromMinutes(candidate);
    }
    const conflictEnd = scheduleEndMinutes(conflict.start, conflict.end);
    const next = Math.max(candidate + DEFAULT_SCHEDULE_DURATION_MINUTES, conflictEnd ?? candidate + DEFAULT_SCHEDULE_DURATION_MINUTES);
    if (next <= candidate) throw new Error("Schedule collision resolution could not advance.");
    if (next > LAST_SCHEDULABLE_MINUTE) throw new Error("No available schedule remains within the operational day.");
    candidate = next;
  }

  throw new Error("Schedule collision resolution exceeded its bounded limit.");
}

export function createPendingScheduleOperation(
  stopId: string,
  original: SchedulePosition | undefined,
  proposed: SchedulePosition | undefined,
  operationId = `schedule:${stopId}:${Date.now()}`,
  metadata: { source?: "stop" | "projection" | "queue"; projectionSequenceAtStart?: number; stopVersionAtStart?: number; runVersionsAtStart?: Record<string, number> } = {},
): PendingScheduleOperation {
  return { operationId, stopId, original, proposed, intent: proposed ? "scheduled" : "unscheduled", rollback: original, state: "pending", source: metadata.source || "stop", projectionSequenceAtStart: metadata.projectionSequenceAtStart, stopVersionAtStart: metadata.stopVersionAtStart, ...(metadata.runVersionsAtStart ? { runVersionsAtStart: metadata.runVersionsAtStart } : {}) };
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
