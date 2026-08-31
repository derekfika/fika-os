import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { sha256 } from "./profiler";
import { parseCanonical, type CanonicalEntityType } from "./schemas";
import type { CanonicalRecord } from "./types";
import { bumpCacheDatasets, cacheDatasetForEntityType } from "./integration-cache-server";
import { rebuildServiceArrangementsReadPackage } from "./service-arrangements-read-package";
import { rebuildServiceDefinitionsReadPackage } from "./service-definitions-read-package";

const canonical = () => db.collection("integrationHubCanonical");
const revisions = () => db.collection("integrationHubCanonicalRevisions");
const audit = () => db.collection("integrationHubGovernanceAudit");

type Lifecycle = "active" | "archived";
export type ConfigurationCommand =
  | { action: "save-service-definition"; canonicalId?: string; expectedVersion?: number; serviceName: string; description?: string; lifecycleState: "active" | "retired" }
  | { action: "save-service-arrangement"; canonicalId?: string; expectedVersion?: number; oplocId: string; operationalAreaId?: string; serviceDefinitionId: string; effectiveFrom: string; effectiveTo?: string; operationalNotes?: string; lifecycleState: Lifecycle }
  | { action: "save-equipment-type"; canonicalId?: string; expectedVersion?: number; name: string; description?: string; category?: string; lifecycleState: "active" | "retired" }
  | { action: "save-equipment-asset"; canonicalId?: string; expectedVersion?: number; assetName: string; equipmentTypeId: string; manufacturer?: string; model?: string; serialNumber?: string; installationDate?: string; warrantyExpiry?: string; notes?: string; lifecycleState: "active" | "retired" }
  | { action: "save-equipment-allocation"; canonicalId?: string; expectedVersion?: number; equipmentAssetId: string; oplocId: string; operationalAreaId?: string; effectiveFrom: string; effectiveTo?: string; operationalNotes?: string; lifecycleState: Lifecycle };

export type EquipmentTypeCatalogueItem = { canonicalId: string; name: string; description?: string; category?: string; lifecycleState: "active" | "retired"; version: number; assetUsageCount: number; historicUsage: boolean; canDelete: boolean };

export async function equipmentTypeCatalogueOverview(): Promise<{ equipmentTypes: EquipmentTypeCatalogueItem[] }> {
  const [recordsSnapshot, revisionsSnapshot] = await Promise.all([canonical().get(), revisions().get()]);
  const records = recordsSnapshot.docs.map(document => document.data() as CanonicalRecord);
  return { equipmentTypes: equipmentTypeCatalogue(records, revisionsSnapshot.docs.map(document => document.data()), "all") };
}

export async function deleteEquipmentType(actor: Actor, canonicalId: string, expectedVersion: number) {
  return db.runTransaction(async transaction => {
    const [recordsSnapshot, revisionsSnapshot] = await Promise.all([transaction.get(canonical()), transaction.get(revisions())]);
    const records = recordsSnapshot.docs.map(document => document.data() as CanonicalRecord);
    const current = records.find(record => record.canonicalId === canonicalId && record.entityType === "Equipment Type");
    if (!current) throw conflict("Equipment Type was not found.");
    if (Number(current.record.version) !== expectedVersion) throw conflict("This Equipment Type changed elsewhere. Refresh and try again.");
    const usage = equipmentTypeUsage(records, revisionsSnapshot.docs.map(document => document.data()), canonicalId);
    if (usage.assetUsageCount || usage.historicUsage) throw conflict("This Equipment Type has current or historical asset usage and cannot be permanently deleted. Archive it instead.");
    const now = new Date().toISOString();
    transaction.delete(canonical().doc(stableDocumentId(canonicalId)));
    transaction.set(revisions().doc(stableDocumentId(`${canonicalId}:deleted:${now}`)), { revisionId: `canonical-revision:${stableDocumentId(`${canonicalId}:deleted:${now}`)}`, canonicalId, entityType: "Equipment Type", version: Number(current.record.version), previous: current, current: null, changes: [{ path: "permanent-delete", before: current.record, after: null }], actorId: actor.uid, actorName: actor.name, reason: "Permanently deleted unused Equipment Type through the governed Connections workspace.", recordedAt: now });
    transaction.set(audit().doc(crypto.randomUUID()), { auditId: crypto.randomUUID(), action: "Equipment Type permanently deleted", entityReference: canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: "Unused controlled catalogue entry; no current or historical asset usage.", oplocId: null });
    return { deletedCanonicalId: canonicalId };
  });
}

export function equipmentTypeCatalogue(records: CanonicalRecord[], revisions: unknown[], lifecycle: "all" | "active" | "archived" = "all"): EquipmentTypeCatalogueItem[] {
  return records.filter(record => record.entityType === "Equipment Type" && record.lifecycleStatus !== "archived").map(record => {
    const lifecycleState = record.record.lifecycleState as "active" | "retired";
    const usage = equipmentTypeUsage(records, revisions, record.canonicalId);
    return { canonicalId: record.canonicalId, name: String(record.record.name || record.canonicalId), description: text(record.record.description), category: text(record.record.category), lifecycleState, version: Number(record.record.version || 0), ...usage, canDelete: !usage.assetUsageCount && !usage.historicUsage };
  }).filter(item => lifecycle === "all" || (lifecycle === "active" ? item.lifecycleState === "active" : item.lifecycleState === "retired")).sort((left, right) => left.name.localeCompare(right.name));
}

export function equipmentTypeUsage(records: CanonicalRecord[], revisions: unknown[], equipmentTypeId: string) {
  const currentAssets = records.filter(record => record.entityType === "Equipment Asset" && record.record.equipmentTypeId === equipmentTypeId);
  const historicAssets = revisions.some(revision => revisionContainsEquipmentType(revision, equipmentTypeId));
  return { assetUsageCount: currentAssets.length, historicUsage: historicAssets };
}

function revisionContainsEquipmentType(value: unknown, equipmentTypeId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const revision = value as Record<string, unknown>;
  if (revision.entityType === "Equipment Asset") return recordContainsEquipmentType(revision.previous, equipmentTypeId) || recordContainsEquipmentType(revision.current, equipmentTypeId);
  return false;
}

function recordContainsEquipmentType(value: unknown, equipmentTypeId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const record = candidate.record && typeof candidate.record === "object" ? candidate.record as Record<string, unknown> : candidate;
  return record.equipmentTypeId === equipmentTypeId;
}

export async function operationalConfigurationOverview(oplocId: string, operationalAreaId?: string) {
  const snapshot = await canonical().get();
  const records = snapshot.docs.map((document) => document.data() as CanonicalRecord);
  const definitions = named(records, "Service Definition", "serviceName");
  const equipmentTypes = named(records, "Equipment Type", "name");
  const allEquipmentTypes = named(records, "Equipment Type", "name", true);
  const assets = records.filter(record => record.entityType === "Equipment Asset" && record.lifecycleStatus !== "archived");
  const areas = records.filter(record => record.entityType === "Operational Area" && record.lifecycleStatus !== "archived" && record.record.oplocId === oplocId);
  const scope = <T extends CanonicalRecord>(record: T) => record.record.oplocId === oplocId && (operationalAreaId ? record.record.operationalAreaId === operationalAreaId : !record.record.operationalAreaId);
  const serviceNames = new Map(definitions.map(item => [item.canonicalId, item.label]));
  const typeNames = new Map(allEquipmentTypes.map(item => [item.canonicalId, item.label]));
  const assetNames = new Map(assets.map(item => [item.canonicalId, String(item.record.assetName || item.canonicalId)]));
  return {
    today: new Date().toISOString().slice(0, 10),
    serviceDefinitions: definitions,
    equipmentTypes,
    equipmentAssets: assets.filter(record => record.record.lifecycleState === "active").map(record => ({ canonicalId: record.canonicalId, label: assetNames.get(record.canonicalId)!, equipmentTypeId: String(record.record.equipmentTypeId || "") })).sort(byLabel),
    services: records.filter(record => record.entityType === "Service Arrangement" && record.lifecycleStatus !== "archived" && scope(record)).map(record => ({ canonicalId: record.canonicalId, serviceDefinitionId: String(record.record.serviceDefinitionId || ""), serviceLabel: serviceNames.get(String(record.record.serviceDefinitionId || "")) || "Unavailable service", effectiveFrom: String(record.record.effectiveFrom || ""), effectiveTo: text(record.record.effectiveTo), operationalNotes: text(record.record.operationalNotes), lifecycleState: String(record.record.lifecycleState || "active") as Lifecycle, version: Number(record.record.version || 0) })).sort(byService),
    allocations: records.filter(record => record.entityType === "Equipment Allocation" && record.lifecycleStatus !== "archived" && scope(record)).map(record => ({ canonicalId: record.canonicalId, equipmentAssetId: String(record.record.equipmentAssetId || ""), assetLabel: assetNames.get(String(record.record.equipmentAssetId || "")) || "Unavailable asset", equipmentTypeLabel: typeNames.get(String(assets.find(asset => asset.canonicalId === record.record.equipmentAssetId)?.record.equipmentTypeId || "")) || "Unavailable type", effectiveFrom: String(record.record.effectiveFrom || ""), effectiveTo: text(record.record.effectiveTo), operationalNotes: text(record.record.operationalNotes), lifecycleState: String(record.record.lifecycleState || "active") as Lifecycle, version: Number(record.record.version || 0) })).sort(byAsset),
    areas: areas.map(record => ({ canonicalId: record.canonicalId, label: String(record.record.name || record.canonicalId) })).sort(byLabel),
  };
}

export async function saveOperationalConfiguration(actor: Actor, command: ConfigurationCommand) {
  const entityType = entityFor(command.action);
  const canonicalId = command.canonicalId || generateCanonicalId(entityType);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(canonical());
    const records = snapshot.docs.map(document => document.data() as CanonicalRecord);
    const current = records.find(record => record.canonicalId === canonicalId);
    if (command.canonicalId && (!current || current.entityType !== entityType)) throw conflict(`${entityType} was not found.`);
    if (current && Number(current.record.version) !== Number(command.expectedVersion)) throw conflict("This record changed elsewhere. Refresh and try again.");
    validateCommand(records, command, canonicalId);
    const now = new Date().toISOString();
    const record = buildRecord(entityType, canonicalId, actor, now, current, command);
    const parsed = parseCanonical(entityType, record);
    if (!parsed.success) throw conflict(`${entityType} validation failed: ${parsed.error.issues[0]?.message || "Review the values."}`);
    const next: CanonicalRecord = { canonicalId, entityType, record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: current?.lifecycleStatus || "needs-review", ...(current?.publicationStatus ? { publicationStatus: current.publicationStatus } : {}) };
    writeHistory(transaction, actor, current || null, next, command.action, now);
    if (command.action === "save-equipment-allocation" && !current && command.lifecycleState === "active") {
      endPriorAllocations(transaction, actor, records, command, canonicalId, now);
    }
  });
  if (entityType === "Service Definition") {
    await rebuildServiceDefinitionsReadPackage();
    await rebuildServiceArrangementsReadPackage();
  } else if (entityType === "Service Arrangement") await rebuildServiceArrangementsReadPackage();
  if (command.action === "save-service-arrangement" || command.action === "save-equipment-allocation") {
    return operationalConfigurationOverview(command.oplocId, command.operationalAreaId);
  }
  return { record: canonicalId };
}

function validateCommand(records: CanonicalRecord[], command: ConfigurationCommand, canonicalId: string) {
  if ("oplocId" in command) {
    validateOperationalScope(records, command.oplocId, command.operationalAreaId);
  }
  if (command.action === "save-service-arrangement") {
    if (!activeReference(records, "Service Definition", command.serviceDefinitionId)) throw conflict("Choose an active Service Definition.");
    duplicate(records, "Service Arrangement", canonicalId, record => record.record.oplocId === command.oplocId && record.record.operationalAreaId === command.operationalAreaId && record.record.serviceDefinitionId === command.serviceDefinitionId && record.record.lifecycleState === "active" && effectivePeriodsOverlap(command.effectiveFrom, command.effectiveTo, String(record.record.effectiveFrom || ""), text(record.record.effectiveTo)), "This service already has an overlapping active arrangement in this delivery context.");
  }
  if (command.action === "save-equipment-asset" && !activeReference(records, "Equipment Type", command.equipmentTypeId)) throw conflict("Choose an active Equipment Type.");
  if (command.action === "save-equipment-allocation") {
    if (!activeReference(records, "Equipment Asset", command.equipmentAssetId)) throw conflict("Choose an active Equipment Asset.");
    duplicate(records, "Equipment Allocation", canonicalId, record => record.record.equipmentAssetId === command.equipmentAssetId && record.record.oplocId === command.oplocId && record.record.operationalAreaId === command.operationalAreaId && record.record.lifecycleState === "active", "This asset is already active in this operating context.");
  }
}

function buildRecord(entityType: Exclude<CanonicalEntityType, "OPLOC" | "Address" | "Legend" | "Employment" | "Operational Assignment" | "Operational Capability" | "Capability Enablement" | "Operational Area Type" | "Operational Area" | "Staffing Role" | "Site Staffing Requirement" | "Site Role Assignment" | "Production Unit" | "Till Item" | "Till Item Variation" | "Product Category" | "Absence" | "Site" | "Site Assignment" | "Source Mapping" | "Operational Placement Evidence">, canonicalId: string, actor: Actor, now: string, current: CanonicalRecord | undefined, command: ConfigurationCommand) {
  const base = current ? { ...structuredClone(current.record), version: Number(current.record.version || 0) + 1, updatedAt: now, updatedBy: actor.uid } : { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: { developmentModel: true } } };
  const common = { ...base, entityType, canonicalId };
  if (command.action === "save-service-definition") return { ...common, serviceName: command.serviceName.trim(), ...maybe("description", command.description), lifecycleState: command.lifecycleState };
  if (command.action === "save-service-arrangement") return { ...common, oplocId: command.oplocId, ...maybe("operationalAreaId", command.operationalAreaId), serviceDefinitionId: command.serviceDefinitionId, effectiveFrom: command.effectiveFrom, ...maybe("effectiveTo", command.effectiveTo), ...maybe("operationalNotes", command.operationalNotes), lifecycleState: command.lifecycleState };
  if (command.action === "save-equipment-type") return { ...common, name: command.name.trim(), ...maybe("description", command.description), ...maybe("category", command.category), lifecycleState: command.lifecycleState };
  if (command.action === "save-equipment-asset") return { ...common, assetName: command.assetName.trim(), equipmentTypeId: command.equipmentTypeId, ...maybe("manufacturer", command.manufacturer), ...maybe("model", command.model), ...maybe("serialNumber", command.serialNumber), ...maybe("installationDate", command.installationDate), ...maybe("warrantyExpiry", command.warrantyExpiry), ...maybe("notes", command.notes), lifecycleState: command.lifecycleState };
  return { ...common, equipmentAssetId: command.equipmentAssetId, oplocId: command.oplocId, ...maybe("operationalAreaId", command.operationalAreaId), effectiveFrom: command.effectiveFrom, ...maybe("effectiveTo", command.effectiveTo), ...maybe("operationalNotes", command.operationalNotes), lifecycleState: command.lifecycleState };
}

function endPriorAllocations(transaction: FirebaseFirestore.Transaction, actor: Actor, records: CanonicalRecord[], command: Extract<ConfigurationCommand, { action: "save-equipment-allocation" }>, newId: string, now: string) {
  const priorIds = new Set(activeAllocationIdsForAsset(records, command.equipmentAssetId, newId));
  records.filter(record => priorIds.has(record.canonicalId)).forEach(current => {
    const record = { ...structuredClone(current.record), lifecycleState: "archived", effectiveTo: command.effectiveFrom, version: Number(current.record.version || 0) + 1, updatedAt: now, updatedBy: actor.uid };
    const next: CanonicalRecord = { ...current, record, dataHash: sha256(JSON.stringify(record)) };
    writeHistory(transaction, actor, current, next, "equipment-allocation-moved", now);
  });
}

export function validateOperationalScope(records: CanonicalRecord[], oplocId: string, operationalAreaId?: string) {
  const oploc = records.find(record => record.entityType === "OPLOC" && record.canonicalId === oplocId && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active");
  if (!oploc) throw conflict("Choose an active canonical OPLOC.");
  if (operationalAreaId) {
    const area = records.find(record => record.entityType === "Operational Area" && record.canonicalId === operationalAreaId && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active" && record.record.oplocId === oplocId);
    if (!area) throw conflict("The selected Operational Area must be active and belong to this OPLOC.");
  }
}

export function activeAllocationIdsForAsset(records: CanonicalRecord[], equipmentAssetId: string, exceptId?: string) {
  return records.filter(record => record.entityType === "Equipment Allocation" && record.canonicalId !== exceptId && record.lifecycleStatus !== "archived" && record.record.equipmentAssetId === equipmentAssetId && record.record.lifecycleState === "active").map(record => record.canonicalId);
}

function writeHistory(transaction: FirebaseFirestore.Transaction, actor: Actor, previous: CanonicalRecord | null, next: CanonicalRecord, action: string, now: string) {
  const dataset = cacheDatasetForEntityType(next.entityType);
  if (dataset) bumpCacheDatasets(transaction, [dataset], now);
  transaction.set(canonical().doc(stableDocumentId(next.canonicalId)), next);
  transaction.set(revisions().doc(stableDocumentId(`${next.canonicalId}:${next.record.version}`)), { revisionId: `canonical-revision:${stableDocumentId(`${next.canonicalId}:${next.record.version}`)}`, canonicalId: next.canonicalId, entityType: next.entityType, version: next.record.version, previous, current: next, changes: [{ path: action, before: previous?.record || null, after: next.record }], actorId: actor.uid, actorName: actor.name, reason: `${previous ? "Updated" : "Created"} ${next.entityType} through the governed Connections workspace.`, recordedAt: now });
  transaction.set(audit().doc(crypto.randomUUID()), { auditId: crypto.randomUUID(), action: `${next.entityType} ${previous ? "updated" : "created"}`, entityReference: next.canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: "Governed manual operational configuration.", oplocId: next.record.oplocId || null });
}

function activeReference(records: CanonicalRecord[], type: CanonicalEntityType, id: string) { return records.some(record => record.entityType === type && record.canonicalId === id && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active"); }
function duplicate(records: CanonicalRecord[], type: CanonicalEntityType, id: string, matches: (record: CanonicalRecord) => boolean, message: string) { if (records.some(record => record.entityType === type && record.canonicalId !== id && record.lifecycleStatus !== "archived" && matches(record))) throw conflict(message); }
function entityFor(action: ConfigurationCommand["action"]): "Service Definition" | "Service Arrangement" | "Equipment Type" | "Equipment Asset" | "Equipment Allocation" { return ({ "save-service-definition": "Service Definition", "save-service-arrangement": "Service Arrangement", "save-equipment-type": "Equipment Type", "save-equipment-asset": "Equipment Asset", "save-equipment-allocation": "Equipment Allocation" } as const)[action]; }
function named(records: CanonicalRecord[], type: CanonicalEntityType, field: string, includeRetired = false) { return records.filter(record => record.entityType === type && record.lifecycleStatus !== "archived" && (includeRetired || record.record.lifecycleState === "active")).map(record => ({ canonicalId: record.canonicalId, label: String(record.record[field] || record.canonicalId), description: text(record.record.description) })).sort(byLabel); }
function text(value: unknown) { const valueAsText = String(value || "").trim(); return valueAsText || undefined; }
function maybe(key: string, value: unknown) { const valueAsText = text(value); return valueAsText ? { [key]: valueAsText } : {}; }
function effectivePeriodsOverlap(leftFrom: string, leftTo: string | undefined, rightFrom: string, rightTo: string | undefined) { const leftEnd = leftTo || "9999-12-31"; const rightEnd = rightTo || "9999-12-31"; return leftFrom <= rightEnd && rightFrom <= leftEnd; }
function byLabel(left: { label: string }, right: { label: string }) { return left.label.localeCompare(right.label); }
function byService(left: { serviceLabel: string }, right: { serviceLabel: string }) { return left.serviceLabel.localeCompare(right.serviceLabel); }
function byAsset(left: { assetLabel: string }, right: { assetLabel: string }) { return left.assetLabel.localeCompare(right.assetLabel); }
function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
