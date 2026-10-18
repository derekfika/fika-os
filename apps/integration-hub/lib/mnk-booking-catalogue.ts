import { hospitalityPortalReadFromRecords, type HospitalityPortalReadRequest } from "./hospitality-catalogue-service";
import type { CanonicalRecord } from "./types";
import type { MnkBookingPayload } from "./hospitality-booking-service";

/** Read only what the effective-offering resolver needs for the submitted stable Item IDs: their sparse site exceptions, company-default and exception Prices, and the one OPLOC (liveness). */
async function loadPortalBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, provider: string, read: (field: string, ids: string[]) => Promise<CanonicalRecord[]>) {
  const requested = new Set(payload.order.items.map(item => item.itemId));
  const itemIds = items.filter(item => item.entityType === "Hospitality Menu Item" && (requested.has(item.canonicalId) || (Array.isArray(item.record.providerMappings) && item.record.providerMappings.some(raw => {
    const mapping = raw as Record<string, unknown>;
    return mapping.provider === provider && requested.has(String(mapping.sourceItemId));
  })))).map(item => item.canonicalId);
  const boundedRead = async (field: string, ids: string[]) => {
    const distinct = [...new Set(ids)];
    const records: CanonicalRecord[] = [];
    for (let index = 0; index < distinct.length; index += 30) records.push(...await read(field, distinct.slice(index, index + 30)));
    return records;
  };
  // One bounded read by stable Item id returns both sparse site exceptions and company-default Prices (they share this field).
  const related = await boundedRead("record.hospitalityMenuItemId", itemIds);
  const offerings = related.filter(record => record.entityType === "Hospitality Menu Offering" && record.record.oplocId === oplocId);
  const prices = [...related.filter(record => record.entityType === "Hospitality Menu Price"), ...await boundedRead("record.hospitalityMenuOfferingId", offerings.map(record => record.canonicalId))].filter(record => record.entityType === "Hospitality Menu Price");
  const oploc = (await read("canonicalId", [oplocId])).filter(record => record.entityType === "OPLOC");
  return [...items, ...offerings, ...prices, ...oploc];
}

export function loadMnkBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, read: (field: string, ids: string[]) => Promise<CanonicalRecord[]>) {
  return loadPortalBookingCatalogue(items, payload, oplocId, "mnk-booking-platform", read);
}

/** Angel Court uses the same bounded stable-ID relations, but keeps its own brochure price authority. */
export function loadAngelCourtBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, read: (field: string, ids: string[]) => Promise<CanonicalRecord[]>) {
  return loadPortalBookingCatalogue(items, payload, oplocId, "angel-court-hospitality-brochure", read);
}

/** Resolve only Angel Court's governed constraints; preserve its established brochure pricing snapshot. */
export function angelCourtBookingConstraintRecords(records: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string): CanonicalRecord[] {
  const provider = "angel-court-hospitality-brochure";
  const submittedIds = new Set(payload.order.items.map(item => item.itemId));
  const mappedItems = records.filter(record => record.entityType === "Hospitality Menu Item" && Array.isArray(record.record.providerMappings) && record.record.providerMappings.some(raw => {
    const mapping = raw as Record<string, unknown>;
    return mapping.provider === provider && (submittedIds.has(String(mapping.sourceItemId)) || submittedIds.has(record.canonicalId));
  }));
  if (!mappedItems.length) return records;

  const resolved = hospitalityPortalReadFromRecords(records, { oplocId, serviceDate: payload.event.eventDate }).offerings as Array<{
    itemId: string;
    offeringMode: string;
    constraints?: { minimumQuantity?: number; minimumGuests?: number; noticeRequiredDays?: number };
  }>;
  return records.map(item => {
    if (item.entityType !== "Hospitality Menu Item" || !mappedItems.some(mapped => mapped.canonicalId === item.canonicalId)) return item;
    const matches = resolved.filter(offering => offering.itemId === item.canonicalId);
    if (matches.length !== 1) throw Object.assign(new Error("Angel Court item has no unique effective governed Offering at its canonical destination."), { status: 422 });
    const constraints = matches[0].constraints || {};
    // Remove stale Item-scoped compatibility fields before applying effective
    // Item defaults plus the Angel Court Offering override.
    const { minimumQuantity: _legacyMinimum, minimumGuests: _legacyGuests, noticeRequiredDays: _legacyNotice, defaultMinimumQuantity: _legacyDefaultMinimum, defaultMinimumGuests: _legacyDefaultGuests, defaultNoticeRequiredDays: _legacyDefaultNotice, ...record } = item.record;
    return { ...item, record: {
      ...record,
      ...(constraints.minimumQuantity !== undefined ? { minimumQuantity: constraints.minimumQuantity } : {}),
      ...(constraints.minimumGuests !== undefined ? { minimumGuests: constraints.minimumGuests } : {}),
      ...(constraints.noticeRequiredDays !== undefined ? { noticeRequiredDays: constraints.noticeRequiredDays } : {}),
      governedConstraintsResolved: true,
    } };
  });
}

/** Server-owned adapter into the existing strict price validator; no client prices. */
export function mnkBookingPricingRecords(records: CanonicalRecord[], request: HospitalityPortalReadRequest): CanonicalRecord[] {
  const { offerings } = hospitalityPortalReadFromRecords(records, request);
  return records.filter(record => record.entityType === "Hospitality Menu Item").map(item => {
    const matches = offerings.filter(offering => offering.offeringMode === "standard" && offering.itemId === item.canonicalId);
    if (matches.length > 1) throw Object.assign(new Error("Ambiguous catalogue offering."), { status: 422 });
    const offering = matches[0] as {
      price?: { amount: number };
      configuration?: { servingInfo?: string; choices?: Array<{ controlType?: string }> };
      constraints?: { minimumQuantity?: number; minimumGuests?: number; noticeRequiredDays?: number };
    } | undefined;
    // Item.unitPrice is not a canonical price authority, even if present in old data.
    // Old Item-scoped constraints are not authoritative once a current Offering
    // has been resolved. Removing them first prevents stale fields from winning
    // when the current value is intentionally absent.
    const { unitPrice: _legacyPrice, optionGroups: _legacyOptions, minimumQuantity: _legacyMinimum, minimumGuests: _legacyGuests, noticeRequiredDays: _legacyNotice, ...record } = item.record;
    return { ...item, record: { ...record, ...(offering ? {
      unitPrice: offering.price?.amount,
      servingInfo: offering.configuration?.servingInfo || "",
      optionGroups: offering.configuration?.choices?.map(group => ({ ...group, selectionType: group.controlType || "select" })) || [],
      ...(offering.constraints?.minimumQuantity !== undefined ? { minimumQuantity: offering.constraints.minimumQuantity } : {}),
      ...(offering.constraints?.minimumGuests !== undefined ? { minimumGuests: offering.constraints.minimumGuests } : {}),
      ...(offering.constraints?.noticeRequiredDays !== undefined ? { noticeRequiredDays: offering.constraints.noticeRequiredDays } : {}),
    } : {}) } };
  });
}
