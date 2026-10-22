import type { ProductionOrder } from "./production-types";
import { adaptCpuProductionWorkstreams, type CpuProductionWorkstream } from "../../shared/production-workstreams";

export type ProductionScope = "all" | "sandwiches" | "hospitality" | "delivered_in" | "grab_and_go";
export type ProductionRouting = Record<string, readonly unknown[]>;

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

function fallbackOrderTypes(order: ProductionOrder): Set<Exclude<ProductionScope, "all">> {
  const types = new Set<Exclude<ProductionScope, "all">>();
  if (order.productionCategory === "grab_and_go") types.add("grab_and_go");
  if (order.productionCategory === "hospitality" || order.productionCategory === "events") types.add("hospitality");
  if (order.productionCategory === "delivered_in" || order.productionCategory === "fine_dining" || order.productionCategory === "other") types.add("delivered_in");
  if (order.origin === "grab_and_go") types.add("grab_and_go");
  if (order.origin === "hospitality_booking") types.add("hospitality");
  if (order.origin === "menu_planning" || order.origin === "cpu_created" || order.origin === "legacy_import") types.add("delivered_in");
  return types;
}

function lineTypes(order: ProductionOrder, line: ProductionOrder["lines"][number], routing: ProductionRouting): Set<Exclude<ProductionScope, "all">> {
  const assigned = new Set<Exclude<ProductionScope, "all">>();
  if (line.workstream && line.workstream !== "unassigned") return new Set([line.workstream]);
  const ids = [line.sourceMenuItemId, line.sourceOfferingId].filter((value): value is string => Boolean(value));
  const routed = ids.flatMap((id) => adaptCpuProductionWorkstreams(routing[id] || []).workstreams);
  for (const workstream of routed) assigned.add(workstream);

  // An explicit Hub/CPU line assignment is more specific than the booking's
  // entry route. In particular, a hospitality booking can contain a sandwich
  // line that belongs only to the Sandwiches production scope.
  if (assigned.size) return assigned;
  return fallbackOrderTypes(order);
}

export function filterProductionOrdersForScope(
  orders: ProductionOrder[],
  scope: ProductionScope,
  routing: ProductionRouting,
): ProductionOrder[] {
  if (scope === "all") return orders;
  return orders
    .map((order) => ({ ...order, lines: order.lines.filter((line) => lineTypes(order, line, routing).has(scope)) }))
    .filter((order) => order.lines.length > 0);
}
