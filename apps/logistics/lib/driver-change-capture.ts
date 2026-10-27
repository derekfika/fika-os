import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsAssignment, LogisticsJob } from "./types";
import { deliveryLoads, logisticsAssignments, logisticsJobs, runs, stops } from "./store";
import { londonServiceDate, type DriverRunSnapshot, type DriverVisit } from "./driver-notifications";
import { driverChangeEventId, stageDriverChangeEvent, type ChangeMutation } from "./driver-change-events";
import { driverChangeEvents, processDriverNotificationsSafely } from "./driver-notification-store";
import { db } from "./firebase";

/** A write the authorised transaction has buffered but not yet applied. Same shape `authorizeTransaction` buffers. */
export type BufferedWrite = { method: "set" | "create" | "update" | "delete"; args: any[] };
export type CaptureContext = { action: string; actorId: string; now: string };

const RUNS = "fikaLogisticsDeliveryRunsV1";
const LOADS = "fikaLogisticsDeliveryLoadsV1";
const STOPS = "fikaLogisticsDeliveryStopsV1";
const JOBS = "fikaLogisticsJobsV1";
const ASSIGNMENTS = "fikaLogisticsAssignmentsV1";
const WATCHED = new Set([RUNS, LOADS, STOPS, JOBS, ASSIGNMENTS]);
const ENTITY: Record<string, ChangeMutation["entityType"]> = { [RUNS]: "run", [LOADS]: "load", [STOPS]: "stop", [JOBS]: "job", [ASSIGNMENTS]: "job" };

/**
 * Planner actions that never create driver notifications, so they never pay the capture read cost: driver execution, empty-draft and
 * run-lifecycle housekeeping, driver label and return-requirement edits.
 */
export const NON_NOTIFYING_ACTIONS: ReadonlySet<string> = new Set([
  "arrive-stop", "mark-stop-loaded", "mark-subload-loaded", "mark-subload-delivered", "mark-subload-collected", "complete-stop", "undo-completion",
  "report-issue", "resolve-issue", "defer-collection", "dispatch-run", "confirm-returned-to-cpu", "mark-delivery-load-loaded", "dispatch-delivery-load",
  "create-run", "ensure-vehicle-day-runs", "retire-empty-run", "set-run-driver", "set-run-return-required", "mark-run-ready", "return-run-to-planning", "complete-run",
]);

export const driverCaptureFor = (action: string, actorId: string, now: string): CaptureContext | undefined => NON_NOTIFYING_ACTIONS.has(action) ? undefined : { action, actorId, now };

export type DayState = { runs: DeliveryRun[]; loads: DeliveryLoad[]; assignments: Array<Pick<LogisticsAssignment, "jobId" | "loadId">>; jobs: LogisticsJob[]; stops: DeliveryStop[] };

const normalise = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const contentsSummary = (job: LogisticsJob) => (job.contents ?? []).map(item => `${item.quantity} ${item.unit} ${item.description}`.replace(/\s+/g, " ").trim());
const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

/**
 * Driver-visible snapshots of every vehicle run for one service date. Only fields a driver can see feed the snapshot, so technical
 * version bumps and execution progress never look like a notifiable change.
 */
export function buildDriverRunSnapshots(date: string, state: DayState): DriverRunSnapshot[] {
  const jobsById = new Map(state.jobs.map(job => [job.id, job]));
  const jobsByLoad = new Map<string, LogisticsJob[]>();
  for (const assignment of state.assignments) {
    const job = jobsById.get(assignment.jobId);
    if (job) jobsByLoad.set(assignment.loadId, [...(jobsByLoad.get(assignment.loadId) ?? []), job]);
  }
  const snapshots: DriverRunSnapshot[] = [];
  for (const run of state.runs) {
    if (run.serviceDate !== date || (run.vehicleId !== "van1" && run.vehicleId !== "van2")) continue;
    const groups = new Map<string, { visit: DriverVisit; quantities: string[]; instructions: string[] }>();
    const add = (key: string, visit: Omit<DriverVisit, "quantities" | "instructions">, quantities: string[], instructions: string[]) => {
      const group = groups.get(key);
      if (!group) { groups.set(key, { visit: { ...visit, jobIds: uniqueSorted(visit.jobIds) }, quantities, instructions }); return; }
      group.visit.jobIds = uniqueSorted([...group.visit.jobIds, ...visit.jobIds]);
      group.visit.destination = group.visit.destination || visit.destination;
      group.visit.time = group.visit.time ?? visit.time;
      group.quantities.push(...quantities);
      group.instructions.push(...instructions);
    };
    for (const load of state.loads) {
      if (load.status === "cancelled") continue;
      const jobs = jobsByLoad.get(load.id) ?? [];
      if (load.runId === run.canonicalId) add(`${load.deliveryVisitId ?? load.id}:delivery`, { visitId: `${load.deliveryVisitId ?? load.id}:delivery`, lane: "delivery", destination: load.destinationLabelSnapshot || "Destination", time: load.scheduledTime, jobIds: jobs.map(job => job.id) }, jobs.flatMap(contentsSummary), jobs.map(job => job.notes ?? ""));
      if (load.collectionRequired && (load.collectionRunId || load.runId) === run.canonicalId) add(`${load.collectionVisitId ?? load.id}:collection`, { visitId: `${load.collectionVisitId ?? load.id}:collection`, lane: "collection", destination: load.destinationLabelSnapshot || "Destination", time: load.collectionScheduledTime, jobIds: jobs.map(job => job.id) }, jobs.flatMap(contentsSummary), jobs.map(job => job.notes ?? ""));
    }
    for (const stop of state.stops) {
      if (stop.runId !== run.canonicalId) continue;
      const lane = stop.movementType === "collection" ? "collection" : "delivery";
      const key = `${stop.visitId ?? stop.canonicalId}:${lane}`;
      add(key, { visitId: key, lane, destination: stop.locationLabelSnapshot || "Destination", time: stop.plannedArrivalTime, jobIds: [...(stop.requirementRefs ?? []).map(ref => ref.requirementId), ...(stop.movementRequestIds ?? [])] }, [], [stop.notes ?? ""]);
    }
    snapshots.push({
      runId: run.canonicalId,
      version: run.version,
      vehicleId: run.vehicleId,
      vehicleLabel: run.vehicleLabel || (run.vehicleId === "van2" ? "Van 2" : "Van 1"),
      serviceDate: run.serviceDate,
      status: run.retiredAt ? "cancelled" : run.status,
      departure: run.plannedCpuDepartureTime,
      return: run.plannedCpuReturnTime,
      stopOrder: run.orderedStopIds,
      visits: [...groups.values()].map(group => ({ ...group.visit, quantities: uniqueSorted(group.quantities).join(" · "), instructions: uniqueSorted(group.instructions.map(normalise).filter(Boolean)).join(" | ") })).sort((a, b) => a.visitId.localeCompare(b.visitId)),
    });
  }
  return snapshots;
}

const idOf = (ref: any) => String(ref.id ?? String(ref.path).split("/").at(-1));
const stable = (value: unknown) => JSON.stringify(value);

function applyOverlay<T>(base: T[], keyOf: (item: T) => string, collection: string, overlay: Map<string, { collection: string; id: string; next: any | undefined }>, include: (next: any) => boolean): T[] {
  const byKey = new Map(base.map(item => [keyOf(item), item]));
  for (const entry of overlay.values()) {
    if (entry.collection !== collection) continue;
    if (entry.next === undefined) { byKey.delete(entry.id); continue; }
    if (include(entry.next)) byKey.set(entry.id, entry.next as T); else byKey.delete(entry.id);
  }
  return [...byKey.values()];
}

/**
 * Called inside the authorised planner transaction, after authorization and before the buffered writes are applied. It derives the
 * exact driver-visible before and after state of today's runs from the transaction's own reads plus the buffered writes, and
 * stages one immutable event in the same transaction. It performs no writes other than that event and never throws into the
 * planner: the caller treats any failure as "no event" and the planner save proceeds.
 */
export async function stageDriverChangeFromWrites(transaction: Transaction, writes: BufferedWrite[], ctx: CaptureContext): Promise<"staged" | "exists" | "skipped"> {
  const watched = writes.filter(write => WATCHED.has(write.args[0]?.parent?.id));
  if (!watched.length) return "skipped";
  // Field-path updates cannot be applied to a snapshot; they are not used by the planner paths, so skip rather than guess.
  if (watched.some(write => write.method === "update" && typeof write.args[1] === "string")) return "skipped";
  const today = londonServiceDate(new Date(ctx.now));

  const overlay = new Map<string, { collection: string; id: string; next: any | undefined; prior: any | undefined }>();
  for (const write of watched) {
    const ref = write.args[0];
    const collection = ref.parent.id as string;
    const key = `${collection}/${idOf(ref)}`;
    let entry = overlay.get(key);
    if (!entry) { const snap = await transaction.get(ref as DocumentReference); const prior = snap.exists ? snap.data() : undefined; entry = { collection, id: idOf(ref), prior, next: prior }; overlay.set(key, entry); }
    if (write.method === "delete") entry.next = undefined;
    else if (write.method === "update") entry.next = { ...entry.next, ...write.args[1] };
    else if (write.method === "set" && write.args[2]?.merge) entry.next = { ...entry.next, ...write.args[1] };
    else entry.next = write.args[1];
  }

  // Cheap early exit: no document of today's date is involved. Stops and assignments carry no date of their own, so resolve it.
  const dateOf = async (collection: string, doc: any): Promise<string | undefined> => {
    if (!doc) return undefined;
    if (doc.serviceDate) return doc.serviceDate as string;
    if (collection === STOPS && doc.runId) { const run = await transaction.get(runs().doc(doc.runId)); return run.exists ? (run.data() as DeliveryRun).serviceDate : undefined; }
    if (collection === ASSIGNMENTS && doc.loadId) { const load = await transaction.get(deliveryLoads().doc(doc.loadId)); return load.exists ? (load.data() as DeliveryLoad).serviceDate : undefined; }
    return undefined;
  };
  let touchesToday = false;
  for (const entry of overlay.values()) {
    if ((await dateOf(entry.collection, entry.prior)) === today || (await dateOf(entry.collection, entry.next)) === today) { touchesToday = true; break; }
  }
  if (!touchesToday) return "skipped";

  const [runSnap, loadSnap, assignmentSnap, jobSnap] = await Promise.all([
    transaction.get(runs().where("serviceDate", "==", today)),
    transaction.get(deliveryLoads().where("serviceDate", "==", today)),
    transaction.get(logisticsAssignments().where("serviceDate", "==", today)),
    transaction.get(logisticsJobs().where("serviceDate", "==", today)),
  ]);
  const baseRuns = runSnap.docs.map(doc => doc.data() as DeliveryRun);
  const overlayRunIds = [...overlay.values()].filter(entry => entry.collection === RUNS && entry.next && (entry.next as DeliveryRun).serviceDate === today).map(entry => entry.id);
  const runIds = uniqueSorted([...baseRuns.map(run => run.canonicalId), ...overlayRunIds]);
  const stopSnaps = await Promise.all(runIds.map(id => transaction.get(stops().where("runId", "==", id))));
  const base: DayState = {
    runs: baseRuns,
    loads: loadSnap.docs.map(doc => doc.data() as DeliveryLoad),
    assignments: assignmentSnap.docs.map(doc => ({ ...(doc.data() as LogisticsAssignment), __id: doc.id } as any)),
    jobs: jobSnap.docs.map(doc => doc.data() as LogisticsJob),
    stops: stopSnaps.flatMap(snap => snap.docs.map(doc => doc.data() as DeliveryStop)),
  };

  const loadIdsToday = new Set(base.loads.map(load => load.id));
  const after: DayState = {
    runs: applyOverlay(base.runs, run => run.canonicalId, RUNS, overlay, next => next.serviceDate === today),
    loads: applyOverlay(base.loads, load => load.id, LOADS, overlay, next => next.serviceDate === today),
    assignments: applyOverlay(base.assignments as any[], item => item.__id, ASSIGNMENTS, overlay, next => next.serviceDate === today || loadIdsToday.has(next.loadId)),
    jobs: applyOverlay(base.jobs, job => job.id, JOBS, overlay, next => next.serviceDate === today),
    stops: applyOverlay(base.stops, stop => stop.canonicalId, STOPS, overlay, next => runIds.includes(next.runId)),
  };

  const beforeSnapshots = buildDriverRunSnapshots(today, base);
  const afterSnapshots = buildDriverRunSnapshots(today, after);
  const beforeById = new Map(beforeSnapshots.map(item => [item.runId, item]));
  const afterById = new Map(afterSnapshots.map(item => [item.runId, item]));
  const changedIds = uniqueSorted([...beforeById.keys(), ...afterById.keys()]).filter(id => {
    const left = beforeById.get(id), right = afterById.get(id);
    // The run version is ignored for "did anything driver-visible change"; it only identifies which commit changed it.
    return stable(left && { ...left, version: 0 }) !== stable(right && { ...right, version: 0 });
  });
  if (!changedIds.length) return "skipped";

  const mutations: ChangeMutation[] = [...overlay.values()].map(entry => ({ entityType: ENTITY[entry.collection], entityId: entry.id, beforeVersion: Number(entry.prior?.version ?? 0), afterVersion: Number(entry.next?.version ?? 0) }));
  const eventId = driverChangeEventId(`${ctx.action}@${ctx.now}`, changedIds.map(id => ({ runId: id, beforeVersion: beforeById.get(id)?.version ?? 0, afterVersion: afterById.get(id)?.version ?? 0 })), mutations);
  return stageDriverChangeEvent(transaction as never, driverChangeEvents().doc(eventId), {
    eventId, serviceDate: today, sourceAction: ctx.action, actorId: ctx.actorId, committedAt: ctx.now,
    before: changedIds.flatMap(id => beforeById.get(id) ?? []),
    after: changedIds.flatMap(id => afterById.get(id) ?? []),
    mutations,
  });
}

/**
 * A plain Firestore transaction that also stages an immutable driver change event in the SAME commit, for writers that do not go
 * through `authorizeTransaction` (upstream reconciliation, job saves, admin repairs). Writes are buffered until every read is done
 * (Firestore requires reads first anyway), the change is captured from those reads plus the buffered writes, and only then flushed.
 * Processing into inbox notices happens after the commit and can never fail the write. Without a context it is a plain transaction.
 */
export async function runCapturedTransaction<T>(ctx: CaptureContext | undefined, callback: (transaction: Transaction) => Promise<T>): Promise<T> {
  if (!ctx) return db.runTransaction(callback);
  const result = await db.runTransaction(async transaction => {
    const writes: BufferedWrite[] = [];
    const proxy: Transaction = new Proxy(transaction, { get(target, name) {
      if (["set", "create", "update", "delete"].includes(String(name))) return (...args: any[]) => { writes.push({ method: name as BufferedWrite["method"], args }); return proxy; };
      const value = Reflect.get(target, name);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const value = await callback(proxy);
    try { await stageDriverChangeFromWrites(transaction, writes, ctx); }
    catch (error) { console.error("[driver-notifications] change capture skipped", error instanceof Error ? error.message : "unknown error"); }
    for (const write of writes) (transaction[write.method] as any)(...write.args);
    return value;
  });
  await processDriverNotificationsSafely();
  return result;
}
