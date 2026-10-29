import { getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { db } from "../firebase-admin";
import { getCataloguePackage } from "../hospitality-catalogue-package";
import { oplocPackageStore } from "../oploc-read-package";
import { rotationProblem } from "./store";

const dishManifestCollection = "fikaMenuPlanningCatalogueManifests";
const dishManifestDocument = "catalogue";
const dishPackageKey = "menu-planning/catalogue";
const dishDataset = "snapshots/menu-planning/catalogue";

type DishCatalogueEntry = { id?: unknown; kind?: unknown; name?: unknown; category?: unknown; status?: unknown; reviewStatus?: unknown; item?: { revision?: unknown; [key: string]: unknown } };
type DishPackage = { entries?: DishCatalogueEntry[] };
type DishManifest = { sourceRevision?: number; sourceHash?: string; packageState?: { status?: string; sourceRevision?: number; sourceHash?: string; packageHash?: string }; };
export type RotationResources = { dishes: Array<{ id: string; name: string; category: string; revision: number }>; items: Array<{ id: string; name: string; category: string }> };

export function menuPackageMatchesSource(source: DishManifest, manifest: ReadPackageManifest) {
  const sourceRevision = source.sourceRevision;
  const sourceHash = source.sourceHash;
  const state = source.packageState;
  return Number.isInteger(sourceRevision) && Boolean(sourceHash) && state?.status === "current"
    && state.sourceRevision === sourceRevision && state.sourceHash === sourceHash && state.packageHash === manifest.contentHash
    && manifest.dataset === dishDataset && manifest.packageVersion === sourceRevision && manifest.sourceHash === sourceHash
    && manifest.sourceVersion === `catalogue-r${sourceRevision}-${sourceHash}`;
}

function menuPlanningPackageStore(): ReadPackageStore {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const bucketName = process.env.FIKA_SNAPSHOT_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
  if (!projectId || !bucketName) throw rotationProblem("Dish Library snapshot storage is not configured", 503);
  const app = getApps()[0] || initializeApp({ projectId, storageBucket: bucketName });
  const bucket = getStorage(app).bucket(bucketName);
  return {
    async putImmutable() { throw new Error("Dish Library snapshot store is read-only"); },
    async get(name) {
      try { const [bytes] = await bucket.file(name).download({ decompress: false }); return bytes; }
      catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; }
    },
    async has(name) { const [exists] = await bucket.file(name).exists(); return exists; },
    async getManifest(key) {
      try { const [bytes] = await bucket.file(`manifests/${key}.json`).download(); return JSON.parse(bytes.toString("utf8")) as ReadPackageManifest; }
      catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; }
    },
    async putManifest() { throw new Error("Dish Library snapshot store is read-only"); },
  };
}

export function checkedDishes(pkg: DishPackage): RotationResources["dishes"] {
  if (!Array.isArray(pkg.entries)) throw rotationProblem("Dish Library catalogue has an invalid shape", 503);
  return pkg.entries.flatMap(entry => {
    const id = typeof entry.id === "string" ? entry.id : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const category = typeof entry.category === "string" ? entry.category : "";
    const revision = entry.item?.revision;
    if (entry.kind !== "canonical" || !id || !name || !Number.isInteger(revision) || (entry.status === "archived" || entry.reviewStatus === "archived")) return [];
    return [{ id, name, category, revision: revision as number }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Reads one current Dish Library manifest and integrity-verifies its immutable package. Never rebuilds on a GET. */
export async function getRotationResources(store: ReadPackageStore = menuPlanningPackageStore()): Promise<RotationResources> {
  const snapshot = await db.collection(dishManifestCollection).doc(dishManifestDocument).get();
  if (!snapshot.exists) throw rotationProblem("Dish Library catalogue is unavailable", 503);
  const source = snapshot.data() as DishManifest;
  const sourceRevision = source.sourceRevision;
  const sourceHash = source.sourceHash;
  const state = source.packageState;
  if (!Number.isInteger(sourceRevision) || !sourceHash || state?.status !== "current" || state.sourceRevision !== sourceRevision || state.sourceHash !== sourceHash) {
    throw rotationProblem("Dish Library catalogue package is stale or unavailable", 503);
  }
  const loaded = await retrieveReadPackage<DishPackage>(store, dishPackageKey);
  if (!loaded || !menuPackageMatchesSource(source, loaded.manifest)) {
    throw rotationProblem("Dish Library catalogue package failed freshness validation", 503);
  }
  const catalogue = await getCataloguePackage(oplocPackageStore());
  if (!catalogue) throw rotationProblem("Hospitality catalogue package is unavailable", 503);
  const items = catalogue.value.items.map(item => ({ id: item.id, name: item.name, category: item.category })).filter(item => item.id && item.name).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { dishes: checkedDishes(loaded.value), items };
}
