import type { OperationalAllergenState } from "../../../shared/allergen-contract";
import { allergenMatrixContentHash } from "../../lib/cpu-allergen-release";
export type PlanStatus = "draft" | "planning" | "planned" | "rejected" | "needs_clarification";
export type AllergenCellState = OperationalAllergenState;
export type PlannedSubItem = {
  id: string;
  productionItemId?: string;
  name: string;
  quantity: number | null;
  allergens: Record<string, AllergenCellState>;
  mayContainNotes?: string;
  note: string;
  evidenceStatus: "not_completed" | "completed" | "requires_review";
};
export type PlannedMenuItem = { id: string; sourceLineId?: string; name: string; note: string; subItems: PlannedSubItem[] };
export type MatrixSignatureScope = {
  productionOrderId: string;
  serviceDate: string;
  sourceDayId: string;
  sourcePublicationId?: string;
  sourcePublicationDayId: string;
  sourceVersion: number;
  sourceContentHash: string;
  matrixContentHash: string;
};
export type InternalMatrixSignature = { role: "production_chef" | "head_chef_site_manager"; printedName: string; signedAt: string; actor: string; attestation: string; signatureDataUrl?: string; scope?: MatrixSignatureScope };
export type MatrixArtifact = { id: string; bookingId: string; fileName: string; createdAt: string; createdBy: string; contentHash: string; html?: string; pdfPath?: string; localUrl?: string; pdfStatus: "generated" | "unavailable"; driveFileId?: string; driveUrl?: string; driveStatus: "saved" | "not_configured" | "failed"; bundleId?: string; packetContentHash?: string; packetObjectName?: string; sourceRevision?: number; sourceContentHash?: string };
export type CpuAllergenRelease = import("../../lib/cpu-allergen-release").CpuAllergenRelease;
/** A production menu item may contain several separately checked sub-items. */
export type ProductionPlan = { id: string; orderId: string; status: PlanStatus; acceptedBy?: string; acceptedAt?: string; rejectionReason?: string; clarificationNote?: string; menuItems: PlannedMenuItem[]; planningNotes: string; signatures?: InternalMatrixSignature[]; matrixArtifact?: MatrixArtifact; masterMatrixArtifact?: MatrixArtifact; siteMatrixArtifacts?: Record<string, MatrixArtifact>; signedMenuContentHash?: string; signedSignatures?: InternalMatrixSignature[]; signedMatrixArtifact?: MatrixArtifact; currentAllergenRelease?: CpuAllergenRelease; allergenReleaseHistory?: CpuAllergenRelease[]; updatedAt: string; updatedBy: string; audit: Array<{ action: string; at: string; by: string; reason?: string }> };

export function matrixSignatureScope(order: { canonicalId: string; serviceDate?: string; requiredBy: string; sourceEntityId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string }, matrixContentHash: string): MatrixSignatureScope | undefined {
  const serviceDate = order.serviceDate || order.requiredBy?.slice(0, 10);
  if (!serviceDate) return undefined;
  if (!order.sourceEntityId || !order.sourcePublicationDayId || !order.sourceVersion || !order.sourceContentHash) return undefined;
  return { productionOrderId: order.canonicalId, serviceDate, sourceDayId: order.sourceEntityId, ...(order.sourcePublicationId ? { sourcePublicationId: order.sourcePublicationId } : {}), sourcePublicationDayId: order.sourcePublicationDayId, sourceVersion: order.sourceVersion, sourceContentHash: order.sourceContentHash, matrixContentHash };
}

export function signatureMatchesScope(signature: InternalMatrixSignature, scope: MatrixSignatureScope | undefined) {
  if (!scope || !signature.scope) return false;
  const candidate = signature.scope;
  return candidate.productionOrderId === scope.productionOrderId && candidate.serviceDate === scope.serviceDate && candidate.sourceDayId === scope.sourceDayId && candidate.sourcePublicationId === scope.sourcePublicationId && candidate.sourcePublicationDayId === scope.sourcePublicationDayId && candidate.sourceVersion === scope.sourceVersion && candidate.sourceContentHash === scope.sourceContentHash && candidate.matrixContentHash === scope.matrixContentHash;
}

/** Human signatures remain authoritative while their exact release is pending materialisation. */
export function signatureAuthorityForOrder(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "currentAllergenRelease">, order: { canonicalId: string; serviceDate?: string; requiredBy: string; sourceEntityId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string }, menuItems: PlannedMenuItem[]) {
  const scope = matrixSignatureScope(order, allergenMatrixContentHash(menuItems));
  if (!scope) return [] as InternalMatrixSignature[];
  if (plan.currentAllergenRelease && !["pending", "current"].includes(plan.currentAllergenRelease.status)) return [];
  const candidates = plan.signatures?.length ? plan.signatures : plan.signedSignatures?.length ? plan.signedSignatures : plan.currentAllergenRelease?.signatures || [];
  return candidates.filter(signature => signatureMatchesScope(signature, scope) && ("valid" in signature ? signature.valid !== false : true));
}

export function currentAllergenReleaseMatchesOrder(release: CpuAllergenRelease | undefined, order: { canonicalId: string; serviceDate?: string; requiredBy: string; sourceEntityId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string }, menuItems: PlannedMenuItem[]) {
  const scope = matrixSignatureScope(order, allergenMatrixContentHash(menuItems));
  if (!release || release.status !== "current" || release.materializationStatus !== "ready" || !scope) return false;
  const roles = new Set(release.signatures.map(signature => signature.role));
  if (!roles.has("production_chef") || !roles.has("head_chef_site_manager")) return false;
  const lineageMatches = release.serviceDate === scope.serviceDate && release.sourceDayId === scope.sourceDayId && release.sourcePublicationId === scope.sourcePublicationId && release.sourcePublicationDayId === scope.sourcePublicationDayId && release.sourceVersion === scope.sourceVersion && release.sourceContentHash === scope.sourceContentHash;
  return lineageMatches && release.signatures.every(signature => signature.valid && signatureMatchesScope(signature, scope));
}

export function signedAllergenCheckpointMatchesOrder(plan: Pick<ProductionPlan, "signedMenuContentHash" | "signedSignatures" | "currentAllergenRelease">, order: { canonicalId: string; serviceDate?: string; requiredBy: string; sourceEntityId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string }, menuItems: PlannedMenuItem[]) {
  const hash = allergenMatrixContentHash(menuItems);
  const scope = matrixSignatureScope(order, hash);
  return plan.signedMenuContentHash === hash && Boolean(scope && plan.signedSignatures?.length && plan.signedSignatures.every(signature => signatureMatchesScope(signature, scope)) && currentAllergenReleaseMatchesOrder(plan.currentAllergenRelease, order, menuItems));
}

/** True when any in-progress or committed allergen authority still belongs to this exact source/matrix. */
export function allergenAuthorityMatchesOrder(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "signedMenuContentHash" | "currentAllergenRelease" | "matrixArtifact" | "signedMatrixArtifact" | "masterMatrixArtifact" | "siteMatrixArtifacts">, order: { canonicalId: string; serviceDate?: string; requiredBy: string; sourceEntityId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string }, menuItems: PlannedMenuItem[]) {
  const hash = allergenMatrixContentHash(menuItems);
  const scope = matrixSignatureScope(order, hash);
  const signatures = plan.signatures?.length ? plan.signatures : plan.signedSignatures || [];
  const hasAuthority = Boolean(plan.currentAllergenRelease || signatures.length || plan.signedMenuContentHash || plan.matrixArtifact || plan.signedMatrixArtifact || plan.masterMatrixArtifact || plan.siteMatrixArtifacts);
  if (!hasAuthority) return true;
  if (!scope || plan.signedMenuContentHash !== hash || !signatures.length || !signatures.every(signature => signatureMatchesScope(signature, scope))) return false;
  const release = plan.currentAllergenRelease;
  if (!release) return true;
  return (release.status === "pending" || release.status === "current")
    && release.serviceDate === scope.serviceDate
    && release.sourceDayId === scope.sourceDayId
    && release.sourcePublicationId === scope.sourcePublicationId
    && release.sourcePublicationDayId === scope.sourcePublicationDayId
    && release.sourceVersion === scope.sourceVersion
    && release.sourceContentHash === scope.sourceContentHash
    && release.signatures.every(signature => signature.valid && signatureMatchesScope(signature, scope));
}
