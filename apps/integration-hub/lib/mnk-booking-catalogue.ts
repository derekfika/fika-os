import { hospitalityPortalReadFromRecords, type HospitalityPortalReadRequest } from "./hospitality-catalogue-service";
import type { CanonicalRecord } from "./types";
import type { MnkBookingPayload } from "./hospitality-booking-service";

/** Read only the Offerings/Prices related to the submitted stable Item IDs. */
export async function loadMnkBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, read: (field: string, ids: string[]) => Promise<CanonicalRecord[]>) {
  const requested = new Set(payload.order.items.map(item => item.itemId));
  const itemIds = items.filter(item => item.entityType === "Hospitality Menu Item" && (requested.has(item.canonicalId) || (Array.isArray(item.record.providerMappings) && item.record.providerMappings.some(raw => {
    const mapping = raw as Record<string, unknown>;
    return mapping.provider === "mnk-booking-platform" && requested.has(String(mapping.sourceItemId));
  })))).map(item => item.canonicalId);
  const boundedRead = async (field: string, ids: string[]) => {
    const distinct = [...new Set(ids)];
    const records: CanonicalRecord[] = [];
    for (let index = 0; index < distinct.length; index += 30) records.push(...await read(field, distinct.slice(index, index + 30)));
    return records;
  };
  const offerings = (await boundedRead("record.hospitalityMenuItemId", itemIds)).filter(record => record.entityType === "Hospitality Menu Offering" && record.record.oplocId === oplocId);
  const prices = (await boundedRead("record.hospitalityMenuOfferingId", offerings.map(record => record.canonicalId))).filter(record => record.entityType === "Hospitality Menu Price");
  return [...items, ...offerings, ...prices];
}

/** Server-owned adapter into the existing strict price validator; no client prices. */
export function mnkBookingPricingRecords(records: CanonicalRecord[], request: HospitalityPortalReadRequest): CanonicalRecord[] {
  const { offerings } = hospitalityPortalReadFromRecords(records, request);
  return records.filter(record => record.entityType === "Hospitality Menu Item").map(item => {
    const matches = offerings.filter(offering => offering.offeringMode === "standard" && offering.itemId === item.canonicalId);
    if (matches.length > 1) throw Object.assign(new Error("Ambiguous catalogue offering."), { status: 422 });
    const offering = matches[0] as { price?: { amount: number }; configuration?: { servingInfo?: string; choices?: Array<{ controlType?: string }> } } | undefined;
    // Item.unitPrice is not a canonical price authority, even if present in old data.
    const { unitPrice: _legacyPrice, optionGroups: _legacyOptions, ...record } = item.record;
    return { ...item, record: { ...record, ...(offering ? { unitPrice: offering.price?.amount, servingInfo: offering.configuration?.servingInfo || "", optionGroups: offering.configuration?.choices?.map(group => ({ ...group, selectionType: group.controlType || "select" })) || [] } : {}) } };
  });
}
