import { eventStaffingOverviewFromRecords, suggestionsFromRecords } from "./event-staffing-service";
import { isTerminatedLegend } from "./connection-rules";
import type { CanonicalRecord } from "./types";
import { listCanonicalRecordsByTypes } from "./canonical-oplocs";

export const HUB_OPERATING_READ_CONTRACT_VERSION = "fika.hub-operating-read.v1";
type Reference = { canonicalId: string; label: string; lifecycleStatus: string; parent?: { canonicalId: string; label: string } };

export async function eventsOperatingReadContract(referenceIds: string[] = []) {
  const records = await listCanonicalRecordsByTypes(["OPLOC", "Operational Area", "Service Definition", "Service Arrangement", "Equipment Asset", "Equipment Allocation", "Employment", "Legend", "Operational Team", "Team Membership", "Event Role", "Event Staffing Preference"]);
  return eventsOperatingReadContractFromRecords(records as CanonicalRecord[], referenceIds);
}

export function eventsOperatingReadContractFromRecords(records: CanonicalRecord[], referenceIds: string[] = []) {
  const today = new Date().toISOString().slice(0, 10);
  const active = (record: CanonicalRecord, type: string) => record.entityType === type && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active";
  const allOplocs = records.filter(record => record.entityType === "OPLOC");
  const oplocs = allOplocs.filter(record => active(record, "OPLOC")).map(record => reference(record, String(record.record.approvedName || record.canonicalId)));
  const oplocNames = new Map(allOplocs.map(record => [record.canonicalId, String(record.record.approvedName || record.canonicalId)]));
  const activeOplocIds = new Set(oplocs.map(record => record.canonicalId));
  const allAreas = records.filter(record => record.entityType === "Operational Area");
  const areas = allAreas.filter(record => active(record, "Operational Area") && activeOplocIds.has(String(record.record.oplocId || ""))).map(record => ({ ...reference(record, String(record.record.name || record.canonicalId)), oplocId: String(record.record.oplocId), oplocLabel: oplocNames.get(String(record.record.oplocId)) || "Unavailable OPLOC" }));
  const activeAreaIds = new Set(areas.map(record => record.canonicalId));
  const definitions = records.filter(record => active(record, "Service Definition"));
  const definitionNames = new Map(records.filter(record => record.entityType === "Service Definition").map(record => [record.canonicalId, String(record.record.serviceName || record.canonicalId)]));
  const serviceDefinitions = definitions.map(record => reference(record, String(record.record.serviceName || record.canonicalId)));
  const serviceArrangements = records.filter(record => active(record, "Service Arrangement") && activeOplocIds.has(String(record.record.oplocId || "")) && (!record.record.operationalAreaId || activeAreaIds.has(String(record.record.operationalAreaId))) && definitions.some(definition => definition.canonicalId === record.record.serviceDefinitionId) && effectiveNow(record.record, today)).map(record => ({ ...reference(record, definitionNames.get(String(record.record.serviceDefinitionId)) || "Unavailable service"), serviceDefinitionId: String(record.record.serviceDefinitionId), oplocId: String(record.record.oplocId), oplocLabel: oplocNames.get(String(record.record.oplocId)) || "Unavailable OPLOC", operationalAreaId: optional(record.record.operationalAreaId), operationalAreaLabel: areaLabel(allAreas, String(record.record.operationalAreaId || "")), scope: record.record.operationalAreaId ? "operational-area" as const : "oploc-wide" as const }));
  const assets = records.filter(record => active(record, "Equipment Asset"));
  const assetNames = new Map(records.filter(record => record.entityType === "Equipment Asset").map(record => [record.canonicalId, String(record.record.assetName || record.canonicalId)]));
  const equipmentAssets = records.filter(record => active(record, "Equipment Allocation") && activeOplocIds.has(String(record.record.oplocId || "")) && (!record.record.operationalAreaId || activeAreaIds.has(String(record.record.operationalAreaId))) && assets.some(asset => asset.canonicalId === record.record.equipmentAssetId) && effectiveNow(record.record, today)).map(record => ({ ...reference(record, assetNames.get(String(record.record.equipmentAssetId)) || "Unavailable asset"), assetId: String(record.record.equipmentAssetId), oplocId: String(record.record.oplocId), oplocLabel: oplocNames.get(String(record.record.oplocId)) || "Unavailable OPLOC", operationalAreaId: optional(record.record.operationalAreaId), operationalAreaLabel: areaLabel(allAreas, String(record.record.operationalAreaId || "")) }));
  const employments = records.filter(record => record.entityType === "Employment" && record.lifecycleStatus !== "archived");
  const legends = records.filter(record => record.entityType === "Legend" && record.lifecycleStatus !== "archived" && !isTerminatedLegend(record, employments)).map(record => reference(record, String(record.record.preferredName || record.record.displayName || record.canonicalId)));
  const staffing = eventStaffingOverviewFromRecords(records);
  const eventRoles = staffing.eventRoles.map(role => ({ ...role, suggestions: suggestionsFromRecords(records, role.label, today) }));
  const historical = records.filter(record => referenceIds.includes(record.canonicalId)).map(record => ({ ...reference(record, displayName(record)), entityType: record.entityType, current: active(record, record.entityType) }));
  return { contractVersion: HUB_OPERATING_READ_CONTRACT_VERSION, generatedAt: new Date().toISOString(), oplocs, operationalAreas: areas, serviceDefinitions, serviceArrangements, equipmentAssets, legends, eventRoles, historical };
}

function reference(record: CanonicalRecord, label: string): Reference { return { canonicalId: record.canonicalId, label, lifecycleStatus: String(record.record.lifecycleState || record.lifecycleStatus || "unknown") }; }
function displayName(record: CanonicalRecord) { return String(record.record.approvedName || record.record.name || record.record.serviceName || record.record.assetName || record.record.roleName || record.record.preferredName || record.record.displayName || record.canonicalId); }
function effectiveNow(record: Record<string, unknown>, today: string) { const from = String(record.effectiveFrom || ""); const to = optional(record.effectiveTo); return Boolean(from && from <= today && (!to || to >= today)); }
function optional(value: unknown) { const output = String(value || "").trim(); return output || undefined; }
function areaLabel(areas: CanonicalRecord[], id: string) { const record = areas.find(area => area.canonicalId === id); return record ? String(record.record.name || id) : undefined; }
