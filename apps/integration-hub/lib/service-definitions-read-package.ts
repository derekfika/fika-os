import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { db } from "./firebase-admin";
import { oplocPackageStore } from "./oploc-read-package";
import type { ServiceDefinitionCatalogueItem } from "./service-catalogue-service";
import type { CanonicalRecord } from "./types";

export const SERVICE_DEFINITIONS_DATASET = "integration-hub/service-definitions";
export const SERVICE_DEFINITIONS_MANIFEST_KEY = SERVICE_DEFINITIONS_DATASET;
export type ServiceDefinitionsReadPackage = { serviceDefinitions: ServiceDefinitionCatalogueItem[] };

export async function rebuildServiceDefinitionsReadPackage(): Promise<ReadPackageManifest> {
  const [recordsSnapshot, revisionsSnapshot] = await Promise.all([
    db.collection("integrationHubCanonical").get(),
    db.collection("integrationHubCanonicalRevisions").get(),
  ]);
  recordDataAccess({ app: "integration-hub", operation: "service-definitions.package.rebuild.source", source: "FIRESTORE", documents: recordsSnapshot.size + revisionsSnapshot.size });
  const records = recordsSnapshot.docs.map(document => document.data() as CanonicalRecord);
  const revisions = revisionsSnapshot.docs.map(document => document.data());
  const serviceDefinitions = serviceDefinitionsFromRecords(records, revisions);
  const value: ServiceDefinitionsReadPackage = { serviceDefinitions };
  const store = oplocPackageStore();
  const previous = await store.getManifest(SERVICE_DEFINITIONS_MANIFEST_KEY);
  const encoded = encodeReadPackage(SERVICE_DEFINITIONS_DATASET, (previous?.packageVersion || 0) + 1, value, serviceDefinitions.length, { contractVersion: "integration-hub.service-definitions.v1", sourceVersion: `canonical:${recordsSnapshot.size}:revisions:${revisionsSnapshot.size}` });
  return publishReadPackage<ServiceDefinitionsReadPackage>(store, SERVICE_DEFINITIONS_MANIFEST_KEY, encoded);
}

export function serviceDefinitionsFromRecords(records: CanonicalRecord[], revisions: unknown[]): ServiceDefinitionCatalogueItem[] {
  return records
    .filter(record => record.entityType === "Service Definition" && record.lifecycleStatus !== "archived")
    .map(record => {
      const usage = {
        arrangementUsageCount: records.filter(value => value.entityType === "Service Arrangement" && value.record.serviceDefinitionId === record.canonicalId).length,
        historicUsage: revisions.some(value => historicalArrangementReference(value, record.canonicalId)),
      };
      return {
        canonicalId: record.canonicalId,
        serviceName: String(record.record.serviceName || record.canonicalId),
        ...(text(record.record.description) ? { description: text(record.record.description) } : {}),
        lifecycleState: record.record.lifecycleState as "active" | "retired",
        version: Number(record.record.version || 0),
        ...usage,
        canDelete: !usage.arrangementUsageCount && !usage.historicUsage,
      } satisfies ServiceDefinitionCatalogueItem;
    })
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

export async function getServiceDefinitionsReadPackage() {
  const store = oplocPackageStore();
  let retrieved;
  try {
    retrieved = await retrieveReadPackage<ServiceDefinitionsReadPackage>(store, SERVICE_DEFINITIONS_MANIFEST_KEY);
  } catch (error) {
    recordDataAccess({ app: "integration-hub", operation: "service-definitions.package.integrity-failure", source: "SNAPSHOT", documents: 0 });
    throw Object.assign(new Error("Service Definition read package integrity validation failed. Rebuild the package before serving traffic."), { status: 503, code: "SERVICE_DEFINITIONS_PACKAGE_INTEGRITY_FAILURE", cause: error });
  }
  if (!retrieved) throw Object.assign(new Error("Service Definition read package is unavailable."), { status: 503, code: "SERVICE_DEFINITIONS_PACKAGE_MISSING" });
  recordDataAccess({ app: "integration-hub", operation: "service-definitions.package.read", source: "SNAPSHOT", documents: retrieved.manifest.recordCount });
  return retrieved;
}

export function validateServiceDefinitionsReadPackage(value: ServiceDefinitionsReadPackage) {
  if (!value || !Array.isArray(value.serviceDefinitions)) throw new Error("Invalid Service Definition read package payload.");
  return value;
}

function historicalArrangementReference(value: unknown, serviceDefinitionId: string) {
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).entityType !== "Service Arrangement") return false;
  return [(value as Record<string, unknown>).previous, (value as Record<string, unknown>).current].some(candidate => {
    if (!candidate || typeof candidate !== "object") return false;
    const record = (candidate as Record<string, unknown>).record;
    return Boolean(record && typeof record === "object" && (record as Record<string, unknown>).serviceDefinitionId === serviceDefinitionId);
  });
}

function text(value: unknown) {
  const output = String(value || "").trim();
  return output || undefined;
}
