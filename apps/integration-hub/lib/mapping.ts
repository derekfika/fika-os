import crypto from "node:crypto";
import { CanonicalEntityNames, type CanonicalEntityType, type MappingDefinition, type StagingRecord } from "./schemas";
import type { CanonicalRecord, WorksheetProfile } from "./types";
import { sha256, stableId } from "./profiler";
import { buildRotaWorkLocationEvidenceFromNormalised } from "./rota-enrichment";
import { recordsShareProviderIdentity } from "./legend-identity-reconciliation";

const CANONICAL_BUSINESS_FIELDS: Record<string, string[]> = { Legend: ["displayName", "workEmail", "jobTitle", "employmentState"], Employment: ["legendId", "employmentState", "startDate", "terminationDate", "contractualJobTitle"], Absence: ["legendId", "startDate", "endDate", "absenceType", "approvalState"], Site: ["name", "operationalLocationId", "address"], OPLOC: ["approvedName", "lifecycleState"], "Staffing Role": ["name"], "Production Unit": ["name", "operationalLocationId"], "Till Item": ["name", "categoryId"], "Till Item Variation": ["tillItemId", "name", "sku", "sitePrices"], "Product Category": ["name"] };

function canonicalBusinessFields(entityType: string, values: Record<string, unknown>) {
  return Object.fromEntries((CANONICAL_BUSINESS_FIELDS[entityType] || []).filter(key => values[key] !== undefined).map(key => [key, values[key]]));
}

const FIELD_ALIASES: Record<string, string[]> = {
  displayName: ["name", "full name", "employee name", "display name"], workEmail: ["email", "work email"], jobTitle: ["job title", "role"], employmentState: ["employment state", "status"],
  name: ["name", "site name", "item name", "category"], approvedName: ["approved name", "operational location", "oploc"], lifecycleState: ["lifecycle", "lifecycle state"],
  startDate: ["start", "start date", "date from"], endDate: ["end", "end date", "date to"], absenceType: ["absence", "absence type", "leave type"], approvalState: ["approval state", "status"], sku: ["sku"],
};

export function targetFields(type: CanonicalEntityType) {
  const common = ["displayName", "workEmail", "jobTitle", "employmentState", "name", "approvedName", "lifecycleState", "startDate", "endDate", "absenceType", "approvalState", "sku"];
  if (type === "Legend") return common.slice(0, 4);
  if (type === "Absence") return ["legendId", "startDate", "endDate", "absenceType", "approvalState"];
  if (type === "OPLOC") return ["approvedName", "lifecycleState"];
  if (type === "Till Item Variation") return ["tillItemId", "name", "sku"];
  if (type === "Production Unit") return ["name", "operationalLocationId"];
  return ["name"];
}

export function proposeMapping(profile: WorksheetProfile, targetEntity: CanonicalEntityType, actorId: string): MappingDefinition {
  const targets = targetFields(targetEntity);
  const fields = profile.columns.map(column => {
    const source = column.name.toLowerCase();
    const target = targets.find(t => FIELD_ALIASES[t]?.includes(source)) || null;
    return { source: column.name, target, transform: (column.inferredType === "text" ? "trim" : "none") as "trim" | "none", externalIdentifier: column.likelyIdentifier && /id|email|sku/i.test(column.name), confidence: target ? 0.9 : 0.35 };
  });
  return { mappingId: stableId("mapping", `${profile.name}:${targetEntity}`), version: 1, name: `${profile.name} to ${targetEntity}`, sourceKind: "spreadsheet", targetEntity, fields, createdAt: new Date().toISOString(), createdBy: actorId };
}

export function transformValue(value: unknown, transform: string) {
  if (value === null || value === undefined) return value;
  if (transform === "trim") return String(value).trim();
  if (transform === "lowercase") return String(value).trim().toLowerCase();
  if (transform === "number") { const n = Number(String(value).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : value; }
  if (transform === "date") { const d = new Date(String(value)); return Number.isNaN(d.valueOf()) ? value : d.toISOString().slice(0, 10); }
  return value;
}

export function stageWorksheet(importId: string, profile: WorksheetProfile, mapping: MappingDefinition, existing: CanonicalRecord[]): StagingRecord[] {
  const type = CanonicalEntityNames.includes(mapping.targetEntity as CanonicalEntityType) ? mapping.targetEntity as CanonicalEntityType : "Unknown Dataset";
  return profile.preview.map((raw, index) => {
    const normalised: Record<string, unknown> = {};
    for (const field of mapping.fields) if (field.target) normalised[field.target] = field.constant ?? transformValue(raw[field.source], field.transform);
    const issues = validateMapped(type, normalised).map((message, n) => ({ issueId: stableId("issue", `${importId}:${index}:${n}`), severity: "blocking" as const, code: "REQUIRED_FIELD", message }));
    const candidates = matchCandidates(type, normalised, existing);
    return { stagingId: stableId("staging", `${importId}:${profile.sourceRows[index]}`), importId, sourceRow: profile.sourceRows[index], entityType: type, raw, normalised, issues, duplicateCandidates: candidates, state: issues.length ? "invalid" : candidates.length ? "possible-duplicate" : "ready", mappingVersion: mapping.version };
  });
}

function validateMapped(type: CanonicalEntityType | "Unknown Dataset", row: Record<string, unknown>) {
  if (type === "Unknown Dataset") return ["Choose an approved canonical entity before staging."];
  const required: Record<string, string[]> = { Legend: ["displayName"], Absence: ["legendId", "startDate", "endDate"], Site: ["name"], OPLOC: ["approvedName", "lifecycleState"], "Staffing Role": ["name"], "Production Unit": ["name", "operationalLocationId"], "Till Item": ["name"], "Till Item Variation": ["tillItemId", "name"], "Product Category": ["name"] };
  return required[type].filter(field => !String(row[field] ?? "").trim()).map(field => `${field} is required.`);
}

export function matchCandidates(type: CanonicalEntityType | "Unknown Dataset", row: Record<string, unknown>, records: CanonicalRecord[]) {
  if (type === "Unknown Dataset") return [];
  const keyPairs = type === "Legend" ? [["workEmail", "work email"]] : type === "Till Item Variation" ? [["sku", "SKU"]] : [[type === "OPLOC" ? "approvedName" : "name", "normalised name"]];
  return records.filter(r => r.entityType === type).flatMap(r => keyPairs.flatMap(([key, label]) => {
    const current = String(row[key] ?? "").trim().toLowerCase();
    const existing = String(r.record[key] ?? "").trim().toLowerCase();
    return current && existing && current === existing ? [{ canonicalId: r.canonicalId, reason: `${label} matches`, confidence: key === "workEmail" || key === "sku" ? 1 : 0.8 }] : [];
  }));
}

export function canonicalFromStage(record: StagingRecord, actorId: string) {
  const now = new Date().toISOString();
  const canonicalId = stableId(record.entityType.toLowerCase().replaceAll(" ", "-"), crypto.randomUUID());
  const businessFields = canonicalBusinessFields(record.entityType, record.normalised);
  const ownership = splitOwnedFields(record.normalised);
  const canonical = { entityType: record.entityType, canonicalId, schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId, active: record.normalised.active === false ? false : true, externalIdentities: Array.isArray(record.normalised.externalIdentities) ? record.normalised.externalIdentities : [], provenanceIds: [stableId("provenance", record.stagingId)], ownership, ...businessFields };
  return { canonicalId, entityType: record.entityType as CanonicalEntityType, record: canonical, dataHash: sha256(JSON.stringify(canonical)) };
}

export function mergeProviderUpdate(existing: Record<string, unknown>, incoming: Record<string, unknown>, actorId: string): Record<string, unknown> {
  const previousOwnership = existing.ownership as { providerOwned?: Record<string, unknown>; fikaOwned?: Record<string, unknown> } | undefined;
  const businessFields = canonicalBusinessFields(String(existing.entityType || ""), incoming);
  const incomingOwnership = splitOwnedFields(incoming);
  const governedOverrides = previousOwnership?.fikaOwned?.governedOverrides && typeof previousOwnership.fikaOwned.governedOverrides === "object" ? previousOwnership.fikaOwned.governedOverrides as Record<string, unknown> : {};
  const fieldLocks = Array.isArray(previousOwnership?.fikaOwned?.fieldLocks) ? previousOwnership.fikaOwned.fieldLocks.map(String) : [];
  const unlockedProviderFields = Object.fromEntries(Object.entries(businessFields).filter(([field]) => !fieldLocks.includes(field)));
  const fikaOwned: Record<string, unknown> = { ...(previousOwnership?.fikaOwned || {}), ...incomingOwnership.fikaOwned };
  if (Object.keys(governedOverrides).length) fikaOwned.governedOverrides = governedOverrides;
  if (fieldLocks.length) fikaOwned.fieldLocks = fieldLocks;
  return { ...existing, ...unlockedProviderFields, active: incoming.active === false ? false : existing.active, ...governedOverrides, externalIdentities: Array.isArray(incoming.externalIdentities) ? incoming.externalIdentities : existing.externalIdentities, canonicalId: existing.canonicalId, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actorId, ownership: { providerOwned: { ...(previousOwnership?.providerOwned || {}), ...incomingOwnership.providerOwned }, fikaOwned } };
}

export function sameProviderIdentity(left: Record<string, unknown>, right: Record<string, unknown>) {
  return recordsShareProviderIdentity(left, right);
}

const FIKA_OWNED_ENRICHMENT_FIELDS = new Set(["rotaSiteReferences", "rotaSiteMappingStatus", "primarySiteSuggestion", "rotaSourceHash", "rotaLatestWeek"]);

function splitOwnedFields(values: Record<string, unknown>) {
  const providerOwned = Object.fromEntries(Object.entries(values).filter(([key]) => !FIKA_OWNED_ENRICHMENT_FIELDS.has(key)));
  const workLocationEvidence = buildRotaWorkLocationEvidenceFromNormalised(values);
  return { providerOwned, fikaOwned: workLocationEvidence ? { workLocationEvidence } : {} };
}
