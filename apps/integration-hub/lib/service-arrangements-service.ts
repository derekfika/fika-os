import { db } from "./firebase-admin";
import type { CanonicalRecord } from "./types";

const canonical = () => db.collection("integrationHubCanonical");
export async function serviceArrangementsOverview() { const snapshot = await canonical().get(); return serviceArrangementsFromRecords(snapshot.docs.map(document => document.data() as CanonicalRecord)); }
export function serviceArrangementsFromRecords(records: CanonicalRecord[]) {
  const active = (type: string) => records.filter(record => record.entityType === type && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active");
  const definitions = active("Service Definition").map(record => ({ canonicalId: record.canonicalId, label: String(record.record.serviceName || record.canonicalId) }));
  const oplocs = active("OPLOC").map(record => ({ canonicalId: record.canonicalId, label: String(record.record.approvedName || record.canonicalId) }));
  const areas = active("Operational Area").map(record => ({ canonicalId: record.canonicalId, label: String(record.record.name || record.canonicalId), oplocId: String(record.record.oplocId || "") }));
  const names = new Map(definitions.map(item => [item.canonicalId, item.label])); const locationNames = new Map(oplocs.map(item => [item.canonicalId, item.label])); const areaNames = new Map(areas.map(item => [item.canonicalId, item.label]));
  const arrangements = records.filter(record => record.entityType === "Service Arrangement" && record.lifecycleStatus !== "archived").map(record => ({ canonicalId: record.canonicalId, serviceDefinitionId: String(record.record.serviceDefinitionId || ""), serviceLabel: names.get(String(record.record.serviceDefinitionId || "")) || "Archived service type", oplocId: String(record.record.oplocId || ""), oplocLabel: locationNames.get(String(record.record.oplocId || "")) || "Archived OPLOC", operationalAreaId: string(record.record.operationalAreaId), operationalAreaLabel: areaNames.get(String(record.record.operationalAreaId || "")), effectiveFrom: String(record.record.effectiveFrom || ""), effectiveTo: string(record.record.effectiveTo), lifecycleState: String(record.record.lifecycleState || "active") as "active" | "archived", operationalNotes: string(record.record.operationalNotes), version: Number(record.record.version || 0) })).sort((left,right) => left.serviceLabel.localeCompare(right.serviceLabel) || left.oplocLabel.localeCompare(right.oplocLabel));
  return { today: new Date().toISOString().slice(0,10), serviceDefinitions: definitions.sort(byLabel), oplocs: oplocs.sort(byLabel), areas: areas.sort(byLabel), arrangements };
}
function string(value: unknown) { const output = String(value || "").trim(); return output || undefined; }
function byLabel(left: { label: string }, right: { label: string }) { return left.label.localeCompare(right.label); }
