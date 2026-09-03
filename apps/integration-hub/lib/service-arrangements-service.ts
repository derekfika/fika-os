import { db } from "./firebase-admin";
import type { CanonicalRecord } from "./types";
import { isPermittedOploc, type PermittedOplocScope } from "./oploc-authorization";
import { buildOplocRedirects, legacyOplocIds } from "./oploc-redirects";

const canonical = () => db.collection("integrationHubCanonical");
export type ServiceArrangementItem = { canonicalId: string; serviceDefinitionId: string; serviceLabel: string; oplocId: string; oplocLabel: string; operationalAreaId?: string; operationalAreaLabel?: string; effectiveFrom: string; effectiveTo?: string; lifecycleState: "active" | "archived"; operationalNotes?: string; version: number };
export type ServiceArrangementsOverview = { today: string; serviceDefinitions: Array<{ canonicalId: string; label: string }>; oplocs: Array<{ canonicalId: string; label: string; legacyIds?: string[] }>; areas: Array<{ canonicalId: string; label: string; oplocId: string }>; arrangements: ServiceArrangementItem[]; oplocRedirects?: Record<string, string> };
export async function serviceArrangementsOverview() { const snapshot = await canonical().get(); return serviceArrangementsFromRecords(snapshot.docs.map(document => document.data() as CanonicalRecord)); }
export function serviceArrangementsFromRecords(records: CanonicalRecord[], today = new Date().toISOString().slice(0,10)): ServiceArrangementsOverview {
  const redirects = buildOplocRedirects(records);
  const canonicalId = (id: string) => redirects[id] || id;
  const active = (type: string) => records.filter(record => record.entityType === type && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active");
  const definitions = active("Service Definition").map(record => ({ canonicalId: record.canonicalId, label: String(record.record.serviceName || record.canonicalId) }));
  const oplocs = active("OPLOC").map(record => { const legacyIds = legacyOplocIds(redirects, record.canonicalId); return { canonicalId: record.canonicalId, label: String(record.record.approvedName || record.canonicalId), ...(legacyIds.length ? { legacyIds } : {}) }; });
  const areas = active("Operational Area").map(record => ({ canonicalId: record.canonicalId, label: String(record.record.name || record.canonicalId), oplocId: canonicalId(String(record.record.oplocId || "")) }));
  const names = new Map(definitions.map(item => [item.canonicalId, item.label])); const locationNames = new Map(oplocs.map(item => [item.canonicalId, item.label])); const areaNames = new Map(areas.map(item => [item.canonicalId, item.label]));
  const arrangements = records.filter(record => record.entityType === "Service Arrangement" && record.lifecycleStatus !== "archived").map(record => { const oplocId = canonicalId(String(record.record.oplocId || "")); return { canonicalId: record.canonicalId, serviceDefinitionId: String(record.record.serviceDefinitionId || ""), serviceLabel: names.get(String(record.record.serviceDefinitionId || "")) || "Archived service type", oplocId, oplocLabel: locationNames.get(oplocId) || "Archived OPLOC", operationalAreaId: string(record.record.operationalAreaId), operationalAreaLabel: areaNames.get(String(record.record.operationalAreaId || "")), effectiveFrom: String(record.record.effectiveFrom || ""), effectiveTo: string(record.record.effectiveTo), lifecycleState: String(record.record.lifecycleState || "active") as "active" | "archived", operationalNotes: string(record.record.operationalNotes), version: Number(record.record.version || 0) }; }).sort((left,right) => left.serviceLabel.localeCompare(right.serviceLabel) || left.oplocLabel.localeCompare(right.oplocLabel));
  return { today, serviceDefinitions: definitions.sort(byLabel), oplocs: oplocs.sort(byLabel), areas: areas.sort(byLabel), arrangements, oplocRedirects: redirects };
}
export function isServiceArrangementEffectiveOn(arrangement: Pick<ServiceArrangementItem, "effectiveFrom" | "effectiveTo" | "lifecycleState">, serviceDate: string) { return arrangement.lifecycleState === "active" && arrangement.effectiveFrom <= serviceDate && (!arrangement.effectiveTo || arrangement.effectiveTo >= serviceDate); }
export function filterServiceArrangements(overview: ServiceArrangementsOverview, input: { oplocIds?: ReadonlySet<string> | PermittedOplocScope; serviceDefinitionId?: string; serviceDate?: string }) {
  const allowed = (id: string) => !input.oplocIds || isPermittedOploc(input.oplocIds, id);
  const arrangements = overview.arrangements.filter(item => allowed(item.oplocId) && (!input.serviceDefinitionId || item.serviceDefinitionId === input.serviceDefinitionId) && (!input.serviceDate || isServiceArrangementEffectiveOn(item, input.serviceDate)));
  return { ...overview, oplocs: overview.oplocs.filter(item => allowed(item.canonicalId)), areas: overview.areas.filter(item => allowed(item.oplocId)), arrangements };
}
function string(value: unknown) { const output = String(value || "").trim(); return output || undefined; }
function byLabel(left: { label: string }, right: { label: string }) { return left.label.localeCompare(right.label); }
