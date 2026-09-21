import { after, NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../lib/api";
import { z } from "zod";
import { existsSync, promises as fs } from "node:fs";
import { localFixtureOrders, updateLocalFixture } from "../local-fixtures";
import { allergenAuthorityMatchesOrder, currentAllergenReleaseMatchesOrder, effectiveProductionPlanStatus, hasAllergenAuthority, isProductionPlanMatrixComplete, matrixSignatureScope, mergeMissingProductionOrderLines, sameMatrixSignatureScope, signatureMatchesScope, signedAllergenCheckpointMatchesOrder, signedAllergenReviewMatchesOrder, type AllergenCellState, type InternalMatrixSignature, type MatrixArtifact, type PlannedMenuItem, type ProductionPlan } from "../../lib/production-plan";
import { normaliseOperationalAllergens } from "../../../../shared/allergen-contract";
import { canonicalProductionFailureKind, productionOrderDetail, productionQueue, transitionProductionOrder, type CanonicalProductionFailure } from "../../../lib/production-http-client";
import type { ProductionOrder, ProductionStatus } from "../../../lib/production-types";
import { rebuildCpuDayProjection, rebuildCpuWeekProjection, weekCommencingFor } from "../../../lib/cpu-projection";
import { createProductionPlanRepository } from "../../../lib/production-plan-repository";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { hubJson } from "../../../lib/production-http-client";
import { matrixDriveConfiguration } from "../../lib/matrix-drive-config";
import { loadDeliveredInReviewStatuses, parseDeliveredInReviewOrderIds } from "../../../lib/delivered-in-review";
import { recordDeliveredInReadBudget } from "../../../lib/delivered-in-read-budget";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { rebuildCpuReviewPackage } from "../../../lib/cpu-review-package";
import { buildCpuAllergenReleaseEvent, eventTypeForConsumers, notifyCpuConsumerInvalidations, notifyDeliveredInAllergenRelease } from "../../../lib/cpu-consumer-invalidation";
import { deliverCpuPropagation, replayCpuPropagation, type CpuDurableDeliveryInput } from "../../../lib/cpu-durable-outbox";
import { allergenMatrixContentHash, buildCpuAllergenRelease, revokeCpuAllergenRelease } from "../../../lib/cpu-allergen-release";
import { releaseMaterializationDelivery, retryCommittedCpuMaterialization } from "../../../lib/cpu-retry-materialization";
import { cpuMasterReviewId } from "../../../lib/cpu-master-review";
import { ExpectedLineage, MasterReviewOperation, MasterSignCommand, MenuItem, SubItem } from "../../../lib/production-plan-command-schema";
import { allergenMatrixHtml } from "../../ui/allergen-matrix";

function menuContentHash(menuItems: PlannedMenuItem[]) {
  return allergenMatrixContentHash(menuItems);
}

export const dynamic = "force-dynamic";

const actorFor = (request: NextRequest) => requireCpuActor(request);

async function syncCanonicalLifecycle(
  request: NextRequest,
  orderId: string,
  target: "accepted" | "planned" | "rejected" | "needs_clarification",
  reason: string,
) {
  if (orderId.startsWith("production-order:v1:fixture:")) return undefined;
  let order = await productionOrderDetail(request, orderId);
  if (!order) return undefined;
  const step = async (status: ProductionStatus) => {
    order = (await transitionProductionOrder(request, { action: "transition", canonicalId: orderId, expectedVersion: order!.version, status, reason })).order;
  };
  if (target === "accepted" && order.status === "draft") {
    await step("needs_review");
  }
  if (target === "planned") {
    // A local CPU plan can be completed directly from a newly created
    // hospitality hand-off. Keep the governed production lifecycle in sync by
    // walking the same explicit transitions a chef would use.
    if (order.status === "draft") await step("needs_review");
    if (order.status === "needs_review") await step("accepted");
    if (order.status === "accepted") await step("planning");
  }
  if (order.status !== target) {
    const allowed =
      target === "planned" && order.status === "planning"
        ? true
        : target === "accepted" && order.status === "needs_review"
          ? true
          : ["rejected", "needs_clarification"].includes(target) &&
              order.status === "needs_review";
    if (allowed) await step(target);
  }
  return order;
}

const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), orderId: z.string(), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("reject"), orderId: z.string(), reason: z.string().trim().min(3), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("clarify"), orderId: z.string(), note: z.string().trim().min(3), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("save-plan"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default(""), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("mark-planned"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default(""), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("sign-matrix"), orderId: z.string(), role: z.enum(["production_chef", "head_chef_site_manager"]), printedName: z.string().trim().min(2).max(120), attestation: z.string().trim().min(10).max(500), signatureDataUrl: z.string().regex(/^data:image\/png;base64,/).max(500000), expectedLineage: ExpectedLineage, commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("save-matrix"), orderId: z.string(), expectedLineage: ExpectedLineage.optional(), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("retry-materialization"), orderId: z.string(), expectedLineage: ExpectedLineage }),
]);
const MatrixOperation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-plan"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default(""), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("mark-planned"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default(""), commandId: z.string().trim().min(8).optional() }),
  z.object({ action: z.literal("reopen-review"), orderId: z.string(), commandId: z.string().trim().min(8).optional() }),
]);
const MatrixBatchCommand = z.object({ action: z.literal("batch-plan"), operations: z.array(MatrixOperation).min(1).max(100) }).strict();

const plans = new Map<string, ProductionPlan>();
const planRepository = createProductionPlanRepository();
const isLocalRuntime = () => (process.env.FIKA_RUNTIME_MODE || "local") === "local";
function normalisePlanAllergens(plan: ProductionPlan): ProductionPlan {
  return { ...plan, menuItems: plan.menuItems.map(item => ({ ...item, subItems: item.subItems.map(sub => ({ ...sub, allergens: normaliseOperationalAllergens(sub.allergens) })) })) };
}
function assertAllergenMatrixComplete(menuItems: PlannedMenuItem[], context: string) {
  if (!isProductionPlanMatrixComplete(menuItems)) throw Object.assign(new Error(`Record every allergen state, including No key allergens, before ${context}.`), { status: 422, code: "CPU_ALLERGEN_REVIEW_INCOMPLETE" });
}
async function persistPlan(plan: ProductionPlan, expectedUpdatedAt?: string) { await planRepository.save(plan, expectedUpdatedAt); }
function now() { return new Date().toISOString(); }
function sameLineage(left: ReturnType<typeof matrixSignatureScope>, right: ReturnType<typeof matrixSignatureScope>) {
  return sameMatrixSignatureScope(left, right);
}
function samePublishedLineage(left: ReturnType<typeof matrixSignatureScope>, right: ReturnType<typeof matrixSignatureScope>) {
  return sameMatrixSignatureScope(left, right, false);
}
function hasExactSignature(plan: ProductionPlan, role: InternalMatrixSignature["role"], scope: ReturnType<typeof matrixSignatureScope>) {
  return Boolean(scope && plan.signatures?.some(signature => signature.role === role && signatureMatchesScope(signature, scope)));
}
function pendingReleaseArtifact(plan: ProductionPlan, order: ProductionOrder, timestamp: string): MatrixArtifact {
  const contentHash = menuContentHash(plan.menuItems);
  return { id: `pending-cpu-allergen:${order.canonicalId}:${contentHash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName: `PREPARED-${order.canonicalId}.pdf`, createdAt: timestamp, createdBy: plan.updatedBy, contentHash, pdfStatus: "unavailable", driveStatus: "not_configured" };
}
function pendingReleaseFor(plan: ProductionPlan, order: ProductionOrder, timestamp: string) {
  const source = matrixSignatureScope(order, menuContentHash(plan.menuItems));
  if (!source) throw Object.assign(new Error("The current source lineage is unavailable; the matrix cannot be signed."), { status: 503 });
  const previous = [...(plan.allergenReleaseHistory || [])].at(-1);
  return buildCpuAllergenRelease({ serviceDate: source.serviceDate, sourceOrigin: source.sourceOrigin, sourceDayId: source.sourceDayId, sourcePublicationId: source.sourcePublicationId, sourcePublicationDayId: source.sourcePublicationDayId, sourceBookingId: source.sourceBookingId, sourceQuoteRevisionId: source.sourceQuoteRevisionId, sourceRevision: source.sourceRevision, sourceVersion: source.sourceVersion, sourceContentHash: source.sourceContentHash, version: Math.max(1, ...((plan.allergenReleaseHistory || []).map(item => item.version + 1))), signedAt: timestamp, signatures: plan.signatures || [], items: plan.menuItems, masterArtifact: pendingReleaseArtifact(plan, order, timestamp), derivedArtifacts: [], packetArtifacts: [], previous, status: "pending" });
}
// Artifact creation is intentionally no longer part of the sign command:
// release materialization runs from the committed outbox obligation after
// authoritative CPU state has accepted the signature.
function invalidateSignedAllergenAuthorityForNewSourceLineage(plan: ProductionPlan, actor: string, at: string, reason: string) {
  const current = plan.currentAllergenRelease;
  const hasAuthority = Boolean(current || plan.signatures?.length || plan.signedSignatures?.length || plan.signedMenuContentHash || plan.matrixArtifact || plan.signedMatrixArtifact || plan.masterMatrixArtifact || plan.siteMatrixArtifacts);
  if (current) {
    const historical = current.status === "current" ? revokeCpuAllergenRelease(current, { at, by: actor, reason }) : current;
    if (!(plan.allergenReleaseHistory || []).some(release => release.releaseId === historical.releaseId)) plan.allergenReleaseHistory = [...(plan.allergenReleaseHistory || []), historical];
  }
  plan.currentAllergenRelease = undefined;
  plan.signatures = undefined;
  plan.signedMenuContentHash = undefined;
  plan.signedSignatures = undefined;
  plan.signedMatrixArtifact = undefined;
  plan.matrixArtifact = undefined;
  plan.masterMatrixArtifact = undefined;
  plan.siteMatrixArtifacts = undefined;
  if (hasAuthority) plan.audit.push({ action: "allergen-release-revoked", at, by: actor, reason });
  return hasAuthority;
}
function revokedReleaseDeliveries(release: ProductionPlan["currentAllergenRelease"], order: ProductionOrder | undefined): CpuDurableDeliveryInput[] {
  if (!release?.packetArtifacts?.[0]?.contentHash || !order?.destinationOplocId) return [];
  const releaseEvent = buildCpuAllergenReleaseEvent({ eventType: "revoked", release, oplocId: order.destinationOplocId });
  return [{ eventId: `${releaseEvent.eventId}:delivered-in:${order.destinationOplocId}`, sourceAggregateId: releaseEvent.releaseId, sourceVersion: releaseEvent.sourceVersion, occurredAt: release.signedAt, consumer: "delivered-in", route: "/api/internal/cpu-release-event", body: releaseEvent as unknown as Record<string, unknown> }];
}
async function loadOrder(request: NextRequest, orderId: string) {
  try {
    const order = await productionOrderDetail(request, orderId);
    return order || (isLocalRuntime() ? localFixtureOrders().find(item => item.canonicalId === orderId) : undefined);
  } catch (cause) {
    if (isLocalRuntime()) return localFixtureOrders().find(item => item.canonicalId === orderId);
    const failure = cause as CanonicalProductionFailure;
    const kind = canonicalProductionFailureKind(failure);
    if (kind === "not_found") throw Object.assign(new Error("The canonical Production Order is no longer current."), { status: 409, code: "CPU_CANONICAL_ORDER_NOT_FOUND", cause });
    if (kind === "authority_failure") throw Object.assign(new Error("Canonical Production authorisation failed."), { status: 503, code: "CPU_CANONICAL_AUTHORITY_FAILURE", cause });
    if (kind === "malformed_response" || kind === "invalid_response") throw Object.assign(new Error("Canonical Production returned an invalid response."), { status: 502, code: "CPU_CANONICAL_RESPONSE_INVALID", cause });
    throw Object.assign(new Error("Canonical Production data is unavailable."), { status: 503, code: "CPU_CANONICAL_UPSTREAM_UNAVAILABLE", cause });
  }
}
async function isVisibleForCpu(request: NextRequest, orderId: string) {
  const order = await loadOrder(request, orderId);
  return !(order?.origin === "hospitality_booking" && order.requiresDelivery === false);
}
function initialPlan(orderId: string, order?: Awaited<ReturnType<typeof productionOrderDetail>> | ProductionOrder): ProductionPlan {
  const timestamp = now();
  return { id: `production-plan:${orderId}`, orderId, status: "draft", menuItems: (order?.lines || []).map((line, index) => ({ id: `menu-item:${orderId}:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${orderId}:${index + 1}:1`, name: "", quantity: line.customerQuantity, allergens: {}, note: "", evidenceStatus: "not_completed" }] })), planningNotes: "", updatedAt: timestamp, updatedBy: "local-fixture", audit: [{ action: "plan-created", at: timestamp, by: "local-fixture" }] };
}
async function getPlan(request: NextRequest, orderId: string, knownPlan?: ProductionPlan) {
  if (knownPlan) { const normalized = normalisePlanAllergens(knownPlan); plans.set(orderId, { ...normalized, status: effectiveProductionPlanStatus(normalized) }); }
  if (!plans.has(orderId)) {
    const persisted = await planRepository.get(orderId);
    if (persisted) { const normalized = normalisePlanAllergens(persisted); plans.set(orderId, { ...normalized, status: effectiveProductionPlanStatus(normalized) }); }
  }
  if (!plans.has(orderId)) {
    // Canonical hand-offs are the source of truth. Local fixtures remain a
    // development fallback, but must never be the only seed for a real order.
    const order = await loadOrder(request, orderId);
    const priorPlans = (await Promise.all([...plans.values()].filter(plan => plan.orderId !== orderId).map(async plan => ({ plan, order: await loadOrder(request, plan.orderId) })))).filter(item => item.order?.sourceBookingId && item.order.sourceBookingId === order?.sourceBookingId).sort((a, b) => b.plan.updatedAt.localeCompare(a.plan.updatedAt));
    const prior = priorPlans[0]?.plan;
    if (prior && order) {
      const menuItems = prior.menuItems.map((item, index) => {
        const line = order.lines[index];
        return line ? { ...item, sourceLineId: line.canonicalId, subItems: item.subItems.map(sub => ({ ...sub, quantity: line.customerQuantity })) } : item;
      });
      const carried: ProductionPlan = { ...prior, id: `production-plan:${orderId}`, orderId, status: "draft", menuItems, updatedAt: now(), updatedBy: "system", audit: [...prior.audit] };
      invalidateSignedAllergenAuthorityForNewSourceLineage(carried, "system", now(), "The Booking was amended; prior signed allergen authority cannot transfer to the replacement source lineage.");
      carried.audit.push({ action: "plan-carried-to-amended-order", at: now(), by: "system", reason: "The Booking was amended; prior allergen work was retained as a draft for the replacement CPU order." });
      plans.set(orderId, carried);
    } else {
      plans.set(orderId, initialPlan(orderId, order));
    }
  }
  return plans.get(orderId)!;
}

async function applyMasterSignatureBatch(request: NextRequest, actor: Awaited<ReturnType<typeof actorFor>>, command: z.infer<typeof MasterSignCommand>) {
  // CPU master signatures are the authority for this review. Menu Planning's
  // allergenSignoff remains its own source field and is deliberately not used
  // to satisfy the CPU signing contract.
  const startedAt = Date.now();
  const auditActor = actor.name || actor.uid;
  const sourceOrders = (await productionQueue(request, command.serviceDate)).filter(order => order.origin === "menu_planning" && !order.supersededBy && (order.serviceDate || order.requiredBy.slice(0, 10)) === command.serviceDate);
  const orderIds = [...new Set(command.orderIds)];
  const expectedByOrderId = new Map(command.expectedLineages.map(lineage => [lineage.productionOrderId, lineage]));
  const reviewByOrderId = new Map(command.reviewOperations.map(operation => [operation.orderId, operation]));
  if (orderIds.length !== command.orderIds.length || expectedByOrderId.size !== command.expectedLineages.length || reviewByOrderId.size !== command.reviewOperations.length || orderIds.length !== sourceOrders.length || sourceOrders.some(order => !orderIds.includes(order.canonicalId)) || orderIds.some(orderId => !sourceOrders.some(order => order.canonicalId === orderId)) || orderIds.some(orderId => !expectedByOrderId.has(orderId) || !reviewByOrderId.has(orderId))) {
    throw Object.assign(new Error("The master matrix membership or expected lineage is no longer current. Reload the complete service-date matrix before signing."), { status: 409, code: "CPU_MASTER_SIGN_MEMBERSHIP_CONFLICT" });
  }
  const timestamp = now();
  const prepared = [] as Array<{ order: ProductionOrder; storedPlan?: ProductionPlan; plan: ProductionPlan; expectedUpdatedAt?: string; alreadyApplied: boolean; scope: ReturnType<typeof matrixSignatureScope> }>;
  for (const order of sourceOrders.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))) {
    const storedPlan = await planRepository.get(order.canonicalId);
    if (!storedPlan && !isLocalRuntime()) plans.delete(order.canonicalId);
    const plan = await getPlan(request, order.canonicalId, storedPlan);
    const reviewOperation = reviewByOrderId.get(order.canonicalId)!;
    const expectedLineage = expectedByOrderId.get(order.canonicalId)!;
    if (plan.status !== "planned" && plan.status !== "planning") throw Object.assign(new Error(`The allergen matrix for ${order.destinationLabel || order.canonicalId} is not available for signing.`), { status: 422 });
    const reviewedPlan = await mergeOriginalItems(request, { ...plan, menuItems: normalisePlanAllergens({ ...plan, menuItems: reviewOperation.menuItems }).menuItems }, order.canonicalId, order);
    if (hasAllergenAuthority(plan) && !allergenAuthorityMatchesOrder(plan, order, reviewedPlan.menuItems)) throw Object.assign(new Error("Reopen the allergen review before changing a signed matrix."), { status: 409, code: "CPU_REVIEW_REOPEN_REQUIRED" });
    const currentMenuContentHash = menuContentHash(plan.menuItems);
    const reviewedMenuContentHash = menuContentHash(reviewedPlan.menuItems);
    const currentScope = matrixSignatureScope(order, reviewedMenuContentHash);
    const persistedScope = matrixSignatureScope(order, currentMenuContentHash);
    if (!currentScope || !samePublishedLineage(currentScope, expectedLineage) || (plan.menuItems.length > 0 && currentMenuContentHash !== expectedLineage.matrixContentHash && currentMenuContentHash !== reviewedMenuContentHash)) throw Object.assign(new Error("The reviewed source lineage or matrix content has changed. Reload and review the current matrix before signing."), { status: 409, code: "CPU_SIGN_LINEAGE_CONFLICT" });
    const subItems = reviewedPlan.menuItems.flatMap(item => item.subItems);
    if (!subItems.length || reviewedPlan.menuItems.some(item => !item.name.trim() || !item.subItems.length) || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error(`Complete every named sub-item and allergen checker before signing ${order.destinationLabel || order.canonicalId}.`), { status: 422 });
    assertAllergenMatrixComplete(reviewedPlan.menuItems, `signing ${order.destinationLabel || order.canonicalId}`);
    const signatures = (plan.signatures || []).filter(signature => signatureMatchesScope(signature, persistedScope) || signatureMatchesScope(signature, currentScope));
    const alreadyApplied = signatures.some(signature => signature.role === command.role);
    if (!alreadyApplied && signatures.length > 0 && plan.signedMenuContentHash && plan.signedMenuContentHash !== reviewedMenuContentHash) throw Object.assign(new Error("The allergen matrix changed after the first signature. Re-review the matrix before signing again."), { status: 409, code: "CPU_SIGN_LINEAGE_CONFLICT" });
    const candidate = structuredClone(reviewedPlan);
    candidate.status = "planned";
    candidate.planningNotes = reviewOperation.planningNotes;
    candidate.audit.push({ action: "plan-marked-planned", at: timestamp, by: auditActor, reason: "The complete reviewed matrix was committed with the master signature." });
    candidate.signatures = signatures;
    if (!alreadyApplied) {
      const signature: InternalMatrixSignature = { role: command.role, printedName: command.printedName, signedAt: timestamp, actor: auditActor, attestation: command.attestation, signatureDataUrl: command.signatureDataUrl, scope: currentScope };
      candidate.signatures = [...signatures, signature];
      if (!signatures.length) candidate.signedMenuContentHash = reviewedMenuContentHash;
      candidate.audit.push({ action: "allergen-matrix-signed", at: timestamp, by: auditActor, reason: `${command.role}: ${command.attestation}` });
      const fullySigned = candidate.signatures.some(item => item.role === "production_chef") && candidate.signatures.some(item => item.role === "head_chef_site_manager");
      if (fullySigned) {
        candidate.audit.push({ action: "allergen-matrix-signature-complete", at: timestamp, by: auditActor, reason: "Both signatures recorded; authoritative CPU release commit will precede materialization." });
        candidate.signedMenuContentHash = reviewedMenuContentHash;
        candidate.signedSignatures = candidate.signatures;
        candidate.currentAllergenRelease = pendingReleaseFor(candidate, order, timestamp);
      }
      candidate.updatedAt = timestamp;
      candidate.updatedBy = auditActor;
    }
    prepared.push({ order, storedPlan, plan: candidate, expectedUpdatedAt: storedPlan?.updatedAt, alreadyApplied, scope: currentScope });
  }

  const masterReviewId = cpuMasterReviewId({
    serviceDate: command.serviceDate,
    members: prepared.map(item => ({
      orderId: item.order.canonicalId,
      sourceDayId: item.scope?.sourceDayId,
      sourcePublicationId: item.scope?.sourcePublicationId,
      sourcePublicationDayId: item.scope?.sourcePublicationDayId,
      sourceVersion: item.scope?.sourceVersion,
      sourceContentHash: item.scope?.sourceContentHash,
      matrixContentHash: item.scope?.matrixContentHash,
    })),
  });
  for (const item of prepared) item.plan.masterReviewId = masterReviewId;

  const results: Array<{ orderId: string; ok: boolean; alreadyApplied?: boolean; planStatus?: ProductionPlan["status"]; error?: string }> = [];
  const committed: Array<{ sequence: number }> = [];
  for (const item of prepared) {
    if (item.alreadyApplied) {
      results.push({ orderId: item.order.canonicalId, ok: true, alreadyApplied: true, planStatus: item.plan.status });
      continue;
    }
    try {
      const release = item.plan.currentAllergenRelease;
      const materializationDelivery = release && ["pending", "current"].includes(release.status) && release.materializationStatus !== "ready" ? releaseMaterializationDelivery(item.plan, release, item.order, timestamp) : undefined;
      const postCommitDelivery = { eventId: `cpu-post-commit:${command.commandId}`, sourceAggregateId: `cpu-master-sign:${command.commandId}`, sourceVersion: item.plan.audit.length, occurredAt: timestamp, consumer: "cpu-production" as const, route: "/api/internal/cpu-post-commit", body: { action: "master-sign", commandId: command.commandId, serviceDate: command.serviceDate, orderIds } };
      const event = await planRepository.saveAndAppendCpuChange(item.plan, item.expectedUpdatedAt, {
        serviceDate: command.serviceDate,
        entityType: "productionPlan",
        entityId: item.plan.id,
        revision: item.plan.audit.length,
        changeType: "sign-master-matrix",
        actorId: actor.uid,
        changedAt: timestamp,
        idempotencyKey: `${command.commandId}:${item.order.canonicalId}`,
        propagation: { eventId: `cpu-master-sign:${command.commandId}:${item.order.canonicalId}`, sourceEntityId: item.plan.id, serviceDate: command.serviceDate, sourceVersion: item.plan.audit.length, changedAt: timestamp, changeType: "amended", order: item.order, logistics: false },
        deliveries: [postCommitDelivery, ...(materializationDelivery ? [materializationDelivery] : [])],
      });
      const committedPlan = event.plan || item.plan;
      if (event.duplicate) {
        const currentScope = matrixSignatureScope(item.order, menuContentHash(committedPlan.menuItems));
        if (!hasExactSignature(committedPlan, command.role, currentScope)) throw Object.assign(new Error("This signing attempt was already used, but the requested exact-lineage signature is not authoritative."), { status: 409, code: "CPU_SIGN_IDEMPOTENCY_CONFLICT" });
      } else {
        committed.push({ sequence: event.sequence });
      }
      results.push({ orderId: item.order.canonicalId, ok: true, planStatus: committedPlan.status });
    } catch (error) {
      results.push({ orderId: item.order.canonicalId, ok: false, error: error instanceof Error ? error.message : "The master matrix signature could not be committed." });
    }
  }

  const successfulOrderIds = new Set(results.filter(result => result.ok).map(result => result.orderId));
  const fullySigned = prepared.length > 0 && prepared.every(item => successfulOrderIds.has(item.order.canonicalId) && item.plan.signatures?.some(signature => signature.role === "production_chef") && item.plan.signatures?.some(signature => signature.role === "head_chef_site_manager"));
  const postCommitEventId = `cpu-post-commit:${command.commandId}`;
  after(async () => {
    try {
      const result = await deliverCpuPropagation(postCommitEventId);
      console.info("FIKA CPU master-sign post-commit dispatch", { commandId: command.commandId, serviceDate: command.serviceDate, status: result.status, attempts: result.attempts || 0, fullySigned });
    } catch (error) {
      console.error("FIKA CPU master-sign post-commit dispatch failed", { commandId: command.commandId, serviceDate: command.serviceDate, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const metrics = { signingRequests: 1, planWrites: committed.length, projectionRebuilds: 0, reviewPackageRebuilds: 0, consumerInvalidations: 0, materializationDispatches: 0, materializationOnCriticalPath: false, postCommitJobStaged: true, elapsedMs: Date.now() - startedAt };
  recordDeliveredInReadBudget({ stage: "master_matrix_signature", canonicalOrderDocs: sourceOrders.length, planDocs: prepared.length, selectedIds: orderIds.length });
  return { signingStatus: "committed" as const, role: command.role, fullySigned, postCommitStatus: "queued" as const, results, partialFailure: results.some(result => !result.ok) && results.some(result => result.ok), metrics };
}

async function applyMatrixOperation(request: NextRequest, actor: Awaited<ReturnType<typeof actorFor>>, operation: z.infer<typeof MatrixOperation>) {
  const order = await loadOrder(request, operation.orderId);
  if (!order || (order.origin === "hospitality_booking" && order.requiresDelivery === false)) throw Object.assign(new Error("CPU delivery is not selected for this booking, so no CPU production work is required."), { status: 422 });
  const storedPlan = await planRepository.get(operation.orderId);
  if (!storedPlan && !isLocalRuntime()) plans.delete(operation.orderId);
  const plan = await getPlan(request, operation.orderId, storedPlan);
  const auditActor = actor.name || actor.uid;
  let releaseDeliveries: CpuDurableDeliveryInput[] = [];
  if (operation.action === "reopen-review") {
    const hasAuthority = Boolean(plan.currentAllergenRelease || plan.signatures?.length || plan.signedSignatures?.length || plan.signedMenuContentHash || plan.matrixArtifact || plan.signedMatrixArtifact || plan.masterMatrixArtifact || plan.siteMatrixArtifacts);
    if (!hasAuthority) return { orderId: operation.orderId, plan, serviceDate: order.serviceDate, sequence: undefined, changed: false };
    const timestamp = now();
    const releaseBeforeReopen = plan.currentAllergenRelease;
    invalidateSignedAllergenAuthorityForNewSourceLineage(plan, auditActor, timestamp, "The allergen review was explicitly reopened for amendment.");
    const revokedRelease = plan.allergenReleaseHistory?.at(-1) || releaseBeforeReopen;
    plan.status = "planning";
    plan.audit.push({ action: "allergen-review-reopened", at: timestamp, by: auditActor, reason: "Prior signature authority was revoked before amendment." });
    updateLocalFixture(operation.orderId, current => ({ ...current, status: "planning", version: current.version + 1 }));
    plan.updatedAt = timestamp;
    plan.updatedBy = auditActor;
    const changedOrder = await loadOrder(request, operation.orderId);
    if (!changedOrder?.serviceDate) {
      await persistPlan(plan, storedPlan?.updatedAt);
      return { orderId: operation.orderId, plan, serviceDate: undefined, sequence: undefined, changed: true };
    }
    const releaseDeliveries = (releaseBeforeReopen?.packetArtifacts || [])[0]?.contentHash && changedOrder.destinationOplocId
      ? (() => {
          const releaseEvent = buildCpuAllergenReleaseEvent({ eventType: "revoked", release: revokedRelease!, oplocId: changedOrder.destinationOplocId! });
          return [{ eventId: `${releaseEvent.eventId}:delivered-in:${changedOrder.destinationOplocId}`, sourceAggregateId: releaseEvent.releaseId, sourceVersion: releaseEvent.sourceVersion, occurredAt: revokedRelease!.signedAt, consumer: "delivered-in" as const, route: "/api/internal/cpu-release-event", body: releaseEvent as unknown as Record<string, unknown> }];
        })()
      : [];
    const event = await planRepository.saveAndAppendCpuChange(plan, storedPlan?.updatedAt, {
      serviceDate: changedOrder.serviceDate,
      entityType: "productionPlan",
      entityId: plan.id,
      revision: plan.audit.length,
      changeType: "reopen-review",
      actorId: actor.uid,
      changedAt: timestamp,
      ...(operation.commandId ? { idempotencyKey: operation.commandId } : {}),
      propagation: { sourceEntityId: plan.id, serviceDate: changedOrder.serviceDate, sourceVersion: plan.audit.length, changedAt: timestamp, changeType: "amended", order: changedOrder, logistics: false },
      deliveries: releaseDeliveries,
    });
    if (event.duplicate && event.plan) Object.assign(plan, event.plan);
    if (!event.duplicate && releaseDeliveries[0]) await deliverCpuPropagation(releaseDeliveries[0].eventId);
    return { orderId: operation.orderId, plan, serviceDate: changedOrder.serviceDate, sequence: event.sequence, changed: true };
  }
  const nextMenuItems = (await mergeOriginalItems(request, { ...plan, menuItems: normalisePlanAllergens({ ...plan, menuItems: operation.menuItems }).menuItems }, operation.orderId, order)).menuItems;
  const contentChanged = JSON.stringify(plan.menuItems) !== JSON.stringify(nextMenuItems);
  const matchesSignedCheckpoint = signedAllergenCheckpointMatchesOrder(plan, order, nextMenuItems);
  const authorityMatches = allergenAuthorityMatchesOrder(plan, order, nextMenuItems);
  const effectiveNextStatus = effectiveProductionPlanStatus({ ...plan, menuItems: nextMenuItems });
  const noOpSave = Boolean(storedPlan && operation.action === "save-plan" && !contentChanged && plan.planningNotes === operation.planningNotes && authorityMatches && plan.status === effectiveNextStatus);
  if (noOpSave) return { orderId: operation.orderId, plan, serviceDate: order.serviceDate, sequence: undefined, changed: false };
  plan.menuItems = nextMenuItems;
  plan.planningNotes = operation.planningNotes;
  if (operation.action === "save-plan") {
    plan.status = matchesSignedCheckpoint || authorityMatches ? "planned" : "planning";
    plan.status = effectiveProductionPlanStatus(plan);
    if (matchesSignedCheckpoint && plan.currentAllergenRelease?.status === "current") { plan.signatures = plan.signedSignatures; plan.matrixArtifact = plan.signedMatrixArtifact; }
    else if (contentChanged || ((plan.currentAllergenRelease || plan.signatures?.length) && !authorityMatches)) {
      const releaseBeforeSave = plan.currentAllergenRelease;
      invalidateSignedAllergenAuthorityForNewSourceLineage(plan, auditActor, now(), "The allergen matrix or source lineage changed after signed release.");
      releaseDeliveries = revokedReleaseDeliveries(plan.allergenReleaseHistory?.at(-1) || releaseBeforeSave, order);
    }
    plan.audit.push({ action: "plan-saved", at: now(), by: auditActor });
    updateLocalFixture(operation.orderId, current => ({ ...current, status: "planning", version: current.version + 1 }));
  } else {
    const subItems = plan.menuItems.flatMap(item => item.subItems);
    if (!plan.menuItems.length || plan.menuItems.some(item => !item.name.trim() || !item.subItems.length) || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every menu item, sub-item name and allergen checker before marking the plan Planned."), { status: 422 });
    assertAllergenMatrixComplete(plan.menuItems, "marking the plan Planned");
    if (matchesSignedCheckpoint) { plan.signatures = plan.signedSignatures; plan.matrixArtifact = plan.signedMatrixArtifact; }
    else if (contentChanged || ((plan.currentAllergenRelease || plan.signatures?.length) && !authorityMatches)) {
      const releaseBeforeSave = plan.currentAllergenRelease;
      invalidateSignedAllergenAuthorityForNewSourceLineage(plan, auditActor, now(), "The allergen matrix or source lineage changed after signed release.");
      releaseDeliveries = revokedReleaseDeliveries(plan.allergenReleaseHistory?.at(-1) || releaseBeforeSave, order);
    }
    plan.status = "planned";
    plan.audit.push({ action: "plan-marked-planned", at: now(), by: auditActor });
    updateLocalFixture(operation.orderId, current => ({ ...current, status: "planned", version: current.version + 1 }));
    await syncCanonicalLifecycle(request, operation.orderId, "planned", "Production plan marked Planned by the production chef.");
  }
  const timestamp = now();
  plan.updatedAt = timestamp; plan.updatedBy = auditActor;
  const changedOrder = await loadOrder(request, operation.orderId);
  if (!changedOrder?.serviceDate) {
    await persistPlan(plan, storedPlan?.updatedAt);
    return { orderId: operation.orderId, plan, serviceDate: undefined, sequence: undefined };
  }
  const event = await planRepository.saveAndAppendCpuChange(plan, storedPlan?.updatedAt, { serviceDate: changedOrder.serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: operation.action, actorId: actor.uid, changedAt: timestamp, ...(operation.commandId ? { idempotencyKey: operation.commandId } : {}), propagation: { sourceEntityId: plan.id, serviceDate: changedOrder.serviceDate, sourceVersion: plan.audit.length, changedAt: timestamp, changeType: eventTypeForConsumers(operation.action), order: changedOrder, logistics: false }, deliveries: releaseDeliveries });
  if (event.duplicate && event.plan) Object.assign(plan, event.plan);
  if (!event.duplicate) for (const delivery of releaseDeliveries) await deliverCpuPropagation(delivery.eventId);
  return { orderId: operation.orderId, plan, serviceDate: changedOrder.serviceDate, sequence: event.sequence };
}
async function mergeOriginalItems(request: NextRequest, plan: ProductionPlan, orderId: string, knownOrder?: ProductionOrder): Promise<ProductionPlan> {
  const order = knownOrder || await loadOrder(request, orderId);
  if (!order) return plan;
  return mergeMissingProductionOrderLines(plan, orderId, order.lines);
}

async function handleGet(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  try {
    const actor = await actorFor(request);
    if (request.nextUrl.searchParams.get("reviewStatus") === "1") {
      const orderIds = parseDeliveredInReviewOrderIds(request.nextUrl.searchParams.get("orderIds"));
      const reviewStatuses = await loadDeliveredInReviewStatuses({ orderIds, repository: planRepository, loadOrder: (id) => loadOrder(request, id) });
      return NextResponse.json({ reviewStatuses });
    }
    if (request.nextUrl.searchParams.get("matrixStatus") === "1") {
      const orderIds = parseDeliveredInReviewOrderIds(request.nextUrl.searchParams.get("orderIds"));
      const matrixStatuses = await loadDeliveredInReviewStatuses({ orderIds, repository: planRepository, loadOrder: (id) => loadOrder(request, id), includeMatrix: true });
      recordDeliveredInReadBudget({ stage: "matrix_hydration", selectedIds: orderIds.length });
      return NextResponse.json({ matrixStatuses });
    }
    const serviceDate = request.nextUrl.searchParams.get("serviceDate");
    if (serviceDate) {
      const sourceOrders = await productionQueue(request, serviceDate);
      const selectedPlans = await planRepository.getByOrderIds(sourceOrders.map(order => order.canonicalId));
      const planByOrderId = new Map(selectedPlans.map(plan => [plan.orderId, normalisePlanAllergens(plan)]));
      const visiblePlans = await Promise.all(sourceOrders
        .filter(order => !(order.origin === "hospitality_booking" && order.requiresDelivery === false))
        .map(async order => mergeOriginalItems(request, planByOrderId.get(order.canonicalId) || await getPlan(request, order.canonicalId), order.canonicalId, order)));
      const entries = visiblePlans.filter(plan => plan.status === "planned");
      return NextResponse.json({ plans: visiblePlans, notifications: entries.map(plan => ({ id: `notification:${plan.id}`, title: "New production plan ready for menu generation.", orderId: plan.orderId, plannedItemCount: plan.menuItems.reduce((sum, item) => sum + item.subItems.length, 0), at: plan.updatedAt })), menus: entries.map(plan => ({ planId: plan.id, orderId: plan.orderId, clientSite: sourceOrders.find(order => order.canonicalId === plan.orderId)?.destinationLabel || "Site not assigned", items: plan.menuItems.flatMap(item => item.subItems.map(subItem => ({ menuItem: item.name, name: subItem.name, quantity: subItem.quantity, allergens: Object.entries(subItem.allergens).filter(([, state]) => state === "contains").map(([key]) => key), mayContain: Object.entries(subItem.allergens).filter(([, state]) => state === "may_contain").map(([key]) => key) }))) })) });
    }
    if (orderId) {
      const selectedOrder = await loadOrder(request, orderId);
      const visible = Boolean(selectedOrder && !(selectedOrder.origin === "hospitality_booking" && selectedOrder.requiresDelivery === false));
      if (request.nextUrl.searchParams.get("download") === "pdf") {
        const artifact = visible ? (await getPlan(request, orderId)).matrixArtifact : undefined;
        if (!artifact?.pdfPath || !existsSync(artifact.pdfPath)) return NextResponse.json({ error: { message: "A local PDF has not been generated for this matrix." } }, { status: 404 });
        return new NextResponse(await fs.readFile(artifact.pdfPath), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${artifact.fileName}"` } });
      }
      const selectedPlan = visible ? await mergeOriginalItems(request, await getPlan(request, orderId), orderId, selectedOrder) : undefined;
      if (request.nextUrl.searchParams.get("download") === "html") {
        if (!selectedPlan || !selectedOrder || !signedAllergenReviewMatchesOrder(selectedPlan, selectedOrder, selectedPlan.menuItems)) {
          return NextResponse.json({ error: { message: "The fully signed allergen matrix is not available for this production order." } }, { status: 404 });
        }
        const html = allergenMatrixHtml(selectedOrder, selectedPlan.menuItems, selectedPlan.signedSignatures?.length ? selectedPlan.signedSignatures : selectedPlan.signatures || []);
        return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `inline; filename="${orderId.replace(/[^a-zA-Z0-9_-]+/g, "-")}-signed-allergen-matrix.html"` } });
      }
      recordDeliveredInReadBudget({ stage: "selected_order_get", canonicalOrderDocs: selectedOrder ? 1 : 0, planDocs: selectedPlan ? 1 : 0, selectedIds: 1 });
      const selectedMatrixStatus = selectedPlan?.matrixArtifact && selectedOrder && currentAllergenReleaseMatchesOrder(selectedPlan.currentAllergenRelease, selectedOrder, selectedPlan.menuItems) ? "ready" : selectedPlan?.currentAllergenRelease?.materializationStatus === "failed" ? "failed" : selectedPlan?.signatures?.some(signature => signature.role === "production_chef") && selectedPlan.signatures?.some(signature => signature.role === "head_chef_site_manager") ? selectedOrder && !matrixDriveConfiguration(selectedOrder).enabled ? "not_configured" : "generating" : undefined;
      const signingLineage = selectedOrder && selectedPlan ? matrixSignatureScope(selectedOrder, menuContentHash(selectedPlan.menuItems)) : undefined;
      const signedMatrixAvailable = Boolean(selectedPlan && selectedOrder && signedAllergenReviewMatchesOrder(selectedPlan, selectedOrder, selectedPlan.menuItems));
      return NextResponse.json({ plan: selectedPlan, signingLineage: signingLineage || null, matrixStatus: selectedMatrixStatus, ...(selectedPlan?.currentAllergenRelease?.materializationError ? { matrixError: selectedPlan.currentAllergenRelease.materializationError } : {}), signedMatrixAvailable, plans: selectedPlan ? [selectedPlan] : [], notifications: selectedPlan?.status === "planned" ? [{ id: `notification:${selectedPlan.id}`, title: "New production plan ready for menu generation.", orderId: selectedPlan.orderId, plannedItemCount: selectedPlan.menuItems.reduce((sum, item) => sum + item.subItems.length, 0), at: selectedPlan.updatedAt }] : [], menus: [] });
    }
  } catch (error) {
    return errorResponse(error);
  }
  recordDataAccess({ app: "cpu-production", operation: "production-plans.rejected-unsafe-broad-request", source: "UNKNOWN", documents: 0 });
  throw Object.assign(new Error("A production plan selector is required. Request an orderId or an explicit bounded orderIds list."), { status: 400, code: "PLAN_SCOPE_REQUIRED" });
}

async function handlePost(request: NextRequest) {
  try {
    const actor = await actorFor(request);
    const raw = await request.json();
    if (raw?.action === "sign-master-matrix") {
      return NextResponse.json(await applyMasterSignatureBatch(request, actor, MasterSignCommand.parse(raw)));
    }
    if (raw?.action === "batch-plan") {
      const batch = MatrixBatchCommand.parse(raw);
      const results: Array<{ orderId: string; ok: boolean; planStatus?: ProductionPlan["status"]; error?: string }> = [];
      const latestSequenceByDate = new Map<string, number>();
      for (const operation of batch.operations) {
        try {
          const result = await applyMatrixOperation(request, actor, operation);
          if (result.serviceDate && result.sequence) latestSequenceByDate.set(result.serviceDate, Math.max(latestSequenceByDate.get(result.serviceDate) || 0, result.sequence));
          results.push({ orderId: operation.orderId, ok: true, planStatus: result.plan.status });
        } catch (error) {
          results.push({ orderId: operation.orderId, ok: false, error: error instanceof Error ? error.message : "The matrix operation failed." });
        }
      }
      const affectedDates = [...latestSequenceByDate.keys()];
      const affectedWeeks = new Map<string, number>();
      for (const serviceDate of affectedDates) {
        const sequence = latestSequenceByDate.get(serviceDate);
        await rebuildCpuDayProjection(request, serviceDate, sequence);
        const week = weekCommencingFor(serviceDate);
        affectedWeeks.set(week, Math.max(affectedWeeks.get(week) || 0, sequence || 0));
      }
      for (const [week, sequence] of affectedWeeks) {
        await rebuildCpuWeekProjection(request, week, sequence || undefined);
      }
      for (const serviceDate of affectedDates) {
        const affectedOrders = await Promise.all(batch.operations.filter(operation => latestSequenceByDate.has(serviceDate)).map(operation => loadOrder(request, operation.orderId)));
        for (const oplocId of [...new Set(affectedOrders.map(order => order?.destinationOplocId).filter((id): id is string => Boolean(id)))]) {
          const review = await rebuildCpuReviewPackage(request, serviceDate, oplocId, latestSequenceByDate.get(serviceDate));
          const sourceVersion = latestSequenceByDate.get(serviceDate) || 0;
          await notifyCpuConsumerInvalidations({ eventId: `cpu-change:${sourceVersion}:review:${oplocId}`, sourceEntityId: `cpu-review:${oplocId}:${serviceDate}`, serviceDate, sourceVersion, changedAt: new Date().toISOString(), changeType: "amended", order: { origin: "menu_planning", destinationOplocId: oplocId }, logistics: false, reviewManifest: review.manifest });
        }
      }
      recordDeliveredInReadBudget({ stage: "matrix_batch_mutation", planDocs: results.filter(result => result.ok).length, selectedIds: batch.operations.length, rebuildScopes: affectedDates.length + affectedWeeks.size });
      return NextResponse.json({ results, partialFailure: results.some(result => !result.ok) && results.some(result => result.ok) });
    }
    const command = Command.parse(raw);
    const auditActor = actor.name || actor.uid;
    if (!(await isVisibleForCpu(request, command.orderId))) throw Object.assign(new Error("CPU delivery is not selected for this booking, so no CPU production work is required."), { status: 422 });
    const storedPlan = await planRepository.get(command.orderId);
    if (!storedPlan && !isLocalRuntime()) plans.delete(command.orderId);
    const currentOrder = await loadOrder(request, command.orderId);
    if (!currentOrder) throw Object.assign(new Error("The canonical Production Order could not be loaded."), { status: 503 });
    if (command.action === "retry-materialization") {
      if (!storedPlan) throw Object.assign(new Error("The persisted CPU production plan could not be loaded for materialization retry."), { status: 409, code: "CPU_PLAN_NOT_FOUND" });
      return NextResponse.json(await retryCommittedCpuMaterialization({ plan: normalisePlanAllergens(storedPlan), order: currentOrder, expectedLineage: command.expectedLineage, timestamp: now() }));
    }
    const plan = await getPlan(request, command.orderId, storedPlan);
    const expectedUpdatedAt = storedPlan?.updatedAt;
    const timestamp = now();
    let notification: { status: string; reason?: string } | undefined;
    let revokedReleaseForEvent: ProductionPlan["currentAllergenRelease"];
    if (command.action === "accept") {
      plan.status = "planning"; plan.acceptedBy = auditActor; plan.acceptedAt = timestamp; plan.audit.push({ action: "order-accepted", at: timestamp, by: auditActor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "accepted", version: order.version + 1 }));
      await syncCanonicalLifecycle(request, command.orderId, "accepted", "Production chef accepted the governed Production Order.");
      // Local fixture orders remain self-contained. Only a governed Booking
      // hand-off gets the confirmation-email seam, and email failure must not
      // prevent the production chef from accepting the production work.
      if (command.orderId.startsWith("production-order:v1:booking:")) {
        try {
          const order = await productionOrderDetail(request, command.orderId);
          if (order) notification = await hubJson(request, "/api/hospitality/production-confirmation", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ action: "notify-booking-confirmed", sourceBookingId: order.sourceBookingId }) }, (value): value is { status: string; reason?: string } => Boolean(value && typeof value === "object" && typeof (value as { status?: unknown }).status === "string"));
        } catch (error) {
          notification = { status: "failed", reason: `Confirmation email could not be prepared: ${(error as Error).message}` };
        }
      }
    }
    if (command.action === "reject") { plan.status = "rejected"; plan.rejectionReason = command.reason; plan.audit.push({ action: "order-rejected", at: timestamp, by: auditActor, reason: command.reason }); updateLocalFixture(command.orderId, order => ({ ...order, status: "rejected", version: order.version + 1 })); }
    if (command.action === "reject") await syncCanonicalLifecycle(request, command.orderId, "rejected", command.reason);
    if (command.action === "clarify") { plan.status = "needs_clarification"; plan.clarificationNote = command.note; plan.audit.push({ action: "clarification-requested", at: timestamp, by: auditActor, reason: command.note }); updateLocalFixture(command.orderId, order => ({ ...order, status: "needs_clarification", version: order.version + 1 })); }
    if (command.action === "clarify") await syncCanonicalLifecycle(request, command.orderId, "needs_clarification", command.note);
    if (command.action === "save-plan") {
      const nextMenuItems = (await mergeOriginalItems(request, { ...plan, menuItems: normalisePlanAllergens({ ...plan, menuItems: command.menuItems }).menuItems }, command.orderId)).menuItems;
      const contentChanged = JSON.stringify(plan.menuItems) !== JSON.stringify(nextMenuItems);
      const matchesSignedCheckpoint = signedAllergenCheckpointMatchesOrder(plan, currentOrder, nextMenuItems);
      const authorityMatches = allergenAuthorityMatchesOrder(plan, currentOrder, nextMenuItems);
      const effectiveNextStatus = effectiveProductionPlanStatus({ ...plan, menuItems: nextMenuItems });
      const noOpSave = Boolean(storedPlan && !contentChanged && plan.planningNotes === command.planningNotes && authorityMatches && plan.status === effectiveNextStatus);
      if (noOpSave) {
        const matrixStatus = plan.matrixArtifact && currentAllergenReleaseMatchesOrder(plan.currentAllergenRelease, currentOrder, plan.menuItems) ? "ready" : plan.signatures?.some(signature => signature.role === "production_chef") && plan.signatures?.some(signature => signature.role === "head_chef_site_manager") ? !matrixDriveConfiguration(currentOrder).enabled ? "not_configured" : "generating" : undefined;
        return NextResponse.json({ plan, matrixArtifact: plan.matrixArtifact ?? null, signatures: plan.signatures ?? null, matrixStatus });
      }
      plan.menuItems = nextMenuItems;
      plan.planningNotes = command.planningNotes;
      plan.status = matchesSignedCheckpoint || authorityMatches ? "planned" : "planning";
      plan.status = effectiveProductionPlanStatus(plan);
      if (matchesSignedCheckpoint && plan.currentAllergenRelease?.status === "current") {
        plan.signatures = plan.signedSignatures;
        plan.matrixArtifact = plan.signedMatrixArtifact;
      } else if (contentChanged || ((plan.currentAllergenRelease || plan.signatures?.length) && !authorityMatches)) {
        const releaseBeforeSave = plan.currentAllergenRelease;
        invalidateSignedAllergenAuthorityForNewSourceLineage(plan, auditActor, timestamp, "The allergen matrix or source lineage changed after signed release.");
        revokedReleaseForEvent = plan.allergenReleaseHistory?.at(-1) || releaseBeforeSave;
      }
      plan.audit.push({ action: "plan-saved", at: timestamp, by: auditActor });
      updateLocalFixture(command.orderId, order => ({ ...order, status: "planning", version: order.version + 1 }));
    }
    if (command.action === "mark-planned") {
      const nextMenuItems = (await mergeOriginalItems(request, { ...plan, menuItems: normalisePlanAllergens({ ...plan, menuItems: command.menuItems }).menuItems }, command.orderId)).menuItems;
      const contentChanged = JSON.stringify(plan.menuItems) !== JSON.stringify(nextMenuItems);
      const matchesSignedCheckpoint = signedAllergenCheckpointMatchesOrder(plan, currentOrder, nextMenuItems);
      const authorityMatches = allergenAuthorityMatchesOrder(plan, currentOrder, nextMenuItems);
       plan.menuItems = nextMenuItems;
      plan.planningNotes = command.planningNotes;
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!plan.menuItems.length || plan.menuItems.some(item => !item.name.trim() || !item.subItems.length) || subItems.some(item => !item.name.trim() || item.evidenceStatus !== "completed")) throw Object.assign(new Error("Complete every menu item, sub-item name and allergen checker before marking the plan Planned."), { status: 422 });
      assertAllergenMatrixComplete(plan.menuItems, "marking the plan Planned");
      if (matchesSignedCheckpoint && plan.currentAllergenRelease?.status === "current") {
        plan.signatures = plan.signedSignatures;
        plan.matrixArtifact = plan.signedMatrixArtifact;
      } else if (contentChanged || ((plan.currentAllergenRelease || plan.signatures?.length) && !authorityMatches)) {
        const releaseBeforeSave = plan.currentAllergenRelease;
        invalidateSignedAllergenAuthorityForNewSourceLineage(plan, auditActor, timestamp, "The allergen matrix or source lineage changed after signed release.");
        revokedReleaseForEvent = plan.allergenReleaseHistory?.at(-1) || releaseBeforeSave;
      }
      plan.status = "planned"; plan.audit.push({ action: "plan-marked-planned", at: timestamp, by: auditActor }); updateLocalFixture(command.orderId, order => ({ ...order, status: "planned", version: order.version + 1 }));
      await syncCanonicalLifecycle(request, command.orderId, "planned", "Production plan marked Planned by the production chef.");
    }
    if (command.action === "sign-matrix") {
      if (plan.status !== "planned" && plan.status !== "planning") throw Object.assign(new Error("The allergen matrix is not available for signing."), { status: 422 });
       const subItems = plan.menuItems.flatMap(item => item.subItems);
       if (!subItems.length || subItems.some(item => !item.name.trim())) throw Object.assign(new Error("Complete every named sub-item before signing the matrix."), { status: 422 });
       assertAllergenMatrixComplete(plan.menuItems, "signing the matrix");
      const candidate = structuredClone(plan);
      candidate.status = "planned";
      const currentMenuContentHash = menuContentHash(plan.menuItems);
      if (hasAllergenAuthority(plan) && !allergenAuthorityMatchesOrder(plan, currentOrder, plan.menuItems)) throw Object.assign(new Error("Reopen the allergen review before changing a signed matrix."), { status: 409, code: "CPU_REVIEW_REOPEN_REQUIRED" });
      const currentSignatureScope = matrixSignatureScope(currentOrder, currentMenuContentHash);
      if (!currentSignatureScope) throw Object.assign(new Error("The current source lineage is unavailable; the matrix cannot be signed."), { status: 503 });
      if (!sameLineage(currentSignatureScope, command.expectedLineage)) throw Object.assign(new Error("The reviewed source lineage has changed. Reload and review the current matrix before signing."), { status: 409, code: "CPU_SIGN_LINEAGE_CONFLICT" });
      const latestOrderForSign = await loadOrder(request, command.orderId);
      const latestScopeForSign = latestOrderForSign && matrixSignatureScope(latestOrderForSign, currentMenuContentHash);
      if (!latestScopeForSign || !sameLineage(latestScopeForSign, command.expectedLineage)) throw Object.assign(new Error("The reviewed source lineage advanced while this signature was being prepared. Reload and review the current matrix before signing."), { status: 409, code: "CPU_SIGN_LINEAGE_CONFLICT" });
      if (candidate.currentAllergenRelease?.status === "pending" && !command.commandId) throw Object.assign(new Error("A signed release is already awaiting materialization. Retry the release instead of signing again."), { status: 409 });
      // Legacy signatures without exact publication/day/content lineage are
      // historical evidence only and must never make the current matrix look
      // signed. They remain in the audit trail and are not deleted here.
      const signatures = (candidate.signatures || []).filter(signature => signatureMatchesScope(signature, currentSignatureScope));
      candidate.signatures = signatures;
      if (signatures.some(signature => signature.role === command.role) && !command.commandId) throw Object.assign(new Error("This signatory role has already signed this matrix."), { status: 409 });
      if (!signatures.some(signature => signature.role === command.role)) {
        if (signatures.length > 0 && plan.signedMenuContentHash && plan.signedMenuContentHash !== currentMenuContentHash) throw Object.assign(new Error("The allergen matrix changed after the first signature. Re-review the matrix before signing again."), { status: 409 });
        const signature: InternalMatrixSignature = { role: command.role, printedName: command.printedName, signedAt: timestamp, actor: auditActor, attestation: command.attestation, signatureDataUrl: command.signatureDataUrl, scope: currentSignatureScope };
        candidate.signatures = [...signatures, signature];
        if (signatures.length === 0) candidate.signedMenuContentHash = currentMenuContentHash;
        candidate.audit.push({ action: "allergen-matrix-signed", at: timestamp, by: auditActor, reason: `${command.role}: ${command.attestation}` });
        const fullySigned = candidate.signatures.some(item => item.role === "production_chef") && candidate.signatures.some(item => item.role === "head_chef_site_manager");
        if (fullySigned) {
          candidate.audit.push({ action: "allergen-matrix-signature-complete", at: timestamp, by: auditActor, reason: "Both signatures recorded; authoritative CPU release commit will precede materialization." });
          candidate.signedMenuContentHash = currentMenuContentHash;
          candidate.signedSignatures = candidate.signatures;
          candidate.currentAllergenRelease = pendingReleaseFor(candidate, currentOrder, timestamp);
        }
      }
      Object.assign(plan, candidate);
    }
    if (command.action === "save-matrix") {
      if (plan.status !== "planned") throw Object.assign(new Error("Mark the allergen matrix Planned before saving it to the site Drive."), { status: 422 });
      if (!plan.signatures?.some(signature => signature.role === "production_chef") || !plan.signatures?.some(signature => signature.role === "head_chef_site_manager")) throw Object.assign(new Error("Both required signatures must be recorded before generating the allergen matrix PDF."), { status: 422 });
      const subItems = plan.menuItems.flatMap(item => item.subItems);
      if (!subItems.length || subItems.some(item => !item.name.trim())) throw Object.assign(new Error("Complete every named sub-item before saving the matrix."), { status: 422 });
      if (hasAllergenAuthority(plan) && !allergenAuthorityMatchesOrder(plan, currentOrder, plan.menuItems)) throw Object.assign(new Error("Reopen the allergen review before changing a signed matrix."), { status: 409, code: "CPU_REVIEW_REOPEN_REQUIRED" });
      const currentSignatureScope = matrixSignatureScope(currentOrder, menuContentHash(plan.menuItems));
      if (command.expectedLineage && !sameLineage(currentSignatureScope, command.expectedLineage)) throw Object.assign(new Error("The reviewed source lineage has changed. Reload and review the current matrix before retrying materialization."), { status: 409, code: "CPU_RELEASE_LINEAGE_CONFLICT" });
      if (!plan.currentAllergenRelease) plan.currentAllergenRelease = pendingReleaseFor(plan, currentOrder, timestamp);
      if (plan.currentAllergenRelease.status === "current" && plan.currentAllergenRelease.materializationStatus === "ready") throw Object.assign(new Error("This CPU allergen release is already current."), { status: 409 });
      plan.signedMenuContentHash = menuContentHash(plan.menuItems);
      plan.signedSignatures = plan.signatures;
      plan.audit.push({ action: "allergen-matrix-materialization-requested", at: timestamp, by: auditActor, reason: "Release materialization requested after authoritative signature state." });
    }
    plan.updatedAt = timestamp; plan.updatedBy = auditActor;
    const changedOrder = await loadOrder(request, command.orderId);
    const candidateReleaseForEvent = plan.currentAllergenRelease?.status === "current" && plan.currentAllergenRelease.materializationStatus === "ready" ? plan.currentAllergenRelease : revokedReleaseForEvent;
    const releaseForEvent = candidateReleaseForEvent?.packetArtifacts?.[0]?.contentHash ? candidateReleaseForEvent : undefined;
    const releaseOplocIds = changedOrder?.destinationOplocId ? [changedOrder.destinationOplocId] : [];
    const releaseEventType = releaseForEvent?.status === "current" ? "published" as const : "revoked" as const;
    const releaseDeliveries = releaseForEvent ? releaseOplocIds.map(oplocId => {
      const releaseEvent = buildCpuAllergenReleaseEvent({ eventType: releaseEventType, release: releaseForEvent, oplocId });
      return { eventId: `${releaseEvent.eventId}:delivered-in:${oplocId}`, sourceAggregateId: releaseEvent.releaseId, sourceVersion: releaseEvent.sourceVersion, occurredAt: releaseForEvent.signedAt, consumer: "delivered-in" as const, route: "/api/internal/cpu-release-event", body: releaseEvent as unknown as Record<string, unknown> };
    }) : [];
    const releaseNeedsMaterialization = Boolean(plan.currentAllergenRelease && ["pending", "current"].includes(plan.currentAllergenRelease.status) && plan.currentAllergenRelease.materializationStatus !== "ready");
    const materializationDelivery = releaseNeedsMaterialization && changedOrder ? releaseMaterializationDelivery(plan, plan.currentAllergenRelease!, changedOrder, timestamp) : undefined;
    const event = changedOrder?.serviceDate ? await planRepository.saveAndAppendCpuChange(plan, expectedUpdatedAt, { serviceDate: changedOrder.serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: command.action, actorId: actor.uid, changedAt: timestamp, ...(command.commandId ? { idempotencyKey: command.commandId } : {}), propagation: { sourceEntityId: plan.id, serviceDate: changedOrder.serviceDate, sourceVersion: plan.audit.length, changedAt: timestamp, changeType: eventTypeForConsumers(command.action), order: changedOrder, logistics: false }, deliveries: [...releaseDeliveries, ...(materializationDelivery ? [materializationDelivery] : [])] }) : (await persistPlan(plan, expectedUpdatedAt), undefined);
    if (event?.duplicate) {
      if (!event.plan) throw Object.assign(new Error("This signing attempt has an incomplete idempotency receipt. Start a new signing attempt after reviewing the current matrix."), { status: 409, code: "CPU_SIGN_IDEMPOTENCY_CONFLICT" });
      Object.assign(plan, event.plan);
      if (command.action === "sign-matrix") {
        const currentScope = matrixSignatureScope(changedOrder || currentOrder, menuContentHash(plan.menuItems));
        if (!hasExactSignature(plan, command.role, currentScope)) {
          throw Object.assign(new Error("This signing attempt was already used, but the requested exact-lineage signature is not authoritative. Start a new signing attempt after reviewing the current matrix."), { status: 409, code: "CPU_SIGN_IDEMPOTENCY_CONFLICT" });
        }
      }
    }
    // A duplicate command has already staged its durable work. Replaying the
    // HTTP request must not synchronously repeat delivery or consumer effects.
    let materializationResult: { eventId: string; status: string } | undefined;
    if (materializationDelivery && event) {
      if (command.action === "save-matrix") await replayCpuPropagation(materializationDelivery.eventId);
      materializationResult = await deliverCpuPropagation(materializationDelivery.eventId);
    }
    if (releaseForEvent && !event?.duplicate) for (const oplocId of releaseOplocIds) await notifyDeliveredInAllergenRelease({ eventType: releaseEventType, release: releaseForEvent, oplocId });
    recordDeliveredInReadBudget({ stage: "plan_post_mutation", canonicalOrderDocs: changedOrder ? 1 : 0, planDocs: 1, selectedIds: 1 });
    if (changedOrder?.serviceDate && !event?.duplicate) {
      await rebuildCpuDayProjection(request, changedOrder.serviceDate, event!.sequence);
      await rebuildCpuWeekProjection(request, weekCommencingFor(changedOrder.serviceDate), event!.sequence);
      const review = changedOrder.destinationOplocId ? await rebuildCpuReviewPackage(request, changedOrder.serviceDate, changedOrder.destinationOplocId, event!.sequence) : undefined;
      await notifyCpuConsumerInvalidations({ eventId: `cpu-change:${plan.id}:v${event!.sequence}`, sourceEntityId: plan.id, serviceDate: changedOrder.serviceDate, sourceVersion: event!.sequence, changedAt: timestamp, changeType: eventTypeForConsumers(command.action), order: changedOrder, logistics: false, ...(review ? { reviewManifest: review.manifest } : {}) });
    }
    const matrixStatus = plan.matrixArtifact && changedOrder && currentAllergenReleaseMatchesOrder(plan.currentAllergenRelease, changedOrder, plan.menuItems) ? "ready" : plan.signatures?.some(signature => signature.role === "production_chef") && plan.signatures?.some(signature => signature.role === "head_chef_site_manager") ? changedOrder && !matrixDriveConfiguration(changedOrder).enabled ? "not_configured" : "generating" : undefined;
    const signingLineage = changedOrder ? matrixSignatureScope(changedOrder, menuContentHash(plan.menuItems)) : undefined;
    return NextResponse.json({ plan, signingLineage: signingLineage || null, matrixArtifact: plan.matrixArtifact ?? null, signatures: plan.signatures ?? null, matrixStatus, materializationDelivery: materializationResult || null, notification: notification || (plan.status === "planned" ? { title: "New production plan ready for menu generation.", orderId: plan.orderId } : undefined) });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.plan.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "cpu-production", action: "cpu-production.plan.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
