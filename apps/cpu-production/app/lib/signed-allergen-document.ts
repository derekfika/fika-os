import type { ProductionOrder } from "../../lib/production-types";
import { isAdHocProductionOrder } from "../../lib/ad-hoc-order";
import { currentAllergenReleaseMatchesOrder, type MatrixArtifact, type ProductionPlan } from "./production-plan";

export type SignedAllergenDocumentState = "ready" | "unsigned" | "pending" | "failed" | "revoked" | "stale" | "unavailable";
export type SignedAllergenDocumentResult = { state: SignedAllergenDocumentState; message: string; artifact?: MatrixArtifact };

const hasRole = (plan: ProductionPlan, role: "production_chef" | "head_chef_site_manager") =>
  Boolean(plan.currentAllergenRelease?.signatures.some(signature => signature.role === role && signature.valid));

/** Select only an already materialized artifact belonging to this exact current signed release. */
export function signedAllergenDocumentForOrder(plan: ProductionPlan | undefined, order: ProductionOrder): SignedAllergenDocumentResult {
  if (!plan) return { state: "unsigned", message: "Not signed yet. The PDF appears here after both chefs sign." };
  const release = plan.currentAllergenRelease;
  if (release?.status === "revoked") return { state: "revoked", message: "This signed document was revoked and is unavailable." };
  if (!hasRole(plan, "production_chef") || !hasRole(plan, "head_chef_site_manager")) {
    return { state: "unsigned", message: "Not signed yet. The PDF appears here after both chefs sign." };
  }
  if (release?.materializationStatus === "failed") return { state: "failed", message: "Both signatures are recorded, but the signed PDF could not be saved. Contact CPU support." };
  if (!release || release.status === "pending" || release.materializationStatus === "pending") {
    return { state: "pending", message: "Both signatures are recorded. The signed PDF is still being prepared." };
  }
  if (release.status !== "current" || !currentAllergenReleaseMatchesOrder(release, order, plan.menuItems)) {
    return { state: "stale", message: "The signed document no longer matches this order. Review and sign the current version." };
  }

  const isAdHoc = isAdHocProductionOrder(order);
  const artifact = isAdHoc ? release.masterArtifact : release.derivedArtifacts.find(candidate =>
    candidate.id === plan.matrixArtifact?.id && candidate.contentHash === plan.matrixArtifact?.contentHash,
  );
  if (!artifact || artifact.pdfStatus !== "generated" || artifact.driveStatus !== "saved"
    || !artifact.driveFileId || !/^[A-Za-z0-9_-]{1,200}$/.test(artifact.driveFileId)
    || !/^[a-f0-9]{64}$/i.test(artifact.contentHash)
    || artifact.bookingId !== order.sourceBookingId) {
    return { state: "unavailable", message: "The current signed PDF is unavailable. No replacement document was generated." };
  }
  return { state: "ready", message: "Current signed allergen PDF is ready to view or print.", artifact };
}
