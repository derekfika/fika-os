import { readFile, writeFile } from "node:fs/promises";
import { Firestore } from "@google-cloud/firestore";
import { appDataPath } from "./fika-contracts";
import { assertOperationalStoreAvailable } from "./hosted-runtime";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { cataloguePackageStore, manifestKey } from "./catalogue-package-store";
import { catalogueSourceHash } from "./catalogue-source";

export type CataloguePackageState = {
  status: "pending" | "current" | "failed";
  sourceRevision: number;
  sourceHash: string;
  requestedAt: string;
  updatedAt: string;
  packageVersion?: number;
  packageHash?: string;
  lastError?: string;
  attempts?: number;
};
export type CatalogueManifest = {
  schemaVersion: number;
  /** Backwards-compatible alias retained for existing client cache contracts. */
  catalogueVersion: number;
  sourceRevision?: number;
  sourceHash?: string;
  updatedAt?: string;
  dishCount?: number;
  packageState?: CataloguePackageState;
  lastMutationBy?: string;
  package?: import("@fika/server-shared/read-package").ReadPackageManifest;
};
const collectionName = "fikaMenuPlanningCatalogueManifests";
const filePath = appDataPath("menu-planning", "menu-planning", "canonical-menu-items.json");

const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const firestore = () => new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT });

export async function getCatalogueManifest(): Promise<CatalogueManifest> {
  if (hosted()) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
    if (!projectId) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
    const document = await firestore().collection(collectionName).doc("catalogue").get();
    recordDataAccess({ app: "menu-planning", operation: "catalogue.manifest", source: "FIRESTORE", documents: document.exists ? 1 : 0 });
    if (!document.exists) return { schemaVersion: 1, catalogueVersion: 0, sourceRevision: 0 };
    const value = document.data() || {};
    const sourceRevision = Number(value.sourceRevision ?? value.catalogueVersion ?? 0);
    return {
      schemaVersion: Number(value.schemaVersion || 1), catalogueVersion: sourceRevision, sourceRevision,
      sourceHash: typeof value.sourceHash === "string" ? value.sourceHash : undefined,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
      dishCount: typeof value.dishCount === "number" ? value.dishCount : undefined,
      packageState: value.packageState as CataloguePackageState | undefined,
      lastMutationBy: typeof value.lastMutationBy === "string" ? value.lastMutationBy : undefined,
    };
  }
  assertOperationalStoreAvailable();
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as { version?: number; sourceRevision?: number; updatedAt?: string; items?: unknown[]; packageState?: CataloguePackageState; lastMutationBy?: string };
    const items = Array.isArray(value.items) ? value.items as import("./domain").MenuItem[] : [];
    const sourceRevision = Number(value.sourceRevision ?? value.version ?? 0);
    return {
      schemaVersion: 1, catalogueVersion: sourceRevision, sourceRevision,
      sourceHash: catalogueSourceHash(items), updatedAt: value.updatedAt, dishCount: items.length,
      packageState: value.packageState as CataloguePackageState | undefined,
      lastMutationBy: typeof value.lastMutationBy === "string" ? value.lastMutationBy : undefined,
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, catalogueVersion: 0, dishCount: 0 };
    throw Object.assign(new Error("Canonical menu catalogue is unavailable; no catalogue manifest was loaded.", { cause }), { status: 503 });
  }
}

export async function getPublishedCatalogueManifest(): Promise<CatalogueManifest> {
  const manifest = await cataloguePackageStore().getManifest(manifestKey);
  if (!manifest) return getCatalogueManifest();
  return { schemaVersion: manifest.schemaVersion, catalogueVersion: manifest.packageVersion, sourceRevision: manifest.packageVersion, sourceHash: manifest.sourceHash, updatedAt: manifest.generatedAt, dishCount: manifest.recordCount, package: manifest };
}

function stateError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

async function updateLocalPackageState(state: CataloguePackageState) {
  assertOperationalStoreAvailable();
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as { items?: import("./domain").MenuItem[]; version?: number; sourceRevision?: number; sourceHash?: string; updatedAt?: string; lastMutationBy?: string };
    const items = Array.isArray(value.items) ? value.items : [];
    const sourceRevision = Number(value.sourceRevision ?? value.version ?? 0);
    const sourceHash = catalogueSourceHash(items);
    if (sourceRevision !== state.sourceRevision || sourceHash !== state.sourceHash) return false;
    const next = { ...value, version: sourceRevision, sourceRevision, sourceHash, packageState: state };
    await writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

async function updateHostedPackageState(state: CataloguePackageState) {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
  const db = firestore();
  const ref = db.collection(collectionName).doc("catalogue");
  let applied = false;
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const value = snapshot.exists ? snapshot.data() || {} : {};
    const sourceRevision = Number(value.sourceRevision ?? value.catalogueVersion ?? 0);
    if (sourceRevision !== state.sourceRevision || value.sourceHash !== state.sourceHash) return;
    transaction.set(ref, { packageState: state }, { merge: true });
    applied = true;
  });
  return applied;
}

export async function markCataloguePackagePending(source: { sourceRevision: number; sourceHash: string }, actor?: string) {
  const now = new Date().toISOString();
  const state: CataloguePackageState = { status: "pending", sourceRevision: source.sourceRevision, sourceHash: source.sourceHash, requestedAt: now, updatedAt: now, attempts: 0 };
  if (hosted()) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
    if (!projectId) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
    const db = firestore();
    await db.collection(collectionName).doc("catalogue").set({ packageState: state, ...(actor ? { lastMutationBy: actor } : {}) }, { merge: true });
  } else {
    await updateLocalPackageState(state);
  }
  return state;
}

/** Backfills the source identity for pre-revision catalogue manifests without changing dish records. */
export async function ensureCatalogueSourceIdentity(source: { sourceRevision: number; sourceHash: string }, dishCount: number) {
  const now = new Date().toISOString();
  if (hosted()) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
    if (!projectId) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
    await firestore().collection(collectionName).doc("catalogue").set({ schemaVersion: 1, catalogueVersion: source.sourceRevision, sourceRevision: source.sourceRevision, sourceHash: source.sourceHash, updatedAt: now, dishCount }, { merge: true });
    return;
  }
  await updateLocalPackageState({ status: "pending", sourceRevision: source.sourceRevision, sourceHash: source.sourceHash, requestedAt: now, updatedAt: now, attempts: 0 });
}

export async function markCataloguePackageCurrent(source: { sourceRevision: number; sourceHash: string }, packageManifest: import("@fika/server-shared/read-package").ReadPackageManifest) {
  const now = new Date().toISOString();
  const state: CataloguePackageState = { status: "current", sourceRevision: source.sourceRevision, sourceHash: source.sourceHash, requestedAt: now, updatedAt: now, packageVersion: packageManifest.packageVersion, packageHash: packageManifest.contentHash, attempts: 1 };
  return hosted() ? updateHostedPackageState(state) : updateLocalPackageState(state);
}

export async function markCataloguePackageFailed(source: { sourceRevision: number; sourceHash: string }, error: unknown) {
  const now = new Date().toISOString();
  const state: CataloguePackageState = { status: "failed", sourceRevision: source.sourceRevision, sourceHash: source.sourceHash, requestedAt: now, updatedAt: now, lastError: stateError(error), attempts: 1 };
  return hosted() ? updateHostedPackageState(state) : updateLocalPackageState(state);
}
