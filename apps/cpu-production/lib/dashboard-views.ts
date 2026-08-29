import type { ProductionOrder } from "./production-types";
import { adaptCpuProductionWorkstreams, canonicalCpuDashboardView, type CpuProductionWorkstream } from "../../shared/production-workstreams";

export type ProductionDashboardView =
  | "production"
  | "hospitality"
  | "site_manager";

/** Accept older bookmarks while exposing role-based query values. */
export function normaliseProductionDashboardView(
  value: string | null | undefined,
): ProductionDashboardView {
  return canonicalCpuDashboardView(value);
}

function routingView(
  view: ProductionDashboardView,
): CpuProductionWorkstream {
  return view === "production"
    ? "sandwiches"
    : view === "hospitality"
      ? "hospitality"
      : "delivered_in";
}

export function filterProductionOrdersForDashboard(
  orders: ProductionOrder[],
  view: ProductionDashboardView,
  routing: Record<string, readonly unknown[]>,
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
          .map((menuItemId) => adaptCpuProductionWorkstreams(routing[menuItemId] || []).workstreams)
          .find((values) => values.length > 0);
        return assigned ? assigned.includes(legacyView) : false;
      });
      return { ...order, lines };
    })
    .filter((order) => order.lines.length > 0);
}
