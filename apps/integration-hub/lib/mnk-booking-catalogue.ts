import { hospitalityPortalReadFromRecords, type HospitalityPortalReadRequest } from "./hospitality-catalogue-service";
import type { CanonicalRecord } from "./types";
import type { MnkBookingPayload } from "./hospitality-booking-service";
import { hospitalityMenuDate } from "../../shared/hospitality-menu-date";
import { isStudioDishChoice } from "../../shared/hospitality-menu-studio-selection";
import { studioChoicePolicy, studioOfferingIsBookable } from "./hospitality-studio-commercial";

type CatalogueRelationRead = (field: string, ids: string[]) => Promise<CanonicalRecord[]>;

/** Read only what the effective-offering resolver needs for the submitted stable Item IDs: their sparse site exceptions, company-default and exception Prices, and the one OPLOC (liveness). */
async function loadPortalBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, provider: string, read: CatalogueRelationRead) {
  const requested = new Set(payload.order.items.map(item => item.itemId));
  const itemIds = items.filter(item => item.entityType === "Hospitality Menu Item" && (requested.has(item.canonicalId) || (Array.isArray(item.record.providerMappings) && item.record.providerMappings.some(raw => {
    const mapping = raw as Record<string, unknown>;
    return mapping.provider === provider && requested.has(String(mapping.sourceItemId));
  })))).map(item => item.canonicalId);
  return loadCatalogueRelations(items, itemIds, oplocId, read);
}

async function loadCatalogueRelations(items: CanonicalRecord[], itemIds: string[], oplocId: string, read: CatalogueRelationRead) {
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

export function loadStudioProductActivationCatalogue(item: CanonicalRecord, oplocId: string, read: CatalogueRelationRead) {
  return loadCatalogueRelations([item], [item.canonicalId], oplocId, read);
}

export function loadMnkBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, read: (field: string, ids: string[]) => Promise<CanonicalRecord[]>) {
  return loadPortalBookingCatalogue(items, payload, oplocId, "mnk-booking-platform", read);
}

/** Angel Court uses the same bounded stable-ID relations, but keeps its own brochure price authority. */
export function loadAngelCourtBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, read: (field: string, ids: string[]) => Promise<CanonicalRecord[]>) {
  return loadPortalBookingCatalogue(items, payload, oplocId, "angel-court-hospitality-brochure", read);
}

const ANGEL_COURT_PROVIDER = "angel-court-hospitality-brochure";
const RCOA_PROVIDER = "rcoa-hospitality-brochure";

/**
 * Governed catalogue items for Angel Court. The portal offers canonical Items resolved through their effective
 * Offering at the Angel Court OPLOC, so a submitted canonical Item ID that has exactly one standard effective
 * Offering there is priced from that Offering (never from client input) and accepted without a legacy brochure
 * mapping. An Item with no effective Offering at this OPLOC, an ambiguous one, or an archived Item is left
 * untouched and is therefore still refused by the price validator. Legacy brochure item IDs are unaffected.
 */
function governedItemRecords(provider: string, records: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, now: string): CanonicalRecord[] {
  const submittedIds = new Set(payload.order.items.map(item => item.itemId));
  const candidates = records.filter(record => record.entityType === "Hospitality Menu Item" && submittedIds.has(record.canonicalId)
    && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && record.record.lifecycleState === "active");
  if (!candidates.length) return records;
  const priced = new Map(mnkBookingPricingRecords(records, { oplocId, serviceDate: hospitalityMenuDate(new Date(now)) })
    .filter(record => submittedIds.has(record.canonicalId) && typeof record.record.unitPrice === "number")
    .map(record => [record.canonicalId, record] as const));
  if (!priced.size) return records;
  return records.map(record => {
    const governed = priced.get(record.canonicalId);
    if (!governed || record.entityType !== "Hospitality Menu Item") return record;
    const mappings = Array.isArray(governed.record.providerMappings) ? governed.record.providerMappings as unknown[] : [];
    const alreadyMapped = mappings.some(raw => (raw as Record<string, unknown>)?.provider === provider);
    return alreadyMapped ? governed : { ...governed, record: { ...governed.record, providerMappings: [...mappings, { provider, sourceItemId: record.canonicalId, mappingStatus: "confirmed", source: "governed-effective-offering" }] } };
  });
}

/** Resolve Angel Court's governed Items (price and constraints from the effective Offering); legacy brochure items keep their established snapshot. */
export function angelCourtBookingConstraintRecords(inputRecords: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, now: string = new Date().toISOString()): CanonicalRecord[] {
  return governedBookingConstraintRecords(ANGEL_COURT_PROVIDER, "Angel Court", inputRecords, payload, oplocId, now);
}

/** RCoA offers the same governed Items; a submitted canonical Item ID is priced from its effective Offering at the RCoA OPLOC. Legacy RCoA source IDs are unaffected. */
export function rcoaBookingConstraintRecords(inputRecords: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, now: string = new Date().toISOString()): CanonicalRecord[] {
  return governedBookingConstraintRecords(RCOA_PROVIDER, "RCoA", inputRecords, payload, oplocId, now);
}

/** Bounded stable-ID relations for the RCoA governed Items (Offerings, Prices and the one OPLOC). */
export function loadRcoaBookingCatalogue(items: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, read: (field: string, ids: string[]) => Promise<CanonicalRecord[]>) {
  return loadPortalBookingCatalogue(items, payload, oplocId, RCOA_PROVIDER, read);
}

export function governedBookingConstraintRecords(provider: string, siteLabel: string, inputRecords: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string, now: string): CanonicalRecord[] {
  const records = governedItemRecords(provider, inputRecords, payload, oplocId, now);
  const submittedIds = new Set(payload.order.items.map(item => item.itemId));
  const mappedItems = records.filter(record => record.entityType === "Hospitality Menu Item" && Array.isArray(record.record.providerMappings) && record.record.providerMappings.some(raw => {
    const mapping = raw as Record<string, unknown>;
    return mapping.provider === provider && (submittedIds.has(String(mapping.sourceItemId)) || submittedIds.has(record.canonicalId));
  }));
  if (!mappedItems.length) return records;

  const resolved = hospitalityPortalReadFromRecords(records, { oplocId, serviceDate: payload.event.eventDate }).offerings as Array<{
    itemId: string;
    offeringMode: string;
    configuration?: Record<string, unknown>;
    constraints?: { minimumQuantity?: number; minimumGuests?: number; noticeRequiredDays?: number };
  }>;
  return records.map(item => {
    if (item.entityType !== "Hospitality Menu Item" || !mappedItems.some(mapped => mapped.canonicalId === item.canonicalId)) return item;
    const matches = resolved.filter(offering => offering.itemId === item.canonicalId);
    if (matches.length !== 1) throw Object.assign(new Error(`${siteLabel} item has no unique effective governed Offering at its canonical destination.`), { status: 422 });
    const constraints = matches[0].constraints || {};
    // Remove stale Item-scoped compatibility fields before applying effective
    // Item defaults plus the Angel Court Offering override.
    const { minimumQuantity: _legacyMinimum, minimumGuests: _legacyGuests, noticeRequiredDays: _legacyNotice, defaultMinimumQuantity: _legacyDefaultMinimum, defaultMinimumGuests: _legacyDefaultGuests, defaultNoticeRequiredDays: _legacyDefaultNotice, ...record } = item.record;
    return { ...item, record: {
      ...record,
      ...(constraints.minimumQuantity !== undefined ? { minimumQuantity: constraints.minimumQuantity } : {}),
      ...(constraints.minimumGuests !== undefined ? { minimumGuests: constraints.minimumGuests } : {}),
      ...(constraints.noticeRequiredDays !== undefined ? { noticeRequiredDays: constraints.noticeRequiredDays } : {}),
      configuration: matches[0].configuration,
      governedConstraintsResolved: true,
    } };
  });
}

/** Resolve only explicitly Studio-marked lines on the event date. The booking transaction
 * must subsequently verify the current publication before writing the booking. */
export function mnkStudioBookingPricingRecords(records: CanonicalRecord[], ordinary: CanonicalRecord[], payload: MnkBookingPayload, oplocId: string) {
  const submitted = payload.order.items.filter(line => line.choices?.some(isStudioDishChoice));
  if (!submitted.length) return ordinary;
  const request = { oplocId, serviceDate: payload.event.eventDate };
  const resolved = hospitalityPortalReadFromRecords(records, request).offerings;
  const eventRecords = new Map(mnkBookingPricingRecords(records, request, resolved).map(record => [record.canonicalId, record]));
  const offerings = new Map(resolved.map(offering => [offering.itemId, offering]));
  const changed = new Map<string, CanonicalRecord>();
  for (const line of submitted) {
    const item = eventRecords.get(line.itemId);
    const offering = offerings.get(line.itemId);
    if (!item || !offering || !studioOfferingIsBookable(offering, request.serviceDate) || line.unitPrice !== offering.price?.amount) {
      throw Object.assign(new Error("The Studio menu or price changed. Refresh the choices for this event date."), { status: 409, code: "STUDIO_BOOKING_SELECTION_CHANGED" });
    }
    const configuration = offering.configuration;
    const { replacesChoiceGroupId } = studioChoicePolicy(configuration);
    if (!replacesChoiceGroupId) {
      changed.set(item.canonicalId, item);
      continue;
    }
    if (line.choices?.some(choice => (choice as { id?: unknown } | null)?.id === replacesChoiceGroupId)) {
      throw Object.assign(new Error("Use the published dishes for this item. Refresh and clear the earlier selection."), { status: 409, code: "STUDIO_BOOKING_SELECTION_CHANGED" });
    }
    const withoutReplaced = (groups: unknown) => Array.isArray(groups)
      ? groups.filter(group => group?.id !== replacesChoiceGroupId) : [];
    changed.set(item.canonicalId, { ...item, record: { ...item.record,
      configuration: { ...configuration, choices: withoutReplaced(configuration?.choices) },
      optionGroups: withoutReplaced(item.record.optionGroups),
    } });
  }
  return ordinary.map(item => changed.get(item.canonicalId) ?? item);
}

/** Server-owned adapter into the existing strict price validator; no client prices. */
export function mnkBookingPricingRecords(records: CanonicalRecord[], request: HospitalityPortalReadRequest,
  offerings = hospitalityPortalReadFromRecords(records, request).offerings): CanonicalRecord[] {
  return records.filter(record => record.entityType === "Hospitality Menu Item").map(item => {
    const matches = offerings.filter(offering => offering.offeringMode === "standard" && offering.itemId === item.canonicalId);
    if (matches.length > 1) throw Object.assign(new Error("Ambiguous catalogue offering."), { status: 422 });
    const offering = matches[0] as {
      name?: string; description?: string;
      price?: { amount: number };
      configuration?: { servingInfo?: string; rules?: Record<string, unknown>; choices?: Array<{ controlType?: string }> };
      constraints?: { minimumQuantity?: number; minimumGuests?: number; noticeRequiredDays?: number };
    } | undefined;
    // Item.unitPrice is not a canonical price authority, even if present in old data.
    // Old Item-scoped constraints are not authoritative once a current Offering
    // has been resolved. Removing them first prevents stale fields from winning
    // when the current value is intentionally absent.
    const { unitPrice: _legacyPrice, optionGroups: _legacyOptions, minimumQuantity: _legacyMinimum, minimumGuests: _legacyGuests, noticeRequiredDays: _legacyNotice, ...record } = item.record;
    return { ...item, record: { ...record, ...(offering ? {
      name: offering.name || record.name, description: offering.description || record.description,
      configuration: offering.configuration,
      unitPrice: offering.price?.amount,
      servingInfo: offering.configuration?.servingInfo || "",
      optionGroups: offering.configuration?.choices?.map(group => ({ ...group, selectionType: group.controlType || "select" })) || [],
      ...(offering.constraints?.minimumQuantity !== undefined ? { minimumQuantity: offering.constraints.minimumQuantity } : {}),
      ...(offering.constraints?.minimumGuests !== undefined ? { minimumGuests: offering.constraints.minimumGuests } : {}),
      ...(offering.constraints?.noticeRequiredDays !== undefined ? { noticeRequiredDays: offering.constraints.noticeRequiredDays } : {}),
    } : {}) } };
  });
}
