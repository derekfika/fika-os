import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import { stableDocumentId } from "./canonical-editor";
import type { CanonicalRecord } from "./types";
import { rebuildServiceArrangementsReadPackage } from "./service-arrangements-read-package";
import { rebuildServiceDefinitionsReadPackage } from "./service-definitions-read-package";

const canonical = () => db.collection("integrationHubCanonical");
const revisions = () => db.collection("integrationHubCanonicalRevisions");
const audit = () => db.collection("integrationHubGovernanceAudit");

export type ServiceDefinitionCatalogueItem = { canonicalId: string; serviceName: string; description?: string; lifecycleState: "active" | "retired"; version: number; arrangementUsageCount: number; historicUsage: boolean; canDelete: boolean };

export async function serviceDefinitionCatalogueOverview() {
  const [recordsSnapshot, revisionsSnapshot] = await Promise.all([canonical().get(), revisions().get()]);
  return { serviceDefinitions: serviceDefinitionCatalogue(recordsSnapshot.docs.map(document => document.data() as CanonicalRecord), revisionsSnapshot.docs.map(document => document.data())) };
}

export function serviceDefinitionCatalogue(records: CanonicalRecord[], revisionsData: unknown[]): ServiceDefinitionCatalogueItem[] {
  return records.filter(record => record.entityType === "Service Definition" && record.lifecycleStatus !== "archived").map(record => {
    const usage = serviceDefinitionUsage(records, revisionsData, record.canonicalId);
    return { canonicalId: record.canonicalId, serviceName: String(record.record.serviceName || record.canonicalId), description: text(record.record.description), lifecycleState: record.record.lifecycleState as "active" | "retired", version: Number(record.record.version || 0), ...usage, canDelete: !usage.arrangementUsageCount && !usage.historicUsage };
  }).sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

export function serviceDefinitionUsage(records: CanonicalRecord[], revisionsData: unknown[], serviceDefinitionId: string) {
  return { arrangementUsageCount: records.filter(record => record.entityType === "Service Arrangement" && record.record.serviceDefinitionId === serviceDefinitionId).length, historicUsage: revisionsData.some(value => historicalArrangementReference(value, serviceDefinitionId)) };
}

export async function deleteUnusedServiceDefinition(actor: Actor, canonicalId: string, expectedVersion: number) {
  const result = await db.runTransaction(async transaction => {
    const [recordsSnapshot, revisionsSnapshot] = await Promise.all([transaction.get(canonical()), transaction.get(revisions())]);
    const records = recordsSnapshot.docs.map(document => document.data() as CanonicalRecord);
    const current = records.find(record => record.canonicalId === canonicalId && record.entityType === "Service Definition");
    if (!current) throw conflict("Service Definition was not found.");
    if (Number(current.record.version) !== expectedVersion) throw conflict("This Service Definition changed elsewhere. Refresh and try again.");
    const usage = serviceDefinitionUsage(records, revisionsSnapshot.docs.map(document => document.data()), canonicalId);
    if (usage.arrangementUsageCount || usage.historicUsage) throw conflict("This Service Definition has current or historical arrangements and cannot be permanently deleted. Archive it instead.");
    const now = new Date().toISOString();
    transaction.delete(canonical().doc(stableDocumentId(canonicalId)));
    transaction.set(revisions().doc(stableDocumentId(`${canonicalId}:deleted:${now}`)), { revisionId: `canonical-revision:${stableDocumentId(`${canonicalId}:deleted:${now}`)}`, canonicalId, entityType: "Service Definition", version: Number(current.record.version), previous: current, current: null, changes: [{ path: "permanent-delete", before: current.record, after: null }], actorId: actor.uid, actorName: actor.name, reason: "Permanently deleted unused Service Definition through Connections.", recordedAt: now });
    transaction.set(audit().doc(crypto.randomUUID()), { auditId: crypto.randomUUID(), action: "Service Definition permanently deleted", entityReference: canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: "Unused controlled catalogue entry; no arrangement history.", oplocId: null });
    return { deletedCanonicalId: canonicalId };
  });
  await rebuildServiceDefinitionsReadPackage();
  await rebuildServiceArrangementsReadPackage();
  return result;
}

function historicalArrangementReference(value: unknown, serviceDefinitionId: string) { if (!value || typeof value !== "object") return false; const revision = value as Record<string, unknown>; if (revision.entityType !== "Service Arrangement") return false; return [revision.previous, revision.current].some(candidate => { if (!candidate || typeof candidate !== "object") return false; const record = (candidate as Record<string, unknown>).record as Record<string, unknown> | undefined; return record?.serviceDefinitionId === serviceDefinitionId; }); }
function text(value: unknown) { const output = String(value || "").trim(); return output || undefined; }
function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
