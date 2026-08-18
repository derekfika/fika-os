import type { CanonicalRecord } from "./types";
import type { StagingRecord } from "./schemas";

export function resolveStagingReferences(record: StagingRecord, canonical: CanonicalRecord[]) {
  if (record.entityType === "Employment" && !record.normalised.legendId && record.normalised.legendExternalId) record.normalised.legendId = providerCanonicalId(canonical, "Legend", "brighthr", String(record.normalised.legendExternalId));
  if (record.entityType === "Absence" && !record.normalised.legendId && record.normalised.legendExternalId) record.normalised.legendId = providerCanonicalId(canonical, "Legend", "brighthr", String(record.normalised.legendExternalId));
  if (record.entityType === "Till Item" && !record.normalised.categoryId && record.normalised.categoryExternalId) record.normalised.categoryId = providerCanonicalId(canonical, "Product Category", "square", String(record.normalised.categoryExternalId));
  if (record.entityType === "Till Item Variation") {
    if (!record.normalised.tillItemId && record.normalised.tillItemExternalId) record.normalised.tillItemId = providerCanonicalId(canonical, "Till Item", "square", String(record.normalised.tillItemExternalId));
    const locationPrices = Array.isArray(record.normalised.locationPrices) ? record.normalised.locationPrices : [];
    record.normalised.sitePrices = locationPrices.flatMap(price => {
      if (!price || typeof price !== "object") return [];
      const values = price as Record<string, unknown>;
      const siteId = providerCanonicalId(canonical, "Site", "square", String(values.locationExternalId || ""));
      const amountMinor = Number(values.amount);
      const currency = String(values.currency || "");
      return siteId && Number.isInteger(amountMinor) && amountMinor >= 0 && currency.length === 3 ? [{ siteId, amountMinor, currency }] : [];
    });
  }
  return record;
}

export function unresolvedRequiredReference(record: StagingRecord) {
  if (record.entityType === "Employment" && !record.normalised.legendId) return "Approve the referenced Legend before approving this Employment record.";
  if (record.entityType === "Absence" && !record.normalised.legendId) return "Approve the referenced Legend before approving this Absence.";
  if (record.entityType === "Till Item Variation" && !record.normalised.tillItemId) return "Approve the parent Till Item before approving this Till Item Variation.";
  return "";
}

function providerCanonicalId(records: CanonicalRecord[], entityType: string, provider: string, externalId: string) {
  return records.find(record => record.entityType === entityType && Array.isArray(record.record.externalIdentities) && record.record.externalIdentities.some(identity => identity && typeof identity === "object" && String((identity as Record<string, unknown>).provider || "") === provider && String((identity as Record<string, unknown>).externalId || "") === externalId))?.canonicalId;
}
