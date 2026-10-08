import { explainAssignedLoadCompatibility } from "./delivery-loads";
import type { DeliveryLoad, LogisticsAssignment, LogisticsDayProjection, LogisticsJob } from "./types";

type AssignmentRow = { id: string; data: LogisticsAssignment };
const jobEvidence = (job: LogisticsJob) => ({
  id: job.id, sourceStatus: job.sourceStatus ?? null, serviceDate: job.serviceDate ?? null,
  originOplocId: job.originOplocId ?? null, destinationOplocId: job.destinationOplocId ?? null,
  requestedWindow: job.requestedWindow ?? null, sourceVersion: job.sourceVersion ?? null,
  requirementId: job.requirementId ?? null,
});
const loadEvidence = (load: DeliveryLoad) => ({
  id: load.id, status: load.status ?? null, serviceDate: load.serviceDate ?? null,
  originOplocId: load.originOplocId ?? null, destinationOplocId: load.destinationOplocId ?? null,
  scheduledTime: load.scheduledTime ?? null, scheduledEnd: load.scheduledEnd ?? null,
  runId: load.runId ?? null, vehicleId: load.vehicleId ?? null, version: load.version ?? null,
});
const differences = (expected: Set<string>, actual: Set<string>) => ({
  missingFromProjection: [...expected].filter(id => !actual.has(id)),
  projectionOnly: [...actual].filter(id => !expected.has(id)),
});

/** No persistence: explains the same date filters, multiplicity and compatibility used by the projection. */
export function assignmentIntegrityDiagnostic(input: {
  serviceDate: string; assignments: AssignmentRow[]; jobs: Map<string, LogisticsJob>;
  loads: Map<string, DeliveryLoad>; nativeRequirementIds: Set<string>;
  projection?: LogisticsDayProjection; headSequence: number;
}) {
  const counts = new Map<string, number>(), projectionCounts = new Map<string, number>();
  for (const { data } of input.assignments) {
    counts.set(data.jobId, (counts.get(data.jobId) || 0) + 1);
    if (data.serviceDate === input.serviceDate) projectionCounts.set(data.jobId, (projectionCounts.get(data.jobId) || 0) + 1);
  }
  const assignments = input.assignments.map(({ id, data }) => {
    const job = input.jobs.get(data.jobId), load = input.loads.get(data.loadId);
    const evaluation = job && load ? explainAssignedLoadCompatibility(job, load) : undefined;
    const multiplicity = counts.get(data.jobId) || 0;
    const projectionMultiplicity = projectionCounts.get(data.jobId) || 0;
    const reasons: string[] = [];
    if (projectionMultiplicity > 1) reasons.push("duplicate_assignment_for_job");
    if (!job) reasons.push("missing_job");
    if (!load) reasons.push("missing_load");
    if (!data.serviceDate) reasons.push("missing_assignment_service_date");
    else if (data.serviceDate !== input.serviceDate) reasons.push("assignment_service_date_mismatch");
    if (job && job.serviceDate !== input.serviceDate) reasons.push("job_outside_requested_service_date");
    if (load && load.serviceDate !== input.serviceDate) reasons.push("load_outside_requested_service_date");
    reasons.push(...(evaluation?.reasons || []));
    // Projection counts only its date-scoped input. Undated historical rows remain evidence,
    // but do not silently enter that input or invalidate an otherwise unique dated row.
    const acceptedByProjection = data.serviceDate === input.serviceDate && projectionMultiplicity === 1 &&
      job?.serviceDate === input.serviceDate && load?.serviceDate === input.serviceDate && evaluation?.compatible === true;
    return { id, jobId: data.jobId, loadId: data.loadId, assignmentServiceDate: data.serviceDate ?? null,
      assignmentMultiplicity: multiplicity, projectionAssignmentMultiplicity: projectionMultiplicity,
      duplicate: multiplicity > 1, jobExists: Boolean(job), loadExists: Boolean(load),
      job: job ? jobEvidence(job) : null, load: load ? loadEvidence(load) : null,
      // Existing unscheduled membership remains valid; acceptance also accounts for input and duplicates.
      compatible: evaluation?.compatible ?? false, acceptedByProjection,
      checks: evaluation?.checks ?? null, failureReasons: Array.from(new Set(reasons)),
      warnings: [...(evaluation?.warnings || []), ...(multiplicity > projectionMultiplicity && multiplicity > 1 ? ["additional_assignment_outside_projection_input"] : [])] };
  });
  const dayJobs = [...input.jobs.values()].filter(job => job.serviceDate === input.serviceDate && job.sourceStatus !== "withdrawn");
  const assignedIds = new Set(assignments.filter(row => row.acceptedByProjection).map(row => row.jobId));
  const trulyUnassignedJobs = dayJobs.filter(job => !counts.has(job.id)).map(jobEvidence);
  const invalidAssignedJobs = dayJobs.filter(job => counts.has(job.id) && !assignedIds.has(job.id)).map(jobEvidence);
  const projectionCards = (input.projection?.deliveryLoads || []).map(card => ({
    id: card.id, loadIds: card.loadIds?.length ? card.loadIds : [card.id], jobIds: card.jobs.map(job => job.id),
    runId: card.runId ?? null, vehicleId: card.vehicleId ?? null,
    scheduledTime: card.scheduledTime, scheduledEnd: card.scheduledEnd ?? null,
    originOplocId: card.originOplocId, destinationOplocId: card.destinationOplocId,
    destinationLabel: card.destinationLabelSnapshot ?? null,
  }));
  const expectedLoadIds = new Set(assignments.filter(row => row.acceptedByProjection).map(row => row.loadId));
  const projectedLoadIds = new Set(projectionCards.flatMap(card => card.loadIds));
  const expectedQueueIds = new Set(dayJobs.filter(job => !assignedIds.has(job.id) && !input.nativeRequirementIds.has(job.requirementId || "")).map(job => job.id));
  const expectedJobIds = new Set([...assignedIds, ...expectedQueueIds]);
  const projectedJobIds = new Set([...(input.projection?.planningQueue || []).map(job => job.id), ...projectionCards.flatMap(card => card.jobIds)]);
  const coverage = {
    jobs: differences(expectedJobIds, projectedJobIds),
    loads: differences(expectedLoadIds, projectedLoadIds),
    queue: differences(expectedQueueIds, new Set((input.projection?.planningQueue || []).map(job => job.id))),
    expectedLoadIds: [...expectedLoadIds], projectedLoadIds: [...projectedLoadIds],
    excludedActiveLoadIds: [...input.loads.values()].filter(load => load.serviceDate === input.serviceDate && load.status !== "cancelled" && !expectedLoadIds.has(load.id)).map(load => load.id),
    projectedCardCount: projectionCards.length,
  };
  const current = input.projection && !["STALE", "PARTIAL", "UNAVAILABLE"].includes(input.projection.state || "CURRENT") && input.projection.lastChangeSequence >= input.headSequence;
  const covered = [coverage.jobs, coverage.loads, coverage.queue].every(value => !value.missingFromProjection.length && !value.projectionOnly.length);
  return { assignments, trulyUnassignedJobs, invalidAssignedJobs, projectionCards, coverage,
    summary: { persistedAssignments: assignments.length, acceptedAssignments: assignments.filter(row => row.acceptedByProjection).length,
      rejectedAssignments: assignments.filter(row => !row.acceptedByProjection).length,
      validAssignedJobs: assignedIds.size, invalidAssignedJobs: invalidAssignedJobs.length, trulyUnassignedJobs: trulyUnassignedJobs.length },
    projectionStatus: !input.projection ? "Projection missing" : current && covered ? "In sync" : "Projection out of sync" };
}
