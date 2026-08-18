import crypto from "node:crypto";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { parseCanonical } from "../lib/schemas";
import { sha256 } from "../lib/profiler";
import { localAngelCourtMenuCatalogue } from "../../hospitality-booking/lib/local-angel-court-menu";
import { localCfcMenuCatalogue } from "../../hospitality-booking/lib/local-cfc-menu";
import { localMunichReMenuCatalogue } from "../../hospitality-booking/lib/local-munich-re-menu";

const effectiveFrom = "2026-01-01";
const actorId = "migration:site-menu-offerings";
const actorName = "Integration Administrator";
const sites = [
  ["angel-court", "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10", localAngelCourtMenuCatalogue],
  ["cfc", "oploc:0d8626f9-99bd-4dde-9471-191dd0abfb2e", localCfcMenuCatalogue],
  ["munich-re", "oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701", localMunichReMenuCatalogue],
] as const;

const canonical = db.collection("integrationHubCanonical");
const audit = db.collection("integrationHubGovernanceAudit");
const snapshot = await canonical.get();
const existing = snapshot.docs.map(document => document.data() as any);
const itemById = new Map(existing.filter(record => record.entityType === "Hospitality Menu Item").map(record => [record.canonicalId, record]));
const existingOfferingKeys = new Set(existing.filter(record => record.entityType === "Hospitality Menu Offering").map(record => `${record.record.hospitalityMenuItemId}|${record.record.oplocId}|${record.record.operationalAreaId || ""}`));
const report = { offerings: 0, prices: 0, skipped: 0, missingItems: [] as string[], invalid: [] as string[] };
const writes: Array<{ kind: "offering" | "price" | "audit"; id: string; data: any }> = [];
const now = new Date().toISOString();

for (const [site, oplocId, catalogue] of sites) {
  for (const source of catalogue.items) {
    const itemId = source.canonicalId;
    if (!itemById.has(itemId)) {
      report.missingItems.push(itemId);
      continue;
    }
    const key = `${itemId}|${oplocId}|`;
    if (existingOfferingKeys.has(key)) {
      report.skipped++;
      continue;
    }
    const offeringId = `hospitality-menu-offering:${site}:${source.source.sourceItemId}`;
    const priceId = `hospitality-menu-price:${site}:${source.source.sourceItemId}:${effectiveFrom}`;
    const base = {
      schemaVersion: "0.1.0",
      version: 1,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      active: true,
      externalIdentities: [],
      provenanceIds: [`portal-catalogue:${source.source.provider}`],
      ownership: {
        providerOwned: { sourcePath: source.source.sourcePath, sourceItemId: source.source.sourceItemId },
        fikaOwned: { migrationConfiguration: { oplocId, priceEffectiveFrom: effectiveFrom, vatRate: 0.2 } },
      },
    };
    const offeringRecord = {
      ...base,
      entityType: "Hospitality Menu Offering" as const,
      canonicalId: offeringId,
      hospitalityMenuItemId: itemId,
      oplocId,
      offeringMode: "standard" as const,
      lifecycleState: source.lifecycleState,
      ...(source.orderingConstraints.minimumQuantity ? { minimumQuantity: source.orderingConstraints.minimumQuantity } : {}),
      ...(source.orderingConstraints.minimumGuests ? { minimumGuests: source.orderingConstraints.minimumGuests } : {}),
      noticeRequiredDays: source.orderingConstraints.noticeRequiredDays,
      configuration: {
        servingInfo: source.pricing.servingInfo,
        serves: source.orderingConstraints.serves,
        suggestionType: source.orderingConstraints.suggestionType,
        suggestionLabel: source.orderingConstraints.suggestionLabel,
        suggestionUnit: source.orderingConstraints.suggestionUnit,
        sortOrder: source.sortOrder,
        choices: source.optionGroups.map(group => ({
          id: group.id,
          label: group.label,
          controlType: group.selectionType === "multi" ? "multi" as const : "select" as const,
          required: group.required,
          options: group.options,
        })),
      },
    };
    const parsedOffering = parseCanonical("Hospitality Menu Offering", offeringRecord);
    if (!parsedOffering.success) {
      report.invalid.push(`${offeringId}: ${parsedOffering.error.issues[0]?.message || "invalid offering"}`);
      continue;
    }
    const priceRecord = {
      ...base,
      entityType: "Hospitality Menu Price" as const,
      canonicalId: priceId,
      hospitalityMenuOfferingId: offeringId,
      amount: source.pricing.unitPrice,
      currency: "GBP" as const,
      vatRate: 0.2,
      effectiveFrom,
      lifecycleState: source.lifecycleState,
    };
    const parsedPrice = parseCanonical("Hospitality Menu Price", priceRecord);
    if (!parsedPrice.success) {
      report.invalid.push(`${priceId}: ${parsedPrice.error.issues[0]?.message || "invalid price"}`);
      continue;
    }
    writes.push({ kind: "offering", id: offeringId, data: { canonicalId: offeringId, entityType: "Hospitality Menu Offering", record: offeringRecord, dataHash: sha256(JSON.stringify(offeringRecord)), lifecycleStatus: "published", publicationStatus: "published", publishedAt: now } });
    writes.push({ kind: "price", id: priceId, data: { canonicalId: priceId, entityType: "Hospitality Menu Price", record: priceRecord, dataHash: sha256(JSON.stringify(priceRecord)), lifecycleStatus: "published", publicationStatus: "published", publishedAt: now } });
    writes.push({ kind: "audit", id: crypto.randomUUID(), data: { action: "Site Hospitality Menu Offering and Price created", entityReference: offeringId, actorId, actorName, timestamp: now, reason: `Created OPLOC-wide standard Offering and 20% VAT Price from ${source.source.sourcePath}; effective ${effectiveFrom}.`, relatedPriceId: priceId, oplocId } });
    report.offerings++;
    report.prices++;
  }
}

for (let offset = 0; offset < writes.length; offset += 300) {
  const batch = db.batch();
  for (const write of writes.slice(offset, offset + 300)) {
    batch.create((write.kind === "audit" ? audit : canonical).doc(write.kind === "audit" ? write.id : stableDocumentId(write.id)), write.data);
  }
  await batch.commit();
}

console.log(JSON.stringify({ ...report, writes: writes.length }, null, 2));
