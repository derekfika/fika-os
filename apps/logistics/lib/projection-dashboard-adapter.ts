import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { fulfilmentWorkstream } from "../../shared/fulfilment-workstream";
import type { DeliveryRun, DeliveryStop, LogisticsDayProjection } from "./types";
import { buildPlannerDay, type PlannerLine, type PlannerWorkGroup } from "./planner-read-model";

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

  for (const load of projection.deliveryLoads) {
    const deliveryRunId = load.runId && runIds.has(load.runId) ? load.runId : unassignedRunId;
    const collectionRunId = load.collectionRunId && runIds.has(load.collectionRunId) ? load.collectionRunId : deliveryRunId;
    const entries = [
      ...(deliveryRunId ? [{ runId: deliveryRunId, lane: "delivery" as const }] : []),
      ...(load.collectionRequired && collectionRunId ? [{ runId: collectionRunId, lane: "collection" as const }] : []),
    ];
    for (const { runId, lane } of entries) {
      const collection = lane === "collection";
      const stopId = `projection-stop:${lane}:${load.id}`;
      const scheduledTime = collection ? load.collectionScheduledTime : load.scheduledTime;
      const scheduledEnd = collection ? load.collectionScheduledEnd : load.scheduledEnd;
      loadStops.push({
        canonicalId: stopId,
        runId,
        sequence: (loadStopIdsByRun.get(runId)?.length || 0) + 1,
        locationOplocId: collection ? load.originOplocId : load.destinationOplocId,
        locationLabelSnapshot: collection ? "CPU production" : load.destinationLabelSnapshot || load.destinationOplocId,
        requirementRefs: load.jobs.map((job) => ({ requirementId: job.id, sourceVersion: 1, sourceDomain: job.sourceType as FulfilmentRequirement["sourceDomain"], ...(job.workstream ? { workstream: job.workstream } : {}) })),
        movementRequestIds: [],
        ...(scheduledTime ? (scheduledEnd ? { plannedWindow: { startTime: scheduledTime, endTime: scheduledEnd } } : { plannedArrivalTime: scheduledTime }) : {}),
        loaded: Boolean(load.loaded),
        status: load.status === "delivered" ? "completed" : "planned",
        movementType: collection ? "collection" : "delivery",
        linkedStopId: `projection-stop:${collection ? "delivery" : "collection"}:${load.id}`,
        linkedOperation: collection ? "collection" : "delivery",
        createdAt: now,
        updatedAt: now,
        version: projection.revision,
        audit: [],
      });
      loadStopIdsByRun.set(runId, [...(loadStopIdsByRun.get(runId) || []), stopId]);
    }
  }

  const runs = projectedRuns.map((run) => ({
    ...run,
    orderedStopIds: Array.from(new Set([
      ...(run.orderedStopIds || []).filter((id) => actualStops.some((stop) => stop.canonicalId === id)),
      ...(loadStopIdsByRun.get(run.canonicalId) || []),
    ])),
  }));
  const stops = [...actualStops, ...loadStops];
  const movements = projection.movements || [];
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

  const line = (job: { id: string; sourceId: string; totalUnits: number }): PlannerLine => ({ lineKey: `projection:${job.id}`, displayName: job.sourceId, unit: "unit", quantity: job.totalUnits, requirementRefs: [job.id], sourceLineRefs: [] });
  const workGroups: PlannerWorkGroup[] = projection.planningQueue.map((job) => ({
    groupKey: `projection-job:${job.id}`,
    serviceDate: projection.serviceDate,
    destinationOplocId: job.destinationOplocId || "",
    destinationLabel: job.destinationLabelSnapshot || job.destinationOplocId || "Unknown destination",
    ...(job.requestedWindow ? { deliveryWindow: job.requestedWindow } : {}),
    requiredTimes: job.requestedWindow?.startTime ? [job.requestedWindow.startTime] : [],
    requirementRefs: [{ requirementId: job.id, sourceVersion: 1, sourceDomain: job.sourceType as FulfilmentRequirement["sourceDomain"], sourceEntityId: job.sourceId, status: "ready_for_planning", workstream: job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType }) }],
    requirementCount: 1,
    sourceLabels: [job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType })],
    combinedLines: [line(job)],
    unitBreakdown: [{ unit: "unit", quantity: job.totalUnits }],
    readiness: job.productionReadiness === "attention" ? "ATTENTION" : job.productionReadiness === "pending" ? "PENDING" : "READY",
    attention: job.productionReadiness === "attention" ? ["Upstream amendment requires review"] : [],
    planningState: job.productionReadiness === "attention" ? "attention" : "unplanned",
    collectionRequired: Boolean(projection.collectionRequiredKeys?.includes(`projection-job:${job.id}`)),
  }));
  for (const load of projection.deliveryLoads.filter((item) => item.collectionRequired && !item.collectionScheduledTime)) {
    const runId = load.collectionRunId || load.runId || unassignedRunId;
    const collectionStopId = `projection-stop:collection:${load.id}`;
    workGroups.push({
      groupKey: `projection-collection:${load.id}`,
      serviceDate: projection.serviceDate,
      destinationOplocId: load.originOplocId,
      destinationLabel: "CPU production",
      requiredTimes: [],
      requirementRefs: load.jobs.map((job) => ({ requirementId: job.id, sourceVersion: 1, sourceDomain: job.sourceType as FulfilmentRequirement["sourceDomain"], sourceEntityId: job.sourceId, status: "ready_for_planning", workstream: job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType }), ...(runId ? { runId, stopId: collectionStopId } : {}) })),
      requirementCount: load.jobCount,
      sourceLabels: Array.from(new Set(load.jobs.map((job) => job.workstream || fulfilmentWorkstream({ sourceDomain: job.sourceType })))),
      combinedLines: load.jobs.map((job) => line(job)),
      unitBreakdown: [{ unit: "unit", quantity: load.totalUnits }],
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
