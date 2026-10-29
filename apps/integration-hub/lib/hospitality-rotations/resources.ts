import type { Firestore } from "firebase-admin/firestore";
import { HOSPITALITY_DISH_CLASSES, ROTATION_PICKER_SCOPES, type DishLink, type DishOperationalScope } from "../../../shared/hospitality-rotations";
import { db } from "../firebase-admin";
import { getCataloguePackage } from "../hospitality-catalogue-package";
import { oplocPackageStore } from "../oploc-read-package";
import { rotationProblem, type RotationStore } from "./store";

const DISH_COLLECTION = "fikaMenuPlanningCatalogue";

export type RotationDish = { id: string; name: string; category: string; revision: number; scope: DishOperationalScope; hospitalityClass?: string; itemId?: string };
export type RotationItem = { id: string; name: string; category: string; dishId?: string; classification?: string };
export type RotationResources = { dishes: RotationDish[]; items: RotationItem[]; classifications: Array<{ id: string; label: string }> };

type StoredDish = { kind?: unknown; record?: Record<string, unknown> } & Record<string, unknown>;

/**
 * The Rotations picker offers only dishes explicitly scoped to Hospitality Rotations (or shared on purpose).
 * Menu Planning dishes are never offered, so Brian's Dish Library cannot populate the manager.
 */
export function checkedDishes(rows: StoredDish[], links: readonly DishLink[] = []): RotationDish[] {
  const itemByDish = new Map(links.map(link => [link.dishId, link.itemId]));
  return rows.flatMap(row => {
    const record = (row.record || row) as Record<string, unknown>;
    const id = typeof record.canonicalId === "string" ? record.canonicalId : "";
    const name = typeof record.displayName === "string" ? record.displayName.trim() : "";
    const revision = record.revision;
    const scope = record.operationalScope as DishOperationalScope;
    if (row.kind !== "dish" || !id || !name || !Number.isInteger(revision) || record.reviewStatus === "archived" || !(ROTATION_PICKER_SCOPES as readonly string[]).includes(scope)) return [];
    const hospitalityClass = typeof record.hospitalityClass === "string" ? record.hospitalityClass : undefined;
    const label = HOSPITALITY_DISH_CLASSES.find(value => value.id === hospitalityClass)?.label;
    return [{ id, name, category: label || "Hospitality dish", revision: revision as number, scope, ...(hospitalityClass ? { hospitalityClass } : {}), ...(itemByDish.has(id) ? { itemId: itemByDish.get(id) } : {}) }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function readHospitalityDishes(firestore: Firestore): Promise<StoredDish[]> {
  try {
    // Indexed equality/in filter on the explicit scope: never a whole Dish Library read.
    const snapshot = await firestore.collection(DISH_COLLECTION).where("kind", "==", "dish").where("record.operationalScope", "in", [...ROTATION_PICKER_SCOPES]).get();
    return snapshot.docs.map(document => document.data() as StoredDish);
  } catch (error) {
    console.error("[ROTATIONS_RESOURCES] hospitality dish query failed", error);
    throw rotationProblem("Hospitality dish records could not be read from the canonical Dish Library", 503);
  }
}

async function readCatalogueItems(): Promise<Array<{ id: string; name: string; category: string }>> {
  let catalogue;
  try { catalogue = await getCataloguePackage(oplocPackageStore()); }
  catch (error) {
    console.error("[ROTATIONS_RESOURCES] hospitality catalogue package read failed", error);
    throw rotationProblem("Hospitality catalogue package could not be read", 503);
  }
  if (!catalogue) throw rotationProblem("Hospitality catalogue package is unavailable", 503);
  return catalogue.value.items.map(item => ({ id: item.id, name: item.name, category: item.category })).filter(item => item.id && item.name).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Failures name the failed dependency; nothing is masked as an empty successful response. */
export async function getRotationResources(store: RotationStore, firestore: Firestore = db): Promise<RotationResources> {
  const links = await store.links();
  const [rows, items] = await Promise.all([readHospitalityDishes(firestore), readCatalogueItems()]);
  const linkByItem = new Map(links.map(link => [link.itemId, link]));
  return {
    dishes: checkedDishes(rows, links),
    items: items.map(item => ({ ...item, ...(linkByItem.has(item.id) ? { dishId: linkByItem.get(item.id)!.dishId, classification: linkByItem.get(item.id)!.classification } : {}) })),
    classifications: HOSPITALITY_DISH_CLASSES.map(value => ({ ...value })),
  };
}
