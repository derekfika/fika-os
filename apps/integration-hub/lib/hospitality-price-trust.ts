import { hospitalityCatalogues } from "@fika/server-shared/hospitality-catalogue";
import type { CanonicalRecord } from "./types";
import type { MnkBookingPayload } from "./hospitality-booking-service";

const refuse = (message: string): never => { throw Object.assign(new Error(message), { status: 422 }); };
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Hub owns canonical prices; newer portals use the same versioned server catalogue as their read API. */
export function trustedPublicOrder(payload: MnkBookingPayload, records: CanonicalRecord[], site: string) {
  const catalogue = hospitalityCatalogues[site as keyof typeof hospitalityCatalogues];
  if (!catalogue) return refuse("Unknown Hospitality catalogue.");
  const provider = site === "mnk" ? "mnk-booking-platform" : site === "munich-re" ? "munich-re-generic-brochure" : `${site}-hospitality-brochure`;
  const items = payload.order.items.map(item => {
    const matches = records.filter(record => record.entityType === "Hospitality Menu Item" && (
      Array.isArray(record.record.providerMappings) && record.record.providerMappings.some(value => {
        const mapping = value as Record<string, unknown>;
        return mapping.provider === provider && (mapping.sourceItemId === item.itemId || record.canonicalId === item.itemId);
      })));
    if (matches.length > 1) return refuse("Ambiguous catalogue item.");
    const canonical = matches[0];
    const local = catalogue.items.find(value => value.canonicalId === item.itemId || value.source.sourceItemId === item.itemId);
    // A known retired canonical item must never fall back to an older brochure.
    if (canonical && (canonical.lifecycleStatus === "archived" || canonical.publicationStatus === "withdrawn" || canonical.record.lifecycleState !== "active")) return refuse("This catalogue item is no longer available.");
    if (!canonical && (site === "mnk" || !local || local.lifecycleState !== "active")) return refuse(`Unknown or retired catalogue item is not mapped: ${item.itemId}`);
    const rawPrice = canonical ? canonical.record.unitPrice : local!.pricing.unitPrice;
    if (typeof rawPrice !== "number" || !Number.isFinite(rawPrice) || rawPrice < 0) return refuse("The catalogue price is unavailable.");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return refuse("Invalid catalogue quantity.");
    const optionGroups = canonical ? canonical.record.optionGroups : local!.optionGroups;
    if (Array.isArray(optionGroups)) {
      const supplied = (item.choices || []) as Array<{ id?: unknown; value?: unknown; values?: unknown }>;
      if (new Set(supplied.map(value => value.id)).size !== supplied.length) return refuse("Choose each option only once.");
      for (const choice of supplied) {
        const group = optionGroups.find(value => (value as { id: string }).id === choice.id) as { options?: Array<{ label: string }>; selectionType?: string } | undefined;
        if (!group) return refuse("Unknown catalogue option.");
        const selected = Array.isArray(choice.values) ? choice.values : Array.isArray(choice.value) ? choice.value : choice.value ? [choice.value] : [];
        if (selected.some(value => !group.options?.some(option => option.label === value))) return refuse("Unknown catalogue option value.");
        if (!/multi|checkbox/i.test(group.selectionType || "") && selected.length > 1) return refuse("Choose one catalogue option.");
      }
      for (const rawGroup of optionGroups) {
        const group = rawGroup as { id: string; required?: boolean };
        const choice = supplied.find(value => value.id === group.id);
        if (group.required && (!choice || (!choice.value && !(Array.isArray(choice.values) && choice.values.length)))) return refuse("A required catalogue option is missing.");
      }
    }
    const unitPrice = rawPrice;
    const lineTotal = money(unitPrice * item.quantity);
    if (!Number.isSafeInteger(Math.round(lineTotal * 100))) return refuse("Booking amount is too large.");
    return { ...structuredClone(item), itemName: String(canonical ? canonical.record.name : local?.name || item.itemId), category: String(canonical ? canonical.record.category || "" : local?.category || ""), servingInfo: String(canonical ? canonical.record.servingInfo || "" : local?.pricing.servingInfo || ""), unitPrice, lineTotal };
  });
  const netTotal = money(items.reduce((sum, item) => sum + item.lineTotal, 0));
  if (!Number.isSafeInteger(Math.round(netTotal * 100))) return refuse("Booking total is too large.");
  return { ...payload.order, items, netTotal };
}
