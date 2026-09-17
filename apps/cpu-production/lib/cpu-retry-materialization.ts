import { allergenMatrixContentHash } from "./cpu-allergen-release";
import { cpuReleaseMaterializationEventId } from "./cpu-release-fanout";
import { deliverCpuPropagation, replayCpuPropagation } from "./cpu-durable-outbox";
import { currentAllergenReleaseMatchesOrder, matrixSignatureScope, sameMatrixSignatureScope, signatureAuthorityForOrder, signatureMatchesScope, type MatrixSignatureScope, type ProductionPlan } from "../app/lib/production-plan";
import { matrixDriveConfiguration } from "../app/lib/matrix-drive-config";
import type { ProductionOrder } from "./production-types";

function sameLineage(left: MatrixSignatureScope | undefined, right: MatrixSignatureScope) {
  return sameMatrixSignatureScope(left, right);
}

function releaseLineageMatchesScope(release: NonNullable<ProductionPlan["currentAllergenRelease"]>, scope: MatrixSignatureScope | undefined) {
  return Boolean(scope && sameMatrixSignatureScope(scope, { ...release, productionOrderId: scope.productionOrderId, matrixContentHash: scope.matrixContentHash }, false));
}

export function releaseMaterializationDelivery(plan: ProductionPlan, release: NonNullable<ProductionPlan["currentAllergenRelease"]>, order: ProductionOrder, timestamp: string) {
  return { eventId: cpuReleaseMaterializationEventId(release.releaseId, order), sourceAggregateId: plan.id, sourceVersion: release.version, occurredAt: timestamp, consumer: "cpu-production" as const, route: "/api/internal/cpu-release-materialize", body: { orderId: order.canonicalId, releaseId: release.releaseId, serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), destinationOplocId: order.destinationOplocId || "" } };
}

export async function retryCommittedCpuMaterialization(input: {
  plan: ProductionPlan;
  order: ProductionOrder;
  expectedLineage: MatrixSignatureScope;
  timestamp: string;
}, dependencies: {
  replay: typeof replayCpuPropagation;
  deliver: typeof deliverCpuPropagation;
} = { replay: replayCpuPropagation, deliver: deliverCpuPropagation }) {
  const { plan, order, expectedLineage, timestamp } = input;
  if (order.supersededBy) throw Object.assign(new Error("This CPU Production Order has been superseded and cannot receive a materialization retry."), { status: 409, code: "CPU_ORDER_SUPERSEDED" });
  const currentScope = matrixSignatureScope(order, allergenMatrixContentHash(plan.menuItems));
  if (!sameLineage(currentScope, expectedLineage)) throw Object.assign(new Error("The reviewed source lineage has changed. Reload and review the current matrix before retrying materialization."), { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" });
  const release = plan.currentAllergenRelease;
  if (!release) throw Object.assign(new Error("There is no committed CPU allergen release to retry."), { status: 409, code: "CPU_RELEASE_NOT_FOUND" });
  if (release.status === "current" && release.materializationStatus === "ready") throw Object.assign(new Error("This CPU allergen release is already current."), { status: 409, code: "CPU_RELEASE_ALREADY_CURRENT" });
  if (release.status !== "pending" && release.status !== "current") throw Object.assign(new Error("This CPU allergen release is no longer eligible for materialization retry."), { status: 409, code: "CPU_RELEASE_NOT_RETRYABLE" });
  if (!currentScope || plan.signedMenuContentHash !== currentScope.matrixContentHash || !releaseLineageMatchesScope(release, currentScope) || !release.signatures.every(signature => signature.valid && signatureMatchesScope(signature, currentScope))) throw Object.assign(new Error("The committed CPU allergen release no longer matches the current source lineage. Reload and review the current matrix."), { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" });
  const authoritativeSignatures = signatureAuthorityForOrder(plan, order, plan.menuItems);
  const roles = new Set(authoritativeSignatures.map(signature => signature.role));
  if (!roles.has("production_chef") || !roles.has("head_chef_site_manager")) throw Object.assign(new Error("Both authoritative CPU allergen signatures are required before materialization retry."), { status: 409, code: "CPU_RELEASE_SIGNATURE_CONFLICT" });
  const delivery = releaseMaterializationDelivery(plan, release, order, timestamp);
  await dependencies.replay(delivery.eventId);
  const materializationDelivery = await dependencies.deliver(delivery.eventId);
  const matrixStatus = currentAllergenReleaseMatchesOrder(plan.currentAllergenRelease, order, plan.menuItems) ? "ready" : !matrixDriveConfiguration(order).enabled ? "not_configured" : "generating";
  return { plan, matrixArtifact: plan.matrixArtifact ?? null, signatures: plan.signatures ?? null, matrixStatus, materializationDelivery };
}
