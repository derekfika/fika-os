import type { DurableDomainEvent } from "./domain-events";

export async function forwardFulfilmentEvent(event: DurableDomainEvent) {
  if (!event.eventType.startsWith("fulfilment.requirement.")) return;
  const base = (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const response = await fetch(`${base}/api/fulfilment-requirements`, { method: "POST", headers, body: JSON.stringify(event), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Integration Hub Fulfilment handoff failed (${response.status}).`);
}
