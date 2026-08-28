import type { DurableDomainEvent, ExternalProductionMaterialisation } from "./fika-contracts";
import { menuPlanningHubBaseUrl } from "./hub-url";

export async function forwardProductionMaterialisation(input: ExternalProductionMaterialisation) {
  const base = menuPlanningHubBaseUrl();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const response = await fetch(`${base}/api/production/materialise`, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Object.assign(new Error("Production handoff pending; Integration Hub did not accept the materialisation."), { status: 503, code: "CPU_HANDOFF_PENDING" });
  const result = await response.json() as { cpuHandoff?: "delivered" | "pending" };
  if (result.cpuHandoff === "pending") throw new Error("Integration Hub materialised the Production Order, but CPU projection handoff is pending.");
}
export async function forwardProductionMaterialisationEvent(event: DurableDomainEvent) { if (event.eventType === "production.materialise") return forwardProductionMaterialisation(event.payload as ExternalProductionMaterialisation); }
