import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeReadPackage, encodeReadPackage } from "@fika/server-shared/read-package";
import { serviceDefinitionsFromRecords } from "../lib/service-definitions-read-package";
import type { CanonicalRecord } from "../lib/types";

const definition = record("Service Definition", "service-definition:coffee", { serviceName: "Coffee Bar", description: "Hot drinks", lifecycleState: "active" });

test("Service Definition package preserves the compatible catalogue shape and integrity", () => {
  const value = { serviceDefinitions: serviceDefinitionsFromRecords([definition], []) };
  const encoded = encodeReadPackage("integration-hub/service-definitions", 2, value, value.serviceDefinitions.length, { contractVersion: "integration-hub.service-definitions.v1", sourceVersion: "canonical:1:revisions:0" });
  assert.equal(encoded.manifest.dataset, "integration-hub/service-definitions");
  assert.equal(encoded.manifest.recordCount, 1);
  assert.deepEqual(decodeReadPackage(encoded.manifest, encoded.bytes), value);
  assert.throws(() => decodeReadPackage(encoded.manifest, Uint8Array.from(encoded.bytes, (byte, index) => index === 0 ? byte ^ 1 : byte)), /integrity check failed/);
});

test("Service Definition steady-state GET reads the package; canonical reads remain rebuild-only", () => {
  const route = readFileSync(new URL("../app/api/service-definitions/route.ts", import.meta.url), "utf8");
  const packageSource = readFileSync(new URL("../lib/service-definitions-read-package.ts", import.meta.url), "utf8");
  const getRoute = route.slice(0, route.indexOf("export async function POST"));
  assert.match(getRoute, /getServiceDefinitionsReadPackage/);
  assert.doesNotMatch(getRoute, /serviceDefinitionCatalogueOverview\(\)/);
  assert.match(packageSource, /integrationHubCanonical/);
  assert.match(packageSource, /service-definitions\.package\.rebuild\.source/);
  const reader = packageSource.slice(packageSource.indexOf("export async function getServiceDefinitionsReadPackage"));
  assert.doesNotMatch(reader, /rebuildServiceDefinitionsReadPackage/);
});

test("Service Definition rebuild hooks cover saves and deletes without putting authority in the package", () => {
  const configuration = readFileSync(new URL("../lib/operational-configuration-service.ts", import.meta.url), "utf8");
  const catalogue = readFileSync(new URL("../lib/service-catalogue-service.ts", import.meta.url), "utf8");
  const packageSource = readFileSync(new URL("../lib/service-definitions-read-package.ts", import.meta.url), "utf8");
  assert.match(configuration, /rebuildServiceDefinitionsReadPackage/);
  assert.match(catalogue, /await rebuildServiceDefinitionsReadPackage\(\)/);
  assert.doesNotMatch(packageSource, /authority|employment|assignment|delegation/i);
});

test("Hospitality and Events reference reads use the bounded typed reader", () => {
  const canonical = readFileSync(new URL("../lib/canonical-oplocs.ts", import.meta.url), "utf8");
  const hospitality = readFileSync(new URL("../lib/hospitality-catalogue-service.ts", import.meta.url), "utf8");
  const events = readFileSync(new URL("../lib/events-read-contract.ts", import.meta.url), "utf8");
  assert.match(canonical, /limit\(limit \+ 1\)/);
  assert.match(canonical, /canonical\.by-type\.bounded/);
  assert.match(hospitality, /listCanonicalRecordsByTypes/);
  assert.match(events, /listCanonicalRecordsByTypes/);
  assert.doesNotMatch(canonical, /where\("entityType", "in", wanted\)\.get\(\)/);
});

test("package misses require explicit authenticated rebuild instead of synchronous GET reconstruction", () => {
  const rebuildRoute = readFileSync(new URL("../app/api/read-packages/rebuild/route.ts", import.meta.url), "utf8");
  const oploc = readFileSync(new URL("../lib/oploc-read-package.ts", import.meta.url), "utf8");
  const arrangements = readFileSync(new URL("../lib/service-arrangements-read-package.ts", import.meta.url), "utf8");
  const definitions = readFileSync(new URL("../lib/service-definitions-read-package.ts", import.meta.url), "utf8");
  assert.match(rebuildRoute, /requireActor\(request, \["integration-admin"\]\)/);
  assert.match(rebuildRoute, /z\.enum\(\["oplocs", "service-arrangements", "service-definitions"\]\)/);
  for (const source of [oploc, arrangements, definitions]) {
    const reader = source.slice(source.indexOf("export async function get"));
    assert.doesNotMatch(reader, /rebuild[A-Za-z]+ReadPackage/);
  }
});

function record(entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>): CanonicalRecord {
  const now = "2026-08-31T09:00:00.000Z";
  return { canonicalId, entityType, dataHash: "test", lifecycleStatus: "published", publicationStatus: "published", record: { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: "person:admin", updatedAt: now, updatedBy: "person:admin", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType, canonicalId, ...values } };
}
