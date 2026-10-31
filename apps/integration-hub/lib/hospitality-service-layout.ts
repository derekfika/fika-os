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
import { buildServiceLayoutView, storedServiceLayoutView, type CataloguePayload, type CatalogueRow, type ServiceLayoutStoredView, type ServiceLayoutView } from "./hospitality-catalogue-types";
import type { Transaction } from "firebase-admin/firestore";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

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

/** Booking commands need just the company and selected site's authority, inside their existing transaction. */
export async function readBookingServiceLayout(transaction: Pick<Transaction, "getAll">, oplocId: string): Promise<ServiceLayoutPackage> {
  if (!oplocId) throw Object.assign(new Error("A canonical site is required to verify service settings."), { status: 503 });
  const snapshots = await transaction.getAll(layoutCollection().doc(COMPANY_LAYOUT_ID), layoutCollection().doc(layoutDocId(oplocId)));
  recordDataAccess({ app: "integration-hub", operation: "hospitality.booking.service-layout", source: "FIRESTORE", dataset: SERVICE_LAYOUT_COLLECTION, documents: snapshots.filter(snapshot => snapshot.exists).length, estimatedBillableReads: 2, firestoreReadKind: "transaction" });
  const documents = snapshots.flatMap((snapshot, index) => {
    if (!snapshot.exists) return [];
    const document = snapshot.data() as StoredServiceLayout;
    const validRule = (rule: unknown) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
      const value = rule as ServiceRule;
      return Array.isArray(value.categories) && value.categories.length <= 40 && value.categories.every(category => typeof category === "string" && category.length > 0 && category.length <= 120 && category === category.trim()) && new Set(value.categories).size === value.categories.length && (value.hidden === undefined || typeof value.hidden === "boolean");
    };
    if (!document || document.schema !== 1 || document.scope !== (index ? "site" : "company") || (index && document.oplocId !== oplocId) || !Number.isInteger(document.version) || document.version < 1 || !document.services || typeof document.services !== "object" || Array.isArray(document.services) || Object.entries(document.services).some(([id, rule]) => !(SERVICE_IDS as readonly string[]).includes(id) || !validRule(rule)) || (!index && !SERVICE_IDS.every(id => validRule(document.services[id])))) {
      throw Object.assign(new Error("The site's Hospitality service settings are invalid. Resolve the governed configuration before booking."), { status: 503 });
    }
    return [document];
  });
  // No stored override means the provider's governed seed, exactly as in the published package.
  return layoutPackageFromDocuments(documents);
}

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

/**
 * Admin editor read model: the stored layout documents (versions are the `expectedVersion` for the layout commands) plus the
 * vocabulary of category names. A plain bounded read of the layout collection (<= 101 documents) and the Items already loaded
 * by the catalogue read; it never publishes or rebuilds the catalogue package.
 */
export async function loadStoredServiceLayoutView(): Promise<ServiceLayoutStoredView> {
  return storedServiceLayoutView(await readStoredServiceLayouts());
}
export async function loadServiceLayoutView(rows: ReadonlyArray<Pick<CatalogueRow, "status" | "category">>): Promise<ServiceLayoutView> {
  return buildServiceLayoutView(await readStoredServiceLayouts(), rows.filter(row => row.status === "active").map(row => row.category));
}
export async function attachServiceLayout(payload: CataloguePayload): Promise<CataloguePayload> {
  return { ...payload, serviceLayout: await loadServiceLayoutView(payload.rows) };
}
