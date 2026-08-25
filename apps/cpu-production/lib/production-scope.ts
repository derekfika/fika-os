import type { ProductionOrder } from "@hub/lib/production-domain";

export type ProductionScope = "all" | "sandwiches" | "hospitality" | "delivered_in" | "grab_and_go";
export type ProductionRouting = Record<string, ("liana" | "craig" | "site_manager")[]>;

export const productionScopes: Array<{ id: ProductionScope; label: string }> = [
  { id: "all", label: "All production" },
  { id: "sandwiches", label: "Sandwiches" },
  { id: "hospitality", label: "Hospitality" },
  { id: "delivered_in", label: "Delivered-In" },
  { id: "grab_and_go", label: "Grab & Go" },
];

export function normaliseProductionScope(value: string | null | undefined): ProductionScope {
  return productionScopes.some((scope) => scope.id === value)
    ? (value as ProductionScope)
    : "all";
}

function orderTypes(order: ProductionOrder, routing: ProductionRouting): Set<Exclude<ProductionScope, "all">> {
  const types = new Set<Exclude<ProductionScope, "all">>();
  if (order.productionCategory === "grab_and_go") types.add("grab_and_go");
  if (order.productionCategory === "hospitality" || order.productionCategory === "events") types.add("hospitality");
  if (order.productionCategory === "delivered_in" || order.productionCategory === "fine_dining" || order.productionCategory === "other") types.add("delivered_in");
  if (order.origin === "grab_and_go") types.add("grab_and_go");
  if (order.origin === "hospitality_booking") types.add("hospitality");
  if (order.origin === "menu_planning" || order.origin === "cpu_created" || order.origin === "legacy_import") types.add("delivered_in");
  for (const line of order.lines) {
    const ids = [line.sourceMenuItemId, line.sourceOfferingId].filter((value): value is string => Boolean(value));
    if (line.workstream && line.workstream !== "unassigned") types.add(line.workstream);
    const assignments = ids.flatMap((id) => routing[id] || []);
    if (assignments.includes("liana")) types.add("sandwiches");
    if (assignments.includes("craig")) types.add("hospitality");
    if (assignments.includes("site_manager")) types.add("delivered_in");
  }
  // A booking without a routing decision is still canonical work, but its
  // production type is not safe to infer from display names.
  return types;
}

export function filterProductionOrdersForScope(
  orders: ProductionOrder[],
  scope: ProductionScope,
  routing: ProductionRouting,
): ProductionOrder[] {
  if (scope === "all") return orders;
  return orders
    .map((order) => ({ ...order, lines: order.origin === "hospitality_booking" && scope === "hospitality" ? order.lines : order.lines.filter((line) => {
      const scoped = orderTypes({ ...order, lines: [line] }, routing);
      return scoped.has(scope);
    }) }))
    .filter((order) => order.lines.length > 0);
}
