import type { DeliveryLoad, DeliveryRun, LogisticsAssignment, LogisticsChangeEvent, LogisticsDayProjection, LogisticsJob, LogisticsProjectionJob, LogisticsProjectionLoad } from "./types";

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
    return { id: load.id, loadIds: [load.id], serviceDate: load.serviceDate, originOplocId: load.originOplocId, destinationOplocId: load.destinationOplocId, destinationLabelSnapshot: load.destinationLabelSnapshot, scheduledTime: load.scheduledTime, scheduledEnd: load.scheduledEnd, loaded: load.loaded, status: load.status, driverId: load.driverId, vehicleId: load.vehicleId, runId: load.runId, jobs: childJobs.map((job) => ({ id: job.id, sourceType: job.sourceType, sourceId: job.sourceId, collectionStatus: job.collectionStatus, productionReadiness: job.productionReadiness, contents: job.contents, ...(job.notes ? { notes: job.notes } : {}), totalUnits: totalUnits(job) })), jobCount: childJobs.length, totalUnits: childJobs.reduce((sum, job) => sum + totalUnits(job), 0), collectedCount, readiness: collectedCount < childJobs.length ? "awaiting_collection" as const : "ready" as const };
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
  return { serviceDate: input.serviceDate, revision: input.revision || 1, lastChangeSequence: input.lastChangeSequence || 0, planningQueue: queue, deliveryLoads: mergedLoads, runs: (input.runs || []).filter((run) => run.serviceDate === input.serviceDate).map((run) => ({ canonicalId: run.canonicalId, status: run.status, driverId: run.driverId, driverLabel: run.driverLabel, vehicleLabel: run.vehicleLabel })), exceptions: Array.from(new Set(exceptions)), summary: { queuedJobs: queue.length, loads: mergedLoads.length, assignedJobs: jobs.length - queue.length, collectedJobs: jobs.filter((job) => job.collectionStatus === "collected").length }, rebuiltAt: now };
}

/** Replays one change without changing the canonical records. Rebuilding the compact day from supplied canonical slices is deterministic and safe for duplicate replay. */
export function applyLogisticsChange(projection: LogisticsDayProjection, event: LogisticsChangeEvent, canonical: Parameters<typeof buildLogisticsDayProjection>[0]) {
  if (event.sequence <= projection.lastChangeSequence) return projection;
  return buildLogisticsDayProjection({ ...canonical, serviceDate: projection.serviceDate, lastChangeSequence: event.sequence, revision: projection.revision + 1 });
}
