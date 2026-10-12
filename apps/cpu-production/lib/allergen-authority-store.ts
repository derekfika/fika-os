import type { AllergenCompositionAuthority } from "./allergen-composition";

export const ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION = "fikaCpuAllergenCompositionAuthoritiesV1";

export type ApprovalOutcome = { authority: AllergenCompositionAuthority; change: "created" | "unchanged" | "reactivated" | "revoked_conflict" };

/** Pure transition: how a newly signed approval for a composition combines with what is already stored. First approval wins. */
export function applyApproval(existing: AllergenCompositionAuthority | undefined, candidate: AllergenCompositionAuthority, at: string, by: string): ApprovalOutcome {
  if (!existing) return { authority: structuredClone(candidate), change: "created" };
  const next = structuredClone(existing);
  if (existing.status === "active") {
    if (existing.origin.releaseId === candidate.origin.releaseId || existing.matrixSemanticHash === candidate.matrixSemanticHash) return { authority: next, change: "unchanged" };
    // Two independent signed reviews disagree on the same composition: neither may be reused until a human reconciles them.
    next.status = "revoked";
    next.history.push({ action: "revoked", at, by, reason: "Conflicting signed approval for the same composition.", releaseId: candidate.origin.releaseId });
    return { authority: next, change: "revoked_conflict" };
  }
  if (existing.origin.releaseId === candidate.origin.releaseId) return { authority: next, change: "unchanged" }; // a revoked release never silently re-activates itself
  next.supersededOrigins.push(existing.origin);
  next.origin = structuredClone(candidate.origin);
  next.approvedMatrix = structuredClone(candidate.approvedMatrix);
  next.matrixSemanticHash = candidate.matrixSemanticHash;
  next.status = "active";
  next.history.push({ action: "re-approved", at, by, releaseId: candidate.origin.releaseId });
  return { authority: next, change: "reactivated" };
}

/** Pure transition: revoke only when the revoked release is the one that established the active authority. */
export function applyOriginRevocation(existing: AllergenCompositionAuthority | undefined, releaseId: string, at: string, by: string, reason: string): { authority?: AllergenCompositionAuthority; changed: boolean } {
  if (!existing || existing.status !== "active" || existing.origin.releaseId !== releaseId) return { authority: existing, changed: false };
  const next = structuredClone(existing);
  next.status = "revoked";
  next.history.push({ action: "revoked", at, by, reason, releaseId });
  return { authority: next, changed: true };
}

/** Pure: records that an order adopted the authority (idempotent per order). Returns the same object when nothing changes. */
export function applyReuseRegistration(existing: AllergenCompositionAuthority, orderId: string, at: string, by: string): AllergenCompositionAuthority {
  if ((existing.reusedBy || []).some(item => item.orderId === orderId)) return existing;
  const next = structuredClone(existing);
  next.reusedBy = [...(next.reusedBy || []), { orderId, at, by }];
  next.history.push({ action: "reused", at, by, reason: `Adopted by ${orderId}.` });
  return next;
}

export type AllergenAuthorityStore = {
  get(compositionId: string): Promise<AllergenCompositionAuthority | undefined>;
  recordApproval(candidate: AllergenCompositionAuthority, at: string, by: string): Promise<ApprovalOutcome>;
  revokeForOrigin(compositionId: string, releaseId: string, at: string, by: string, reason: string): Promise<AllergenCompositionAuthority | undefined>;
  registerReuse(compositionId: string, orderId: string, at: string, by: string): Promise<void>;
};

class MemoryAllergenAuthorityStore implements AllergenAuthorityStore {
  readonly records = new Map<string, AllergenCompositionAuthority>();
  async get(id: string) { const record = this.records.get(id); return record ? structuredClone(record) : undefined; }
  async recordApproval(candidate: AllergenCompositionAuthority, at: string, by: string) {
    const outcome = applyApproval(this.records.get(candidate.compositionId), candidate, at, by);
    this.records.set(candidate.compositionId, structuredClone(outcome.authority));
    return outcome;
  }
  async revokeForOrigin(id: string, releaseId: string, at: string, by: string, reason: string) {
    const result = applyOriginRevocation(this.records.get(id), releaseId, at, by, reason);
    if (result.changed && result.authority) this.records.set(id, structuredClone(result.authority));
    return result.changed ? result.authority : undefined;
  }
  async registerReuse(id: string, orderId: string, at: string, by: string) {
    const current = this.records.get(id);
    if (current) this.records.set(id, applyReuseRegistration(current, orderId, at, by));
  }
}

class FirestoreAllergenAuthorityStore implements AllergenAuthorityStore {
  private async ref(id: string) { const { db } = await import("./firebase-admin"); return { db, doc: db.collection(ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION).doc(id) }; }
  async get(id: string) { const { doc } = await this.ref(id); const snapshot = await doc.get(); return snapshot.exists ? snapshot.data() as AllergenCompositionAuthority : undefined; }
  async recordApproval(candidate: AllergenCompositionAuthority, at: string, by: string) {
    const { db, doc } = await this.ref(candidate.compositionId);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(doc);
      const outcome = applyApproval(snapshot.exists ? snapshot.data() as AllergenCompositionAuthority : undefined, candidate, at, by);
      if (outcome.change !== "unchanged") transaction.set(doc, outcome.authority);
      return outcome;
    });
  }
  async revokeForOrigin(id: string, releaseId: string, at: string, by: string, reason: string) {
    const { db, doc } = await this.ref(id);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(doc);
      const result = applyOriginRevocation(snapshot.exists ? snapshot.data() as AllergenCompositionAuthority : undefined, releaseId, at, by, reason);
      if (result.changed && result.authority) transaction.set(doc, result.authority);
      return result.changed ? result.authority : undefined;
    });
  }
  async registerReuse(id: string, orderId: string, at: string, by: string) {
    const { db, doc } = await this.ref(id);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(doc);
      if (!snapshot.exists) return;
      const current = snapshot.data() as AllergenCompositionAuthority;
      const next = applyReuseRegistration(current, orderId, at, by);
      if (next !== current) transaction.set(doc, next);
    });
  }
}

const memoryStore = new MemoryAllergenAuthorityStore();
export const memoryAllergenAuthorityStore = memoryStore;
export function createAllergenAuthorityStore(): AllergenAuthorityStore {
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory") return memoryStore;
  return new FirestoreAllergenAuthorityStore();
}
