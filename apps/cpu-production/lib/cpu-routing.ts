import type { NextRequest } from "next/server";
import type { ProductionOrder } from "./production-types";
import { filterProductionOrdersForScope, type ProductionScope } from "./production-scope";
import { hubJson } from "./production-http-client";
export async function ordersForScope(request: NextRequest, orders: ProductionOrder[], scope: ProductionScope) { if (scope === "all") return orders; const result = await hubJson(request, "/api/cpu-production/routing", { method: "GET", headers: { accept: "application/json" } }, (value): value is { routing: Record<string, Array<"liana" | "craig" | "site_manager">> } => Boolean(value && typeof value === "object" && (value as { routing?: unknown }).routing)); return filterProductionOrdersForScope(orders, scope, result.routing); }
