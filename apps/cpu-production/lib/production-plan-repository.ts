import type { CpuAllergenRelease } from "./cpu-allergen-release";
import type { MatrixArtifact, ProductionPlan } from "../app/lib/production-plan";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { appendCpuChangeInTransaction, cpuChangeReceipts, type CpuChangeWithPropagation } from "./cpu-projection-repository";
import { enqueueCpuPropagation } from "./cpu-durable-outbox";
import { ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION, authorityIdsFor, evaluateAuthorityTransition, memoryAllergenAuthorityStore, type AuthorityClause } from "./allergen-authority-store";
import type { AllergenCompositionAuthority } from "./allergen-composition";

/**
 * Canonical CPU persistence invariant: a plan that persists a reused allergen approval (a reused `planned` plan, or a reused
 * release that is `pending` or `current`) can only be written if, IN THE SAME TRANSACTION, the authority generation it is
 * bound to is still active and registered (or being registered by an adoption clause). A clause may also revoke an origin
 * authority atomically with the plan transition that withdrew its signed approval. Writes that carry no reused state are not
 * affected, and the reopen/revoke path (which removes reused state) is naturally exempt.
 */
export type { AuthorityClause } from "./allergen-authority-store";
/** Test seam: awaited immediately before the authority check/commit of the in-memory repository. */
export const repositoryTestHooks: { beforeAuthorityCheck?: () => Promise<void> } = {};

export const PRODUCTION_PLANS_COLLECTION = "fikaCpuProductionPlansV1";
export const MAX_PRODUCTION_PLAN_ORDER_IDS = 100;

export type ProductionPlanRepository = {
  get(orderId: string): Promise<ProductionPlan | undefined>;
  getByOrderIds(orderIds: string[]): Promise<ProductionPlan[]>;
  save(plan: ProductionPlan, expectedUpdatedAt?: string, authority?: AuthorityClause): Promise<void>;
  saveAndAppendCpuChange(plan: ProductionPlan, expectedUpdatedAt: string | undefined, change: CpuChangeWithPropagation & Record<string, unknown>, authority?: AuthorityClause): Promise<{ sequence: number; duplicate?: boolean; plan?: ProductionPlan }>;
};

type PersistedMatrixArtifact = Omit<MatrixArtifact, "html">;

function compactMatrixArtifact(artifact: MatrixArtifact): PersistedMatrixArtifact {
  const { html: _html, ...metadata } = artifact;
  return metadata;
}

function compactAllergenRelease(release: CpuAllergenRelease): CpuAllergenRelease {
  return {
    ...release,
    masterArtifact: compactMatrixArtifact(release.masterArtifact),
    derivedArtifacts: release.derivedArtifacts.map(compactMatrixArtifact),
    packetArtifacts: release.packetArtifacts.map(compactMatrixArtifact),
  };
}

/** Remove generated MatrixArtifact HTML while retaining the authoritative plan and release metadata. */
export function compactProductionPlanForPersistence(plan: ProductionPlan): ProductionPlan {
  return {
    ...plan,
    ...(plan.matrixArtifact ? { matrixArtifact: compactMatrixArtifact(plan.matrixArtifact) } : {}),
    ...(plan.masterMatrixArtifact ? { masterMatrixArtifact: compactMatrixArtifact(plan.masterMatrixArtifact) } : {}),
    ...(plan.signedMatrixArtifact ? { signedMatrixArtifact: compactMatrixArtifact(plan.signedMatrixArtifact) } : {}),
    ...(plan.siteMatrixArtifacts ? { siteMatrixArtifacts: Object.fromEntries(Object.entries(plan.siteMatrixArtifacts).map(([siteId, artifact]) => [siteId, compactMatrixArtifact(artifact)])) } : {}),
    ...(plan.currentAllergenRelease ? { currentAllergenRelease: compactAllergenRelease(plan.currentAllergenRelease) } : {}),
    ...(plan.allergenReleaseHistory ? { allergenReleaseHistory: plan.allergenReleaseHistory.map(compactAllergenRelease) } : {}),
  };
}

function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
export function decodeProductionPlan(value: unknown): ProductionPlan {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string" || typeof (value as { orderId?: unknown }).orderId !== "string" || typeof (value as { status?: unknown }).status !== "string" || !Array.isArray((value as { menuItems?: unknown }).menuItems) || typeof (value as { updatedAt?: unknown }).updatedAt !== "string") throw Object.assign(new Error("Stored production plan has an invalid schema."), { status: 502 });
  return value as ProductionPlan;
}

type FirestoreDb = Awaited<typeof import("./firebase-admin")>["db"];
type FirestoreTransaction = Parameters<Parameters<FirestoreDb["runTransaction"]>[0]>[0];
async function readAuthorities(db: FirestoreDb, transaction: FirestoreTransaction, plan: ProductionPlan, clause: AuthorityClause | undefined, previous: ProductionPlan | undefined) {
  const ids = authorityIdsFor(plan, clause, previous);
  const snapshots = await Promise.all(ids.map(id => transaction.get(db.collection(ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION).doc(id))));
  return new Map(ids.map((id, index) => [id, snapshots[index].exists ? snapshots[index].data() as AllergenCompositionAuthority : undefined]));
}
function writeAuthorities(db: FirestoreDb, transaction: FirestoreTransaction, writes: Map<string, AllergenCompositionAuthority>) {
  for (const [id, authority] of writes) transaction.set(db.collection(ALLERGEN_COMPOSITION_AUTHORITIES_COLLECTION).doc(id), authority);
}

class FirestoreProductionPlanRepository implements ProductionPlanRepository {
  private async collection() { const { db } = await import("./firebase-admin"); return db.collection(PRODUCTION_PLANS_COLLECTION); }
  async get(orderId: string) { const snapshot = await (await this.collection()).doc(orderId).get(); recordDataAccess({ app: "cpu-production", operation: "production-plan.by-id", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" }); return snapshot.exists ? decodeProductionPlan(snapshot.data()) : undefined; }
  async getByOrderIds(orderIds: string[]) {
    const wanted = [...new Set(orderIds)];
    if (wanted.length > MAX_PRODUCTION_PLAN_ORDER_IDS) throw Object.assign(new Error(`A maximum of ${MAX_PRODUCTION_PLAN_ORDER_IDS} production plans may be requested.`), { status: 400 });
    const snapshots = await Promise.all(wanted.map(orderId => (async () => (await this.collection()).doc(orderId).get())()));
    recordDataAccess({ app: "cpu-production", operation: "production-plans.by-order-ids", source: "FIRESTORE", dataset: PRODUCTION_PLANS_COLLECTION, documents: snapshots.filter(snapshot => snapshot.exists).length, estimatedBillableReads: snapshots.length, firestoreReadKind: "document" });
    return snapshots.flatMap(snapshot => snapshot.exists ? [decodeProductionPlan(snapshot.data())] : []);
  }
  async save(plan: ProductionPlan, expectedUpdatedAt?: string, authority?: AuthorityClause) {
    const persistedPlan = compactProductionPlanForPersistence(plan);
    const { db } = await import("./firebase-admin");
    const collection = await this.collection();
    await db.runTransaction(async transaction => {
      const ref = collection.doc(plan.orderId);
      const snapshot = await transaction.get(ref);
      recordDataAccess({ app: "cpu-production", operation: "production-plan.transaction-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
      const current = snapshot.exists ? snapshot.data() as ProductionPlan : undefined;
      if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw conflict("Production plan changed elsewhere. Refresh and try again.");
      if (!current && expectedUpdatedAt !== undefined) throw conflict("Production plan was removed elsewhere. Refresh and try again.");
      const authorityWrites = evaluateAuthorityTransition(await readAuthorities(db, transaction, plan, authority, current), plan, authority, current);
      transaction.set(ref, persistedPlan);
      writeAuthorities(db, transaction, authorityWrites);
    });
  }
  async saveAndAppendCpuChange(plan: ProductionPlan, expectedUpdatedAt: string | undefined, change: CpuChangeWithPropagation & Record<string, unknown>, authority?: AuthorityClause) {
    const persistedPlan = compactProductionPlanForPersistence(plan);
    const { db } = await import("./firebase-admin");
    const collection = await this.collection();
    return db.runTransaction(async transaction => {
      const ref = collection.doc(plan.orderId);
      const snapshot = await transaction.get(ref);
      recordDataAccess({ app: "cpu-production", operation: "production-plan.change.transaction-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
      const current = snapshot.exists ? snapshot.data() as ProductionPlan : undefined;
      // Replay semantics are identical to the memory repository: an already-committed idempotent command is answered from its
      // receipt BEFORE optimistic concurrency, so a retry after success is a duplicate (never a spurious conflict) and a stale
      // version can never apply a command twice.
      const idempotencyKey = typeof change.idempotencyKey === "string" ? change.idempotencyKey : undefined;
      if (idempotencyKey) {
        const receipt = await transaction.get(cpuChangeReceipts().doc(idempotencyKey.replace(/[^A-Za-z0-9:_-]+/g, "_")));
        if (receipt.exists) return { sequence: Number((receipt.data()?.event as { sequence?: unknown })?.sequence || 0), duplicate: true, plan: current };
      }
      if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw conflict("Production plan changed elsewhere. Refresh and try again.");
      if (!current && expectedUpdatedAt !== undefined) throw conflict("Production plan was removed elsewhere. Refresh and try again.");
      // All reads (plan, receipt, authority documents) happen before any write; the authority check is part of this transaction.
      const authorityWrites = evaluateAuthorityTransition(await readAuthorities(db, transaction, plan, authority, current), plan, authority, current);
      const event = await appendCpuChangeInTransaction(transaction, change);
      transaction.set(ref, persistedPlan);
      writeAuthorities(db, transaction, authorityWrites);
      return { sequence: event.sequence };
    });
  }
}

class MemoryProductionPlanRepository implements ProductionPlanRepository {
  private readonly records = new Map<string, ProductionPlan>();
  private sequence = 0;
  private readonly commandReceipts = new Map<string, number>();
  async get(orderId: string) { return this.records.get(orderId); }
  async getByOrderIds(orderIds: string[]) {
    const wanted = [...new Set(orderIds)];
    if (wanted.length > MAX_PRODUCTION_PLAN_ORDER_IDS) throw Object.assign(new Error(`A maximum of ${MAX_PRODUCTION_PLAN_ORDER_IDS} production plans may be requested.`), { status: 400 });
    return wanted.flatMap(orderId => { const plan = this.records.get(orderId); return plan ? [structuredClone(plan)] : []; });
  }
  async save(plan: ProductionPlan, expectedUpdatedAt?: string, authority?: AuthorityClause) {
    if (repositoryTestHooks.beforeAuthorityCheck) await repositoryTestHooks.beforeAuthorityCheck();
    // Everything below is synchronous, so the check and the writes are atomic with respect to every other memory operation.
    const current = this.records.get(plan.orderId);
    if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw conflict("Production plan changed elsewhere. Refresh and try again.");
    if (!current && expectedUpdatedAt !== undefined) throw conflict("Production plan was removed elsewhere. Refresh and try again.");
    const ids = authorityIdsFor(plan, authority, current);
    const writes = evaluateAuthorityTransition(new Map(ids.map(id => [id, memoryAllergenAuthorityStore.records.get(id) ? structuredClone(memoryAllergenAuthorityStore.records.get(id)) : undefined])), plan, authority, current);
    this.records.set(plan.orderId, structuredClone(compactProductionPlanForPersistence(plan)));
    for (const [id, next] of writes) memoryAllergenAuthorityStore.records.set(id, structuredClone(next));
  }
  async saveAndAppendCpuChange(plan: ProductionPlan, expectedUpdatedAt: string | undefined, change: CpuChangeWithPropagation & Record<string, unknown>, authority?: AuthorityClause) {
    const idempotencyKey = typeof change.idempotencyKey === "string" ? change.idempotencyKey : undefined;
    if (idempotencyKey && this.commandReceipts.has(idempotencyKey)) return { sequence: this.commandReceipts.get(idempotencyKey)!, duplicate: true, plan: structuredClone(this.records.get(plan.orderId)) };
    await this.save(plan, expectedUpdatedAt, authority);
    this.sequence += 1;
    if (idempotencyKey) this.commandReceipts.set(idempotencyKey, this.sequence);
    if (change.propagation) await enqueueCpuPropagation({ ...change.propagation, eventId: change.propagation.eventId || `cpu-change:${String(change.entityId)}:v${this.sequence}`, sourceVersion: this.sequence });
    for (const delivery of change.deliveries || []) {
      const { enqueueCpuDelivery } = await import("./cpu-durable-outbox");
      await enqueueCpuDelivery(delivery);
    }
    return { sequence: this.sequence };
  }
}

/** Test/diagnostic seam: always the Firestore-backed repository, regardless of runtime mode. */
export const createFirestoreProductionPlanRepository = (): ProductionPlanRepository => new FirestoreProductionPlanRepository();
const memoryRepository = new MemoryProductionPlanRepository();

export function createProductionPlanRepository(): ProductionPlanRepository {
  // Tests and explicitly requested local memory mode never touch Firestore.
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory") return memoryRepository;
  return new FirestoreProductionPlanRepository();
}
