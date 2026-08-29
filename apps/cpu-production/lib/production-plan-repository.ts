import type { ProductionPlan } from "../app/lib/production-plan";

export const PRODUCTION_PLANS_COLLECTION = "fikaCpuProductionPlansV1";

export type ProductionPlanRepository = {
  list(): Promise<ProductionPlan[]>;
  get(orderId: string): Promise<ProductionPlan | undefined>;
  save(plan: ProductionPlan, expectedUpdatedAt?: string): Promise<void>;
};

function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
function decode(value: unknown): ProductionPlan {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string" || typeof (value as { orderId?: unknown }).orderId !== "string" || typeof (value as { status?: unknown }).status !== "string" || !Array.isArray((value as { menuItems?: unknown }).menuItems) || typeof (value as { updatedAt?: unknown }).updatedAt !== "string") throw Object.assign(new Error("Stored production plan has an invalid schema."), { status: 502 });
  return value as ProductionPlan;
}

class FirestoreProductionPlanRepository implements ProductionPlanRepository {
  private async collection() { const { db } = await import("./firebase-admin"); return db.collection(PRODUCTION_PLANS_COLLECTION); }
  async list() { const snapshot = await (await this.collection()).get(); return snapshot.docs.map(document => decode(document.data())); }
  async get(orderId: string) { const snapshot = await (await this.collection()).doc(orderId).get(); return snapshot.exists ? decode(snapshot.data()) : undefined; }
  async save(plan: ProductionPlan, expectedUpdatedAt?: string) {
    const { db } = await import("./firebase-admin");
    const collection = await this.collection();
    await db.runTransaction(async transaction => {
      const ref = collection.doc(plan.orderId);
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? snapshot.data() as ProductionPlan : undefined;
      if (current && expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) throw conflict("Production plan changed elsewhere. Refresh and try again.");
      if (!current && expectedUpdatedAt !== undefined) throw conflict("Production plan was removed elsewhere. Refresh and try again.");
      transaction.set(ref, plan);
    });
  }
}

class MemoryProductionPlanRepository implements ProductionPlanRepository {
  private readonly records = new Map<string, ProductionPlan>();
  async list() { return [...this.records.values()]; }
  async get(orderId: string) { return this.records.get(orderId); }
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

