import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { lineBreakdown } from "./ordered-quantity";
import { fulfilmentWorkstream } from "../../shared/fulfilment-workstream";
import type { DeliveryRun, DeliveryStop, LogisticsDayProjection } from "./types";
import { buildPlannerDay, type PlannerLine, type PlannerWorkGroup } from "./planner-read-model";
import { applyStoredStopOrder } from "./run-stop-order";
import { visitStopId } from "./stop-visits";

/** Adapts the durable projection without rereading upstream authorities. */
export function projectionToDashboardData(projection: LogisticsDayProjection) {
  const now = projection.rebuiltAt || new Date().toISOString();
  const actualRuns = projection.runs || [];
  const projectedRuns: DeliveryRun[] = actualRuns.map((run) => ({
        ...run,
        serviceDate: run.serviceDate || projection.serviceDate,
        orderedStopIds: run.orderedStopIds || [],
        version: run.version || projection.revision,
        createdAt: run.createdAt || now,
        updatedAt: run.updatedAt || now,
        audit: run.audit || [],
      }));
  const referencedRuns = new Map<string, string | undefined>();
  for (const load of projection.deliveryLoads) {
    if (load.runId) referencedRuns.set(load.runId, load.vehicleId);
    if (load.collectionRunId) referencedRuns.set(load.collectionRunId, load.vehicleId);
  }
  for (const [runId, vehicleId] of referencedRuns) {
    if (!projectedRuns.some((run) => run.canonicalId === runId)) projectedRuns.push({ canonicalId: runId, serviceDate: projection.serviceDate, status: "draft", vehicleLabel: vehicleId || "Assigned vehicle", orderedStopIds: [], version: projection.revision, createdAt: now, updatedAt: now, audit: [] });
  }
  const unassignedRunId = `projection-run:${projection.serviceDate}:unassigned`;
  if (projection.deliveryLoads.some((load) => !load.runId) && !projectedRuns.some((run) => run.canonicalId === unassignedRunId)) projectedRuns.push({ canonicalId: unassignedRunId, serviceDate: projection.serviceDate, status: "draft", vehicleLabel: "Unassigned vehicle", orderedStopIds: [], version: projection.revision, createdAt: now, updatedAt: now, audit: [] });
  const runIds = new Set(projectedRuns.map((run) => run.canonicalId));
  const actualStops = (projection.stops || []).filter((stop) => runIds.has(stop.runId));
  const loadStops: DeliveryStop[] = [];
  const loadStopIdsByRun = new Map<string, string[]>();
  const loadStopsByRun = new Map<string, DeliveryStop[]>();
  const movements = projection.movements || [];
  const nativeStopRepresentsLoad = (runId: string, load: LogisticsDayProjection["deliveryLoads"][number], lane: "delivery" | "collection") => {
    const ids = load.loadIds?.length ? load.loadIds : [load.id];
    return actualStops.some((stop) => {
      if (stop.runId !== runId || !ids.every((id) => (stop.canonicalLoadIds || []).includes(id))) return false;
      const nativeLane = stop.linkedOperation || stop.movementType;
      if (!nativeLane || nativeLane === lane) return true;
      const movementTypes = (stop.movementRequestIds || []).map((id) => movements.find((movement) => movement.canonicalId === id)?.type);
      return movementTypes.includes(lane);
    });
  };

  for (const load of projection.deliveryLoads) {
    const deliveryRunId = load.runId && runIds.has(load.runId) ? load.runId : unassignedRunId;
    const collectionRunId = load.collectionRunId && runIds.has(load.collectionRunId) ? load.collectionRunId : deliveryRunId;
    const entries = [
      ...(deliveryRunId ? [{ runId: deliveryRunId, lane: "delivery" as const }] : []),
      ...(load.collectionRequired && collectionRunId ? [{ runId: collectionRunId, lane: "collection" as const }] : []),
    ];
    for (const { runId, lane } of entries) {
      // An authoritative physical stop can already own this canonical load.
      // Keep the richer stop (including any mixed movements) as one visit.
      if (nativeStopRepresentsLoad(runId, load, lane)) continue;
      const collection = lane === "collection";
      const stopId = `projection-stop:${lane}:${load.id}`;
      const scheduledTime = collection ? load.collectionScheduledTime : load.scheduledTime;
      const scheduledEnd = collection ? load.collectionScheduledEnd : load.scheduledEnd;
      loadStops.push({
        canonicalId: stopId,
        canonicalLoadIds: load.loadIds || [load.id],
        canonicalLoadVersions: load.loadVersions || (load.version === undefined ? {} : { [load.id]: load.version }),
        canonicalJobVersions: Object.fromEntries(load.jobs.filter(job => job.version !== undefined).map(job => [job.id, job.version])),
        runId,
        sequence: (loadStopIdsByRun.get(runId)?.length || 0) + 1,
        // Both legs happen at the customer. CPU (originOplocId) is only the eventual return destination.
        locationOplocId: load.destinationOplocId,
        locationLabelSnapshot: load.destinationLabelSnapshot || load.destinationOplocId,
        ...((collection ? load.collectionVisitId : load.deliveryVisitId) ? { visitId: (collection ? load.collectionVisitId : load.deliveryVisitId) as string } : {}),
        requirementRefs: load.jobs.map((job) => ({ requirementId: job.id, sourceVersion: job.sourceVersion || 1, sourceDomain: job.sourceType as FulfilmentRequirement["sourceDomain"], ...(job.workstream ? { workstream: job.workstream } : {}) })),
        movementRequestIds: [],
        ...(scheduledTime ? (scheduledEnd ? { plannedWindow: { startTime: scheduledTime, endTime: scheduledEnd } } : { plannedArrivalTime: scheduledTime }) : {}),
        loaded: !collection && load.jobs.every(job => job.deliveryStatus === "loaded" || job.deliveryStatus === "delivered"),
        loadedRequirementIds: collection ? [] : load.jobs.filter(job => job.deliveryStatus === "loaded" || job.deliveryStatus === "delivered").map(job => job.id),
        deliveredRequirementIds: collection ? [] : load.jobs.filter(job => job.deliveryStatus === "delivered").map(job => job.id),
        collectedRequirementIds: collection ? load.jobs.filter(job => job.collectionStatus === "collected").map(job => job.id) : [],
        canUndoCompletion: Boolean((collection ? load.collectionExecution : load.deliveryExecution)?.completion),
        issues: (collection ? load.collectionExecution : load.deliveryExecution)?.issues || [],
        status: load.jobs.every(job => collection ? job.collectionStatus === "collected" : job.deliveryStatus === "delivered") ? "completed" : (collection ? load.collectionExecution : load.deliveryExecution)?.arrivedAt ? "arrived" : "planned",
        movementType: collection ? "collection" : "delivery",
        linkedStopId: `projection-stop:${collection ? "delivery" : "collection"}:${load.id}`,
        linkedOperation: collection ? "collection" : "delivery",
        createdAt: now,
        updatedAt: now,
        version: projection.revision,
        audit: [],
      });
      loadStopIdsByRun.set(runId, [...(loadStopIdsByRun.get(runId) || []), stopId]);
      loadStopsByRun.set(runId, [...(loadStopsByRun.get(runId) || []), loadStops[loadStops.length - 1]]);
    }
  }

  // Visiting order: the stored canonical order wins; work not yet ordered follows by planned time (untimed last).
  const plannedStart = (stop: DeliveryStop) => stop.plannedWindow?.startTime || stop.plannedArrivalTime || "99:99";
  const stopOrderById = new Map<string, number>();
  const runs = projectedRuns.map((run) => {
    const nativeIds = (run.orderedStopIds || []).filter((id) => actualStops.some((stop) => stop.canonicalId === id));
    const candidates = [
      ...nativeIds.map((id) => ({ id, stop: actualStops.find((stop) => stop.canonicalId === id)! })),
      ...(loadStopsByRun.get(run.canonicalId) || []).map((stop) => ({ id: stop.canonicalId, stop, aliases: [...(stop.canonicalLoadIds || []).map((loadId) => `projection-stop:${stop.movementType === "collection" ? "collection" : "delivery"}:${loadId}`), ...(stop.visitId ? [visitStopId(stop.visitId)] : [])] })),
    ];
    const ordered = applyStoredStopOrder(candidates, run.orderedStopIds || [], (left, right) => plannedStart(left.stop).localeCompare(plannedStart(right.stop)) || left.id.localeCompare(right.id), (left, right) => Number(left.stop.movementType === "collection") - Number(right.stop.movementType === "collection"));
    ordered.forEach((item, index) => stopOrderById.set(item.id, index + 1));
    return { ...run, orderedStopIds: Array.from(new Set(ordered.map((item) => item.id))) };
  });
  const stops = [...actualStops, ...loadStops].map((stop) => stopOrderById.has(stop.canonicalId) ? { ...stop, sequence: stopOrderById.get(stop.canonicalId)! } : stop);
  const basePlanner = buildPlannerDay({
    serviceDate: projection.serviceDate,
    requirements: [],
    runs,
    stops,
    movements,
    oplocs: [],
    health: {
      fulfilment: { available: projection.completeness?.fulfilment !== "unavailable" },
      oplocs: { available: projection.completeness?.oploc !== "unavailable" },
      enrichment: { available: projection.completeness?.cpu !== "unavailable" },
    },
  });

  const lines = (job: { id: string; sourceId: string; totalUnits: number; contents?: Array<{ description: string; quantity: number; unit: string; orderedQuantity?: number; orderedUnit?: string }> }): PlannerLine[] => job.contents?.length
    ? job.contents.map((content, index) => ({ lineKey: `projection:${job.id}:${index}`, displayName: content.description, unit: content.unit, quantity: content.quantity, ...(content.orderedQuantity !== undefined && content.orderedUnit ? { orderedQuantity: content.orderedQuantity, orderedUnit: content.orderedUnit } : {}), requirementRefs: [job.id], sourceLineRefs: [] }))
    : [{ lineKey: `projection:${job.id}`, displayName: "Delivery items", unit: "unit", quantity: job.totalUnits, requirementRefs: [job.id], sourceLineRefs: [] }];
  const workGroups: PlannerWorkGroup[] = projection.planningQueue.map((job) => ({
    groupKey: `projection-job:${job.id}`,
    serviceDate: projection.serviceDate,
    destinationOplocId: job.destinationOplocId || "",
    destinationLabel: job.destinationLabelSnapshot || job.destinationOplocId || "Unknown destination",
    ...(job.requestedWindow ? { deliveryWindow: job.requestedWindow } : {}),
    requiredTimes: job.requestedWindow?.startTime ? [job.requestedWindow.startTime] : [],
    requirementRefs: [{ requirementId: job.id, sourceVersion: job.sourceVersion || 1, sourceDomain: job.sourceType as FulfilmentRequirement["sourceDomain"], sourceEntityId: job.sourceId, status: "ready_for_planning", workstream: job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType }) }],
    requirementCount: 1,
    sourceLabels: [job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType })],
    combinedLines: lines(job),
    unitBreakdown: lineBreakdown(lines(job)),
    readiness: job.productionReadiness === "attention" ? "ATTENTION" : job.productionReadiness === "pending" ? "PENDING" : "READY",
    attention: job.productionReadiness === "attention" ? ["Upstream amendment requires review"] : [],
    planningState: job.productionReadiness === "attention" ? "attention" : "unplanned",
    collectionRequired: Boolean(projection.collectionRequiredKeys?.includes(`projection-job:${job.id}`)),
    deliveryStatus: job.deliveryStatus,
    collectionStatus: job.collectionStatus,
    ...(job.notes ? { notes: job.notes } : {}),
  }));
  for (const load of projection.deliveryLoads.filter(item => item.runId && !item.scheduledTime && item.jobCount > 0)) {
    const combinedLines = load.jobs.flatMap(lines);
    workGroups.push({
      groupKey: `projection-delivery:${load.id}`,
      serviceDate: projection.serviceDate,
      destinationOplocId: load.destinationOplocId,
      destinationLabel: load.destinationLabelSnapshot || load.destinationOplocId,
      requiredTimes: [],
      requirementRefs: load.jobs.map(job => ({ requirementId: job.id, sourceVersion: job.sourceVersion || 1, sourceDomain: job.sourceType as FulfilmentRequirement["sourceDomain"], sourceEntityId: job.sourceId, status: "ready_for_planning", workstream: job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType }), runId: load.runId, stopId: `projection-stop:delivery:${load.id}` })),
      requirementCount: load.jobCount,
      sourceLabels: Array.from(new Set(load.jobs.map(job => job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType })))),
      combinedLines,
      unitBreakdown: lineBreakdown(combinedLines),
      readiness: load.readiness === "attention" ? "ATTENTION" : "READY",
      attention: load.readiness === "attention" ? ["Upstream amendment requires review"] : [],
      planningState: "planned",
      collectionRequired: Boolean(load.collectionRequired),
    });
  }
  for (const load of projection.deliveryLoads.filter((item) => item.collectionRequired && !item.collectionScheduledTime)) {
    const runId = load.collectionRunId || load.runId || unassignedRunId;
    const collectionStopId = `projection-stop:collection:${load.id}`;
    workGroups.push({
      groupKey: `projection-collection:${load.id}`,
      serviceDate: projection.serviceDate,
      destinationOplocId: load.destinationOplocId,
      destinationLabel: load.destinationLabelSnapshot || load.destinationOplocId,
      requiredTimes: [],
      requirementRefs: load.jobs.map((job) => ({ requirementId: job.id, sourceVersion: job.sourceVersion || 1, sourceDomain: job.sourceType as FulfilmentRequirement["sourceDomain"], sourceEntityId: job.sourceId, status: "ready_for_planning", workstream: job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType }), ...(runId ? { runId, stopId: collectionStopId } : {}) })),
      requirementCount: load.jobCount,
      sourceLabels: Array.from(new Set(load.jobs.map((job) => job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType })))),
      combinedLines: load.jobs.flatMap(lines),
      unitBreakdown: lineBreakdown(load.jobs.flatMap(lines)),
      readiness: "READY",
      attention: ["Collection timing required"],
      planningState: "partially_planned",
      collectionRequired: true,
    });
  }

  const planner = {
    ...basePlanner,
    workGroups,
    summary: {
      ...basePlanner.summary,
      requirements: projection.planningQueue.length + projection.summary.assignedJobs,
      destinations: new Set([...projection.planningQueue.map((job) => job.destinationOplocId), ...projection.deliveryLoads.map((load) => load.destinationOplocId), ...movements.map((movement) => movement.toOplocId || movement.toAddress).filter(Boolean)]).size,
      unplanned: projection.planningQueue.length,
      partiallyPlanned: workGroups.filter((group) => group.planningState === "partially_planned").length,
      planned: projection.summary.assignedJobs,
      attention: projection.exceptions.length + workGroups.filter((group) => group.readiness === "ATTENTION").length,
      loads: projection.deliveryLoads.length + movements.length,
      deliveries: projection.deliveryLoads.length + movements.filter((movement) => movement.type === "delivery").length,
      collections: projection.deliveryLoads.filter((load) => load.collectionRequired).length + movements.filter((movement) => movement.type === "collection").length,
      transfers: movements.filter((movement) => movement.type === "transfer").length,
      assignedWork: projection.summary.assignedJobs + basePlanner.summary.assignedWork,
    },
  };

  return { requirements: [] as FulfilmentRequirement[], runs, stops, movements, oplocs: [], serviceDate: projection.serviceDate, fetchedAt: projection.rebuiltAt, planner };
}
