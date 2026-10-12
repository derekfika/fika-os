import type { MatrixArtifact, ProductionPlan } from "../app/lib/production-plan";
import { matrixSignatureScope } from "../app/lib/production-plan";
import { buildReusedCpuAllergenRelease, allergenMatrixContentHash, revokeCpuAllergenRelease } from "./cpu-allergen-release";
import { releaseMaterializationDelivery } from "./cpu-retry-materialization";
import { adoptReusableAuthority, reopenAdoptingPlan } from "./allergen-reuse-service";
import { enqueueCpuDelivery } from "./cpu-durable-outbox";
import { applyCascadeComplete, applyCascadeStep } from "./allergen-authority-store";
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

export const AUTHORITY_REVOKED_ROUTE = "/api/internal/cpu-allergen-authority-revoked";
export const authorityRevocationEventId = (compositionId: string, releaseId: string) => `cpu-allergen-authority-revoked:${compositionId}:${releaseId}`;

/**
 * Per-adopter work, safe to run any number of times. The plan change is committed once (idempotent key), the invalidation
 * effects are at-least-once, and durable progress on the authority record makes the whole cascade observable.
 */
async function reopenAdopter(deps: ReuseOrchestrationDeps, input: { compositionId: string; releaseId: string; orderId: string; actor: string; actorId: string; at: string; reason: string }) {
  const authority = await deps.store.get(input.compositionId);
  const progress = authority?.cascades?.[input.releaseId]?.adopters[input.orderId];
  if (progress?.done) return;
  const stored = await deps.plans.get(input.orderId);
  if (!stored) { await deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.releaseId, input.orderId, { done: true }, input.at)); return; }
  const order = await deps.loadOrder(input.orderId);
  let plan = stored;
  let sequence = progress?.sequence;
  const reusesAuthority = stored.reusedAllergenAuthority?.compositionId === input.compositionId;
  // An adopter that no longer reuses this authority and was never touched by this cascade (for example reopened by an earlier
  // revocation) needs no work and no invalidation.
  if (!reusesAuthority && progress === undefined) { await deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.releaseId, input.orderId, { done: true }, input.at)); return; }
  if (reusesAuthority) {
    // Record intent first so a crash between commit and bookkeeping still leads to the invalidation effects on retry.
    await deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.releaseId, input.orderId, { sequence: 0 }, input.at));
    plan = structuredClone(stored);
    revokeReusedRelease(plan, { by: input.actor, at: input.at, reason: input.reason });
    reopenAdoptingPlan(plan, { by: input.actor, at: input.at });
    plan.updatedAt = input.at; plan.updatedBy = input.actor;
    const serviceDate = order?.serviceDate || order?.requiredBy?.slice(0, 10);
    if (!order || !serviceDate) throw Object.assign(new Error(`The canonical order for ${input.orderId} is unavailable; the cascade will retry.`), { status: 503 });
    const event = await deps.plans.saveAndAppendCpuChange(plan, stored.updatedAt, {
      serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: "allergen-authority-revoked", actorId: input.actorId, changedAt: input.at,
      idempotencyKey: `allergen-reuse-revoked:${input.orderId}:${input.releaseId}`,
      propagation: { sourceEntityId: plan.id, serviceDate, sourceVersion: plan.audit.length, changedAt: input.at, changeType: "amended", order, logistics: false },
    });
    sequence = event.sequence;
    if (event.duplicate && event.plan) plan = event.plan;
    await deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.releaseId, input.orderId, { sequence }, input.at));
  }
  // Invalidation effects (projections, review package, consumers) are idempotent per sequence and retried until marked done.
  if (order) await deps.emit({ order, plan, sequence: sequence || plan.audit.length, changeType: "allergen-authority-revoked", at: input.at });
  await deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.releaseId, input.orderId, { done: true }, input.at));
}

/**
 * Durable, retryable work item behind an authority revocation. Safe to run repeatedly (outbox redelivery): finished adopters are
 * skipped, a failing adopter does not block the others, and the work throws until every adopter is non-authoritative so the
 * outbox retries it. Completion is recorded on the authority record.
 */
export async function processAuthorityRevocation(deps: ReuseOrchestrationDeps, input: { compositionId: string; releaseId: string; actor: string; actorId: string; at: string; reason: string }) {
  const authority = await deps.store.get(input.compositionId);
  if (!authority || authority.status !== "revoked") return { status: "not_revoked" as const, failed: [] as string[] };
  const adopters = [...new Set(authority.reusedBy.map(item => item.orderId))].filter(orderId => orderId !== authority.origin.orderId && !authority.supersededOrigins.some(origin => origin.orderId === orderId));
  const failed: string[] = [];
  for (const orderId of adopters) {
    try { await reopenAdopter(deps, { ...input, orderId }); } catch (error) { failed.push(`${orderId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (failed.length) throw Object.assign(new Error(`Allergen authority revocation cascade incomplete (${failed.length}/${adopters.length}): ${failed.join("; ")}`), { status: 502, code: "CPU_ALLERGEN_AUTHORITY_CASCADE_INCOMPLETE" });
  await deps.store.mutate(input.compositionId, current => applyCascadeComplete(current, input.releaseId, input.at, input.actor));
  return { status: "complete" as const, failed, adopters };
}

/**
 * The shared authority was revoked or corrected. The revocation itself is immediate; reopening each adopting booking is
 * committed as durable outbox work (retried until complete) and attempted inline as well, so nothing depends on a later mutation.
 */
export async function cascadeAuthorityRevocation(deps: ReuseOrchestrationDeps, input: { order: Order | undefined; releaseId: string; actor: string; actorId: string; at: string; reason: string }) {
  const identity = compositionIdentity(input.order);
  if (!identity) return [] as string[];
  const revoked = await deps.store.revokeForOrigin(identity.compositionId, input.releaseId, input.at, input.actor, input.reason);
  if (!revoked) return [] as string[];
  const work = { compositionId: identity.compositionId, releaseId: input.releaseId, actor: input.actor, actorId: input.actorId, at: input.at, reason: input.reason };
  await enqueueCpuDelivery({ eventId: authorityRevocationEventId(identity.compositionId, input.releaseId), sourceAggregateId: identity.compositionId, sourceVersion: 1, occurredAt: input.at, consumer: "cpu-production", route: AUTHORITY_REVOKED_ROUTE, body: work });
  try { await processAuthorityRevocation(deps, work); } catch (error) { console.error("[cpu-allergen-reuse] adopter cascade deferred to durable retry", { compositionId: identity.compositionId, releaseId: input.releaseId, error: error instanceof Error ? error.message : String(error) }); }
  return revoked.reusedBy.map(item => item.orderId).filter(orderId => orderId !== revoked.origin.orderId);
}

/** Whether the approved matrix itself changed between two states of the same plan (not merely booking metadata). */
export function approvedMatrixChanged(before: ProductionPlan | undefined, after: ProductionPlan, order: Order | undefined) {
  if (!before || !order) return true;
  const was = captureApprovedMatrix(before, order)?.semanticHash;
  const now = captureApprovedMatrix(after, order)?.semanticHash;
  return !was || was !== now;
}

export { compositionIdentity };
