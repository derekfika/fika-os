import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { db } from "@/lib/firebase";
import { logisticsCacheScope, requireLogisticsAccess, type LogisticsPrincipal } from "@/lib/auth";
import { authorizeCommand, authorizeLoad, authorizeRun, assertMaintenanceAccess, scopeProjection, vehicleScope } from "@/lib/resource-authority";
import { authorizeTransaction } from "@/lib/authorized-transaction";
import { isLogisticsVehicleId, logisticsVehicleLabel } from "../../../../shared/logistics-authority";
import { hostedRuntime } from "@/lib/runtime";
import {
  fetchOplocs,
  fetchProductionContexts,
  fetchRequirements,
  fetchRequirementsForDateRange,
} from "@/lib/upstream";
import { buildPlannerDay } from "@/lib/planner-read-model";
import {
  listState,
  getRun,
  getLogisticsJob,
  getDeliveryLoad,
  reportLogisticsReadPath,
  movements,
  runs,
  stops,
  normalizeStop,
  collectionPreferences,
  listCollectionPreferenceKeys,
  saveCollectionPreference,
  listDeliveryLoadState,
  logisticsJobs,
  deliveryLoads,
  logisticsAssignments,
  listRunIntegrityDiagnosticState,
  saveLogisticsJob,
  appendLogisticsChange,
  getLogisticsProjection,
  listLogisticsProjectionSummaries,
  summarizeLogisticsProjection,
  listPlanningAttention,
  getLogisticsSyncHead,
  logisticsChangeCursor,
  logisticsDayCursorId,
  logisticsDayProjections,
  listLogisticsChanges,
  repairLegacyAssignmentServiceDates,
} from "@/lib/store";
import { aggregateDelivery, assertLoadVersion, compatibleLoad, assertDispatchable, removeAssignment, setJobCollectionStatus } from "@/lib/delivery-loads";
import { assignmentIntegrityDiagnostic } from "@/lib/assignment-integrity-diagnostic";
import { executeProjected, projectedActions } from "@/lib/projected-execution";
import { readRunWork, assertRunReady, workOutstanding, workIssuesOpen, finaliseRun } from "@/lib/run-execution";
import { assignCanonicalJob, assertLoadAssignmentsCurrent } from "@/lib/load-assignment";
import { CPU_PRODUCTION_LOCATION_ID, CPU_SITE_OPLOC_ID } from "../../../../shared/production-location";
import { rebuildLogisticsProjection as materialiseRebuildLogisticsProjection, reconcileLogisticsDay as materialiseLogisticsDay, logisticsJobForRequirement } from "@/lib/logistics-materialisation";
import { projectionToDashboardData } from "@/lib/projection-dashboard-adapter";
import {
  assignMovementStops,
  combineStop,
  orderedTransferStops,
  transferLegsForStop,
  transferOrderProblem,
  assertRunPlanningOpen,
  validateRequirementForPlanning,
  linkedCollectionForDelivery,
} from "@/lib/planning";
import { operationalDate } from "@/lib/date";
import { addOperationalDays, operationalWeek } from "@/lib/week";
import { addSchedulableMinutes, replaceLoadTiming, replaceStopTiming, resolveNextAvailableScheduleStart, validateOperationalSchedule } from "@/lib/scheduling";
import { restoredStopStatus } from "@/lib/mobile-driver";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import type { Transaction } from "firebase-admin/firestore";
import type { PlannerWeekSummary } from "@/lib/planner-read-model";
import type { DeliveryRun, DeliveryStop, LogisticsDayProjection, MovementRequest } from "@/lib/types";
import type { FulfilmentRequirement } from "../../../../shared/fulfilment-requirement";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown upstream error.";

async function runAuthorizedTracedTransaction<T>(
  callback: (transaction: Transaction) => Promise<T>,
  principal: LogisticsPrincipal,
  cookie?: string,
  revalidateDrivers = false,
): Promise<T> {
  return db.runTransaction(async (transaction) => {
    const originalGet = transaction.get.bind(transaction) as (reference: any) => Promise<any>;
    (transaction as any).get = async (reference: any) => {
      const snapshot = await originalGet(reference);
      const documents =
        typeof snapshot?.size === "number"
          ? snapshot.size
          : snapshot?.exists
            ? 1
            : 0;
      recordDataAccess({
        app: "logistics",
        operation: "logistics.transaction.read",
        source: "FIRESTORE",
        documents,
        firestoreReadKind: "transaction",
      });
      return snapshot;
    };
    return authorizeTransaction(transaction, principal, callback, cookie, revalidateDrivers);
  });
}
function labelFor(oplocs: Awaited<ReturnType<typeof fetchOplocs>>, id: string) {
  const match = oplocs.find((oploc) => oploc.id === id);
  if (!match)
    throw new HttpError(
      422,
      `OPLOC ${id} is not an active governed Integration Hub location.`,
    );
  return match.label;
}
function runPayload(
  run: DeliveryRun,
  stopsForRun: DeliveryStop[],
  now: string,
  by: string,
) {
  const ordered = orderedTransferStops(stopsForRun);
  const nextVersion = run.version + 1;
  return {
    ...run,
    orderedStopIds: ordered.map((stop) => stop.canonicalId),
    status: run.status === "draft" ? ("planned" as const) : run.status,
    version: nextVersion,
    updatedAt: now,
    audit: [
      ...run.audit,
      { action: "work-assigned", at: now, by, version: nextVersion },
    ],
  };
}
function assertPlanningOpen(run: DeliveryRun) {
  try { assertRunPlanningOpen(run); }
  catch (error) { throw new HttpError(422, error instanceof Error ? error.message : "Return the run to planning before changing its structure."); }
}
async function transferContext(transaction: Transaction, stop: DeliveryStop) {
  const movementIds = stop.movementRequestIds || (stop.movementRequestId ? [stop.movementRequestId] : []);
  const movementSnapshots = await Promise.all(movementIds.map(id => transaction.get(movements().doc(id))));
  const linkedMovements = movementSnapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as MovementRequest);
  const inconsistentMovementIds = movementSnapshots.flatMap((snapshot, index) => snapshot.exists && (snapshot.data() as MovementRequest).canonicalId !== movementIds[index] ? [movementIds[index]] : []);
  const missingMovementIds = movementIds.filter((_, index) => !movementSnapshots[index].exists);
  const transferMovements = linkedMovements.filter(movement => movement.type === "transfer");
  const linkedStops = new Map<string, DeliveryStop>([[stop.canonicalId, stop]]);
  for (const movement of transferMovements) {
    const snapshots = await Promise.all([
      transaction.get(stops().where("movementRequestIds", "array-contains", movement.canonicalId)),
      transaction.get(stops().where("movementRequestId", "==", movement.canonicalId)),
    ]);
    for (const doc of snapshots.flatMap(snapshot => snapshot.docs)) linkedStops.set(doc.id, normalizeStop(doc.data()));
  }
  return { movements: linkedMovements, transferMovements, inconsistentMovementIds, missingMovementIds, stops: [...linkedStops.values()] };
}
function collectionScheduleForDelivery(delivery: DeliveryStop) {
  const deliveryStart = delivery.plannedWindow?.startTime || delivery.plannedArrivalTime;
  if (!deliveryStart) return {};
  const plannedArrivalTime = addSchedulableMinutes(deliveryStart, 6 * 60);
  return plannedArrivalTime ? { plannedArrivalTime } : {};
}
function nextAvailableLoadTime(loads: import("@/lib/types").DeliveryLoad[], input: { loadId?: string; runId?: string; lane: "delivery" | "collection"; destinationOplocId: string; start: string; end?: string }) {
  const conflicts = loads.flatMap((load) => {
    if (load.id === input.loadId || load.status === "cancelled" || !input.runId) return [];
    const sameRun = input.lane === "collection" ? (load.collectionRunId || load.runId) === input.runId : load.runId === input.runId;
    const destination = input.lane === "collection" ? load.originOplocId : load.destinationOplocId;
    if (!sameRun || destination === input.destinationOplocId) return [];
    const start = input.lane === "collection" ? load.collectionScheduledTime : load.scheduledTime;
    if (!start) return [];
    return [{ id: load.id, start, end: input.lane === "collection" ? load.collectionScheduledEnd : load.scheduledEnd }];
  });
  try {
    return resolveNextAvailableScheduleStart(input.start, input.end, conflicts);
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : "No available schedule remains within the operational day.");
  }
}
function resolveCanonicalLoadSchedule(loads: import("@/lib/types").DeliveryLoad[], job: import("@/lib/types").LogisticsJob, runId: string | undefined, start: string, end?: string) {
  const scheduledTime = nextAvailableLoadTime(loads, { runId, lane: "delivery", destinationOplocId: job.destinationOplocId!, start, end });
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const scheduledEnd = end ? addSchedulableMinutes(scheduledTime, minutes(end) - minutes(start)) : undefined;
  if (end && !scheduledEnd) throw new HttpError(409, "The requested window does not fit within the operational day.");
  return { scheduledTime, ...(scheduledEnd ? { scheduledEnd } : {}) };
}

type PlannedTiming = { plannedArrivalTime?: string; plannedWindow?: { startTime: string; endTime?: string } };

function resolveStopPlannedTiming(stop: DeliveryStop, requested: PlannedTiming, conflicts: DeliveryStop[]): PlannedTiming {
  const start = requested.plannedWindow?.startTime || requested.plannedArrivalTime;
  if (!start) return requested;
  const end = requested.plannedWindow?.endTime;
  const conflictIntervals = conflicts.flatMap((candidate) => {
    if (candidate.canonicalId === stop.canonicalId || candidate.status === "completed") return [];
    const candidateLane = candidate.linkedOperation === "collection" || candidate.movementType === "collection" ? "collection" : "delivery";
    const stopLane = stop.linkedOperation === "collection" || stop.movementType === "collection" ? "collection" : "delivery";
    if (candidateLane !== stopLane || candidate.locationOplocId === stop.locationOplocId) return [];
    const candidateStart = candidate.plannedWindow?.startTime || candidate.plannedArrivalTime;
    if (!candidateStart) return [];
    return [{ id: candidate.canonicalId, start: candidateStart, end: candidate.plannedWindow?.endTime }];
  });
  let effectiveStart: string;
  try {
    effectiveStart = resolveNextAvailableScheduleStart(start, end, conflictIntervals);
  } catch (error) {
    throw new HttpError(409, error instanceof Error ? error.message : "No available schedule remains within the operational day.");
  }
  if (end) {
    const requestedDuration = Math.max(15, Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5))));
    const effectiveEnd = addSchedulableMinutes(effectiveStart, requestedDuration);
    if (!effectiveEnd) throw new HttpError(409, "The requested window does not fit within the operational day.");
    return { plannedWindow: { startTime: effectiveStart, endTime: effectiveEnd } };
  }
  return { plannedArrivalTime: effectiveStart };
}
function assertTransition(
  status: DeliveryRun["status"],
  next: DeliveryRun["status"],
) {
  const allowed: Record<DeliveryRun["status"], DeliveryRun["status"][]> = {
    draft: ["planned"],
    planned: ["ready", "dispatched"],
    ready: ["planned", "dispatched"],
    dispatched: ["completed"],
    completed: [],
  };
  if (!allowed[status].includes(next))
    throw new HttpError(
      422,
      `Run cannot transition from ${status} to ${next}.`,
    );
}
function validatePlannedSchedule(
  plannedArrivalTime?: unknown,
  plannedWindow?: unknown,
) {
  const time = plannedArrivalTime === undefined ? undefined : String(plannedArrivalTime);
  const window = plannedWindow as { startTime?: unknown; endTime?: unknown } | undefined;
  const start = window?.startTime === undefined ? undefined : String(window.startTime);
  const end = window?.endTime === undefined ? undefined : String(window.endTime);
  const validTime = (value?: string) => value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validTime(time) || !validTime(start) || !validTime(end))
    throw new HttpError(422, "Planned times must use local HH:mm values.");
  if (time && (start || end)) throw new HttpError(422, "Choose a planned arrival time or a planned window, not both.");
  if (!time && !start) throw new HttpError(422, "A planned arrival time or window start is required.");
  if (end && !start) throw new HttpError(422, "A planned window end requires a start time.");
  if (time || start) {
    const problem = validateOperationalSchedule(time || start!, time ? undefined : end);
    if (problem) throw new HttpError(422, problem);
  }
  return {
    ...(time ? { plannedArrivalTime: time } : {}),
    ...(start ? { plannedWindow: { startTime: start, ...(end ? { endTime: end } : {}) } } : {}),
  } as Pick<DeliveryStop, "plannedArrivalTime" | "plannedWindow">;
}
function clearPlannedSchedule(stop: DeliveryStop, now: string, by: string) {
  const { plannedArrivalTime: _arrival, plannedWindow: _window, ...withoutSchedule } = stop;
  return {
    ...withoutSchedule,
    version: stop.version + 1,
    updatedAt: now,
    audit: [...stop.audit, { action: "stop-schedule-cleared", at: now, by, version: stop.version + 1 }],
  } as DeliveryStop;
}

function activeLogisticsRequirements(
  requirements: FulfilmentRequirement[],
) {
  return requirements.filter((requirement) => {
    if (requirement.status === "withdrawn") return false;
    // FIKA Xchange is local CPU production, not a delivery requirement.
    return requirement.destinationOplocId !== CPU_SITE_OPLOC_ID;
  });
}

const legacyVehicleEvidenceFields = ["vehicleSlot", "vehicle", "van", "vehicleName", "vehicleCode", "vehicleNumber", "vehicleLabel"] as const;
function legacyVehicleEvidence(value: Record<string, unknown>) {
  return Object.fromEntries(legacyVehicleEvidenceFields
    .filter((field) => Object.prototype.hasOwnProperty.call(value, field) && (value[field] === null || ["string", "number", "boolean"].includes(typeof value[field])))
    .map((field) => [field, value[field]]));
}
function diagnosticStringIds(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

function validOperationalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function classifyMissingProjection(serviceDate: string, cookie?: string) {
  const [requirements, state, loadState] = await Promise.all([
    fetchRequirements(serviceDate, cookie),
    listState(serviceDate),
    listDeliveryLoadState(serviceDate),
  ]);
  const activeRequirements = activeLogisticsRequirements(requirements.filter((item) => item.serviceDate === serviceDate));
  const hasLocalState = state.runs.length > 0 || state.stops.length > 0 || state.movements.length > 0 || loadState.jobs.length > 0 || loadState.loads.length > 0 || loadState.assignments.length > 0;
  return activeRequirements.length || hasLocalState ? "NOT_MATERIALIZED" as const : "EMPTY" as const;
}

async function rebuildLogisticsProjection(serviceDate: string, actorId: string, lastChangeSequence?: number) {
  return materialiseRebuildLogisticsProjection(serviceDate, actorId, lastChangeSequence);
}

async function recordCanonicalLogisticsChange(input: {
  serviceDate: string;
  entityType: "run" | "stop" | "movement";
  entityId: string;
  changeType: string;
  revision: number;
  actorId: string;
  by: string;
  changedAt: string;
}) {
  const event = await appendLogisticsChange({
    serviceDate: input.serviceDate,
    entityType: input.entityType,
    entityId: input.entityId,
    changeType: input.changeType,
    revision: input.revision,
    changedAt: input.changedAt,
    actorId: input.actorId,
  });
  await rebuildLogisticsProjection(input.serviceDate, input.by, event.sequence);
  return event;
}

async function assertProjectionCurrent(serviceDate: string, transaction?: Transaction) {
  const [projection, headSequence] = transaction
    ? await Promise.all([
        transaction.get(logisticsDayProjections().doc(serviceDate)).then((snapshot) => snapshot.exists ? snapshot.data() as import("@/lib/types").LogisticsDayProjection : undefined),
        transaction.get(logisticsChangeCursor().doc(logisticsDayCursorId(serviceDate))).then((snapshot) => Number(snapshot.data()?.sequence || 0)),
      ])
    : await Promise.all([getLogisticsProjection(serviceDate), getLogisticsSyncHead(serviceDate).then((head) => head.sequence)]);
  if (!projection || projection.state === "STALE" || projection.state === "PARTIAL" || projection.state === "UNAVAILABLE" || projection.lastChangeSequence < headSequence)
    throw new HttpError(409, "Logistics changed upstream. Wait for reconciliation, then refresh before continuing.");
  return projection;
}

async function scopeCanonicalProjection(projection: LogisticsDayProjection, principal: LogisticsPrincipal, vehicle?: string | null) {
  const effective = { ...principal, permittedVehicleIds: vehicleScope(principal, vehicle) };
  const canonicalRuns = new Map((await Promise.all(projection.runs.map(run => getRun(run.canonicalId)))).filter((run): run is DeliveryRun => Boolean(run)).map(run => [run.canonicalId, run]));
  const runs = projection.runs.filter(run => canonicalRuns.get(run.canonicalId)?.vehicleId === run.vehicleId);
  const deliveryLoads = [];
  for (const load of projection.deliveryLoads) {
    const canonical = await Promise.all((load.loadIds || [load.id]).map(id => getDeliveryLoad(id)));
    let visible = canonical.every(item => Boolean(item));
    for (const item of canonical) if (item) {
      try { await authorizeLoad(effective, item, async id => canonicalRuns.get(id) || await getRun(id)); }
      catch (error) { if (![403, 409].includes((error as { status?: number }).status || 0)) throw error; visible = false; }
    }
    if (visible) deliveryLoads.push(load);
  }
  return scopeProjection({ ...projection, runs, deliveryLoads }, principal, vehicle);
}

async function getLogistics(request: NextRequest, principal: LogisticsPrincipal) {
  const requestedRunId = request.nextUrl.searchParams.get("runId") || undefined;
  const vehicleContext = request.nextUrl.searchParams.get("vehicle") || undefined;
  if (vehicleContext && vehicleContext !== "van1" && vehicleContext !== "van2") throw new HttpError(400, "Invalid Logistics vehicle context.");
  const requestedDate =
    request.nextUrl.searchParams.get("serviceDate") || undefined;
  const requestedWeek =
    request.nextUrl.searchParams.get("weekCommencing") || undefined;
  const cookie = request.headers.get("cookie") || undefined;
  if (request.nextUrl.searchParams.get("diagnostic") === "1") {
    const serviceDate = requestedDate || operationalDate();
    if (!validOperationalDate(serviceDate)) throw new HttpError(400, "Invalid Logistics service date.");
    const [requirements, integrityState, projection, head] = await Promise.all([fetchRequirements(serviceDate, cookie), listRunIntegrityDiagnosticState(serviceDate), getLogisticsProjection(serviceDate), getLogisticsSyncHead(serviceDate)]);
    const auditJobs = new Map(integrityState.jobs.map(({ id, data }) => [String(data.id || id), data as import("@/lib/types").LogisticsJob]));
    const auditLoads = new Map(integrityState.loads.map(({ id, data }) => [String(data.id || id), data as import("@/lib/types").DeliveryLoad]));
    const missingJobIds = diagnosticStringIds(integrityState.assignments.map(({ data }) => data.jobId)).filter(id => !auditJobs.has(id));
    const missingLoadIds = diagnosticStringIds(integrityState.assignments.map(({ data }) => data.loadId)).filter(id => !auditLoads.has(id));
    await Promise.all([
      ...missingJobIds.map(async id => { const job = await getLogisticsJob(id); if (job) auditJobs.set(id, job); }),
      ...missingLoadIds.map(async id => { const load = await getDeliveryLoad(id); if (load) auditLoads.set(id, load); }),
    ]);
    const rawRuns = integrityState.runs.map(({ id, data }) => ({ id, raw: data, canonicalId: typeof data.canonicalId === "string" ? data.canonicalId : id }));
    const runIds = new Set(rawRuns.flatMap((run) => [run.id, run.canonicalId]));
    const rawStops = integrityState.stops.map(({ id, data }) => ({ id, raw: data, canonicalId: typeof data.canonicalId === "string" ? data.canonicalId : id }))
      .filter((stop) => runIds.has(String(stop.raw.runId || "")));
    const rawLoads = integrityState.loads.map(({ id, data }) => ({ id: typeof data.id === "string" ? data.id : id, raw: data }))
      .filter((load) => runIds.has(String(load.raw.runId || "")) || runIds.has(String(load.raw.collectionRunId || "")));
    const linkedLoadIds = new Set(rawLoads.map((load) => load.id));
    const rawAssignments = integrityState.assignments.map(({ id, data }) => ({ id, raw: data }))
      .filter((assignment) => linkedLoadIds.has(String(assignment.raw.loadId || "")));
    const assignmentsByLoad = new Map<string, typeof rawAssignments>();
    for (const assignment of rawAssignments) {
      const loadId = String(assignment.raw.loadId || "");
      assignmentsByLoad.set(loadId, [...(assignmentsByLoad.get(loadId) || []), assignment]);
    }
    const rawMovementsById = new Map(integrityState.movements.map(({ id, data }) => [String(data.canonicalId || id), { id: String(data.canonicalId || id), type: data.type ?? null }]));
    const runIntegrityRuns = rawRuns.map(({ id, raw, canonicalId }) => {
      const runStops = rawStops.filter((stop) => String(stop.raw.runId || "") === id || String(stop.raw.runId || "") === canonicalId);
      const linkedLoads = rawLoads.filter((load) => String(load.raw.runId || "") === id || String(load.raw.runId || "") === canonicalId || String(load.raw.collectionRunId || "") === id || String(load.raw.collectionRunId || "") === canonicalId);
      const runMovementIds = diagnosticStringIds(runStops.flatMap((stop) => [
        ...(Array.isArray(stop.raw.movementRequestIds) ? stop.raw.movementRequestIds : []),
        stop.raw.movementRequestId,
      ]));
      return {
        canonicalId,
        serviceDate: raw.serviceDate ?? null,
        version: raw.version ?? null,
        status: raw.status ?? null,
        vehicleId: raw.vehicleId ?? null,
        vehicleIdPresent: Object.prototype.hasOwnProperty.call(raw, "vehicleId"),
        vehicleLabel: raw.vehicleLabel ?? null,
        driverId: raw.driverId ?? null,
        driverLabel: raw.driverLabel ?? null,
        createdAt: raw.createdAt ?? null,
        updatedAt: raw.updatedAt ?? null,
        audit: (Array.isArray(raw.audit) ? raw.audit : []).slice(-20).map((entry: Record<string, unknown>) => ({ action: entry.action ?? null, at: entry.at ?? null, version: entry.version ?? null })),
        orderedStopIds: Array.isArray(raw.orderedStopIds) ? raw.orderedStopIds : [],
        validVehicleId: isLogisticsVehicleId(raw.vehicleId),
        legacyVehicleEvidence: legacyVehicleEvidence(raw),
        stops: runStops.map(({ raw: stop, canonicalId: stopCanonicalId }) => ({
          canonicalId: stopCanonicalId,
          runId: stop.runId ?? null,
          requirementIds: diagnosticStringIds([
            ...(Array.isArray(stop.requirementRefs) ? stop.requirementRefs.map((ref: Record<string, unknown>) => ref?.requirementId) : []),
            ...(Array.isArray(stop.requirementIds) ? stop.requirementIds : []),
          ]),
          originatingLoadKey: stop.originatingLoadKey ?? null,
          legacyVehicleEvidence: legacyVehicleEvidence(stop),
        })),
        loads: linkedLoads.map(({ id: loadId, raw: load }) => {
          const assignments = assignmentsByLoad.get(loadId) || [];
          const referencedJobIds = diagnosticStringIds([
            ...(Array.isArray(load.jobIds) ? load.jobIds : []),
            ...assignments.map((assignment) => assignment.raw.jobId),
          ]);
          return {
            id: loadId,
            serviceDate: load.serviceDate ?? null,
            runId: load.runId ?? null,
            collectionRunId: load.collectionRunId ?? null,
            vehicleId: load.vehicleId ?? null,
            status: load.status ?? null,
            jobCount: typeof load.jobCount === "number" ? load.jobCount : referencedJobIds.length,
            referencedJobIds,
            legacyVehicleEvidence: legacyVehicleEvidence(load),
          };
        }),
        movements: runMovementIds.map((movementId) => rawMovementsById.get(movementId) || { id: movementId, type: null }),
      };
    });
    const legacy = buildPlannerDay({ serviceDate, requirements, runs: integrityState.runs.map(({ data }) => data as unknown as import("@/lib/types").DeliveryRun), stops: rawStops.map(({ raw }) => normalizeStop(raw) as unknown as import("@/lib/types").DeliveryStop), movements: integrityState.movements.map(({ data }) => data as unknown as import("@/lib/types").MovementRequest), oplocs: [], health: { fulfilment: { available: true }, oplocs: { available: true }, enrichment: { available: true } } });
    const plannedRequirementIds = new Set(rawStops.flatMap(({ raw }) => [
      ...(Array.isArray(raw.requirementRefs) ? raw.requirementRefs.map((ref: Record<string, unknown>) => ref?.requirementId) : []),
      ...(Array.isArray(raw.requirementIds) ? raw.requirementIds : []),
    ]).filter((id): id is string => typeof id === "string"));
    const comparison = { jobs: requirements.length, unassignedJobs: requirements.filter((requirement) => !plannedRequirementIds.has(requirement.canonicalId)).length, deliveryLoads: legacy.summary.loads, collectedJobs: 0, projection: { jobs: projection ? projection.summary.queuedJobs + projection.summary.assignedJobs : 0, unassignedJobs: projection?.summary.queuedJobs || 0, deliveryLoads: projection?.summary.loads || 0, collectedJobs: projection?.summary.collectedJobs || 0 } };
    const canonicalJobIds = new Set(integrityState.jobs.map(({ id, data }) => String(data.id || id)));
    const projectionJobIds = new Set([
      ...(projection?.planningQueue || []).map((job) => job.id),
      ...(projection?.deliveryLoads || []).flatMap((load) => load.jobs.map((job) => job.id)),
    ]);
    const canonicalLoadIds = new Set(integrityState.loads.map(({ id, data }) => String(data.id || id)));
    const projectionLoadIds = new Set((projection?.deliveryLoads || []).flatMap((load) => load.loadIds?.length ? load.loadIds : [load.id]));
    const differences = (canonical: Set<string>, projected: Set<string>) => ({ missingFromProjection: [...canonical].filter((id) => !projected.has(id)), projectionOnly: [...projected].filter((id) => !canonical.has(id)) });
    const rawDayCounts = { runs: integrityState.runs.length, stops: integrityState.stops.length, jobs: integrityState.jobs.length, loads: integrityState.loads.length, assignments: integrityState.assignments.length, movements: integrityState.movements.length };
    const assignmentEvidence = rawAssignments.map(({ id, raw }) => ({ id, jobId: raw.jobId ?? null, loadId: raw.loadId ?? null }));
    const assignmentIntegrity = assignmentIntegrityDiagnostic({ serviceDate,
      assignments: integrityState.assignments.map(({ id, data }) => ({ id, data: data as import("@/lib/types").LogisticsAssignment })),
      jobs: auditJobs, loads: auditLoads, nativeRequirementIds: plannedRequirementIds, projection, headSequence: head.sequence });
    return NextResponse.json({
      serviceDate,
      comparison: { ...comparison, countBasis: "Legacy requirement/planner counts and grouped projection-card counts are informational; synchronization uses eligible canonical ID coverage.", entityDifferences: { jobs: differences(canonicalJobIds, projectionJobIds), loads: differences(canonicalLoadIds, projectionLoadIds) } },
      runIntegrity: { entityCounts: rawDayCounts, runs: runIntegrityRuns, assignments: assignmentEvidence },
      assignmentIntegrity,
      status: assignmentIntegrity.projectionStatus,
    });
  }
  if (request.nextUrl.searchParams.get("projection") === "1") {
    reportLogisticsReadPath("dashboard:cold-or-projection-load");
    const serviceDate = requestedDate || operationalDate();
    if (!validOperationalDate(serviceDate)) throw new HttpError(400, "Invalid Logistics service date.");
    const startedAt = performance.now();
    let projection = await getLogisticsProjection(serviceDate);
    // Projection reads are deliberately side-effect free. Reconciliation and
    // rebuilding remain explicit POST/admin operations, so idle dashboard and
    // mobile loads cannot create Firestore writes.
    const syncHead = await getLogisticsSyncHead(serviceDate);
    const projectionState = projection && projection.lastChangeSequence < syncHead.sequence ? "STALE" as const : projection?.state || "CURRENT" as const;
    if (projection) projection = { ...await scopeCanonicalProjection(projection, principal, vehicleContext), state: projectionState };
    if (!projection) {
      let state: "EMPTY" | "NOT_MATERIALIZED";
      try {
        state = await classifyMissingProjection(serviceDate, cookie);
      } catch (cause) {
        throw Object.assign(new HttpError(503, "Logistics projection state could not be verified."), { code: "LOGISTICS_PROJECTION_STATE_UNAVAILABLE", cause });
      }
      if (state === "NOT_MATERIALIZED") throw Object.assign(new HttpError(503, "Logistics projection has not been materialised."), { code: "LOGISTICS_PROJECTION_NOT_MATERIALIZED" });
      return NextResponse.json({ projection: null, state: state === "EMPTY" ? "EMPTY" : "MISSING", projectionState: state === "EMPTY" ? "VALID_EMPTY" : "MISSING", serviceDate, metrics: { projectionFetchMs: Math.round(performance.now() - startedAt), dashboardReadyMs: Math.round(performance.now() - startedAt) } });
    }
    const dashboard = projectionToDashboardData(projection);
    return NextResponse.json({ ...dashboard, projection, state: "READY", projectionState: projection.state || "CURRENT", metrics: { projectionFetchMs: Math.round(performance.now() - startedAt), dashboardReadyMs: Math.round(performance.now() - startedAt) } });
  }
  if (request.nextUrl.searchParams.get("weekSummary") === "1") {
    const dates = operationalWeek(requestedWeek || requestedDate || operationalDate());
    return NextResponse.json({ weekCommencing: dates[0], days: await listLogisticsProjectionSummaries(dates) });
  }
  if (request.nextUrl.searchParams.get("syncHead") === "1") {
    reportLogisticsReadPath("manifest-head-check");
    const serviceDate = requestedDate || operationalDate();
    if (!validOperationalDate(serviceDate)) throw new HttpError(400, "Invalid Logistics service date.");
    return NextResponse.json(await getLogisticsSyncHead(serviceDate));
  }
  if (request.nextUrl.searchParams.get("planningAttention") === "1") {
    const fromDate = requestedDate || operationalDate();
    const requestedDays = Number(request.nextUrl.searchParams.get("days") || 14);
    const days = Math.min(14, Math.max(1, Number.isFinite(requestedDays) ? requestedDays : 14));
    reportLogisticsReadPath("planning-attention-check");
    const serviceDates = Array.from({ length: days }, (_, index) => addOperationalDays(fromDate, index));
    const upstream = await fetchRequirementsForDateRange(serviceDates[0], addOperationalDays(serviceDates[days - 1], 1), cookie).catch(() => []);
    const expectedSourceKeys = new Map(serviceDates.map((serviceDate) => [serviceDate, new Set(upstream.filter((item) => item.serviceDate === serviceDate && item.status !== "withdrawn").map((item) => `${item.sourceDomain}:${item.sourceEntityId}`))]));
    return NextResponse.json({ attention: await listPlanningAttention(serviceDates, expectedSourceKeys), fromDate, days });
  }
  if (request.nextUrl.searchParams.has("changesSince")) {
    reportLogisticsReadPath("dashboard:warm-incremental-load");
    const rawCursor = request.nextUrl.searchParams.get("changesSince");
    const after = Number(rawCursor);
    if (!rawCursor || !Number.isSafeInteger(after) || after < 0) throw new HttpError(400, "Invalid Logistics change cursor.");
    if (requestedDate && !validOperationalDate(requestedDate)) throw new HttpError(400, "Invalid Logistics service date.");
    const startedAt = performance.now();
    let changes: Awaited<ReturnType<typeof listLogisticsChanges>>;
    let projection: LogisticsDayProjection | undefined;
    try {
      changes = await listLogisticsChanges(after, requestedDate);
      projection = requestedDate ? await getLogisticsProjection(requestedDate) : undefined;
    } catch (cause) {
      throw Object.assign(new HttpError(503, "Logistics changes could not be loaded."), { code: "LOGISTICS_CHANGE_READ_UNAVAILABLE", cause });
    }
    return NextResponse.json({ ...changes, projection, metrics: { incrementalUpdateMs: Math.round(performance.now() - startedAt) } });
  }
  if (requestedWeek) {
    const dates = operationalWeek(requestedWeek);
    // One bounded five-day range read keeps the week view from asking Hub for
    // the complete fulfilment projection and avoids a five-request fan-out.
    const requirementsResult = await fetchRequirementsForDateRange(dates[0], addOperationalDays(dates[4], 1), cookie).catch(() => []);
    const dayStates = await Promise.all(dates.map((serviceDate) => listState(serviceDate)));
    const summaries: PlannerWeekSummary[] = dates.map((serviceDate, index) => {
      const state = dayStates[index];
      const requirements = activeLogisticsRequirements(requirementsResult.filter((requirement) => requirement.serviceDate === serviceDate));
      const planner = buildPlannerDay({
        serviceDate,
        requirements,
        runs: state.runs,
        stops: state.stops,
        movements: state.movements,
        oplocs: [],
        health: {
          fulfilment: { available: true },
          oplocs: { available: true },
          enrichment: { available: true },
        },
      });
      return {
        serviceDate,
        loads: planner.summary.loads,
        ready: planner.workGroups.filter(
          (group) =>
            group.readiness === "READY" && group.planningState !== "planned",
        ).length,
        unplanned:
          planner.summary.unplanned +
          planner.movements.filter(
            (movement) => movement.planningState === "unplanned",
          ).length,
        runs: planner.runs.length,
        attention:
          planner.summary.attention +
          planner.runs.reduce((count, run) => count + run.openIssueCount, 0),
        completedStops: planner.runs.reduce(
          (count, run) => count + run.completedStops,
          0,
        ),
        stopCount: planner.runs.reduce(
          (count, run) => count + run.stopCount,
          0,
        ),
        deliveries: planner.summary.deliveries,
        collections: planner.summary.collections,
        transfers: planner.summary.transfers,
        projectionState: "CURRENT" as const,
      };
    });
    return NextResponse.json({ weekCommencing: dates[0], days: summaries });
  }
  const requestedRun = requestedRunId ? await getRun(requestedRunId) : undefined;
  const runDate = requestedRunId
    ? requestedRun?.serviceDate
    : undefined;
  const date = requestedDate || runDate || operationalDate();
  const [state, collectionRequiredKeys, requirementsResult, oplocsResult] = await Promise.all([
    listState(date),
    listCollectionPreferenceKeys(date),
    fetchRequirements(date, cookie).then((value) => ({ status: "fulfilled" as const, value })).catch((reason) => ({ status: "rejected" as const, reason })),
    fetchOplocs(cookie).then((value) => ({ status: "fulfilled" as const, value })).catch((reason) => ({ status: "rejected" as const, reason })),
  ]);
  const loadState = await listDeliveryLoadState(date);
  const permitted = vehicleScope(principal, vehicleContext);
  const scopedRuns = state.runs.filter(run => isLogisticsVehicleId(run.vehicleId) && permitted.includes(run.vehicleId));
  const scopedState = { ...state, runs: scopedRuns, stops: state.stops.filter(stop => scopedRuns.some(run => run.canonicalId === stop.runId)) };
  const scopedRunIds = new Set(scopedState.runs.map((run) => run.canonicalId));
  const visibleLoads = loadState.loads.filter(load => (!load.runId || scopedRunIds.has(load.runId)) && (!load.collectionRunId || scopedRunIds.has(load.collectionRunId)) && (load.vehicleId === undefined || isLogisticsVehicleId(load.vehicleId) && permitted.includes(load.vehicleId)) && (!load.vehicleId || !load.runId || scopedRuns.find(run => run.canonicalId === load.runId)?.vehicleId === load.vehicleId));
  const scopedLoadState = { ...loadState, loads: visibleLoads, assignments: loadState.assignments.filter(assignment => visibleLoads.some(load => load.id === assignment.loadId)) };
  // Keep the upstream reads independently tolerant: one unavailable source
  // should not prevent the local Logistics snapshot from rendering.
  const needsProductionEnrichment =
    requirementsResult.status !== "fulfilled" ||
    requirementsResult.value.some((requirement) => requirement.sourceDomain === "cpu-production");
  const productionResult = needsProductionEnrichment
    ? await fetchProductionContexts(date, cookie).then((value) => ({ status: "fulfilled" as const, value })).catch((reason) => ({ status: "rejected" as const, reason }))
    : { status: "fulfilled" as const, value: [] };
  const upstreamRequirements =
    requirementsResult.status === "fulfilled" ? requirementsResult.value : [];
  const oplocs = oplocsResult.status === "fulfilled" ? oplocsResult.value : [];
  const production =
    productionResult.status === "fulfilled" ? productionResult.value : [];
  const requirements = activeLogisticsRequirements(upstreamRequirements);
  const rawProjection = await getLogisticsProjection(date);
  const projection = rawProjection ? await scopeCanonicalProjection(rawProjection, principal, vehicleContext) : undefined;
  const health = {
    fulfilment:
      requirementsResult.status === "fulfilled"
        ? { available: true }
        : { available: false, error: messageOf(requirementsResult.reason) },
    oplocs:
      oplocsResult.status === "fulfilled"
        ? { available: true }
        : { available: false, error: messageOf(oplocsResult.reason) },
    enrichment:
      productionResult.status === "fulfilled"
        ? { available: true }
        : { available: false, error: messageOf(productionResult.reason) },
  } as const;
  return NextResponse.json({
    ...scopedState,
    ...scopedLoadState,
    ...(projection ? { projection } : {}),
    requirements,
    oplocs,
    serviceDate: date,
    fetchedAt: new Date().toISOString(),
    health,
    planner: buildPlannerDay({
      serviceDate: date,
      requirements,
      runs: scopedState.runs,
      stops: scopedState.stops,
      movements: state.movements,
      oplocs,
      health,
      production,
      collectionRequiredKeys,
    }),
  });
}

async function handlePost(request: NextRequest) {
  let diagnostic: { operation?: string; serviceDate?: string; projectionSequence?: number; entityId?: string } = {};
  try {
    const principal = await requireLogisticsAccess(request);
    const runTracedTransaction = <T,>(callback: (transaction: Transaction) => Promise<T>) => runAuthorizedTracedTransaction(callback, principal, request.headers.get("cookie") || undefined, ["set-run-driver", "update-run"].includes(body.action));
    if (hostedRuntime()) assertSameOrigin(request);
    const body = (await request.json()) as {
      action: string;
      by?: string;
      run?: DeliveryRun;
      movement?: MovementRequest;
      requirementId?: string;
      expectedSourceVersion?: number;
      runId?: string;
      expectedRunVersion?: number;
      expectedTargetRunVersion?: number;
      movementId?: string;
      stop?: DeliveryStop;
      stopIds?: string[];
      stopId?: string;
      targetRunId?: string;
      collectionRunId?: string;
      requirementIds?: string[];
      expectedSourceVersions?: Record<string, number>;
      expectedStopVersion?: number;
      loadIds?: string[];
      expectedLoadVersion?: number;
      expectedLoadVersions?: Record<string, number>;
      expectedJobVersion?: number;
      expectedJobVersions?: Record<string, number>;
      issueDescription?: string;
      issueCategory?: "Cannot access building" | "Customer unavailable" | "Missing / incorrect load" | "Running late" | "Vehicle issue" | "Other" | "Access" | "Delay" | "Missing item" | "Vehicle";
      issueId?: string;
      resolutionNotes?: string;
      groupKey?: string;
      collectionRequired?: boolean;
      vehicleSlot?: "van-1" | "van-2";
      vehicleId?: "van1" | "van2";
      driverId?: string;
      driverLabel?: string;
      serviceDate?: string;
      confirmDirect?: boolean;
      loaded?: boolean;
      returnToCpuRequired?: boolean;
      targetServiceDate?: string;
      plannedArrivalTime?: string;
      plannedWindow?: { startTime: string; endTime?: string };
      job?: import("@/lib/types").LogisticsJob;
      loadId?: string;
      jobId?: string;
      scheduledTime?: string;
      scheduledEnd?: string;
      resizeEndOnly?: boolean;
      lane?: "delivery" | "collection";
      collectionStatus?: "awaiting" | "collected";
    };
    if (body.resizeEndOnly && !["schedule-stop", "reschedule-delivery-load", "reschedule-delivery-loads"].includes(body.action)) throw new HttpError(422, "End-only resize is supported only for an existing scheduled stop or load.");
    diagnostic = {
      operation: body.action,
      serviceDate: body.serviceDate || body.run?.serviceDate || body.movement?.serviceDate || body.job?.serviceDate,
      projectionSequence: body.expectedRunVersion ?? body.expectedStopVersion ?? body.expectedSourceVersion,
      entityId: body.runId || body.stopId || body.movementId || body.jobId || body.loadId || body.run?.canonicalId || body.movement?.canonicalId,
    };
    if ((body.action === "reschedule-delivery-loads" || body.loadIds !== undefined) && (!Array.isArray(body.loadIds) || !body.loadIds.length || body.loadIds.length > 50 || body.loadIds.some(id => typeof id !== "string" || !id) || new Set(body.loadIds).size !== body.loadIds.length)) throw new HttpError(422, "Choose 1–50 unique canonical load IDs.");
    const requirementOwnerStops = new Map<string, Promise<DeliveryStop[]>>();
    await authorizeCommand(principal, body, {
      run: getRun,
      stop: async id => { const snapshot = await stops().doc(id).get(); return snapshot.exists ? normalizeStop(snapshot.data()!) : undefined; },
      load: getDeliveryLoad,
      requirementRuns: async (id, date) => {
        if (!requirementOwnerStops.has(date)) requirementOwnerStops.set(date, (async () => {
          const datedRuns = await runs().where("serviceDate", "==", date).get();
          const snapshots = await Promise.all(datedRuns.docs.map(doc => stops().where("runId", "==", doc.id).get()));
          return snapshots.flatMap(snapshot => snapshot.docs.map(doc => normalizeStop(doc.data())));
        })());
        return [...new Set((await requirementOwnerStops.get(date)!).filter(stop => stop.requirementRefs.some(ref => ref.requirementId === id)).map(stop => stop.runId))];
      },
      movementRuns: async id => {
        const snapshots = await Promise.all([stops().where("movementRequestIds", "array-contains", id).get(), stops().where("movementRequestId", "==", id).get()]);
        return [...new Set(snapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.data().runId as string)))];
      },
      jobLoads: async id => {
        const assignments = await logisticsAssignments().where("jobId", "==", id).get();
        const loads = await Promise.all(assignments.docs.map(doc => getDeliveryLoad(doc.data().loadId)));
        if (loads.some(load => !load)) throw new HttpError(409, "Canonical load ownership is unavailable.");
        return loads.filter((load): load is NonNullable<typeof load> => Boolean(load));
      },
    });
    const actorId = principal.id;
    const by = principal.displayName;
    const now = new Date().toISOString();
    if (body.action === "repair-run-vehicle-identity") {
      if (!body.runId || !isLogisticsVehicleId(body.vehicleId) || body.expectedRunVersion === undefined) throw new HttpError(422, "An explicitly reviewed run ID, stable vehicle ID and current version are required.");
      // Dedicated organisation repair authority was checked above. No label-to-ID
      // inference; this reviewed, CAS-protected mapping is never run on page load.
      const saved = await db.runTransaction(async transaction => {
        const ref = runs().doc(body.runId!);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new HttpError(404, "Logistics resource not found.");
        const current = snapshot.data() as DeliveryRun;
        if (current.version !== body.expectedRunVersion || current.vehicleId && current.vehicleId !== body.vehicleId) throw new HttpError(409, "Vehicle identity mapping needs review.");
        if (current.vehicleId === body.vehicleId) return current;
        const next = { ...current, vehicleId: body.vehicleId, vehicleLabel: logisticsVehicleLabel(body.vehicleId!), version: current.version + 1, updatedAt: now, audit: [...current.audit, { action: "reviewed-vehicle-identity-mapped", at: now, by, version: current.version + 1 }] };
        transaction.set(ref, next);
        return next;
      });
      await recordCanonicalLogisticsChange({ serviceDate: saved.serviceDate, entityType: "run", entityId: saved.canonicalId, changeType: "reviewed-vehicle-identity-mapped", revision: saved.version, actorId, by, changedAt: now });
      return NextResponse.json(saved);
    }
    // The mobile view can receive projection-backed stops from the same
    // logistics timeline as desktop. Resolve those display IDs to their
    // canonical delivery load instead of sending them through the legacy
    // run/stop execution branch.
    if (body.stopId?.startsWith("projection-stop:") && projectedActions.includes(body.action)) {
      if (body.action === "defer-collection") throw new HttpError(422, "Projected collection postponement is unavailable until A10 provides the governed cross-date workflow.");
      const owner = body.runId ? await getRun(body.runId) : undefined;
      if (!owner) throw new HttpError(422, "Canonical execution run is required.");
      const requirements = await fetchRequirements(owner.serviceDate, request.headers.get("cookie") || undefined);
      const result = await runTracedTransaction(tx => executeProjected(tx, principal, body, requirements, by, now));
      let sequence = 0;
      for (const job of result.changedJobs) { const event = await appendLogisticsChange({ serviceDate: job.serviceDate, entityType: "logisticsJob", entityId: job.id, changeType: body.action, revision: job.version, changedAt: now, actorId }); sequence = Math.max(sequence, event.sequence); }
      for (const load of result.changedLoads) { const event = await appendLogisticsChange({ serviceDate: load.serviceDate, entityType: "deliveryLoad", entityId: load.id, changeType: body.action, revision: load.version, changedAt: now, actorId }); sequence = Math.max(sequence, event.sequence); }
      for (const other of result.additionalRuns) { const event = await appendLogisticsChange({ serviceDate: other.serviceDate, entityType: "run", entityId: other.canonicalId, changeType: "issue-finalised", revision: other.version, changedAt: now, actorId }); sequence = Math.max(sequence, event.sequence); }
      if (result.run.version !== owner.version) { const event = await appendLogisticsChange({ serviceDate: owner.serviceDate, entityType: "run", entityId: result.run.canonicalId, changeType: "execution-finalised", revision: result.run.version, changedAt: now, actorId }); sequence = Math.max(sequence, event.sequence); }
      const projection = await materialiseRebuildLogisticsProjection(owner.serviceDate, by, sequence);
      const stop = projectionToDashboardData(projection).stops.find(stop => stop.canonicalId === body.stopId);
      return NextResponse.json({ run: result.run, stop, loads: result.loads, jobs: result.jobs, canonicalLoadVersions: Object.fromEntries(result.loads.map(load => [load.id, load.version])), canonicalJobVersions: Object.fromEntries(result.jobs.map(job => [job.id, job.version])) });
    }
    if (body.action === "repair-logistics-assignment-dates") {
      return NextResponse.json({ migration: await repairLegacyAssignmentServiceDates() });
    }
    if (body.action === "rebuild-logistics-projection" && body.serviceDate) {
      const startedAt = performance.now();
      const projection = await rebuildLogisticsProjection(body.serviceDate, by);
      return NextResponse.json({ projection, metrics: { projectionRebuildMs: Math.round(performance.now() - startedAt) } });
    }
    if (body.action === "reconcile-logistics-day" && body.serviceDate) {
      const result = await materialiseLogisticsDay(body.serviceDate, by, actorId, request.headers.get("cookie") || undefined);
      return NextResponse.json({ ...result, warning: result.requirements.some((item) => !item.productionLocationId) ? "Some jobs have no canonical origin OPLOC and remain safely unassigned." : undefined });
    }
    if (body.action === "save-logistics-job" && body.job) {
      if (!body.job.originOplocId || !body.job.destinationOplocId)
        throw new HttpError(422, "Logistics jobs require canonical origin and destination OPLOC IDs.");
      const saved = await saveLogisticsJob(body.job);
      const event = await appendLogisticsChange({ serviceDate: saved.serviceDate, entityType: "logisticsJob", entityId: saved.id, changeType: "job-created-or-updated", revision: saved.version, changedAt: now, actorId });
      await rebuildLogisticsProjection(saved.serviceDate, by, event.sequence);
      return NextResponse.json(saved);
    }
    if (body.action === "assign-job-to-load" && (body.job || body.jobId)) {
      if (body.lane === "collection") throw new HttpError(422, "Choose the delivery timeline first; collection is scheduled from the linked collection card.");
      const jobId = body.jobId || body.job!.id;
      const job = await getLogisticsJob(jobId);
      if (!job) throw new HttpError(404, "Logistics job not found.");
      const scheduledTime = body.scheduledTime || job.requestedWindow?.startTime;
      if (!scheduledTime) throw new HttpError(422, "A scheduled arrival is required.");
      validatePlannedSchedule(undefined, { startTime: scheduledTime, ...(body.scheduledEnd ? { endTime: body.scheduledEnd } : {}) });
      const result = await runTracedTransaction(async transaction => {
        await assertProjectionCurrent(job.serviceDate, transaction);
        return assignCanonicalJob(transaction, { jobId, targetRunId: body.targetRunId, scheduledTime, scheduledEnd: body.scheduledEnd, resolveSchedule: (loads, currentJob) => resolveCanonicalLoadSchedule(loads, currentJob, body.targetRunId, scheduledTime, body.scheduledEnd), collectionRequired: body.collectionRequired, expectedJobVersion: body.expectedJobVersion, expectedLoadVersions: body.expectedLoadVersions }, by, now);
      });
      if (result.changed) {
        const event = await appendLogisticsChange({ serviceDate: job.serviceDate, entityType: "assignment", entityId: job.id, relatedEntityId: result.load.id, changeType: "job-assigned", revision: result.load.version, changedAt: now, actorId });
        const plannedEvent = result.plannedRun ? await appendLogisticsChange({ serviceDate: job.serviceDate, entityType: "run", entityId: result.plannedRun.canonicalId, changeType: "canonical-work-planned", revision: result.plannedRun.version, changedAt: now, actorId }) : undefined;
        await rebuildLogisticsProjection(job.serviceDate, by, plannedEvent?.sequence || event.sequence);
      }
      return NextResponse.json(result.load);
    }
    if (["clear-delivery-load-schedule", "clear-collection-load-schedule"].includes(body.action)) {
      const loadIds = body.loadIds || (body.loadId ? [body.loadId] : []);
      if (!loadIds.length || loadIds.length > 50 || loadIds.some(id => typeof id !== "string" || !id) || new Set(loadIds).size !== loadIds.length)
        throw new HttpError(422, "Choose 1–50 unique canonical load IDs to clear timing.");
      const expectedVersions = Object.fromEntries(loadIds.map(id => [id, body.expectedLoadVersions?.[id] ?? (loadIds.length === 1 ? body.expectedLoadVersion : undefined)]));
      if (loadIds.some(id => typeof expectedVersions[id] !== "number" || !Number.isFinite(expectedVersions[id]) || expectedVersions[id] < 0))
        throw new HttpError(422, "A current expected version is required for every canonical load.");
      const lane = body.action === "clear-collection-load-schedule" ? "collection" as const : "delivery" as const;
      const result = await runTracedTransaction(async transaction => {
        const refs = loadIds.map(id => deliveryLoads().doc(id));
        const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
        if (snapshots.some(snapshot => !snapshot.exists)) throw new HttpError(404, "Delivery load not found.");
        const loads = snapshots.map(snapshot => snapshot.data() as import("@/lib/types").DeliveryLoad);
        const first = loads[0];
        if (loads.some(load => load.serviceDate !== first.serviceDate)) throw new HttpError(409, "All projected loads must belong to the same service date.");
        const placementKey = (load: import("@/lib/types").DeliveryLoad) => JSON.stringify([load.serviceDate, load.originOplocId, load.destinationOplocId, load.runId, load.vehicleId, load.scheduledTime, load.scheduledEnd, Boolean(load.collectionRequired), load.collectionRunId, load.collectionScheduledTime, load.collectionScheduledEnd, load.status]);
        if (loads.some(load => placementKey(load) !== placementKey(first))) throw new HttpError(409, "Projected loads no longer form one compatible placement. Refresh planning.");
        const projection = await assertProjectionCurrent(first.serviceDate, transaction);
        const projectedGroup = projection.deliveryLoads.find(load => (load.loadIds || [load.id]).some(id => loadIds.includes(id)));
        const projectedIds = projectedGroup?.loadIds || (projectedGroup ? [projectedGroup.id] : []);
        if (!projectedGroup || projectedIds.length !== loadIds.length || projectedIds.some(id => !loadIds.includes(id)))
          throw new HttpError(409, "The requested loads no longer match the complete projected placement. Refresh planning.");
        const owners = new Set<string>();
        for (const load of loads) {
          assertLoadVersion(load, expectedVersions[load.id]);
          await assertLoadAssignmentsCurrent(transaction, load);
          await authorizeLoad(principal, load, async id => (await transaction.get(runs().doc(id))).data() as DeliveryRun | undefined);
          const ownerId = lane === "collection" ? load.collectionRunId || (load.collectionRequired ? load.runId : undefined) : load.runId;
          if (!ownerId) throw new HttpError(409, "The canonical load lane is no longer assigned.");
          owners.add(ownerId);
          const ownerSnap = await transaction.get(runs().doc(ownerId));
          if (!ownerSnap.exists) throw new HttpError(409, "Canonical current load owner is unavailable.");
          const owner = ownerSnap.data() as DeliveryRun;
          if (owner.serviceDate !== load.serviceDate) throw new HttpError(409, "Canonical load owner belongs to a different service date.");
          assertPlanningOpen(owner);
          const hasTiming = lane === "collection" ? Boolean(load.collectionScheduledTime || load.collectionScheduledEnd) : Boolean(load.scheduledTime || load.scheduledEnd);
          if (!hasTiming) throw new HttpError(409, "A canonical load lane no longer has a schedule to clear.");
        }
        if (owners.size !== 1) throw new HttpError(409, "Projected loads no longer share one lane owner. Refresh planning.");
        const clearedLoads = loads.map(load => {
          const cleared = replaceLoadTiming(load, lane, {});
          return { ...cleared, updatedAt: now, version: load.version + 1, audit: [...load.audit, { action: body.action, at: now, by, version: load.version + 1 }] };
        });
        for (const load of clearedLoads) transaction.set(deliveryLoads().doc(load.id), load);
        return clearedLoads;
      });
      let sequence = 0;
      for (const load of result) {
        const event = await appendLogisticsChange({ serviceDate: load.serviceDate, entityType: "deliveryLoad", entityId: load.id, changeType: body.action, revision: load.version, changedAt: now, actorId });
        sequence = Math.max(sequence, event.sequence);
      }
      await rebuildLogisticsProjection(result[0].serviceDate, by, sequence);
      return NextResponse.json(result.length === 1 ? result[0] : { ...result[0], loads: result });
    }
    if (["reschedule-delivery-load", "reschedule-delivery-loads"].includes(body.action) && body.scheduledTime) {
      const loadIds = body.action === "reschedule-delivery-loads" ? body.loadIds! : body.loadId ? [body.loadId] : [];
      if (!loadIds.length) throw new HttpError(422, "Canonical load IDs are required.");
      validatePlannedSchedule(undefined, { startTime: body.scheduledTime, ...(body.scheduledEnd ? { endTime: body.scheduledEnd } : {}) });
      const requestedTime = body.scheduledTime;
      const collection = body.lane === "collection";
      if (body.lane && !["delivery", "collection"].includes(body.lane)) throw new HttpError(422, "Choose delivery or collection.");
      if (body.targetRunId && body.collectionRunId && collection && body.targetRunId !== body.collectionRunId) throw new HttpError(422, "Choose one canonical collection run.");
      const requestedRunId = collection ? body.collectionRunId || body.targetRunId : body.targetRunId;
      const result = await runTracedTransaction(async transaction => {
        const snapshots = await Promise.all(loadIds.map(id => transaction.get(deliveryLoads().doc(id))));
        if (snapshots.some(snapshot => !snapshot.exists)) throw new HttpError(404, "Delivery load not found.");
        const loads = snapshots.map(snapshot => snapshot.data() as import("@/lib/types").DeliveryLoad);
        const placementKey = (load: import("@/lib/types").DeliveryLoad) => JSON.stringify([load.serviceDate, load.originOplocId, load.destinationOplocId, load.runId, load.vehicleId, load.scheduledTime, load.scheduledEnd, Boolean(load.collectionRequired), load.collectionRunId, load.collectionScheduledTime, load.collectionScheduledEnd, load.status]);
        for (const load of loads) {
          assertLoadVersion(load, body.expectedLoadVersions?.[load.id] ?? (loadIds.length === 1 ? body.expectedLoadVersion : undefined));
          await assertLoadAssignmentsCurrent(transaction, load);
          // Current owner checks must also join this transaction before any writes.
          await authorizeLoad(principal, load, async id => (await transaction.get(runs().doc(id))).data() as DeliveryRun | undefined);
          const currentOwners = [...new Set((collection
            ? [load.collectionRunId || (load.collectionRequired ? load.runId : undefined)]
            : [load.runId]
          ).filter((id): id is string => Boolean(id)))];
          for (const ownerId of currentOwners) {
            const ownerSnap = await transaction.get(runs().doc(ownerId));
            if (!ownerSnap.exists) throw new HttpError(409, "Canonical current load owner is unavailable.");
            assertPlanningOpen(ownerSnap.data() as DeliveryRun);
          }
        }
        if (loads.some(load => placementKey(load) !== placementKey(loads[0]))) throw new HttpError(409, "Grouped placement changed. Refresh planning.");
        const first = loads[0];
        await assertProjectionCurrent(first.serviceDate, transaction);
        const currentLoads = (await transaction.get(deliveryLoads().where("serviceDate", "==", first.serviceDate))).docs.map(doc => doc.data() as import("@/lib/types").DeliveryLoad).filter(load => !loadIds.includes(load.id));
        const runId = requestedRunId || (collection ? first.collectionRunId || first.runId : first.runId);
        let vehicleId = first.vehicleId;
        if (runId) {
          const target = (await transaction.get(runs().doc(runId))).data() as DeliveryRun | undefined;
          if (!target || target.serviceDate !== first.serviceDate || !target.vehicleId) throw new HttpError(409, "Canonical target run is unavailable.");
          authorizeRun(principal, target);
          assertPlanningOpen(target);
          if (!collection) vehicleId = target.vehicleId;
        }
        if (body.resizeEndOnly) {
          if (!body.scheduledEnd || loadIds.length > 50) throw new HttpError(422, "End-only resize requires an explicit scheduled window.");
          const canonicalStart = collection ? first.collectionScheduledTime : first.scheduledTime;
          if (canonicalStart !== requestedTime) throw new HttpError(409, "The window start changed. Refresh before resizing its end.");
        }
        const requestedDuration = body.scheduledEnd ? Math.max(15, Number(body.scheduledEnd.slice(0, 2)) * 60 + Number(body.scheduledEnd.slice(3, 5)) - (Number(requestedTime.slice(0, 2)) * 60 + Number(requestedTime.slice(3, 5)))) : undefined;
        const effectiveScheduledTime = nextAvailableLoadTime(currentLoads, { runId, lane: collection ? "collection" : "delivery", destinationOplocId: collection ? first.originOplocId : first.destinationOplocId, start: requestedTime, end: body.scheduledEnd });
        if (body.resizeEndOnly && effectiveScheduledTime !== requestedTime) throw new HttpError(409, "The resized window conflicts with current work; its start must remain fixed.");
        const effectiveScheduledEnd = requestedDuration === undefined ? undefined : addSchedulableMinutes(effectiveScheduledTime, requestedDuration);
        if (requestedDuration !== undefined && !effectiveScheduledEnd) throw new HttpError(409, "The requested window does not fit within the operational day.");
        const nextLoads = loads.map(load => {
          const timing = replaceLoadTiming(load, collection ? "collection" : "delivery", { start: effectiveScheduledTime, ...(effectiveScheduledEnd ? { end: effectiveScheduledEnd } : {}) });
          return { ...timing, ...(collection ? { collectionRequired: true, collectionRunId: runId } : { runId, vehicleId }), updatedAt: now, version: load.version + 1, audit: [...load.audit, { action: collection ? "collection-rescheduled" : "load-rescheduled", at: now, by, version: load.version + 1 }] };
        });
        for (const next of nextLoads) await assertLoadAssignmentsCurrent(transaction, next);
        for (const next of nextLoads) transaction.set(deliveryLoads().doc(next.id), next);
        return nextLoads;
      });
      let sequence = 0;
      for (const load of result) {
        const event = await appendLogisticsChange({ serviceDate: load.serviceDate, entityType: "deliveryLoad", entityId: load.id, changeType: collection ? "collection-rescheduled" : "load-rescheduled", revision: load.version, changedAt: now, actorId });
        sequence = Math.max(sequence, event.sequence);
      }
      await rebuildLogisticsProjection(result[0].serviceDate, by, sequence);
      return NextResponse.json(body.action === "reschedule-delivery-loads" ? { ...result[0], loads: result } : result[0]);
    }
    if (body.action === "mark-delivery-load-loaded" && body.loadId) {
      const current = await getDeliveryLoad(body.loadId);
      if (!current?.runId) throw new HttpError(409, "Canonical load/run authority is unavailable.");
      const source = await fetchRequirements(current.serviceDate, request.headers.get("cookie") || undefined);
      const result = await runTracedTransaction(tx => executeProjected(tx, principal, { ...body, action: "mark-stop-loaded", runId: current.runId, stopId: `projection-stop:delivery:${current.id}`, loadIds: body.loadIds || [current.id] }, source, by, now));
      for (const job of result.changedJobs) await appendLogisticsChange({ serviceDate: job.serviceDate, entityType: "logisticsJob", entityId: job.id, changeType: "delivery-loaded", revision: job.version, changedAt: now, actorId });
      const event = await appendLogisticsChange({ serviceDate: current.serviceDate, entityType: "deliveryLoad", entityId: current.id, changeType: "load-loaded", revision: result.loads[0].version, changedAt: now, actorId });
      await rebuildLogisticsProjection(current.serviceDate, by, event.sequence);
      return NextResponse.json(result.loads[0]);
    }
    if (body.action === "remove-job-from-load" && body.jobId) {
      const result = await runTracedTransaction(async (transaction) => {
        const assignmentSnap = await transaction.get(logisticsAssignments().where("jobId", "==", body.jobId));
        if (!assignmentSnap.docs.length) throw new HttpError(404, "Job is not assigned to a delivery load.");
        const assignment = assignmentSnap.docs[0].data() as import("@/lib/types").LogisticsAssignment;
        if (!assignment.serviceDate) throw new HttpError(409, "This legacy assignment must be repaired before it can be changed.");
        await assertProjectionCurrent(assignment.serviceDate, transaction);
        const loadRef = deliveryLoads().doc(assignment.loadId);
        const [loadSnap, loadAssignments] = await Promise.all([transaction.get(loadRef), transaction.get(logisticsAssignments().where("loadId", "==", assignment.loadId))]);
        if (assignmentSnap.size !== 1 || !loadSnap.exists) throw new HttpError(409, "Canonical assignment integrity requires review.");
        const load = loadSnap.data() as import("@/lib/types").DeliveryLoad;
        assertLoadVersion(load, body.expectedLoadVersion ?? body.expectedLoadVersions?.[load.id]);
        if (!load.runId) throw new HttpError(409, "Canonical delivery owner is unavailable.");
        const ownerIds = [...new Set([load.runId, load.collectionRequired && load.collectionScheduledTime ? load.collectionRunId || load.runId : undefined].filter((id): id is string => Boolean(id)))];
        for (const ownerId of ownerIds) {
          const ownerSnap = await transaction.get(runs().doc(ownerId));
          if (!ownerSnap.exists) throw new HttpError(409, "Canonical load owner is unavailable.");
          assertPlanningOpen(ownerSnap.data() as DeliveryRun);
        }
        const jobRef = logisticsJobs().doc(assignment.jobId);
        const jobSnap = await transaction.get(jobRef);
        if (!jobSnap.exists) throw new HttpError(409, "Canonical job is unavailable.");
        const job = jobSnap.data() as import("@/lib/types").LogisticsJob;
        if (!Number.isInteger(body.expectedJobVersion)) throw new HttpError(422, "The current job version is required to remove its assignment.");
        if (job.version !== body.expectedJobVersion || body.loadId && body.loadId !== assignment.loadId) throw new HttpError(409, "Job assignment changed. Refresh planning before removal.");
        const remainingJobs = (await assertLoadAssignmentsCurrent(transaction, load)).jobs.filter(job => job.id !== assignment.jobId);
        transaction.delete(assignmentSnap.docs[0].ref);
        transaction.set(jobRef, { ...job, activeLoadId: undefined, version: job.version + 1, updatedAt: now, audit: [...job.audit, { action: `job-removed:${assignment.loadId}`, at: now, by, version: job.version + 1 }] });
        transaction.set(loadRef, aggregateDelivery({ ...load, ...(loadAssignments.size <= 1 ? { status: "cancelled" } : {}), updatedAt: now, version: load.version + 1, audit: [...load.audit, { action: "job-removed", at: now, by, version: load.version + 1 }] }, remainingJobs));
        return removeAssignment([assignment], body.jobId!, by, now).removed;
      });
      if (result) {
        const event = await appendLogisticsChange({ serviceDate: result.serviceDate, entityType: "assignment", entityId: result.jobId, relatedEntityId: result.loadId, changeType: "job-removed", revision: 1, changedAt: now, actorId });
        const job = await getLogisticsJob(result.jobId);
        await rebuildLogisticsProjection(job?.serviceDate || operationalDate(), by, event.sequence);
      }
      return NextResponse.json(result);
    }
    if (body.action === "set-job-collection") throw new HttpError(422, "Use the governed collection execution command with current stop, job and load authority.");
    if (body.action === "dispatch-delivery-load" && body.loadId) {
      const result = await runTracedTransaction(async tx => {
        const load = (await tx.get(deliveryLoads().doc(body.loadId!))).data() as import("@/lib/types").DeliveryLoad | undefined;
        if (!load) throw new HttpError(404, "Load not found.");
        assertLoadVersion(load, body.expectedLoadVersion ?? body.expectedLoadVersions?.[load.id]);
        await assertLoadAssignmentsCurrent(tx, load);
        const owner = load.runId ? (await tx.get(runs().doc(load.runId))).data() as DeliveryRun | undefined : undefined;
        if (owner?.status !== "dispatched" || load.status !== "dispatched") throw new HttpError(422, "Dispatch the owning run so all departure safeguards and delivery loads change together.");
        return load;
      });
      return NextResponse.json(result);
    }
    if (body.action === "set-collection-required" && body.groupKey && typeof body.collectionRequired === "boolean") {
      if (!body.serviceDate || !validOperationalDate(body.serviceDate)) throw new HttpError(422, "A valid service date is required for collection planning.");
      const preference = await saveCollectionPreference(body.groupKey, body.serviceDate, body.collectionRequired, by, now);
      if (body.serviceDate) await recordCanonicalLogisticsChange({ serviceDate: body.serviceDate, entityType: "movement", entityId: body.groupKey, changeType: "collection-preference-changed", revision: 1, actorId, by, changedAt: now });
      return NextResponse.json(preference);
    }
    if (body.action === "ensure-vehicle-day-runs") {
      const serviceDate = body.serviceDate || operationalDate();
      if (!validOperationalDate(serviceDate)) throw new HttpError(422, "A valid service date is required.");
      const existing = (await listState(serviceDate)).runs;
      if (existing.some(run => !isLogisticsVehicleId(run.vehicleId))) throw Object.assign(new HttpError(409, "Existing runs require reviewed vehicle identity mapping."), { code: "LOGISTICS_VEHICLE_IDENTITY_REQUIRED" });
      const slots = ([{ slot: "van-1", vehicleId: "van1" }, { slot: "van-2", vehicleId: "van2" }] as const).filter(item => vehicleScope(principal).includes(item.vehicleId));
      const result: DeliveryRun[] = [];
      const missing: Array<{ slot: "van-1" | "van-2"; vehicleLabel: string; vehicleId: "van1" | "van2" }> = [];
      for (const item of slots) {
        const vehicleLabel = item.slot === "van-1" ? "Van 1" : "Van 2";
        const current = existing.find((run) => run.vehicleId === item.vehicleId);
        if (current) {
          result.push(current);
          continue;
        }
        missing.push({ slot: item.slot, vehicleLabel, vehicleId: item.vehicleId });
      }
      const created = missing.length ? await runTracedTransaction(async (transaction) => {
        const refs = missing.map((item) => runs().doc(`run:${serviceDate}:${item.slot}`));
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        return missing.map((item, index) => {
          if (snapshots[index].exists) {
            const current = snapshots[index].data() as DeliveryRun;
            authorizeRun(principal, current);
            if (current.vehicleId !== item.vehicleId) throw new HttpError(409, "Existing run vehicle identity needs review.");
            return current;
          }
          const run: DeliveryRun = {
            canonicalId: refs[index].id, serviceDate, status: "draft", vehicleLabel: item.vehicleLabel, vehicleId: item.vehicleId,
            returnToCpuRequired: true, orderedStopIds: [], version: 1, createdAt: now, updatedAt: now,
            audit: [{ action: "vehicle-day-run-created", at: now, by, version: 1 }],
          };
          transaction.create(refs[index], run);
          return run;
        });
      }) : [];
      result.push(...created);
      const changed = created.some((run) => run.createdAt === now);
      if (changed) await recordCanonicalLogisticsChange({ serviceDate, entityType: "run", entityId: `vehicle-day:${serviceDate}`, changeType: "vehicle-day-runs-ensured", revision: Math.max(...result.map((run) => run.version)), actorId, by, changedAt: now });
      return NextResponse.json({ runs: result, changed });
    }
    if (body.action === "set-run-driver" && body.runId && body.driverId) {
      const current = await getRun(body.runId);
      if (!current) throw new HttpError(404, "Run not found.");
      if (body.expectedRunVersion === undefined) throw new HttpError(422, "A current run version is required.");
      const result = await runTracedTransaction(async (transaction) => {
        const ref = runs().doc(current.canonicalId);
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new HttpError(404, "Run not found.");
        const run = snap.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion) throw new HttpError(409, "This run changed elsewhere. Refresh before changing its driver.");
        const driverId = body.driverId!.trim();
        const driverLabel = body.driverLabel?.trim() || ""; // Replaced by Hub authority before commit.
        if (!driverId) throw new HttpError(422, "A governed driver ID is required.");
        const next = { ...run, driverId, driverLabel, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "driver-assigned", at: now, by, version: run.version + 1 }] };
        transaction.set(ref, next);
        return next;
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: "run", entityId: result.canonicalId, changeType: "driver-assigned", revision: result.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    if (body.action === "set-run-return-required" && body.runId && typeof body.returnToCpuRequired === "boolean") {
      const current = await getRun(body.runId);
      if (!current) throw new HttpError(404, "Run not found.");
      if (body.expectedRunVersion === undefined) throw new HttpError(422, "A current run version is required.");
      if (current.status === "dispatched" || current.status === "completed") throw new HttpError(422, "Return settings cannot change after dispatch.");
      const result = await runTracedTransaction(async (transaction) => {
        const ref = runs().doc(current.canonicalId);
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new HttpError(404, "Run not found.");
        const run = snap.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion) throw new HttpError(409, "This run changed elsewhere. Refresh before changing its return setting.");
        const next = { ...run, returnToCpuRequired: body.returnToCpuRequired, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "run-return-setting-changed", at: now, by, version: run.version + 1 }] };
        transaction.set(ref, next);
        return next;
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: "run", entityId: result.canonicalId, changeType: "run-return-setting-changed", revision: result.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    if (body.action === "reset-planning-day" && body.serviceDate) {
      const state = await listState(body.serviceDate);
      const batch = db.batch();
      state.runs.forEach((run) => batch.delete(runs().doc(run.canonicalId)));
      state.stops.forEach((stop) => batch.delete(stops().doc(stop.canonicalId)));
      state.movements.forEach((movement) => batch.update(movements().doc(movement.canonicalId), {
        status: "open",
        version: movement.version + 1,
        updatedAt: now,
        audit: [...movement.audit, { action: "planning-day-reset", at: now, by, version: movement.version + 1 }],
      }));
      await batch.commit();
      await recordCanonicalLogisticsChange({ serviceDate: body.serviceDate, entityType: "run", entityId: `planning-day:${body.serviceDate}`, changeType: "planning-day-reset", revision: 1, actorId, by, changedAt: now });
      return NextResponse.json({ serviceDate: body.serviceDate, resetRuns: state.runs.length, resetStops: state.stops.length, resetMovements: state.movements.length });
    }
    if (body.action === "create-run") {
      const requested: DeliveryRun = body.run || {
        canonicalId: `run:${operationalDate()}:${Date.now()}`,
        serviceDate: operationalDate(),
        status: "draft",
        orderedStopIds: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
        returnToCpuRequired: true,
        audit: [],
      };
      if (!requested.canonicalId || !validOperationalDate(requested.serviceDate)) throw new HttpError(422, "A stable run ID and valid service date are required.");
      const saved = await runTracedTransaction(async (transaction) => {
        const ref = runs().doc(requested.canonicalId);
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) throw new HttpError(409, "This run already exists. Refresh before creating another run.");
        const run: DeliveryRun = {
          canonicalId: requested.canonicalId,
          serviceDate: requested.serviceDate,
          status: "draft",
          driverId: requested.driverId,
          driverLabel: requested.driverLabel,
          vehicleId: requested.vehicleId,
          vehicleLabel: logisticsVehicleLabel(requested.vehicleId!),
          returnToCpuRequired: requested.returnToCpuRequired !== false,
          orderedStopIds: [],
          version: 1,
          createdAt: now,
          updatedAt: now,
          audit: [{ action: "run-created", at: now, by, version: 1 }],
        };
        transaction.create(ref, run);
        return run;
      });
      await recordCanonicalLogisticsChange({ serviceDate: saved.serviceDate, entityType: "run", entityId: saved.canonicalId, changeType: "run-created", revision: saved.version, actorId, by, changedAt: now });
      return NextResponse.json(saved);
    }
    if (
      [
        "mark-run-ready",
        "return-run-to-planning",
        "dispatch-run",
        "complete-run",
        "confirm-returned-to-cpu",
      ].includes(body.action) &&
      body.runId
    ) {
      const current = await getRun(body.runId);
      if (!current) throw new HttpError(404, "Run not found.");
      if (body.expectedRunVersion === undefined)
        throw new HttpError(
          422,
          "A current run version is required for lifecycle changes.",
        );
      const requirements = ["mark-run-ready", "dispatch-run"].includes(body.action) ? await fetchRequirements(current.serviceDate, request.headers.get("cookie") || undefined) : [];
      const result = await runTracedTransaction(async transaction => {
        const ref = runs().doc(current.canonicalId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new HttpError(404, "Run not found.");
        const run = snapshot.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion) throw new HttpError(409, "Run changed. Refresh lifecycle authority.");
        const work = await readRunWork(transaction, run);
        for (const leg of work.legs) await authorizeLoad(principal, leg.load, async id => (await transaction.get(runs().doc(id))).data() as DeliveryRun | undefined);
        let status: DeliveryRun["status"];
        if (["mark-run-ready", "dispatch-run"].includes(body.action)) {
          if (!["planned", "ready"].includes(run.status)) throw new HttpError(422, "Run must be planned or ready for departure.");
          // The authenticated operator executes the canonical vehicle/run.
          // A historical driver assignment is not a login or execution grant.
          authorizeRun(principal, run);
          await assertRunReady(transaction, run, work, requirements, body.action === "dispatch-run");
          status = body.action === "dispatch-run" ? "dispatched" : "ready";
        } else if (body.action === "return-run-to-planning") {
          assertTransition(run.status, "planned"); status = "planned";
        } else {
          if (workOutstanding(work) || workIssuesOpen(work)) throw new HttpError(422, "All owned native/projected work and issues must be complete first.");
          if (body.action === "confirm-returned-to-cpu") {
            if (run.status !== "dispatched" || run.returnToCpuRequired === false || !run.returnToCpuPending) throw new HttpError(422, "This run is not ready to confirm returned to CPU.");
          } else if (run.returnToCpuRequired !== false && !run.returnedToCpuAt) throw new HttpError(422, "Confirm the return to CPU first.");
          assertTransition(run.status, "completed"); status = "completed";
        }
        const next = { ...run, status, ...(body.action === "confirm-returned-to-cpu" ? { returnToCpuPending: false, returnedToCpuAt: now, returnedToCpuBy: by } : {}), version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: body.action, at: now, by, version: run.version + 1 }] };
        const changedLoads: import("@/lib/types").DeliveryLoad[] = [];
        if (body.action === "dispatch-run") for (const { load, lane } of work.legs) if (lane === "delivery") { const dispatched = { ...load, status: "dispatched" as const, dispatchedAt: now, version: load.version + 1, updatedAt: now, audit: [...load.audit, { action: "run-dispatched", at: now, by, version: load.version + 1 }] }; transaction.set(deliveryLoads().doc(load.id), dispatched); changedLoads.push(dispatched); }
        transaction.set(ref, next);
        return { run: next, changedLoads };
      });
      for (const load of result.changedLoads) await appendLogisticsChange({ serviceDate: load.serviceDate, entityType: "deliveryLoad", entityId: load.id, changeType: "run-dispatched", revision: load.version, changedAt: now, actorId });
      await recordCanonicalLogisticsChange({ serviceDate: result.run.serviceDate, entityType: "run", entityId: result.run.canonicalId, changeType: body.action, revision: result.run.version, actorId, by, changedAt: now });
      return NextResponse.json(result.run);
    }
    if (body.action === "save-movement" && body.movement) {
      const requested = body.movement;
      if (!requested.canonicalId || !validOperationalDate(requested.serviceDate) || !requested.items?.length || requested.items.some((item) => !item.description?.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0))
        throw new HttpError(422, "A stable movement ID, valid service date, and positive item quantities are required.");
      if ((requested.type !== "collection" && !requested.toOplocId && !requested.toAddress?.trim()) || (requested.type !== "delivery" && !requested.fromOplocId && !requested.fromAddress?.trim()))
        throw new HttpError(422, "Each required movement endpoint needs a governed OPLOC or one-off address.");
      const oplocs = await fetchOplocs(
        request.headers.get("cookie") || undefined,
      );
      for (const id of [
        requested.fromOplocId,
        requested.toOplocId,
      ].filter(Boolean) as string[])
        labelFor(oplocs, id);
      const saved = await runTracedTransaction(async (transaction) => {
        const ref = movements().doc(requested.canonicalId);
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) throw new HttpError(409, "This movement already exists. Refresh before creating another movement.");
        const movement: MovementRequest = {
          canonicalId: requested.canonicalId, entityType: "Movement Request", type: requested.type, serviceDate: requested.serviceDate,
          ...(requested.fromOplocId ? { fromOplocId: requested.fromOplocId, fromLabelSnapshot: labelFor(oplocs, requested.fromOplocId) } : {}),
          ...(requested.fromAddress?.trim() ? { fromAddress: requested.fromAddress.trim() } : {}),
          ...(requested.toOplocId ? { toOplocId: requested.toOplocId, toLabelSnapshot: labelFor(oplocs, requested.toOplocId) } : {}),
          ...(requested.toAddress?.trim() ? { toAddress: requested.toAddress.trim() } : {}),
          ...(requested.requiredTime ? { requiredTime: requested.requiredTime } : {}),
          ...(requested.window ? { window: requested.window } : {}),
          items: requested.items.map((item) => ({ ...item, description: item.description.trim() })),
          ...(requested.notes?.trim() ? { notes: requested.notes.trim() } : {}),
          createdBy: actorId, status: "open", version: 1, createdAt: now, updatedAt: now,
          audit: [{ action: "movement-created", at: now, by, version: 1 }],
        };
        transaction.create(ref, movement);
        return movement;
      });
      await recordCanonicalLogisticsChange({ serviceDate: saved.serviceDate, entityType: "movement", entityId: saved.canonicalId, changeType: "movement-created", revision: saved.version, actorId, by, changedAt: now });
      return NextResponse.json(saved);
    }
    if (body.action === "update-run" && body.run) {
      if (body.expectedRunVersion === undefined) throw new HttpError(422, "A current run version is required.");
      const requestedRun = body.run;
      const saved = await runTracedTransaction(async (transaction) => {
        const ref = runs().doc(requestedRun.canonicalId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new HttpError(404, "Run not found.");
        const current = snapshot.data() as DeliveryRun;
        if (current.version !== body.expectedRunVersion) throw new HttpError(409, "This run changed elsewhere. Refresh before updating it.");
        const next: DeliveryRun = {
          ...current,
          driverId: requestedRun.driverId,
          driverLabel: requestedRun.driverLabel,
          vehicleId: requestedRun.vehicleId || current.vehicleId,
          vehicleLabel: logisticsVehicleLabel(requestedRun.vehicleId || current.vehicleId!),
          version: current.version + 1,
          updatedAt: now,
          audit: [
            ...current.audit,
            {
              action: "run-updated",
              at: now,
              by,
              version: current.version + 1,
            },
          ],
        };
        transaction.set(ref, next);
        return next;
      });
      await recordCanonicalLogisticsChange({ serviceDate: saved.serviceDate, entityType: "run", entityId: saved.canonicalId, changeType: "run-updated", revision: saved.version, actorId, by, changedAt: now });
      return NextResponse.json(saved);
    }
    // Native fulfilment and projection queue intents converge into the same
    // Logistics job/load/assignment authority. Movement Requests retain their
    // separate established stop path.
    if (body.runId && (body.action === "assign-group" || body.action === "assign" && body.requirementId && !body.movementId)) {
      const target = await getRun(body.runId);
      if (!target) throw new HttpError(404, "Run not found.");
      assertPlanningOpen(target);
      const ids = [...new Set(body.requirementIds || (body.requirementId ? [body.requirementId] : []))];
      if (!ids.length || body.expectedRunVersion === undefined) throw new HttpError(422, "Current requirement and run versions are required.");
      const source = await fetchRequirements(target.serviceDate, request.headers.get("cookie") || undefined);
      const requirements = ids.map(id => source.find(item => item.canonicalId === id));
      if (requirements.some(item => !item)) throw new HttpError(404, "Fulfilment requirement no longer exists upstream.");
      for (const requirement of requirements as FulfilmentRequirement[]) {
        const expected = body.expectedSourceVersions?.[requirement.canonicalId] ?? body.expectedSourceVersion;
        if (expected !== requirement.sourceVersion) throw new HttpError(409, "Fulfilment source changed. Refresh planning.");
        if (requirement.status === "withdrawn" || requirement.destinationOplocId === CPU_SITE_OPLOC_ID || requirement.serviceDate !== target.serviceDate) throw new HttpError(422, "Requirement is not active delivery work for this run.");
      }
      const result = await runTracedTransaction(async transaction => {
        const run = (await transaction.get(runs().doc(target.canonicalId))).data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion) throw new HttpError(409, "Run changed. Refresh planning.");
        assertPlanningOpen(run);
        const nativeStops = await transaction.get(stops().where("runId", "==", run.canonicalId));
        if (nativeStops.docs.some(doc => (doc.data().requirementRefs || []).some((ref: { requirementId: string }) => ids.includes(ref.requirementId)))) throw new HttpError(409, "Return existing native work to planning before reassigning it.");
        const datedJobs = await transaction.get(logisticsJobs().where("serviceDate", "==", run.serviceDate));
        const batch = { loads: new Map<string, import("@/lib/types").DeliveryLoad>() };
        const loads = [];
        for (const requirement of requirements as FulfilmentRequirement[]) {
          const prior = datedJobs.docs.map(doc => doc.data() as import("@/lib/types").LogisticsJob).find(job => job.requirementId === requirement.canonicalId || job.id === `logistics-job:${requirement.canonicalId}`);
          const job = logisticsJobForRequirement(requirement, prior, by, now);
          const scheduledTime = body.plannedWindow?.startTime || body.plannedArrivalTime || body.scheduledTime || job.requestedWindow?.startTime;
          if (!scheduledTime) throw new HttpError(422, "Choose a Logistics scheduled arrival.");
          validatePlannedSchedule(undefined, { startTime: scheduledTime, ...(body.plannedWindow?.endTime || body.scheduledEnd ? { endTime: body.plannedWindow?.endTime || body.scheduledEnd } : {}) });
          const assigned = await assignCanonicalJob(transaction, { jobId: job.id, sourceJob: job, expectedJobVersion: body.expectedJobVersions?.[job.id], resolveSchedule: (loads, currentJob) => resolveCanonicalLoadSchedule(loads, currentJob, run.canonicalId, scheduledTime, body.plannedWindow?.endTime || body.scheduledEnd), targetRunId: run.canonicalId, scheduledTime, scheduledEnd: body.plannedWindow?.endTime || body.scheduledEnd, collectionRequired: body.collectionRequired, expectedLoadVersions: body.expectedLoadVersions }, by, now, batch);
          loads.push(assigned);
        }
        return loads;
      });
      for (const item of result.filter(item => item.changed)) await appendLogisticsChange({ serviceDate: target.serviceDate, entityType: "assignment", entityId: item.jobId, relatedEntityId: item.load.id, changeType: "job-assigned", revision: item.load.version, changedAt: now, actorId });
      for (const item of result) if (item.plannedRun) await appendLogisticsChange({ serviceDate: target.serviceDate, entityType: "run", entityId: item.plannedRun.canonicalId, changeType: "canonical-work-planned", revision: item.plannedRun.version, changedAt: now, actorId });
      if (result.some(item => item.changed)) await rebuildLogisticsProjection(target.serviceDate, by);
      return NextResponse.json({ loads: result.map(item => item.load), assigned: ids.length });
    }
    if (
      body.action === "unassign-requirement" &&
      body.runId &&
      body.stopId &&
      body.requirementId
    ) {
      if (
        body.expectedRunVersion === undefined ||
        body.expectedStopVersion === undefined
      )
        throw new HttpError(422, "Current run and stop versions are required.");
      const result = await runTracedTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const stopRef = stops().doc(body.stopId!);
        const [runSnap, stopSnap] = await Promise.all([
          transaction.get(runRef),
          transaction.get(stopRef),
        ]);
        if (!runSnap.exists || !stopSnap.exists)
          throw new HttpError(404, "Run or stop not found.");
        const run = runSnap.data() as DeliveryRun;
        assertPlanningOpen(run);
        const stop = normalizeStop(stopSnap.data()!);
        if (
          run.version !== body.expectedRunVersion ||
          stop.version !== body.expectedStopVersion
        )
          throw new HttpError(
            409,
            "This run or stop changed elsewhere. Refresh before correcting it.",
          );
        if (
          stop.runId !== run.canonicalId ||
          !stop.requirementRefs.some(
            (ref) => ref.requirementId === body.requirementId,
          )
        )
          throw new HttpError(404, "Requirement is not attached to this stop.");
        const remainingRefs = stop.requirementRefs.filter(
          (ref) => ref.requirementId !== body.requirementId,
        );
        const nextRunIds = run.orderedStopIds.filter(
          (id) =>
            id !== stop.canonicalId ||
            remainingRefs.length > 0 ||
            stop.movementRequestIds.length > 0,
        );
        if (!remainingRefs.length && !stop.movementRequestIds.length)
          transaction.delete(stopRef);
        else
          transaction.set(stopRef, {
            ...stop,
            requirementRefs: remainingRefs,
            version: stop.version + 1,
            updatedAt: now,
            audit: [
              ...stop.audit,
              {
                action: "requirement-unassigned",
                at: now,
                by,
                version: stop.version + 1,
              },
            ],
          });
        const nextRun = {
          ...run,
          orderedStopIds: nextRunIds,
          version: run.version + 1,
          updatedAt: now,
          audit: [
            ...run.audit,
            {
              action: "requirement-unassigned",
              at: now,
              by,
              version: run.version + 1,
            },
          ],
        };
        transaction.set(runRef, nextRun);
        return nextRun;
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: "run", entityId: result.canonicalId, changeType: "requirement-unassigned", revision: result.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    if (body.action === "unassign-movement" && body.runId && body.movementId) {
      if (body.expectedRunVersion === undefined)
        throw new HttpError(422, "A current run version is required.");
      const result = await runTracedTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const movementRef = movements().doc(body.movementId!);
        const [runSnap, movementSnap, stopSnap] = await Promise.all([
          transaction.get(runRef),
          transaction.get(movementRef),
          transaction.get(stops().where("runId", "==", body.runId)),
        ]);
        if (!runSnap.exists || !movementSnap.exists)
          throw new HttpError(404, "Run or movement not found.");
        const run = runSnap.data() as DeliveryRun;
        assertPlanningOpen(run);
        const movement = movementSnap.data() as MovementRequest;
        if (run.version !== body.expectedRunVersion)
          throw new HttpError(
            409,
            "This run changed elsewhere. Refresh before correcting it.",
          );
        const attached = stopSnap.docs
          .map((doc) => normalizeStop(doc.data()))
          .filter((stop) =>
            (stop.movementRequestIds || []).includes(body.movementId!),
          );
        if (!attached.length)
          throw new HttpError(404, "Movement is not attached to this run.");
        for (const stop of attached) {
          const ids = stop.movementRequestIds.filter(
            (id) => id !== body.movementId,
          );
          if (!stop.requirementRefs.length && !ids.length) {
            transaction.delete(stops().doc(stop.canonicalId));
          } else
            transaction.set(stops().doc(stop.canonicalId), {
              ...stop,
              movementRequestIds: ids,
              version: stop.version + 1,
              updatedAt: now,
              audit: [
                ...stop.audit,
                {
                  action: "movement-unassigned",
                  at: now,
                  by,
                  version: stop.version + 1,
                },
              ],
            });
        }
        const removed = new Set(
          attached
            .filter(
              (stop) =>
                !stop.requirementRefs.length &&
                stop.movementRequestIds.length === 1,
            )
            .map((stop) => stop.canonicalId),
        );
        const nextRun = {
          ...run,
          orderedStopIds: run.orderedStopIds.filter((id) => !removed.has(id)),
          version: run.version + 1,
          updatedAt: now,
          audit: [
            ...run.audit,
            {
              action: "movement-unassigned",
              at: now,
              by,
              version: run.version + 1,
            },
          ],
        };
        transaction.set(runRef, nextRun);
        transaction.update(movementRef, {
          status: "open",
          version: movement.version + 1,
          updatedAt: now,
          audit: [
            ...movement.audit,
            {
              action: "movement-unassigned",
              at: now,
              by,
              version: movement.version + 1,
            },
          ],
        });
        return nextRun;
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: "movement", entityId: body.movementId, changeType: "movement-unassigned", revision: result.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    if (body.action === "return-stop-to-planning" && body.runId && body.stopId) {
      if (body.expectedRunVersion === undefined || body.expectedStopVersion === undefined)
        throw new HttpError(422, "Current run and stop versions are required.");
      const result = await runTracedTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const targetRef = stops().doc(body.stopId!);
        const [runSnap, targetSnap] = await Promise.all([
          transaction.get(runRef),
          transaction.get(targetRef),
        ]);
        if (!runSnap.exists || !targetSnap.exists)
          throw new HttpError(404, "Run or stop not found.");
        const run = runSnap.data() as DeliveryRun;
        assertPlanningOpen(run);
        const target = normalizeStop(targetSnap.data()!);
        if (run.version !== body.expectedRunVersion || target.version !== body.expectedStopVersion)
          throw new HttpError(409, "This run or stop changed elsewhere. Refresh before returning it to planning.");
        if (target.runId !== run.canonicalId)
          throw new HttpError(422, "The selected stop does not belong to this run.");

        const allRunSnap = await transaction.get(runs().where("serviceDate", "==", run.serviceDate));
        const allRuns = allRunSnap.docs.map((doc) => doc.data() as DeliveryRun);
        const runIds = allRuns.map((item) => item.canonicalId);
        const stopSnapshots = await Promise.all(Array.from({ length: Math.ceil(runIds.length / 30) }, (_, index) => transaction.get(stops().where("runId", "in", runIds.slice(index * 30, index * 30 + 30)))));
        const scoped = stopSnapshots.flatMap((snapshot) => snapshot.docs).map((doc) => normalizeStop(doc.data()));
        const movementIds = new Set(target.movementRequestIds || []);
        const affected = new Map<string, DeliveryStop>();
        const addAffected = (stop: DeliveryStop) => {
          if (
            stop.canonicalId === target.canonicalId ||
            stop.linkedStopId === target.canonicalId ||
            target.linkedStopId === stop.canonicalId ||
            stop.movementRequestIds.some((id) => movementIds.has(id))
          ) affected.set(stop.canonicalId, stop);
        };
        scoped.forEach(addAffected);
        affected.forEach((stop) => stop.movementRequestIds.forEach((id) => movementIds.add(id)));
        scoped.forEach(addAffected);
        const movementDocs = await Promise.all(Array.from(movementIds).map((id) => transaction.get(movements().doc(id))));
        for (const stop of affected.values()) transaction.delete(stops().doc(stop.canonicalId));
        for (const movementSnap of movementDocs) {
          if (!movementSnap.exists) continue;
          const movement = movementSnap.data() as MovementRequest;
          transaction.update(movementSnap.ref, {
            status: "open",
            version: movement.version + 1,
            updatedAt: now,
            audit: [...movement.audit, { action: "returned-to-planning", at: now, by, version: movement.version + 1 }],
          });
        }
        const affectedRuns = new Map(allRuns.map((item) => [item.canonicalId, item]));
        const updatedRuns = new Map<string, DeliveryRun>();
        affectedRuns.forEach((affectedRun, runId) => {
          const removed = Array.from(affected.values()).some((stop) => stop.runId === runId);
          if (!removed) return;
          assertPlanningOpen(affectedRun);
          const nextVersion = affectedRun.version + 1;
          const nextRun = { ...affectedRun, orderedStopIds: affectedRun.orderedStopIds.filter((id) => !affected.has(id)), version: nextVersion, updatedAt: now, audit: [...affectedRun.audit, { action: "returned-to-planning", at: now, by, version: nextVersion }] };
          transaction.set(runs().doc(runId), nextRun);
          updatedRuns.set(runId, nextRun);
        });
        return updatedRuns.get(run.canonicalId) || run;
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: "stop", entityId: body.stopId, changeType: "returned-to-planning", revision: result.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    if (
      body.action === "move-stop" &&
      body.stopId &&
      body.runId &&
      body.targetRunId
    ) {
      if (
        body.runId === body.targetRunId ||
        body.expectedRunVersion === undefined ||
        body.expectedTargetRunVersion === undefined
      )
        throw new HttpError(
          422,
          "Choose a different target run with its current version.",
        );
      const planned = body.plannedArrivalTime !== undefined || body.plannedWindow !== undefined
        ? validatePlannedSchedule(body.plannedArrivalTime, body.plannedWindow)
        : undefined;
      const result = await runTracedTransaction(async (transaction) => {
        const sourceRef = runs().doc(body.runId!);
        const targetRef = runs().doc(body.targetRunId!);
        const stopRef = stops().doc(body.stopId!);
        const [
          sourceSnap,
          targetSnap,
          stopSnap,
          sourceStopsSnap,
          targetStopsSnap,
        ] = await Promise.all([
          transaction.get(sourceRef),
          transaction.get(targetRef),
          transaction.get(stopRef),
          transaction.get(stops().where("runId", "==", body.runId)),
          transaction.get(stops().where("runId", "==", body.targetRunId)),
        ]);
        if (!sourceSnap.exists || !targetSnap.exists || !stopSnap.exists)
          throw new HttpError(404, "Run or stop not found.");
        const source = sourceSnap.data() as DeliveryRun;
        const target = targetSnap.data() as DeliveryRun;
        if (source.serviceDate !== target.serviceDate)
          throw new HttpError(422, "Ordinary stop moves must stay within the same service date. Use the explicit collection deferral workflow for cross-date work.");
        assertPlanningOpen(source);
        assertPlanningOpen(target);
        const stop = normalizeStop(stopSnap.data()!);
        if (
          source.version !== body.expectedRunVersion ||
          target.version !== body.expectedTargetRunVersion ||
          (body.expectedStopVersion !== undefined &&
            stop.version !== body.expectedStopVersion)
        )
          throw new HttpError(
            409,
            "The run or stop changed elsewhere. Refresh before moving it.",
          );
        if (stop.runId !== source.canonicalId)
          throw new HttpError(
            422,
            "Stop does not belong to the selected source run.",
          );
        const transfer = await transferContext(transaction, stop);
        if (transfer.missingMovementIds.length) throw new HttpError(409, "Linked movement identity is unavailable; review the stop before moving it.");
        const transferLeg = transferLegsForStop(stop, transfer.transferMovements, transfer.stops);
        if (transferLeg.isTransfer) {
          if (transferLeg.integrityProblem) throw new HttpError(409, "Transfer leg mapping is incomplete or ambiguous; review the linked movement before moving it.");
          throw new HttpError(422, "Transfer pickup and drop-off are linked and cannot be moved independently.");
        }
        const sourceStops = sourceStopsSnap.docs
          .map((doc) => normalizeStop(doc.data()))
          .filter((item) => item.canonicalId !== stop.canonicalId);
        const targetStops = targetStopsSnap.docs
          .map((doc) => normalizeStop(doc.data()))
          .filter((item) => item.canonicalId !== stop.canonicalId);
        const resolvedPlanned = planned ? resolveStopPlannedTiming(stop, planned, targetStops) : undefined;
        const movedTiming = resolvedPlanned ? replaceStopTiming(stop, resolvedPlanned) : stop;
        const moved = {
          ...movedTiming,
          runId: target.canonicalId,
          version: stop.version + 1,
          updatedAt: now,
          audit: [
            ...stop.audit,
            { action: "stop-moved", at: now, by, version: stop.version + 1 },
          ],
        };
        const orderedSource = orderedTransferStops(sourceStops);
        const orderedTarget = orderedTransferStops([...targetStops, moved]);
        for (const sourceStop of orderedSource)
          transaction.set(stops().doc(sourceStop.canonicalId), sourceStop);
        for (const targetStop of orderedTarget)
          transaction.set(stops().doc(targetStop.canonicalId), targetStop);
        transaction.set(sourceRef, {
          ...source,
          orderedStopIds: orderedSource.map((item) => item.canonicalId),
          version: source.version + 1,
          updatedAt: now,
          audit: [
            ...source.audit,
            {
              action: "stop-moved-out",
              at: now,
              by,
              version: source.version + 1,
            },
          ],
        });
        transaction.set(targetRef, {
          ...target,
          orderedStopIds: orderedTarget.map((item) => item.canonicalId),
          version: target.version + 1,
          updatedAt: now,
          audit: [
            ...target.audit,
            {
              action: "stop-moved-in",
              at: now,
              by,
              version: target.version + 1,
            },
          ],
        });
        return {
          stop: moved,
          serviceDate: target.serviceDate,
          revision: Math.max(source.version + 1, target.version + 1),
          placementAuthority: {
            stopId: moved.canonicalId,
            stopRunId: moved.runId,
            stopVersion: moved.version,
            runVersions: {
              [source.canonicalId]: source.version + 1,
              [target.canonicalId]: target.version + 1,
            },
          },
        };
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: "stop", entityId: result.stop.canonicalId, changeType: "stop-moved", revision: result.revision, actorId, by, changedAt: now });
      // Keep the historic stop fields at the top level while supplying the
      // exact optimistic versions needed to safely chain a later placement.
      return NextResponse.json({ ...result.stop, placementAuthority: result.placementAuthority });
    }
    if ((body.action === "schedule-stop" || body.action === "clear-stop-schedule") && body.runId && body.stopId) {
      if (body.expectedRunVersion === undefined || body.expectedStopVersion === undefined)
        throw new HttpError(422, "Current run and stop versions are required to change timing.");
      const result = await runTracedTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const stopRef = stops().doc(body.stopId!);
        const [runSnap, stopSnap] = await Promise.all([transaction.get(runRef), transaction.get(stopRef)]);
        if (!runSnap.exists || !stopSnap.exists) throw new HttpError(404, "Run or stop not found.");
        const run = runSnap.data() as DeliveryRun;
        const stop = normalizeStop(stopSnap.data()!);
        assertPlanningOpen(run);
        if (run.version !== body.expectedRunVersion || stop.version !== body.expectedStopVersion)
          throw new HttpError(409, "The run or stop changed elsewhere. Refresh before changing timing.");
        if (stop.runId !== run.canonicalId) throw new HttpError(422, "Stop does not belong to the selected run.");
        if (body.action === "clear-stop-schedule") {
          const nextStop = clearPlannedSchedule(stop, now, by);
          transaction.set(stopRef, nextStop);
          const nextRun = { ...run, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "stop-schedule-cleared", at: now, by, version: run.version + 1 }] };
          transaction.set(runRef, nextRun);
          return { run: nextRun, stop: nextStop };
        }
        const planned = validatePlannedSchedule(body.plannedArrivalTime, body.plannedWindow);
        const runStopsSnap = await transaction.get(stops().where("runId", "==", run.canonicalId));
        const currentRunStops = runStopsSnap.docs.map((doc) => normalizeStop(doc.data())).filter((item) => item.canonicalId !== stop.canonicalId);
        const resolvedPlanned = resolveStopPlannedTiming(stop, planned, currentRunStops);
        if (body.resizeEndOnly) {
          const currentStart = stop.plannedWindow?.startTime;
          if (!planned.plannedWindow?.endTime || !currentStart || planned.plannedWindow.startTime !== currentStart) throw new HttpError(409, "The window start changed. Refresh before resizing its end.");
          const resolvedStart = resolvedPlanned.plannedWindow?.startTime;
          if (resolvedStart !== currentStart) throw new HttpError(409, "The resized window conflicts with current work; its start must remain fixed.");
        }
        if (stop.linkedOperation === "collection" && stop.linkedStopId) {
          const counterpartSnap = await transaction.get(stops().doc(stop.linkedStopId));
          if (counterpartSnap.exists) {
            const counterpart = normalizeStop(counterpartSnap.data()!);
            const collectionStart = resolvedPlanned.plannedWindow?.startTime || resolvedPlanned.plannedArrivalTime;
            const deliveryStart = counterpart.plannedWindow?.startTime || counterpart.plannedArrivalTime;
            if (collectionStart && deliveryStart && collectionStart < deliveryStart)
              throw new HttpError(422, "Collection cannot be scheduled before its delivery.");
          }
        }
        const transfer = await transferContext(transaction, stop);
        if (transfer.missingMovementIds.length) throw new HttpError(409, "Linked movement identity is unavailable; review the stop before scheduling it.");
        const transferLeg = transferLegsForStop(stop, transfer.transferMovements, transfer.stops);
        if (transferLeg.isTransfer) {
          if (transferLeg.integrityProblem) throw new HttpError(409, "Transfer pickup/drop-off mapping is incomplete or ambiguous; review the linked movement before scheduling.");
          const proposedStart = resolvedPlanned.plannedWindow?.startTime || resolvedPlanned.plannedArrivalTime;
          for (const leg of transferLeg.legs) {
            const counterpart = leg.counterpart!;
            if (counterpart.runId !== run.canonicalId) throw new HttpError(409, "Transfer pickup and drop-off must remain on the same run.");
            const counterpartStart = counterpart.plannedWindow?.startTime || counterpart.plannedArrivalTime;
            if (proposedStart && counterpartStart && (leg.role === "pickup" ? proposedStart > counterpartStart : proposedStart < counterpartStart))
              throw new HttpError(422, "Transfer pickup must be scheduled at or before its drop-off.");
          }
        }
        const nextStop = { ...replaceStopTiming(stop, resolvedPlanned), version: stop.version + 1, updatedAt: now, audit: [...stop.audit, { action: "stop-scheduled", at: now, by, version: stop.version + 1 }] };
        transaction.set(stopRef, nextStop);
        const nextRun = { ...run, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "stop-scheduled", at: now, by, version: run.version + 1 }] };
        transaction.set(runRef, nextRun);
        return { run: nextRun, stop: nextStop };
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.run.serviceDate, entityType: "stop", entityId: result.stop.canonicalId, changeType: body.action, revision: result.stop.version, actorId, by, changedAt: now });
      return NextResponse.json({
        ...result,
        placementAuthority: {
          stopId: result.stop.canonicalId,
          stopRunId: result.stop.runId,
          stopVersion: result.stop.version,
          runVersions: { [result.run.canonicalId]: result.run.version },
        },
      });
    }
    if (body.action === "assign" && body.runId) {
      if (body.requirementId && body.movementId)
        throw new HttpError(422, "Choose one item to assign.");
      const target = await getRun(body.runId);
      if (!target) throw new HttpError(404, "Run not found.");
      assertPlanningOpen(target);
      if (body.expectedRunVersion === undefined)
        throw new HttpError(
          422,
          "A current run version is required to assign work. Refresh and try again.",
        );
      if (body.requirementId && body.expectedSourceVersion === undefined)
        throw new HttpError(
          422,
          "A current source version is required to assign fulfilment work. Refresh and try again.",
        );
      let requirement: FulfilmentRequirement | undefined;
      if (body.requirementId) {
        let requirements;
        try {
          requirements = await fetchRequirements(
            target.serviceDate,
            request.headers.get("cookie") || undefined,
          );
        } catch (error) {
          throw new HttpError(
            503,
            `Fulfilment work could not be verified: ${messageOf(error)}`,
          );
        }
        requirement = requirements.find(
          (item) => item.canonicalId === body.requirementId,
        );
        if (!requirement)
          throw new HttpError(
            404,
            "Fulfilment requirement no longer exists upstream.",
          );
        if (requirement.serviceDate !== target.serviceDate)
          throw new HttpError(
            422,
            "Fulfilment work belongs to a different service date.",
          );
        try {
          validateRequirementForPlanning(
            requirement,
            body.expectedSourceVersion!,
          );
        } catch (error) {
          throw new HttpError(
            error instanceof Error && error.message.includes("changed")
              ? 409
              : 422,
            messageOf(error),
          );
        }
      }
      const oplocs = body.movementId
        ? await fetchOplocs(request.headers.get("cookie") || undefined).catch(
            (error) => {
              throw new HttpError(
                503,
                `OPLOCs could not be verified: ${messageOf(error)}`,
              );
            },
          )
        : [];
      const result = await runTracedTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const runSnap = await transaction.get(runRef);
        if (!runSnap.exists) throw new HttpError(404, "Run not found.");
        const run = runSnap.data() as DeliveryRun;
        assertPlanningOpen(run);
        if (run.version !== body.expectedRunVersion)
          throw new HttpError(
            409,
            "This run changed elsewhere. Refresh before assigning work.",
          );
        const stopSnap = await transaction.get(
          stops().where("runId", "==", body.runId),
        );
        const scoped = stopSnap.docs.map((doc) => normalizeStop(doc.data()));
        let movement: MovementRequest | undefined;
        if (body.movementId) {
          const movementSnap = await transaction.get(
            movements().doc(body.movementId),
          );
          if (!movementSnap.exists)
            throw new HttpError(404, "Movement request no longer exists.");
          movement = movementSnap.data() as MovementRequest;
          if (movement.serviceDate !== run.serviceDate)
            throw new HttpError(
              422,
              "Movement belongs to a different service date.",
            );
          if (movement.status !== "open")
            throw new HttpError(
              422,
              "This movement is no longer open for planning.",
            );
        }
        const planned = body.plannedArrivalTime !== undefined || body.plannedWindow !== undefined
          ? validatePlannedSchedule(body.plannedArrivalTime, body.plannedWindow)
          : undefined;
        const newStops = requirement
          ? [
              combineStop(scoped, {
                locationOplocId: requirement.destinationOplocId,
                locationLabel: requirement.destinationLabelSnapshot,
                requirement,
                runId: run.canonicalId,
                by,
              }),
            ]
          : assignMovementStops(
              scoped,
              run.canonicalId,
              movement!,
              {
                from: movement!.fromOplocId
                  ? labelFor(oplocs, movement!.fromOplocId)
                  : movement!.fromAddress,
                to: movement!.toOplocId
                  ? labelFor(oplocs, movement!.toOplocId)
                  : movement!.toAddress,
              },
              by,
            );
        const byId = new Map(scoped.map((stop) => [stop.canonicalId, stop]));
        newStops.forEach((stop) => byId.set(stop.canonicalId, stop));
        const assignedStopIds = new Set(
          newStops
            .filter((stop) => requirement
              ? stop.requirementRefs.some((ref) => ref.requirementId === requirement!.canonicalId)
              : (stop.movementRequestIds || []).includes(movement!.canonicalId))
            .map((stop) => stop.canonicalId),
        );
        if (planned) {
          for (const id of assignedStopIds) {
            const stop = byId.get(id)!;
            const conflicts = Array.from(byId.values()).filter((candidate) => candidate.canonicalId !== id);
            const resolved = resolveStopPlannedTiming(stop, planned, conflicts);
            byId.set(id, { ...replaceStopTiming(stop, resolved), version: stop.version + 1, updatedAt: now, audit: [...stop.audit, { action: "stop-scheduled", at: now, by, version: stop.version + 1 }] });
          }
        }
        const ordered = orderedTransferStops([...byId.values()]);
        for (const stop of ordered)
          transaction.set(stops().doc(stop.canonicalId), stop);
        if (movement)
          transaction.update(movements().doc(movement.canonicalId), {
            status: "planned",
            version: movement.version + 1,
            updatedAt: now,
            audit: [
              ...movement.audit,
              {
                action: "movement-planned",
                at: now,
                by,
                version: movement.version + 1,
              },
            ],
          });
        const nextRun = runPayload(run, ordered, now, by);
        transaction.set(runRef, nextRun);
        return nextRun;
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: body.movementId ? "movement" : "stop", entityId: body.movementId || body.requirementId || result.canonicalId, changeType: "work-assigned", revision: result.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    if (
      [
        "arrive-stop",
        "complete-stop",
        "undo-completion",
        "mark-stop-loaded",
        "mark-subload-loaded",
        "mark-subload-delivered",
        "mark-subload-collected",
        "defer-collection",
        "report-issue",
        "defer-stop",
        "resolve-issue",
      ].includes(body.action) &&
      body.runId &&
      body.stopId
    ) {
      if (
        body.expectedRunVersion === undefined ||
        body.expectedStopVersion === undefined
      )
        throw new HttpError(422, "Current run and stop versions are required.");
      if (
        (body.action === "report-issue" || body.action === "resolve-issue") ===
          false &&
        body.action !== "defer-stop" &&
        body.action !== "mark-stop-loaded" &&
        body.action !== "mark-subload-loaded" &&
        body.action !== "mark-subload-collected" &&
        body.action !== "mark-subload-delivered" &&
        body.action !== "undo-completion" &&
        body.action !== "defer-collection" &&
        body.action !== "arrive-stop" &&
        body.action !== "complete-stop"
      )
        throw new HttpError(400, "Unknown execution action.");
      if (body.action === "report-issue" && !body.issueDescription?.trim())
        throw new HttpError(422, "A short issue description is required.");
      const result = await runTracedTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const stopRef = stops().doc(body.stopId!);
        const [runSnap, stopSnap] = await Promise.all([
          transaction.get(runRef),
          transaction.get(stopRef),
        ]);
        if (!runSnap.exists || !stopSnap.exists)
          throw new HttpError(404, "Run or stop not found.");
        const run = runSnap.data() as DeliveryRun;
        const stop = normalizeStop(stopSnap.data()!);
        if (
          run.version !== body.expectedRunVersion ||
          stop.version !== body.expectedStopVersion
        )
          throw new HttpError(
            409,
            "This run or stop changed elsewhere. Refresh before executing the stop.",
          );
        if (stop.runId !== run.canonicalId)
          throw new HttpError(422, "Stop does not belong to this run.");
        if (
          body.action !== "resolve-issue" &&
          body.action !== "mark-stop-loaded" &&
          body.action !== "mark-subload-loaded" &&
          body.action !== "undo-completion" &&
          body.action !== "defer-collection" &&
          run.status !== "dispatched"
        )
          throw new HttpError(
            422,
            "The driver can execute stops only after the run has been dispatched.",
          );
        if (body.action === "resolve-issue" && run.status === "completed")
          throw new HttpError(422, "Completed runs are read-only.");
        if (body.action === "defer-collection" && run.status === "completed")
          throw new HttpError(422, "Completed runs are read-only.");
        const collectionLane = stop.linkedOperation === "collection" || stop.movementType === "collection";
        if (["mark-stop-loaded", "mark-subload-loaded"].includes(body.action) && (collectionLane || !["planned", "ready"].includes(run.status) || stop.status === "completed")) throw new HttpError(422, "Delivery loading is allowed only before dispatch.");
        if (body.action === "mark-subload-delivered" && (collectionLane || !stop.loaded && !stop.loadedRequirementIds?.includes(body.requirementId!))) throw new HttpError(422, "Load this delivery subload before completing it.");
        if (body.action === "complete-stop" && !collectionLane && !stop.loaded) throw new HttpError(422, "Load the delivery before whole completion.");
        if (body.action === "undo-completion" && !["dispatched", "completed"].includes(run.status)) throw new HttpError(422, "Undo requires a dispatched or completed run.");
        const runStopSnap = await transaction.get(
          stops().where("runId", "==", run.canonicalId),
        );
        if (body.action === "defer-collection") {
          if (stop.linkedOperation !== "collection" && stop.movementType !== "collection")
            throw new HttpError(422, "Only collection stops can be postponed.");
          if (stop.status === "completed")
            throw new HttpError(422, "Completed collections cannot be postponed.");
          if (!body.targetServiceDate || !validOperationalDate(body.targetServiceDate) || body.targetServiceDate <= run.serviceDate)
            throw new HttpError(422, "Choose a future collection date.");
          const transfer = await transferContext(transaction, stop);
          if (transfer.missingMovementIds.length) throw new HttpError(409, "Linked movement identity is unavailable; review the collection before postponing it.");
          if (transfer.inconsistentMovementIds.length) throw new HttpError(409, "Linked movement identity is inconsistent; review the collection before postponing it.");
          const transferLeg = transferLegsForStop(stop, transfer.transferMovements, transfer.stops);
          if (transferLeg.isTransfer) throw new HttpError(422, "Transfer pickup and drop-off must remain linked and cannot be postponed independently.");
          const allRunsSnap = await transaction.get(
            runs().where("serviceDate", "==", body.targetServiceDate),
          );
          const allRuns = allRunsSnap.docs.map((doc) => doc.data() as DeliveryRun);
          const target = allRuns.find((candidate) =>
            candidate.serviceDate === body.targetServiceDate &&
            (candidate.status === "draft" || candidate.status === "planned") &&
            ((run.driverId && candidate.driverId === run.driverId) ||
              (!run.driverId && run.driverLabel && candidate.driverLabel === run.driverLabel)),
          );
          const targetRun: DeliveryRun = target || {
            canonicalId: `run:${body.targetServiceDate}:deferred-collections:${run.driverId || run.canonicalId}`,
            serviceDate: body.targetServiceDate,
            status: "draft",
            returnToCpuRequired: true,
            driverId: run.driverId,
            driverLabel: run.driverLabel,
            vehicleLabel: run.vehicleLabel,
            vehicleId: run.vehicleId,
            orderedStopIds: [],
            version: 1,
            createdAt: now,
            updatedAt: now,
            audit: [{ action: "deferred-collection-run-created", at: now, by, version: 1 }],
          };
          // The future run is selected or constructed server-side, so it was
          // not covered by authorizeCommand's request-ID preflight. Authorize
          // its stable vehicle identity before staging any transaction write.
          authorizeRun(principal, targetRun);

          const movedMovements: MovementRequest[] = [];
          for (const movement of transfer.movements) {
            if (movement.type !== "collection" || movement.serviceDate !== run.serviceDate || !Number.isInteger(movement.version) || movement.version < 1 || !Array.isArray(movement.audit))
              throw new HttpError(409, "Linked collection movement data is invalid or does not match the source service date.");
            const [canonicalOwners, legacyOwners] = await Promise.all([
              transaction.get(stops().where("movementRequestIds", "array-contains", movement.canonicalId)),
              transaction.get(stops().where("movementRequestId", "==", movement.canonicalId)),
            ]);
            const owners = new Map<string, DeliveryStop>();
            for (const doc of [...canonicalOwners.docs, ...legacyOwners.docs]) {
              const owner = normalizeStop(doc.data());
              if (owner.movementRequestIds.includes(movement.canonicalId)) {
                if (doc.id !== owner.canonicalId) throw new HttpError(409, "Linked collection stop identity is inconsistent.");
                owners.set(doc.id, owner);
              }
            }
            for (const [ownerId, owner] of owners) {
              if (ownerId === stop.canonicalId) continue;
              const ownerRunSnap = await transaction.get(runs().doc(owner.runId));
              if (!ownerRunSnap.exists)
                throw new HttpError(409, "Linked collection movement has an unresolved stop owner.");
              const ownerRun = ownerRunSnap.data() as DeliveryRun;
              if (ownerRun.serviceDate === run.serviceDate || ownerRun.serviceDate === body.targetServiceDate)
                throw new HttpError(409, "Linked collection movement is shared by another source or target date stop.");
            }
            const nextVersion = movement.version + 1;
            movedMovements.push({
              ...movement,
              serviceDate: body.targetServiceDate,
              version: nextVersion,
              updatedAt: now,
              audit: [...movement.audit, { action: "collection-postponed", at: now, by, version: nextVersion }],
            });
          }
          const sourceStops = runStopSnap.docs
            .map((doc) => normalizeStop(doc.data()))
            .filter((item) => item.canonicalId !== stop.canonicalId);
          const moved = {
            ...stop,
            runId: targetRun.canonicalId,
            sequence: targetRun.orderedStopIds.length + 1,
            postponedFromServiceDate: run.serviceDate,
            postponedAt: now,
            postponedBy: by,
            version: stop.version + 1,
            updatedAt: now,
            audit: [...stop.audit, { action: "collection-postponed", at: now, by, version: stop.version + 1 }],
          };
          const targetStopsSnap = target ? await transaction.get(stops().where("runId", "==", target.canonicalId)) : undefined;
          const targetStops = (targetStopsSnap?.docs || []).map((doc) => normalizeStop(doc.data()));
          const orderedSource = orderedTransferStops(sourceStops);
          const orderedTarget = orderedTransferStops([...targetStops.filter((item) => item.canonicalId !== stop.canonicalId), moved]);
          const sourceWork = await readRunWork(transaction, run);
          sourceWork.native = orderedSource;
          const sourceFinal = finaliseRun({ ...run, orderedStopIds: orderedSource.map(item => item.canonicalId) }, sourceWork, by, now);
          const sourceNext = { ...sourceFinal, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "collection-postponed", at: now, by, version: run.version + 1 }] };
          const targetNext = {
            ...targetRun,
            orderedStopIds: orderedTarget.map((item) => item.canonicalId),
            version: targetRun.version + 1,
            updatedAt: now,
            audit: [...targetRun.audit, { action: "collection-postponed-in", at: now, by, version: targetRun.version + 1 }],
          };
          // Finish every transaction read and derive both run snapshots before
          // queuing writes; Firestore rejects reads after the first write.
          for (const movement of movedMovements)
            transaction.set(movements().doc(movement.canonicalId), movement);
          orderedSource.forEach((item) => transaction.set(stops().doc(item.canonicalId), item));
          orderedTarget.forEach((item) => transaction.set(stops().doc(item.canonicalId), item));
          transaction.set(runs().doc(run.canonicalId), sourceNext);
          transaction.set(runs().doc(targetRun.canonicalId), targetNext);
          return { run: sourceNext, targetRun: targetNext, stop: moved };
        }
        const allStops = runStopSnap.docs.map((doc) =>
          normalizeStop(doc.data()),
        );
        let nextStop: DeliveryStop = { ...stop };
        let nextRun: DeliveryRun = { ...run };
        if (body.action === "mark-stop-loaded") {
          if (run.status === "completed")
            throw new HttpError(422, "Completed runs are read-only.");
          nextStop = {
            ...stop,
            loaded: body.loaded !== false,
            loadedRequirementIds: body.loaded === false ? [] : stop.requirementRefs.map(ref => ref.requirementId),
            version: stop.version + 1,
            updatedAt: now,
            audit: [
              ...stop.audit,
              {
                action: body.loaded === false ? "stop-unloaded" : "stop-loaded",
                at: now,
                by,
                version: stop.version + 1,
              },
            ],
          };
        }
        if (body.action === "mark-subload-loaded") {
          if (!body.requirementId || !stop.requirementRefs.some((ref) => ref.requirementId === body.requirementId))
            throw new HttpError(422, "That subload is not attached to this stop.");
          const current = new Set(stop.loadedRequirementIds || []);
          if (body.loaded === false) current.delete(body.requirementId);
          else current.add(body.requirementId);
          const loadedRequirementIds = [...current].filter((id) => stop.requirementRefs.some((ref) => ref.requirementId === id));
          nextStop = {
            ...stop,
            loadedRequirementIds,
            loaded: loadedRequirementIds.length === stop.requirementRefs.length,
            version: stop.version + 1,
            updatedAt: now,
            audit: [...stop.audit, { action: body.loaded === false ? "subload-unloaded" : "subload-loaded", at: now, by, version: stop.version + 1 }],
          };
        }
        if (body.action === "mark-subload-delivered") {
          if (!body.requirementId || !stop.requirementRefs.some((ref) => ref.requirementId === body.requirementId))
            throw new HttpError(422, "That subload is not attached to this stop.");
          const deliveredRequirementIds = [...new Set([...(stop.deliveredRequirementIds || []), body.requirementId])].filter((id) => stop.requirementRefs.some((ref) => ref.requirementId === id));
          nextStop = {
            ...stop,
            deliveredRequirementIds,
            status: deliveredRequirementIds.length === stop.requirementRefs.length ? "completed" : stop.status,
            version: stop.version + 1,
            updatedAt: now,
            audit: [...stop.audit, { action: "subload-delivered", at: now, by, version: stop.version + 1 }],
          };
          if (nextStop.status === "completed") nextRun = { ...run, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "stop-completed", at: now, by, version: run.version + 1 }] };
        }
        if (body.action === "mark-subload-collected") {
          if (stop.linkedOperation !== "collection" && stop.movementType !== "collection") throw new HttpError(422, "Only collection subloads can be collected.");
          if (!body.requirementId || !stop.requirementRefs.some(ref => ref.requirementId === body.requirementId)) throw new HttpError(422, "Subload is not attached to this collection.");
          const ids = [...new Set([...(stop.collectedRequirementIds || []), body.requirementId])];
          nextStop = { ...stop, collectedRequirementIds: ids, status: ids.length === stop.requirementRefs.length ? "completed" : stop.status, version: stop.version + 1, updatedAt: now, audit: [...stop.audit, { action: "subload-collected", at: now, by, version: stop.version + 1 }] };
        }
        if (["mark-subload-delivered", "mark-subload-collected"].includes(body.action) && nextStop.status === "completed" && stop.status !== "completed") {
          nextStop.completionSnapshot = { status: stop.status === "arrived" ? "arrived" : "planned", loaded: stop.loaded === true, loadedRequirementIds: stop.loadedRequirementIds || [], deliveredRequirementIds: stop.deliveredRequirementIds || [], collectedRequirementIds: stop.collectedRequirementIds || [] };
        }
        if (body.action === "arrive-stop") {
          if (stop.status !== "planned")
            throw new HttpError(
              422,
              "Only a planned stop can be marked arrived.",
            );
          nextStop = {
            ...stop,
            status: "arrived",
            version: stop.version + 1,
            updatedAt: now,
            audit: [
              ...stop.audit,
              {
                action: "stop-arrived",
                at: now,
                by,
                version: stop.version + 1,
              },
            ],
          };
        }
        if (body.action === "complete-stop") {
          if (stop.status !== "arrived" && !body.confirmDirect)
            throw new HttpError(
              422,
              "Mark the stop arrived before completing it, or explicitly confirm direct completion.",
            );
          if (stop.status === "completed")
            throw new HttpError(422, "Stop is already completed.");
          nextStop = {
            ...stop,
            status: "completed",
            ...(collectionLane ? { collectedRequirementIds: stop.requirementRefs.map(ref => ref.requirementId) } : { deliveredRequirementIds: stop.requirementRefs.map(ref => ref.requirementId) }),
            completedFromStatus: stop.status === "arrived" ? "arrived" : "planned",
            completionSnapshot: { status: stop.status === "arrived" ? "arrived" : "planned", loaded: stop.loaded === true, loadedRequirementIds: stop.loadedRequirementIds || [], deliveredRequirementIds: stop.deliveredRequirementIds || [], collectedRequirementIds: stop.collectedRequirementIds || [] },
            version: stop.version + 1,
            updatedAt: now,
            audit: [
              ...stop.audit,
              {
                action: "stop-completed",
                at: now,
                by,
                version: stop.version + 1,
              },
            ],
          };
        }
        if (body.action === "undo-completion") {
          if (stop.status !== "completed")
            throw new HttpError(422, "Only completed stops can be undone.");
          const { completedFromStatus, ...rest } = stop;
          nextStop = {
            ...rest,
            ...stop.completionSnapshot,
            completionSnapshot: undefined,
            status: stop.completionSnapshot?.status || restoredStopStatus({ completedFromStatus }),
            version: stop.version + 1,
            updatedAt: now,
            audit: [
              ...stop.audit,
              {
                action: "stop-completion-undone",
                at: now,
                by,
                version: stop.version + 1,
              },
            ],
          };
          if (run.status === "completed") {
            nextRun = {
              ...run,
              status: "dispatched",
              version: run.version + 1,
              updatedAt: now,
              audit: [
                ...run.audit,
                {
                  action: "run-completion-undone",
                  at: now,
                  by,
                  version: run.version + 1,
                },
              ],
            };
          } else if (run.returnToCpuPending) {
            nextRun = {
              ...run,
              returnToCpuPending: false,
              version: run.version + 1,
              updatedAt: now,
              audit: [...run.audit, { action: "run-return-readiness-undone", at: now, by, version: run.version + 1 }],
            };
          }
        }
        if (body.action === "report-issue") {
          const issue = {
            id: `issue:${stop.canonicalId}:${Date.now()}`,
            stopId: stop.canonicalId,
            reportedAt: now,
            reportedBy: by,
            description: body.issueDescription!.trim(),
            ...(body.issueCategory ? { category: body.issueCategory } : {}),
            status: "open" as const,
          };
          nextStop = {
            ...stop,
            issues: [...(stop.issues || []), issue],
            version: stop.version + 1,
            updatedAt: now,
            audit: [
              ...stop.audit,
              {
                action: "issue-reported",
                at: now,
                by,
                version: stop.version + 1,
              },
            ],
          };
        }
        if (body.action === "resolve-issue") {
          const issue = (stop.issues || []).find(
            (item) => item.id === body.issueId && item.status === "open",
          );
          if (!issue) throw new HttpError(404, "Open issue not found.");
          nextStop = {
            ...stop,
            issues: (stop.issues || []).map((item) =>
              item.id === issue.id
                ? {
                    ...item,
                    status: "resolved" as const,
                    resolvedAt: now,
                    resolvedBy: by,
                    resolutionNotes: body.resolutionNotes,
                  }
                : item,
            ),
            version: stop.version + 1,
            updatedAt: now,
            audit: [
              ...stop.audit,
              {
                action: "issue-resolved",
                at: now,
                by,
                version: stop.version + 1,
              },
            ],
          };
        }
        if (body.action === "defer-stop") {
          if (stop.status === "completed")
            throw new HttpError(422, "Completed stops cannot be deferred.");
          const transfer = await transferContext(transaction, stop);
          if (transfer.missingMovementIds.length) throw new HttpError(409, "Linked movement identity is unavailable; review the stop before deferring it.");
          const transferLeg = transferLegsForStop(stop, transfer.transferMovements, transfer.stops);
          if (transferLeg.isTransfer)
            throw new HttpError(
              422,
              "Transfer pickup and drop-off must remain linked and cannot be deferred independently.",
            );
          const reordered = [
            ...allStops.filter((item) => item.canonicalId !== stop.canonicalId),
            stop,
          ];
          reordered.forEach((item, index) =>
            transaction.set(stops().doc(item.canonicalId), {
              ...item,
              sequence: index + 1,
            }),
          );
          nextRun = {
            ...run,
            orderedStopIds: reordered.map((item) => item.canonicalId),
            version: run.version + 1,
            updatedAt: now,
            audit: [
              ...run.audit,
              {
                action: "stop-deferred",
                at: now,
                by,
                version: run.version + 1,
              },
            ],
          };
        }
        if (["complete-stop", "mark-subload-delivered", "mark-subload-collected", "undo-completion", "resolve-issue", "report-issue"].includes(body.action)) {
          const work = await readRunWork(transaction, run);
          work.native = work.native.map(item => item.canonicalId === stop.canonicalId ? nextStop : item);
          // Recompute from the original run to avoid double version increments.
          nextRun = finaliseRun(run, work, by, now, body.action === "undo-completion");
        }
        transaction.set(stopRef, nextStop);
        if (nextRun.version === run.version)
          nextRun = {
            ...run,
            version: run.version + 1,
            updatedAt: now,
            audit: [
              ...run.audit,
              {
                action: `${body.action}`,
                at: now,
                by,
                version: run.version + 1,
              },
            ],
          };
        transaction.set(runRef, nextRun);
        return { run: nextRun, stop: nextStop };
      });
      const deferredTargetRun = (result as { targetRun?: DeliveryRun }).targetRun;
      if (body.action === "defer-collection" && deferredTargetRun) {
        const sourceEvent = await appendLogisticsChange({ serviceDate: result.run.serviceDate, entityType: "run", entityId: result.run.canonicalId, changeType: "collection-postponed-out", revision: result.run.version, changedAt: now, actorId });
        const targetEvent = await appendLogisticsChange({ serviceDate: deferredTargetRun.serviceDate, entityType: "run", entityId: deferredTargetRun.canonicalId, changeType: "collection-postponed-in", revision: deferredTargetRun.version, changedAt: now, actorId });
        await rebuildLogisticsProjection(result.run.serviceDate, by, sourceEvent.sequence);
        await rebuildLogisticsProjection(deferredTargetRun.serviceDate, by, targetEvent.sequence);
        return NextResponse.json({ ...result, affectedServiceDates: [result.run.serviceDate, deferredTargetRun.serviceDate], changeCursors: { [result.run.serviceDate]: sourceEvent.sequence, [deferredTargetRun.serviceDate]: targetEvent.sequence } });
      }
      await recordCanonicalLogisticsChange({ serviceDate: result.run.serviceDate, entityType: "stop", entityId: result.stop.canonicalId, changeType: body.action, revision: result.stop.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    if (body.action === "update-stop" && body.stop) {
      throw new HttpError(
        422,
        "Use an execution command to change stop status.",
      );
    }
    if (body.action === "reorder" && body.runId) {
      if (!Array.isArray(body.stopIds)) throw new HttpError(422, "Reorder requires an exact array of canonical stop IDs.");
      if (body.expectedRunVersion === undefined)
        throw new HttpError(
          422,
          "A current run version is required to reorder stops.",
        );
      const result = await runTracedTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const runSnap = await transaction.get(runRef);
        if (!runSnap.exists) throw new HttpError(404, "Run not found.");
        const run = runSnap.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion)
          throw new HttpError(
            409,
            "This run changed elsewhere. Refresh before reordering stops.",
          );
        assertPlanningOpen(run);
        const stopSnap = await transaction.get(
          stops().where("runId", "==", body.runId),
        );
        const byId = new Map(
          stopSnap.docs.map((doc) => [doc.id, normalizeStop(doc.data())]),
        );
        const submitted = body.stopIds!;
        const submittedSet = new Set(submitted);
        if (submitted.some(id => typeof id !== "string") || submittedSet.size !== submitted.length || submitted.length !== byId.size || [...byId.keys()].some(id => !submittedSet.has(id)))
          throw new HttpError(422, "Reorder must be an exact permutation of every current stop ID in this run.");
        const selected = submitted.map((id, index) => ({ ...byId.get(id)!, sequence: index + 1 }));
        const movementIds = [...new Set(selected.flatMap(stop => stop.movementRequestIds || (stop.movementRequestId ? [stop.movementRequestId] : [])))];
        const movementSnapshots = await Promise.all(movementIds.map(id => transaction.get(movements().doc(id))));
        if (movementSnapshots.some(snapshot => !snapshot.exists)) throw new HttpError(409, "A linked movement identity is unavailable; review run integrity before reordering.");
        const linkedMovements = movementSnapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as MovementRequest);
        const orderProblem = transferOrderProblem(selected, linkedMovements);
        if (orderProblem) throw new HttpError(orderProblem.includes("incomplete or ambiguous") ? 409 : 422, orderProblem);
        const ordered = selected;
        for (const stop of ordered)
          transaction.set(stops().doc(stop.canonicalId), stop);
        const next = {
          ...run,
          orderedStopIds: ordered.map((stop) => stop.canonicalId),
          version: run.version + 1,
          updatedAt: now,
          audit: [
            ...run.audit,
            {
              action: "stops-reordered",
              at: now,
              by,
              version: run.version + 1,
            },
          ],
        };
        transaction.set(runRef, next);
        return next;
      });
      await recordCanonicalLogisticsChange({ serviceDate: result.serviceDate, entityType: "run", entityId: result.canonicalId, changeType: "stops-reordered", revision: result.version, actorId, by, changedAt: now });
      return NextResponse.json(result);
    }
    throw new HttpError(400, "Unknown Logistics action.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : (error as { status?: number }).status || 400;
    return errorResponse(Object.assign(error instanceof Error ? error : new Error(messageOf(error)), { status }), request.headers.get("x-request-id") || undefined, diagnostic);
  }
}

/** Scoped snapshots replace raw change events: cursors are opaque freshness
 * tokens, containing no entity IDs. Every returned snapshot is scoped again.
 */
async function getScopedLogistics(request: NextRequest, principal: LogisticsPrincipal) {
  const query = request.nextUrl.searchParams;
  const vehicle = query.get("vehicle");
  const date = query.get("serviceDate") || operationalDate();
  if (!validOperationalDate(date)) throw new HttpError(400, "Invalid Logistics service date.");
  const read = async (serviceDate: string) => {
    const [raw, head] = await Promise.all([getLogisticsProjection(serviceDate), getLogisticsSyncHead(serviceDate)]);
    return raw ? { ...await scopeCanonicalProjection(raw, principal, vehicle), state: raw.lastChangeSequence < head.sequence ? "STALE" as const : raw.state } : undefined;
  };
  if (query.get("syncHead") === "1") return NextResponse.json(await getLogisticsSyncHead(date));
  if (query.has("changesSince")) {
    const cursor = Number(query.get("changesSince"));
    if (!query.get("changesSince") || !Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, "Invalid Logistics change cursor.");
    const head = await getLogisticsSyncHead(query.get("serviceDate") ? date : undefined);
    return NextResponse.json({ changes: [], hasMore: false, nextCursor: Math.max(cursor, head.sequence), projection: query.get("serviceDate") ? await read(date) : undefined });
  }
  if (query.get("weekSummary") === "1" || query.has("weekCommencing")) {
    const dates = operationalWeek(query.get("weekCommencing") || date);
    return NextResponse.json({ weekCommencing: dates[0], days: await Promise.all(dates.map(async day => summarizeLogisticsProjection(day, await read(day)))) });
  }
  if (query.get("planningAttention") === "1") {
    const days = Math.min(14, Math.max(1, Number(query.get("days")) || 14));
    const dates = Array.from({ length: days }, (_, index) => addOperationalDays(date, index));
    const attention = await Promise.all(dates.map(async day => { const summary = summarizeLogisticsProjection(day, await read(day)); return { serviceDate: day, count: "attention" in summary ? summary.attention || 0 : 0 }; }));
    return NextResponse.json({ attention: attention.filter(item => item.count > 0), fromDate: date, days });
  }
  const projection = await read(date);
  if (!projection) {
    const state = await classifyMissingProjection(date, request.headers.get("cookie") || undefined);
    if (state === "EMPTY") return NextResponse.json({ projection: null, state: "EMPTY", projectionState: "VALID_EMPTY", serviceDate: date });
    throw Object.assign(new HttpError(503, "Logistics projection has not been materialised."), { code: "LOGISTICS_PROJECTION_NOT_MATERIALIZED" });
  }
  return NextResponse.json({ ...projectionToDashboardData(projection), projection, serviceDate: date, state: "READY", projectionState: projection.state || "CURRENT" });
}

async function handleGet(request: NextRequest) {
  try {
    const principal = await requireLogisticsAccess(request);
    const diagnosticMode = request.nextUrl.searchParams.get("diagnostic") === "1";
    const permitted = diagnosticMode ? [] : vehicleScope(principal, request.nextUrl.searchParams.get("vehicle"));
    const requestedRun = request.nextUrl.searchParams.get("runId");
    if (requestedRun) {
      const run = await getRun(requestedRun);
      if (!run) throw new HttpError(404, "Logistics resource not found.");
      authorizeRun({ ...principal, permittedVehicleIds: permitted }, run);
      if (!request.nextUrl.searchParams.has("serviceDate")) request.nextUrl.searchParams.set("serviceDate", run.serviceDate);
    }
    if (diagnosticMode) assertMaintenanceAccess(principal, "logistics.repair");
    const scopedMode = !diagnosticMode && (permitted.length < 2 || request.nextUrl.searchParams.has("vehicle") || request.nextUrl.searchParams.has("changesSince") || request.nextUrl.searchParams.has("weekCommencing") || request.nextUrl.searchParams.get("weekSummary") === "1");
    const response = await (scopedMode ? getScopedLogistics(request, principal) : getLogistics(request, principal));
    response.headers.set("x-logistics-cache-scope", logisticsCacheScope(principal));
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    return errorResponse(error, request.headers.get("x-request-id") || undefined, {
      operation: request.nextUrl.searchParams.get("projection") === "1" ? "projection.read" : request.nextUrl.searchParams.get("syncHead") === "1" ? "sync-head.read" : "logistics.read",
      serviceDate: request.nextUrl.searchParams.get("serviceDate") || undefined,
      projectionSequence: Number(request.nextUrl.searchParams.get("changesSince")) || undefined,
    });
  }
}

export async function POST(request: NextRequest) { return withDataTrace({ app: "logistics", action: "logistics.request", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
export async function GET(request: NextRequest) { return withDataTrace({ app: "logistics", action: request.nextUrl.pathname.startsWith("/mobile") ? "logistics.mobile.day.load" : "logistics.day.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
