import type { Transaction } from "firebase-admin/firestore";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsJob } from "./types";
import { deliveryLoads, stops, normalizeStop } from "./store";
import { assertLoadAssignmentsCurrent } from "./load-assignment";
import { HttpError } from "./http-error";

export const deliveryLoaded = (job: LogisticsJob) => job.deliveryStatus === "loaded" || job.deliveryStatus === "delivered";
export const deliveryComplete = (jobs: LogisticsJob[]) => jobs.length > 0 && jobs.every(job => job.deliveryStatus === "delivered");
export const collectionComplete = (jobs: LogisticsJob[]) => jobs.length > 0 && jobs.every(job => job.collectionStatus === "collected");
export { aggregateDelivery } from "./delivery-loads";
export type RunWork = { native: DeliveryStop[]; legs: Array<{ load: DeliveryLoad; jobs: LogisticsJob[]; lane: "delivery" | "collection" }> };
/** Canonical date/run reads, with known memberships; no display projection authority. */
export async function readRunWork(tx: Transaction, run: DeliveryRun): Promise<RunWork> {
  const [native, loads] = await Promise.all([tx.get(stops().where("runId", "==", run.canonicalId)), tx.get(deliveryLoads().where("serviceDate", "==", run.serviceDate))]);
  const legs: RunWork["legs"] = [];
  for (const doc of loads.docs) {
    const load = doc.data() as DeliveryLoad;
    if (load.status === "cancelled") continue;
    const delivery = load.runId === run.canonicalId;
    const collection = Boolean(load.collectionRequired && (load.collectionRunId || load.runId) === run.canonicalId);
    if (!delivery && !collection) continue;
    const { jobs } = await assertLoadAssignmentsCurrent(tx, load);
    if (delivery) legs.push({ load, jobs, lane: "delivery" });
    if (collection) legs.push({ load, jobs, lane: "collection" });
  }
  return { native: native.docs.map(doc => normalizeStop(doc.data())), legs };
}
export function workOutstanding(work: RunWork) {
  return work.native.some(stop => stop.status !== "completed") || work.legs.some(leg => !(leg.lane === "delivery" ? deliveryComplete(leg.jobs) : collectionComplete(leg.jobs)));
}
export function workIssuesOpen(work: RunWork) {
  return work.native.some(stop => stop.issues?.some(issue => issue.status === "open")) || work.legs.some(leg => (leg.lane === "delivery" ? leg.load.deliveryExecution : leg.load.collectionExecution)?.issues?.some(issue => issue.status === "open"));
}
export function finaliseRun(run: DeliveryRun, work: RunWork, by: string, now: string, undo = false): DeliveryRun {
  if (!["dispatched", "completed"].includes(run.status)) return run;
  const blocked = workOutstanding(work) || workIssuesOpen(work);
  const status = blocked ? undo ? "dispatched" : run.status : run.returnToCpuRequired === false || run.returnedToCpuAt ? "completed" : "dispatched";
  const pending = !blocked && run.returnToCpuRequired !== false && !run.returnedToCpuAt;
  if (run.status === status && Boolean(run.returnToCpuPending) === pending && !(undo && run.returnedToCpuAt)) return run;
  return { ...run, status, returnToCpuPending: pending, ...(undo ? { returnedToCpuAt: undefined, returnedToCpuBy: undefined } : {}), version: run.version + 1, updatedAt: now, audit: [...run.audit, { action: undo ? "execution-undone" : "execution-finalised", at: now, by, version: run.version + 1 }] };
}
export function assertJobSource(job: LogisticsJob, requirements: FulfilmentRequirement[]) {
  const candidates = requirements.filter(req => job.requirementId ? req.canonicalId === job.requirementId : req.sourceDomain === job.sourceType && req.sourceEntityId === job.sourceId && req.destinationOplocId === job.destinationOplocId);
  const req = candidates.length === 1 ? candidates[0] : undefined;
  if (!req || req.status === "withdrawn" || req.sourceVersion !== job.sourceVersion || req.destinationOplocId !== job.destinationOplocId || req.serviceDate !== job.serviceDate || (job.sourceContentHash && req.sourceContentHash !== job.sourceContentHash)) throw new HttpError(409, "Current fulfilment source requires reconciliation.");
  return req;
}
export async function assertRunReady(tx: Transaction, run: DeliveryRun, work: RunWork, requirements: FulfilmentRequirement[], dispatch: boolean) {
  if (!work.native.length && !work.legs.length) throw new HttpError(422, "Run has no execution work.");
  if (workIssuesOpen(work)) throw new HttpError(422, "Resolve open issues before departure.");
  for (const stop of work.native) {
    if (!stop.plannedArrivalTime && !stop.plannedWindow?.startTime && !stop.requiredTime && !stop.window?.startTime) throw new HttpError(422, "Every stop requires scheduled timing.");
    for (const ref of stop.requirementRefs) {
      const req = requirements.find(item => item.canonicalId === ref.requirementId);
      if (!req || req.status === "withdrawn" || req.sourceVersion !== ref.sourceVersion || req.serviceDate !== run.serviceDate) throw new HttpError(409, "Native fulfilment source requires reconciliation.");
    }
    const collection = stop.linkedOperation === "collection" || stop.movementType === "collection";
    if (dispatch && !collection && !stop.loaded) throw new HttpError(422, "Every delivery must be loaded before dispatch.");
    if (!collection && stop.collectionRequired) {
      const linked = stop.linkedStopId ? (await tx.get(stops().doc(stop.linkedStopId))).data() as DeliveryStop | undefined : undefined;
      if (!linked || !linked.plannedArrivalTime && !linked.plannedWindow?.startTime) throw new HttpError(422, "Required collection timing is missing.");
    }
  }
  for (const leg of work.legs) {
    if (!(leg.lane === "delivery" ? leg.load.scheduledTime : leg.load.collectionScheduledTime) || leg.load.collectionRequired && !leg.load.collectionScheduledTime) throw new HttpError(422, "Required delivery/collection timing is missing.");
    for (const job of leg.jobs) {
      const req = assertJobSource(job, requirements);
      if (job.productionReadiness !== "ready" || req.status === "pending") throw new HttpError(422, "Production work is not ready for departure.");
      if (dispatch && leg.lane === "delivery" && !deliveryLoaded(job)) throw new HttpError(422, "Every delivery subload must be loaded before dispatch.");
    }
  }
}
