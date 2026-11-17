import { HOT_FORK_BUFFET_CHOICE_ID, HotForkBuffetChoiceSchema } from "@fika/server-shared/hospitality-buffet-selection";
import { oplocIdsMatch } from "@fika/server-shared/governed-oplocs";
import type { ProductionOrder } from "./production-domain";

const terminalStatuses = new Set(["cancelled", "amended", "withdrawn", "superseded", "rejected"]);

export type DeliveredInBuffetOrder = {
  canonicalId: string;
  clientName?: string;
  serviceDate: string;
  serviceTime?: string;
  serviceLocation?: { floorLevel?: string; roomOrArea?: string };
  siteLabel: string;
  guestCount?: number;
  status: string;
  dietaries: Record<string, unknown>;
  selection?: unknown;
  selectionState: "available" | "needs_review";
};

/** Safe read projection: deliberately excludes costs, notes, CPU quantities and quote internals. */
export function projectDeliveredInBuffetOrder(order: ProductionOrder, requested: { serviceDate: string; oplocId: string }): DeliveredInBuffetOrder | undefined {
  if (order.origin !== "hospitality_booking" || order.serviceDate !== requested.serviceDate || !oplocIdsMatch(order.destinationOplocId, requested.oplocId) || order.supersededBy || terminalStatuses.has(order.status)) return undefined;
  const choices = order.lines.flatMap(line => line.choices || []).filter(choice => Boolean(choice && typeof choice === "object" && (choice as { id?: unknown }).id === HOT_FORK_BUFFET_CHOICE_ID));
  if (!choices.length) return undefined;
  const parsed = choices.length === 1 ? HotForkBuffetChoiceSchema.safeParse(choices[0]) : undefined;
  return {
    canonicalId: order.canonicalId,
    ...(order.clientName ? { clientName: order.clientName } : {}),
    serviceDate: order.serviceDate,
    ...(order.serviceWindow?.startTime ? { serviceTime: order.serviceWindow.startTime } : {}),
    ...(order.serviceLocation ? { serviceLocation: order.serviceLocation } : {}),
    siteLabel: order.destinationLabel || order.destinationOplocId || "Site not assigned",
    ...(typeof order.guestCount === "number" ? { guestCount: order.guestCount } : {}),
    status: order.status,
    dietaries: order.bookingDietaries || {},
    ...(parsed?.success ? { selection: parsed.data.value } : {}),
    selectionState: parsed?.success ? "available" : "needs_review",
  };
}

export function projectDeliveredInBuffetOrders(orders: ProductionOrder[], requested: { serviceDate: string; oplocId: string }): DeliveredInBuffetOrder[] {
  const seen = new Set<string>();
  return orders.flatMap(order => {
    if (seen.has(order.canonicalId)) return [];
    const projection = projectDeliveredInBuffetOrder(order, requested);
    if (!projection) return [];
    seen.add(order.canonicalId);
    return [projection];
  }).sort((a, b) => (a.serviceTime || "").localeCompare(b.serviceTime || "") || a.canonicalId.localeCompare(b.canonicalId));
}
