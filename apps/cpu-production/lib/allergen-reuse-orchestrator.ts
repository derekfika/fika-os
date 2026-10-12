import type { MatrixArtifact, ProductionPlan } from "../app/lib/production-plan";
import { matrixSignatureScope } from "../app/lib/production-plan";
import { buildReusedCpuAllergenRelease, allergenMatrixContentHash, revokeCpuAllergenRelease } from "./cpu-allergen-release";
import { releaseMaterializationDelivery } from "./cpu-retry-materialization";
import { applyReusedAuthority, captureApprovedMatrix, clearReuse, compositionIdentity, evaluateReuse, type AllergenCompositionAuthority, type CompositionOrder } from "./allergen-composition";
import { signedAuthorityCandidate } from "./allergen-reuse-service";
import { enqueueCpuDelivery } from "./cpu-durable-outbox";
import { ADOPTION_LEASE_MS, applyCascadeComplete, applyCascadeStep, applyExpirePendingAdoptions, livePendingAdopters, type AllergenAuthorityStore } from "./allergen-authority-store";
import type { ProductionPlanRepository } from "./production-plan-repository";
import type { ProductionOrder } from "./production-types";

/**
 * State model (see allergen-composition / allergen-authority-store):
 *
 *   authority (per composition) = generation N, status active|revoked, revocation intent, adopter registry, per-generation cascade
 *   adopter plan                = reusedAllergenAuthority { composition, generation, origin release, matrix hash } + reused release
 *
 * Adoption:  beginAdoption (atomic active/generation check + leased reservation)  ->  commit plan + release  ->  finalizeAdoption (CAS)
 *            A failed finalize compensates (the plan is reopened through the normal change path).
 * Revocation: revokeByOrigin (atomic: status revoked + revocation intent + cascadePending)  ->  durable outbox work  ->
 *            per-adopter reopen (idempotent change event + at-least-once invalidation)  ->  cascade complete (only with no live pending adopters).
 *            A reconciliation sweep re-creates the work for any revoked authority whose cascade is incomplete.
 * Every read path validates through allergen-reuse-service `validateReusedApproval` and fails closed.
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
  return clearReuse(plan, input);
}

/**
 * Explicit CPU command: adopt a previously approved composition authority AND commit the current-booking release that makes
 * it authoritative downstream. Adoption is bound to an exact authority generation and reserved atomically, so it can never
 * commit behind a revocation; a replay of an adopted plan is a no-op.
 */
export async function applyReuseCommand(deps: ReuseOrchestrationDeps, input: { plan: ProductionPlan; storedPlan?: ProductionPlan; order: Order; actor: string; actorId: string; at: string; commandId?: string; syncPlanned?: () => Promise<void> }) {
  const identity = compositionIdentity(input.order);
  if (!identity) throw Object.assign(new Error("This booking has no canonical sandwich composition, so a previous approval cannot be reused. Review it normally."), { status: 409, code: "CPU_ALLERGEN_REUSE_COMPOSITION_UNAVAILABLE" });
  const authority = await deps.store.get(identity.compositionId);
  const already = input.plan.reusedAllergenAuthority;
  if (already && authority && already.generation === authority.generation && authority.status === "active" && authority.reusedBy.some(item => item.orderId === input.plan.orderId && item.generation === authority.generation && item.state === "committed")) return { plan: input.plan, changed: false as const };
  const decision = evaluateReuse(input.order, input.plan, authority);
  if (!decision.ok || !authority) throw Object.assign(new Error(`The approved allergen authority cannot be reused (${decision.ok ? "authority_missing" : decision.reason}).`), { status: 409, code: `CPU_ALLERGEN_REUSE_${(decision.ok ? "authority_missing" : decision.reason).toUpperCase()}` });
  // 1. Atomic reservation: only succeeds while this exact generation is active and not being revoked.
  const reserved = await deps.store.beginAdoption(authority.compositionId, { generation: authority.generation, releaseId: authority.origin.releaseId, matrixSemanticHash: authority.matrixSemanticHash }, input.plan.orderId, input.at, input.actor, new Date(Date.parse(input.at) + ADOPTION_LEASE_MS).toISOString());
  if (!reserved.ok) throw Object.assign(new Error(`The approved allergen authority is no longer available for reuse (${reserved.reason}).`), { status: 409, code: `CPU_ALLERGEN_REUSE_${reserved.reason.toUpperCase()}` });
  // 2. Commit the adopted plan and its generation-bound release through the normal CPU change path.
  const plan = applyReusedAuthority(input.plan, input.order, reserved.authority, { by: input.actor, at: input.at });
  plan.currentAllergenRelease = pendingReusedRelease(plan, input.order, input.at);
  plan.audit.push({ action: "allergen-reused-release-committed", at: input.at, by: input.actor, reason: `Release ${plan.currentAllergenRelease.releaseId} issued from reused authority generation ${reserved.authority.generation}; materialization follows the committed release.` });
  try {
    if (input.syncPlanned) await input.syncPlanned();
    plan.updatedAt = input.at; plan.updatedBy = input.actor;
    const delivery = releaseMaterializationDelivery(plan, plan.currentAllergenRelease, input.order, input.at);
    const event = await deps.plans.saveAndAppendCpuChange(plan, input.storedPlan?.updatedAt, {
      serviceDate: input.order.serviceDate || input.order.requiredBy.slice(0, 10), entityType: "productionPlan", entityId: plan.id, revision: plan.audit.length, changeType: "apply-reused-authority", actorId: input.actorId, changedAt: input.at,
      idempotencyKey: input.commandId || `allergen-reuse:${plan.orderId}:${plan.reusedAllergenAuthority!.authorityId}:${plan.reusedAllergenAuthority!.origin.releaseId}`,
      propagation: { sourceEntityId: plan.id, serviceDate: input.order.serviceDate || input.order.requiredBy.slice(0, 10), sourceVersion: plan.audit.length, changedAt: input.at, changeType: "amended", order: input.order, logistics: false },
      deliveries: [delivery],
    });
    if (event.duplicate) return { plan: event.plan || plan, changed: false as const, duplicate: true as const };
    // 3. Compare-and-set finalize. If the generation was revoked meanwhile, compensate through the same cascade machinery.
    const finalized = await deps.store.finalizeAdoption(authority.compositionId, reserved.authority.generation, plan.orderId, input.at);
    if (!finalized) {
      await reopenAdopter(deps, { compositionId: authority.compositionId, generation: reserved.authority.generation, orderId: plan.orderId, actor: input.actor, actorId: input.actorId, at: input.at, reason: "The shared allergen authority was revoked while this adoption was being committed." });
      throw Object.assign(new Error("The approved allergen authority was revoked while it was being applied. The booking needs a fresh allergen review."), { status: 409, code: "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED" });
    }
    await deps.emit({ order: input.order, plan, sequence: event.sequence, changeType: "apply-reused-authority", at: input.at });
    return { plan, changed: true as const, sequence: event.sequence, materializationDelivery: delivery };
  } catch (error) {
    // Nothing was committed (or it was compensated): release the reservation so it cannot block a revocation cascade.
    if ((error as { code?: string }).code !== "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED") await deps.store.cancelAdoption(authority.compositionId, reserved.authority.generation, plan.orderId).catch(() => undefined);
    throw error;
  }
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
  let authority = await deps.store.get(input.compositionId);
  const revokedGeneration = authority && (authority.generation > input.generation || (authority.generation === input.generation && authority.status === "revoked"));
  if (!authority || !revokedGeneration) return { status: "not_revoked" as const, failed: [] as string[] };
  // Abandoned reservations are cancelled; live ones keep the cascade open until they finalize (and are then compensated) or expire.
  authority = (await deps.store.mutate(input.compositionId, current => applyExpirePendingAdoptions(current, input.generation, at))) || authority;
  const live = livePendingAdopters(authority, input.generation, at);
  const adopters = [...new Set(authority.reusedBy.filter(item => item.generation === input.generation).map(item => item.orderId))];
  const failed: string[] = [];
  for (const orderId of adopters) {
    try { await reopenAdopter(deps, { compositionId: input.compositionId, generation: input.generation, orderId, actor: input.actor, actorId: input.actorId, at: input.at, reason: input.reason }); } catch (error) { failed.push(`${orderId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (live.length) failed.push(...live.map(item => `${item.orderId}: adoption reservation still pending until ${item.leaseUntil}`));
  if (failed.length) throw Object.assign(new Error(`Allergen authority revocation cascade incomplete (${failed.length}/${adopters.length}): ${failed.join("; ")}`), { status: 502, code: "CPU_ALLERGEN_AUTHORITY_CASCADE_INCOMPLETE" });
  await deps.store.mutate(input.compositionId, current => applyCascadeComplete(current, input.generation, at, input.actor));
  return { status: "complete" as const, failed, adopters };
}

/**
 * Revoke exactly the authority generation established by `releaseId`, using the composition stamped on the signed release (NOT
 * the origin booking's current composition). The revocation intent is atomic with the status change; durable cascade work is
 * (re)ensured on every call, including a retry against an already-revoked generation, then attempted inline.
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
