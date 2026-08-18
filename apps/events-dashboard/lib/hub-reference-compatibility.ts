import type { EventRecord } from "./types";
import type { HubOperatingReadContract } from "./hub-operating-read-contract";

export type HubReferenceCompatibility = { id: string; field: "responsibleOplocId" | "operationalAreaId" | "siteId" | "serviceArrangementIds" | "equipmentAssetIds"; status: "active" | "historical" | "unresolved"; label: string };

export function assessEventHubReferences(event: EventRecord, contract: HubOperatingReadContract): HubReferenceCompatibility[] {
  const active = [...contract.oplocs, ...contract.operationalAreas, ...contract.serviceArrangements, ...contract.equipmentAssets].map(item => [item.canonicalId, item.label] as const);
  const historical = contract.historical.map(item => [item.canonicalId, item.label] as const);
  const resolve = (id: string, field: HubReferenceCompatibility["field"]): HubReferenceCompatibility | null => { if (!id) return null; const current = active.find(item => item[0] === id); if (current) return { id, field, status: "active", label: current[1] }; const old = historical.find(item => item[0] === id); return old ? { id, field, status: "historical", label: old[1] } : { id, field, status: "unresolved", label: id }; };
  return [resolve(event.responsibleOplocId, "responsibleOplocId"), resolve(event.operationalAreaId || "", "operationalAreaId"), resolve(event.siteId, "siteId"), ...(event.serviceArrangementIds || []).map(id => resolve(id, "serviceArrangementIds")), ...(event.equipmentAssetIds || []).map(id => resolve(id, "equipmentAssetIds"))].filter(Boolean) as HubReferenceCompatibility[];
}
