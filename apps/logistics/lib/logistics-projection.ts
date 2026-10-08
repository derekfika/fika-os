import { compatibleAssignedLoad } from "./delivery-loads";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsAssignment, LogisticsChangeEvent, LogisticsDayProjection, LogisticsJob, LogisticsProjectionJob, LogisticsProjectionLoad, LogisticsSourceLineage, MovementRequest } from "./types";
import type { LogisticsProjectionInvalidation } from "../../shared/logistics-projection";
export type { LogisticsProjectionInvalidation } from "../../shared/logistics-projection";

const totalUnits = (job: LogisticsJob) => job.contents.reduce((sum, item) => sum + item.quantity, 0);

export function buildLogisticsDayProjection(input: { serviceDate: string; jobs: LogisticsJob[]; loads: DeliveryLoad[]; assignments: LogisticsAssignment[]; runs?: DeliveryRun[]; stops?: DeliveryStop[]; movements?: MovementRequest[]; collectionRequiredKeys?: string[]; lastChangeSequence?: number; revision?: number; now?: string }): LogisticsDayProjection {
  const jobs = input.jobs.filter((job) => job.serviceDate === input.serviceDate && job.sourceStatus !== "withdrawn");
  const loads = input.loads.filter((load) => load.serviceDate === input.serviceDate && load.status !== "cancelled");
  const counts = new Map<string, number>();
  for (const assignment of input.assignments) counts.set(assignment.jobId, (counts.get(assignment.jobId) || 0) + 1);
  const assignments = input.assignments.filter(a => counts.get(a.jobId) === 1 && jobs.some(j => j.id === a.jobId && loads.some(l => l.id === a.loadId && compatibleAssignedLoad(j, l))));
  const assigned = new Map(assignments.map((item) => [item.jobId, item.loadId]));
  const nativeIds = new Set((input.stops || []).flatMap(stop => stop.requirementRefs.map(ref => ref.requirementId)));
  const queue: LogisticsProjectionJob[] = jobs.filter((job) => !assigned.has(job.id) && !nativeIds.has(job.requirementId || "")).map((job) => ({ id: job.id, version: job.version, sourceVersion: job.sourceVersion, requirementId: job.requirementId, sourceType: job.sourceType, sourceId: job.sourceId, serviceDate: job.serviceDate, originOplocId: job.originOplocId, destinationOplocId: job.destinationOplocId, destinationLabelSnapshot: job.destinationLabelSnapshot, requestedWindow: job.requestedWindow, productionReadiness: job.productionReadiness, deliveryStatus: job.deliveryStatus || "pending", collectionStatus: job.collectionStatus, contents: job.contents, ...(job.notes ? { notes: job.notes } : {}), ...(job.workstream ? { workstream: job.workstream } : {}), totalUnits: totalUnits(job) }));
  const projectedLoads: LogisticsProjectionLoad[] = loads.map((load) => {
    const childJobs = assignments.filter((item) => item.loadId === load.id).map((item) => jobs.find((job) => job.id === item.jobId)).filter(Boolean) as LogisticsJob[];
    const collectedCount = childJobs.filter((job) => job.collectionStatus === "collected").length;
    return { id: load.id, version: load.version, loadVersions: { [load.id]: load.version }, loadIds: [load.id], serviceDate: load.serviceDate, originOplocId: load.originOplocId, destinationOplocId: load.destinationOplocId, destinationLabelSnapshot: load.destinationLabelSnapshot, scheduledTime: load.scheduledTime, scheduledEnd: load.scheduledEnd, ...(load.collectionRequired ? { collectionRequired: true } : {}), ...(load.collectionScheduledTime ? { collectionScheduledTime: load.collectionScheduledTime } : {}), ...(load.collectionScheduledEnd ? { collectionScheduledEnd: load.collectionScheduledEnd } : {}), ...(load.collectionRunId ? { collectionRunId: load.collectionRunId } : {}), loaded: childJobs.length > 0 && childJobs.every(job => job.deliveryStatus === "loaded" || job.deliveryStatus === "delivered"), status: load.status, deliveryExecution: load.deliveryExecution, collectionExecution: load.collectionExecution, driverId: load.driverId, vehicleId: load.vehicleId, runId: load.runId, jobs: childJobs.map((job) => ({ id: job.id, version: job.version, sourceVersion: job.sourceVersion, requirementId: job.requirementId, sourceType: job.sourceType, sourceId: job.sourceId, requestedWindow: job.requestedWindow, deliveryStatus: job.deliveryStatus || "pending", collectionStatus: job.collectionStatus, productionReadiness: job.productionReadiness, contents: job.contents, ...(job.notes ? { notes: job.notes } : {}), ...(job.workstream ? { workstream: job.workstream } : {}), totalUnits: totalUnits(job) })), jobCount: childJobs.length, totalUnits: childJobs.reduce((sum, job) => sum + totalUnits(job), 0), collectedCount, readiness: collectedCount < childJobs.length ? "awaiting_collection" as const : "ready" as const };
  }).filter((load) => load.jobCount > 0);
  const mergedLoads = [...projectedLoads.reduce((groups, load) => {
    const key = JSON.stringify([load.serviceDate, load.originOplocId, load.destinationOplocId, load.runId, load.vehicleId, load.scheduledTime, load.scheduledEnd, Boolean(load.collectionRequired), load.collectionRunId, load.collectionScheduledTime, load.collectionScheduledEnd, load.status]);
    const existing = groups.get(key);
    if (!existing) { groups.set(key, load); return groups; }
    existing.loadIds = [...(existing.loadIds || [existing.id]), ...(load.loadIds || [load.id])];
    existing.loadVersions = { ...existing.loadVersions, ...load.loadVersions };
    for (const leg of ["deliveryExecution", "collectionExecution"] as const) {
      const left = existing[leg], right = load[leg];
      existing[leg] = { completion: left?.completion && right?.completion && left.completion.id === right.completion.id ? { id: left.completion.id, jobs: { ...left.completion.jobs, ...right.completion.jobs } } : undefined, arrivedAt: left?.arrivedAt && right?.arrivedAt ? [left.arrivedAt, right.arrivedAt].sort().at(-1) : undefined, issues: [...new Map([...(left?.issues || []), ...(right?.issues || [])].map(issue => [issue.id, issue])).values()] };
    }
    existing.jobs = [...existing.jobs, ...load.jobs];
    existing.jobCount = existing.jobs.length;
    existing.totalUnits += load.totalUnits;
    existing.collectedCount += load.collectedCount;
    existing.loaded = Boolean(existing.loaded && load.loaded);
    existing.scheduledEnd = [existing.scheduledEnd, load.scheduledEnd].filter(Boolean).sort().at(-1) as string | undefined;
    existing.readiness = existing.collectedCount < existing.jobCount ? "awaiting_collection" : "ready";
    return groups;
  }, new Map<string, LogisticsProjectionLoad>()).values()];
  const assignmentExceptions = input.assignments.filter(a => !assignments.includes(a)).map(a => `${a.jobId}: assignment/source integrity conflict requires reconciliation`);
  const exceptions = [...assignmentExceptions, ...jobs.flatMap((job) => [
    ...(!job.originOplocId || !job.destinationOplocId ? [`${job.id}: missing canonical OPLOC`] : []),
    ...(!job.requestedWindow?.startTime ? [`${job.id}: unresolved timing`] : []),
  ])];
  const now = input.now || new Date().toISOString();
  const projectedRuns = (input.runs || []).filter((run) => run.serviceDate === input.serviceDate);
  const projectedRunIds = new Set(projectedRuns.map((run) => run.canonicalId));
  const projectedStops = (input.stops || []).filter((stop) => projectedRunIds.has(stop.runId));
  const projectedMovements = (input.movements || []).filter((movement) => movement.serviceDate === input.serviceDate);
  const validEmpty = jobs.length === 0 && mergedLoads.length === 0 && projectedStops.length === 0 && projectedMovements.length === 0;
  const sourceLineage = [...new Map(input.jobs.filter(job => job.serviceDate === input.serviceDate).filter((job) => job.sourceVersion !== undefined).map((job) => [`${job.sourceType}:${job.sourceId}`, { sourceDomain: job.sourceType, sourceEntityId: job.sourceId, sourceVersion: job.sourceVersion!, ...(job.sourceContentHash ? { sourceContentHash: job.sourceContentHash } : {}), changedAt: job.updatedAt } satisfies LogisticsSourceLineage])).values()].slice(0, 200);
  return { serviceDate: input.serviceDate, revision: input.revision || 1, lastChangeSequence: input.lastChangeSequence || 0, state: validEmpty ? "VALID_EMPTY" as const : "CURRENT" as const, completeness: { fulfilment: "complete" as const, cpu: "not_required" as const, oploc: "complete" as const }, sourceLineage, reconciliation: { status: "current" as const, checkedAt: now }, planningQueue: queue, deliveryLoads: mergedLoads, runs: projectedRuns, stops: projectedStops, movements: projectedMovements, collectionRequiredKeys: input.collectionRequiredKeys || [], exceptions: Array.from(new Set(exceptions)), summary: { queuedJobs: queue.length, loads: mergedLoads.length, assignedJobs: jobs.length - queue.length, collectedJobs: jobs.filter((job) => job.collectionStatus === "collected").length }, rebuiltAt: now };
}

export function applyLogisticsProjectionInvalidation(projection: LogisticsDayProjection, change: LogisticsProjectionInvalidation) {
  if (projection.serviceDate !== change.serviceDate) return { projection, applied: false as const, reason: "unrelated-service-date" as const };
  const key = `${change.sourceDomain}:${change.sourceEntityId}`;
  const prior = projection.sourceLineage?.find((item) => `${item.sourceDomain}:${item.sourceEntityId}` === key);
  if (prior && prior.sourceVersion >= change.sourceVersion) return { projection, applied: false as const, reason: "older-or-duplicate" as const };
  const sourceLineage = [...(projection.sourceLineage || []).filter((item) => `${item.sourceDomain}:${item.sourceEntityId}` !== key), { sourceDomain: change.sourceDomain, sourceEntityId: change.sourceEntityId, sourceVersion: change.sourceVersion, ...(change.sourceContentHash ? { sourceContentHash: change.sourceContentHash } : {}), changedAt: change.changedAt }].slice(-200);
  return { applied: true as const, projection: { ...projection, state: "STALE" as const, sourceLineage, reconciliation: { status: "pending" as const, checkedAt: change.changedAt, errorCode: "UPSTREAM_CHANGE_PENDING" } } };
}

export function filterLogisticsProjectionForVehicle(projection: LogisticsDayProjection, vehicleLabel?: string) {
  if (!vehicleLabel) return projection;
  const runs = projection.runs.filter((run) => run.vehicleLabel === vehicleLabel);
  const runIds = new Set(runs.map((run) => run.canonicalId));
  const deliveryLoads = projection.deliveryLoads.filter((load) => runIds.has(load.runId || "") || runIds.has(load.collectionRunId || ""));
  const stops = (projection.stops || []).filter((stop) => runIds.has(stop.runId));
  const movementIds = new Set(stops.flatMap((stop) => stop.movementRequestIds || []));
  const movements = (projection.movements || []).filter((movement) => movementIds.has(movement.canonicalId));
  return { ...projection, planningQueue: [], deliveryLoads, runs, stops, movements, summary: { ...projection.summary, queuedJobs: 0, loads: deliveryLoads.length, assignedJobs: deliveryLoads.reduce((total, load) => total + load.jobCount, 0), collectedJobs: deliveryLoads.reduce((total, load) => total + load.collectedCount, 0) } };
}

/** Replays one change without changing the canonical records. Rebuilding the compact day from supplied canonical slices is deterministic and safe for duplicate replay. */
export function applyLogisticsChange(projection: LogisticsDayProjection, event: LogisticsChangeEvent, canonical: Parameters<typeof buildLogisticsDayProjection>[0]) {
  if (event.sequence <= projection.lastChangeSequence) return projection;
  return buildLogisticsDayProjection({ ...canonical, serviceDate: projection.serviceDate, lastChangeSequence: event.sequence, revision: projection.revision + 1 });
}
