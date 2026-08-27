import { hospitalityMenuProductionRouting } from "@hub/lib/connections-service";
import type { ProductionOrder } from "@fika/contracts";
import { filterProductionOrdersForScope, type ProductionScope } from "./production-scope";

export async function ordersForScope(orders: ProductionOrder[], scope: ProductionScope) {
  if (scope === "all") return orders;
  return filterProductionOrdersForScope(orders, scope, await hospitalityMenuProductionRouting());
}
