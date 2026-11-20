import type { CollectionReference, DocumentData } from "firebase-admin/firestore";

export function hospitalityMirrorOutboxStatus(status: string, live: boolean) {
  return live && (status === "pending" || status === "failed") ? `live-${status}` : status;
}

/**
 * Select live retryable obligations before applying the batch limit.
 * Historical obligations require an explicitly approved catch-up batch.
 * The transaction still rechecks eventIsDue so a concurrently claimed lease
 * cannot be processed twice.
 */
export function dueHospitalityMirrorQuery(collection: CollectionReference<DocumentData>, asOf: string, limit: number) {
  return collection
    .where("outboxStatus", "in", ["live-pending", "live-failed"])
    .where("nextEligibleAt", "<=", asOf)
    .orderBy("nextEligibleAt")
    .limit(limit);
}
