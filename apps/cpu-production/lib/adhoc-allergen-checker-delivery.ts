import type { CpuAllergenRelease } from "./cpu-allergen-release";
import type { CpuDurableDeliveryInput } from "./cpu-durable-outbox";
import { isAdHocProductionOrder } from "../lib/ad-hoc-order";
import type { ProductionOrder } from "./production-types";

/** A Hub projection contains release lineage and signer display details, never a Drive URL or file id. */
export function adHocAllergenCheckerDelivery(release: CpuAllergenRelease, order: ProductionOrder, status: "current" | "revoked"): CpuDurableDeliveryInput | undefined {
  if (!isAdHocProductionOrder(order)) return undefined;
  const requestId = order.sourceEntityId || order.canonicalId.replace(/^production-order:v1:ad-hoc:/, "");
  if (!requestId || release.sourceVersion !== (order.currentRevision || order.sourceVersion) || release.status !== status) return undefined;
  if (status === "current" && (release.materializationStatus !== "ready" || !release.signatures.some(signature => signature.role === "production_chef" && signature.valid) || !release.signatures.some(signature => signature.role === "head_chef_site_manager" && signature.valid) || !release.masterArtifact.fileName)) return undefined;
  const body = {
    requestId,
    canonicalId: order.canonicalId,
    releaseId: release.releaseId,
    releaseVersion: release.version,
    sourceRevision: release.sourceRevision || release.sourceVersion,
    sourceVersion: release.sourceVersion,
    sourceContentHash: release.sourceContentHash,
    state: status,
    signedAt: release.signedAt,
    ...(release.revokedAt ? { revokedAt: release.revokedAt } : {}),
    ...(status === "current" ? { fileName: release.masterArtifact.fileName, pdfAvailable: true } : { pdfAvailable: false }),
    signatures: release.signatures.filter(signature => signature.valid).map(({ role, printedName, signedAt }) => ({ role, printedName, signedAt })),
  };
  return {
    eventId: `adhoc-allergen-checker:${requestId}:${release.releaseId}:${status}`,
    sourceAggregateId: order.canonicalId,
    sourceVersion: release.sourceVersion,
    occurredAt: status === "revoked" ? release.revokedAt || new Date().toISOString() : release.signedAt,
    consumer: "integration-hub",
    route: "/api/internal/ad-hoc-production/allergen-checker",
    body,
  };
}
