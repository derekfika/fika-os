export const AD_HOC_ORDER_ID_PREFIX = "production-order:v1:ad-hoc:";

/** An Ad-Hoc Production order is a CPU-created order whose stable canonical id carries its Ad-Hoc request id. Dependency-free: safe for client code. */
export function isAdHocProductionOrder(order: { canonicalId: string; origin?: string }) {
  return order.origin === "cpu_created" && order.canonicalId.startsWith(AD_HOC_ORDER_ID_PREFIX);
}
