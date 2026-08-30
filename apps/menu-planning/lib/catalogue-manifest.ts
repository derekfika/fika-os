import { readFile } from "node:fs/promises";
import { Firestore } from "@google-cloud/firestore";
import { appDataPath } from "./fika-contracts";
import { assertOperationalStoreAvailable } from "./hosted-runtime";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export type CatalogueManifest = { schemaVersion: number; catalogueVersion: number; updatedAt?: string; dishCount?: number };
export const CATALOGUE_MANIFEST_ID = "__manifest__";
const collectionName = "fikaMenuPlanningCatalogue";
const filePath = appDataPath("menu-planning", "menu-planning", "canonical-menu-items.json");

const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const firestore = () => new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT });

export async function getCatalogueManifest(): Promise<CatalogueManifest> {
  if (hosted()) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
    if (!projectId) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
    const document = await firestore().collection(collectionName).doc(CATALOGUE_MANIFEST_ID).get();
    recordDataAccess({ app: "menu-planning", operation: "catalogue.manifest", source: "FIRESTORE", documents: document.exists ? 1 : 0 });
    if (!document.exists) return { schemaVersion: 1, catalogueVersion: 0 };
    const value = document.data() || {};
    return { schemaVersion: Number(value.schemaVersion || 1), catalogueVersion: Number(value.catalogueVersion || 0), updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined, dishCount: typeof value.dishCount === "number" ? value.dishCount : undefined };
  }
  assertOperationalStoreAvailable();
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as { version?: number; updatedAt?: string; items?: unknown[] };
    return { schemaVersion: 1, catalogueVersion: Number(value.version || 0), updatedAt: value.updatedAt, dishCount: Array.isArray(value.items) ? value.items.length : 0 };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, catalogueVersion: 0, dishCount: 0 };
    throw Object.assign(new Error("Canonical menu catalogue is unavailable; no catalogue manifest was loaded.", { cause }), { status: 503 });
  }
}
