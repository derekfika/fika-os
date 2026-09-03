import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { db } from "./firebase-admin";
import { oplocPackageStore } from "./oploc-read-package";
import { serviceArrangementsFromRecords, type ServiceArrangementsOverview } from "./service-arrangements-service";
import type { CanonicalRecord } from "./types";

export const SERVICE_ARRANGEMENTS_DATASET = "integration-hub/service-arrangements";
export const SERVICE_ARRANGEMENTS_MANIFEST_KEY = SERVICE_ARRANGEMENTS_DATASET;
export type ServiceArrangementsReadPackage = Omit<ServiceArrangementsOverview, "today">;

export async function rebuildServiceArrangementsReadPackage(): Promise<ReadPackageManifest> {
  const snapshot = await db.collection("integrationHubCanonical").get();
  recordDataAccess({ app: "integration-hub", operation: "service-arrangements.package.rebuild.source", source: "FIRESTORE", documents: snapshot.size });
  const overview = serviceArrangementsFromRecords(snapshot.docs.map(document => document.data() as CanonicalRecord));
  const value: ServiceArrangementsReadPackage = { serviceDefinitions: overview.serviceDefinitions, oplocs: overview.oplocs, areas: overview.areas, arrangements: overview.arrangements, oplocRedirects: overview.oplocRedirects };
  const store = oplocPackageStore();
  const previous = await store.getManifest(SERVICE_ARRANGEMENTS_MANIFEST_KEY);
  const encoded = encodeReadPackage(SERVICE_ARRANGEMENTS_DATASET, (previous?.packageVersion || 0) + 1, value, value.arrangements.length, { contractVersion: "integration-hub.service-arrangements.v1", sourceVersion: `canonical:${snapshot.size}` });
  return publishReadPackage<ServiceArrangementsReadPackage>(store, SERVICE_ARRANGEMENTS_MANIFEST_KEY, encoded);
}

export async function getServiceArrangementsReadPackage() {
  const store = oplocPackageStore();
  let retrieved;
  try { retrieved = await retrieveReadPackage<ServiceArrangementsReadPackage>(store, SERVICE_ARRANGEMENTS_MANIFEST_KEY); }
  catch (error) { recordDataAccess({ app: "integration-hub", operation: "service-arrangements.package.integrity-failure", source: "SNAPSHOT", documents: 0 }); throw Object.assign(new Error("Service Arrangement read package integrity validation failed. Rebuild the package before serving traffic."), { status: 503, code: "SERVICE_ARRANGEMENTS_PACKAGE_INTEGRITY_FAILURE", cause: error }); }
  if (!retrieved) throw Object.assign(new Error("Service Arrangement read package is unavailable."), { status: 503, code: "SERVICE_ARRANGEMENTS_PACKAGE_MISSING" });
  recordDataAccess({ app: "integration-hub", operation: "service-arrangements.package.read", source: "SNAPSHOT", documents: retrieved.manifest.recordCount });
  return retrieved;
}

export function validateServiceArrangementsReadPackage(value: ServiceArrangementsReadPackage) {
  if (!value || !Array.isArray(value.serviceDefinitions) || !Array.isArray(value.oplocs) || !Array.isArray(value.areas) || !Array.isArray(value.arrangements)) throw new Error("Invalid Service Arrangement read package payload.");
  return value;
}
