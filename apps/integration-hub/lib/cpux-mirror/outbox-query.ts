import type { CollectionReference, DocumentData } from "firebase-admin/firestore";

/**
 * Select only retryable Calendar obligations before applying the batch limit.
 * The transaction still rechecks eventIsDue so a concurrently claimed lease
 * cannot be processed twice.
 */
export function dueHospitalityMirrorQuery(collection: CollectionReference<DocumentData>, asOf: string, limit: number) {
  return collection
    .where("outboxStatus", "in", ["pending", "failed"])
    .where("nextEligibleAt", "<=", asOf)
    .orderBy("nextEligibleAt")
    .limit(limit);
}
