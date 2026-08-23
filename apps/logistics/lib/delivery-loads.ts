import type { DeliveryLoad, LogisticsAssignment, LogisticsJob } from "./types";

export type LoadKey = Pick<DeliveryLoad, "serviceDate" | "originOplocId" | "destinationOplocId" | "scheduledTime">;

export function compatibleLoad(job: LogisticsJob, load: DeliveryLoad) {
  return Boolean(job.originOplocId && job.destinationOplocId) &&
    job.serviceDate === load.serviceDate &&
    job.originOplocId === load.originOplocId &&
    job.destinationOplocId === load.destinationOplocId &&
    (job.requestedWindow?.startTime || undefined) === load.scheduledTime;
}

export function findCompatibleLoad(job: LogisticsJob, loads: DeliveryLoad[]) {
  if (!job.originOplocId || !job.destinationOplocId || !job.requestedWindow?.startTime) return undefined;
  return loads.find((load) => load.status !== "cancelled" && compatibleLoad(job, load));
}

export function createLoad(input: LoadKey & { destinationLabelSnapshot?: string; by: string; now?: string }): DeliveryLoad {
  if (!input.originOplocId || !input.destinationOplocId || !input.scheduledTime)
    throw new Error("A load requires canonical origin and destination OPLOC IDs and a scheduled time.");
  const now = input.now || new Date().toISOString();
  const id = `load:${input.serviceDate}:${input.originOplocId}:${input.destinationOplocId}:${input.scheduledTime}`;
  return { id, serviceDate: input.serviceDate, originOplocId: input.originOplocId, destinationOplocId: input.destinationOplocId, ...(input.destinationLabelSnapshot ? { destinationLabelSnapshot: input.destinationLabelSnapshot } : {}), scheduledTime: input.scheduledTime, status: "planned", createdAt: now, updatedAt: now, version: 1, audit: [{ action: "load-created", at: now, by: input.by, version: 1 }] };
}

export function assignJob(job: LogisticsJob, load: DeliveryLoad, existing: LogisticsAssignment[], by: string, now = new Date().toISOString()) {
  if (!compatibleLoad(job, load)) throw new Error("Job is not compatible with this delivery load.");
  const prior = existing.find((item) => item.jobId === job.id);
  if (prior?.loadId === load.id) return { assignment: prior, load, movedFrom: undefined };
  const assignment: LogisticsAssignment = { jobId: job.id, loadId: load.id, assignedAt: now, assignedBy: by, audit: [{ action: prior ? "job-moved" : "job-assigned", at: now, by }] };
  return { assignment, load: { ...load, updatedAt: now, version: load.version + 1, audit: [...load.audit, { action: prior ? "job-moved" : "job-assigned", at: now, by, version: load.version + 1 }] }, movedFrom: prior?.loadId };
}

export function removeAssignment(assignments: LogisticsAssignment[], jobId: string, by: string, now = new Date().toISOString()) {
  const prior = assignments.find((item) => item.jobId === jobId);
  if (!prior) return { assignments, removed: undefined };
  return { assignments: assignments.filter((item) => item.jobId !== jobId), removed: { ...prior, audit: [...prior.audit, { action: "job-removed", at: now, by }] } };
}

export function loadSummary(load: DeliveryLoad, jobs: LogisticsJob[], assignments: LogisticsAssignment[]) {
  const childJobs = assignments.filter((a) => a.loadId === load.id).map((a) => jobs.find((j) => j.id === a.jobId)).filter(Boolean) as LogisticsJob[];
  const collected = childJobs.filter((job) => job.collectionStatus === "collected").length;
  const portions = childJobs.reduce((sum, job) => sum + job.contents.reduce((total, item) => total + item.quantity, 0), 0);
  const warnings = childJobs.filter((job) => job.productionReadiness !== "ready").length;
  return { jobCount: childJobs.length, totalUnits: portions, collectedCount: collected, collectionTotal: childJobs.length, productionWarnings: warnings, readyToDispatch: childJobs.length > 0 && collected === childJobs.length && warnings === 0 };
}

export function setJobCollectionStatus(job: LogisticsJob, status: LogisticsJob["collectionStatus"], by: string, now = new Date().toISOString()): LogisticsJob {
  if (job.collectionStatus === status) return job;
  return { ...job, collectionStatus: status, updatedAt: now, version: job.version + 1, audit: [...job.audit, { action: "collection-status-changed", at: now, by, version: job.version + 1 }] };
}

export function assertDispatchable(load: DeliveryLoad, jobs: LogisticsJob[], assignments: LogisticsAssignment[]) {
  const summary = loadSummary(load, jobs, assignments);
  if (!summary.jobCount) throw new Error("An empty delivery load cannot be dispatched.");
  if (summary.collectedCount !== summary.collectionTotal) throw new Error(`${summary.collectionTotal - summary.collectedCount} job(s) in this load have not been collected.`);
  if (summary.productionWarnings) throw new Error(`${summary.productionWarnings} job(s) are not production-ready.`);
}
