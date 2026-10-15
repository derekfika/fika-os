import type { HospitalityLineRoutingState, HospitalityBookingRoutingStatus } from "../../shared/hospitality-routing-contract";
import { adaptCpuProductionWorkstreams } from "../../shared/production-workstreams";

/**
 * Per-item CPU routing for EVERY Hospitality platform (MNK, Angel Court, CFC, Munich Re, RCoA and future platforms on the same booking
 * model). Hospitality keeps the COMPLETE customer booking; only lines whose governed Production visibility record routes them to exactly
 * one CPU workstream reach CPU. Each canonical Hospitality Menu Item has its OWN governed record
 * (`integrationHubHospitalityMenuProductionRouting`, keyed by canonical Item ID, field `workstreams[]`). Provider mappings and site Offerings
 * may share that canonical Item. Historical Item IDs resolve through the governed merge map before reading the current routing decision.
 *
 *   A. record exists, workstreams = []                .... In house                  (no CPU line)
 *   B. record exists, sandwiches only                 .... CPU · Sandwiches
 *   C. record exists, hospitality only                .... CPU · Hospitality
 *   D. record exists, delivered_in only               .... CPU · Delivered-In        (delivered_in is a CPU production workstream like the others)
 *   E. record MISSING                                 .... Routing required          (fail closed; never treated as In house)
 *   F. sandwiches AND hospitality both set            .... Routing conflict          (fail closed; a hand-off needs exactly one CPU workstream or none)
 *
 * ENFORCEMENT is per platform. A platform is "governed" once its items are promoted and classified (see governedRoutingPlatforms); only then
 * does the hand-off fail closed and filter lines. Until then a platform keeps today's behaviour (every line to CPU; the transitional legacy
 * map may label the workstream). The same states are still SHOWN for every platform on the dashboards, flagged `enforced: false` for
 * platforms that are not governed yet, using the legacy map only as an advisory fallback.
 *
 * Nothing is inferred from names or categories, and Delivered-In never decides Hospitality CPU inclusion.
 */
export const RCOA_PROVIDER = "rcoa-booking-platform";
export const MNK_PROVIDER = "mnk-booking-platform";
export const HOSPITALITY_MENU_ITEM_PREFIX = "hospitality-menu-item:";

/** Platforms whose hand-off is governed by the per-item routing records. Default: RCoA. Extend per environment once a platform is promoted and fully classified. */
export const DEFAULT_GOVERNED_ROUTING_PLATFORMS = ["rcoa"] as const;
export function governedRoutingPlatforms(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.HOSPITALITY_GOVERNED_ROUTING_PLATFORMS;
  if (configured === undefined) return [...DEFAULT_GOVERNED_ROUTING_PLATFORMS];
  return configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}
export const isGovernedRoutingPlatform = (platform: string | undefined, env?: Record<string, string | undefined>) => Boolean(platform) && governedRoutingPlatforms(env).includes(platform!);

/** Which Hospitality platform a booking belongs to (stable portal site key; the RCoA provider wins). */
export function hospitalityPlatformOf(booking: { source?: { provider?: string }; service?: { portalSiteId?: string } }): string | undefined {
  if (booking.source?.provider === RCOA_PROVIDER) return "rcoa";
  const site = booking.service?.portalSiteId?.trim().toLowerCase();
  if (site) return site;
  return booking.source?.provider === MNK_PROVIDER ? "mnk" : undefined;
}

export type RoutedItem = { itemId: string; itemName?: string; menuItemId?: string };
export type LineState = HospitalityLineRoutingState;
export type BookingRoutingStatus = HospitalityBookingRoutingStatus;
export type LineRouting = { index: number; itemId: string; itemName: string; state: LineState; source: "governed" | "legacy" | "none" };
export type RoutingPlan = {
  platform: string;
  status: BookingRoutingStatus;
  lines: LineRouting[];
  cpuLines: Array<{ index: number; workstream: "sandwiches" | "hospitality" | "delivered_in" }>;
  required: LineRouting[];
  conflicts: LineRouting[];
};

export const LINE_LABELS: Record<LineState, string> = {
  in_house: "In house",
  cpu_sandwiches: "CPU · Sandwiches",
  cpu_hospitality: "CPU · Hospitality",
  cpu_delivered_in: "CPU · Delivered-In",
  routing_required: "Routing required",
  routing_conflict: "Routing conflict",
};
export const BOOKING_LABELS: Record<BookingRoutingStatus, string> = {
  cpu_required: "CPU required",
  no_cpu_production: "No CPU production",
  routing_required: "Routing required",
  routing_conflict: "Routing conflict",
};

/** Canonical reference first; historical source-only lines retain a bounded compatibility lookup. */
export function routingKeys(item: RoutedItem, platform: string): string[] {
  // Canonical identity wins, including merged-away IDs: the shared Hub reader resolves the survivor.
  if (item.menuItemId) return [item.menuItemId];
  if (item.itemId.startsWith(HOSPITALITY_MENU_ITEM_PREFIX)) return [item.itemId];
  // Read-only compatibility for historical lines without a canonical reference; never creates catalogue records.
  return [`${HOSPITALITY_MENU_ITEM_PREFIX}${platform}:${item.itemId}`];
}

function stateFor(values: readonly string[]): LineState {
  const { workstreams, unknown } = adaptCpuProductionWorkstreams(values);
  if (unknown.length) return "routing_required"; // an unrecognised value is not a governed decision
  const sandwiches = workstreams.includes("sandwiches");
  const hospitality = workstreams.includes("hospitality");
  if (sandwiches && hospitality) return "routing_conflict";
  if (sandwiches) return "cpu_sandwiches";
  if (hospitality) return "cpu_hospitality";
  if (workstreams.includes("delivered_in")) return "cpu_delivered_in"; // Delivered-In alone is a CPU workstream; alongside Sandwiches/Hospitality it is the "also Delivered-In" visibility flag
  return "in_house"; // only an explicit empty decision excludes an item
}

/**
 * `explicit` = governed saved decisions (the record existing IS the decision). `legacy` is ONLY the advisory fallback for platforms that are
 * not governed yet: it is looked up by the stable source item id and is never consulted for a governed platform.
 */
export function classifyHospitalityLine(item: RoutedItem, platform: string, explicit: Readonly<Record<string, readonly string[]>>, legacy?: Readonly<Record<string, readonly string[]>>): { state: LineState; source: "governed" | "legacy" | "none" } {
  for (const key of routingKeys(item, platform)) {
    if (Object.prototype.hasOwnProperty.call(explicit, key)) return { state: stateFor(explicit[key]), source: "governed" };
  }
  if (legacy && Object.prototype.hasOwnProperty.call(legacy, item.itemId)) return { state: stateFor(legacy[item.itemId]), source: "legacy" };
  return { state: "routing_required", source: "none" };
}

export function planHospitalityCpuRouting(items: readonly RoutedItem[], platform: string, explicit: Readonly<Record<string, readonly string[]>>, legacy?: Readonly<Record<string, readonly string[]>>): RoutingPlan {
  const lines: LineRouting[] = items.map((item, index) => ({ index, itemId: item.itemId, itemName: item.itemName || item.itemId, ...classifyHospitalityLine(item, platform, explicit, legacy) }));
  const required = lines.filter((line) => line.state === "routing_required");
  const conflicts = lines.filter((line) => line.state === "routing_conflict");
  const cpuLines: RoutingPlan["cpuLines"] = [];
  for (const line of lines) {
    if (line.state === "cpu_sandwiches") cpuLines.push({ index: line.index, workstream: "sandwiches" });
    else if (line.state === "cpu_hospitality") cpuLines.push({ index: line.index, workstream: "hospitality" });
    else if (line.state === "cpu_delivered_in") cpuLines.push({ index: line.index, workstream: "delivered_in" });
  }
  const status: BookingRoutingStatus = required.length ? "routing_required" : conflicts.length ? "routing_conflict" : cpuLines.length ? "cpu_required" : "no_cpu_production";
  return { platform, status, lines, cpuLines, required, conflicts };
}

export const routingBlockedMessage = (plan: Pick<RoutingPlan, "required" | "conflicts">) => [
  plan.required.length ? `Routing required before CPU hand-off: classify ${plan.required.map((line) => line.itemName).join(", ")} in Integration Hub (Connections → Hospitality Menu Items → Production visibility).` : "",
  plan.conflicts.length ? `Routing conflict: ${plan.conflicts.map((line) => line.itemName).join(", ")} ${plan.conflicts.length === 1 ? "is" : "are"} set to both Sandwiches and Hospitality; a Hospitality hand-off needs exactly one CPU workstream or none.` : "",
].filter(Boolean).join(" ");
