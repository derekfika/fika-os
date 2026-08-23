import { db } from "./firebase";
import type { DocumentData } from "firebase-admin/firestore";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsAssignment, LogisticsChangeEvent, LogisticsDayProjection, LogisticsJob, MovementRequest } from "./types";
import { scopeState } from "./planning";
import { resolveLegacyAssignmentServiceDate } from "./assignment-migration";
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
const preferenceId = (groupKey: string) => encodeURIComponent(groupKey);
export async function listCollectionPreferenceKeys() {
  const snapshot = await collectionPreferences().where("collectionRequired", "==", true).get();
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
  return serviceDate ? scopeState(state, serviceDate) : state;
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
  return { jobs: jobSnap.docs.map((d) => d.data() as LogisticsJob), loads: loadSnap.docs.map((d) => d.data() as DeliveryLoad), assignments: assignmentSnap.docs.map((d) => d.data() as LogisticsAssignment) };
}
export async function saveLogisticsJob(job: LogisticsJob) { await logisticsJobs().doc(job.id).set(job); return job; }
export async function saveDeliveryLoad(load: DeliveryLoad) { await deliveryLoads().doc(load.id).set(load); return load; }
export async function saveLogisticsProjection(projection: LogisticsDayProjection) { await logisticsDayProjections().doc(projection.serviceDate).set(projection); return projection; }
export async function getLogisticsProjection(serviceDate: string) { const snapshot = await logisticsDayProjections().doc(serviceDate).get(); return snapshot.exists ? snapshot.data() as LogisticsDayProjection : undefined; }
export async function listLogisticsChanges(after = 0, serviceDate?: string) {
  const query = serviceDate ? logisticsChanges().where("serviceDate", "==", serviceDate).where("sequence", ">", after).orderBy("sequence", "asc") : logisticsChanges().where("sequence", ">", after).orderBy("sequence", "asc");
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data() as LogisticsChangeEvent);
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
    const sequence = Number(cursorSnap.data()?.sequence || 0) + 1;
    const event = { ...input, sequence };
    transaction.set(cursorRef, { sequence });
    transaction.create(logisticsChanges().doc(String(sequence).padStart(20, "0")), event);
    return event;
  });
}
