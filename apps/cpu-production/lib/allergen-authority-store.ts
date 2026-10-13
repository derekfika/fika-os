import type { AllergenCompositionAuthority } from "./allergen-composition";
import type { ProductionPlan } from "../app/lib/production-plan";
import { lineAwareMatrixChanged, reusedMatrixMismatch } from "./allergen-composition";
import { releaseMatrixMatchesPlan } from "./cpu-allergen-release";

export const ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION = "fikaCpuAllergenCompositionAuthoritiesV1";

type A = AllergenCompositionAuthority;
export type ApprovalOutcome = { authority: A; change: "created" | "unchanged" | "reactivated" | "revoked_conflict" };
export type RevocationOutcome = { authority?: A; changed: boolean; /** The generation whose origin release matched, if any. */ generation?: number };

/** Which generations (archived plus a revoked current one) still have an incomplete adopter cascade. */
export function incompleteCascadeGenerations(authority: A): number[] {
  const revoked = [...authority.generations.map(item => item.generation), ...(authority.status === "revoked" ? [authority.generation] : [])];
  return revoked.filter(generation => !authority.cascades?.[String(generation)]?.completedAt);
}
const withCascadePending = (authority: A): A => ({ ...authority, cascadePending: incompleteCascadeGenerations(authority).length > 0 });

function revokeCurrent(existing: A, at: string, by: string, reason: string): A {
  const next = structuredClone(existing);
  next.status = "revoked";
  next.revocation = { generation: existing.generation, releaseId: existing.origin.releaseId, at, by, reason };
  next.history.push({ action: "revoked", at, by, reason, releaseId: existing.origin.releaseId, generation: existing.generation });
  return withCascadePending(next);
}

/** Pure transition: how a newly signed approval combines with what is stored. First approval wins; a re-approval is a NEW generation. */
export function applyApproval(existing: A | undefined, candidate: A, at: string, by: string): ApprovalOutcome {
  if (!existing) return { authority: structuredClone({ ...candidate, generation: 1, cascadePending: false }), change: "created" };
  if (existing.origin.releaseId === candidate.origin.releaseId || existing.generations.some(item => item.origin.releaseId === candidate.origin.releaseId)) return { authority: structuredClone(existing), change: "unchanged" };
  if (existing.status === "active") {
    if (existing.matrixSemanticHash === candidate.matrixSemanticHash) return { authority: structuredClone(existing), change: "unchanged" };
    // Two independent signed reviews disagree on the same composition: neither may be reused until a human reconciles them.
    return { authority: revokeCurrent(existing, at, by, "Conflicting signed approval for the same composition."), change: "revoked_conflict" };
  }
  const next = structuredClone(existing);
  next.generations.push({ generation: existing.generation, origin: existing.origin, matrixSemanticHash: existing.matrixSemanticHash, approvedAt: existing.history.find(item => item.generation === existing.generation && (item.action === "approved" || item.action === "re-approved"))?.at || existing.createdAt, revokedAt: existing.revocation?.at || at, reason: existing.revocation?.reason || "revoked" });
  next.generation = existing.generation + 1;
  next.origin = structuredClone(candidate.origin);
  next.approvedMatrix = structuredClone(candidate.approvedMatrix);
  next.matrixSemanticHash = candidate.matrixSemanticHash;
  next.status = "active";
  next.revocation = undefined;
  next.history.push({ action: "re-approved", at, by, releaseId: candidate.origin.releaseId, generation: next.generation });
  return { authority: withCascadePending(next), change: "reactivated" };
}

/** Pure transition: revoke the generation established by the given origin release. Already-revoked generations are reported, not silently ignored. */
export function applyOriginRevocation(existing: A | undefined, releaseId: string, at: string, by: string, reason: string): RevocationOutcome {
  if (!existing) return { changed: false };
  if (existing.origin.releaseId === releaseId) {
    if (existing.status === "active") return { authority: revokeCurrent(existing, at, by, reason), changed: true, generation: existing.generation };
    return { authority: existing, changed: false, generation: existing.generation };
  }
  const archived = existing.generations.find(item => item.origin.releaseId === releaseId);
  return archived ? { authority: existing, changed: false, generation: archived.generation } : { authority: existing, changed: false };
}

/** Pure: one adopter's cascade progress for a generation. Idempotent; returns the same object when nothing changes. */
export function applyCascadeStep(existing: A, generation: number, orderId: string, patch: { sequence?: number; done?: boolean }, at: string): A {
  const key = String(generation);
  const step = existing.cascades?.[key]?.adopters[orderId];
  if (step && (patch.sequence === undefined || step.sequence === patch.sequence) && (!patch.done || step.done)) return existing;
  const next = structuredClone(existing);
  next.cascades = next.cascades || {};
  const target = (next.cascades[key] = next.cascades[key] || { startedAt: at, adopters: {} });
  target.adopters[orderId] = { ...target.adopters[orderId], ...(patch.sequence !== undefined ? { sequence: patch.sequence } : {}), ...(patch.done ? { done: true, doneAt: at } : {}) };
  return next;
}
/** Pure: marks a generation's cascade complete once, and clears cascadePending when nothing else is outstanding. */
export function applyCascadeComplete(existing: A, generation: number, at: string, by: string): A {
  const key = String(generation);
  if (existing.cascades?.[key]?.completedAt) return existing;
  const next = structuredClone(existing);
  next.cascades = next.cascades || {};
  const target = (next.cascades[key] = next.cascades[key] || { startedAt: at, adopters: {} });
  target.completedAt = at;
  next.history.push({ action: "cascade-completed", at, by, generation, reason: "Every adopting booking of this generation was made non-authoritative." });
  return withCascadePending(next);
}

// ------------------------------------------------------------------------------------------------------------------------------
// Transactional authority clause. These pure functions are evaluated INSIDE the plan repository's transaction, in the same
// consistency domain as the plan write and the CPU change event. That is what makes shared-authority validity part of canonical
// CPU state instead of an optional read guard.
// ------------------------------------------------------------------------------------------------------------------------------

/** What a caller may ask the repository to do to an authority atomically with a plan transition. */
export type AuthorityClause = {
  /** Adoption: register the plan's order as a committed adopter of the generation the plan is bound to. Allowed only while that generation is active. */
  registerAdoption?: { at: string; by: string };
  /** Origin mutation: revoke the generation established by this signed release, in the same transaction as the plan change. */
  revoke?: { compositionId: string; releaseId: string; at: string; by: string; reason: string };
};

export type PlanAuthorityRequirement = { compositionId: string; generation: number; originReleaseId: string; matrixSemanticHash: string; orderId: string; lineBindings: Record<string, string> };
/**
 * Whether persisting this plan would make a reused authority authoritative. True for any persisted reused `planned` plan or any
 * reused release that is `pending` or `current`. A reused release without provenance is also "requiring" and can never pass.
 */
export function authorityRequirementOf(plan: ProductionPlan): PlanAuthorityRequirement | "unbound" | undefined {
  const release = plan.currentAllergenRelease;
  const reusedRelease = release?.approvalMode === "reused_authority" && (release.status === "pending" || release.status === "current");
  const reuse = plan.reusedAllergenAuthority;
  if (!reusedRelease && !(reuse && plan.status === "planned")) return undefined;
  if (!reuse) return "unbound";
  return { compositionId: reuse.compositionId, generation: reuse.generation, originReleaseId: reuse.origin.releaseId, matrixSemanticHash: reuse.matrixSemanticHash, orderId: plan.orderId, lineBindings: reuse.lineBindings };
}

export class AuthorityGuardFailure extends Error {
  readonly status = 409;
  constructor(readonly code: string, message: string) { super(message); this.name = "AuthorityGuardFailure"; }
}

/** Compare-and-set check of a requirement against the stored authority. Pure. */
export function checkRequirement(current: A | undefined, requirement: PlanAuthorityRequirement, allowRegistration: boolean): { ok: true; register: boolean } | { ok: false; reason: string } {
  if (!current) return { ok: false, reason: "authority_missing" };
  if (current.compositionId !== requirement.compositionId) return { ok: false, reason: "composition_mismatch" };
  if (current.status !== "active" || current.revocation) return { ok: false, reason: "authority_revoked" };
  if (current.generation !== requirement.generation) return { ok: false, reason: "generation_mismatch" };
  if (current.origin.releaseId !== requirement.originReleaseId) return { ok: false, reason: "origin_release_mismatch" };
  if (current.matrixSemanticHash !== requirement.matrixSemanticHash) return { ok: false, reason: "matrix_hash_mismatch" };
  const registered = current.reusedBy.some(entry => entry.orderId === requirement.orderId && entry.generation === requirement.generation);
  if (!registered && !allowRegistration) return { ok: false, reason: "adoption_not_registered" };
  return { ok: true, register: !registered };
}

const PERSISTED_RELEASE_STATUSES = ["pending", "current"];

/**
 * Origin invariant. If the stamped SIGNED release that backs a shared authority is removed, revoked, replaced or reopened, or
 * the approved matrix it backs changes, the authority must be revoked in the same transaction. Derived here from the
 * previous and proposed persisted states, so it does not depend on any caller remembering a clause. Quantity, date, customer,
 * headcount, names and other non-allergen changes never require a revocation.
 */
export function originRevocationRequired(previous: ProductionPlan | undefined, proposed: ProductionPlan): { compositionId: string; releaseId: string; at: string; by: string; reason: string } | undefined {
  const prior = previous?.currentAllergenRelease;
  if (!previous || !prior || prior.approvalMode === "reused_authority" || !prior.compositionId || !PERSISTED_RELEASE_STATUSES.includes(prior.status)) return undefined;
  const next = proposed.currentAllergenRelease;
  const stillBacking = Boolean(next && next.releaseId === prior.releaseId && PERSISTED_RELEASE_STATUSES.includes(next.status));
  const matrixChanged = lineAwareMatrixChanged(previous.menuItems, proposed.menuItems);
  if (stillBacking && !matrixChanged) return undefined;
  return { compositionId: prior.compositionId, releaseId: prior.releaseId, at: proposed.updatedAt, by: proposed.updatedBy, reason: stillBacking ? "The approved allergen matrix that established this composition changed after signing." : "The signed allergen release that established this approved composition was removed, revoked or reopened." };
}

/**
 * Evaluates the whole clause for one plan write against the authority documents read in the transaction. Returns the documents
 * to write, or throws {@link AuthorityGuardFailure} so the transaction aborts before anything is written.
 *
 * For any persisted reused `planned` plan or `pending`/`current` reused release it verifies the STATE BEING PERSISTED, not only
 * its copied provenance: composition, generation, origin release and matrix hash against the authority, the persisted plan matrix
 * against the authority matrix, the release matrix against the plan matrix, the release binding, and the adopter registration.
 */
export function evaluateAuthorityTransition(read: Map<string, A | undefined>, plan: ProductionPlan, clause?: AuthorityClause, previous?: ProductionPlan): Map<string, A> {
  const writes = new Map<string, A>();
  const get = (id: string) => (writes.has(id) ? writes.get(id) : read.get(id));
  const revocations = [clause?.revoke, originRevocationRequired(previous, plan)].filter((item): item is NonNullable<typeof item> => Boolean(item));
  for (const revoke of revocations) {
    const outcome = applyOriginRevocation(get(revoke.compositionId), revoke.releaseId, revoke.at, revoke.by, revoke.reason);
    if (outcome.changed && outcome.authority) writes.set(revoke.compositionId, outcome.authority);
  }
  const requirement = authorityRequirementOf(plan);
  if (requirement === "unbound") throw new AuthorityGuardFailure("CPU_REUSED_AUTHORITY_INVALID", "A reused allergen release cannot be persisted without its authority-generation binding.");
  if (requirement) {
    const current = get(requirement.compositionId);
    const verdict = checkRequirement(current, requirement, Boolean(clause?.registerAdoption));
    if (!verdict.ok) throw new AuthorityGuardFailure("CPU_REUSED_AUTHORITY_INVALID", `The reused allergen authority is not valid at commit time (${verdict.reason}).`);
    // Line-aware: each canonical line's own reviewed sub-items must equal ITS approved entry, so statements cannot be moved between lines.
    const mismatch = reusedMatrixMismatch(plan.menuItems, requirement.lineBindings, current!.approvedMatrix);
    if (mismatch) throw new AuthorityGuardFailure("CPU_REUSED_AUTHORITY_INVALID", `The persisted plan matrix does not match the approved authority matrix (${mismatch}).`);
    // The line bindings are fixed at adoption; a later write of the same generation may not re-associate lines.
    const priorReuse = previous?.reusedAllergenAuthority;
    if (priorReuse && priorReuse.compositionId === requirement.compositionId && priorReuse.generation === requirement.generation && JSON.stringify(priorReuse.lineBindings || {}) !== JSON.stringify(requirement.lineBindings)) throw new AuthorityGuardFailure("CPU_REUSED_AUTHORITY_INVALID", "The canonical line bindings of an adopted authority are immutable (line_bindings_changed).");
    const release = plan.currentAllergenRelease;
    if (release?.approvalMode === "reused_authority" && PERSISTED_RELEASE_STATUSES.includes(release.status)) {
      const bound = release.reusedAuthority;
      if (!bound || bound.compositionId !== requirement.compositionId || bound.generation !== requirement.generation || bound.origin.releaseId !== requirement.originReleaseId || bound.matrixSemanticHash !== requirement.matrixSemanticHash) throw new AuthorityGuardFailure("CPU_REUSED_AUTHORITY_INVALID", "The reused release is not bound to the same authority generation (release_binding_mismatch).");
      if (!releaseMatrixMatchesPlan(release.matrix, plan.menuItems)) throw new AuthorityGuardFailure("CPU_REUSED_AUTHORITY_INVALID", "The reused release matrix does not match the persisted plan matrix (release_matrix_mismatch).");
    }
    if (verdict.register && clause?.registerAdoption && current) {
      const next = structuredClone(current);
      next.reusedBy.push({ orderId: requirement.orderId, generation: requirement.generation, at: clause.registerAdoption.at, by: clause.registerAdoption.by });
      next.history.push({ action: "reused", at: clause.registerAdoption.at, by: clause.registerAdoption.by, reason: `Adopted by ${requirement.orderId}.`, generation: requirement.generation });
      writes.set(requirement.compositionId, next);
    }
  }
  return writes;
}

/** The authority documents a plan write must read inside its transaction. */
export function authorityIdsFor(plan: ProductionPlan, clause?: AuthorityClause, previous?: ProductionPlan): string[] {
  const requirement = authorityRequirementOf(plan);
  const origin = originRevocationRequired(previous, plan);
  return [...new Set([clause?.revoke?.compositionId, origin?.compositionId, requirement && requirement !== "unbound" ? requirement.compositionId : undefined].filter((id): id is string => Boolean(id)))];
}

export type AllergenAuthorityStore = {
  get(compositionId: string): Promise<A | undefined>;
  recordApproval(candidate: A, at: string, by: string): Promise<ApprovalOutcome>;
  revokeByOrigin(compositionId: string, releaseId: string, at: string, by: string, reason: string): Promise<RevocationOutcome>;
  /** Atomic read-modify-write; the mutator must be pure and idempotent. */
  mutate(compositionId: string, mutator: (current: A) => A): Promise<A | undefined>;
  /** Revoked authorities that still have an incomplete adopter cascade (bounded). */
  listCascadePending(limit: number): Promise<A[]>;
};

/** One transactional primitive; memory and Firestore share every state transition above. */
abstract class TransactionalStore implements AllergenAuthorityStore {
  protected abstract transact<T>(id: string, fn: (current: A | undefined) => { next?: A; result: T }): Promise<T>;
  abstract get(id: string): Promise<A | undefined>;
  abstract listCascadePending(limit: number): Promise<A[]>;
  recordApproval(candidate: A, at: string, by: string) {
    return this.transact(candidate.compositionId, current => { const outcome = applyApproval(current, candidate, at, by); return { next: outcome.change === "unchanged" ? undefined : outcome.authority, result: outcome }; });
  }
  revokeByOrigin(id: string, releaseId: string, at: string, by: string, reason: string) {
    return this.transact(id, current => { const outcome = applyOriginRevocation(current, releaseId, at, by, reason); return { next: outcome.changed ? outcome.authority : undefined, result: outcome }; });
  }
  mutate(id: string, mutator: (current: A) => A) {
    return this.transact(id, current => { if (!current) return { result: undefined }; const next = mutator(structuredClone(current)); return { next: next !== current && JSON.stringify(next) !== JSON.stringify(current) ? next : undefined, result: structuredClone(next) as A | undefined }; });
  }
}

class MemoryAllergenAuthorityStore extends TransactionalStore {
  readonly records = new Map<string, A>();
  /** Test seam: throw to simulate a store outage. */
  failWith?: Error;
  protected async transact<T>(id: string, fn: (current: A | undefined) => { next?: A; result: T }) {
    if (this.failWith) throw this.failWith;
    const current = this.records.get(id);
    const { next, result } = fn(current ? structuredClone(current) : undefined);
    if (next) this.records.set(id, structuredClone(next));
    return result;
  }
  async get(id: string) { if (this.failWith) throw this.failWith; const record = this.records.get(id); return record ? structuredClone(record) : undefined; }
  async listCascadePending(limit: number) { if (this.failWith) throw this.failWith; return [...this.records.values()].filter(record => record.cascadePending).slice(0, limit).map(record => structuredClone(record)); }
}

class FirestoreAllergenAuthorityStore extends TransactionalStore {
  private async ref(id: string) { const { db } = await import("./firebase-admin"); return { db, doc: db.collection(ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION).doc(id) }; }
  async get(id: string) { const { doc } = await this.ref(id); const snapshot = await doc.get(); return snapshot.exists ? snapshot.data() as A : undefined; }
  protected async transact<T>(id: string, fn: (current: A | undefined) => { next?: A; result: T }) {
    const { db, doc } = await this.ref(id);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(doc);
      const { next, result } = fn(snapshot.exists ? snapshot.data() as A : undefined);
      if (next) transaction.set(doc, next);
      return result;
    });
  }
  async listCascadePending(limit: number) {
    const { db } = await import("./firebase-admin");
    const snapshot = await db.collection(ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION).where("cascadePending", "==", true).limit(Math.max(1, Math.min(limit, 50))).get();
    return snapshot.docs.map(doc => doc.data() as A);
  }
}

/** Test/diagnostic seam: always the Firestore-backed store, regardless of runtime mode. */
export const createFirestoreAllergenAuthorityStore = (): AllergenAuthorityStore => new FirestoreAllergenAuthorityStore();
const memoryStore = new MemoryAllergenAuthorityStore();
export const memoryAllergenAuthorityStore = memoryStore;
export function createAllergenAuthorityStore(): AllergenAuthorityStore {
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory") return memoryStore;
  return new FirestoreAllergenAuthorityStore();
}
