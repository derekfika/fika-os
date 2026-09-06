import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { matrixSignatureScope, signatureMatchesScope, type ProductionPlan } from "../app/lib/production-plan";
import { allergenMatrixContentHash } from "./cpu-allergen-release";
import type { ProductionOrder } from "./production-types";
import { cpuPackageStore } from "./cpu-package-store";
import { reviewStatusForPlan } from "./delivered-in-review";
import { productionQueue } from "./production-http-client";
import { loadPlansForOrders } from "./cpu-projection-repository";
import type { NextRequest } from "next/server";

export type CpuReviewAllergenState = "clear" | "contains" | "may_contain" | "unrecorded";
export type CpuReviewEntry = {
  sourceLineId: string;
  /** Stable sub-item identity; older records may omit it. */
  sourceSubItemId?: string;
  sourceBookingLineId?: string;
  sourceMenuItemId?: string;
  dishName?: string;
  allergens: Record<string, CpuReviewAllergenState>;
  allergenState: "CLEAR" | "CONTAINS" | "MAY_CONTAIN" | "UNRECORDED";
  mayContainNotes?: string;
  evidenceStatus: string;
};
export type CpuReviewSignature = { role: "production_chef" | "head_chef_site_manager"; printedName: string; signedAt: string; actor?: string; attestation?: string; scope?: { productionOrderId: string; serviceDate: string; sourceDayId: string; sourcePublicationId?: string; sourcePublicationDayId: string; sourceVersion: number; sourceContentHash: string; matrixContentHash: string } };
export type CpuReviewOrder = {
  productionOrderId: string;
  orderVersion: number;
  orderRevision: number;
  cpuPlanId: string;
  cpuPlanRevision?: number;
  reviewStatus: "signed" | "pending" | "missing";
  requiredSignatureRoles: Array<"production_chef" | "head_chef_site_manager">;
  completedSignatureRoles: Array<"production_chef" | "head_chef_site_manager">;
  signatures: CpuReviewSignature[];
  entries: CpuReviewEntry[];
  matrixArtifact?: { id: string; driveUrl?: string; localUrl?: string; contentHash?: string };
  sourceIdentity?: { sourceDayId: string; sourcePublicationId?: string; sourcePublicationDayId: string; sourceVersion: number; sourceContentHash: string; matrixContentHash: string };
};
export type CpuReviewProjection = {
  contractVersion: "cpu-production.delivered-in-review.v1";
  schemaVersion: 1;
  serviceDate: string;
  oplocId: string;
  revision: number;
  lastChangeSequence: number;
  status: "current" | "partial" | "valid_empty";
  completeness: "complete" | "partial";
  requiredSignatureRoles: CpuReviewOrder["requiredSignatureRoles"];
  completedSignatureRoles: CpuReviewOrder["completedSignatureRoles"];
  signatures: CpuReviewSignature[];
  sourceOrders: CpuReviewOrder[];
  generatedAt: string;
  sourceLineage: Array<{ productionOrderId: string; orderVersion: number; cpuPlanId: string; planRevision?: number; sourceDayId?: string; sourcePublicationId?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string; matrixContentHash?: string }>;
};

const packageKey = (serviceDate: string, oplocId: string) => `cpu-production/review/${encodeURIComponent(oplocId)}/${serviceDate}`;
const dataset = "snapshots/cpu-production/delivered-in-review";
const requiredRoles: CpuReviewOrder["requiredSignatureRoles"] = ["production_chef", "head_chef_site_manager"];

function entryFor(order: ProductionOrder, plan: ProductionPlan | undefined, sourceLineId: string, dishName?: string, allergens: Record<string, string> = {}, evidenceStatus = "not_completed", mayContainNotes?: string, sourceSubItemId?: string): CpuReviewEntry {
  const sourceLine = order.lines.find(line => line.canonicalId === sourceLineId || line.sourceBookingLineId === sourceLineId);
  const known = Object.values(allergens).filter(value => ["clear", "contains", "may_contain"].includes(value));
  const allergenState: CpuReviewEntry["allergenState"] = evidenceStatus !== "completed" || !known.length ? "UNRECORDED" : known.some(value => value === "contains") ? "CONTAINS" : known.some(value => value === "may_contain") ? "MAY_CONTAIN" : "CLEAR";
  return { sourceLineId, ...(sourceSubItemId ? { sourceSubItemId } : {}), ...(sourceLine?.sourceBookingLineId ? { sourceBookingLineId: sourceLine.sourceBookingLineId } : {}), ...(sourceLine?.sourceMenuItemId ? { sourceMenuItemId: sourceLine.sourceMenuItemId } : {}), ...(dishName ? { dishName } : {}), allergens: allergens as Record<string, CpuReviewAllergenState>, allergenState, ...(mayContainNotes ? { mayContainNotes } : {}), evidenceStatus };
}

export function buildCpuReviewProjection(serviceDate: string, oplocId: string, orders: ProductionOrder[], plans: ProductionPlan[], revision = 1, lastChangeSequence = 0, generatedAt = new Date().toISOString()): CpuReviewProjection {
  const planByOrder = new Map(plans.map(plan => [plan.orderId, plan]));
  const sourceOrders: CpuReviewOrder[] = orders.filter(order => order.origin === "menu_planning" && order.destinationOplocId === oplocId && !order.supersededBy).map(order => {
    const plan = planByOrder.get(order.canonicalId);
    const entries = plan?.menuItems?.flatMap(item => item.sourceLineId
      ? item.subItems.map(sub => entryFor(order, plan, item.sourceLineId!, sub.name || item.name, sub.allergens, sub.evidenceStatus, sub.mayContainNotes, sub.id))
      : []) || order.lines.map(line => entryFor(order, plan, line.canonicalId, line.itemName, line.approvedAllergenSnapshot?.allergens || {}, line.allergenEvidenceStatus === "confirmed" ? "completed" : "not_completed", line.approvedAllergenSnapshot?.mayContainNotes));
    const scope = plan ? matrixSignatureScope(order, allergenMatrixContentHash(plan.menuItems)) : undefined;
    const signatures = (plan?.signatures || []).filter(signature => signatureMatchesScope(signature, scope)).map(signature => ({ role: signature.role, printedName: signature.printedName, signedAt: signature.signedAt, actor: signature.actor, attestation: signature.attestation, scope: signature.scope }));
    const completedSignatureRoles = [...new Set(signatures.map(signature => signature.role))];
    const reviewStatus: CpuReviewOrder["reviewStatus"] = plan ? completedSignatureRoles.length === requiredRoles.length ? "signed" : "pending" : "missing";
    const sourceIdentity = scope ? { sourceDayId: scope.sourceDayId, ...(scope.sourcePublicationId ? { sourcePublicationId: scope.sourcePublicationId } : {}), sourcePublicationDayId: scope.sourcePublicationDayId, sourceVersion: scope.sourceVersion, sourceContentHash: scope.sourceContentHash, matrixContentHash: scope.matrixContentHash } : undefined;
    return { productionOrderId: order.canonicalId, orderVersion: order.version, orderRevision: order.currentRevision, cpuPlanId: plan?.id || `production-plan:${order.canonicalId}`, ...(plan ? { cpuPlanRevision: plan.audit.length } : {}), reviewStatus, requiredSignatureRoles: requiredRoles, completedSignatureRoles, signatures, entries, ...(sourceIdentity ? { sourceIdentity } : {}), ...(plan?.matrixArtifact ? { matrixArtifact: { id: plan.matrixArtifact.id, driveUrl: plan.matrixArtifact.driveUrl, localUrl: plan.matrixArtifact.localUrl, contentHash: plan.matrixArtifact.contentHash } } : {}) };
  });
  const signatures = [...new Map(sourceOrders.flatMap(order => order.signatures.map(signature => [signature.role, signature]))).values()];
  const completedSignatureRoles = [...new Set(signatures.map(signature => signature.role))];
  const complete = sourceOrders.every(order => order.reviewStatus !== "missing" && order.entries.every(entry => entry.evidenceStatus === "completed"));
  return { contractVersion: "cpu-production.delivered-in-review.v1", schemaVersion: 1, serviceDate, oplocId, revision, lastChangeSequence, status: sourceOrders.length === 0 ? "valid_empty" : complete ? "current" : "partial", completeness: complete ? "complete" : "partial", requiredSignatureRoles: requiredRoles, completedSignatureRoles, signatures, sourceOrders, generatedAt, sourceLineage: sourceOrders.map(order => ({ productionOrderId: order.productionOrderId, orderVersion: order.orderVersion, orderRevision: order.orderRevision, cpuPlanId: order.cpuPlanId, ...(order.cpuPlanRevision !== undefined ? { planRevision: order.cpuPlanRevision } : {}), ...(order.sourceIdentity || {}) })) };
}

export async function publishCpuReviewPackage(projection: CpuReviewProjection): Promise<ReadPackageManifest> {
  const key = packageKey(projection.serviceDate, projection.oplocId);
  const store = cpuPackageStore();
  const previous = await store.getManifest(key);
  const previousSequence = Number(previous?.sourceVersion?.replace("cpu-change-", "") || 0);
  if (projection.lastChangeSequence > 0 && projection.lastChangeSequence < previousSequence && previous) return previous;
  const encoded = encodeReadPackage(dataset, (previous?.packageVersion || 0) + 1, { projection }, projection.sourceOrders.length, { contractVersion: projection.contractVersion, sourceVersion: `cpu-change-${projection.lastChangeSequence}`, scope: `${projection.oplocId}:${projection.serviceDate}` });
  return publishReadPackage<{ projection: CpuReviewProjection }>(store, key, encoded);
}

export async function rebuildCpuReviewPackage(request: NextRequest, serviceDate: string, oplocId: string, lastChangeSequence = 0) {
  const orders = (await productionQueue(request, serviceDate)).filter(order => order.origin === "menu_planning");
  const plans = await loadPlansForOrders(orders.map(order => order.canonicalId));
  const previous = await cpuPackageStore().getManifest(packageKey(serviceDate, oplocId));
  const sourceSequence = lastChangeSequence || Number(previous?.sourceVersion?.replace("cpu-change-", "") || 0);
  const projection = buildCpuReviewProjection(serviceDate, oplocId, orders, plans, (previous?.packageVersion || 0) + 1, sourceSequence);
  const manifest = await publishCpuReviewPackage(projection);
  recordDataAccess({ app: "cpu-production", operation: "cpu-review.source-rebuild", source: "FIRESTORE", documents: orders.length + plans.length });
  return { projection, manifest };
}

export async function getCpuReviewPackage(serviceDate: string, oplocId: string) {
  const retrieved = await retrieveReadPackage<{ projection: CpuReviewProjection }>(cpuPackageStore(), packageKey(serviceDate, oplocId));
  if (!retrieved) return undefined;
  recordDataAccess({ app: "cpu-production", operation: "cpu-review.package", source: "SNAPSHOT", documents: retrieved.manifest.recordCount, cacheHit: false });
  return retrieved;
}

export function recordCpuReviewFallback(reason: string) { recordDataAccess({ app: "cpu-production", operation: `cpu-review.package-fallback.${reason}`, source: "UNKNOWN", documents: 0 }); }
