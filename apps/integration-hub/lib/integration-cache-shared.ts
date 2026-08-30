export const INTEGRATION_CACHE_SCHEMA_VERSION = 1;
export const INTEGRATION_CACHE_DB = "fika-integration-hub-cache";

export const CACHE_DATASETS = [
  "oplocs",
  "legends",
  "applications",
  "serviceDefinitions",
  "equipmentAssets",
  "referenceEntities",
] as const;
export type CacheDataset = (typeof CACHE_DATASETS)[number];

export type CacheManifest = {
  schemaVersion: number;
  dataset: CacheDataset;
  version: number;
  updatedAt: string;
  recordCount: number;
};

export const CACHE_STORES = [
  "cacheMetadata",
  "canonicalOplocs",
  "legends",
  "applications",
  "serviceDefinitions",
  "equipmentAssets",
  "referenceEntities",
] as const;

export function datasetForEntityType(entityType: string): CacheDataset | undefined {
  if (entityType === "OPLOC") return "oplocs";
  if (entityType === "Address") return "oplocs";
  if (["Legend", "Employment"].includes(entityType)) return "legends";
  if (entityType === "Service Definition") return "serviceDefinitions";
  if (["Equipment Type", "Equipment Asset"].includes(entityType)) return "equipmentAssets";
  if (["Operational Capability", "Staffing Role"].includes(entityType)) return "referenceEntities";
  return undefined;
}
