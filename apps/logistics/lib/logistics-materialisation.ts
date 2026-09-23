import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { CPU_PRODUCTION_LOCATION_ID, CPU_SITE_OPLOC_ID } from "../../shared/production-location";
import { buildLogisticsDayProjection, type LogisticsProjectionInvalidation } from "./logistics-projection";
import {
  appendLogisticsChange,
  getLogisticsProjection,
  listDeliveryLoadState,
  listCollectionPreferenceKeys,
  listState,
  logisticsJobs,
  saveLogisticsJob,
  saveLogisticsProjection,
} from "./store";
import { fetchOplocs, fetchRequirements } from "./upstream";
import type { LogisticsJob } from "./types";

export function activeLogisticsRequirements(requirements: FulfilmentRequirement[]) {
  return requirements.filter((requirement) => {
    if (requirement.status === "withdrawn") return false;
    // The CPU site fulfils its own demand locally. Movement Requests remain a
    // separate Logistics-owned collection and are not filtered here.
    if (requirement.destinationOplocId === CPU_SITE_OPLOC_ID) return false;
    // Fulfilment Requirement is the existence authority. CPU Production is
    // optional enrichment and must never remove canonical delivery work.
    return true;
  });
}

export function logisticsJobForRequirement(
  requirement: FulfilmentRequirement,
  prior: LogisticsJob | undefined,
  by: string,
  now: string,
) {
  const readiness = requirement.status === "pending" ? "pending" as const : requirement.status === "amended" ? "attention" as const : "ready" as const;
  const originOplocId = requirement.productionLocationId || CPU_PRODUCTION_LOCATION_ID;
  return {
    id: prior?.id || `logistics-job:${requirement.canonicalId}`,
    sourceType: requirement.sourceDomain,
    sourceId: requirement.sourceEntityId,
    sourceVersion: requirement.sourceVersion,
    ...(requirement.sourceContentHash ? { sourceContentHash: requirement.sourceContentHash } : {}),
    serviceDate: requirement.serviceDate,
    ...(originOplocId ? { originOplocId } : {}),
    destinationOplocId: requirement.destinationOplocId,
    destinationLabelSnapshot: requirement.destinationLabelSnapshot,
    ...(requirement.requiredDeliveryWindow ? { requestedWindow: requirement.requiredDeliveryWindow } : requirement.readyAt ? { requestedWindow: { startTime: requirement.readyAt.slice(11, 16) } } : {}),
    productionReadiness: readiness,
    collectionStatus: prior?.collectionStatus || "awaiting" as const,
    contents: requirement.lines.map((line) => ({ description: line.displayNameSnapshot, quantity: line.quantity, unit: line.unit })),
    createdAt: prior?.createdAt || now,
    updatedAt: now,
    version: (prior?.version || 0) + 1,
    audit: [...(prior?.audit || []), { action: prior ? "reconciled-job-updated" : "reconciled-job-created", at: now, by, version: (prior?.version || 0) + 1 }],
  } as LogisticsJob;
}

function jobMaterialisationContent(job: LogisticsJob) {
  return JSON.stringify({
    sourceType: job.sourceType,
    sourceId: job.sourceId,
    sourceVersion: job.sourceVersion,
    sourceContentHash: job.sourceContentHash,
    serviceDate: job.serviceDate,
    originOplocId: job.originOplocId,
    destinationOplocId: job.destinationOplocId,
    destinationLabelSnapshot: job.destinationLabelSnapshot,
    requestedWindow: job.requestedWindow,
    productionReadiness: job.productionReadiness,
    contents: job.contents,
    notes: job.notes,
  });
}

export function logisticsJobMaterialisationEqual(left: LogisticsJob, right: LogisticsJob) {
  return jobMaterialisationContent(left) === jobMaterialisationContent(right);
}

/** Rebuild from Logistics-owned records without reading upstream systems. */
export async function rebuildLogisticsProjection(serviceDate: string, _actorId: string, lastChangeSequence?: number) {
  const [state, legacyState, previous, collectionRequiredKeys] = await Promise.all([
    listDeliveryLoadState(serviceDate),
    listState(serviceDate),
    getLogisticsProjection(serviceDate),
    listCollectionPreferenceKeys(serviceDate),
  ]);
  const effectiveSequence = Math.max(lastChangeSequence || 0, previous?.lastChangeSequence || 0);
  return saveLogisticsProjection(buildLogisticsDayProjection({
    serviceDate,
    ...state,
    runs: legacyState.runs,
    stops: legacyState.stops,
    movements: legacyState.movements,
    collectionRequiredKeys,
    lastChangeSequence: effectiveSequence,
    now: new Date().toISOString(),
    revision: Math.max(previous?.revision || 0, effectiveSequence) + 1,
  }));
}

/** Materialise one bounded service day from Hub fulfilment, CPU context and governed OPLOCs. */
export async function reconcileLogisticsDay(serviceDate: string, by: string, actorId = "system:reconcile", cookie?: string, sourceChange?: LogisticsProjectionInvalidation, sourceChanges: LogisticsProjectionInvalidation[] = []) {
  const [requirements, oplocs, existingState] = await Promise.all([
    fetchRequirements(serviceDate, cookie),
    fetchOplocs(cookie),
    listDeliveryLoadState(serviceDate),
  ]);
  const existing = existingState.jobs;
  const assignedJobIds = new Set(existingState.assignments.map((assignment) => assignment.jobId));
  const activeRequirements = activeLogisticsRequirements(requirements.filter((item) => item.serviceDate === serviceDate));
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
    const next = logisticsJobForRequirement({
      ...requirement,
      destinationLabelSnapshot: oplocs.find((oploc) => oploc.id === requirement.destinationOplocId)?.label || requirement.destinationLabelSnapshot,
    }, prior, by, now);
    if (prior && logisticsJobMaterialisationEqual(prior, next)) continue;
    await saveLogisticsJob(next);
    const event = await appendLogisticsChange({ serviceDate: next.serviceDate, entityType: "logisticsJob", entityId: next.id, changeType: prior ? "reconciled-job-updated" : "reconciled-job-created", revision: next.version, changedAt: now, actorId });
    lastChangeSequence = Math.max(lastChangeSequence, event.sequence);
    if (prior) updated++;
    else created++;
  }

  for (const job of existing) {
    if (assignedJobIds.has(job.id) || reconciledRequirements.some((requirement) => requirement.sourceDomain === job.sourceType && requirement.sourceEntityId === job.sourceId)) continue;
    if (job.destinationOplocId === CPU_SITE_OPLOC_ID || job.sourceType === "cpu-production" || (job.sourceType === "grab-and-go" && hasNativeGrabAndGo({ sourceDomain: "grab-and-go", sourceEntityId: job.sourceId, serviceDate: job.serviceDate, destinationOplocId: job.destinationOplocId } as FulfilmentRequirement))) {
      await logisticsJobs().doc(job.id).delete();
      const event = await appendLogisticsChange({ serviceDate: job.serviceDate, entityType: "logisticsJob", entityId: job.id, changeType: "stale-upstream-job-removed", revision: job.version + 1, changedAt: now, actorId });
      lastChangeSequence = Math.max(lastChangeSequence, event.sequence);
    }
  }
  let projection = await rebuildLogisticsProjection(serviceDate, by, lastChangeSequence);
  const lineageChanges = [...sourceChanges, ...(sourceChange ? [sourceChange] : [])];
  if (lineageChanges.length) {
    const nextLineage = [...(projection.sourceLineage || [])];
    for (const change of lineageChanges) {
      const prior = nextLineage.find((item) => item.sourceDomain === change.sourceDomain && item.sourceEntityId === change.sourceEntityId);
      if (prior && prior.sourceVersion >= change.sourceVersion) continue;
      for (let index = nextLineage.length - 1; index >= 0; index--) {
        if (nextLineage[index].sourceDomain === change.sourceDomain && nextLineage[index].sourceEntityId === change.sourceEntityId) nextLineage.splice(index, 1);
      }
      nextLineage.push({ sourceDomain: change.sourceDomain, sourceEntityId: change.sourceEntityId, sourceVersion: change.sourceVersion, ...(change.sourceContentHash ? { sourceContentHash: change.sourceContentHash } : {}), changedAt: change.changedAt });
    }
    projection = await saveLogisticsProjection({ ...projection, sourceLineage: nextLineage.slice(-200) });
  }
  return { created, updated, projection, requirements };
}
