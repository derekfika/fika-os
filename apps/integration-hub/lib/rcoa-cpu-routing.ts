import { adaptCpuProductionWorkstreams } from "../../shared/production-workstreams";

/**
 * Per-item CPU routing for RCoA bookings. Hospitality keeps the COMPLETE customer booking; only the lines explicitly routed to
 * Sandwiches or Hospitality go to CPU. The authority is the existing governed routing record
 * (`integrationHubHospitalityMenuProductionRouting`, keyed by canonical Hospitality Menu Item id, field `workstreams`):
 *
 *   - record with workstreams [] ............ In house  (stays on the Hospitality booking, never a CPU line)
 *   - record with "sandwiches" .............. Sandwiches
 *   - record with "hospitality" ............. Hospitality
 *   - NO record (or only an unsupported value) Routing required -> the hand-off fails closed, nothing is guessed or defaulted.
 *
 * Nothing is inferred from names or categories, and the transitional legacy routing defaults are deliberately NOT consulted:
 * only an explicit decision counts.
 */
export const RCOA_PROVIDER = "rcoa-booking-platform";
export const RCOA_MENU_ITEM_PREFIX = "hospitality-menu-item:rcoa:";

export type RcoaRoutedItem = { itemId: string; itemName?: string; menuItemId?: string };
export type RcoaLineClassification = "in_house" | "sandwiches" | "hospitality";
export type RcoaRoutingOutcome =
  | { status: "produce"; lines: Array<{ index: number; classification: "sandwiches" | "hospitality" }>; inHouse: Array<{ index: number }> }
  | { status: "no_cpu_production_required"; inHouse: Array<{ index: number }> }
  | { status: "routing_required"; unmapped: Array<{ index: number; itemId: string; itemName: string; menuItemId?: string }> };

/** Candidate routing keys for a booking line: its canonical menu item id, else the RCoA canonical id derived from the stable source item id. */
export function rcoaRoutingKeys(item: RcoaRoutedItem): string[] {
  const keys = [item.menuItemId, item.itemId.startsWith(RCOA_MENU_ITEM_PREFIX) ? item.itemId : `${RCOA_MENU_ITEM_PREFIX}${item.itemId}`];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

/** `explicit` = only saved routing decisions (record exists => decided). */
export function classifyRcoaLine(item: RcoaRoutedItem, explicit: Readonly<Record<string, readonly string[]>>): RcoaLineClassification | undefined {
  for (const key of rcoaRoutingKeys(item)) {
    if (!Object.prototype.hasOwnProperty.call(explicit, key)) continue;
    const { workstreams } = adaptCpuProductionWorkstreams(explicit[key]);
    if (!workstreams.length) return explicit[key].length ? undefined : "in_house"; // an unrecognised-only value is not a decision
    const cpu = workstreams.find((value): value is "sandwiches" | "hospitality" => value === "sandwiches" || value === "hospitality");
    return cpu; // delivered_in alone is not one of the three RCoA classifications => undefined => routing required
  }
  return undefined;
}

export function planRcoaCpuHandoff(items: readonly RcoaRoutedItem[], explicit: Readonly<Record<string, readonly string[]>>): RcoaRoutingOutcome {
  const lines: Array<{ index: number; classification: "sandwiches" | "hospitality" }> = [];
  const inHouse: Array<{ index: number }> = [];
  const unmapped: Array<{ index: number; itemId: string; itemName: string; menuItemId?: string }> = [];
  items.forEach((item, index) => {
    const classification = classifyRcoaLine(item, explicit);
    if (!classification) unmapped.push({ index, itemId: item.itemId, itemName: item.itemName || item.itemId, ...(item.menuItemId ? { menuItemId: item.menuItemId } : {}) });
    else if (classification === "in_house") inHouse.push({ index });
    else lines.push({ index, classification });
  });
  if (unmapped.length) return { status: "routing_required", unmapped };
  return lines.length ? { status: "produce", lines, inHouse } : { status: "no_cpu_production_required", inHouse };
}

export const routingRequiredMessage = (unmapped: ReadonlyArray<{ itemName: string }>) =>
  `Routing required before CPU hand-off: classify ${unmapped.map(item => item.itemName).join(", ")} as In house, Sandwiches or Hospitality in Integration Hub (Connections → Production view routing).`;
