import type { OperationalAllergenState } from "../../../shared/allergen-contract";
import { allergenMatrixContentHash } from "../../lib/cpu-allergen-release";
import { isProductionPlanMatrixComplete } from "./production-plan-state";
import { createHash } from "node:crypto";
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
  sourceOrigin?: "menu_planning" | "hospitality_booking";
  sourceDayId?: string;
  sourcePublicationId?: string;
  sourcePublicationDayId?: string;
  sourceBookingId?: string;
  sourceQuoteRevisionId?: string;
  sourceRevision?: number;
  sourceVersion: number;
  sourceContentHash: string;
  matrixContentHash: string;
};
export type InternalMatrixSignature = { role: "production_chef" | "head_chef_site_manager"; printedName: string; signedAt: string; actor: string; attestation: string; signatureDataUrl?: string; scope?: MatrixSignatureScope };
export type MatrixArtifact = { id: string; bookingId: string; fileName: string; createdAt: string; createdBy: string; contentHash: string; html?: string; pdfPath?: string; localUrl?: string; pdfStatus: "generated" | "unavailable"; driveFileId?: string; driveUrl?: string; driveStatus: "saved" | "not_configured" | "failed"; bundleId?: string; packetContentHash?: string; packetObjectName?: string; sourceRevision?: number; sourceContentHash?: string };
export type CpuAllergenRelease = import("../../lib/cpu-allergen-release").CpuAllergenRelease;
/** A production menu item may contain several separately checked sub-items. */
export type ProductionPlan = { id: string; orderId: string; status: PlanStatus; acceptedBy?: string; acceptedAt?: string; rejectionReason?: string; clarificationNote?: string; menuItems: PlannedMenuItem[]; planningNotes: string; masterReviewId?: string; signatures?: InternalMatrixSignature[]; matrixArtifact?: MatrixArtifact; masterMatrixArtifact?: MatrixArtifact; siteMatrixArtifacts?: Record<string, MatrixArtifact>; signedMenuContentHash?: string; signedSignatures?: InternalMatrixSignature[]; signedMatrixArtifact?: MatrixArtifact; currentAllergenRelease?: CpuAllergenRelease; allergenReleaseHistory?: CpuAllergenRelease[]; updatedAt: string; updatedBy: string; audit: Array<{ action: string; at: string; by: string; reason?: string }> };

export { effectiveProductionPlanStatus, hasAllergenAuthority, isProductionPlanMatrixComplete, mergeMissingProductionOrderLines } from "./production-plan-state";

export type SigningLineageOrder = { canonicalId: string; serviceDate?: string; requiredBy: string; origin?: string; version?: number; currentRevision?: number; sourceEntityId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string; sourceBookingId?: string; sourceQuoteRevisionId?: string };

const sourceHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Resolve the exact source identity bound to CPU allergen signatures.
 * Menu Planning retains its historical publication-day shape. Hospitality
 * has no Menu publication, so its Booking/Quote source identity is explicit.
 */
export function signingLineageForOrder(order: SigningLineageOrder, matrixContentHash: string): MatrixSignatureScope | undefined {
  const serviceDate = order.serviceDate || order.requiredBy?.slice(0, 10);
  if (!serviceDate) return undefined;
  if (order.origin === "hospitality_booking") {
    const sourceRevision = order.currentRevision || order.sourceVersion || order.version;
    if (!order.sourceBookingId || !order.sourceQuoteRevisionId || !sourceRevision) return undefined;
    const canonicalSource = {
      origin: "hospitality_booking",
      productionOrderId: order.canonicalId,
      serviceDate,
      sourceBookingId: order.sourceBookingId,
      sourceQuoteRevisionId: order.sourceQuoteRevisionId,
      sourceRevision,
      orderVersion: order.version || 0,
      ...(order.sourceContentHash ? { existingSourceContentHash: order.sourceContentHash } : {}),
    };
    const sourceContentHash = order.sourceContentHash && /^[a-f0-9]{64}$/i.test(order.sourceContentHash)
      ? order.sourceContentHash
      : sourceHash(canonicalSource);
    return { productionOrderId: order.canonicalId, serviceDate, sourceOrigin: "hospitality_booking", sourceBookingId: order.sourceBookingId, sourceQuoteRevisionId: order.sourceQuoteRevisionId, sourceRevision, sourceVersion: sourceRevision, sourceContentHash, matrixContentHash };
  }
  if (!order.sourceEntityId || !order.sourcePublicationDayId || !order.sourceVersion || !order.sourceContentHash) return undefined;
  return { productionOrderId: order.canonicalId, serviceDate, sourceDayId: order.sourceEntityId, ...(order.sourcePublicationId ? { sourcePublicationId: order.sourcePublicationId } : {}), sourcePublicationDayId: order.sourcePublicationDayId, sourceVersion: order.sourceVersion, sourceContentHash: order.sourceContentHash, matrixContentHash };
}

/** Backwards-compatible name used by CPU materialisation/review consumers. */
export const matrixSignatureScope = signingLineageForOrder;

export function sameMatrixSignatureScope(left: MatrixSignatureScope | undefined, right: Partial<MatrixSignatureScope> | undefined, includeMatrix = true) {
  return Boolean(left && right
    && left.productionOrderId === right.productionOrderId
    && left.serviceDate === right.serviceDate
    && left.sourceOrigin === right.sourceOrigin
    && left.sourceDayId === right.sourceDayId
    && left.sourcePublicationId === right.sourcePublicationId
    && left.sourcePublicationDayId === right.sourcePublicationDayId
    && left.sourceBookingId === right.sourceBookingId
    && left.sourceQuoteRevisionId === right.sourceQuoteRevisionId
    && left.sourceRevision === right.sourceRevision
    && left.sourceVersion === right.sourceVersion
    && left.sourceContentHash === right.sourceContentHash
    && (!includeMatrix || left.matrixContentHash === right.matrixContentHash));
}

export function signatureMatchesScope(signature: InternalMatrixSignature, scope: MatrixSignatureScope | undefined) {
  return sameMatrixSignatureScope(scope, signature.scope);
}

/** Human signatures remain authoritative while their exact release is pending materialisation. */
export function signatureAuthorityForOrder(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "currentAllergenRelease">, order: SigningLineageOrder, menuItems: PlannedMenuItem[]) {
  const scope = matrixSignatureScope(order, allergenMatrixContentHash(menuItems));
  if (!scope) return [] as InternalMatrixSignature[];
  if (plan.currentAllergenRelease && !["pending", "current"].includes(plan.currentAllergenRelease.status)) return [];
  const candidates = plan.signatures?.length ? plan.signatures : plan.signedSignatures?.length ? plan.signedSignatures : plan.currentAllergenRelease?.signatures || [];
  return candidates.filter(signature => signatureMatchesScope(signature, scope) && ("valid" in signature ? signature.valid !== false : true));
}

export function currentAllergenReleaseMatchesOrder(release: CpuAllergenRelease | undefined, order: SigningLineageOrder, menuItems: PlannedMenuItem[]) {
  const scope = matrixSignatureScope(order, allergenMatrixContentHash(menuItems));
  if (!release || release.status !== "current" || release.materializationStatus !== "ready" || !scope) return false;
  const roles = new Set(release.signatures.map(signature => signature.role));
  if (!roles.has("production_chef") || !roles.has("head_chef_site_manager")) return false;
  const lineageMatches = sameMatrixSignatureScope(scope, { ...release, productionOrderId: scope.productionOrderId, matrixContentHash: scope.matrixContentHash }, false);
  return lineageMatches && release.signatures.every(signature => signature.valid && signatureMatchesScope(signature, scope));
}

/** Validate release source identity before a pending release is materialized. */
export function allergenReleaseLineageMatchesOrder(release: CpuAllergenRelease | undefined, order: SigningLineageOrder, menuItems: PlannedMenuItem[]) {
  const scope = matrixSignatureScope(order, allergenMatrixContentHash(menuItems));
  if (!release || !scope) return false;
  return sameMatrixSignatureScope(scope, { ...release, productionOrderId: scope.productionOrderId, matrixContentHash: scope.matrixContentHash }, false);
}

export function signedAllergenCheckpointMatchesOrder(plan: Pick<ProductionPlan, "signedMenuContentHash" | "signedSignatures" | "currentAllergenRelease">, order: SigningLineageOrder, menuItems: PlannedMenuItem[]) {
  const hash = allergenMatrixContentHash(menuItems);
  const scope = matrixSignatureScope(order, hash);
  return plan.signedMenuContentHash === hash && Boolean(scope && plan.signedSignatures?.length && plan.signedSignatures.every(signature => signatureMatchesScope(signature, scope)) && currentAllergenReleaseMatchesOrder(plan.currentAllergenRelease, order, menuItems));
}

/** True when the current exact Menu matrix has both CPU signatures, regardless of release materialisation state. */
export function signedAllergenReviewMatchesOrder(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "signedMenuContentHash" | "currentAllergenRelease">, order: SigningLineageOrder, menuItems: PlannedMenuItem[]) {
  if (!isProductionPlanMatrixComplete(menuItems)) return false;
  const hash = allergenMatrixContentHash(menuItems);
  const scope = matrixSignatureScope(order, hash);
  if (!scope || plan.signedMenuContentHash !== hash || (plan.currentAllergenRelease && !["pending", "current"].includes(plan.currentAllergenRelease.status))) return false;
  const signatures = plan.signedSignatures?.length ? plan.signedSignatures : plan.signatures || [];
  const roles = new Set(signatures.map(signature => signature.role));
  return roles.has("production_chef") && roles.has("head_chef_site_manager") && signatures.every(signature => ("valid" in signature ? signature.valid !== false : true) && signatureMatchesScope(signature, scope));
}

/** True when any in-progress or committed allergen authority still belongs to this exact source/matrix. */
export function allergenAuthorityMatchesOrder(plan: Pick<ProductionPlan, "signatures" | "signedSignatures" | "signedMenuContentHash" | "currentAllergenRelease" | "matrixArtifact" | "signedMatrixArtifact" | "masterMatrixArtifact" | "siteMatrixArtifacts">, order: SigningLineageOrder, menuItems: PlannedMenuItem[]) {
  const hash = allergenMatrixContentHash(menuItems);
  const scope = matrixSignatureScope(order, hash);
  const signatures = plan.signatures?.length ? plan.signatures : plan.signedSignatures || [];
  const hasAuthority = Boolean(plan.currentAllergenRelease || signatures.length || plan.signedMenuContentHash || plan.matrixArtifact || plan.signedMatrixArtifact || plan.masterMatrixArtifact || plan.siteMatrixArtifacts);
  if (!hasAuthority) return true;
  if (!scope || plan.signedMenuContentHash !== hash || !signatures.length || !signatures.every(signature => signatureMatchesScope(signature, scope))) return false;
  const release = plan.currentAllergenRelease;
  if (!release) return true;
  return (release.status === "pending" || release.status === "current")
    && sameMatrixSignatureScope(scope, { ...release, productionOrderId: scope.productionOrderId, matrixContentHash: scope.matrixContentHash }, false)
    && release.signatures.every(signature => signature.valid && signatureMatchesScope(signature, scope));
}
