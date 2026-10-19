import type { PlannedMenuItem } from "./production-plan";

/** Identifies the exact reviewed content so signing is only offered for what was actually persisted. */
export function reviewFingerprint(items: PlannedMenuItem[], notes: string) {
  return JSON.stringify([notes.trim(), items.map((item) => [item.id, item.name.trim(), item.subItems.map((sub) => [sub.id, sub.name.trim(), sub.evidenceStatus, (sub.mayContainNotes || "").trim(), Object.entries(sub.allergens).sort(([left], [right]) => left.localeCompare(right))])])]);
}

/**
 * Signing is offered only for a complete matrix that the server persisted as reviewed, with no conflict, and whose content
 * is exactly what was sent in the successful save. Anything edited since (including while a save was in flight) disables it.
 */
export function isSigningAvailable(input: { reviewConflict: boolean; effectiveStatus: string; savedFingerprint: string | undefined; currentFingerprint: string }) {
  return !input.reviewConflict && input.effectiveStatus === "planned" && input.savedFingerprint !== undefined && input.savedFingerprint === input.currentFingerprint;
}

/** The saved fingerprint after a save attempt: the fingerprint of the content that was SENT, and only when the server confirmed it. */
export function savedFingerprintAfterSave(sentFingerprint: string, saveSucceeded: boolean) {
  return saveSucceeded ? sentFingerprint : undefined;
}

/** True when the editor holds edits that have not been confirmed by the server (compared with the last confirmed content). */
export function hasUnsavedEdits(cleanFingerprint: string | undefined, currentFingerprint: string) {
  return cleanFingerprint !== undefined && cleanFingerprint !== currentFingerprint;
}

export type MatrixStorageStatus = "not_configured" | "ready" | "artifact_pending" | "artifact_failed";

/** Pending / Ready / Failed for the signed PDF, from a plan response. Nothing before both signatures are persisted. */
export function deriveMatrixStorageStatus(body: { matrixStatus?: string; plan?: { matrixArtifact?: unknown; signatures?: unknown[] } }): MatrixStorageStatus | undefined {
  if (body.matrixStatus === "not_configured") return "not_configured";
  if (body.plan?.matrixArtifact) return "ready";
  if (body.plan?.signatures?.length === 2) return body.matrixStatus === "failed" ? "artifact_failed" : "artifact_pending";
  return undefined;
}

/** The background PDF is re-checked about every 30 seconds while the page is open and the PDF is pending. */
export const MATRIX_POLL_INTERVAL_MS = 30_000;
