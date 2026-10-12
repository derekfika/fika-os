import type { MatrixArtifact, ProductionPlan } from "../app/lib/production-plan";
import { matrixSignatureScope } from "../app/lib/production-plan";
import { buildReusedCpuAllergenRelease, allergenMatrixContentHash, revokeCpuAllergenRelease } from "./cpu-allergen-release";
import { releaseMaterializationDelivery } from "./cpu-retry-materialization";
import { adoptReusableAuthority, reopenAdoptingPlan, revokeAuthorityForRelease } from "./allergen-reuse-service";
import { captureApprovedMatrix, compositionIdentity, type CompositionOrder } from "./allergen-composition";
import type { AllergenAuthorityStore } from "./allergen-authority-store";
import type { ProductionPlanRepository } from "./production-plan-repository";
import type { ProductionOrder } from "./production-types";

/**
 * Orchestration of the shared allergen authority lifecycle on top of the normal CPU change path. Every durable plan mutation
 * goes through `saveAndAppendCpuChange`, so the CPU change stack, outbox and consumer invalidations see it exactly as they see
 * a signing or a reopen. Side effects that need an HTTP request (projection rebuilds, consumer invalidation fan-out) are
 * injected as `emit`, so the same orchestration is exercised by the route and by integration tests.
 */
export type ReuseOrchestrationDeps = {
  plans: ProductionPlanRepository;
  store: AllergenAuthorityStore;
  /** Called once per durably committed plan change, never for an idempotent replay. */
  emit(input: { order: ProductionOrder; plan: ProductionPlan; sequence: number; changeType: string; at: string }): Promise<void>;
  /** Loads the canonical order of an adopting plan (needed for its service date, lineage and projections). */
  loadOrder(orderId: string): Promise<ProductionOrder | undefined>;
};

type Order = ProductionOrder & CompositionOrder & { sourceBookingId?: string; sourceQuoteRevisionId?: string };
const menuHash = (plan: ProductionPlan) => allergenMatrixContentHash(plan.menuItems);

function pendingReusedRelease(plan: ProductionPlan, order: ProductionOrder, at: string) {
  const reuse = plan.reusedAllergenAuthority!;
  const source = matrixSignatureScope(order, menuHash(plan));
  if (!source?.sourceBookingId || !source.sourceQuoteRevisionId || !source.sourceRevision) throw Object.assign(new Error("The current Hospitality source lineage is unavailable; the approved matrix cannot be released."), { status: 503, code: "CPU_ALLERGEN_REUSE_LINEAGE_UNAVAILABLE" });
  const hash = menuHash(plan);
  const masterArtifact: MatrixArtifact = { id: `pending-cpu-allergen:${order.canonicalId}:${hash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName: `PREPARED-${order.canonicalId}.pdf`, createdAt: at, createdBy: plan.updatedBy, contentHash: hash, pdfStatus: "unavailable", driveStatus: "not_configured" };
  return buildReusedCpuAllergenRelease({
    serviceDate: source.serviceDate, sourceBookingId: source.sourceBookingId, sourceQuoteRevisionId: source.sourceQuoteRevisionId, sourceRevision: source.sourceRevision, sourceVersion: source.sourceVersion, sourceContentHash: source.sourceContentHash,
    version: Math.max(1, ...((plan.allergenReleaseHistory || []).map(item => item.version + 1))), items: plan.menuItems, masterArtifact, previous: [...(plan.allergenReleaseHistory || [])].at(-1),
    reusedAuthority: { compositionId: reuse.compositionId, identityVersion: reuse.identityVersion, matrixSemanticHash: reuse.matrixSemanticHash, adoptedAt: reuse.adoptedAt, adoptedBy: reuse.adoptedBy, origin: { orderId: reuse.origin.orderId, planId: reuse.origin.planId, ...(reuse.origin.sourceBookingId ? { sourceBookingId: reuse.origin.sourceBookingId } : {}), ...(reuse.origin.quoteRevisionId ? { quoteRevisionId: reuse.origin.quoteRevisionId } : {}), releaseId: reuse.origin.releaseId, releaseVersion: reuse.origin.releaseVersion, matrixContentHash: reuse.origin.matrixContentHash, signedAt: reuse.origin.signedAt, signatures: reuse.origin.signatures.map(signature => ({ ...signature })) } },
  });
}

/** Revokes the plan's reused release (never a signed one) and drops the artifacts derived from it. Mutates; returns the revoked release. */
export function revokeReusedRelease(plan: ProductionPlan, input: { by: string; at: string; reason: string }) {
  const release = plan.currentAllergenRelease;
  if (release?.approvalMode !== "reused_authority") return undefined;
  const revoked = release.status === "revoked" ? release : revokeCpuAllergenRelease(release, input);
  if (!(plan.allergenReleaseHistory || []).some(item => item.releaseId === revoked.releaseId)) plan.allergenReleaseHistory = [...(plan.allergenReleaseHistory || []), revoked];
  plan.currentAllergenRelease = undefined;
  plan.matrixArtifact = undefined; plan.signedMatrixArtifact = undefined; plan.masterMatrixArtifact = undefined; plan.siteMatrixArtifacts = undefined;
  plan.audit.push({ action: "allergen-release-revoked", at: input.at, by: input.by, reason: input.reason });
  return revoked;
}

/**
 * Explicit CPU command: adopt a previously approved composition authority AND commit the current-booking release that makes
 * it authoritative downstream. Replay-safe: an already adopted plan returns unchanged without a new release or change event.
 */
export async function applyReuseCommand(deps: ReuseOrchestrationDeps, input: { plan: ProductionPlan; storedPlan?: ProductionPlan; order: Order; actor: string; actorId: string; at: string; commandId?: string; syncPlanned?: () => Promise<void> }) {
  const adoption = await adoptReusableAuthority(deps.store, input.plan, input.order, { by: input.actor, at: input.at });
  if (!adoption.changed) return { plan: input.plan, changed: false as const };
  const plan = adoption.plan;
  plan.currentAllergenRelease = pendingReusedRelease(plan, input.order, input.at);
  plan.audit.push({ action: "allergen-reused-release-committed", at: input.at, by: input.actor, reason: `Release ${plan.currentAllergenRelease.releaseId} issued from reused authority; materialization follows the committed release.` });
  if (input.syncPlanned) await input.syncPlanned();
  plan.updatedAt = input.at; plan.updatedBy = input.actor;
  const delivery = releaseMaterializationDelivery(plan, plan.currentAllergenRelease, input.order, input.at);
  const event = await deps.plans.saveAndAppendCpuChange(plan, input.storedPlan?.updatedAt, {
    serviceDate: input.order.serviceDate || input.order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: "apply-reused-authority", actorId: input.actorId, changedAt: input.at,
    idempotencyKey: input.commandId || `allergen-reuse:${plan.orderId}:${plan.reusedAllergenAuthority!.compositionId}:${plan.reusedAllergenAuthority!.origin.releaseId}`,
    propagation: { sourceEntityId: plan.id, serviceDate: input.order.serviceDate || input.order.requiredBy.slice(0, 10), sourceVersion: plan.audit.length, changedAt: input.at, changeType: "amended", order: input.order, logistics: false },
    deliveries: [delivery],
  });
  if (event.duplicate) return { plan: event.plan || plan, changed: false as const, duplicate: true as const };
  await deps.emit({ order: input.order, plan, sequence: event.sequence, changeType: "apply-reused-authority", at: input.at });
  return { plan, changed: true as const, sequence: event.sequence, materializationDelivery: delivery };
}

/**
 * The shared authority was revoked or corrected. Every booking that reused it loses its reused release and approval through the
 * normal CPU change path (change event, outbox propagation, projection and consumer invalidation), never a bare plan write.
 */
export async function cascadeAuthorityRevocation(deps: ReuseOrchestrationDeps, input: { order: Order | undefined; releaseId: string; actor: string; actorId: string; at: string; reason: string }) {
  const adopters = await revokeAuthorityForRelease(deps.store, input.order, input.releaseId, { by: input.actor, at: input.at, reason: input.reason });
  const reopened: string[] = [];
  for (const orderId of adopters) {
    const stored = await deps.plans.get(orderId);
    if (!stored?.reusedAllergenAuthority) continue;
    const plan = structuredClone(stored);
    const order = await deps.loadOrder(orderId);
    revokeReusedRelease(plan, { by: input.actor, at: input.at, reason: input.reason });
    if (!reopenAdoptingPlan(plan, { by: input.actor, at: input.at })) continue;
    plan.updatedAt = input.at; plan.updatedBy = input.actor;
    const serviceDate = order?.serviceDate || order?.requiredBy?.slice(0, 10);
    if (!order || !serviceDate) { await deps.plans.save(plan, stored.updatedAt); reopened.push(orderId); continue; }
    const event = await deps.plans.saveAndAppendCpuChange(plan, stored.updatedAt, {
      serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: "allergen-authority-revoked", actorId: input.actorId, changedAt: input.at,
      idempotencyKey: `allergen-reuse-revoked:${orderId}:${input.releaseId}`,
      propagation: { sourceEntityId: plan.id, serviceDate, sourceVersion: plan.audit.length, changedAt: input.at, changeType: "amended", order, logistics: false },
    });
    if (!event.duplicate) await deps.emit({ order, plan, sequence: event.sequence, changeType: "allergen-authority-revoked", at: input.at });
    reopened.push(orderId);
  }
  return reopened;
}

/** Whether the approved matrix itself changed between two states of the same plan (not merely booking metadata). */
export function approvedMatrixChanged(before: ProductionPlan | undefined, after: ProductionPlan, order: Order | undefined) {
  if (!before || !order) return true;
  const was = captureApprovedMatrix(before, order)?.semanticHash;
  const now = captureApprovedMatrix(after, order)?.semanticHash;
  return !was || was !== now;
}

export { compositionIdentity };
