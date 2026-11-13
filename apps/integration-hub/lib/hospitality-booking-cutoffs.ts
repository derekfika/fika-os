import type { Transaction } from "firebase-admin/firestore";
import { assertBookingDate, bookingPolicyFor, catalogueProductionConversion, validateCatalogueRules, type CutoffItem, type RuleItem, type RuleLine } from "@fika/server-shared/hospitality-effective-offering";
import { HOT_FORK_BUFFET_CHOICE_ID, hotForkBuffetChoice, validateHotForkBuffetStoredSelection } from "@fika/server-shared/hospitality-buffet-selection";
import { hospitalityCatalogues } from "@fika/server-shared/hospitality-catalogue";
import { stableDocumentId } from "./canonical-editor";
import { db } from "./firebase-admin";
import { explicitMenuProductionRouting } from "./connections-service";
import { hospitalityPortalReadFromRecords } from "./hospitality-catalogue-service";
import type { CanonicalRecord } from "./types";
import type { CanonicalBooking } from "./hospitality-booking-service";

const canonical = () => db.collection("integrationHubCanonical");

/** Read current bounded catalogue relations inside the mutation transaction, never trust saved/client notice fields. */
async function resolveBookingItems(transaction: Transaction, booking: CanonicalBooking, knownItems?: CanonicalRecord[], operationalAreaId?: string) {
  const site = booking.service.portalSiteId || "mnk";
  const local = hospitalityCatalogues[site as keyof typeof hospitalityCatalogues]?.items || [];
  const mergeCache = new Map<string, Promise<string>>();
  const resolveId = (original: string): Promise<string> => {
    if (!mergeCache.has(original)) mergeCache.set(original, (async () => {
      let id = original;
      const seen = new Set<string>();
      for (let i = 0; i < 32; i++) {
        if (seen.has(id)) throw Object.assign(new Error("Catalogue merge lineage is invalid."), { status: 422 });
        seen.add(id);
        const snapshot = await transaction.get(db.collection("integrationHubHospitalityMenuItemMerges").doc(stableDocumentId(id)));
        if (!snapshot.exists) return id;
        const merge = snapshot.data()!;
        if (merge.sourceMenuItemId !== id || typeof merge.survivorMenuItemId !== "string" || !merge.survivorMenuItemId.trim()) throw Object.assign(new Error("Catalogue merge lineage cannot be verified."), { status: 422 });
        id = merge.survivorMenuItemId;
      }
      throw Object.assign(new Error("Catalogue merge lineage exceeds the safe limit."), { status: 422 });
    })());
    return mergeCache.get(original)!;
  };
  const resolved = await Promise.all(booking.order.items.map(line => resolveId(line.menuItemId || (line.itemId.startsWith("hospitality-menu-item:") ? line.itemId : local.find(i => i.source.sourceItemId === line.itemId)?.canonicalId || line.itemId))));
  const ids = [...new Set([...resolved, ...booking.order.items.map(line => line.itemId)])];
  async function read(field: string, values: string[]) {
    const records: CanonicalRecord[] = [];
    for (let i = 0; i < values.length; i += 30) {
      if (field === "canonicalId") {
        const snapshots = await transaction.getAll(...values.slice(i, i + 30).map(id => canonical().doc(stableDocumentId(id))));
        records.push(...snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as CanonicalRecord));
        continue;
      }
      const snapshot = await transaction.get(canonical().where(field, "in", values.slice(i, i + 30)).limit(501));
      if (snapshot.size > 500) throw Object.assign(new Error("Catalogue relations exceed the safe booking limit."), { status: 422 });
      records.push(...snapshot.docs.map(d => d.data() as CanonicalRecord));
    }
    return records;
  }
  const records = knownItems ? [...knownItems, ...await read("canonicalId", resolved.filter(id => !knownItems.some(r => r.canonicalId === id)))] : await read("canonicalId", ids);
  const matched = booking.order.items.map((line, index) => ({ line, record: records.find(r => r.canonicalId === resolved[index] && r.entityType === "Hospitality Menu Item") || records.find(r => r.entityType === "Hospitality Menu Item" && (r.canonicalId === resolved[index] || r.canonicalId === line.itemId || (Array.isArray(r.record.providerMappings) && r.record.providerMappings.some(raw => (raw as { sourceItemId?: string; provider?: string }).sourceItemId === line.itemId && (raw as { provider?: string }).provider === (site === "mnk" ? "mnk-booking-platform" : site === "munich-re" ? "munich-re-generic-brochure" : `${site}-hospitality-brochure`))))) }));
  const canonicalIds = [...new Set(matched.flatMap(m => m.record ? [m.record.canonicalId] : []))];
  const related = await read("record.hospitalityMenuItemId", canonicalIds);
  const offerings = related.filter(r => r.entityType === "Hospitality Menu Offering" && r.record.oplocId === booking.service.oplocId);
  const prices = await read("record.hospitalityMenuOfferingId", offerings.map(r => r.canonicalId));
  const oplocs = booking.service.oplocId ? await read("canonicalId", [booking.service.oplocId]) : [];
  const effective = booking.service.oplocId ? hospitalityPortalReadFromRecords([...records, ...related, ...prices, ...oplocs], { oplocId: booking.service.oplocId, serviceDate: booking.service.eventDate, operationalAreaId }).offerings : [];
  const routes = await explicitMenuProductionRouting([...new Set([...ids, ...canonicalIds])], transaction);
  return matched.map(({ line, record }) => {
    const fallback = local.find(i => i.canonicalId === line.itemId || i.source.sourceItemId === line.itemId);
    if (!record && !fallback) throw Object.assign(new Error("This booking item has no verified current catalogue identity."), { status: 422 });
    const offering = effective.find(o => o.itemId === record?.canonicalId);
    if (record && !offering) throw Object.assign(new Error("This item has no available current catalogue Offering at the booking site."), { status: 422 });
    const aliases = [line.itemId, line.menuItemId || "", ...(Array.isArray(record?.record.providerMappings) ? record.record.providerMappings.flatMap(raw => typeof (raw as { sourceItemId?: unknown })?.sourceItemId === "string" ? [(raw as { sourceItemId: string }).sourceItemId] : []) : [])];
    const id = record?.canonicalId || fallback?.canonicalId || line.itemId;
    const cutoff: CutoffItem = { id, bookingPolicy: bookingPolicyFor(id, (routes[id] || routes[line.itemId] || []).includes("sandwiches") ? "sandwiches" : undefined, aliases), noticeRequiredDays: offering?.constraints.noticeRequiredDays ?? fallback?.orderingConstraints.noticeRequiredDays, configuration: offering?.configuration as CutoffItem["configuration"] };
    return { line, offering, cutoff, record };
  });
}

function assertDate(booking: CanonicalBooking, items: CutoffItem[], now: string) {
  assertBookingDate(items, booking.service.eventDate, now, { site: booking.service.portalSiteId || "mnk", occasion: booking.order.eventType, startTime: booking.service.startTime });
}

export async function assertHospitalityBookingDate(transaction: Transaction, booking: CanonicalBooking, now: string, knownItems?: CanonicalRecord[]) {
  const items = await resolveBookingItems(transaction, booking, knownItems);
  assertDate(booking, items.map(item => item.cutoff), now);
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** The staff exception skips notice only. Resolve and price all selected lines from current OPLOC offerings. */
export async function prepareHospitalityAdminOrder(transaction: Transaction, booking: CanonicalBooking, oplocId: string, now: string, gallagher: boolean) {
  const scoped = { ...booking, service: { ...booking.service, oplocId } };
  const items = await resolveBookingItems(transaction, scoped, undefined, booking.service.operationalAreaId);
  let noticeOverridden = false;
  try {
    assertDate(scoped, items.map(item => item.cutoff), now);
  } catch (error) {
    if (!["BOOKING_NOTICE", "PRODUCT_NOTICE"].includes((error as { code?: string }).code || "")) throw error;
    noticeOverridden = true;
  }
  const ruleItems: RuleItem[] = [];
  const ruleLines: RuleLine[] = [];
  let vatTotal = 0;
  const lines = items.map(({ line, offering, record, cutoff }) => {
    if (!record || !offering?.price || offering.price.vatRate < 0 || offering.price.vatRate > 1) throw Object.assign(new Error("Every item needs a priced, current offering at this booking's OPLOC."), { status: 422 });
    const configuration = offering.configuration as RuleItem["configuration"];
    const { noticeHours: _notice, ...rules } = configuration?.rules || {};
    ruleItems.push({ id: offering.itemId, name: offering.name, bookingPolicy: cutoff.bookingPolicy, ...offering.constraints, configuration, rules });
    const choices = (line.choices || []).map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Invalid menu selection."), { status: 422 });
      const { id, value: selected, values, quantities } = value as NonNullable<RuleLine["choices"]>[number];
      return { id, ...(selected !== undefined ? { value: selected } : {}), ...(values !== undefined ? { values } : {}), ...(quantities !== undefined ? { quantities } : {}) };
    });
    const buffetSelection = hotForkBuffetChoice(choices);
    if (buffetSelection) validateHotForkBuffetStoredSelection(buffetSelection.value, offering.itemId, booking.service.guestCount);
    ruleLines.push({ itemId: offering.itemId, quantity: line.quantity, choices: choices.filter(choice => choice.id !== HOT_FORK_BUFFET_CHOICE_ID) });
    const lineTotal = money(offering.price.amount * line.quantity);
    if (!Number.isFinite(lineTotal)) throw Object.assign(new Error("The ordered quantity is outside the supported price range."), { status: 422 });
    vatTotal += money(lineTotal * offering.price.vatRate);
    return {
      itemId: offering.itemId, menuItemId: offering.itemId, itemName: offering.name, category: offering.category,
      ...(offering.description ? { description: offering.description } : {}),
      ...(typeof offering.configuration?.servingInfo === "string" ? { servingInfo: offering.configuration.servingInfo } : {}),
      unitPrice: offering.price.amount, quantity: line.quantity, lineTotal,
      ...(rules.productionConversion ? { productionConversion: rules.productionConversion } : {}),
      ...(choices.length ? { choices } : {}), ...(line.comments ? { comments: line.comments } : {}),
    };
  });
  try {
    validateCatalogueRules(ruleItems, ruleLines, { gallagher, siteId: booking.service.portalSiteId, guestCount: booking.service.guestCount, eventDate: booking.service.eventDate, startTime: booking.service.startTime, now });
    for (const line of lines) catalogueProductionConversion(line.quantity, line.productionConversion);
  } catch (error) {
    throw Object.assign(new Error((error as Error).message), { status: 422 });
  }
  const netTotal = money(lines.reduce((total, line) => total + line.lineTotal, 0));
  return { order: { ...booking.order, items: lines, netTotal, vatTotal: money(vatTotal), grossTotal: money(netTotal + vatTotal) }, noticeOverridden };
}
