import type { CanonicalBooking, ProductionOrder } from "./canonical-types";

/**
 * Booking-level CPU production planning (presentation/orchestration only).
 *
 * The CPU requirement of a service is decided from its own requested items and their governed per-item production routing
 * (Hub `cpuRouting.lines[].state`). A service is never treated as CPU or as No CPU because it is a child booking, because it belongs to
 * a group, or because routing state exists somewhere on it. Unresolved routing is never classified as No CPU.
 */
export type ServiceRouting = { status: string; enforced?: boolean; lines: Array<{ index: number; state: string; label?: string }> };
export type ServiceCpuRequirement = "cpu" | "no_cpu" | "unresolved";

export function isCpuLineState(state: string) {
  return state === "cpu_sandwiches" || state === "cpu_hospitality" || state === "cpu_delivered_in";
}

/**
 * `cpu`        every item is resolved and at least one routes to a CPU workstream (or the platform is not yet governed and the booking is
 *              produced by CPU as before: the hand-off is not filtered there).
 * `no_cpu`     every item is explicitly resolved as In house / No CPU (or the booking is flagged as produced internally).
 * `unresolved` at least one item has no decision or a conflicting decision: surfaced, never silently treated as No CPU.
 */
export function serviceCpuRequirement(input: { routing?: ServiceRouting; deliveryChargeRequired?: boolean; itemCount?: number }): ServiceCpuRequirement {
  const { routing } = input;
  if (!routing || routing.enforced === false) return input.deliveryChargeRequired === false ? "no_cpu" : "cpu";
  if (!routing.lines.length) return routing.status === "no_cpu_production" && input.itemCount === 0 ? "no_cpu" : "unresolved";
  if (routing.lines.some(line => line.state === "routing_required" || line.state === "routing_conflict" || !(isCpuLineState(line.state) || line.state === "in_house"))) return "unresolved";
  return routing.lines.some(line => isCpuLineState(line.state)) ? "cpu" : "no_cpu";
}

export function isBookingQuoteStale(booking: CanonicalBooking) {
  const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
  return Boolean(current && (current.stale || (current.commercialVersion !== undefined && current.commercialVersion !== (booking.commercialVersion || 1))));
}

export function productionOrderMatchesCurrentQuote(booking: CanonicalBooking, productionOrder?: ProductionOrder) {
  if (booking.lifecycleStatus !== "Completed" && isBookingQuoteStale(booking)) return false;
  const currentRevisionId = booking.quoteState?.currentRevisionId;
  if (!productionOrder || !currentRevisionId) return false;
  if (productionOrder.sourceReferences.quoteRevisionId === currentRevisionId) return true;
  if (booking.bookingGroup && booking.quoteState?.revisions.some(revision => revision.id === productionOrder.sourceReferences.quoteRevisionId && revision.commercialVersion === (booking.commercialVersion || 1))) return true;
  // A COMPLETED booking can only have a newer revision through a commercial (charge) change: menu changes go through the governed
  // amendment, which reopens the booking and issues a replacement hand-off. Its Production Order, built from an earlier revision of
  // this booking, therefore still stands and is never offered for reissue.
  return booking.lifecycleStatus === "Completed" && Boolean(booking.quoteState?.revisions.some((revision) => revision.id === productionOrder.sourceReferences.quoteRevisionId));
}

export function quoteReadyForCpu(booking: CanonicalBooking) {
  const current = booking.quoteState?.revisions.find((revision) => revision.id === booking.quoteState?.currentRevisionId);
  return ["Quoted", "Approved"].includes(booking.lifecycleStatus) && Boolean(current && !isBookingQuoteStale(booking) && current.pdfStatus === "saved" && current.driveFileId);
}

export type ServiceProductionState = "sent" | "pending" | "awaiting_quote" | "unresolved" | "no_cpu";
export type ServiceProductionRow = { bookingId: string; label: string; requirement: ServiceCpuRequirement; state: ServiceProductionState; hasProductionOrder: boolean };
export type ServiceResult = { status: "sent" | "failed"; message?: string };

export function planServiceProduction(booking: CanonicalBooking, productionOrder: ProductionOrder | undefined, label: string, results: Readonly<Record<string, ServiceResult | undefined>> = {}): ServiceProductionRow {
  const requirement = serviceCpuRequirement({ routing: booking.cpuRouting, deliveryChargeRequired: booking.deliveryChargeRequired, itemCount: booking.order?.items.length });
  const hasProductionOrder = productionOrderMatchesCurrentQuote(booking, productionOrder) && requirement === "cpu";
  const base = { bookingId: booking.canonicalId, label, requirement, hasProductionOrder };
  if (requirement === "no_cpu") return { ...base, state: "no_cpu" };
  if (requirement === "unresolved") return { ...base, state: "unresolved" };
  if (productionOrderMatchesCurrentQuote(booking, productionOrder) || !isBookingQuoteStale(booking) && results[booking.canonicalId]?.status === "sent") return { ...base, state: "sent" };
  return { ...base, state: quoteReadyForCpu(booking) ? "pending" : "awaiting_quote" };
}

/** Services the single Send to CPU action will hand off: CPU-producing, resolved, quote ready, and not already sent. */
export const servicesToSend = (rows: readonly ServiceProductionRow[]) => rows.filter(row => row.state === "pending");

export type OrchestrationOutcome = Record<string, ServiceResult>;

/**
 * Runs the EXISTING per-service production command for each pending CPU service, sequentially (one failure never aborts the others and a
 * service that is already sent is never repeated). Independent commands: this is explicitly not all-or-nothing.
 */
export async function sendPendingServices(rows: readonly ServiceProductionRow[], sendOne: (bookingId: string) => Promise<ServiceResult>): Promise<OrchestrationOutcome> {
  const outcome: OrchestrationOutcome = {};
  for (const row of servicesToSend(rows)) {
    try { outcome[row.bookingId] = await sendOne(row.bookingId); }
    catch (cause) { outcome[row.bookingId] = { status: "failed", message: cause instanceof Error ? cause.message : "The CPU hand-off failed." }; }
  }
  return outcome;
}

export const requiresCpuSummary = (rows: readonly ServiceProductionRow[]) => {
  const cpu = rows.filter(row => row.requirement === "cpu").length;
  return `${cpu} of ${rows.length} ${rows.length === 1 ? "service requires" : "services require"} CPU production`;
};
