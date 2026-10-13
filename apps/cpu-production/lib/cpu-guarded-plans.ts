import type { ProductionPlan } from "../app/lib/production-plan";
import { createAllergenAuthorityStore } from "./allergen-authority-store";
import { guardReusedPlan } from "./allergen-reuse-service";
import { loadPlansForOrders } from "./cpu-projection-repository";
import type { ProductionOrder } from "./production-types";

/**
 * Projection, review-package and post-commit readers load plans through here so a reused approval can never be projected as
 * authoritative unless it validates against the shared authority right now (fail closed on lookup errors).
 */
export async function loadGuardedPlansForOrders(orders: ProductionOrder[], load: (orderIds: string[]) => Promise<ProductionPlan[]> = loadPlansForOrders): Promise<ProductionPlan[]> {
  const plans = await load(orders.map(order => order.canonicalId));
  const byId = new Map(orders.map(order => [order.canonicalId, order]));
  const store = createAllergenAuthorityStore();
  const cache = new Map<string, never>();
  return Promise.all(plans.map(plan => guardReusedPlan(store, plan, byId.get(plan.orderId) as never, cache as never)));
}
