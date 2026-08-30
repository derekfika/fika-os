import test from "node:test";
import assert from "node:assert/strict";
import { CACHE_DATASETS, CACHE_STORES, datasetForEntityType, INTEGRATION_CACHE_SCHEMA_VERSION } from "../lib/integration-cache-shared";

test("integration cache has deterministic schema, stores and dataset mapping", () => {
  assert.equal(INTEGRATION_CACHE_SCHEMA_VERSION, 1);
  assert.deepEqual(CACHE_STORES, ["cacheMetadata", "canonicalOplocs", "legends", "applications", "serviceDefinitions", "equipmentAssets", "referenceEntities"]);
  assert.equal(datasetForEntityType("OPLOC"), "oplocs");
  assert.equal(datasetForEntityType("Legend"), "legends");
  assert.equal(datasetForEntityType("Employment"), "legends");
  assert.equal(datasetForEntityType("Service Definition"), "serviceDefinitions");
  assert.equal(datasetForEntityType("Equipment Asset"), "equipmentAssets");
  assert.equal(datasetForEntityType("Authority Grant"), undefined);
  assert.deepEqual(CACHE_DATASETS, ["oplocs", "legends", "applications", "serviceDefinitions", "equipmentAssets", "referenceEntities"]);
});
