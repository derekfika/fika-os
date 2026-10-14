import type { MatrixArtifact, ProductionPlan } from "../app/lib/production-plan";
import { matrixSignatureScope } from "../app/lib/production-plan";
import { buildReusedCpuAllergenRelease, allergenMatrixContentHash, revokeCpuAllergenRelease } from "./cpu-allergen-release";
import { releaseMaterializationDelivery } from "./cpu-retry-materialization";
import { applyReusedAuthority, captureApprovedMatrix, clearReuse, compositionIdentity, evaluateReuse, type AllergenCompositionAuthority, type CompositionOrder } from "./allergen-composition";
import { signedAuthorityCandidate } from "./allergen-reuse-service";
import { enqueueCpuDelivery } from "./cpu-durable-outbox";
import { applyCascadeComplete, applyCascadeStep, type AllergenAuthorityStore, type AuthorityClause } from "./allergen-authority-store";
import type { ProductionPlanRepository } from "./production-plan-repository";
import type { ProductionOrder } from "./production-types";

/**
 * State model (see allergen-composition / allergen-authority-store / production-plan-repository):
 *
 *   authority (per composition) = generation N, status active|revoked, revocation intent, adopter registry, per-generation cascade
 *   adopter plan                = reusedAllergenAuthority { composition, generation, origin release, matrix hash } + reused release
 *
 * The plan repository enforces, INSIDE the transaction that writes a plan and its CPU change event, that any persisted reused
 * `planned` plan / `pending` or `current` reused release is bound to an authority generation that is still active (and registered).
 *
 * Adoption:   ONE transaction = guard(generation active) + adopted plan + generation-bound release + committed registry entry + change event.
 *             Nothing is reserved, so nothing can strand, expire, or commit behind a revocation.
 * Revocation: an origin mutation that withdraws a signed approval carries the revocation in the SAME transaction as the plan change
 *             (status revoked + revocation intent + cascadePending).  Durable outbox work and the worker reconcile the cascade;
 *             per-adopter reopen is an idempotent change event + at-least-once invalidation; completion is recorded per generation.
 * Reads:      every read path validates the same contract (allergen-reuse-service `validateReusedApproval`) and fails closed.
 */
export type ReuseOrchestrationDeps = {
  plans: ProductionPlanRepository;
  store: AllergenAuthorityStore;
  /** Called once per durably committed plan change, never for an idempotent replay. */
  emit(input: { order: ProductionOrder; plan: ProductionPlan; sequence: number; changeType: string; at: string }): Promise<void>;
  /** Loads the canonical order of an adopting plan (needed for its service date, lineage and projections). */
  loadOrder(orderId: string): Promise<ProductionOrder | undefined>;
  now?(): string;
};

type Order = ProductionOrder & CompositionOrder & { sourceBookingId?: string; sourceQuoteRevisionId?: string };
const menuHash = (plan: ProductionPlan) => allergenMatrixContentHash(plan.menuItems);
const nowOf = (deps: ReuseOrchestrationDeps) => (deps.now ? deps.now() : new Date().toISOString());

function pendingReusedRelease(plan: ProductionPlan, order: ProductionOrder, at: string) {
  const reuse = plan.reusedAllergenAuthority!;
  const source = matrixSignatureScope(order, menuHash(plan));
  if (!source?.sourceBookingId || !source.sourceQuoteRevisionId || !source.sourceRevision) throw Object.assign(new Error("The current Hospitality source lineage is unavailable; the approved matrix cannot be released."), { status: 503, code: "CPU_ALLERGEN_REUSE_LINEAGE_UNAVAILABLE" });
  const hash = menuHash(plan);
  const masterArtifact: MatrixArtifact = { id: `pending-cpu-allergen:${order.canonicalId}:${hash.slice(0, 16)}`, bookingId: order.sourceBookingId, fileName: `PREPARED-${order.canonicalId}.pdf`, createdAt: at, createdBy: plan.updatedBy, contentHash: hash, pdfStatus: "unavailable", driveStatus: "not_configured" };
  return buildReusedCpuAllergenRelease({
    serviceDate: source.serviceDate, sourceBookingId: source.sourceBookingId, sourceQuoteRevisionId: source.sourceQuoteRevisionId, sourceRevision: source.sourceRevision, sourceVersion: source.sourceVersion, sourceContentHash: source.sourceContentHash,
    version: Math.max(1, ...((plan.allergenReleaseHistory || []).map(item => item.version + 1))), items: plan.menuItems, masterArtifact, previous: [...(plan.allergenReleaseHistory || [])].at(-1),
    reusedAuthority: { compositionId: reuse.compositionId, generation: reuse.generation, identityVersion: reuse.identityVersion, matrixSemanticHash: reuse.matrixSemanticHash, adoptedAt: reuse.adoptedAt, adoptedBy: reuse.adoptedBy, origin: { orderId: reuse.origin.orderId, planId: reuse.origin.planId, ...(reuse.origin.sourceBookingId ? { sourceBookingId: reuse.origin.sourceBookingId } : {}), ...(reuse.origin.quoteRevisionId ? { quoteRevisionId: reuse.origin.quoteRevisionId } : {}), releaseId: reuse.origin.releaseId, releaseVersion: reuse.origin.releaseVersion, matrixContentHash: reuse.origin.matrixContentHash, signedAt: reuse.origin.signedAt, signatures: reuse.origin.signatures.map(signature => ({ ...signature })) } },
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

/** Reopens one adopting plan (mutates): reused release revoked, provenance cleared, status back to Planning. */
export function reopenAdoptingPlan(plan: ProductionPlan, input: { by: string; at: string; reason: string }) {
  revokeReusedRelease(plan, input);
  return clearReuse(plan, { ...input, reviewAgain: true });
}

/**
 * Explicit CPU command: adopt a previously approved composition authority AND commit the current-booking release that makes
 * it authoritative downstream, in a SINGLE repository transaction. The transaction guards that the exact authority generation
 * is still active and registers the adoption atomically, so an adoption can never commit behind a revocation, and a crash
 * leaves either the whole adoption or nothing. A replay of an adopted plan is a no-op.
 */
export async function applyReuseCommand(deps: ReuseOrchestrationDeps, input: { plan: ProductionPlan; storedPlan?: ProductionPlan; order: Order; actor: string; actorId: string; at: string; commandId?: string; syncPlanned?: () => Promise<Order | void> }) {
  const identity = compositionIdentity(input.order);
  if (!identity) throw Object.assign(new Error("This booking has no canonical sandwich composition, so a previous approval cannot be reused. Review it normally."), { status: 409, code: "CPU_ALLERGEN_REUSE_COMPOSITION_UNAVAILABLE" });
  const authority = await deps.store.get(identity.compositionId);
  const already = input.plan.reusedAllergenAuthority;
  if (already && authority && already.generation === authority.generation && authority.status === "active" && !authority.revocation && authority.reusedBy.some(item => item.orderId === input.plan.orderId && item.generation === authority.generation)) return { plan: input.plan, changed: false as const };
  const decision = evaluateReuse(input.order, input.plan, authority);
  if (!decision.ok || !authority) throw Object.assign(new Error(`The approved allergen authority cannot be reused (${decision.ok ? "authority_missing" : decision.reason}).`), { status: 409, code: `CPU_ALLERGEN_REUSE_${(decision.ok ? "authority_missing" : decision.reason).toUpperCase()}` });
  // ORDERING: the planned sync is a governed Hub transition that advances the Production Order version (and its source lineage).
  // It must complete BEFORE the release is built, otherwise the release is bound to the pre-transition order and can never
  // materialise (lineage mismatch). Everything below uses the order as it is AFTER the transition.
  const synced = input.syncPlanned ? await input.syncPlanned() : undefined;
  const order = (synced || input.order) as Order;
  const plan = applyReusedAuthority(input.plan, order, authority, { by: input.actor, at: input.at });
  plan.currentAllergenRelease = pendingReusedRelease(plan, order, input.at);
  plan.audit.push({ action: "allergen-reused-release-committed", at: input.at, by: input.actor, reason: `Release ${plan.currentAllergenRelease.releaseId} issued from reused authority generation ${authority.generation}; materialization follows the committed release.` });
  plan.updatedAt = input.at; plan.updatedBy = input.actor;
  const delivery = releaseMaterializationDelivery(plan, plan.currentAllergenRelease, order, input.at);
  let event: Awaited<ReturnType<ProductionPlanRepository["saveAndAppendCpuChange"]>>;
  try {
    event = await deps.plans.saveAndAppendCpuChange(plan, input.storedPlan?.updatedAt, {
      serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: "apply-reused-authority", actorId: input.actorId, changedAt: input.at,
      idempotencyKey: input.commandId || `allergen-reuse:${plan.orderId}:${plan.reusedAllergenAuthority!.authorityId}:${plan.reusedAllergenAuthority!.origin.releaseId}`,
      propagation: { sourceEntityId: plan.id, serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), sourceVersion: plan.audit.length, changedAt: input.at, changeType: "amended", order, logistics: false },
      deliveries: [delivery],
    }, { registerAdoption: { at: input.at, by: input.actor } });
  } catch (error) {
    if ((error as { code?: string }).code === "CPU_REUSED_AUTHORITY_INVALID") throw Object.assign(new Error("The approved allergen authority is no longer available for reuse. The booking needs a fresh allergen review."), { status: 409, code: "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED", cause: error });
    throw error;
  }
  if (event.duplicate) return { plan: event.plan || plan, changed: false as const, duplicate: true as const };
  await deps.emit({ order, plan, sequence: event.sequence, changeType: "apply-reused-authority", at: input.at });
  return { plan, changed: true as const, sequence: event.sequence, materializationDelivery: delivery };
}

export const AUTHORITY_REVOKED_ROUTE = "/api/internal/cpu-allergen-authority-revoked";
export const authorityRevocationEventId = (compositionId: string, generation: number) => `cpu-allergen-authority-revoked:${compositionId}:g${generation}`;
export type RevocationWork = { compositionId: string; generation: number; releaseId: string; actor: string; actorId: string; at: string; reason: string };

/** Idempotent: guarantees durable cascade work exists for a revoked generation (same event ID every time). */
export async function ensureRevocationWork(work: RevocationWork) {
  return enqueueCpuDelivery({ eventId: authorityRevocationEventId(work.compositionId, work.generation), sourceAggregateId: work.compositionId, sourceVersion: work.generation, occurredAt: work.at, consumer: "cpu-production", route: AUTHORITY_REVOKED_ROUTE, body: work });
}

/**
 * Per-adopter work, safe to run any number of times. The plan change is committed once (idempotent key), the invalidation
 * effects are at-least-once, and durable progress on the authority record makes the whole cascade observable.
 */
export async function reopenAdopter(deps: ReuseOrchestrationDeps, input: { compositionId: string; generation: number; orderId: string; actor: string; actorId: string; at: string; reason: string }) {
  const authority = await deps.store.get(input.compositionId);
  const progress = authority?.cascades?.[String(input.generation)]?.adopters[input.orderId];
  if (progress?.done) return;
  const stored = await deps.plans.get(input.orderId);
  const markDone = () => deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.generation, input.orderId, { done: true }, input.at));
  if (!stored) { await markDone(); return; }
  const order = await deps.loadOrder(input.orderId);
  const reusesGeneration = stored.reusedAllergenAuthority?.compositionId === input.compositionId && stored.reusedAllergenAuthority.generation === input.generation;
  // An adopter that does not reuse this generation and was never touched by this cascade needs no work and no invalidation.
  if (!reusesGeneration && progress === undefined) { await markDone(); return; }
  let plan = stored;
  let sequence = progress?.sequence;
  if (reusesGeneration) {
    // Record intent first so a crash between commit and bookkeeping still leads to the invalidation effects on retry.
    await deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.generation, input.orderId, { sequence: 0 }, input.at));
    plan = structuredClone(stored);
    reopenAdoptingPlan(plan, { by: input.actor, at: input.at, reason: input.reason });
    plan.updatedAt = input.at; plan.updatedBy = input.actor;
    const serviceDate = order?.serviceDate || order?.requiredBy?.slice(0, 10);
    if (!order || !serviceDate) throw Object.assign(new Error(`The canonical order for ${input.orderId} is unavailable; the cascade will retry.`), { status: 503 });
    const event = await deps.plans.saveAndAppendCpuChange(plan, stored.updatedAt, {
      serviceDate, entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: "allergen-authority-revoked", actorId: input.actorId, changedAt: input.at,
      idempotencyKey: `allergen-reuse-revoked:${input.orderId}:${input.compositionId}:g${input.generation}`,
      propagation: { sourceEntityId: plan.id, serviceDate, sourceVersion: plan.audit.length, changedAt: input.at, changeType: "amended", order, logistics: false },
    });
    sequence = event.sequence;
    if (event.duplicate && event.plan) plan = event.plan;
    await deps.store.mutate(input.compositionId, current => applyCascadeStep(current, input.generation, input.orderId, { sequence }, input.at));
  }
  // Invalidation effects (projections, review package, consumers) are idempotent per sequence and retried until marked done.
  if (order) await deps.emit({ order, plan, sequence: sequence || plan.audit.length, changeType: "allergen-authority-revoked", at: input.at });
  await markDone();
}

/**
 * Durable, retryable work behind one revoked authority generation. Safe to run repeatedly (outbox redelivery or reconciliation):
 * finished adopters are skipped, a failing adopter does not block the others, live adoption reservations hold completion open
 * (no new adopter can appear behind a completed cascade), and it throws until every adopter is non-authoritative.
 */
export async function processAuthorityRevocation(deps: ReuseOrchestrationDeps, input: RevocationWork) {
  const at = nowOf(deps);
  const authority = await deps.store.get(input.compositionId);
  const revokedGeneration = authority && (authority.generation > input.generation || (authority.generation === input.generation && authority.status === "revoked"));
  if (!authority || !revokedGeneration) return { status: "not_revoked" as const, failed: [] as string[] };
  // No adoption can commit behind a revoked generation (the repository guard rejects it), so this registry is final.
  const adopters = [...new Set(authority.reusedBy.filter(item => item.generation === input.generation).map(item => item.orderId))];
  const failed: string[] = [];
  for (const orderId of adopters) {
    try { await reopenAdopter(deps, { compositionId: input.compositionId, generation: input.generation, orderId, actor: input.actor, actorId: input.actorId, at: input.at, reason: input.reason }); } catch (error) { failed.push(`${orderId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (failed.length) throw Object.assign(new Error(`Allergen authority revocation cascade incomplete (${failed.length}/${adopters.length}): ${failed.join("; ")}`), { status: 502, code: "CPU_ALLERGEN_AUTHORITY_CASCADE_INCOMPLETE" });
  await deps.store.mutate(input.compositionId, current => applyCascadeComplete(current, input.generation, at, input.actor));
  return { status: "complete" as const, failed, adopters };
}

/**
 * The revocation clause an origin plan transition must carry so the authority is revoked IN THE SAME TRANSACTION as the plan
 * change that withdrew its signed approval. Returns undefined when the transition does not withdraw a stamped signed release,
 * or when only unrelated booking metadata changed (the approved matrix is what authority validity tracks).
 */
export function originRevocationClause(input: { before?: ProductionPlan["currentAllergenRelease"]; beforePlan?: ProductionPlan; plan: ProductionPlan; order: Order | undefined; actor: string; at: string; explicitReopen?: boolean }): AuthorityClause | undefined {
  const { before, plan } = input;
  if (!before || before.approvalMode === "reused_authority" || !before.compositionId || plan.currentAllergenRelease?.releaseId === before.releaseId) return undefined;
  if (!input.explicitReopen && !approvedMatrixChanged(input.beforePlan, plan, input.order)) return undefined;
  return { revoke: { compositionId: before.compositionId, releaseId: before.releaseId, at: input.at, by: input.actor, reason: input.explicitReopen ? "The signed allergen review that established this approved composition was reopened." : "The approved allergen matrix that established this composition changed after signing." } };
}

/**
 * After the origin transition committed (its revocation intent is already durable on the authority): make sure the cascade work
 * exists and attempt it inline. Nothing here is required for safety: reads fail closed on the revoked authority, `cascadePending`
 * lets the worker reconstruct the work, and a failure here only delays cleanup.
 */
export async function runCommittedRevocation(deps: ReuseOrchestrationDeps, clause: AuthorityClause | undefined) {
  const revoke = clause?.revoke;
  if (!revoke) return [] as string[];
  return cascadeAuthorityRevocation(deps, { compositionId: revoke.compositionId, releaseId: revoke.releaseId, actor: revoke.by, actorId: revoke.by, at: revoke.at, reason: revoke.reason });
}

/**
 * Revoke exactly the authority generation established by `releaseId` (idempotent: it is usually already revoked by the origin
 * transition), then (re)ensure durable cascade work, including on a retry against an already-revoked generation, and attempt it inline.
 */
export async function cascadeAuthorityRevocation(deps: ReuseOrchestrationDeps, input: { compositionId: string | undefined; releaseId: string; actor: string; actorId: string; at: string; reason: string }) {
  if (!input.compositionId) return [] as string[];
  const outcome = await deps.store.revokeByOrigin(input.compositionId, input.releaseId, input.at, input.actor, input.reason);
  if (!outcome.authority || outcome.generation === undefined) return [] as string[];
  const work: RevocationWork = { compositionId: input.compositionId, generation: outcome.generation, releaseId: input.releaseId, actor: input.actor, actorId: input.actorId, at: input.at, reason: input.reason };
  await ensureRevocationWork(work);
  try { await processAuthorityRevocation(deps, work); } catch (error) { console.error("[cpu-allergen-reuse] adopter cascade deferred to durable retry", { compositionId: input.compositionId, generation: outcome.generation, error: error instanceof Error ? error.message : String(error) }); }
  return outcome.authority.reusedBy.filter(item => item.generation === outcome.generation).map(item => item.orderId);
}

/**
 * Records the authority a signed release establishes. A conflicting approval revokes through the SAME durable path as any other
 * revocation. Safe to repeat.
 */
export async function recordSignedApproval(deps: Pick<ReuseOrchestrationDeps, "store">, plan: ProductionPlan, order: Order | undefined, at: string, by: string) {
  const candidate = signedAuthorityCandidate(plan, order, at, by);
  if (!candidate) return undefined;
  const outcome = await deps.store.recordApproval(candidate, at, by);
  if (outcome.change === "revoked_conflict" && outcome.authority.revocation) {
    await ensureRevocationWork({ compositionId: outcome.authority.compositionId, generation: outcome.authority.generation, releaseId: outcome.authority.revocation.releaseId, actor: by, actorId: by, at, reason: outcome.authority.revocation.reason });
  }
  return outcome;
}

/**
 * Reconciliation sweep: re-creates and runs cascade work for every revoked authority whose cascade is incomplete, so a lost
 * enqueue or a crashed worker is repaired without waiting for any other mutation. Bounded and idempotent.
 */
export async function reconcileAuthorityCascades(deps: ReuseOrchestrationDeps, limit = 25) {
  const pending = await deps.store.listCascadePending(limit);
  const results: Array<{ compositionId: string; generation: number; status: string }> = [];
  for (const authority of pending) {
    const at = nowOf(deps);
    const generations = [...authority.generations.map(item => item.generation), ...(authority.status === "revoked" ? [authority.generation] : [])].filter(generation => !authority.cascades?.[String(generation)]?.completedAt);
    for (const generation of generations) {
      const origin = generation === authority.generation ? authority.origin : authority.generations.find(item => item.generation === generation)!.origin;
      const revocation = generation === authority.generation ? authority.revocation : undefined;
      const work: RevocationWork = { compositionId: authority.compositionId, generation, releaseId: origin.releaseId, actor: revocation?.by || "system", actorId: revocation?.by || "system", at: revocation?.at || at, reason: revocation?.reason || "Reconciled revoked allergen authority." };
      await ensureRevocationWork(work);
      try { results.push({ compositionId: authority.compositionId, generation, status: (await processAuthorityRevocation(deps, work)).status }); } catch { results.push({ compositionId: authority.compositionId, generation, status: "retry" }); }
    }
  }
  return results;
}

/** Whether the approved matrix itself changed between two states of the same plan (not merely booking metadata). */
export function approvedMatrixChanged(before: ProductionPlan | undefined, after: ProductionPlan, order: Order | undefined) {
  if (!before || !order) return true;
  const was = captureApprovedMatrix(before, order)?.semanticHash;
  const now = captureApprovedMatrix(after, order)?.semanticHash;
  return !was || was !== now;
}

export { compositionIdentity };

/**
 * Worker-safe reconciliation step: for every revoked authority with an incomplete cascade, (re)create the idempotent durable
 * outbox work item. It needs no request context or order loading, so the long-lived worker runs it on every tick; the outbox
 * then delivers the work to the CPU internal route with its normal retry and backoff.
 */
export async function ensureCascadeWorkForPendingAuthorities(store: AllergenAuthorityStore, limit = 25, at = new Date().toISOString()) {
  const pending = await store.listCascadePending(limit);
  let ensured = 0;
  for (const authority of pending) {
    for (const generation of incompleteGenerations(authority)) {
      const origin = generation === authority.generation ? authority.origin : authority.generations.find(item => item.generation === generation)!.origin;
      const revocation = generation === authority.generation ? authority.revocation : undefined;
      await ensureRevocationWork({ compositionId: authority.compositionId, generation, releaseId: origin.releaseId, actor: revocation?.by || "system", actorId: revocation?.by || "system", at: revocation?.at || at, reason: revocation?.reason || "Reconciled revoked allergen authority." });
      ensured += 1;
    }
  }
  return ensured;
}
const incompleteGenerations = (authority: AllergenCompositionAuthority) => [...authority.generations.map(item => item.generation), ...(authority.status === "revoked" ? [authority.generation] : [])].filter(generation => !authority.cascades?.[String(generation)]?.completedAt);
