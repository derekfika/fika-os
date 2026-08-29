import type { ProductionOrder } from "./production-types";

export type ProductionDashboardView =
  | "production"
  | "hospitality"
  | "site_manager";

/** Accept older bookmarks while exposing role-based query values. */
export function normaliseProductionDashboardView(
  value: string | null | undefined,
): ProductionDashboardView {
  if (value === "hospitality" || value === "craig") return "hospitality";
  if (value === "site_manager" || value === "manager") return "site_manager";
  return "production";
}

function routingView(
  view: ProductionDashboardView,
): "liana" | "craig" | "site_manager" {
  return view === "production"
    ? "liana"
    : view === "hospitality"
      ? "craig"
      : "site_manager";
}

export function filterProductionOrdersForDashboard(
  orders: ProductionOrder[],
  view: ProductionDashboardView,
  routing: Record<string, ("liana" | "craig" | "site_manager")[]>,
): ProductionOrder[] {
  if (view === "site_manager") return orders;
  // A restored/local workspace may not have any routing records yet. Keep
  // existing work visible until the first governed routing decision is saved;
  // once routing exists, unassigned lines are deliberately excluded below.
  if (Object.keys(routing).length === 0) return orders;
  const legacyView = routingView(view);
  return orders
    .map((order) => {
      const lines = order.lines.filter((line) => {
        const menuItemIds = [line.sourceMenuItemId, line.sourceOfferingId].filter(
          (value): value is string => Boolean(value),
        );
        // A hospitality line without a canonical routed identity is not safe
        // to expose in a role-specific view. CPU-created orders remain visible
        // to the production chef because they do not originate in the shared
        // Hospitality Menu Catalogue.
        if (!menuItemIds.length) return order.origin === "cpu_created" && view === "production";
        // Older hand-offs called the canonical Menu Item reference an
        // offering ID. Accept that stored identity as a compatibility alias;
        // never fall back to display-name matching.
        const assigned = menuItemIds
          .map((menuItemId) => routing[menuItemId])
          .find(Boolean);
        return assigned ? assigned.includes(legacyView) : false;
      });
      return { ...order, lines };
    })
    .filter((order) => order.lines.length > 0);
}
