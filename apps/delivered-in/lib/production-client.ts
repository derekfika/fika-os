import type { ExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import type { DurableDomainEvent } from "../../shared/domain-events";

export async function forwardProductionMaterialisation(input: ExternalProductionMaterialisation) {
  const base = (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const response = await fetch(`${base}/api/production/materialise`, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Integration Hub CPU production handoff failed (${response.status}).`);
  const result = await response.json() as { cpuHandoff?: "delivered" | "pending" };
  if (result.cpuHandoff === "pending") throw new Error("Integration Hub materialised the Production Order, but CPU projection handoff is pending.");
}

export async function forwardProductionMaterialisationEvent(event: DurableDomainEvent) {
  if (event.eventType !== "production.materialise") return;
  return forwardProductionMaterialisation(event.payload as ExternalProductionMaterialisation);
}
