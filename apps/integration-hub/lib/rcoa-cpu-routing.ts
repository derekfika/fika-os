import { adaptCpuProductionWorkstreams } from "../../shared/production-workstreams";

/**
 * Per-item CPU routing for RCoA bookings. Hospitality keeps the COMPLETE customer booking; only lines whose governed Production
 * visibility record routes them to exactly one CPU workstream reach CPU. The authority is the existing governed record
 * (`integrationHubHospitalityMenuProductionRouting`, keyed by canonical Hospitality Menu Item id, field `workstreams[]`):
 *
 *   A. record exists, workstreams = []                .... In house                  (no CPU line)
 *   B. record exists, sandwiches only                 .... CPU · Sandwiches
 *   C. record exists, hospitality only                .... CPU · Hospitality
 *   D. record exists, delivered_in only               .... In house for Hospitality  (Delivered-In visibility is a separate matter)
 *   E. record MISSING                                 .... Routing required          (fail closed; never treated as In house)
 *   F. sandwiches AND hospitality both set            .... Routing conflict          (fail closed; Hospitality hand-off needs exactly one CPU workstream or none)
 *
 * Nothing is inferred from names or categories, and the transitional legacy routing defaults are NOT consulted: only governed
 * records count. Delivered-In never decides Hospitality CPU inclusion.
 */
export const RCOA_PROVIDER = "rcoa-booking-platform";
export const RCOA_MENU_ITEM_PREFIX = "hospitality-menu-item:rcoa:";

export type RcoaRoutedItem = { itemId: string; itemName?: string; menuItemId?: string };
export type RcoaLineState = "in_house" | "cpu_sandwiches" | "cpu_hospitality" | "routing_required" | "routing_conflict";
export type RcoaBookingRoutingStatus = "cpu_required" | "no_cpu_production" | "routing_required" | "routing_conflict";
export type RcoaLineRouting = { index: number; itemId: string; itemName: string; state: RcoaLineState };
export type RcoaRoutingPlan = {
  status: RcoaBookingRoutingStatus;
  lines: RcoaLineRouting[];
  cpuLines: Array<{ index: number; workstream: "sandwiches" | "hospitality" }>;
  required: RcoaLineRouting[];
  conflicts: RcoaLineRouting[];
};

export const RCOA_LINE_LABELS: Record<RcoaLineState, string> = {
  in_house: "In house",
  cpu_sandwiches: "CPU · Sandwiches",
  cpu_hospitality: "CPU · Hospitality",
  routing_required: "Routing required",
  routing_conflict: "Routing conflict",
};
export const RCOA_BOOKING_LABELS: Record<RcoaBookingRoutingStatus, string> = {
  cpu_required: "CPU required",
  no_cpu_production: "No CPU production",
  routing_required: "Routing required",
  routing_conflict: "Routing conflict",
};

/** Candidate routing keys for a booking line: its canonical menu item id, else the RCoA canonical id derived from the stable source item id. */
export function rcoaRoutingKeys(item: RcoaRoutedItem): string[] {
  const keys = [item.menuItemId, item.itemId.startsWith(RCOA_MENU_ITEM_PREFIX) ? item.itemId : `${RCOA_MENU_ITEM_PREFIX}${item.itemId}`];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

/** `explicit` = governed saved decisions only (the record existing IS the decision). */
export function classifyRcoaLine(item: RcoaRoutedItem, explicit: Readonly<Record<string, readonly string[]>>): RcoaLineState {
  for (const key of rcoaRoutingKeys(item)) {
    if (!Object.prototype.hasOwnProperty.call(explicit, key)) continue;
    const raw = explicit[key];
    const { workstreams, unknown } = adaptCpuProductionWorkstreams(raw);
    if (unknown.length) return "routing_required"; // an unrecognised value is not a governed decision
    const sandwiches = workstreams.includes("sandwiches");
    const hospitality = workstreams.includes("hospitality");
    if (sandwiches && hospitality) return "routing_conflict";
    if (sandwiches) return "cpu_sandwiches";
    if (hospitality) return "cpu_hospitality";
    return "in_house"; // empty, or Delivered-In only
  }
  return "routing_required";
}

export function planRcoaCpuHandoff(items: readonly RcoaRoutedItem[], explicit: Readonly<Record<string, readonly string[]>>): RcoaRoutingPlan {
  const lines: RcoaLineRouting[] = items.map((item, index) => ({ index, itemId: item.itemId, itemName: item.itemName || item.itemId, state: classifyRcoaLine(item, explicit) }));
  const required = lines.filter((line) => line.state === "routing_required");
  const conflicts = lines.filter((line) => line.state === "routing_conflict");
  const cpuLines: RcoaRoutingPlan["cpuLines"] = [];
  for (const line of lines) {
    if (line.state === "cpu_sandwiches") cpuLines.push({ index: line.index, workstream: "sandwiches" });
    else if (line.state === "cpu_hospitality") cpuLines.push({ index: line.index, workstream: "hospitality" });
  }
  const status: RcoaBookingRoutingStatus = required.length ? "routing_required" : conflicts.length ? "routing_conflict" : cpuLines.length ? "cpu_required" : "no_cpu_production";
  return { status, lines, cpuLines, required, conflicts };
}

export const routingBlockedMessage = (plan: Pick<RcoaRoutingPlan, "required" | "conflicts">) => [
  plan.required.length ? `Routing required before CPU hand-off: classify ${plan.required.map((line) => line.itemName).join(", ")} in Integration Hub (Connections → Hospitality Menu Items → Production visibility).` : "",
  plan.conflicts.length ? `Routing conflict: ${plan.conflicts.map((line) => line.itemName).join(", ")} ${plan.conflicts.length === 1 ? "is" : "are"} set to both Sandwiches and Hospitality; a Hospitality hand-off needs exactly one CPU workstream or none.` : "",
].filter(Boolean).join(" ");
