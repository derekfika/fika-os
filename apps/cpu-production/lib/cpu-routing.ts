import type { ProductionOrder } from "@fika/contracts";
import { filterProductionOrdersForScope, type ProductionScope } from "./production-scope";
import { hubJson } from "./production-http-client";
import type { NextRequest } from "next/server";

const isRouting = (value: unknown): value is Record<string, Array<"liana" | "craig" | "site_manager">> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export async function ordersForScope(request: NextRequest, orders: ProductionOrder[], scope: ProductionScope) {
  if (scope === "all") return orders;
  const routing = await hubJson(request, "/api/cpu-production/routing", { method: "GET", headers: { accept: "application/json" } }, (value): value is { routing: Record<string, Array<"liana" | "craig" | "site_manager">> } => Boolean(value && typeof value === "object" && isRouting((value as { routing?: unknown }).routing))).then(value => value.routing);
  return filterProductionOrdersForScope(orders, scope, routing);
}
