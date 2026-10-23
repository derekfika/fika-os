import type { Transaction } from "firebase-admin/firestore";
import { collectionPreferences, deliveryLoads, logisticsAssignments, logisticsJobs, runs, stops } from "./store";
import { assignJob, aggregateDelivery, assertLoadVersion, compatibleAssignedLoad, compatibleLoad, createLoad } from "./delivery-loads";
import { HttpError } from "./http-error";
import { assertRunPlanningOpen } from "./planning";
import type { DeliveryLoad, DeliveryRun, LogisticsAssignment, LogisticsJob } from "./types";
import { chooseVisit, newVisitId, visitCandidates } from "./stop-visits";

export const assignmentId = (jobId: string) => `assignment:${encodeURIComponent(jobId)}`;
export type AssignmentIntent = { resolveSchedule?: (loads: DeliveryLoad[], job: LogisticsJob) => { scheduledTime: string; scheduledEnd?: string }; jobId: string; targetRunId?: string; scheduledTime: string; scheduledEnd?: string; collectionRequired?: boolean; /** "new" or an existing visit id at this customer on the target run; omitted = join the one unambiguous visit, else choose. */ visit?: string; expectedJobVersion?: number; expectedLoadVersions?: Record<string, number>; sourceJob?: LogisticsJob };
export type AssignmentBatch = { loads: Map<string, DeliveryLoad>; plannedRuns?: Set<string>; members?: Map<string, LogisticsJob[]>; dayLoads?: DeliveryLoad[]; nativeRequirements?: Set<string> };

export async function assertLoadAssignmentsCurrent(tx: Transaction, load: DeliveryLoad) {
  const assignments = await tx.get(logisticsAssignments().where("loadId", "==", load.id));
  const ids = assignments.docs.map(doc => doc.data().jobId as string);
  const conflict = () => new HttpError(409, "Load assignment integrity requires review. Refresh planning.");
  if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) throw conflict();
  const jobs = await Promise.all(ids.map(async id => {
    const [snapshot, ownership] = await Promise.all([tx.get(logisticsJobs().doc(id)), tx.get(logisticsAssignments().where("jobId", "==", id))]);
    const job = snapshot.exists ? snapshot.data() as LogisticsJob : undefined;
    if (!job || !compatibleAssignedLoad(job, load) || ownership.size !== 1 || ownership.docs[0].data().loadId !== load.id || job.activeLoadId && job.activeLoadId !== load.id) throw conflict();
    return job;
  }));
  return { jobs, assignments: assignments.docs.map(doc => doc.data() as LogisticsAssignment) };
}

async function assertLoadPlacementPlanningOpen(tx: Transaction, load: DeliveryLoad) {
  const ownerIds = [...new Set([load.runId, load.collectionRunId || (load.collectionRequired ? load.runId : undefined)].filter((id): id is string => Boolean(id)))];
  for (const id of ownerIds) {
    const snapshot = await tx.get(runs().doc(id));
    const owner = snapshot.exists ? snapshot.data() as DeliveryRun : undefined;
    if (!owner) throw new HttpError(409, "Canonical load owner is unavailable.");
    try { assertRunPlanningOpen(owner); } catch (error) { throw new HttpError(422, error instanceof Error ? error.message : "Return the run to planning before changing assignments."); }
  }
}

/** One job document is the serialization point, including legacy pair-ID assignments.
 * Adding a job never changes load ownership. Explicit rescheduling owns that operation.
 */
export async function assignCanonicalJob(tx: Transaction, intent: AssignmentIntent, by: string, now: string, batch?: AssignmentBatch) {
  const jobRef = logisticsJobs().doc(intent.jobId);
  const jobSnap = await tx.get(jobRef);
  if (!jobSnap.exists && !intent.sourceJob) throw new HttpError(404, "Logistics job not found.");
  const current = jobSnap.exists ? jobSnap.data() as LogisticsJob : undefined;
  if (intent.sourceJob && current && (current.sourceVersion || 0) > (intent.sourceJob.sourceVersion || 0)) throw new HttpError(409, "Source changed. Refresh planning.");
  const job = intent.sourceJob ? { ...intent.sourceJob, id: intent.jobId, deliveryStatus: current?.deliveryStatus || "pending", ...(current?.deliveredAt ? { deliveredAt: current.deliveredAt } : {}), collectionStatus: current?.collectionStatus || intent.sourceJob.collectionStatus, activeLoadId: current?.activeLoadId, version: current?.version || 0, audit: current?.audit || [] } : current!;
  if (!job.originOplocId || !job.destinationOplocId || job.sourceStatus === "withdrawn") throw new HttpError(422, "Job has no active canonical delivery authority.");
  if (job.requirementId) {
    let nativeIds = batch?.nativeRequirements;
    if (!nativeIds) {
      const datedRuns = await tx.get(runs().where("serviceDate", "==", job.serviceDate));
      const nativeStops = await Promise.all(datedRuns.docs.map(doc => tx.get(stops().where("runId", "==", doc.id))));
      nativeIds = new Set(nativeStops.flatMap(snapshot => snapshot.docs.flatMap(doc => (doc.data().requirementRefs || []).map((ref: { requirementId: string }) => ref.requirementId))));
      if (batch) batch.nativeRequirements = nativeIds;
    }
    if (nativeIds.has(job.requirementId)) throw new HttpError(409, "Return existing native work to planning before canonical reassignment.");
  }
  if (intent.collectionRequired === undefined) {
    const nativeKey = `${job.serviceDate}:${job.destinationOplocId}:${job.requestedWindow ? `${job.requestedWindow.startTime}-${job.requestedWindow.endTime || ""}` : "unscheduled"}`;
    const preferences = await Promise.all([`projection-job:${job.id}`, nativeKey].map(key => tx.get(collectionPreferences().doc(encodeURIComponent(key)))));
    intent = { ...intent, collectionRequired: preferences.some(snapshot => snapshot.exists && snapshot.data()?.collectionRequired === true) };
  }
  let vehicleId: string | undefined;
  let deliveryRun: DeliveryRun | undefined;
  if (intent.targetRunId) {
    const runSnap = await tx.get(runs().doc(intent.targetRunId));
    const run = runSnap.data() as DeliveryRun | undefined;
    if (!run || run.serviceDate !== job.serviceDate || !run.vehicleId) throw new HttpError(409, "Canonical delivery run is unavailable.");
    try { assertRunPlanningOpen(run); } catch (error) { throw new HttpError(422, error instanceof Error ? error.message : "Run is not open for planning."); }
    vehicleId = run.vehicleId;
    deliveryRun = run;
  }
  const [datedLoads, assigned] = await Promise.all([
    batch?.dayLoads ? Promise.resolve(batch.dayLoads) : tx.get(deliveryLoads().where("serviceDate", "==", job.serviceDate)).then(snapshot => snapshot.docs.map(doc => doc.data() as DeliveryLoad)),
    tx.get(logisticsAssignments().where("jobId", "==", job.id)),
  ]);
  if (batch) batch.dayLoads = datedLoads;
  const available = new Map(datedLoads.map(load => [load.id, load]));
  for (const [id, load] of batch?.loads || []) available.set(id, load);
  if (intent.resolveSchedule) intent = { ...intent, ...intent.resolveSchedule([...available.values()], job) };
  // ---- Physical visit (Stop) selection -------------------------------------------------
  // The job's current load, if it is already on this run, keeps its visit (a time edit never splits a visit).
  const currentLoad = assigned.docs[0] ? available.get((assigned.docs[0].data() as LogisticsAssignment).loadId) : undefined;
  let deliveryVisitId: string | undefined;
  const backfilled: DeliveryLoad[] = [];
  const originals = new Map<string, DeliveryLoad>();
  if (intent.targetRunId && currentLoad && currentLoad.runId === intent.targetRunId && !intent.visit) {
    deliveryVisitId = currentLoad.deliveryVisitId;
  } else if (intent.targetRunId) {
    const choice = chooseVisit(visitCandidates([...available.values()], { runId: intent.targetRunId, customerOplocId: job.destinationOplocId, excludeLegs: currentLoad ? [{ loadId: currentLoad.id, lane: "delivery" }] : [] }), intent.visit);
    if (choice.kind === "choice-required") throw Object.assign(new HttpError(422, "This customer already has more than one visit on this run. Choose which visit to add this work to, or start a new visit."), { code: "LOGISTICS_VISIT_CHOICE_REQUIRED" });
    if (choice.kind === "invalid") throw new HttpError(422, choice.reason);
    if (choice.kind === "new") deliveryVisitId = newVisitId();
    else if (choice.candidate.visitId) deliveryVisitId = choice.candidate.visitId;
    else {
      // Joining a legacy placement (no visit id yet): give its members one explicit identity so the
      // association survives later time edits. Done inside this transaction, never by name or OPLOC.
      deliveryVisitId = newVisitId();
      for (const leg of choice.candidate.legs) {
        const member = available.get(leg.loadId);
        if (!member) continue;
        if (!originals.has(member.id)) originals.set(member.id, member);
        const touched = backfilled.find(item => item.id === member.id);
        const field = leg.lane === "delivery" ? "deliveryVisitId" : "collectionVisitId";
        const updated: DeliveryLoad = touched
          ? { ...touched, [field]: deliveryVisitId }
          : { ...member, [field]: deliveryVisitId, updatedAt: now, version: member.version + 1, audit: [...member.audit, { action: "visit-association-backfilled", at: now, by, version: member.version + 1 }] };
        if (touched) backfilled.splice(backfilled.indexOf(touched), 1);
        backfilled.push(updated);
        available.set(updated.id, updated);
        if (batch?.dayLoads) batch.dayLoads = batch.dayLoads.map(item => item.id === updated.id ? updated : item);
      }
    }
  }
  const proposed = createLoad({ deliveryVisitId, serviceDate: job.serviceDate, originOplocId: job.originOplocId, destinationOplocId: job.destinationOplocId, scheduledTime: intent.scheduledTime, scheduledEnd: intent.scheduledEnd, collectionRequired: intent.collectionRequired, runId: intent.targetRunId, vehicleId, destinationLabelSnapshot: job.destinationLabelSnapshot, by, now });
  if (!compatibleLoad(job, proposed)) throw new HttpError(422, "The job and delivery load no longer match the current operational details.");
  const matching = [...available.values()].filter(l => l.status !== "cancelled" && l.originOplocId === proposed.originOplocId && l.destinationOplocId === proposed.destinationOplocId && l.runId === proposed.runId && l.vehicleId === proposed.vehicleId && l.scheduledTime === proposed.scheduledTime && l.scheduledEnd === proposed.scheduledEnd && Boolean(l.collectionRequired) === Boolean(intent.collectionRequired) && l.deliveryVisitId === proposed.deliveryVisitId);
  if (matching.length > 1 || assigned.size > 1) throw new HttpError(409, "Duplicate canonical load or assignment requires review.");
  const baseId = proposed.id;
  let generation = 0;
  while (!matching.length && available.has(proposed.id)) proposed.id = `${baseId}:generation:${++generation}`;
  const load = matching[0] || { ...proposed, ...(intent.collectionRequired ? { collectionRequired: true } : {}) };
  // A creation ID is immutable even after rescheduling. Never overwrite such a record.
  const idSnap = await tx.get(deliveryLoads().doc(load.id));
  if (!matching.length && idSnap.exists) throw new HttpError(409, "Original load identity is already in use. Refresh planning.");
  const existing = assigned.docs.map(d => d.data() as LogisticsAssignment);
  if (job.activeLoadId && job.activeLoadId !== existing[0]?.loadId) throw new HttpError(409, "Job assignment pointer requires integrity review.");
  if (intent.sourceJob && current?.activeLoadId && (current.sourceVersion !== intent.sourceJob.sourceVersion || current.sourceStatus !== intent.sourceJob.sourceStatus)) throw new HttpError(409, "Reconcile current source truth before assigning this work.");
  if (existing[0]?.loadId === load.id && job.activeLoadId === load.id) return { jobId: job.id, load, changed: false };
  if (intent.sourceJob && existing.length && !Number.isInteger(intent.expectedJobVersion)) throw new HttpError(409, "Job was assigned elsewhere. Refresh planning and use its canonical version.");
  if ((!intent.sourceJob || existing.length) && !Number.isInteger(intent.expectedJobVersion)) throw new HttpError(422, "The current job version is required.");
  if ((!intent.sourceJob || existing.length) && job.version !== intent.expectedJobVersion) throw new HttpError(409, "Job assignment changed. Refresh Logistics and retry.");
  // The caller observed the load BEFORE any in-transaction visit backfill, so check that version.
  if (matching.length && !batch?.loads.has(load.id)) assertLoadVersion(originals.get(load.id) || load, intent.expectedLoadVersions?.[load.id]);
  const targetJobs = matching.length && !batch?.loads.has(load.id) ? (await assertLoadAssignmentsCurrent(tx, load)).jobs : batch?.members?.get(load.id) || [];
  const oldLoad = existing[0] && existing[0].loadId !== load.id ? (await tx.get(deliveryLoads().doc(existing[0].loadId))).data() as DeliveryLoad | undefined : undefined;
  const oldMembers = oldLoad ? await tx.get(logisticsAssignments().where("loadId", "==", oldLoad.id)) : undefined;
  if (existing.length && !oldLoad && existing[0].loadId !== load.id) throw new HttpError(409, "Prior load authority is unavailable.");
  if (oldLoad) {
    assertLoadVersion(oldLoad, intent.expectedLoadVersions?.[oldLoad.id]);
    await assertLoadPlacementPlanningOpen(tx, oldLoad);
  }
  if (matching.length && !batch?.loads.has(load.id)) await assertLoadPlacementPlanningOpen(tx, load);
  const oldJobs = oldLoad ? (await assertLoadAssignmentsCurrent(tx, oldLoad)).jobs.filter(member => member.id !== job.id) : [];
  const next = assignJob(job, load, existing, by, now);
  const savedBase = batch?.loads.has(load.id) ? { ...next.load, version: load.version, audit: [...load.audit, { action: "job-assigned", at: now, by, version: load.version }] } : matching.length ? next.load : { ...next.load, version: 1, audit: [...load.audit, { action: "job-assigned", at: now, by, version: 1 }] };
  const nextMembers = [...targetJobs.filter(member => member.id !== job.id), job];
  const saved = aggregateDelivery(savedBase, nextMembers);
  // First canonical work plans a fresh draft run, as native assignment does.
  // Further assignments and replays do not churn its lifecycle/version.
  const plannedRun = deliveryRun?.status === "draft" && !batch?.plannedRuns?.has(deliveryRun.canonicalId) ? { ...deliveryRun, status: "planned" as const, version: deliveryRun.version + 1, updatedAt: now, audit: [...deliveryRun.audit, { action: "canonical-work-planned", at: now, by, version: deliveryRun.version + 1 }] } : undefined;
  if (plannedRun) {
    tx.set(runs().doc(plannedRun.canonicalId), plannedRun);
    if (batch) { batch.plannedRuns ||= new Set(); batch.plannedRuns.add(plannedRun.canonicalId); }
  }
  if (batch) { batch.members ||= new Map(); batch.members.set(saved.id, nextMembers); }
  for (const doc of assigned.docs) tx.delete(doc.ref);
  tx.set(logisticsAssignments().doc(assignmentId(job.id)), next.assignment);
  tx.set(jobRef, { ...job, activeLoadId: load.id, version: job.version + 1, updatedAt: now, audit: [...job.audit, { action: `job-assigned:${load.id}`, at: now, by, version: job.version + 1 }] });
  for (const member of backfilled) if (member.id !== load.id) tx.set(deliveryLoads().doc(member.id), member);
  tx.set(deliveryLoads().doc(load.id), saved);
  if (oldLoad) tx.set(deliveryLoads().doc(oldLoad.id), aggregateDelivery({ ...oldLoad, ...(oldMembers!.size <= 1 ? { status: "cancelled" } : {}), version: oldLoad.version + 1, updatedAt: now, audit: [...oldLoad.audit, { action: `job-moved-out:${job.id}`, at: now, by, version: oldLoad.version + 1 }] }, oldJobs));
  batch?.loads.set(saved.id, saved);
  return { jobId: job.id, load: saved, plannedRun, changed: true, backfilled };
}
