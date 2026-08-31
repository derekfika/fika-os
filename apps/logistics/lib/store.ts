import { db } from "./firebase";
import type { DocumentData } from "firebase-admin/firestore";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsAssignment, LogisticsChangeEvent, LogisticsDayProjection, LogisticsJob, MovementRequest } from "./types";
import { scopeState } from "./planning";
import { resolveLegacyAssignmentServiceDate } from "./assignment-migration";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { applyLogisticsProjectionInvalidation, type LogisticsProjectionInvalidation } from "./logistics-projection";
export const runs = () => db.collection("fikaLogisticsDeliveryRunsV1");
export const stops = () => db.collection("fikaLogisticsDeliveryStopsV1");
export const movements = () => db.collection("fikaLogisticsMovementRequestsV1");
export const collectionPreferences = () => db.collection("fikaLogisticsCollectionPreferencesV1");
export const logisticsJobs = () => db.collection("fikaLogisticsJobsV1");
export const deliveryLoads = () => db.collection("fikaLogisticsDeliveryLoadsV1");
export const logisticsAssignments = () => db.collection("fikaLogisticsAssignmentsV1");
export const logisticsChanges = () => db.collection("fikaLogisticsChangesV1");
export const logisticsChangeCursor = () => db.collection("fikaLogisticsChangeCursorV1");
export const logisticsDayProjections = () => db.collection("fikaLogisticsDayProjectionsV1");
export const LOGISTICS_CHANGE_LIMIT = 200;
const readBudgetEnabled = () => process.env.LOGISTICS_READ_BUDGET === "1";
function reportRead(operation: string, documents: number) {
  if (readBudgetEnabled()) console.info(`[logistics-read-budget] ${operation} documents=${documents}`);
}
export function reportLogisticsReadPath(operation: string) {
  if (readBudgetEnabled()) console.info(`[logistics-read-budget] ${operation}`);
}
const preferenceId = (groupKey: string) => encodeURIComponent(groupKey);
export async function listCollectionPreferenceKeys() {
  const snapshot = await collectionPreferences().where("collectionRequired", "==", true).get();
  recordDataAccess({ app: "logistics", operation: "collection-preferences.list", source: "FIRESTORE", documents: snapshot.size, firestoreReadKind: "query" });
  return snapshot.docs.map((doc) => String(doc.data().groupKey || decodeURIComponent(doc.id)));
}
export async function saveCollectionPreference(groupKey: string, collectionRequired: boolean, by: string, now: string) {
  const ref = collectionPreferences().doc(preferenceId(groupKey));
  if (collectionRequired) await ref.set({ groupKey, collectionRequired: true, updatedAt: now, updatedBy: by });
  else await ref.delete();
  return { groupKey, collectionRequired };
}
export function normalizeStop(value: DocumentData): DeliveryStop {
  const legacy =
    typeof value.movementRequestId === "string"
      ? [value.movementRequestId]
      : [];
  const issues = (value.issues || []) as DeliveryStop["issues"];
  const legacyIssues =
    value.status === "issue" && !issues?.length
      ? [
          {
            id: `legacy-issue:${value.canonicalId}`,
            stopId: value.canonicalId,
            reportedAt:
              value.updatedAt || value.createdAt || new Date().toISOString(),
            reportedBy: "legacy-prototype",
            description: value.notes || "Legacy stop issue",
            status: "open" as const,
          },
        ]
      : [];
  return {
    ...value,
    status: value.status === "issue" ? "planned" : value.status,
    issues: [...(issues || []), ...legacyIssues],
    requirementRefs: value.requirementRefs || [],
    movementRequestIds: Array.from(
      new Set([...(value.movementRequestIds || []), ...legacy]),
    ),
  } as DeliveryStop;
}
export async function listState(serviceDate?: string) {
  const [runSnap, movementSnap] = await Promise.all([
    serviceDate ? runs().where("serviceDate", "==", serviceDate).get() : runs().get(),
    serviceDate ? movements().where("serviceDate", "==", serviceDate).get() : movements().get(),
  ]);
  const runIds = runSnap.docs.map((doc) => doc.id);
  const stopSnapshots = serviceDate
    ? await Promise.all(Array.from({ length: Math.max(1, Math.ceil(runIds.length / 30)) }, (_, index) => {
        const chunk = runIds.slice(index * 30, index * 30 + 30);
        return chunk.length ? stops().where("runId", "in", chunk).get() : Promise.resolve(undefined);
      }))
    : [await stops().get()];
  const stopDocs = stopSnapshots.flatMap((snapshot) => snapshot?.docs || []);
  const state = {
    runs: runSnap.docs.map((d) => d.data() as DeliveryRun),
    stops: stopDocs.map((d) => normalizeStop(d.data())),
    movements: movementSnap.docs.map((d) => d.data() as MovementRequest),
  };
  recordDataAccess({ app: "logistics", operation: "runs.service-date", source: "FIRESTORE", documents: runSnap.size, firestoreReadKind: "query" });
  recordDataAccess({ app: "logistics", operation: "movements.service-date", source: "FIRESTORE", documents: movementSnap.size, firestoreReadKind: "query" });
  recordDataAccess({ app: "logistics", operation: "stops.service-date", source: "FIRESTORE", documents: stopDocs.length, firestoreReadKind: "query" });
  reportRead(`state${serviceDate ? `:${serviceDate}` : ":all"}`, runSnap.size + movementSnap.size + stopDocs.length);
  return serviceDate ? scopeState(state, serviceDate) : state;
}
export async function getRun(runId: string) {
  const snapshot = await runs().doc(runId).get();
  recordDataAccess({ app: "logistics", operation: "run.by-id", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  reportRead("run:direct", snapshot.exists ? 1 : 0);
  return snapshot.exists ? snapshot.data() as DeliveryRun : undefined;
}
export async function getLogisticsJob(jobId: string) {
  const snapshot = await logisticsJobs().doc(jobId).get();
  recordDataAccess({ app: "logistics", operation: "job.by-id", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  reportRead("job:direct", snapshot.exists ? 1 : 0);
  return snapshot.exists ? snapshot.data() as LogisticsJob : undefined;
}
export async function getDeliveryLoad(loadId: string) {
  const snapshot = await deliveryLoads().doc(loadId).get();
  recordDataAccess({ app: "logistics", operation: "load.by-id", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  reportRead("load:direct", snapshot.exists ? 1 : 0);
  return snapshot.exists ? snapshot.data() as DeliveryLoad : undefined;
}
export async function saveRun(run: DeliveryRun) {
  await runs().doc(run.canonicalId).set(run);
  return run;
}
export async function saveStop(stop: DeliveryStop) {
  await stops().doc(stop.canonicalId).set(stop);
  return stop;
}
export async function saveMovement(movement: MovementRequest) {
  await movements().doc(movement.canonicalId).set(movement);
  return movement;
}
export async function listDeliveryLoadState(serviceDate?: string) {
  const [jobSnap, loadSnap, assignmentSnap] = await Promise.all([
    serviceDate ? logisticsJobs().where("serviceDate", "==", serviceDate).get() : logisticsJobs().get(),
    serviceDate ? deliveryLoads().where("serviceDate", "==", serviceDate).get() : deliveryLoads().get(),
    serviceDate ? logisticsAssignments().where("serviceDate", "==", serviceDate).get() : logisticsAssignments().get(),
  ]);
  recordDataAccess({ app: "logistics", operation: "jobs.service-date", source: "FIRESTORE", documents: jobSnap.size, firestoreReadKind: "query" });
  recordDataAccess({ app: "logistics", operation: "loads.service-date", source: "FIRESTORE", documents: loadSnap.size, firestoreReadKind: "query" });
  recordDataAccess({ app: "logistics", operation: "assignments.service-date", source: "FIRESTORE", documents: assignmentSnap.size, firestoreReadKind: "query" });
  reportRead(`delivery-load-state${serviceDate ? `:${serviceDate}` : ":all"}`, jobSnap.size + loadSnap.size + assignmentSnap.size);
  return { jobs: jobSnap.docs.map((d) => d.data() as LogisticsJob), loads: loadSnap.docs.map((d) => d.data() as DeliveryLoad), assignments: assignmentSnap.docs.map((d) => d.data() as LogisticsAssignment) };
}
export async function saveLogisticsJob(job: LogisticsJob) { await logisticsJobs().doc(job.id).set(job); return job; }
export async function saveDeliveryLoad(load: DeliveryLoad) { await deliveryLoads().doc(load.id).set(load); return load; }
export async function saveLogisticsProjection(projection: LogisticsDayProjection) { await logisticsDayProjections().doc(projection.serviceDate).set(projection); return projection; }
export async function invalidateLogisticsProjection(change: LogisticsProjectionInvalidation) {
  return db.runTransaction(async (transaction) => {
    const projectionRef = logisticsDayProjections().doc(change.serviceDate);
    const cursorRef = logisticsChangeCursor().doc("global");
    const projectionSnap = await transaction.get(projectionRef);
    if (!projectionSnap.exists) return { applied: false as const, reason: "missing-projection" as const };
    const current = projectionSnap.data() as LogisticsDayProjection;
    const result = applyLogisticsProjectionInvalidation(current, change);
    if (!result.applied) return result;
    const cursorSnap = await transaction.get(cursorRef);
    const sequence = Number(cursorSnap.data()?.sequence || 0) + 1;
    const next = { ...result.projection, lastChangeSequence: sequence, revision: Math.max(current.revision + 1, sequence) };
    transaction.set(cursorRef, { sequence, updatedAt: change.changedAt });
    transaction.create(logisticsChanges().doc(String(sequence).padStart(20, "0")), { sequence, serviceDate: change.serviceDate, entityType: "upstream", entityId: change.sourceEntityId, changeType: `upstream-${change.changeType}`, revision: change.sourceVersion, changedAt: change.changedAt, actorId: `source:${change.sourceDomain}` });
    transaction.set(projectionRef, next);
    return { applied: true as const, sequence, projection: next };
  });
}
export async function getLogisticsProjection(serviceDate: string) { const snapshot = await logisticsDayProjections().doc(serviceDate).get(); recordDataAccess({ app: "logistics", operation: "projection.by-service-date", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" }); reportRead(`projection:${serviceDate}`, snapshot.exists ? 1 : 0); return snapshot.exists ? snapshot.data() as LogisticsDayProjection : undefined; }
export function summarizeLogisticsProjection(serviceDate: string, projection?: LogisticsDayProjection) {
  const loads = projection?.deliveryLoads || [];
  const scheduled = loads.filter((load) => Boolean(load.scheduledTime)).length;
  return {
    serviceDate, loads: loads.length,
    ready: loads.filter((load) => load.readiness === "ready").length,
    unplanned: projection?.summary.queuedJobs || 0, queue: projection?.summary.queuedJobs || 0,
    scheduled, needsTime: loads.length - scheduled, runs: projection?.runs.length || 0,
    attention: projection?.exceptions.length || 0, completedStops: loads.filter((load) => load.status === "delivered").length,
    stopCount: loads.length, deliveries: loads.length, collections: 0, transfers: 0,
  };
}
export async function listLogisticsProjectionSummaries(serviceDates: string[]) {
  const projections = await Promise.all(serviceDates.map((serviceDate) => getLogisticsProjection(serviceDate)));
  return serviceDates.map((serviceDate, index) => summarizeLogisticsProjection(serviceDate, projections[index]));
}
export async function listPlanningAttention(serviceDates: string[], expectedSourceKeys?: Map<string, Set<string>>) {
  const projections = await Promise.all(serviceDates.map((serviceDate) => getLogisticsProjection(serviceDate)));
  const attention = projections.flatMap((projection, index) => {
    const projectedKeys = new Set([...(projection?.planningQueue || []).map((job) => `${job.sourceType}:${job.sourceId}`), ...(projection?.deliveryLoads || []).flatMap((load) => load.jobs.map((job) => `${job.sourceType}:${job.sourceId}`))]);
    const missing = [...(expectedSourceKeys?.get(serviceDates[index]) || [])].filter((key) => !projectedKeys.has(key)).length;
    const count = Math.max(projection?.summary.queuedJobs || 0, missing);
    return count > 0 ? [{ serviceDate: serviceDates[index], count }] : [];
  });
  reportRead(`planning-attention:${serviceDates.length}`, attention.length);
  return attention;
}
export async function getLogisticsSyncHead() {
  const snapshot = await logisticsChangeCursor().doc("global").get();
  recordDataAccess({ app: "logistics", operation: "sync-head.lookup", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  reportRead("sync-head", snapshot.exists ? 1 : 0);
  return { sequence: Number(snapshot.data()?.sequence || 0), updatedAt: snapshot.data()?.updatedAt as string | undefined };
}
export async function listLogisticsChanges(after = 0, serviceDate?: string) {
  const query = serviceDate ? logisticsChanges().where("serviceDate", "==", serviceDate).where("sequence", ">", after).orderBy("sequence", "asc").limit(LOGISTICS_CHANGE_LIMIT + 1) : logisticsChanges().where("sequence", ">", after).orderBy("sequence", "asc").limit(LOGISTICS_CHANGE_LIMIT + 1);
  const snapshot = await query.get();
  recordDataAccess({ app: "logistics", operation: "changes.incremental-page", source: "FIRESTORE", documents: snapshot.size, firestoreReadKind: "query" });
  reportRead(`changes-since:${after}${serviceDate ? `:${serviceDate}` : ""}`, snapshot.size);
  const documents = snapshot.docs.slice(0, LOGISTICS_CHANGE_LIMIT);
  const changes = documents.map((doc) => doc.data() as LogisticsChangeEvent);
  return { changes, hasMore: snapshot.size > LOGISTICS_CHANGE_LIMIT, nextCursor: changes.at(-1)?.sequence ?? after };
}
export async function repairLegacyAssignmentServiceDates() {
  const [assignmentSnap, jobSnap, loadSnap] = await Promise.all([logisticsAssignments().get(), logisticsJobs().get(), deliveryLoads().get()]);
  const jobs = new Map(jobSnap.docs.map((doc) => [doc.id, doc.data() as LogisticsJob]));
  const loads = new Map(loadSnap.docs.map((doc) => [doc.id, doc.data() as DeliveryLoad]));
  const batch = db.batch();
  const repaired: string[] = [];
  const unresolved: Array<{ assignmentId: string; reason: string }> = [];
  for (const document of assignmentSnap.docs) {
    const assignment = document.data() as LogisticsAssignment;
    if (assignment.serviceDate) continue;
    const jobDate = jobs.get(assignment.jobId)?.serviceDate;
    const loadDate = loads.get(assignment.loadId)?.serviceDate;
    const resolution = resolveLegacyAssignmentServiceDate(jobDate, loadDate);
    const serviceDate = resolution.serviceDate;
    if (serviceDate) {
      batch.set(document.ref, { serviceDate }, { merge: true });
      repaired.push(document.id);
    } else {
      unresolved.push({ assignmentId: document.id, reason: String(resolution.reason || "Unable to resolve assignment service date") });
    }
  }
  if (repaired.length) await batch.commit();
  return { repaired, unresolved };
}
export async function appendLogisticsChange(input: Omit<LogisticsChangeEvent, "sequence">) {
  return db.runTransaction(async (transaction) => {
    const cursorRef = logisticsChangeCursor().doc("global");
    const cursorSnap = await transaction.get(cursorRef);
    recordDataAccess({ app: "logistics", operation: "change-cursor.transaction-read", source: "FIRESTORE", documents: cursorSnap.exists ? 1 : 0, firestoreReadKind: "transaction" });
    const sequence = Number(cursorSnap.data()?.sequence || 0) + 1;
    const event = { ...input, sequence };
    transaction.set(cursorRef, { sequence, updatedAt: input.changedAt });
    transaction.create(logisticsChanges().doc(String(sequence).padStart(20, "0")), event);
    return event;
  });
}
