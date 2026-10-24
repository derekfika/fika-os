import { db } from "./firebase-admin";
import { stableDocumentId } from "./canonical-editor";
import { adHocProductionOrderId, type AdHocAllergenChecker, type AdHocAllergenCheckerReport } from "../../shared/ad-hoc-production-contract";

const COLLECTION = "fikaAdHocAllergenCheckerV1";
const records = () => db.collection(COLLECTION);
export type AdHocAllergenCheckerRecord = AdHocAllergenCheckerReport & { updatedAt: string };
const AD_HOC_ORDER_ID_PREFIX = adHocProductionOrderId("");

/**
 * Stores CPU's report of the signed Ad-Hoc allergen checker. CPU is the authority for the release; this is a small derived
 * projection for the requester. Reports are idempotent and monotonic: an older release version, or a signed report for a release
 * that is already withdrawn, is ignored.
 */
export async function recordAdHocAllergenChecker(report: AdHocAllergenCheckerReport, at = new Date().toISOString()) {
  if (!report.canonicalId.startsWith(AD_HOC_ORDER_ID_PREFIX)) throw Object.assign(new Error("Only Ad-Hoc Production orders can carry an Ad-Hoc allergen checker."), { status: 422, code: "AD_HOC_CHECKER_NOT_AD_HOC" });
  const ref = records().doc(stableDocumentId(report.canonicalId));
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() as AdHocAllergenCheckerRecord : undefined;
    if (existing) {
      if (existing.releaseVersion > report.releaseVersion) return { applied: false as const, reason: "stale_release_version" as const };
      if (existing.releaseId === report.releaseId && existing.state === "withdrawn" && report.state === "signed") return { applied: false as const, reason: "release_already_withdrawn" as const };
    }
    transaction.set(ref, { ...report, updatedAt: at } satisfies AdHocAllergenCheckerRecord);
    return { applied: true as const };
  });
}

export async function readAdHocAllergenChecker(canonicalId: string) {
  const snapshot = await records().doc(stableDocumentId(canonicalId)).get();
  return snapshot.exists ? snapshot.data() as AdHocAllergenCheckerRecord : undefined;
}

/** The requester-facing state. A signed checker is only "signed" while it matches the order's current amendment revision and the order is live. */
export function projectAdHocAllergenChecker(record: AdHocAllergenCheckerRecord | undefined, order: { status: string; currentRevision?: number; sourceVersion?: number; version: number }): AdHocAllergenChecker {
  if (!record) return { state: "not_signed" };
  const base = { ...(record.signedAt ? { signedAt: record.signedAt } : {}), ...(record.signers ? { signers: record.signers } : {}), ...(record.fileName ? { fileName: record.fileName } : {}) };
  if (record.state === "withdrawn") return { state: "withdrawn", ...base, reason: record.reason || "The signed allergen checker was withdrawn." };
  if (order.status === "cancelled") return { state: "withdrawn", ...base, reason: "The order was cancelled." };
  const revision = order.currentRevision || order.sourceVersion || order.version;
  if (record.sourceRevision !== revision) return { state: "withdrawn", ...base, reason: "The order was amended after it was signed." };
  return { state: "signed", ...base, ...(record.driveUrl ? { driveUrl: record.driveUrl } : {}) };
}
