import { randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import type { LogisticsPrincipal } from "./auth";
import type { DeliveryLoad, DeliveryRun, LoadLegExecution, LogisticsJob } from "./types";
import { deliveryLoads, logisticsJobs, runs } from "./store";
import { assertLoadAssignmentsCurrent } from "./load-assignment";
import { assertLoadVersion } from "./delivery-loads";
import { authorizeLoad } from "./resource-authority";
import { aggregateDelivery, assertJobSource, collectionComplete, deliveryComplete, deliveryLoaded, finaliseRun, readRunWork } from "./run-execution";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { HttpError } from "./http-error";

export const projectedActions = ["arrive-stop", "mark-stop-loaded", "mark-subload-loaded", "mark-subload-delivered", "mark-subload-collected", "complete-stop", "undo-completion", "report-issue", "resolve-issue", "defer-collection"];
export type ProjectedIntent = { action: string; stopId?: string; runId?: string; loadIds?: string[]; expectedLoadVersion?: number; expectedLoadVersions?: Record<string, number>; expectedJobVersions?: Record<string, number>; expectedJobVersion?: number; expectedRunVersion?: number; requirementId?: string; jobId?: string; loaded?: boolean; confirmDirect?: boolean; issueDescription?: string; issueCategory?: import("./types").StopIssue["category"]; issueId?: string; resolutionNotes?: string };
/** Same grouping tuple as the canonical projection; execution changes may split a card. */
export const executionGroupKey = (l: DeliveryLoad) => JSON.stringify([l.serviceDate, l.originOplocId, l.destinationOplocId, l.runId, l.vehicleId, l.scheduledTime, l.scheduledEnd, Boolean(l.collectionRequired), l.collectionRunId, l.collectionScheduledTime, l.collectionScheduledEnd, l.status]);
export function projectedLane(id?: string) {
  if (id?.startsWith("projection-stop:delivery:")) return "delivery" as const;
  if (id?.startsWith("projection-stop:collection:")) return "collection" as const;
  throw new HttpError(422, "Explicit projected delivery/collection identity is required.");
}
export async function executeProjected(tx: Transaction, principal: LogisticsPrincipal, intent: ProjectedIntent, requirements: FulfilmentRequirement[], by: string, now: string, operationId = randomUUID()) {
  const lane = projectedLane(intent.stopId);
  if (intent.action === "defer-collection") throw new HttpError(422, "Projected collection postponement is unavailable until the governed cross-date workflow is implemented.");
  const anchor = intent.stopId!.slice(`projection-stop:${lane}:`.length);
  const ids = intent.loadIds || [anchor];
  if (!ids.length || ids.length > 50 || ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length || !ids.includes(anchor)) throw new HttpError(422, "Supply 1–50 unique constituent load IDs including this stop.");
  const snapshots = await Promise.all(ids.map(id => tx.get(deliveryLoads().doc(id))));
  if (snapshots.some(s => !s.exists)) throw new HttpError(404, "Projected execution load not found.");
  const loads = snapshots.map(s => s.data() as DeliveryLoad);
  const day = await tx.get(deliveryLoads().where("serviceDate", "==", loads[0].serviceDate));
  const key = executionGroupKey(loads[0]);
  const currentIds = day.docs.map(doc => doc.data() as DeliveryLoad).filter(l => l.status !== "cancelled" && executionGroupKey(l) === key).map(l => l.id);
  if (loads.some(l => executionGroupKey(l) !== key) || currentIds.length !== ids.length || currentIds.some(id => !ids.includes(id))) throw new HttpError(409, "Projected stop grouping changed. Refresh this stop.");
  const runId = lane === "delivery" ? loads[0].runId : loads[0].collectionRunId || loads[0].runId;
  if (!runId || intent.runId && intent.runId !== runId || lane === "collection" && !loads[0].collectionRequired) throw new HttpError(422, "Wrong projected execution run or lane.");
  const runSnapshot = await tx.get(runs().doc(runId));
  if (!runSnapshot.exists) throw new HttpError(409, "Execution run is unavailable.");
  const run = runSnapshot.data() as DeliveryRun;
  if (run.version !== intent.expectedRunVersion) throw new HttpError(409, "Run changed. Refresh execution authority.");
  const loading = ["mark-stop-loaded", "mark-subload-loaded"].includes(intent.action);
  if (loading && (lane !== "delivery" || !["planned", "ready"].includes(run.status))) throw new HttpError(422, "Delivery loading is allowed only before dispatch.");
  if (intent.action === "undo-completion" && !["dispatched", "completed"].includes(run.status)) throw new HttpError(422, "Undo requires a dispatched or completed run.");
  if (!loading && intent.action !== "undo-completion" && run.status !== "dispatched") throw new HttpError(422, "Execution requires the owning run to be dispatched.");
  if (run.serviceDate !== loads[0].serviceDate) throw new HttpError(409, "Run/date integrity requires review.");
  const members = new Map<string, LogisticsJob[]>();
  for (const load of loads) {
    assertLoadVersion(load, intent.expectedLoadVersions?.[load.id] ?? (ids.length === 1 ? intent.expectedLoadVersion : undefined));
    await authorizeLoad(principal, load, async id => (await tx.get(runs().doc(id))).data() as DeliveryRun | undefined);
    const { jobs } = await assertLoadAssignmentsCurrent(tx, load);
    for (const job of jobs) assertJobSource(job, requirements);
    members.set(load.id, jobs);
  }
  const work = !loading && intent.action !== "arrive-stop" ? await readRunWork(tx, run) : undefined;
  const individual = intent.action.startsWith("mark-subload-");
  const jobId = intent.jobId || intent.requirementId;
  const allJobs = [...members.values()].flat();
  const selected = individual ? allJobs.filter(job => job.id === jobId) : allJobs;
  if (individual && selected.length !== 1) throw new HttpError(422, "This subload does not belong to the projected stop.");
  const affectsJobs = loading || ["mark-subload-delivered", "mark-subload-collected", "complete-stop", "undo-completion"].includes(intent.action);
  if (affectsJobs) for (const job of selected) {
    const expected = intent.expectedJobVersions?.[job.id] ?? (individual ? intent.expectedJobVersion : undefined);
    if (!Number.isInteger(expected)) throw new HttpError(422, "Current canonical job versions are required.");
    if (job.version !== expected) throw new HttpError(409, "Subload changed. Refresh this stop.");
  }
  if (intent.action === "mark-subload-delivered" && lane !== "delivery" || intent.action === "mark-subload-collected" && lane !== "collection") throw new HttpError(422, "Use the command for this execution lane.");
  const legKey = lane === "delivery" ? "deliveryExecution" : "collectionExecution";
  const complete = (jobs: LogisticsJob[]) => lane === "delivery" ? deliveryComplete(jobs) : collectionComplete(jobs);
  if ((loading || ["arrive-stop", "complete-stop"].includes(intent.action)) && [...members.values()].some(complete)) throw new HttpError(422, "Completed execution is read-only for this action.");
  if (intent.action === "complete-stop" && loads.some(load => !load[legKey]?.arrivedAt) && !intent.confirmDirect) throw new HttpError(422, "Arrive first or explicitly confirm direct completion.");
  if ((intent.action === "complete-stop" || intent.action === "mark-subload-delivered") && lane === "delivery" && selected.some(job => !deliveryLoaded(job))) throw new HttpError(422, "Load delivery subloads before completion.");
  const updatedJobs = new Map<string, LogisticsJob>();
  const updatedLoads = new Map<string, DeliveryLoad>();
  let issueFound = false;
  const completionId = loads[0][legKey]?.completion?.id;
  if (intent.action === "undo-completion" && (!completionId || loads.some(load => load[legKey]?.completion?.id !== completionId || !complete(members.get(load.id)!)))) throw new HttpError(409, "No matching whole-stop completion snapshot is available.");
  for (const load of loads) {
    const jobs = members.get(load.id)!;
    if (individual && !jobs.some(job => job.id === jobId)) continue;
    let leg: LoadLegExecution = { ...load[legKey] };
    if (intent.action === "arrive-stop") {
      if (leg.arrivedAt) throw new HttpError(422, "Stop already arrived.");
      leg.arrivedAt = now;
    }
    if (intent.action === "report-issue") {
      if (!intent.issueDescription?.trim()) throw new HttpError(422, "Describe the issue.");
      leg.issues = [...(leg.issues || []), { id: `issue:${operationId}`, stopId: intent.stopId!, reportedAt: now, reportedBy: by, description: intent.issueDescription.trim(), category: intent.issueCategory, status: "open" }];
    }
    if (intent.action === "resolve-issue") {
      if (!leg.issues?.some(issue => issue.id === intent.issueId && issue.status === "open")) continue;
      issueFound = true;
      leg.issues = leg.issues.map(issue => issue.id === intent.issueId ? { ...issue, status: "resolved", resolvedAt: now, resolvedBy: by, resolutionNotes: intent.resolutionNotes } : issue);
    }
    if (intent.action === "complete-stop") leg.completion = { id: operationId, jobs: Object.fromEntries(jobs.map(job => [job.id, { deliveryStatus: job.deliveryStatus || "pending", collectionStatus: job.collectionStatus, deliveredAt: job.deliveredAt, version: job.version }])) };
    for (const job of jobs) {
      if (individual && job.id !== jobId) continue;
      let next = { ...job };
      if (loading) {
        if (job.deliveryStatus === "delivered") throw new HttpError(422, "Delivered subloads cannot be loaded/unloaded.");
        next.deliveryStatus = intent.loaded === false ? "pending" : "loaded";
      }
      if (intent.action === "mark-subload-delivered" || intent.action === "complete-stop" && lane === "delivery") { next.deliveryStatus = "delivered"; next.deliveredAt = job.deliveredAt || now; }
      if (intent.action === "mark-subload-collected" || intent.action === "complete-stop" && lane === "collection") next.collectionStatus = "collected";
      if (intent.action === "undo-completion") {
        const prior = leg.completion!.jobs[job.id];
        if (!prior || prior.version !== job.version) throw new HttpError(409, "Subload changed since whole completion; undo requires review.");
        if (lane === "delivery") { next.deliveryStatus = prior.deliveryStatus; next.deliveredAt = prior.deliveredAt; } else next.collectionStatus = prior.collectionStatus;
      }
      if (next.deliveryStatus !== job.deliveryStatus || next.collectionStatus !== job.collectionStatus || next.deliveredAt !== job.deliveredAt) {
        next = { ...next, version: job.version + 1, updatedAt: now, audit: [...job.audit, { action: `${intent.action}:${lane}:${load.id}`, at: now, by, version: job.version + 1 }] };
        updatedJobs.set(job.id, next);
      }
      if (intent.action === "complete-stop") leg.completion!.jobs[job.id].version = next.version;
    }
    if (intent.action === "undo-completion") delete leg.completion;
    const next = aggregateDelivery({ ...load, [legKey]: leg, version: load.version + 1, updatedAt: now, audit: [...load.audit, { action: `${intent.action}:${lane}`, at: now, by, version: load.version + 1 }] }, jobs.map(job => updatedJobs.get(job.id) || job));
    updatedLoads.set(load.id, next);
  }
  if (intent.action === "resolve-issue" && !issueFound) throw new HttpError(404, "The requested open issue was not found.");
  // One issue identity survives a later card split. Resolve exactly that issue
  // on every active copy, with all owners and observed versions protected.
  if (intent.action === "resolve-issue") for (const doc of day.docs) {
    const load = doc.data() as DeliveryLoad;
    if (ids.includes(load.id) || load.status === "cancelled" || !load[legKey]?.issues?.some(issue => issue.id === intent.issueId && issue.status === "open")) continue;
    await authorizeLoad(principal, load, async id => (await tx.get(runs().doc(id))).data() as DeliveryRun | undefined);
    assertLoadVersion(load, intent.expectedLoadVersions?.[load.id]);
    const { jobs } = await assertLoadAssignmentsCurrent(tx, load);
    for (const job of jobs) assertJobSource(job, requirements);
    updatedLoads.set(load.id, { ...load, [legKey]: { ...load[legKey], issues: load[legKey]!.issues!.map(issue => issue.id === intent.issueId ? { ...issue, status: "resolved", resolvedAt: now, resolvedBy: by, resolutionNotes: intent.resolutionNotes } : issue) }, version: load.version + 1, updatedAt: now, audit: [...load.audit, { action: `resolve-issue:${lane}:${intent.issueId}`, at: now, by, version: load.version + 1 }] });
  }
  if (work) work.legs = work.legs.map(leg => ({ ...leg, load: updatedLoads.get(leg.load.id) || leg.load, jobs: leg.jobs.map(job => updatedJobs.get(job.id) || job) }));
  const nextRun = work ? finaliseRun(run, work, by, now, intent.action === "undo-completion") : run;
  const additionalRuns: DeliveryRun[] = [];
  const otherOwners = new Set([...updatedLoads.values()].map(load => lane === "delivery" ? load.runId : load.collectionRunId || load.runId).filter((id): id is string => Boolean(id && id !== runId)));
  for (const id of otherOwners) {
    const other = (await tx.get(runs().doc(id))).data() as DeliveryRun | undefined;
    if (!other) throw new HttpError(409, "Issue owner is unavailable.");
    const otherWork = await readRunWork(tx, other);
    otherWork.legs = otherWork.legs.map(leg => ({ ...leg, load: updatedLoads.get(leg.load.id) || leg.load }));
    const next = finaliseRun(other, otherWork, by, now);
    if (next !== other) additionalRuns.push(next);
  }
  for (const job of updatedJobs.values()) tx.set(logisticsJobs().doc(job.id), job);
  for (const load of updatedLoads.values()) tx.set(deliveryLoads().doc(load.id), load);
  if (nextRun !== run) tx.set(runs().doc(runId), nextRun);
  for (const other of additionalRuns) tx.set(runs().doc(other.canonicalId), other);
  return { run: nextRun, additionalRuns, loads: [...new Map([...loads, ...updatedLoads.values()].map(load => [load.id, updatedLoads.get(load.id) || load])).values()], jobs: allJobs.map(job => updatedJobs.get(job.id) || job), changedJobs: [...updatedJobs.values()], changedLoads: [...updatedLoads.values()] };
}
