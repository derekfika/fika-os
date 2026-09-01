import { db } from "./firebase-admin";
import { getFikaRuntimeConfig } from "./runtime-config";
import { assertPermission } from "./authmod";
import type { Actor } from "./auth";
import { redactCanonical } from "./redaction";
import { CACHE_DATASETS, INTEGRATION_CACHE_SCHEMA_VERSION, datasetForEntityType, type CacheDataset, type CacheManifest } from "./integration-cache-shared";
import type { CanonicalRecord } from "./types";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

const manifestCollection = () => db.collection("integrationHubCacheManifests");
const canonical = () => db.collection("integrationHubCanonical");
const entityTypes: Record<CacheDataset, string[]> = {
  oplocs: ["OPLOC"], legends: ["Legend", "Employment"], applications: [],
  serviceDefinitions: ["Service Definition"], equipmentAssets: ["Equipment Type", "Equipment Asset"],
  referenceEntities: ["Operational Capability", "Staffing Role"],
};

export function cacheManifestRef(dataset: CacheDataset) { return manifestCollection().doc(dataset); }

export async function readCacheManifest(dataset: CacheDataset): Promise<CacheManifest> {
  const snapshot = await cacheManifestRef(dataset).get();
  recordDataAccess({ app: "integration-hub", operation: `cache-manifest.${dataset}`, source: "FIRESTORE", documents: snapshot.exists ? 1 : 0 });
  return snapshot.exists ? snapshot.data() as CacheManifest : {
    schemaVersion: INTEGRATION_CACHE_SCHEMA_VERSION, dataset, version: 0, updatedAt: "", recordCount: 0,
  };
}

export async function readCacheManifests(datasets: CacheDataset[] = [...CACHE_DATASETS]): Promise<CacheManifest[]> {
  const snapshots = await Promise.all(datasets.map(dataset => cacheManifestRef(dataset).get()));
  snapshots.forEach((snapshot, index) => recordDataAccess({ app: "integration-hub", operation: `cache-manifest.${datasets[index]}`, source: "FIRESTORE", documents: snapshot.exists ? 1 : 0 }));
  return snapshots.map((snapshot, index) => snapshot.exists ? snapshot.data() as CacheManifest : {
    schemaVersion: INTEGRATION_CACHE_SCHEMA_VERSION, dataset: datasets[index], version: 0, updatedAt: "", recordCount: 0,
  });
}

export async function listCacheDataset(actor: Actor, dataset: CacheDataset) {
  assertPermission(actor, "canonical.view");
  const types = entityTypes[dataset];
  if (!types.length) return { dataset, records: [] };
  const snapshot = await canonical().where("entityType", "in", types).get();
  recordDataAccess({ app: "integration-hub", operation: "cache-dataset.list", source: "FIRESTORE", documents: snapshot.size });
  const records = snapshot.docs.map(document => document.data() as CanonicalRecord)
    .filter(record => record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn")
    .map(record => redactCanonical(record, actor.role));
  return { dataset, records };
}

export function bumpCacheDatasets(transaction: FirebaseFirestore.Transaction, datasets: CacheDataset[], now = new Date().toISOString()) {
  for (const dataset of [...new Set(datasets)]) {
    const ref = cacheManifestRef(dataset);
    // The manifest is authoritative metadata, not a client trust signal. The
    // transaction keeps the version bump atomic with the canonical write.
    transaction.set(ref, {
      schemaVersion: INTEGRATION_CACHE_SCHEMA_VERSION, dataset,
      version: Date.now(), updatedAt: now, recordCount: 0,
    }, { merge: true });
  }
}

export function cacheDatasetForEntityType(entityType: string) { return datasetForEntityType(entityType); }
export function cacheEnvironment() { return getFikaRuntimeConfig().mode + ":" + getFikaRuntimeConfig().projectId; }
