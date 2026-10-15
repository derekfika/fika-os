/**
 * Presentation view-models for the Hospitality dashboard.
 *
 * One booking is shown as one chronological list of requested items, with the service time carried by each row.
 * These selectors only read canonical/Hub-projected data; service identity, routing lineage and commercial
 * totals stay on the underlying records and are never rewritten here.
 */
import type { CanonicalBooking } from "./canonical-types";
import type { HospitalityBookingGroup } from "../../shared/hospitality-group-quotes";

export type RequestedItemRow = {
  /** Stable React key: owning service + original line index. */
  key: string;
  /** Canonical child booking that owns this line (kept for routing/production lineage; not shown). */
  serviceBookingId: string;
  lineIndex: number;
  time: string;
  quantity: number;
  name: string;
  description?: string;
  servingInfo?: string;
  comments?: string;
  net: number;
  routing?: { state: string; label: string };
};

type ServiceLike = { bookingId: string; time: string; lines: Array<{ index: number; name: string; quantity: number; net: number; description?: string; servingInfo?: string; comments?: string; routing?: { state: string; label: string } }> };

/** Sort services by time ascending (ties keep their original order), then flatten with each service's original line order. */
function flatten(services: ServiceLike[]): RequestedItemRow[] {
  return services
    .map((service, order) => ({ service, order }))
    .sort((a, b) => a.service.time.localeCompare(b.service.time) || a.order - b.order)
    .flatMap(({ service }) => service.lines.map(line => ({
      key: `${service.bookingId}:${line.index}`, serviceBookingId: service.bookingId, lineIndex: line.index, time: service.time,
      quantity: line.quantity, name: line.name, description: line.description, servingInfo: line.servingInfo, comments: line.comments, net: line.net, routing: line.routing,
    })));
}

export function groupRequestedItems(group: Pick<HospitalityBookingGroup, "services">): RequestedItemRow[] {
  return flatten(group.services.map(service => ({
    bookingId: service.bookingId, time: service.time,
    lines: service.lines.map((line, index) => ({ index, name: line.name, quantity: line.quantity, net: line.net, description: line.description, comments: line.comments, routing: service.routing?.lines.find(r => r.index === index) })),
  })));
}

/** A single-service booking uses the same model: every row simply shares one time. */
export function bookingRequestedItems(booking: CanonicalBooking): RequestedItemRow[] {
  return flatten([{
    bookingId: booking.canonicalId, time: booking.service.startTime,
    lines: booking.order.items.map((item, index) => ({ index, name: item.itemName || item.itemId, quantity: item.quantity, net: item.lineTotal, servingInfo: item.servingInfo, comments: item.comments, routing: booking.cpuRouting?.lines.find(line => line.index === index) })),
  }]);
}

export const requestedItemLabel = (row: Pick<RequestedItemRow, "time" | "quantity" | "name">) => `${row.time} — ${row.quantity} × ${row.name}`;

/**
 * Booking-level CPU production requirement, derived from the existing canonical routing status of each service.
 * - `required`: at least one service is routed to CPU.
 * - `review`: nothing is confirmed CPU, but a service's routing is unresolved/conflicting, so the existing
 *   production safeguards stay reachable rather than being hidden by the UI.
 * - `none`: every service is explicitly produced in house.
 */
export type ProductionRequirement = "required" | "review" | "none";
export function productionRequirement(statuses: Array<string | undefined>): ProductionRequirement {
  if (statuses.some(status => status === "cpu_required")) return "required";
  if (!statuses.length || statuses.some(status => status !== "no_cpu_production")) return "review";
  return "none";
}

/** Routing status of one canonical booking, falling back to the legacy CPU-delivery flag exactly as the detail pane did. */
export function bookingRoutingStatus(booking: Pick<CanonicalBooking, "cpuRouting" | "deliveryChargeRequired">): string {
  if (booking.cpuRouting) return booking.cpuRouting.status;
  return booking.deliveryChargeRequired === false ? "no_cpu_production" : "cpu_required";
}

export const NO_CPU_PRODUCTION_MESSAGE = "No CPU-produced items in this booking, so CPU production, the allergen matrix and menu generation are not needed.";
