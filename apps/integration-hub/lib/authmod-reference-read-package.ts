import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { db } from "./firebase-admin";
import { isTerminatedLegend } from "./connection-rules";
import { oplocPackageStore } from "./oploc-read-package";
import { readCacheManifest } from "./integration-cache-server";
import type { ApplicationRegistryEntry, LegendReference } from "./authmod-core/model";
import type { CanonicalRecord } from "./types";

export const AUTHMOD_REFERENCE_DATASET = "integration-hub/authmod-references";
export const AUTHMOD_REFERENCE_MANIFEST_KEY = AUTHMOD_REFERENCE_DATASET;
export type AuthmodReferenceReadPackage = { applications: ApplicationRegistryEntry[]; legends: LegendReference[]; oplocs: { id: string; label: string; active: true }[] };

export async function rebuildAuthmodReferenceReadPackage(): Promise<ReadPackageManifest> {
  const [legendSnapshot, employmentSnapshot, oplocSnapshot, applicationSnapshot] = await Promise.all([
    db.collection("integrationHubCanonical").where("entityType", "==", "Legend").get(),
    db.collection("integrationHubCanonical").where("entityType", "==", "Employment").get(),
    db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").get(),
    db.collection("authmodApplications").get(),
  ]);
  const legends = legendSnapshot.docs.map(document => document.data() as CanonicalRecord);
  const employments = employmentSnapshot.docs.map(document => document.data() as CanonicalRecord);
  const payload: AuthmodReferenceReadPackage = {
    applications: applicationSnapshot.docs.map(document => document.data() as ApplicationRegistryEntry).sort((a, b) => a.appId.localeCompare(b.appId)),
    legends: legends.filter(value => value.canonicalId && value.lifecycleStatus !== "archived" && !isTerminatedLegend(value, employments)).map(value => ({ id: value.canonicalId!, label: String(value.record.displayName || value.record.preferredName || value.canonicalId), active: true })).sort((a, b) => a.label.localeCompare(b.label)),
    oplocs: oplocSnapshot.docs.map(document => document.data() as CanonicalRecord).filter(value => value.canonicalId && value.lifecycleStatus !== "archived" && value.publicationStatus !== "withdrawn" && String(value.record?.lifecycleState || "active") === "active").map(value => ({ id: value.canonicalId!, label: String(value.record?.approvedName || value.canonicalId), active: true as const })).sort((a, b) => a.label.localeCompare(b.label)),
  };
  const sourceVersion = [await readCacheManifest("legends"), await readCacheManifest("oplocs"), await readCacheManifest("applications")].map(value => value.version).join(":");
  recordDataAccess({ app: "integration-hub", operation: "authmod.references.package.rebuild", source: "FIRESTORE", documents: legendSnapshot.size + employmentSnapshot.size + oplocSnapshot.size + applicationSnapshot.size });
  const store = oplocPackageStore();
  const previous = await store.getManifest(AUTHMOD_REFERENCE_MANIFEST_KEY);
  const encoded = encodeReadPackage(AUTHMOD_REFERENCE_DATASET, (previous?.packageVersion || 0) + 1, payload, payload.applications.length + payload.legends.length + payload.oplocs.length, { contractVersion: "integration-hub.authmod-references.v1", sourceVersion: `authmod-references:${sourceVersion}` });
  return publishReadPackage(store, AUTHMOD_REFERENCE_MANIFEST_KEY, encoded);
}

export async function getAuthmodReferenceManifest() { return oplocPackageStore().getManifest(AUTHMOD_REFERENCE_MANIFEST_KEY); }
export async function getAuthmodReferenceReadPackage() {
  let result;
  try { result = await retrieveReadPackage<AuthmodReferenceReadPackage>(oplocPackageStore(), AUTHMOD_REFERENCE_MANIFEST_KEY); }
  catch (cause) { throw Object.assign(new Error("AUTHMOD reference read package integrity validation failed. Rebuild the package before serving traffic."), { status: 503, code: "AUTHMOD_REFERENCE_PACKAGE_INTEGRITY_FAILURE", cause }); }
  if (!result) throw Object.assign(new Error("AUTHMOD reference read package is unavailable."), { status: 503, code: "AUTHMOD_REFERENCE_PACKAGE_MISSING" });
  const sourceVersion = [await readCacheManifest("legends"), await readCacheManifest("oplocs"), await readCacheManifest("applications")].map(value => value.version).join(":");
  if (result.manifest.sourceVersion !== `authmod-references:${sourceVersion}`) throw Object.assign(new Error("AUTHMOD reference read package is stale. Rebuild the package before serving traffic."), { status: 503, code: "AUTHMOD_REFERENCE_PACKAGE_STALE" });
  recordDataAccess({ app: "integration-hub", operation: "authmod.references.package.read", source: "SNAPSHOT", documents: result.manifest.recordCount, cacheHit: false, packageVersion: result.manifest.packageVersion, dataset: AUTHMOD_REFERENCE_DATASET });
  return result.value;
}
