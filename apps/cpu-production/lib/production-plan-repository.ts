import type { ProductionPlan } from "../app/lib/production-plan";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { appendCpuChangeInTransaction, cpuChangeReceipts, type CpuChangeWithPropagation } from "./cpu-projection-repository";
import { enqueueCpuPropagation } from "./cpu-durable-outbox";

export const PRODUCTION_PLANS_COLLECTION = "fikaCpuProductionPlansV1";
export const MAX_PRODUCTION_PLAN_ORDER_IDS = 100;

export type ProductionPlanRepository = {
  get(orderId: string): Promise<ProductionPlan | undefined>;
  getByOrderIds(orderIds: string[]): Promise<ProductionPlan[]>;
  save(plan: ProductionPlan, expectedUpdatedAt?: string): Promise<void>;
  saveAndAppendCpuChange(plan: ProductionPlan, expectedUpdatedAt: string | undefined, change: CpuChangeWithPropagation & Record<string, unknown>): Promise<{ sequence: number; duplicate?: boolean; plan?: ProductionPlan }>;
};

function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
function decode(value: unknown): ProductionPlan {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string" || typeof (value as { orderId?: unknown }).orderId !== "string" || typeof (value as { status?: unknown }).status !== "string" || !Array.isArray((value as { menuItems?: unknown }).menuItems) || typeof (value as { updatedAt?: unknown }).updatedAt !== "string") throw Object.assign(new Error("Stored production plan has an invalid schema."), { status: 502 });
  return value as ProductionPlan;
}

class FirestoreProductionPlanRepository implements ProductionPlanRepository {
  private async collection() { const { db } = await import("./firebase-admin"); return db.collection(PRODUCTION_PLANS_COLLECTION); }
  async get(orderId: string) { const snapshot = await (await this.collection()).doc(orderId).get(); recordDataAccess({ app: "cpu-production", operation: "production-plan.by-id", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" }); return snapshot.exists ? decode(snapshot.data()) : undefined; }
  async getByOrderIds(orderIds: string[]) {
    const wanted = [...new Set(orderIds)];
    if (wanted.length > MAX_PRODUCTION_PLAN_ORDER_IDS) throw Object.assign(new Error(`A maximum of ${MAX_PRODUCTION_PLAN_ORDER_IDS} production plans may be requested.`), { status: 400 });
    const snapshots = await Promise.all(wanted.map(orderId => (async () => (await this.collection()).doc(orderId).get())()));
    recordDataAccess({ app: "cpu-production", operation: "production-plans.by-order-ids", source: "FIRESTORE", dataset: PRODUCTION_PLANS_COLLECTION, documents: snapshots.filter(snapshot => snapshot.exists).length, estimatedBillableReads: snapshots.length, firestoreReadKind: "document" });
    return snapshots.flatMap(snapshot => snapshot.exists ? [decode(snapshot.data())] : []);
  }
  async save(plan: ProductionPlan, expectedUpdatedAt?: string) {
    const { db } = await import("./firebase-admin");
    const collection = await this.collection();
    await db.runTransaction(async transaction => {
      const ref = collection.doc(plan.orderId);
      const snapshot = await transaction.get(ref);
      recordDataAccess({ app: "cpu-production", operation: "production-plan.transaction-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
      const current = snapshot.exists ? snapshot.data() as ProductionPlan : undefined;
      if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw conflict("Production plan changed elsewhere. Refresh and try again.");
      if (!current && expectedUpdatedAt !== undefined) throw conflict("Production plan was removed elsewhere. Refresh and try again.");
      transaction.set(ref, plan);
    });
  }
  async saveAndAppendCpuChange(plan: ProductionPlan, expectedUpdatedAt: string | undefined, change: CpuChangeWithPropagation & Record<string, unknown>) {
    const { db } = await import("./firebase-admin");
    const collection = await this.collection();
    return db.runTransaction(async transaction => {
      const ref = collection.doc(plan.orderId);
      const snapshot = await transaction.get(ref);
      recordDataAccess({ app: "cpu-production", operation: "production-plan.change.transaction-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
      const current = snapshot.exists ? snapshot.data() as ProductionPlan : undefined;
      if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw conflict("Production plan changed elsewhere. Refresh and try again.");
      if (!current && expectedUpdatedAt !== undefined) throw conflict("Production plan was removed elsewhere. Refresh and try again.");
      const idempotencyKey = typeof change.idempotencyKey === "string" ? change.idempotencyKey : undefined;
      if (idempotencyKey) {
        const receipt = await transaction.get(cpuChangeReceipts().doc(idempotencyKey.replace(/[^A-Za-z0-9:_-]+/g, "_")));
        if (receipt.exists) return { sequence: Number((receipt.data()?.event as { sequence?: unknown })?.sequence || 0), duplicate: true, plan: current };
      }
      const event = await appendCpuChangeInTransaction(transaction, change);
      transaction.set(ref, plan);
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
  async save(plan: ProductionPlan, expectedUpdatedAt?: string) {
    const current = this.records.get(plan.orderId);
    if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw conflict("Production plan changed elsewhere. Refresh and try again.");
    if (!current && expectedUpdatedAt !== undefined) throw conflict("Production plan was removed elsewhere. Refresh and try again.");
    this.records.set(plan.orderId, structuredClone(plan));
  }
  async saveAndAppendCpuChange(plan: ProductionPlan, expectedUpdatedAt: string | undefined, change: CpuChangeWithPropagation & Record<string, unknown>) {
    const idempotencyKey = typeof change.idempotencyKey === "string" ? change.idempotencyKey : undefined;
    if (idempotencyKey && this.commandReceipts.has(idempotencyKey)) return { sequence: this.commandReceipts.get(idempotencyKey)!, duplicate: true, plan: structuredClone(this.records.get(plan.orderId)) };
    await this.save(plan, expectedUpdatedAt);
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

const memoryRepository = new MemoryProductionPlanRepository();

export function createProductionPlanRepository(): ProductionPlanRepository {
  // Tests and explicitly requested local memory mode never touch Firestore.
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory") return memoryRepository;
  return new FirestoreProductionPlanRepository();
}
