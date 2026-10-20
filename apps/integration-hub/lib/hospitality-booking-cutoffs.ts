import type { Transaction } from "firebase-admin/firestore";
import { assertBookingDate, bookingPolicyFor, type CutoffItem } from "@fika/server-shared/hospitality-effective-offering";
import { hospitalityCatalogues } from "@fika/server-shared/hospitality-catalogue";
import { stableDocumentId } from "./canonical-editor";
import { db } from "./firebase-admin";
import { explicitMenuProductionRouting } from "./connections-service";
import { hospitalityPortalReadFromRecords } from "./hospitality-catalogue-service";
import type { CanonicalRecord } from "./types";
import type { CanonicalBooking } from "./hospitality-booking-service";

const canonical = () => db.collection("integrationHubCanonical");

/** Read current bounded catalogue relations inside the mutation transaction, never trust saved/client notice fields. */
export async function assertHospitalityBookingDate(transaction: Transaction, booking: CanonicalBooking, now: string, knownItems?: CanonicalRecord[]) {
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
  const effective = booking.service.oplocId ? hospitalityPortalReadFromRecords([...records, ...related, ...prices, ...oplocs], { oplocId: booking.service.oplocId, serviceDate: booking.service.eventDate }).offerings : [];
  const routes = await explicitMenuProductionRouting([...new Set([...ids, ...canonicalIds])], transaction);
  const items: CutoffItem[] = matched.map(({ line, record }) => {
    const fallback = local.find(i => i.canonicalId === line.itemId || i.source.sourceItemId === line.itemId);
    if (!record && !fallback) throw Object.assign(new Error("This booking item has no verified current catalogue identity."), { status: 422 });
    const offering = effective.find(o => o.itemId === record?.canonicalId);
    if (record && !offering) throw Object.assign(new Error("This item has no available current catalogue Offering at the booking site."), { status: 422 });
    const aliases = [line.itemId, line.menuItemId || "", ...(Array.isArray(record?.record.providerMappings) ? record.record.providerMappings.flatMap(raw => typeof (raw as { sourceItemId?: unknown })?.sourceItemId === "string" ? [(raw as { sourceItemId: string }).sourceItemId] : []) : [])];
    const id = record?.canonicalId || fallback?.canonicalId || line.itemId;
    return { id, bookingPolicy: bookingPolicyFor(id, (routes[id] || routes[line.itemId] || []).includes("sandwiches") ? "sandwiches" : undefined, aliases), noticeRequiredDays: offering?.constraints.noticeRequiredDays ?? fallback?.orderingConstraints.noticeRequiredDays, configuration: offering?.configuration as CutoffItem["configuration"] };
  });
  assertBookingDate(items, booking.service.eventDate, now, { site, occasion: booking.order.eventType, startTime: booking.service.startTime });
}
