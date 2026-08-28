import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@hub/lib/api";
import { assertSameOrigin } from "@hub/lib/csrf";
import { db } from "@/lib/firebase";
import { requireLogisticsAccess } from "@/lib/auth";
import { hostedRuntime } from "@/lib/runtime";
import {
  fetchOplocs,
  fetchProductionContexts,
  fetchRequirements,
} from "@/lib/upstream";
import { buildPlannerDay } from "@/lib/planner-read-model";
import {
  listState,
  movements,
  runs,
  stops,
  normalizeStop,
  saveMovement,
  saveRun,
  collectionPreferences,
  listCollectionPreferenceKeys,
  saveCollectionPreference,
  listDeliveryLoadState,
  logisticsJobs,
  deliveryLoads,
  logisticsAssignments,
  saveLogisticsJob,
  appendLogisticsChange,
  getLogisticsProjection,
  listLogisticsChanges,
  saveLogisticsProjection,
  repairLegacyAssignmentServiceDates,
} from "@/lib/store";
import { assignJob, assertDispatchable, createLoad, removeAssignment, setJobCollectionStatus } from "@/lib/delivery-loads";
import { CPU_PRODUCTION_LOCATION_ID, CPU_SITE_OPLOC_ID } from "../../../../shared/production-location";
import { buildLogisticsDayProjection } from "@/lib/logistics-projection";
import {
  assignMovementStops,
  combineStop,
  orderedTransferStops,
  validateRequirementForPlanning,
  linkedCollectionForDelivery,
} from "@/lib/planning";
import { operationalDate } from "@/lib/date";
import { operationalWeek } from "@/lib/week";
import { restoredStopStatus } from "@/lib/mobile-driver";
import type { PlannerWeekSummary } from "@/lib/planner-read-model";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "@/lib/types";
import type { FulfilmentRequirement } from "../../../../shared/fulfilment-requirement";
import type { ProductionContext } from "@/lib/upstream";

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
  if (run.status !== "draft" && run.status !== "planned")
    throw new HttpError(
      422,
      `Run is ${run.status}; return it to planning before changing its structure.`,
    );
}
function addMinutesToTime(value: string, minutes: number) {
  const [hours, mins] = value.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, hours * 60 + mins + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function collectionScheduleForDelivery(delivery: DeliveryStop) {
  const deliveryStart = delivery.plannedWindow?.startTime || delivery.plannedArrivalTime;
  if (!deliveryStart) return {};
  return { plannedArrivalTime: addMinutesToTime(deliveryStart, 6 * 60) };
}
function loadTimesOverlap(start: string, end: string | undefined, otherStart: string, otherEnd: string | undefined) {
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const aStart = toMinutes(start);
  const aEnd = toMinutes(end || addMinutesToTime(start, 15));
  const bStart = toMinutes(otherStart);
  const bEnd = toMinutes(otherEnd || addMinutesToTime(otherStart, 15));
  return aStart < bEnd && bStart < aEnd;
}
function nextAvailableLoadTime(loads: import("@/lib/types").DeliveryLoad[], input: { loadId?: string; runId?: string; lane: "delivery" | "collection"; destinationOplocId: string; start: string; end?: string }) {
  let candidate = input.start;
  let changed = true;
  while (changed) {
    changed = false;
    const conflict = loads.find((load) => {
    if (load.id === input.loadId || load.status === "cancelled") return false;
    if (!input.runId) return false;
    const sameRun = input.lane === "collection" ? (load.collectionRunId || load.runId) === input.runId : load.runId === input.runId;
    if (!sameRun || (input.lane === "delivery" ? load.destinationOplocId : load.originOplocId) === input.destinationOplocId) return false;
    const otherStart = input.lane === "collection" ? load.collectionScheduledTime : load.scheduledTime;
    const otherEnd = input.lane === "collection" ? load.collectionScheduledEnd : load.scheduledEnd;
    return Boolean(otherStart && loadTimesOverlap(candidate, input.end, otherStart, otherEnd));
    });
    if (!conflict) continue;
    const conflictStart = input.lane === "collection" ? conflict.collectionScheduledTime! : conflict.scheduledTime;
    const conflictEnd = input.lane === "collection" ? conflict.collectionScheduledEnd : conflict.scheduledEnd;
    candidate = addMinutesToTime(conflictEnd || conflictStart, 15 - (conflictEnd ? 0 : 15));
    changed = true;
  }
  return candidate;
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
  if (start && end) {
    const toMinutes = (value: string) => {
      const [hour, minute] = value.split(":").map(Number);
      return hour * 60 + minute;
    };
    if (toMinutes(end) - toMinutes(start) < 15)
      throw new HttpError(422, "Planned window end must be at least 15 minutes after the start time.");
  }
  if ((time && time > "17:00") || (start && start > "17:00") || (end && end > "17:00")) throw new HttpError(422, "Planned timing must remain within the 06:00–17:00 dispatch view.");
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

function productionIsCancelled(production: ProductionContext) {
  return production.status === "cancelled" || production.workflowStatus === "cancelled";
}

function activeLogisticsRequirements(
  requirements: FulfilmentRequirement[],
  production: ProductionContext[],
) {
  const activeProduction = production.filter((item) => !productionIsCancelled(item));
  const currentProductionIds = new Set(production.map((item) => item.canonicalId));
  return requirements.filter((requirement) => {
    if (requirement.status === "withdrawn") return false;
    // FIKA Xchange is the CPU site: its own delivered-in/production demand is
    // fulfilled locally, so it must never appear as a delivery queue item.
    // Movement Requests are a separate collection and are intentionally not
    // filtered here, so CPU-to-site transfers remain plannable.
    if (requirement.destinationOplocId === CPU_SITE_OPLOC_ID) return false;
    if (requirement.sourceDomain !== "cpu-production") return true;
    if (currentProductionIds.has(requirement.sourceEntityId)) {
      const current = production.find((item) => item.canonicalId === requirement.sourceEntityId);
      return Boolean(current && !productionIsCancelled(current));
    }
    // A requirement with no current CPU order is a stale revision when CPU
    // still exposes another revision for the same booking. Do not show it as
    // assignable logistics work.
    return false;
  });
}

async function rebuildLogisticsProjection(serviceDate: string, actorId: string, lastChangeSequence?: number) {
  const [state, legacyState] = await Promise.all([listDeliveryLoadState(serviceDate), listState(serviceDate)]);
  return saveLogisticsProjection(buildLogisticsDayProjection({ serviceDate, ...state, runs: legacyState.runs, lastChangeSequence, now: new Date().toISOString(), revision: Date.now() }));
}

async function reconcileLogisticsDay(serviceDate: string, by: string, cookie?: string) {
  const requirements = await fetchRequirements(serviceDate, cookie);
  const production = await fetchProductionContexts(serviceDate, cookie);
  const oplocs = await fetchOplocs(cookie);
  const existingState = await listDeliveryLoadState(serviceDate);
  const existing = existingState.jobs;
  const assignedJobIds = new Set(existingState.assignments.map((assignment) => assignment.jobId));
  const activeRequirements = activeLogisticsRequirements(requirements.filter((item) => item.serviceDate === serviceDate), production);
  const hasNativeGrabAndGo = (requirement: FulfilmentRequirement) => activeRequirements.some((item) => item.sourceDomain === "grab-and-go" && item.serviceDate === requirement.serviceDate && item.destinationOplocId === requirement.destinationOplocId);
  const reconciledRequirements = activeRequirements.filter((requirement) => !(requirement.sourceDomain === "cpu-production" && requirement.sourceEntityId.includes("grab-and-go") && hasNativeGrabAndGo(requirement)));
  const existingBySource = new Map(existing.map((job) => [`${job.sourceType}:${job.sourceId}`, job]));
  let created = 0;
  let updated = 0;
  let lastChangeSequence = 0;
  const now = new Date().toISOString();
  for (const requirement of reconciledRequirements) {
    const key = `${requirement.sourceDomain}:${requirement.sourceEntityId}`;
    const prior = existingBySource.get(key);
    const readiness = requirement.status === "pending" ? "pending" as const : requirement.status === "amended" ? "attention" as const : "ready" as const;
    const originOplocId = requirement.productionLocationId || CPU_PRODUCTION_LOCATION_ID;
    const next = {
      id: prior?.id || `logistics-job:${requirement.canonicalId}`,
      sourceType: requirement.sourceDomain,
      sourceId: requirement.sourceEntityId,
      sourceVersion: requirement.sourceVersion,
      serviceDate: requirement.serviceDate,
      ...(originOplocId ? { originOplocId } : {}),
      destinationOplocId: requirement.destinationOplocId,
      destinationLabelSnapshot: oplocs.find((oploc) => oploc.id === requirement.destinationOplocId)?.label || requirement.destinationLabelSnapshot,
      ...(requirement.requiredDeliveryWindow ? { requestedWindow: requirement.requiredDeliveryWindow } : requirement.readyAt ? { requestedWindow: { startTime: requirement.readyAt.slice(11, 16) } } : {}),
      productionReadiness: readiness,
      collectionStatus: prior?.collectionStatus || "awaiting" as const,
      contents: requirement.lines.map((line) => ({ description: line.displayNameSnapshot, quantity: line.quantity, unit: line.unit })),
      createdAt: prior?.createdAt || now,
      updatedAt: now,
      version: (prior?.version || 0) + 1,
      audit: [...(prior?.audit || []), { action: prior ? "reconciled-job-updated" : "reconciled-job-created", at: now, by, version: (prior?.version || 0) + 1 }],
    } as import("@/lib/types").LogisticsJob;
    await saveLogisticsJob(next);
    const event = await appendLogisticsChange({ serviceDate: next.serviceDate, entityType: "logisticsJob", entityId: next.id, changeType: prior ? "reconciled-job-updated" : "reconciled-job-created", revision: next.version, changedAt: now, actorId: by });
    lastChangeSequence = Math.max(lastChangeSequence, event.sequence);
    if (prior) updated++; else created++;
  }
  for (const job of existing) {
    if (assignedJobIds.has(job.id) || reconciledRequirements.some((requirement) => requirement.sourceDomain === job.sourceType && requirement.sourceEntityId === job.sourceId)) continue;
    if (job.destinationOplocId === CPU_SITE_OPLOC_ID || job.sourceType === "cpu-production" || (job.sourceType === "grab-and-go" && hasNativeGrabAndGo({ sourceDomain: "grab-and-go", sourceEntityId: job.sourceId, serviceDate: job.serviceDate, destinationOplocId: job.destinationOplocId } as FulfilmentRequirement))) {
      await logisticsJobs().doc(job.id).delete();
      const event = await appendLogisticsChange({ serviceDate: job.serviceDate, entityType: "logisticsJob", entityId: job.id, changeType: "stale-upstream-job-removed", revision: job.version + 1, changedAt: now, actorId: by });
      lastChangeSequence = Math.max(lastChangeSequence, event.sequence);
    }
  }
  const projection = await rebuildLogisticsProjection(serviceDate, by, lastChangeSequence);
  return { created, updated, projection, requirements };
}

async function getLogistics(request: NextRequest) {
  const requestedRunId = request.nextUrl.searchParams.get("runId") || undefined;
  const requestedDate =
    request.nextUrl.searchParams.get("serviceDate") || undefined;
  const requestedWeek =
    request.nextUrl.searchParams.get("weekCommencing") || undefined;
  const cookie = request.headers.get("cookie") || undefined;
  if (request.nextUrl.searchParams.get("diagnostic") === "1") {
    const serviceDate = requestedDate || operationalDate();
    const [requirements, state, projection] = await Promise.all([fetchRequirements(serviceDate, cookie), listState(serviceDate), getLogisticsProjection(serviceDate)]);
    const legacy = buildPlannerDay({ serviceDate, requirements, runs: state.runs, stops: state.stops, movements: state.movements, oplocs: [], health: { fulfilment: { available: true }, oplocs: { available: true }, enrichment: { available: true } } });
    const comparison = { jobs: requirements.length, unassignedJobs: requirements.filter((requirement) => !state.stops.some((stop) => stop.requirementRefs.some((ref) => ref.requirementId === requirement.canonicalId))).length, deliveryLoads: legacy.summary.loads, collectedJobs: 0, projection: { jobs: projection ? projection.summary.queuedJobs + projection.summary.assignedJobs : 0, unassignedJobs: projection?.summary.queuedJobs || 0, deliveryLoads: projection?.summary.loads || 0, collectedJobs: projection?.summary.collectedJobs || 0 } };
    return NextResponse.json({ serviceDate, comparison, status: comparison.jobs === comparison.projection.jobs && comparison.unassignedJobs === comparison.projection.unassignedJobs && comparison.deliveryLoads === comparison.projection.deliveryLoads ? "In sync" : "Projection out of sync" });
  }
  if (request.nextUrl.searchParams.get("projection") === "1") {
    const serviceDate = requestedDate || operationalDate();
    const startedAt = performance.now();
    let projection = await getLogisticsProjection(serviceDate);
    const requirements = await fetchRequirements(serviceDate, cookie).catch(() => []);
    const production = await fetchProductionContexts(serviceDate, cookie).catch(() => []);
    const projectedSourceKeys = new Set([
      ...(projection?.planningQueue || []).map((job) => `${job.sourceType}:${job.sourceId}`),
      ...(projection?.deliveryLoads || []).flatMap((load) => load.jobs.map((job) => `${job.sourceType}:${job.sourceId}`)),
    ]);
    const activeRequirements = activeLogisticsRequirements(requirements, production);
    const hasNativeGrabAndGo = (requirement: typeof activeRequirements[number]) => activeRequirements.some((item) => item.sourceDomain === "grab-and-go" && item.serviceDate === requirement.serviceDate && item.destinationOplocId === requirement.destinationOplocId);
    const expectedSourceKeys = new Set(activeRequirements
      .filter((requirement) => !(requirement.sourceDomain === "cpu-production" && requirement.sourceEntityId.includes("grab-and-go") && hasNativeGrabAndGo(requirement)))
      .map((requirement) => `${requirement.sourceDomain}:${requirement.sourceEntityId}`));
    const projectionNeedsReconcile = !projection || projection.deliveryLoads.some((load) => load.jobs.length === 0) || projectedSourceKeys.size !== expectedSourceKeys.size || [...expectedSourceKeys].some((key) => !projectedSourceKeys.has(key));
    if (projectionNeedsReconcile) {
      if (activeRequirements.length) {
        projection = (await reconcileLogisticsDay(serviceDate, "read-reconcile", cookie)).projection;
      } else {
        projection = await rebuildLogisticsProjection(serviceDate, "read-rebuild");
      }
    }
    return NextResponse.json({ projection, metrics: { projectionFetchMs: Math.round(performance.now() - startedAt), dashboardReadyMs: Math.round(performance.now() - startedAt) } });
  }
  if (request.nextUrl.searchParams.has("changesSince")) {
    const after = Number(request.nextUrl.searchParams.get("changesSince") || 0);
    const startedAt = performance.now();
    const changes = await listLogisticsChanges(Number.isFinite(after) ? after : 0, requestedDate);
    const projection = requestedDate ? await getLogisticsProjection(requestedDate) : undefined;
    return NextResponse.json({ changes, projection, metrics: { incrementalUpdateMs: Math.round(performance.now() - startedAt) } });
  }
  if (requestedWeek) {
    const dates = operationalWeek(requestedWeek);
    const requirementsResult = await fetchRequirements(undefined, cookie).catch(
      () => [],
    );
    const productionByDate = await Promise.all(
      dates.map((serviceDate) => fetchProductionContexts(serviceDate, cookie).catch(() => [])),
    );
    const dayStates = await Promise.all(dates.map((serviceDate) => listState(serviceDate)));
    const summaries: PlannerWeekSummary[] = dates.map((serviceDate, index) => {
      const state = dayStates[index];
      const requirements = activeLogisticsRequirements(requirementsResult.filter(
        (requirement) => requirement.serviceDate === serviceDate,
      ), productionByDate[index]);
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
      };
    });
    return NextResponse.json({ weekCommencing: dates[0], days: summaries });
  }
  const runState = requestedRunId ? await listState() : undefined;
  const runDate = requestedRunId
    ? runState?.runs.find((run) => run.canonicalId === requestedRunId)?.serviceDate
    : undefined;
  const date = requestedDate || runDate || operationalDate();
  const [state, collectionRequiredKeys, requirementsResult, oplocsResult] = await Promise.all([
    listState(date),
    listCollectionPreferenceKeys(),
    fetchRequirements(date, cookie).then((value) => ({ status: "fulfilled" as const, value })).catch((reason) => ({ status: "rejected" as const, reason })),
    fetchOplocs(cookie).then((value) => ({ status: "fulfilled" as const, value })).catch((reason) => ({ status: "rejected" as const, reason })),
  ]);
  const loadState = await listDeliveryLoadState(date);
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
  const requirements = activeLogisticsRequirements(upstreamRequirements, production);
  const projection = await getLogisticsProjection(date);
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
    ...state,
    ...loadState,
    ...(projection ? { projection } : {}),
    requirements,
    oplocs,
    serviceDate: date,
    fetchedAt: new Date().toISOString(),
    health,
    planner: buildPlannerDay({
      serviceDate: date,
      requirements,
      runs: state.runs,
      stops: state.stops,
      movements: state.movements,
      oplocs,
      health,
      production,
      collectionRequiredKeys,
    }),
  });
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireLogisticsAccess(request);
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
      requirementIds?: string[];
      expectedSourceVersions?: Record<string, number>;
      expectedStopVersion?: number;
      issueDescription?: string;
      issueCategory?: "Cannot access building" | "Customer unavailable" | "Missing / incorrect load" | "Running late" | "Vehicle issue" | "Other" | "Access" | "Delay" | "Missing item" | "Vehicle";
      issueId?: string;
      resolutionNotes?: string;
      groupKey?: string;
      collectionRequired?: boolean;
      vehicleSlot?: "van-1" | "van-2";
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
      lane?: "delivery" | "collection";
      collectionStatus?: "awaiting" | "collected";
    };
    const by = principal.displayName;
    const now = new Date().toISOString();
    // The mobile view can receive projection-backed stops from the same
    // logistics timeline as desktop. Resolve those display IDs to their
    // canonical delivery load instead of sending them through the legacy
    // run/stop execution branch.
    if (body.stopId?.startsWith("projection-stop:") && ["mark-stop-loaded", "mark-subload-loaded", "mark-subload-delivered", "complete-stop", "undo-completion"].includes(body.action)) {
      const projectionStopParts = body.stopId.split(":");
      const loadId = projectionStopParts.length >= 3 ? projectionStopParts.slice(2).join(":") : body.stopId.slice("projection-stop:".length);
      const result = await db.runTransaction(async (transaction) => {
        const loadRef = deliveryLoads().doc(loadId);
        const loadSnap = await transaction.get(loadRef);
        if (!loadSnap.exists) throw new HttpError(404, "Delivery load not found.");
        const load = loadSnap.data() as import("@/lib/types").DeliveryLoad;
        const loaded = body.action === "mark-stop-loaded" || body.action === "mark-subload-loaded" ? body.loaded !== false : load.loaded;
        const status = body.action === "complete-stop" || body.action === "mark-subload-delivered" ? "delivered" as const : body.action === "undo-completion" ? "planned" as const : load.status;
        const nextVersion = load.version + 1;
        const next = { ...load, loaded, status, ...(status === "delivered" ? { deliveredAt: now } : { deliveredAt: undefined }), updatedAt: now, version: nextVersion, audit: [...load.audit, { action: body.action, at: now, by, version: nextVersion }] };
        transaction.set(loadRef, next);
        return next;
      });
      const event = await appendLogisticsChange({ serviceDate: result.serviceDate, entityType: "deliveryLoad", entityId: result.id, changeType: body.action, revision: result.version, changedAt: now, actorId: by });
      await rebuildLogisticsProjection(result.serviceDate, by, event.sequence);
      return NextResponse.json({ load: result });
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
      const result = await reconcileLogisticsDay(body.serviceDate, by, request.headers.get("cookie") || undefined);
      return NextResponse.json({ ...result, warning: result.requirements.some((item) => !item.productionLocationId) ? "Some jobs have no canonical origin OPLOC and remain safely unassigned." : undefined });
    }
    if (body.action === "save-logistics-job" && body.job) {
      if (!body.job.originOplocId || !body.job.destinationOplocId)
        throw new HttpError(422, "Logistics jobs require canonical origin and destination OPLOC IDs.");
      const saved = await saveLogisticsJob(body.job);
      const event = await appendLogisticsChange({ serviceDate: saved.serviceDate, entityType: "logisticsJob", entityId: saved.id, changeType: "job-created-or-updated", revision: saved.version, changedAt: now, actorId: by });
      await rebuildLogisticsProjection(saved.serviceDate, by, event.sequence);
      return NextResponse.json(saved);
    }
    if (body.action === "assign-job-to-load" && (body.job || body.jobId)) {
      if (body.lane === "collection") throw new HttpError(422, "Choose the delivery timeline first; collection is scheduled from the linked collection card.");
      const job = body.job || (await listDeliveryLoadState()).jobs.find((item) => item.id === body.jobId);
      if (!job) throw new HttpError(404, "Logistics job not found.");
      let scheduledTime = body.scheduledTime || job.requestedWindow?.startTime;
      const originOplocId = job.originOplocId || CPU_PRODUCTION_LOCATION_ID;
      if (!originOplocId || !job.destinationOplocId || !scheduledTime)
        throw new HttpError(422, "Job cannot be assigned without canonical OPLOC IDs and a scheduled time; it remains unassigned.");
      if (body.targetRunId) {
        const targetRuns = (await listState(job.serviceDate)).runs;
        if (!targetRuns.some((run) => run.canonicalId === body.targetRunId))
          throw new HttpError(422, "The selected vehicle run is no longer available. Refresh Logistics and try again.");
      }
      const destinationOplocId = job.destinationOplocId;
      const existingLoads = (await listDeliveryLoadState(job.serviceDate)).loads;
      const requestedEnd = body.scheduledEnd || job.requestedWindow?.endTime;
      const requestedDuration = requestedEnd ? Math.max(15, Number(requestedEnd.slice(0, 2)) * 60 + Number(requestedEnd.slice(3, 5)) - (Number(scheduledTime.slice(0, 2)) * 60 + Number(scheduledTime.slice(3, 5)))) : undefined;
      scheduledTime = nextAvailableLoadTime(existingLoads, { runId: body.targetRunId, lane: "delivery", destinationOplocId, start: scheduledTime, end: requestedEnd });
      const scheduledEnd = requestedDuration === undefined ? undefined : addMinutesToTime(scheduledTime, requestedDuration);
      const result = await db.runTransaction(async (transaction) => {
        const loadId = `load:${job.serviceDate}:${originOplocId}:${destinationOplocId}:${scheduledTime}`;
        const loadRef = deliveryLoads().doc(loadId);
        const jobRef = logisticsJobs().doc(job.id);
        const assignmentQuery = logisticsAssignments().where("jobId", "==", job.id).where("serviceDate", "==", job.serviceDate);
        const [loadSnap, assignmentSnap] = await Promise.all([transaction.get(loadRef), transaction.get(assignmentQuery)]);
        const load = loadSnap.exists ? loadSnap.data() as import("@/lib/types").DeliveryLoad : { ...createLoad({ serviceDate: job.serviceDate, originOplocId, destinationOplocId, scheduledTime, ...(scheduledEnd ? { scheduledEnd } : {}), destinationLabelSnapshot: job.destinationLabelSnapshot, by, now }), ...(body.targetRunId ? { runId: body.targetRunId } : {}) };
        const existing = assignmentSnap.docs.map((doc) => doc.data() as import("@/lib/types").LogisticsAssignment);
        const next = assignJob({ ...job, originOplocId, requestedWindow: { ...(job.requestedWindow || {}), startTime: scheduledTime } }, load, existing, by, now);
        const priorLoadRefs = existing.filter((item) => item.loadId !== load.id).map((item) => deliveryLoads().doc(item.loadId));
        const priorLoadSnaps = await Promise.all(priorLoadRefs.map((ref) => transaction.get(ref)));
        transaction.set(jobRef, { ...job, originOplocId, requestedWindow: { ...(job.requestedWindow || {}), startTime: scheduledTime, ...(scheduledEnd ? { endTime: scheduledEnd } : {}) }, updatedAt: now });
        for (const prior of existing.filter((item) => item.loadId !== load.id)) transaction.delete(logisticsAssignments().doc(`${prior.jobId}:${prior.loadId}`));
        transaction.set(logisticsAssignments().doc(`${job.id}:${load.id}`), next.assignment);
        const nextLoad = { ...next.load, ...(body.collectionRequired ? { collectionRequired: true } : {}), ...(body.targetRunId ? { runId: body.targetRunId } : {}) };
        transaction.set(loadRef, nextLoad);
        for (const [index, prior] of existing.filter((item) => item.loadId !== load.id).entries()) {
          const priorSnap = priorLoadSnaps[index];
          if (priorSnap.exists) {
            const priorLoad = priorSnap.data() as import("@/lib/types").DeliveryLoad;
            transaction.update(priorLoadRefs[index], { updatedAt: now, version: priorLoad.version + 1, audit: [...priorLoad.audit, { action: "job-moved-out", at: now, by, version: priorLoad.version + 1 }] });
          }
        }
        return nextLoad;
      });
      const event = await appendLogisticsChange({ serviceDate: job.serviceDate, entityType: "assignment", entityId: job.id, relatedEntityId: result.id, changeType: "job-assigned", revision: result.version, changedAt: now, actorId: by });
      await rebuildLogisticsProjection(job.serviceDate, by, event.sequence);
      return NextResponse.json(result);
    }
    if (body.action === "reschedule-delivery-load" && body.loadId && body.scheduledTime) {
      validatePlannedSchedule(undefined, { startTime: body.scheduledTime, ...(body.scheduledEnd ? { endTime: body.scheduledEnd } : {}) });
      const currentLoads = (await listDeliveryLoadState()).loads;
      const currentLoad = currentLoads.find((load) => load.id === body.loadId);
      const requestedDuration = body.scheduledEnd ? Math.max(15, Number(body.scheduledEnd.slice(0, 2)) * 60 + Number(body.scheduledEnd.slice(3, 5)) - (Number(body.scheduledTime.slice(0, 2)) * 60 + Number(body.scheduledTime.slice(3, 5)))) : undefined;
      const effectiveScheduledTime = currentLoad ? nextAvailableLoadTime(currentLoads, { loadId: currentLoad.id, runId: body.targetRunId || (body.lane === "collection" ? currentLoad.collectionRunId || currentLoad.runId : currentLoad.runId), lane: body.lane === "collection" ? "collection" : "delivery", destinationOplocId: body.lane === "collection" ? currentLoad.originOplocId : currentLoad.destinationOplocId, start: body.scheduledTime, end: body.scheduledEnd }) : body.scheduledTime;
      const effectiveScheduledEnd = requestedDuration === undefined ? undefined : addMinutesToTime(effectiveScheduledTime, requestedDuration);
      const result = await db.runTransaction(async (transaction) => {
        const loadRef = deliveryLoads().doc(body.loadId!);
        const loadSnap = await transaction.get(loadRef);
        if (!loadSnap.exists) throw new HttpError(404, "Delivery load not found.");
        const load = loadSnap.data() as import("@/lib/types").DeliveryLoad;
        const nextVersion = load.version + 1;
        const collection = body.lane === "collection";
        transaction.update(loadRef, {
          ...(collection ? { collectionScheduledTime: effectiveScheduledTime, ...(effectiveScheduledEnd ? { collectionScheduledEnd: effectiveScheduledEnd } : {}), ...(body.targetRunId ? { collectionRunId: body.targetRunId } : {}) } : { scheduledTime: effectiveScheduledTime, ...(effectiveScheduledEnd ? { scheduledEnd: effectiveScheduledEnd } : {}), ...(body.targetRunId ? { runId: body.targetRunId } : {}) }),
          updatedAt: now,
          version: nextVersion,
          audit: [...load.audit, { action: collection ? "collection-rescheduled" : "load-rescheduled", at: now, by, version: nextVersion }],
        });
        return { ...load, ...(collection ? { collectionScheduledTime: effectiveScheduledTime, ...(effectiveScheduledEnd ? { collectionScheduledEnd: effectiveScheduledEnd } : {}), ...(body.targetRunId ? { collectionRunId: body.targetRunId } : {}) } : { scheduledTime: effectiveScheduledTime, ...(effectiveScheduledEnd ? { scheduledEnd: effectiveScheduledEnd } : {}), ...(body.targetRunId ? { runId: body.targetRunId } : {}) }), updatedAt: now, version: nextVersion };
      });
      const event = await appendLogisticsChange({
        serviceDate: result.serviceDate,
        entityType: "deliveryLoad",
        entityId: result.id,
        changeType: "load-rescheduled",
        revision: result.version,
        changedAt: now,
        actorId: by,
      });
      await rebuildLogisticsProjection(result.serviceDate, by, event.sequence);
      return NextResponse.json(body.targetRunId ? { ...result, runId: body.targetRunId } : result);
    }
    if (body.action === "mark-delivery-load-loaded" && body.loadId) {
      const result = await db.runTransaction(async (transaction) => {
        const loadRef = deliveryLoads().doc(body.loadId!);
        const loadSnap = await transaction.get(loadRef);
        if (!loadSnap.exists) throw new HttpError(404, "Delivery load not found.");
        const load = loadSnap.data() as import("@/lib/types").DeliveryLoad;
        const nextVersion = load.version + 1;
        const loaded = body.loaded !== false;
        transaction.update(loadRef, {
          loaded,
          updatedAt: now,
          version: nextVersion,
          audit: [...load.audit, { action: loaded ? "load-marked-loaded" : "load-marked-unloaded", at: now, by, version: nextVersion }],
        });
        return { ...load, loaded, updatedAt: now, version: nextVersion };
      });
      const event = await appendLogisticsChange({ serviceDate: result.serviceDate, entityType: "deliveryLoad", entityId: result.id, changeType: result.loaded ? "load-marked-loaded" : "load-marked-unloaded", revision: result.version, changedAt: now, actorId: by });
      await rebuildLogisticsProjection(result.serviceDate, by, event.sequence);
      return NextResponse.json(result);
    }
    if (body.action === "remove-job-from-load" && body.jobId) {
      const result = await db.runTransaction(async (transaction) => {
        const assignmentSnap = await transaction.get(logisticsAssignments().where("jobId", "==", body.jobId));
        if (!assignmentSnap.docs.length) throw new HttpError(404, "Job is not assigned to a delivery load.");
        const assignment = assignmentSnap.docs[0].data() as import("@/lib/types").LogisticsAssignment;
        const loadRef = deliveryLoads().doc(assignment.loadId);
        const [loadSnap, loadAssignments] = await Promise.all([transaction.get(loadRef), transaction.get(logisticsAssignments().where("loadId", "==", assignment.loadId))]);
        transaction.delete(logisticsAssignments().doc(`${assignment.jobId}:${assignment.loadId}`));
        if (loadSnap.exists && loadAssignments.docs.length <= 1) transaction.delete(loadRef);
        else if (loadSnap.exists) {
          const load = loadSnap.data() as import("@/lib/types").DeliveryLoad;
          transaction.update(loadRef, { updatedAt: now, version: load.version + 1, audit: [...load.audit, { action: "job-removed", at: now, by, version: load.version + 1 }] });
        }
        return removeAssignment([assignment], body.jobId!, by, now).removed;
      });
      if (result) {
        const event = await appendLogisticsChange({ serviceDate: result.serviceDate, entityType: "assignment", entityId: result.jobId, relatedEntityId: result.loadId, changeType: "job-removed", revision: 1, changedAt: now, actorId: by });
        const jobState = await listDeliveryLoadState();
        await rebuildLogisticsProjection(jobState.jobs.find((job) => job.id === result.jobId)?.serviceDate || operationalDate(), by, event.sequence);
      }
      return NextResponse.json(result);
    }
    if (body.action === "set-job-collection" && (body.job || body.jobId) && body.collectionStatus) {
      const job = body.job || (await listDeliveryLoadState()).jobs.find((item) => item.id === body.jobId);
      if (!job) throw new HttpError(404, "Logistics job not found.");
      const nextJob = await saveLogisticsJob(setJobCollectionStatus(job, body.collectionStatus, by, now));
      const event = await appendLogisticsChange({ serviceDate: nextJob.serviceDate, entityType: "logisticsJob", entityId: nextJob.id, changeType: "collection-status-changed", revision: nextJob.version, changedAt: now, actorId: by });
      await rebuildLogisticsProjection(nextJob.serviceDate, by, event.sequence);
      return NextResponse.json(nextJob);
    }
    if (body.action === "dispatch-delivery-load" && body.loadId) {
      const result = await db.runTransaction(async (transaction) => {
        const loadRef = deliveryLoads().doc(body.loadId!);
        const loadSnap = await transaction.get(loadRef);
        if (!loadSnap.exists) throw new HttpError(404, "Delivery load not found.");
        const load = loadSnap.data() as import("@/lib/types").DeliveryLoad;
        const [jobsSnap, assignmentsSnap] = await Promise.all([transaction.get(logisticsJobs().where("serviceDate", "==", load.serviceDate)), transaction.get(logisticsAssignments().where("loadId", "==", load.id))]);
        const jobs = jobsSnap.docs.map((doc) => doc.data() as import("@/lib/types").LogisticsJob);
        const assignments = assignmentsSnap.docs.map((doc) => doc.data() as import("@/lib/types").LogisticsAssignment);
        if (load.collectionRequired && !load.collectionScheduledTime) throw new HttpError(422, "Collection timing is required before this delivery can be dispatched.");
        try { assertDispatchable(load, jobs, assignments); } catch (error) { throw new HttpError(422, error instanceof Error ? error.message : "Load is not ready to dispatch."); }
        const next = { ...load, status: "dispatched" as const, dispatchedAt: now, updatedAt: now, version: load.version + 1, audit: [...load.audit, { action: "load-dispatched", at: now, by, version: load.version + 1 }] };
        transaction.set(loadRef, next);
        return next;
      });
      const event = await appendLogisticsChange({ serviceDate: result.serviceDate, entityType: "deliveryLoad", entityId: result.id, changeType: "load-dispatched", revision: result.version, changedAt: now, actorId: by });
      await rebuildLogisticsProjection(result.serviceDate, by, event.sequence);
      return NextResponse.json(result);
    }
    if (body.action === "set-collection-required" && body.groupKey && typeof body.collectionRequired === "boolean") {
      return NextResponse.json(await saveCollectionPreference(body.groupKey, body.collectionRequired, by, now));
    }
    if (body.action === "ensure-vehicle-day-runs") {
      const serviceDate = body.serviceDate || operationalDate();
      const existing = (await listState(serviceDate)).runs;
      const slots = [{ slot: "van-1", driver: "Franco" }, { slot: "van-2", driver: "Dee" }] as const;
      const result: DeliveryRun[] = [];
      for (const [index, item] of slots.entries()) {
        const vehicleLabel = item.slot === "van-1" ? "Van 1" : "Van 2";
        const current = existing.find((run) => run.vehicleLabel === vehicleLabel) || existing[index];
        if (current) {
          if (current.vehicleLabel !== vehicleLabel) {
            const normalized = { ...current, vehicleLabel, updatedAt: now, audit: [...current.audit, { action: "vehicle-day-labeled", at: now, by, version: current.version }] };
            await saveRun(normalized);
            result.push(normalized);
          } else result.push(current);
          continue;
        }
        const run: DeliveryRun = {
          canonicalId: `run:${serviceDate}:${item.slot}`,
          serviceDate,
          status: "draft",
          driverId: item.driver.toLowerCase(),
          driverLabel: item.driver,
          vehicleLabel: item.slot === "van-1" ? "Van 1" : "Van 2",
          returnToCpuRequired: true,
          orderedStopIds: [], version: 1, createdAt: now, updatedAt: now,
          audit: [{ action: "vehicle-day-run-created", at: now, by, version: 1 }],
        };
        await saveRun(run);
        result.push(run);
      }
      return NextResponse.json({ runs: result });
    }
    if (body.action === "set-run-driver" && body.runId && body.driverLabel) {
      const current = (await listState()).runs.find((run) => run.canonicalId === body.runId);
      if (!current) throw new HttpError(404, "Run not found.");
      if (body.expectedRunVersion === undefined) throw new HttpError(422, "A current run version is required.");
      const result = await db.runTransaction(async (transaction) => {
        const ref = runs().doc(current.canonicalId);
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new HttpError(404, "Run not found.");
        const run = snap.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion) throw new HttpError(409, "This run changed elsewhere. Refresh before changing its driver.");
        const next = { ...run, driverId: body.driverLabel!.toLowerCase(), driverLabel: body.driverLabel, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "driver-assigned", at: now, by, version: run.version + 1 }] };
        transaction.set(ref, next);
        return next;
      });
      return NextResponse.json(result);
    }
    if (body.action === "set-run-return-required" && body.runId && typeof body.returnToCpuRequired === "boolean") {
      const current = (await listState()).runs.find((run) => run.canonicalId === body.runId);
      if (!current) throw new HttpError(404, "Run not found.");
      if (body.expectedRunVersion === undefined) throw new HttpError(422, "A current run version is required.");
      if (current.status === "dispatched" || current.status === "completed") throw new HttpError(422, "Return settings cannot change after dispatch.");
      const result = await db.runTransaction(async (transaction) => {
        const ref = runs().doc(current.canonicalId);
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new HttpError(404, "Run not found.");
        const run = snap.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion) throw new HttpError(409, "This run changed elsewhere. Refresh before changing its return setting.");
        const next = { ...run, returnToCpuRequired: body.returnToCpuRequired, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "run-return-setting-changed", at: now, by, version: run.version + 1 }] };
        transaction.set(ref, next);
        return next;
      });
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
      return NextResponse.json({ serviceDate: body.serviceDate, resetRuns: state.runs.length, resetStops: state.stops.length, resetMovements: state.movements.length });
    }
    if (body.action === "create-run") {
      const run: DeliveryRun = body.run || {
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
      return NextResponse.json(
        await saveRun({
          ...run,
          returnToCpuRequired: run.returnToCpuRequired !== false,
          createdAt: run.createdAt || now,
          updatedAt: now,
          audit: [
            ...(run.audit || []),
            { action: "run-created", at: now, by, version: run.version || 1 },
          ],
        }),
      );
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
      const current = (await listState()).runs.find(
        (run) => run.canonicalId === body.runId,
      );
      if (!current) throw new HttpError(404, "Run not found.");
      if (body.expectedRunVersion === undefined)
        throw new HttpError(
          422,
          "A current run version is required for lifecycle changes.",
        );
      if (body.action === "confirm-returned-to-cpu") {
        if (current.status !== "dispatched" || current.returnToCpuRequired === false || !current.returnToCpuPending)
          throw new HttpError(422, "This run is not ready to confirm as returned to CPU.");
        const state = await listState(current.serviceDate);
        if (state.stops.filter((stop) => stop.runId === current.canonicalId).some((stop) => stop.status !== "completed" || (stop.issues || []).some((issue) => issue.status === "open")))
          throw new HttpError(422, "All deliveries and required collections must be complete first.");
      } else if (body.action === "mark-run-ready" || (body.action === "dispatch-run" && current.status === "planned")) {
        let requirements: FulfilmentRequirement[];
        try {
          requirements = await fetchRequirements(
            current.serviceDate,
            request.headers.get("cookie") || undefined,
          );
        } catch (error) {
          throw new HttpError(
            503,
            `Fulfilment work could not be verified: ${messageOf(error)}`,
          );
        }
        const state = await listState(current.serviceDate);
        const blockers: string[] = [];
        if (!current.driverLabel) blockers.push("No driver assigned");
        if (!current.orderedStopIds.length) blockers.push("No stops");
        for (const stop of state.stops.filter(
          (item) => item.runId === current.canonicalId,
        )) {
          if ((stop.issues || []).some((issue) => issue.status === "open"))
            blockers.push(`Open issue at ${stop.locationLabelSnapshot}`);
          for (const ref of stop.requirementRefs) {
            const requirement = requirements.find(
              (item) => item.canonicalId === ref.requirementId,
            );
            if (!requirement)
              blockers.push(`Missing requirement ${ref.requirementId}`);
            else if (requirement.status === "withdrawn")
              blockers.push(`Withdrawn work at ${stop.locationLabelSnapshot}`);
            else if (requirement.sourceVersion !== ref.sourceVersion)
              blockers.push(
                `Newer source version at ${stop.locationLabelSnapshot}`,
              );
          }
        }
        if (blockers.length)
          return NextResponse.json(
            { error: "Run is not ready", blockers },
            { status: 422 },
          );
        if (body.action === "mark-run-ready") assertTransition(current.status, "ready");
      } else if (body.action === "return-run-to-planning")
        assertTransition(current.status, "planned");
      else if (body.action === "dispatch-run") {
        const state = await listState(current.serviceDate);
        const deliveryStops = state.stops.filter(
          (stop) => stop.runId === current.canonicalId && stop.linkedOperation !== "collection" && stop.movementType !== "collection",
        );
        if (deliveryStops.some((stop) => !stop.loaded))
          throw new HttpError(422, "Every delivery must be marked loaded before dispatch.");
        const outstandingCollection = deliveryStops.find((delivery) => {
          if (!delivery.collectionRequired || !delivery.linkedStopId) return false;
          const collection = state.stops.find((stop) => stop.canonicalId === delivery.linkedStopId);
          return !collection || !collection.plannedArrivalTime && !collection.plannedWindow?.startTime;
        });
        if (outstandingCollection)
          throw new HttpError(422, `Collection timing is required for ${outstandingCollection.locationLabelSnapshot} before dispatch.`);
        assertTransition(current.status, "dispatched");
      }
      else {
        const state = await listState(current.serviceDate);
        if (
          body.action === "complete-run" &&
          current.returnToCpuRequired !== false &&
          !current.returnedToCpuAt
        )
          throw new HttpError(422, "Confirm the return to CPU before completing this run.");
        if (
          state.stops
            .filter((stop) => stop.runId === current.canonicalId)
            .some((stop) => stop.status !== "completed")
        )
          throw new HttpError(
            422,
            "Run cannot complete while stops remain outstanding.",
          );
        assertTransition(current.status, "completed");
      }
      const nextStatus =
        body.action === "mark-run-ready"
          ? "ready"
          : body.action === "return-run-to-planning"
            ? "planned"
          : body.action === "dispatch-run"
              ? "dispatched"
              : "completed";
      const result = await db.runTransaction(async (transaction) => {
        const ref = runs().doc(current.canonicalId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new HttpError(404, "Run not found.");
        const run = snapshot.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion)
          throw new HttpError(
            409,
            "This run changed elsewhere. Refresh before changing its lifecycle.",
          );
        assertTransition(run.status, nextStatus);
        const next = {
          ...run,
          status: nextStatus as DeliveryRun["status"],
          ...(body.action === "confirm-returned-to-cpu" ? { returnToCpuPending: false, returnedToCpuAt: now, returnedToCpuBy: by } : {}),
          version: run.version + 1,
          updatedAt: now,
          audit: [
            ...run.audit,
            {
              action: `run-${body.action}`,
              at: now,
              by,
              version: run.version + 1,
            },
          ],
        };
        transaction.set(ref, next);
        return next;
      });
      return NextResponse.json(result);
    }
    if (body.action === "save-movement" && body.movement) {
      const oplocs = await fetchOplocs(
        request.headers.get("cookie") || undefined,
      );
      for (const id of [
        body.movement.fromOplocId,
        body.movement.toOplocId,
      ].filter(Boolean) as string[])
        labelFor(oplocs, id);
      return NextResponse.json(await saveMovement(body.movement));
    }
    if (body.action === "update-run" && body.run) {
      const current = (await listState()).runs.find(
        (item) => item.canonicalId === body.run!.canonicalId,
      );
      if (!current) throw new HttpError(404, "Run not found.");
      if (
        body.expectedRunVersion !== undefined &&
        current.version !== body.expectedRunVersion
      )
        throw new HttpError(
          409,
          "This run changed elsewhere. Refresh before updating it.",
        );
      return NextResponse.json(
        await saveRun({
          ...current,
          driverId: body.run.driverId,
          driverLabel: body.run.driverLabel,
          vehicleLabel: body.run.vehicleLabel,
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
        }),
      );
    }
    if (
      body.action === "assign-group" &&
      body.runId &&
      Array.isArray(body.requirementIds)
    ) {
      if (!body.requirementIds.length || !body.expectedSourceVersions)
        throw new HttpError(
          422,
          "Select at least one requirement with its current source versions.",
        );
      const state = await listState();
      const target = state.runs.find((run) => run.canonicalId === body.runId);
      if (!target) throw new HttpError(404, "Run not found.");
      assertPlanningOpen(target);
      if (body.expectedRunVersion === undefined)
        throw new HttpError(
          422,
          "A current run version is required to assign work.",
        );
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
      const requested = body.requirementIds.map((id) =>
        requirements.find((requirement) => requirement.canonicalId === id),
      );
      if (requested.some((requirement) => !requirement))
        throw new HttpError(
          404,
          "One or more fulfilment requirements no longer exist upstream.",
        );
      const currentRequirements = requested as FulfilmentRequirement[];
      for (const requirement of currentRequirements) {
        if (
          requirement.sourceVersion !==
          body.expectedSourceVersions[requirement.canonicalId]
        )
          throw new HttpError(
            409,
            "The planner group changed upstream. Refresh and review before assigning it.",
          );
        if (requirement.serviceDate !== target.serviceDate)
          throw new HttpError(
            422,
            "A selected requirement belongs to a different service date.",
          );
      }
      const eligible = currentRequirements.filter((requirement) => {
        try {
          validateRequirementForPlanning(
            requirement,
            body.expectedSourceVersions![requirement.canonicalId],
          );
          return true;
        } catch {
          return false;
        }
      });
      const skipped = currentRequirements
        .filter(
          (requirement) =>
            !eligible.some(
              (item) => item.canonicalId === requirement.canonicalId,
            ),
        )
        .map((requirement) => ({
          requirementId: requirement.canonicalId,
          status: requirement.status,
        }));
      if (!eligible.length)
        throw new HttpError(
          422,
          "None of the selected requirements are currently plannable.",
        );
      const planned = body.plannedArrivalTime !== undefined || body.plannedWindow !== undefined
        ? validatePlannedSchedule(body.plannedArrivalTime, body.plannedWindow)
        : undefined;
      const result = await db.runTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const runSnap = await transaction.get(runRef);
        if (!runSnap.exists) throw new HttpError(404, "Run not found.");
        const run = runSnap.data() as DeliveryRun;
        assertPlanningOpen(run);
        if (run.version !== body.expectedRunVersion)
          throw new HttpError(
            409,
            "This run changed elsewhere. Refresh before assigning the group.",
          );
        const stopSnap = await transaction.get(
          stops().where("runId", "==", body.runId),
        );
        let working = stopSnap.docs.map((doc) => normalizeStop(doc.data()));
        for (const requirement of eligible) {
          const next = combineStop(working, {
            locationOplocId: requirement.destinationOplocId,
            locationLabel: requirement.destinationLabelSnapshot,
            requirement,
            runId: run.canonicalId,
            by,
          });
          working = [
            ...working.filter((stop) => stop.canonicalId !== next.canonicalId),
            next,
          ];
        }
        const preferenceKey = `${run.serviceDate}:${eligible[0].destinationOplocId}:${eligible[0].requiredDeliveryWindow ? `${eligible[0].requiredDeliveryWindow.startTime}-${eligible[0].requiredDeliveryWindow.endTime || ""}` : "unscheduled"}`;
        const preference = await transaction.get(collectionPreferences().doc(encodeURIComponent(preferenceKey)));
        const collectionRequired = body.collectionRequired === true || (body.collectionRequired !== false && preference.exists && preference.data()?.collectionRequired);
        if (collectionRequired) {
          const delivery = working.find((stop) => eligible.some((item) => stop.requirementRefs.some((ref) => ref.requirementId === item.canonicalId)) && stop.linkedOperation !== "collection");
          if (delivery && !working.some((stop) => stop.linkedStopId === delivery.canonicalId && stop.linkedOperation === "collection")) {
            const collection = linkedCollectionForDelivery(delivery, run.canonicalId, by, now);
            const markedDelivery = { ...delivery, collectionRequired: true, linkedStopId: collection.canonicalId, linkedOperation: "delivery" as const, originatingLoadKey: delivery.canonicalId, updatedAt: now, version: delivery.version + 1, audit: [...delivery.audit, { action: "collection-required", at: now, by, version: delivery.version + 1 }] };
            working = working.map((stop) => stop.canonicalId === delivery.canonicalId ? markedDelivery : stop);
            working.push({
              ...collection,
              linkedStopId: markedDelivery.canonicalId,
              ...collectionScheduleForDelivery({ ...markedDelivery, ...(planned || {}) }),
            });
          }
        }
        if (planned) {
          const eligibleIds = new Set(eligible.map((item) => item.canonicalId));
          working = working.map((stop) => stop.requirementRefs.some((ref) => eligibleIds.has(ref.requirementId))
            ? { ...stop, ...planned, version: stop.version + 1, updatedAt: now, audit: [...stop.audit, { action: "stop-scheduled", at: now, by, version: stop.version + 1 }] }
            : stop);
        }
        const ordered = orderedTransferStops(working);
        for (const stop of ordered)
          transaction.set(stops().doc(stop.canonicalId), stop);
        const nextRun = runPayload(run, ordered, now, by);
        transaction.set(runRef, nextRun);
        return {
          run: nextRun,
          assigned: eligible.map((requirement) => requirement.canonicalId),
          skipped,
        };
      });
      return NextResponse.json(result);
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
      const result = await db.runTransaction(async (transaction) => {
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
      return NextResponse.json(result);
    }
    if (body.action === "unassign-movement" && body.runId && body.movementId) {
      if (body.expectedRunVersion === undefined)
        throw new HttpError(422, "A current run version is required.");
      const result = await db.runTransaction(async (transaction) => {
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
      return NextResponse.json(result);
    }
    if (body.action === "return-stop-to-planning" && body.runId && body.stopId) {
      if (body.expectedRunVersion === undefined || body.expectedStopVersion === undefined)
        throw new HttpError(422, "Current run and stop versions are required.");
      const result = await db.runTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const targetRef = stops().doc(body.stopId!);
        const [runSnap, targetSnap, stopSnap, allRunSnap] = await Promise.all([
          transaction.get(runRef),
          transaction.get(targetRef),
          transaction.get(stops()),
          transaction.get(runs()),
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

        const scoped = stopSnap.docs.map((doc) => normalizeStop(doc.data()));
        const allRuns = allRunSnap.docs.map((doc) => doc.data() as DeliveryRun);
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
      const result = await db.runTransaction(async (transaction) => {
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
        if (stop.movementType === "transfer")
          throw new HttpError(
            422,
            "Move the transfer as a linked job; its pickup and drop-off must stay together.",
          );
        const moved = {
          ...stop,
          runId: target.canonicalId,
          ...(planned || {}),
          version: stop.version + 1,
          updatedAt: now,
          audit: [
            ...stop.audit,
            { action: "stop-moved", at: now, by, version: stop.version + 1 },
          ],
        };
        const sourceStops = sourceStopsSnap.docs
          .map((doc) => normalizeStop(doc.data()))
          .filter((item) => item.canonicalId !== stop.canonicalId);
        const targetStops = targetStopsSnap.docs
          .map((doc) => normalizeStop(doc.data()))
          .filter((item) => item.canonicalId !== stop.canonicalId);
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
        return moved;
      });
      return NextResponse.json(result);
    }
    if ((body.action === "schedule-stop" || body.action === "clear-stop-schedule") && body.runId && body.stopId) {
      if (body.expectedRunVersion === undefined || body.expectedStopVersion === undefined)
        throw new HttpError(422, "Current run and stop versions are required to change timing.");
      const result = await db.runTransaction(async (transaction) => {
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
        if (stop.linkedOperation === "collection" && stop.linkedStopId) {
          const counterpartSnap = await transaction.get(stops().doc(stop.linkedStopId));
          if (counterpartSnap.exists) {
            const counterpart = normalizeStop(counterpartSnap.data()!);
            const collectionStart = planned.plannedWindow?.startTime || planned.plannedArrivalTime;
            const deliveryStart = counterpart.plannedWindow?.startTime || counterpart.plannedArrivalTime;
            if (collectionStart && deliveryStart && collectionStart < deliveryStart)
              throw new HttpError(422, "Collection cannot be scheduled before its delivery.");
          }
        }
        const nextStop = { ...stop, ...planned, version: stop.version + 1, updatedAt: now, audit: [...stop.audit, { action: "stop-scheduled", at: now, by, version: stop.version + 1 }] };
        transaction.set(stopRef, nextStop);
        const nextRun = { ...run, version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: "stop-scheduled", at: now, by, version: run.version + 1 }] };
        transaction.set(runRef, nextRun);
        return { run: nextRun, stop: nextStop };
      });
      return NextResponse.json(result);
    }
    if (body.action === "assign" && body.runId) {
      if (body.requirementId && body.movementId)
        throw new HttpError(422, "Choose one item to assign.");
      const state = await listState();
      const target = state.runs.find((item) => item.canonicalId === body.runId);
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
      const result = await db.runTransaction(async (transaction) => {
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
            byId.set(id, { ...stop, ...planned, version: stop.version + 1, updatedAt: now, audit: [...stop.audit, { action: "stop-scheduled", at: now, by, version: stop.version + 1 }] });
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
        body.action !== "mark-subload-delivered" &&
        body.action !== "undo-completion" &&
        body.action !== "defer-collection" &&
        body.action !== "arrive-stop" &&
        body.action !== "complete-stop"
      )
        throw new HttpError(400, "Unknown execution action.");
      if (body.action === "report-issue" && !body.issueDescription?.trim())
        throw new HttpError(422, "A short issue description is required.");
      const result = await db.runTransaction(async (transaction) => {
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
          body.action !== "mark-subload-delivered" &&
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
        const runStopSnap = await transaction.get(
          stops().where("runId", "==", run.canonicalId),
        );
        if (body.action === "defer-collection") {
          if (stop.linkedOperation !== "collection" && stop.movementType !== "collection")
            throw new HttpError(422, "Only collection stops can be postponed.");
          if (stop.status === "completed")
            throw new HttpError(422, "Completed collections cannot be postponed.");
          if (!body.targetServiceDate || body.targetServiceDate <= run.serviceDate)
            throw new HttpError(422, "Choose a future collection date.");
          const allRunsSnap = await transaction.get(runs());
          const allRuns = allRunsSnap.docs.map((doc) => doc.data() as DeliveryRun);
          const target = allRuns.find((candidate) =>
            candidate.serviceDate === body.targetServiceDate &&
            (candidate.status === "draft" || candidate.status === "planned") &&
            ((run.driverId && candidate.driverId === run.driverId) ||
              (!run.driverId && run.driverLabel && candidate.driverLabel === run.driverLabel)),
          );
          const targetRun: DeliveryRun = target || {
            canonicalId: `run:${body.targetServiceDate}:deferred-collections:${run.driverId || run.driverLabel?.toLowerCase() || "unassigned"}`,
            serviceDate: body.targetServiceDate,
            status: "draft",
            returnToCpuRequired: true,
            driverId: run.driverId,
            driverLabel: run.driverLabel,
            vehicleLabel: run.vehicleLabel,
            orderedStopIds: [],
            version: 1,
            createdAt: now,
            updatedAt: now,
            audit: [{ action: "deferred-collection-run-created", at: now, by, version: 1 }],
          };
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
          orderedSource.forEach((item) => transaction.set(stops().doc(item.canonicalId), item));
          orderedTarget.forEach((item) => transaction.set(stops().doc(item.canonicalId), item));
          const sourceRemaining = orderedSource.filter((item) => item.status !== "completed");
          const sourceNext = {
            ...run,
            orderedStopIds: orderedSource.map((item) => item.canonicalId),
            ...(sourceRemaining.length === 0 && run.returnToCpuRequired !== false ? { returnToCpuPending: true } : {}),
            ...(sourceRemaining.length === 0 && run.returnToCpuRequired === false ? { status: "completed" as const } : {}),
            version: run.version + 1,
            updatedAt: now,
            audit: [...run.audit, { action: "collection-postponed", at: now, by, version: run.version + 1 }],
          };
          const targetNext = {
            ...targetRun,
            orderedStopIds: orderedTarget.map((item) => item.canonicalId),
            version: targetRun.version + 1,
            updatedAt: now,
            audit: [...targetRun.audit, { action: "collection-postponed-in", at: now, by, version: targetRun.version + 1 }],
          };
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
            completedFromStatus: stop.status === "arrived" ? "arrived" : "planned",
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
          const remaining = allStops.filter(
            (item) =>
              item.canonicalId !== stop.canonicalId &&
              item.status !== "completed",
          );
          if (!remaining.length) {
            const hasOpenIssues = allStops.some((item) => (item.issues || []).some((issue) => issue.status === "open"));
            if (run.returnToCpuRequired !== false && !hasOpenIssues) {
              nextRun = {
                ...run,
                returnToCpuPending: true,
                version: run.version + 1,
                updatedAt: now,
                audit: [...run.audit, { action: "run-ready-to-return-to-cpu", at: now, by, version: run.version + 1 }],
              };
            } else {
              assertTransition(run.status, "completed");
              nextRun = {
                ...run,
                status: "completed",
                version: run.version + 1,
                updatedAt: now,
                audit: [...run.audit, { action: "run-completed", at: now, by, version: run.version + 1 }],
              };
            }
          }
        }
        if (body.action === "undo-completion") {
          if (stop.status !== "completed")
            throw new HttpError(422, "Only completed stops can be undone.");
          const { completedFromStatus, ...rest } = stop;
          nextStop = {
            ...rest,
            status: restoredStopStatus({ completedFromStatus }),
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
          const movementIds = stop.movementRequestIds || [];
          const linked = await Promise.all(
            movementIds.map((id) => transaction.get(movements().doc(id))),
          );
          if (
            linked.some(
              (snapshot) =>
                snapshot.exists &&
                (snapshot.data() as MovementRequest).type === "transfer",
            )
          )
            throw new HttpError(
              422,
              "Transfer pickup and drop-off must remain linked; defer the transfer as a pair.",
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
      return NextResponse.json(result);
    }
    if (body.action === "update-stop" && body.stop) {
      throw new HttpError(
        422,
        "Use an execution command to change stop status.",
      );
    }
    if (
      body.action === "reorder" &&
      body.runId &&
      Array.isArray(body.stopIds)
    ) {
      if (body.expectedRunVersion === undefined)
        throw new HttpError(
          422,
          "A current run version is required to reorder stops.",
        );
      const result = await db.runTransaction(async (transaction) => {
        const runRef = runs().doc(body.runId!);
        const runSnap = await transaction.get(runRef);
        if (!runSnap.exists) throw new HttpError(404, "Run not found.");
        const run = runSnap.data() as DeliveryRun;
        if (run.version !== body.expectedRunVersion)
          throw new HttpError(
            409,
            "This run changed elsewhere. Refresh before reordering stops.",
          );
        const stopSnap = await transaction.get(
          stops().where("runId", "==", body.runId),
        );
        const byId = new Map(
          stopSnap.docs.map((doc) => [doc.id, normalizeStop(doc.data())]),
        );
        const selected = body
          .stopIds!.map((id) => byId.get(id))
          .filter(Boolean) as DeliveryStop[];
        if (selected.length !== body.stopIds!.length)
          throw new HttpError(422, "The stop list contains an unknown stop.");
        if (selected.length !== byId.size)
          throw new HttpError(
            422,
            "Reorder must include every stop in the run.",
          );
        const ordered = orderedTransferStops(selected);
        if (
          ordered.some(
            (stop, index) => stop.canonicalId !== body.stopIds![index],
          )
        )
          throw new HttpError(
            422,
            "Transfer pickup must remain before drop-off.",
          );
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
      return NextResponse.json(result);
    }
    throw new HttpError(400, "Unknown Logistics action.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return errorResponse(Object.assign(error instanceof Error ? error : new Error(messageOf(error)), { status }), request.headers.get("x-request-id") || undefined);
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireLogisticsAccess(request);
    const response = await getLogistics(request);
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    return errorResponse(error, request.headers.get("x-request-id") || undefined);
  }
}
