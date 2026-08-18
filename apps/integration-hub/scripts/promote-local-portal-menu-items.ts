/**
 * Promote the checked-in development menu catalogues into canonical
 * Hospitality Menu Item records in the local emulator only.
 *
 * This deliberately promotes reusable Items only. Site Offerings and Prices
 * require an explicit OPLOC/effective-date decision and remain separate.
 */
import crypto from "node:crypto";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { parseCanonical } from "../lib/schemas";
import { sha256 } from "../lib/profiler";
import type { CanonicalRecord } from "../lib/types";
import { localMnkMenuCatalogue } from "../../hospitality-booking/lib/local-mnk-menu";
import { localAngelCourtMenuCatalogue } from "../../hospitality-booking/lib/local-angel-court-menu";
import { localCfcMenuCatalogue } from "../../hospitality-booking/lib/local-cfc-menu";
import { localMunichReMenuCatalogue } from "../../hospitality-booking/lib/local-munich-re-menu";

const catalogues = [localMnkMenuCatalogue, localAngelCourtMenuCatalogue, localCfcMenuCatalogue, localMunichReMenuCatalogue];
const actorId = "migration:portal-menu-catalogues";
const now = new Date().toISOString();
const canonical = db.collection("integrationHubCanonical");
const audit = db.collection("integrationHubGovernanceAudit");

function toRecord(item: (typeof localMnkMenuCatalogue.items)[number]): CanonicalRecord {
  const record = {
    schemaVersion: "0.1.0",
    version: 1,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    active: true,
    externalIdentities: [],
    provenanceIds: [`portal-catalogue:${item.source.provider}`],
    ownership: { providerOwned: { sourcePath: item.source.sourcePath, sourceItemId: item.source.sourceItemId }, fikaOwned: {} },
    entityType: "Hospitality Menu Item" as const,
    canonicalId: item.canonicalId,
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    category: item.category,
    lifecycleState: item.lifecycleState,
    dietaryInformation: [...item.dietaryInformation],
    allergenInformation: [...item.allergenInformation],
    providerMappings: [{ provider: item.source.provider, sourceItemId: item.source.sourceItemId, sourceVersion: item.source.sourcePath }],
  };
  const parsed = parseCanonical("Hospitality Menu Item", record);
  if (!parsed.success) throw new Error(`${item.canonicalId} is not schema-valid: ${parsed.error.issues[0]?.message || "unknown error"}`);
  return { canonicalId: item.canonicalId, entityType: "Hospitality Menu Item", record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: "published", publicationStatus: "published", publishedAt: now };
}

const records = catalogues.flatMap(catalogue => catalogue.items.map(toRecord));
const byId = new Map(records.map(record => [record.canonicalId, record]));
if (byId.size !== records.length) throw new Error("Duplicate canonical menu item IDs detected across portal catalogues.");

const existing = await Promise.all(records.map(record => canonical.doc(stableDocumentId(record.canonicalId)).get()));
const conflicts = existing.flatMap((snapshot, index) => snapshot.exists && snapshot.data()?.dataHash !== records[index].dataHash ? [records[index].canonicalId] : []);
// Existing records are authoritative. Never overwrite them; promote only
// genuinely missing site-scoped records and report conflicts for review.
const missing = records.filter((record, index) => !existing[index].exists && !conflicts.includes(record.canonicalId));
for (let offset = 0; offset < missing.length; offset += 400) {
  const batch = db.batch();
  for (const record of missing.slice(offset, offset + 400)) {
    batch.create(canonical.doc(stableDocumentId(record.canonicalId)), record);
    batch.create(audit.doc(crypto.randomUUID()), { action: "Portal Hospitality Menu Item promoted", entityReference: record.canonicalId, actorId: actorId, timestamp: now, reason: "Promoted from checked-in site catalogue source; reusable Item only." });
  }
  await batch.commit();
}
console.log(JSON.stringify({ catalogues: catalogues.length, sourceItems: records.length, created: missing.length, reused: records.length - missing.length - conflicts.length, conflicts, status: "published reusable items; conflicts preserved for review" }, null, 2));
