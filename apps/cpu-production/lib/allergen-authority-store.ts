import type { AllergenCompositionAuthority } from "./allergen-composition";

export const ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION = "fikaCpuAllergenCompositionAuthoritiesV1";
/** How long a pending adoption reservation blocks cascade completion before it is treated as abandoned. */
export const ADOPTION_LEASE_MS = 5 * 60 * 1000;

type A = AllergenCompositionAuthority;
export type ApprovalOutcome = { authority: A; change: "created" | "unchanged" | "reactivated" | "revoked_conflict" };
export type RevocationOutcome = { authority?: A; changed: boolean; /** The generation whose origin release matched, if any. */ generation?: number };
export type AdoptionExpectation = { generation: number; releaseId: string; matrixSemanticHash: string };
export type BeginAdoptionOutcome = { ok: true; authority: A } | { ok: false; reason: "authority_missing" | "authority_revoked" | "generation_mismatch" | "adoption_cancelled" };

/** Which generations (archived plus a revoked current one) still have an incomplete adopter cascade. */
export function incompleteCascadeGenerations(authority: A): number[] {
  const revoked = [...authority.generations.map(item => item.generation), ...(authority.status === "revoked" ? [authority.generation] : [])];
  return revoked.filter(generation => !authority.cascades?.[String(generation)]?.completedAt);
}
const withCascadePending = (authority: A): A => ({ ...authority, cascadePending: incompleteCascadeGenerations(authority).length > 0 });

function revokeCurrent(existing: A, at: string, by: string, reason: string, history: string): A {
  const next = structuredClone(existing);
  next.status = "revoked";
  next.revocation = { generation: existing.generation, releaseId: existing.origin.releaseId, at, by, reason };
  next.history.push({ action: "revoked", at, by, reason: history, releaseId: existing.origin.releaseId, generation: existing.generation });
  return withCascadePending(next);
}

/** Pure transition: how a newly signed approval combines with what is stored. First approval wins; a re-approval is a NEW generation. */
export function applyApproval(existing: A | undefined, candidate: A, at: string, by: string): ApprovalOutcome {
  if (!existing) return { authority: structuredClone({ ...candidate, generation: 1, cascadePending: false }), change: "created" };
  if (existing.origin.releaseId === candidate.origin.releaseId || existing.generations.some(item => item.origin.releaseId === candidate.origin.releaseId)) return { authority: structuredClone(existing), change: "unchanged" };
  if (existing.status === "active") {
    if (existing.matrixSemanticHash === candidate.matrixSemanticHash) return { authority: structuredClone(existing), change: "unchanged" };
    // Two independent signed reviews disagree on the same composition: neither may be reused until a human reconciles them.
    return { authority: revokeCurrent(existing, at, by, "Conflicting signed approval for the same composition.", "Conflicting signed approval for the same composition."), change: "revoked_conflict" };
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
    if (existing.status === "active") return { authority: revokeCurrent(existing, at, by, reason, reason), changed: true, generation: existing.generation };
    return { authority: existing, changed: false, generation: existing.generation };
  }
  const archived = existing.generations.find(item => item.origin.releaseId === releaseId);
  return archived ? { authority: existing, changed: false, generation: archived.generation } : { authority: existing, changed: false };
}

/** Pure: atomically reserve an adoption. Refused unless the authority is active, un-revoked, and exactly the expected generation. */
export function applyBeginAdoption(existing: A | undefined, expect: AdoptionExpectation, orderId: string, at: string, by: string, leaseUntil: string): { next?: A; outcome: BeginAdoptionOutcome } {
  if (!existing) return { outcome: { ok: false, reason: "authority_missing" } };
  if (existing.status !== "active" || existing.revocation) return { outcome: { ok: false, reason: "authority_revoked" } };
  if (existing.generation !== expect.generation || existing.origin.releaseId !== expect.releaseId || existing.matrixSemanticHash !== expect.matrixSemanticHash) return { outcome: { ok: false, reason: "generation_mismatch" } };
  const entry = existing.reusedBy.find(item => item.orderId === orderId && item.generation === expect.generation);
  if (entry?.state === "cancelled") return { outcome: { ok: false, reason: "adoption_cancelled" } };
  if (entry?.state === "committed") return { outcome: { ok: true, authority: existing } };
  const next = structuredClone(existing);
  if (entry) next.reusedBy = next.reusedBy.map(item => (item === entry ? { ...item, leaseUntil } : item));
  else next.reusedBy.push({ orderId, generation: expect.generation, state: "pending", at, by, leaseUntil });
  return { next, outcome: { ok: true, authority: next } };
}

/** Pure compare-and-set: pending -> committed, only while the generation is still current and active. */
export function applyFinalizeAdoption(existing: A | undefined, generation: number, orderId: string, at: string): { next?: A; ok: boolean } {
  if (!existing || existing.status !== "active" || existing.revocation || existing.generation !== generation) return { ok: false };
  const entry = existing.reusedBy.find(item => item.orderId === orderId && item.generation === generation);
  if (!entry || entry.state === "cancelled") return { ok: false };
  if (entry.state === "committed") return { ok: true };
  const next = structuredClone(existing);
  next.reusedBy = next.reusedBy.map(item => (item.orderId === orderId && item.generation === generation ? { orderId, generation, state: "committed" as const, at: item.at, by: item.by } : item));
  next.history.push({ action: "reused", at, by: entry.by, reason: `Adopted by ${orderId}.`, generation });
  return { next, ok: true };
}

/** Pure: cancel a reservation (abandoned or compensated). Committed adoptions are untouched. */
export function applyCancelAdoption(existing: A, generation: number, orderId: string): A {
  if (!existing.reusedBy.some(item => item.orderId === orderId && item.generation === generation && item.state === "pending")) return existing;
  const next = structuredClone(existing);
  next.reusedBy = next.reusedBy.map(item => (item.orderId === orderId && item.generation === generation && item.state === "pending" ? { ...item, state: "cancelled" as const, leaseUntil: undefined } : item));
  return next;
}

/** Pending reservations whose lease has expired are abandoned; live ones block cascade completion. */
export function applyExpirePendingAdoptions(existing: A, generation: number, now: string): A {
  if (!existing.reusedBy.some(item => item.generation === generation && item.state === "pending" && (item.leaseUntil || "") <= now)) return existing;
  const next = structuredClone(existing);
  next.reusedBy = next.reusedBy.map(item => (item.generation === generation && item.state === "pending" && (item.leaseUntil || "") <= now ? { ...item, state: "cancelled" as const, leaseUntil: undefined } : item));
  return next;
}
export const livePendingAdopters = (authority: A, generation: number, now: string) => authority.reusedBy.filter(item => item.generation === generation && item.state === "pending" && (item.leaseUntil || "") > now);

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

export type AllergenAuthorityStore = {
  get(compositionId: string): Promise<A | undefined>;
  recordApproval(candidate: A, at: string, by: string): Promise<ApprovalOutcome>;
  revokeByOrigin(compositionId: string, releaseId: string, at: string, by: string, reason: string): Promise<RevocationOutcome>;
  beginAdoption(compositionId: string, expect: AdoptionExpectation, orderId: string, at: string, by: string, leaseUntil: string): Promise<BeginAdoptionOutcome>;
  finalizeAdoption(compositionId: string, generation: number, orderId: string, at: string): Promise<boolean>;
  cancelAdoption(compositionId: string, generation: number, orderId: string): Promise<void>;
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
  beginAdoption(id: string, expect: AdoptionExpectation, orderId: string, at: string, by: string, leaseUntil: string) {
    return this.transact(id, current => { const { next, outcome } = applyBeginAdoption(current, expect, orderId, at, by, leaseUntil); return { next, result: outcome }; });
  }
  finalizeAdoption(id: string, generation: number, orderId: string, at: string) {
    return this.transact(id, current => { const { next, ok } = applyFinalizeAdoption(current, generation, orderId, at); return { next, result: ok }; });
  }
  async cancelAdoption(id: string, generation: number, orderId: string) {
    await this.transact(id, current => { const next = current ? applyCancelAdoption(current, generation, orderId) : undefined; return { next: next && next !== current ? next : undefined, result: undefined }; });
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

const memoryStore = new MemoryAllergenAuthorityStore();
export const memoryAllergenAuthorityStore = memoryStore;
export function createAllergenAuthorityStore(): AllergenAuthorityStore {
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory") return memoryStore;
  return new FirestoreAllergenAuthorityStore();
}
