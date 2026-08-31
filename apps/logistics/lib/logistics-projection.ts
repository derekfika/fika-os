import type { DeliveryLoad, DeliveryRun, LogisticsAssignment, LogisticsChangeEvent, LogisticsDayProjection, LogisticsJob, LogisticsProjectionJob, LogisticsProjectionLoad, LogisticsSourceLineage } from "./types";

const totalUnits = (job: LogisticsJob) => job.contents.reduce((sum, item) => sum + item.quantity, 0);

export function buildLogisticsDayProjection(input: { serviceDate: string; jobs: LogisticsJob[]; loads: DeliveryLoad[]; assignments: LogisticsAssignment[]; runs?: DeliveryRun[]; lastChangeSequence?: number; revision?: number; now?: string }): LogisticsDayProjection {
  const jobs = input.jobs.filter((job) => job.serviceDate === input.serviceDate);
  const loads = input.loads.filter((load) => load.serviceDate === input.serviceDate && load.status !== "cancelled");
  const assignments = input.assignments;
  const assigned = new Map(assignments.map((item) => [item.jobId, item.loadId]));
  const queue: LogisticsProjectionJob[] = jobs.filter((job) => !assigned.has(job.id)).map((job) => ({ id: job.id, sourceType: job.sourceType, sourceId: job.sourceId, serviceDate: job.serviceDate, originOplocId: job.originOplocId, destinationOplocId: job.destinationOplocId, destinationLabelSnapshot: job.destinationLabelSnapshot, requestedWindow: job.requestedWindow, productionReadiness: job.productionReadiness, collectionStatus: job.collectionStatus, contents: job.contents, ...(job.notes ? { notes: job.notes } : {}), totalUnits: totalUnits(job) }));
  const projectedLoads: LogisticsProjectionLoad[] = loads.map((load) => {
    const childJobs = assignments.filter((item) => item.loadId === load.id).map((item) => jobs.find((job) => job.id === item.jobId)).filter(Boolean) as LogisticsJob[];
    const collectedCount = childJobs.filter((job) => job.collectionStatus === "collected").length;
    return { id: load.id, loadIds: [load.id], serviceDate: load.serviceDate, originOplocId: load.originOplocId, destinationOplocId: load.destinationOplocId, destinationLabelSnapshot: load.destinationLabelSnapshot, scheduledTime: load.scheduledTime, scheduledEnd: load.scheduledEnd, ...(load.collectionRequired ? { collectionRequired: true } : {}), ...(load.collectionScheduledTime ? { collectionScheduledTime: load.collectionScheduledTime } : {}), ...(load.collectionScheduledEnd ? { collectionScheduledEnd: load.collectionScheduledEnd } : {}), ...(load.collectionRunId ? { collectionRunId: load.collectionRunId } : {}), loaded: load.loaded, status: load.status, driverId: load.driverId, vehicleId: load.vehicleId, runId: load.runId, jobs: childJobs.map((job) => ({ id: job.id, sourceType: job.sourceType, sourceId: job.sourceId, collectionStatus: job.collectionStatus, productionReadiness: job.productionReadiness, contents: job.contents, ...(job.notes ? { notes: job.notes } : {}), totalUnits: totalUnits(job) })), jobCount: childJobs.length, totalUnits: childJobs.reduce((sum, job) => sum + totalUnits(job), 0), collectedCount, readiness: collectedCount < childJobs.length ? "awaiting_collection" as const : "ready" as const };
  }).filter((load) => load.jobCount > 0);
  const mergedLoads = [...projectedLoads.reduce((groups, load) => {
    const key = `${load.runId || "unassigned"}|${load.destinationOplocId}|${load.scheduledTime || "unscheduled"}`;
    const existing = groups.get(key);
    if (!existing) { groups.set(key, load); return groups; }
    existing.loadIds = [...(existing.loadIds || [existing.id]), ...(load.loadIds || [load.id])];
    existing.jobs = [...existing.jobs, ...load.jobs];
    existing.jobCount = existing.jobs.length;
    existing.totalUnits += load.totalUnits;
    existing.collectedCount += load.collectedCount;
    existing.loaded = Boolean(existing.loaded && load.loaded);
    existing.scheduledEnd = [existing.scheduledEnd, load.scheduledEnd].filter(Boolean).sort().at(-1) as string | undefined;
    existing.readiness = existing.collectedCount < existing.jobCount ? "awaiting_collection" : "ready";
    return groups;
  }, new Map<string, LogisticsProjectionLoad>()).values()];
  const exceptions = jobs.flatMap((job) => [
    ...(!job.originOplocId || !job.destinationOplocId ? [`${job.id}: missing canonical OPLOC`] : []),
    ...(!job.requestedWindow?.startTime ? [`${job.id}: unresolved timing`] : []),
  ]);
  const now = input.now || new Date().toISOString();
  const validEmpty = jobs.length === 0 && mergedLoads.length === 0 && (input.runs || []).filter((run) => run.serviceDate === input.serviceDate).length === 0;
  const sourceLineage = [...new Map(jobs.filter((job) => job.sourceVersion !== undefined).map((job) => [`${job.sourceType}:${job.sourceId}`, { sourceDomain: job.sourceType, sourceEntityId: job.sourceId, sourceVersion: job.sourceVersion!, changedAt: job.updatedAt } satisfies LogisticsSourceLineage])).values()].slice(0, 200);
  return { serviceDate: input.serviceDate, revision: input.revision || 1, lastChangeSequence: input.lastChangeSequence || 0, state: validEmpty ? "VALID_EMPTY" as const : "CURRENT" as const, completeness: { fulfilment: "complete" as const, cpu: "not_required" as const, oploc: "complete" as const }, sourceLineage, reconciliation: { status: "current" as const, checkedAt: now }, planningQueue: queue, deliveryLoads: mergedLoads, runs: (input.runs || []).filter((run) => run.serviceDate === input.serviceDate).map((run) => ({ canonicalId: run.canonicalId, status: run.status, driverId: run.driverId, driverLabel: run.driverLabel, vehicleLabel: run.vehicleLabel })), exceptions: Array.from(new Set(exceptions)), summary: { queuedJobs: queue.length, loads: mergedLoads.length, assignedJobs: jobs.length - queue.length, collectedJobs: jobs.filter((job) => job.collectionStatus === "collected").length }, rebuiltAt: now };
}

export type LogisticsProjectionInvalidation = { serviceDate: string; sourceDomain: string; sourceEntityId: string; sourceVersion: number; sourceContentHash?: string; changedAt: string; changeType: "amended" | "cancelled" | "withdrawn" | "superseded" | "status-changed" };

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
  return { ...projection, planningQueue: [], deliveryLoads, runs, summary: { ...projection.summary, queuedJobs: 0, loads: deliveryLoads.length, assignedJobs: deliveryLoads.reduce((total, load) => total + load.jobCount, 0), collectedJobs: deliveryLoads.reduce((total, load) => total + load.collectedCount, 0) } };
}

/** Replays one change without changing the canonical records. Rebuilding the compact day from supplied canonical slices is deterministic and safe for duplicate replay. */
export function applyLogisticsChange(projection: LogisticsDayProjection, event: LogisticsChangeEvent, canonical: Parameters<typeof buildLogisticsDayProjection>[0]) {
  if (event.sequence <= projection.lastChangeSequence) return projection;
  return buildLogisticsDayProjection({ ...canonical, serviceDate: projection.serviceDate, lastChangeSequence: event.sequence, revision: projection.revision + 1 });
}
