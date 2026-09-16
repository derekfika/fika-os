import type { ProductionOrder } from "./production-types";

/** Current Menu Planning orders which are eligible for one service-date fan-out. */
export function currentMenuReleaseOrders(orders: ProductionOrder[], serviceDate: string) {
  return orders
    .filter(order => order.origin === "menu_planning" && (order.serviceDate || order.requiredBy.slice(0, 10)) === serviceDate && !order.supersededBy && Boolean(order.destinationOplocId))
    .sort((left, right) => `${left.destinationOplocId}:${left.canonicalId}`.localeCompare(`${right.destinationOplocId}:${right.canonicalId}`));
}

/** Group the bounded current release scope without cross-contaminating OPLOCs. */
export function groupCurrentMenuReleaseOrders(orders: ProductionOrder[], serviceDate: string) {
  const groups = new Map<string, ProductionOrder[]>();
  for (const order of currentMenuReleaseOrders(orders, serviceDate)) {
    const oplocId = order.destinationOplocId!;
    groups.set(oplocId, [...(groups.get(oplocId) || []), order]);
  }
  return groups;
}

/** Materialisation obligations must be unique per committed order and OPLOC. */
export function cpuReleaseMaterializationEventId(releaseId: string, order: Pick<ProductionOrder, "canonicalId" | "destinationOplocId">) {
  const scope = order.destinationOplocId ? `oploc:${order.destinationOplocId}` : "oploc:unassigned";
  return `cpu-allergen-materialize:${releaseId}:${scope}:order:${order.canonicalId}`.replace(/[^A-Za-z0-9:_-]+/g, "_");
}

/**
 * Every inner materialisation receipt must share the durable obligation's
 * release + OPLOC + canonical-order scope.  The master releaseId is
 * intentionally shared across OPLOCs and is not sufficient by itself.
 */
export function cpuReleaseMaterializationReceiptId(
  releaseId: string,
  order: Pick<ProductionOrder, "canonicalId" | "destinationOplocId">,
  phase: "started" | "prepared" | "final",
) {
  return `${cpuReleaseMaterializationEventId(releaseId, order)}:${phase}`;
}
