import type { ProductionOrder } from "@fika/contracts";
import { titleCaseDish } from "./production-presentation";
import type { NextRequest } from "next/server";
import { hubJson } from "./production-http-client";

type OplocLabelsResponse = { oplocs: Array<{ canonicalId: string; label: string }> };

function isOplocLabelsResponse(value: unknown): value is OplocLabelsResponse {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { oplocs?: unknown }).oplocs) && (value as { oplocs: unknown[] }).oplocs.every((item) => Boolean(item && typeof item === "object" && typeof (item as { canonicalId?: unknown }).canonicalId === "string" && typeof (item as { label?: unknown }).label === "string")));
}

async function activeOplocLabels(request: NextRequest, ids: string[]) {
  const response = await hubJson(request, "/api/oploc-labels", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ oplocIds: [...new Set(ids.filter(Boolean))] }) }, isOplocLabelsResponse);
  return new Map(response.oplocs.map(({ canonicalId, label }) => [canonicalId, label] as const));
}

export async function withReadableDestinations(request: NextRequest, orders: ProductionOrder[]) {
  if (!orders.length) return orders;
  const needsLookup = orders.some(order => {
    const current = order.destinationLabel?.trim();
    return Boolean(order.destinationOplocId && (!current || current === order.destinationOplocId));
  });
  const labels = needsLookup
    ? await activeOplocLabels(request, orders.map(order => order.destinationOplocId || ""))
    : new Map<string, string>();
  return orders.map(order => { const id = order.destinationOplocId; const label = id ? labels.get(id) : undefined; const current = order.destinationLabel?.trim(); const destinationLabel = !id || !label || (!current || current === id) ? (current && current !== id ? current : label) : current.startsWith(`${id} · `) ? `${label} · ${current.slice(id.length + 3)}` : current; return { ...order, ...(destinationLabel ? { destinationLabel } : {}), lines: order.lines.map(line => ({ ...line, itemName: titleCaseDish(line.itemName) })) }; });
}
