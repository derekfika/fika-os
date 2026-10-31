/**
 * Governed storage for the booking service -> Item category layout (issue #175).
 *
 * Follows the routing precedent: a small governed collection with its own optimistic version, plus an append-only revision
 * per write. Documents: `company` (all services) and one sparse document per OPLOC (only the services that site overrides).
 * Reads are bounded (one company document + at most ~100 site documents) and only happen when the catalogue package is rebuilt.
 */
import { db } from "./firebase-admin";
import { stableDocumentId } from "./canonical-editor";
import { sha256 } from "./profiler";
import { effectiveServiceLayout, SERVICE_IDS, type ServiceLayoutPackage, type ServiceRule, type ServiceRules } from "@fika/server-shared/hospitality-service-layout";

export const SERVICE_LAYOUT_COLLECTION = "integrationHubHospitalityServiceLayout";
export const SERVICE_LAYOUT_REVISIONS = "integrationHubHospitalityServiceLayoutRevisions";
export const COMPANY_LAYOUT_ID = "company";
export const layoutCollection = () => db.collection(SERVICE_LAYOUT_COLLECTION);
export const layoutRevisions = () => db.collection(SERVICE_LAYOUT_REVISIONS);
export const layoutDocId = (oplocId?: string) => (oplocId ? `site-${stableDocumentId(oplocId)}` : COMPANY_LAYOUT_ID);

export type StoredServiceLayout = {
  schema: 1; scope: "company" | "site"; oplocId?: string; version: number; services: ServiceRules;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
};

/** Pure: stored documents -> the package section. A hash of the documents (not of "now") is the version, so republishing is deterministic. */
export function layoutPackageFromDocuments(documents: StoredServiceLayout[]): ServiceLayoutPackage {
  const company = documents.find(document => document.scope === "company");
  const sites: Record<string, ServiceRules> = {};
  for (const document of documents) if (document.scope === "site" && document.oplocId) sites[document.oplocId] = document.services;
  const version = documents.length ? sha256(JSON.stringify([...documents].sort((a, b) => (a.oplocId || "").localeCompare(b.oplocId || "")).map(document => [document.scope, document.oplocId || "", document.version]))).slice(0, 16) : "seed";
  return effectiveServiceLayout({ company: company?.services, sites, version });
}

/** Bounded admin read used when the package is rebuilt: never on a booking or portal read. */
export async function readStoredServiceLayouts(): Promise<StoredServiceLayout[]> {
  const snapshot = await layoutCollection().limit(101).get();
  if (snapshot.size > 100) throw new Error("Service layout exceeds the bounded 100-document limit.");
  return snapshot.docs.map(doc => doc.data() as StoredServiceLayout);
}

/** Rules for one scope with every service present, so an edit replaces exactly one service and nothing else. */
export function completeRules(rules: ServiceRules | undefined, scope: "company" | "site"): ServiceRules {
  if (scope === "site") return { ...(rules || {}) };
  const result: ServiceRules = {};
  const base = effectiveServiceLayout({ company: rules }).company;
  for (const id of SERVICE_IDS) result[id] = base[id] as ServiceRule;
  return result;
}
