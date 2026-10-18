import type { CpuAllergenRelease } from "./cpu-allergen-release";
import type { MatrixArtifact, ProductionPlan } from "../app/lib/production-plan";
import { nextPlanRevisionStamp, planRevisionToken } from "../app/lib/production-plan-state";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { appendCpuChangeInTransaction, cpuChangeReceipts, type CpuChangeWithPropagation } from "./cpu-projection-repository";
import { enqueueCpuPropagation } from "./cpu-durable-outbox";

export const PRODUCTION_PLANS_COLLECTION = "fikaCpuProductionPlansV1";
export const MAX_PRODUCTION_PLAN_ORDER_IDS = 100;

export type ProductionPlanRepository = {
  get(orderId: string): Promise<ProductionPlan | undefined>;
  getByOrderIds(orderIds: string[]): Promise<ProductionPlan[]>;
  /** `expectedRevision` is mandatory: null = the plan must not exist yet; otherwise it must equal the stored plan's revision token. Compared inside the write transaction. */
  save(plan: ProductionPlan, expectedRevision: string | null): Promise<{ revision: string }>;
  saveAndAppendCpuChange(plan: ProductionPlan, expectedRevision: string | null, change: CpuChangeWithPropagation & Record<string, unknown>): Promise<{ sequence: number; revision: string; duplicate?: boolean; plan?: ProductionPlan }>;
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

function conflict(message: string) { return Object.assign(new Error(message), { status: 409, code: "CPU_ALLERGEN_REVIEW_CONFLICT" }); }
/**
 * The atomic revision guard. Called with the record read INSIDE the write transaction, so a concurrent commit between the caller's
 * own read and this write can never be overwritten. There is no "unconditional" mode: a missing plan is `null`, and a plan that
 * pre-dates revision stamps is the fixed legacy token, so neither can bypass the check.
 */
export function assertExpectedRevision(current: Pick<ProductionPlan, "updatedAt"> | undefined, expectedRevision: string | null) {
  if (planRevisionToken(current) !== expectedRevision) throw conflict("This allergen review was changed by someone else after you opened it, so your edits were not saved. Copy anything you need, reload the review to see the latest evidence and signatures, then re-apply your changes.");
}
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)])) : value;
const contentKey = (plan: ProductionPlan) => JSON.stringify(stable({ ...plan, updatedAt: undefined }));
/**
 * The central revision invariant, evaluated against the record read INSIDE the write transaction. Whatever stamp the caller put
 * on the plan, a changed plan is persisted with a revision strictly later than the stored one (identical timestamps, rapid writes
 * and background writers cannot reuse a revision), while a write that changes nothing keeps the stored revision (idempotent no-op).
 */
export function revisionForWrite(plan: ProductionPlan, current: ProductionPlan | undefined, nowIso = new Date().toISOString()): { persisted: ProductionPlan; revision: string; changed: boolean } {
  const compact = compactProductionPlanForPersistence(plan);
  if (current && contentKey(compact) === contentKey(compactProductionPlanForPersistence(current))) return { persisted: current, revision: planRevisionToken(current)!, changed: false };
  const requested = plan.updatedAt && Number.isFinite(Date.parse(plan.updatedAt)) ? plan.updatedAt : nowIso;
  const revision = nextPlanRevisionStamp(requested, current?.updatedAt);
  return { persisted: { ...compact, updatedAt: revision }, revision, changed: true };
}
/** A plan that pre-dates revision stamps has no updatedAt; it still decodes (revision token "legacy-unversioned") and is stamped on its next guarded save. */
export function decodeProductionPlan(value: unknown): ProductionPlan {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string" || typeof (value as { orderId?: unknown }).orderId !== "string" || typeof (value as { status?: unknown }).status !== "string" || !Array.isArray((value as { menuItems?: unknown }).menuItems) || ((value as { updatedAt?: unknown }).updatedAt !== undefined && typeof (value as { updatedAt?: unknown }).updatedAt !== "string")) throw Object.assign(new Error("Stored production plan has an invalid schema."), { status: 502 });
  return value as ProductionPlan;
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
  async save(plan: ProductionPlan, expectedRevision: string | null) {
    // Snapshot at call time: the route keeps one mutable plan object per order, so the content must not drift while the write is queued.
    const planSnapshot = structuredClone(plan);
    const { db } = await import("./firebase-admin");
    const collection = await this.collection();
    return db.runTransaction(async transaction => {
      const ref = collection.doc(plan.orderId);
      const snapshot = await transaction.get(ref);
      recordDataAccess({ app: "cpu-production", operation: "production-plan.transaction-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
      const current = snapshot.exists ? snapshot.data() as ProductionPlan : undefined;
      assertExpectedRevision(current, expectedRevision);
      const next = revisionForWrite(planSnapshot, current);
      if (next.changed) transaction.set(ref, next.persisted);
      return { revision: next.revision };
    });
  }
  async saveAndAppendCpuChange(plan: ProductionPlan, expectedRevision: string | null, change: CpuChangeWithPropagation & Record<string, unknown>) {
    // Snapshot at call time: the route keeps one mutable plan object per order, so the content must not drift while the write is queued.
    const planSnapshot = structuredClone(plan);
    const { db } = await import("./firebase-admin");
    const collection = await this.collection();
    return db.runTransaction(async transaction => {
      const ref = collection.doc(plan.orderId);
      const snapshot = await transaction.get(ref);
      recordDataAccess({ app: "cpu-production", operation: "production-plan.change.transaction-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
      const current = snapshot.exists ? snapshot.data() as ProductionPlan : undefined;
      assertExpectedRevision(current, expectedRevision);
      const idempotencyKey = typeof change.idempotencyKey === "string" ? change.idempotencyKey : undefined;
      if (idempotencyKey) {
        const receipt = await transaction.get(cpuChangeReceipts().doc(idempotencyKey.replace(/[^A-Za-z0-9:_-]+/g, "_")));
        if (receipt.exists) return { sequence: Number((receipt.data()?.event as { sequence?: unknown })?.sequence || 0), revision: planRevisionToken(current)!, duplicate: true, plan: current };
      }
      const event = await appendCpuChangeInTransaction(transaction, change);
      const next = revisionForWrite(planSnapshot, current);
      if (next.changed) transaction.set(ref, next.persisted);
      return { sequence: event.sequence, revision: next.revision };
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
  async save(plan: ProductionPlan, expectedRevision: string | null) {
    // Snapshot at call time: the route keeps one mutable plan object per order, so the content must not drift while the write is queued.
    const planSnapshot = structuredClone(plan);
    const current = this.records.get(plan.orderId);
    assertExpectedRevision(current, expectedRevision);
    const next = revisionForWrite(planSnapshot, current);
    if (next.changed) this.records.set(plan.orderId, structuredClone(next.persisted));
    return { revision: next.revision };
  }
  async saveAndAppendCpuChange(plan: ProductionPlan, expectedRevision: string | null, change: CpuChangeWithPropagation & Record<string, unknown>) {
    const idempotencyKey = typeof change.idempotencyKey === "string" ? change.idempotencyKey : undefined;
    if (idempotencyKey && this.commandReceipts.has(idempotencyKey)) return { sequence: this.commandReceipts.get(idempotencyKey)!, revision: planRevisionToken(this.records.get(plan.orderId))!, duplicate: true, plan: structuredClone(this.records.get(plan.orderId)) };
    const saved = await this.save(plan, expectedRevision);
    this.sequence += 1;
    if (idempotencyKey) this.commandReceipts.set(idempotencyKey, this.sequence);
    if (change.propagation) await enqueueCpuPropagation({ ...change.propagation, eventId: change.propagation.eventId || `cpu-change:${String(change.entityId)}:v${this.sequence}`, sourceVersion: this.sequence });
    for (const delivery of change.deliveries || []) {
      const { enqueueCpuDelivery } = await import("./cpu-durable-outbox");
      await enqueueCpuDelivery(delivery);
    }
    return { sequence: this.sequence, revision: saved.revision };
  }
}

const memoryRepository = new MemoryProductionPlanRepository();

export function createProductionPlanRepository(): ProductionPlanRepository {
  // Tests and explicitly requested local memory mode never touch Firestore.
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory") return memoryRepository;
  return new FirestoreProductionPlanRepository();
}
