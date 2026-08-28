import type { ProductionOrder } from "@fika/contracts";
import { titleCaseDish } from "./production-presentation";
import type { NextRequest } from "next/server";
import { hubJson } from "./production-http-client";

export async function withReadableDestinations(request: NextRequest, orders: ProductionOrder[]) {
  if (!orders.length) return orders;
  const needsLookup = orders.some(order => {
    const current = order.destinationLabel?.trim();
    return Boolean(order.destinationOplocId && (!current || current === order.destinationOplocId));
  });
  const labels = needsLookup
    ? new Map((await hubJson(request, "/api/oplocs", { method: "GET", headers: { accept: "application/json" } }, (value): value is { oplocs: Array<{ canonicalId: string; label: string }> } => Boolean(value && typeof value === "object" && Array.isArray((value as { oplocs?: unknown }).oplocs)))).oplocs.map(oploc => [oploc.canonicalId, oploc.label] as const))
    : new Map<string, string>();
  return orders.map(order => { const id = order.destinationOplocId; const label = id ? labels.get(id) : undefined; const current = order.destinationLabel?.trim(); const destinationLabel = !id || !label || (!current || current === id) ? (current && current !== id ? current : label) : current.startsWith(`${id} · `) ? `${label} · ${current.slice(id.length + 3)}` : current; return { ...order, ...(destinationLabel ? { destinationLabel } : {}), lines: order.lines.map(line => ({ ...line, itemName: titleCaseDish(line.itemName) })) }; });
}
