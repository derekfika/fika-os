import type { DeliveryLoad, LogisticsAssignment, LogisticsJob } from "./types";
import { HttpError } from "./http-error";

export type LoadKey = Pick<DeliveryLoad, "serviceDate" | "originOplocId" | "destinationOplocId" | "scheduledTime" | "scheduledEnd" | "runId" | "vehicleId" | "collectionRequired">;

/** Source timing constrains arrival, never the Logistics-owned service duration. */
export function arrivalWithinSource(window: LogisticsJob["requestedWindow"], arrival: string) {
  const valid = (time: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  return valid(arrival) && (!window || valid(window.startTime) && (!window.endTime || valid(window.endTime) && window.endTime >= window.startTime) && arrival >= window.startTime && (!window.endTime || arrival <= window.endTime));
}

/** Immutable creation identity; subsequent explicit CAS rescheduling preserves this ID. */
export function deliveryLoadId(plan: LoadKey) {
  return `load:v2:${encodeURIComponent(JSON.stringify([plan.serviceDate, plan.originOplocId, plan.destinationOplocId, plan.runId || null, plan.vehicleId || null, plan.scheduledTime, plan.scheduledEnd || null, Boolean(plan.collectionRequired)]))}`;
}

export function assertLoadVersion(load: DeliveryLoad, expected?: number) {
  if (!Number.isInteger(expected)) throw new HttpError(422, "The current delivery load version is required.");
  if (load.version !== expected) throw new HttpError(409, "Delivery load changed. Refresh Logistics and retry.");
}

/** The production predicates also supply read-only administrative explanations. */
function loadCompatibility(job: LogisticsJob, load: DeliveryLoad, retainUnscheduled: boolean) {
  const checks = {
    jobActive: job.sourceStatus !== "withdrawn",
    loadActive: load.status !== "cancelled",
    canonicalLocationsPresent: Boolean(job.originOplocId && job.destinationOplocId),
    serviceDateMatch: job.serviceDate === load.serviceDate,
    originMatch: job.originOplocId === load.originOplocId,
    destinationMatch: job.destinationOplocId === load.destinationOplocId,
    scheduledArrivalPresent: retainUnscheduled && load.scheduledTime === undefined || Boolean(load.scheduledTime && arrivalWithinSource(undefined, load.scheduledTime)),
    arrivalWithinRequestedWindow: arrivalWithinSource(job.requestedWindow, load.scheduledTime),
  };
  const reasons: string[] = [];
  if (!checks.jobActive) reasons.push("job_withdrawn");
  if (!checks.loadActive) reasons.push("load_cancelled");
  if (!checks.canonicalLocationsPresent || !load.originOplocId || !load.destinationOplocId) reasons.push("missing_canonical_origin_or_destination");
  if (!checks.serviceDateMatch) reasons.push("service_date_mismatch");
  if (!checks.originMatch) reasons.push("origin_oploc_mismatch");
  if (!checks.destinationMatch) reasons.push("destination_oploc_mismatch");
  // Upstream timing is retained as source context, but Fulfilment Requirement
  // has no hard-constraint contract. Logistics owns the operational arrival.
  const warnings = load.scheduledTime && job.requestedWindow && !checks.arrivalWithinRequestedWindow
    ? ["scheduled_arrival_outside_advisory_requested_window"]
    : [];
  const compatible = Object.entries(checks).every(([key, value]) => key === "arrivalWithinRequestedWindow" || value);
  return { compatible, checks, reasons, warnings };
}

export function explainLoadCompatibility(job: LogisticsJob, load: DeliveryLoad) {
  return loadCompatibility(job, load, false);
}

/** Clearing a placement retains existing membership; assigning or dispatching still requires a valid arrival. */
export function explainAssignedLoadCompatibility(job: LogisticsJob, load: DeliveryLoad) {
  return loadCompatibility(job, load, true);
}

export function compatibleAssignedLoad(job: LogisticsJob, load: DeliveryLoad) {
  return explainAssignedLoadCompatibility(job, load).compatible;
}

export function compatibleLoad(job: LogisticsJob, load: DeliveryLoad) {
  return explainLoadCompatibility(job, load).compatible;
}

export function findCompatibleLoad(job: LogisticsJob, loads: DeliveryLoad[]) {
  if (!job.originOplocId || !job.destinationOplocId) return undefined;
  return loads.find((load) => load.status !== "cancelled" && compatibleLoad(job, load));
}

export function createLoad(input: LoadKey & { destinationLabelSnapshot?: string; scheduledEnd?: string; by: string; now?: string }): DeliveryLoad {
  if (!input.originOplocId || !input.destinationOplocId || !input.scheduledTime)
    throw new Error("A load requires canonical origin and destination OPLOC IDs and a scheduled time.");
  const now = input.now || new Date().toISOString();
  const id = deliveryLoadId(input);
  return { id, serviceDate: input.serviceDate, originOplocId: input.originOplocId, destinationOplocId: input.destinationOplocId, ...(input.collectionRequired ? { collectionRequired: true } : {}), ...(input.runId ? { runId: input.runId } : {}), ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}), ...(input.destinationLabelSnapshot ? { destinationLabelSnapshot: input.destinationLabelSnapshot } : {}), scheduledTime: input.scheduledTime, ...(input.scheduledEnd ? { scheduledEnd: input.scheduledEnd } : {}), status: "planned", createdAt: now, updatedAt: now, version: 1, audit: [{ action: "load-created", at: now, by: input.by, version: 1 }] };
}

export function assignJob(job: LogisticsJob, load: DeliveryLoad, existing: LogisticsAssignment[], by: string, now = new Date().toISOString()) {
  if (!compatibleLoad(job, load)) throw new Error("Job is not compatible with this delivery load.");
  const prior = existing.find((item) => item.jobId === job.id);
  if (prior?.loadId === load.id) return { assignment: prior, load, movedFrom: undefined };
  const assignment: LogisticsAssignment = { jobId: job.id, loadId: load.id, serviceDate: load.serviceDate, assignedAt: now, assignedBy: by, audit: [{ action: prior ? "job-moved" : "job-assigned", at: now, by }] };
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
  return { jobCount: childJobs.length, totalUnits: portions, collectedCount: collected, collectionTotal: childJobs.length, productionWarnings: warnings, readyToDispatch: childJobs.length > 0 && childJobs.every(job => job.deliveryStatus === "loaded" || job.deliveryStatus === "delivered") && warnings === 0 };
}

export function setJobCollectionStatus(job: LogisticsJob, status: LogisticsJob["collectionStatus"], by: string, now = new Date().toISOString()): LogisticsJob {
  if (job.collectionStatus === status) return job;
  return { ...job, collectionStatus: status, updatedAt: now, version: job.version + 1, audit: [...job.audit, { action: "collection-status-changed", at: now, by, version: job.version + 1 }] };
}

export function assertDispatchable(load: DeliveryLoad, jobs: LogisticsJob[], assignments: LogisticsAssignment[]) {
  const members = assignments.filter(a => a.loadId === load.id);
  if (members.some(a => assignments.filter(other => other.jobId === a.jobId).length !== 1 || jobs.some(job => job.id === a.jobId && job.activeLoadId && job.activeLoadId !== load.id))) throw new HttpError(409, "Load assignment integrity requires review.");
  if (assignments.some(a => a.loadId === load.id && !jobs.some(j => j.id === a.jobId && compatibleLoad(j, load)))) throw new Error("Load assignment no longer agrees with current source truth.");
  const summary = loadSummary(load, jobs, assignments);
  if (!summary.jobCount) throw new Error("An empty delivery load cannot be dispatched.");
  if (members.some(member => !jobs.some(job => job.id === member.jobId && (job.deliveryStatus === "loaded" || job.deliveryStatus === "delivered")))) throw new Error("Every delivery job must be loaded before dispatch.");
  if (summary.productionWarnings) throw new Error(`${summary.productionWarnings} job(s) are not production-ready.`);
}

export function aggregateDelivery(load: DeliveryLoad, jobs: LogisticsJob[]): DeliveryLoad {
  if (load.status === "cancelled") return { ...load, loaded: false };
  return { ...load, loaded: jobs.length > 0 && jobs.every(job => job.deliveryStatus === "loaded" || job.deliveryStatus === "delivered"), status: (jobs.length > 0 && jobs.every(job => job.deliveryStatus === "delivered")) ? "delivered" : load.status === "delivered" ? load.dispatchedAt ? "dispatched" : "planned" : load.status, deliveredAt: (jobs.length > 0 && jobs.every(job => job.deliveryStatus === "delivered")) ? load.deliveredAt || jobs.map(job => job.deliveredAt || "").sort().at(-1) : undefined };
}
