/**
 * Loads the established MNK legacy menu source into the *local* review queue.
 * It never publishes catalogue records. Re-running with the same approved
 * configuration is a no-op; a different configuration is rejected.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { parseCanonical, type CanonicalEntityType } from "../lib/schemas";
import { sha256 } from "../lib/profiler";
import type { CanonicalRecord } from "../lib/types";

const [oplocId, effectiveFrom] = process.argv.slice(2);
if (!/^oploc:[a-z0-9-]+$/i.test(oplocId || "")) throw Error("Usage: tsx scripts/load-mnk-legacy-menu-candidates.ts <MNK OPLOC ID> <YYYY-MM-DD>.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom || "")) throw Error("A price effective-from date is required.");

const sourcePath = path.resolve(process.cwd(), "../../sites/mnk/booking-platform/01_MenuData.js");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const sandbox = { globalThis: {} as Record<string, unknown> };
vm.createContext(sandbox);
vm.runInContext(`${sourceText}\nglobalThis.__menu = MENU_SCHEMA;`, sandbox, { filename: sourcePath });
const sourceRecords = JSON.parse(JSON.stringify(sandbox.globalThis.__menu)) as Array<Record<string, unknown>>;
if (sourceRecords.length !== 43) throw Error(`Expected 43 MNK menu records, found ${sourceRecords.length}.`);

const shortHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
const sourceHash = shortHash(JSON.stringify(sourceRecords));
const importId = `hospitality-brochure-import:mnk-legacy-${sourceHash}`;
const now = new Date().toISOString();
const actorId = "migration:mnk-legacy-menu";
const canonical = db.collection("integrationHubCanonical");
const wrapper = (entityType: CanonicalRecord["entityType"], record: Record<string, unknown>): CanonicalRecord => ({ canonicalId: String(record.canonicalId), entityType, record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: "draft" });
const audit = (entityType: string, canonicalId: string) => ({ schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId, active: true, externalIdentities: [], provenanceIds: [importId], ownership: { providerOwned: { sourceFile: "sites/mnk/booking-platform/01_MenuData.js", legacySourceId: canonicalId.split(":").at(-1) }, fikaOwned: { migrationConfiguration: { oplocId, priceEffectiveFrom: effectiveFrom, vatRate: 0.2 } } }, entityType, canonicalId });
const id = (kind: string, key: string) => `${kind}:${key}`;
const pending: CanonicalRecord[] = [];
const importRecord = { ...audit("Hospitality Brochure Import", importId), sourceFilename: "01_MenuData.js", sourceHash, sourceReference: "sites/mnk/booking-platform/01_MenuData.js", extractionStatus: "extracted" as const, lifecycleState: "active" as const };
pending.push(wrapper("Hospitality Brochure Import", importRecord));

for (const [index, legacy] of sourceRecords.entries()) {
  const legacyId = String(legacy.id);
  const itemId = id("hospitality-menu-item", `mnk:${legacyId}`);
  const offeringId = id("hospitality-menu-offering", `mnk:${shortHash(`${oplocId}:${legacyId}`)}`);
  const quoteOnly = legacyId === "bespoke_event";
  const active = Boolean(legacy.available);
  const choices = Array.isArray(legacy.choices) ? legacy.choices : [];
  const item = { ...audit("Hospitality Menu Item", itemId), name: String(legacy.name), ...(legacy.description ? { description: String(legacy.description) } : {}), category: String(legacy.category), lifecycleState: "active" as const, dietaryInformation: Array.isArray(legacy.dietaryTags) ? legacy.dietaryTags.map(String) : [], allergenInformation: Array.isArray(legacy.allergens) ? legacy.allergens.map(String) : [], providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: legacyId, sourceVersion: "01_MenuData.js" }] };
  const offering = { ...audit("Hospitality Menu Offering", offeringId), hospitalityMenuItemId: itemId, oplocId, offeringMode: quoteOnly ? "quote_only" as const : "standard" as const, lifecycleState: active ? "active" as const : "archived" as const, ...(legacy.minimumQuantity ? { minimumQuantity: Number(legacy.minimumQuantity) } : {}), ...(legacy.minimumGuests ? { minimumGuests: Number(legacy.minimumGuests) } : {}), ...(legacy.noticeRequiredDays !== null && legacy.noticeRequiredDays !== undefined ? { noticeRequiredDays: Number(legacy.noticeRequiredDays) } : {}), configuration: { ...(legacy.servingInfo ? { servingInfo: String(legacy.servingInfo) } : {}), serves: legacy.serves === undefined ? undefined : legacy.serves === null ? null : Number(legacy.serves), suggestionType: legacy.suggestionType === undefined ? undefined : legacy.suggestionType === null ? null : String(legacy.suggestionType), ...(legacy.suggestionLabel ? { suggestionLabel: String(legacy.suggestionLabel) } : {}), ...(legacy.suggestionUnit ? { suggestionUnit: String(legacy.suggestionUnit) } : {}), ...(legacy.sortOrder !== undefined ? { sortOrder: Number(legacy.sortOrder) } : {}), choices: choices.map((group: Record<string, unknown>) => ({ id: String(group.id), label: String(group.label), controlType: group.type === "multi" ? "multi" as const : "select" as const, required: Boolean(group.required), options: (Array.isArray(group.options) ? group.options : []).map(option => ({ id: `${String(group.id)}:${String(option).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`, label: String(option) })) })) } };
  const priceId = quoteOnly ? undefined : id("hospitality-menu-price", `mnk:${shortHash(`${offeringId}:${effectiveFrom}`)}`);
  const price = priceId ? { ...audit("Hospitality Menu Price", priceId), hospitalityMenuOfferingId: offeringId, amount: Number(legacy.unitPrice), currency: "GBP" as const, vatRate: 0.2, effectiveFrom, lifecycleState: active ? "active" as const : "archived" as const } : undefined;
  const candidateId = id("hospitality-brochure-candidate", `mnk:${legacyId}`);
  const candidate = { ...audit("Hospitality Brochure Candidate", candidateId), brochureImportId: importId, slideNumber: index + 1, sourceText: `MNK legacy menu item ${legacyId}: ${String(legacy.name)}. Source: sites/mnk/booking-platform/01_MenuData.js`, proposedName: String(legacy.name), proposedCategory: String(legacy.category), proposedItemId: itemId, proposedOfferingId: offeringId, oplocId, offeringMode: quoteOnly ? "quote_only" as const : "standard" as const, ...(price ? { priceSignal: `GBP ${Number(legacy.unitPrice).toFixed(2)} effective ${effectiveFrom}` } : { priceSignal: "Quote required; legacy zero is not a commercial price." }), reviewState: "reviewed" as const, reviewedBy: actorId, reviewedAt: now, publishedRecordIds: [] as string[] };
  const generated: Array<[CanonicalEntityType, Record<string, unknown>]> = [["Hospitality Menu Item", item], ["Hospitality Menu Offering", offering], ...(price ? [["Hospitality Menu Price", price] as [CanonicalEntityType, Record<string, unknown>]] : []), ["Hospitality Brochure Candidate", candidate]];
  for (const [entityType, record] of generated) {
    const parsed = parseCanonical(entityType, record);
    if (!parsed.success) throw Error(`${entityType} ${legacyId} is not schema-valid: ${parsed.error.issues[0]?.message || "unknown validation error"}`);
    pending.push(wrapper(entityType, record));
  }
}

const oploc = await canonical.doc(stableDocumentId(oplocId)).get();
if (!oploc.exists || oploc.data()?.entityType !== "OPLOC" || oploc.data()?.record.lifecycleState !== "active" || oploc.data()?.publicationStatus !== "published") throw Error("The supplied MNK OPLOC must be an active, published canonical OPLOC.");
const existing = await Promise.all(pending.map(record => canonical.doc(stableDocumentId(record.canonicalId)).get()));
const conflicts = existing.filter((snapshot, index) => snapshot.exists && snapshot.data()?.dataHash !== pending[index].dataHash);
if (conflicts.length) throw Error(`Refusing to overwrite ${conflicts.length} existing record(s) with different MNK migration data. Review the existing local candidates instead.`);
const missing = pending.filter((_, index) => !existing[index].exists);
if (missing.length) {
  for (let index = 0; index < missing.length; index += 450) {
    const batch = db.batch();
    for (const record of missing.slice(index, index + 450)) batch.create(canonical.doc(stableDocumentId(record.canonicalId)), record);
    await batch.commit();
  }
}
console.log(JSON.stringify({ importId, sourceRecords: sourceRecords.length, created: missing.length, reused: pending.length - missing.length, status: "reviewed candidates ready for explicit publication" }, null, 2));
