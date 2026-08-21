import { db } from "./firebase";
import type { DocumentData } from "firebase-admin/firestore";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "./types";
import { scopeState } from "./planning";
export const runs = () => db.collection("fikaLogisticsDeliveryRunsV1");
export const stops = () => db.collection("fikaLogisticsDeliveryStopsV1");
export const movements = () => db.collection("fikaLogisticsMovementRequestsV1");
export const collectionPreferences = () => db.collection("fikaLogisticsCollectionPreferencesV1");
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
  const [runSnap, stopSnap, movementSnap] = await Promise.all([
    runs().get(),
    stops().get(),
    movements().get(),
  ]);
  const state = {
    runs: runSnap.docs.map((d) => d.data() as DeliveryRun),
    stops: stopSnap.docs.map((d) => normalizeStop(d.data())),
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
