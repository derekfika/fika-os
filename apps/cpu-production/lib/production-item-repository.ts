import { normaliseOperationalAllergens } from "@fika/contracts";
import { productionItemId } from "./production-item-id";

export const PRODUCTION_ITEMS_COLLECTION = "fikaCpuProductionItemsV1";

export type ProductionItem = {
  id: string;
  title: string;
  itemType?: string;
  parentMenuItemKey: string;
  category?: string;
  allergens: Record<string, string>;
  mayContainNotes?: string;
  sourceEvidence?: string[];
  createdAt?: string;
  updatedAt: string;
  updatedBy: string;
};

function invalid(message: string) { return Object.assign(new Error(message), { status: 400 }); }

export function canonicalProductionItem(value: unknown, actorUid = "migration") : ProductionItem {
  if (!value || typeof value !== "object") throw invalid("Production item must be an object.");
  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const parentMenuItemKey = typeof raw.parentMenuItemKey === "string" ? raw.parentMenuItemKey.trim() : "";
  if (!title || !parentMenuItemKey) throw invalid("Production item title and parentMenuItemKey are required.");
  const now = new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : now;
  const updatedBy = typeof raw.updatedBy === "string" && raw.updatedBy ? raw.updatedBy : actorUid;
  const evidence = Array.isArray(raw.sourceEvidence) ? raw.sourceEvidence.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
  const item: ProductionItem = {
    id: productionItemId(title, parentMenuItemKey),
    title,
    ...(typeof raw.itemType === "string" && raw.itemType ? { itemType: raw.itemType } : {}),
    parentMenuItemKey,
    ...(typeof raw.category === "string" && raw.category ? { category: raw.category } : {}),
    allergens: normaliseOperationalAllergens(raw.allergens as Record<string, unknown> | undefined),
    ...(typeof raw.mayContainNotes === "string" && raw.mayContainNotes ? { mayContainNotes: raw.mayContainNotes } : {}),
    ...(evidence.length ? { sourceEvidence: [...new Set(evidence)] } : {}),
    ...(typeof raw.createdAt === "string" && raw.createdAt ? { createdAt: raw.createdAt } : {}),
    updatedAt,
    updatedBy,
  };
  return item;
}

function decode(value: unknown): ProductionItem {
  return canonicalProductionItem(value);
}

export type ProductionItemRepository = {
  list(parentMenuItemKey?: string): Promise<ProductionItem[]>;
  save(item: ProductionItem): Promise<void>;
};

class FirestoreProductionItemRepository implements ProductionItemRepository {
  private async collection() { const { db } = await import("./firebase-admin"); return db.collection(PRODUCTION_ITEMS_COLLECTION); }
  async list(parentMenuItemKey?: string) {
    const collection = await this.collection();
    const snapshot = parentMenuItemKey ? await collection.where("parentMenuItemKey", "==", parentMenuItemKey).get() : await collection.get();
    return snapshot.docs.map(document => decode(document.data())).sort((a, b) => a.title.localeCompare(b.title));
  }
  async save(item: ProductionItem) {
    const { db } = await import("./firebase-admin");
    await db.collection(PRODUCTION_ITEMS_COLLECTION).doc(item.id).set(item, { merge: true });
  }
}

class MemoryProductionItemRepository implements ProductionItemRepository {
  private readonly records = new Map<string, ProductionItem>();
  async list(parentMenuItemKey?: string) { return [...this.records.values()].filter(item => !parentMenuItemKey || item.parentMenuItemKey === parentMenuItemKey).sort((a, b) => a.title.localeCompare(b.title)); }
  async save(item: ProductionItem) { this.records.set(item.id, structuredClone(item)); }
}

export function createProductionItemRepository(): ProductionItemRepository {
  if (process.env.NODE_ENV === "test" || process.env.FIKA_CPU_ITEM_STORE === "memory") return new MemoryProductionItemRepository();
  return new FirestoreProductionItemRepository();
}
