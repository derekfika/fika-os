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
  deliveryLoads,
  logisticsAssignments,
  runs,
  stops,
  normalizeStop,
  saveLogisticsJob,
  saveLogisticsProjection,
} from "./store";
import { fetchOplocs, fetchRequirements } from "./upstream";
import { db } from "./firebase";
import { movementDisplaySnapshots } from "./movement-labels";
import type { GovernedOploc } from "./upstream";
import { aggregateDelivery, compatibleAssignedLoad, compatibleLoad } from "./delivery-loads";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsJob } from "./types";

export function activeLogisticsRequirements(requirements: FulfilmentRequirement[]) {
  return requirements.filter((requirement) => {
    if (requirement.status === "withdrawn") return false;
    // FIKA Xchange is local CPU production. It is not a delivery requirement;
    // every other active Fulfilment Requirement remains Logistics work.
    return requirement.destinationOplocId !== CPU_SITE_OPLOC_ID;
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
    requirementId: requirement.canonicalId,
    sourceStatus: requirement.status,
    ...(prior?.activeLoadId ? { activeLoadId: prior.activeLoadId } : {}),
    sourceType: requirement.sourceDomain,
    sourceId: requirement.sourceEntityId,
    sourceVersion: requirement.sourceVersion,
    ...(requirement.sourceContentHash ? { sourceContentHash: requirement.sourceContentHash } : {}),
    ...(requirement.workstream ? { workstream: requirement.workstream } : {}),
    serviceDate: requirement.serviceDate,
    ...(originOplocId ? { originOplocId } : {}),
    destinationOplocId: requirement.destinationOplocId,
    destinationLabelSnapshot: requirement.destinationLabelSnapshot,
    ...(requirement.requiredDeliveryWindow ? { requestedWindow: requirement.requiredDeliveryWindow } : requirement.readyAt ? { requestedWindow: { startTime: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(requirement.readyAt)) } } : {}),
    productionReadiness: readiness,
    deliveryStatus: prior?.deliveryStatus || "pending",
    ...(prior?.deliveredAt ? { deliveredAt: prior.deliveredAt } : {}),
    collectionStatus: prior?.collectionStatus || "awaiting" as const,
    ...(prior?.notes ? { notes: prior.notes } : {}),
    contents: requirement.lines.map((line) => ({ description: line.displayNameSnapshot, quantity: line.quantity, unit: line.unit })),
    createdAt: prior?.createdAt || now,
    updatedAt: now,
    version: (prior?.version || 0) + 1,
    audit: [...(prior?.audit || []), { action: prior ? "reconciled-job-updated" : "reconciled-job-created", at: now, by, version: (prior?.version || 0) + 1 }],
  } as LogisticsJob;
}

function jobMaterialisationContent(job: LogisticsJob) {
  return JSON.stringify({
    requirementId: job.requirementId,
    sourceStatus: job.sourceStatus,
    sourceType: job.sourceType,
    sourceId: job.sourceId,
    sourceVersion: job.sourceVersion,
    sourceContentHash: job.sourceContentHash,
    workstream: job.workstream,
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
export async function rebuildLogisticsProjection(serviceDate: string, _actorId: string, lastChangeSequence?: number, oplocs?: GovernedOploc[]) {
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
    movements: movementDisplaySnapshots(legacyState.movements, previous?.movements, oplocs),
    collectionRequiredKeys,
    lastChangeSequence: effectiveSequence,
    now: new Date().toISOString(),
    revision: Math.max(previous?.revision || 0, effectiveSequence) + 1,
  }));
}

/** Materialise one bounded service day from Hub fulfilment, CPU context and governed OPLOCs. */
export async function reconcileLogisticsDay(serviceDate: string, by: string, actorId = "system:reconcile", cookie?: string, sourceChange?: LogisticsProjectionInvalidation, sourceChanges: LogisticsProjectionInvalidation[] = []) {
  const [requirements, oplocs, existingState, nativeState] = await Promise.all([
    fetchRequirements(serviceDate, cookie),
    fetchOplocs(cookie),
    listDeliveryLoadState(serviceDate),
    listState(serviceDate),
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

  // Match governed requirement identity first; a legacy source match is accepted
  // only when unambiguous. Source IDs can legitimately own multiple destinations.
  const allRequirements = requirements.filter(item => item.serviceDate === serviceDate && item.destinationOplocId !== CPU_SITE_OPLOC_ID);
  const candidates = [...reconciledRequirements, ...allRequirements.filter(item => item.status === "withdrawn")];
  const seen = new Set<string>();
  for (const requirement of candidates) {
    const sameSource = existing.filter(job => job.sourceType === requirement.sourceDomain && job.sourceId === requirement.sourceEntityId && !job.requirementId);
    const prior = existing.find(job => job.requirementId === requirement.canonicalId || job.id === `logistics-job:${requirement.canonicalId}`) || (sameSource.length === 1 && candidates.filter(item => item.sourceDomain === requirement.sourceDomain && item.sourceEntityId === requirement.sourceEntityId).length === 1 ? sameSource[0] : undefined);
    const id = prior?.id || `logistics-job:${requirement.canonicalId}`;
    seen.add(id);
    const result = await reconcileRequirementJob(id, { ...requirement, destinationLabelSnapshot: oplocs.find(oploc => oploc.id === requirement.destinationOplocId)?.label || requirement.destinationLabelSnapshot }, by, now, nativeState);
    if (!result) continue;
    const event = await appendLogisticsChange({ serviceDate, entityType: "logisticsJob", entityId: result.job.id, changeType: result.job.sourceStatus === "withdrawn" ? "reconciled-job-withdrawn" : result.created ? "reconciled-job-created" : "reconciled-job-updated", revision: result.job.version, changedAt: now, actorId });
    lastChangeSequence = Math.max(lastChangeSequence, event.sequence);
    if (result.created) created++; else updated++;
  }
  // Preserve the established CPU/native Grab & Go supersession cleanup, now
  // including assigned jobs and retaining historical evidence.
  for (const job of existing) {
    if (seen.has(job.id) || job.sourceStatus === "withdrawn") continue;
    if (job.sourceType === "cpu-production" || (job.sourceType === "grab-and-go" && hasNativeGrabAndGo({ serviceDate: job.serviceDate, destinationOplocId: job.destinationOplocId } as FulfilmentRequirement))) {
      const result = await reconcileRequirementJob(job.id, undefined, by, now, nativeState);
      if (!result) continue;
      updated++;
      const event = await appendLogisticsChange({ serviceDate, entityType: "logisticsJob", entityId: job.id, changeType: "reconciled-job-withdrawn", revision: result.job.version, changedAt: now, actorId });
      lastChangeSequence = Math.max(lastChangeSequence, event.sequence);
    }
  }
  const previous = await getLogisticsProjection(serviceDate);
  // Reuse this reconciliation's existing bounded reference read to recover old
  // projection labels. Authoritative movement versions/audits remain unchanged.
  const labelsChanged = previous && JSON.stringify(movementDisplaySnapshots(previous.movements || [], [], oplocs)) !== JSON.stringify(previous.movements || []);
  let projection = lastChangeSequence || !previous || previous.state === "STALE" || labelsChanged ? await rebuildLogisticsProjection(serviceDate, by, lastChangeSequence, oplocs) : previous;
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
    if (JSON.stringify(nextLineage) !== JSON.stringify(projection.sourceLineage || [])) projection = await saveLogisticsProjection({ ...projection, sourceLineage: nextLineage.slice(-200) });
  }
  return { created, updated, projection, requirements };
}

/** Internal convergence reads the current job and memberships in one transaction.
 * Operator CAS tokens do not apply here; older source revisions never overwrite newer truth.
 */
export async function reconcileRequirementJob(id: string, requirement: FulfilmentRequirement | undefined, by: string, now: string, nativeState?: { stops: DeliveryStop[]; runs: DeliveryRun[] }) {
  return db.runTransaction(async tx => {
    const ref = logisticsJobs().doc(id);
    const snapshot = await tx.get(ref);
    const prior = snapshot.exists ? snapshot.data() as LogisticsJob : undefined;
    if (!prior && (!requirement || requirement.status === "withdrawn")) return undefined;
    if (prior && requirement && (prior.sourceVersion || 0) > requirement.sourceVersion) return undefined;
    const next: LogisticsJob = requirement ? logisticsJobForRequirement(requirement, prior, by, now) : { ...prior!, sourceStatus: "withdrawn", updatedAt: now, version: prior!.version + 1, audit: [...prior!.audit, { action: "reconciled-job-withdrawn", at: now, by, version: prior!.version + 1 }] };
    const assignments = await tx.get(logisticsAssignments().where("jobId", "==", id));
    const invalid: Array<{ doc: import("firebase-admin/firestore").QueryDocumentSnapshot; load?: DeliveryLoad; members?: import("firebase-admin/firestore").QuerySnapshot; remainingJobs?: LogisticsJob[] }> = [];
    for (const doc of assignments.docs) {
      const loadId = doc.data().loadId;
      const loadSnapshot = await tx.get(deliveryLoads().doc(loadId));
      const load = loadSnapshot.exists ? loadSnapshot.data() as DeliveryLoad : undefined;
      if (!load || !compatibleAssignedLoad(next, load)) {
        const members = load ? await tx.get(logisticsAssignments().where("loadId", "==", load.id)) : undefined;
        const remainingJobs = members ? (await Promise.all(members.docs.filter(member => member.data().jobId !== id).map(member => tx.get(logisticsJobs().doc(member.data().jobId))))).filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as LogisticsJob) : [];
        invalid.push({ doc, load, members, remainingJobs });
      }
    }
    const requirementId = requirement?.canonicalId || prior?.requirementId;
    const nativeChanges: Array<{ stop: DeliveryStop; remove: boolean; refs: DeliveryStop["requirementRefs"] }> = [];
    const knownNative = nativeState?.stops.filter(stop => stop.requirementRefs.some(ref => ref.requirementId === requirementId));
    const nativeIds = new Set((knownNative || []).flatMap(stop => [stop.canonicalId, ...(stop.linkedStopId ? [stop.linkedStopId] : [])]));
    const nativeSnapshots = nativeState ? await Promise.all([...nativeIds].map(id => tx.get(stops().doc(id)))) : [];
    const dayRuns = nativeState ? { docs: await Promise.all([...new Set(nativeSnapshots.filter(doc => doc.exists).map(doc => doc.data()!.runId as string))].map(id => tx.get(runs().doc(id)))) } : requirementId ? await tx.get(runs().where("serviceDate", "==", next.serviceDate)) : undefined;
    const dayStops = nativeState ? nativeSnapshots.filter(doc => doc.exists).map(doc => normalizeStop(doc.data()!)) : dayRuns ? (await Promise.all(dayRuns.docs.map(doc => tx.get(stops().where("runId", "==", doc.id))))).flatMap(snapshot => snapshot.docs.map(doc => normalizeStop(doc.data()))) : [];
    for (const stop of dayStops.filter(stop => stop.requirementRefs.some(ref => ref.requirementId === requirementId))) {
      const arrival = stop.plannedArrivalTime || stop.plannedWindow?.startTime;
      const compatible = next.sourceStatus !== "withdrawn" && stop.locationOplocId === next.destinationOplocId && (!prior || prior.originOplocId === next.originOplocId && prior.serviceDate === next.serviceDate) && (!arrival || compatibleLoad(next, { serviceDate: next.serviceDate, originOplocId: next.originOplocId!, destinationOplocId: stop.locationOplocId, scheduledTime: arrival, status: "planned" } as DeliveryLoad));
      const refs = compatible ? stop.requirementRefs.map(ref => ref.requirementId === requirementId ? { ...ref, sourceVersion: next.sourceVersion || ref.sourceVersion } : ref) : stop.requirementRefs.filter(ref => ref.requirementId !== requirementId);
      if (JSON.stringify(refs) === JSON.stringify(stop.requirementRefs)) continue;
      nativeChanges.push({ stop, refs, remove: !refs.length && !stop.movementRequestIds.length });
      if (!refs.length && !stop.movementRequestIds.length && stop.linkedStopId) {
        const linked = dayStops.find(item => item.canonicalId === stop.linkedStopId);
        if (linked && !linked.requirementRefs.length && !linked.movementRequestIds.length) nativeChanges.push({ stop: linked, refs: [], remove: true });
      }
    }
    if (prior && logisticsJobMaterialisationEqual(prior, next) && !invalid.length && !nativeChanges.length) return undefined;
    for (const change of nativeChanges) {
      const stop = change.stop;
      if (change.remove) {
        tx.delete(stops().doc(stop.canonicalId));
        next.audit.push({ action: `native-assignment-invalidated:${stop.canonicalId}`, at: now, by, version: next.version });
      }
      else tx.set(stops().doc(stop.canonicalId), { ...stop, requirementRefs: change.refs, version: stop.version + 1, updatedAt: now, audit: [...stop.audit, { action: "source-reconciled", at: now, by, version: stop.version + 1 }] });
    }
    for (const doc of dayRuns?.docs || []) {
      if (!doc.exists) continue;
      const run = doc.data() as DeliveryRun;
      const changed = nativeChanges.filter(item => item.stop.runId === run.canonicalId);
      if (!changed.length) continue;
      tx.set(doc.ref, { ...run, orderedStopIds: run.orderedStopIds.filter(id => !changed.some(item => item.remove && item.stop.canonicalId === id)), version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: `source-reconciled:${requirementId}`, at: now, by, version: run.version + 1 }] });
    }
    for (const { doc } of invalid) {
      tx.delete(doc.ref);
      next.audit.push({ action: `source-assignment-invalidated:${doc.data().loadId}`, at: now, by, version: next.version });
    }
    // Aggregate removals by load: duplicate documents all leave in this commit.
    for (const { load, members, remainingJobs } of new Map(invalid.filter(item => item.load).map(item => [item.load!.id, item])).values()) {
      const remaining = members!.docs.filter(member => !invalid.some(item => item.doc.ref.path === member.ref.path));
      tx.set(deliveryLoads().doc(load!.id), aggregateDelivery({ ...load!, ...(!remaining.length ? { status: "cancelled" } : {}), updatedAt: now, version: load!.version + 1, audit: [...load!.audit, { action: "source-assignment-invalidated", at: now, by, version: load!.version + 1 }] }, remainingJobs || []));
    }
    if (invalid.length || next.sourceStatus === "withdrawn") delete next.activeLoadId;
    tx.set(ref, next);
    return { job: next, created: !prior };
  });
}
