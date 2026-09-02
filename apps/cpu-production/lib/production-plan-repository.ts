import type { ProductionPlan } from "../app/lib/production-plan";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export const PRODUCTION_PLANS_COLLECTION = "fikaCpuProductionPlansV1";
export const MAX_PRODUCTION_PLAN_ORDER_IDS = 100;

export type ProductionPlanRepository = {
  get(orderId: string): Promise<ProductionPlan | undefined>;
  getByOrderIds(orderIds: string[]): Promise<ProductionPlan[]>;
  save(plan: ProductionPlan, expectedUpdatedAt?: string): Promise<void>;
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
}

class MemoryProductionPlanRepository implements ProductionPlanRepository {
  private readonly records = new Map<string, ProductionPlan>();
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
}

export function createProductionPlanRepository(): ProductionPlanRepository {
  // Tests and explicitly requested local memory mode never touch Firestore.
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_PLAN_STORE === "memory") return new MemoryProductionPlanRepository();
  return new FirestoreProductionPlanRepository();
}
