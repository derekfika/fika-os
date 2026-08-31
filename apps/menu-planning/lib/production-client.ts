import type { DurableDomainEvent, ExternalProductionMaterialisation } from "./fika-contracts";
import { menuPlanningHubBaseUrl } from "./hub-url";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

function deliveredInBaseUrl() {
  const configured = process.env.FIKA_APP_DELIVERED_IN_URL || process.env.DELIVERED_IN_BASE_URL;
  if (["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "") && !configured) throw Object.assign(new Error("Delivered-In invalidation endpoint is not configured for hosted Menu Planning."), { status: 503, code: "DELIVERED_IN_ENDPOINT_NOT_CONFIGURED" });
  return (configured || "http://localhost:3800").replace(/\/$/, "");
}

export async function forwardProductionMaterialisation(input: ExternalProductionMaterialisation) {
  const base = menuPlanningHubBaseUrl();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const response = await fetch(`${base}/api/production/materialise`, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Integration Hub CPU production handoff failed (${response.status}).`);
  const result = await response.json() as { cpuHandoff?: "delivered" | "pending" };
  if (result.cpuHandoff === "pending") throw new Error("Integration Hub materialised the Production Order, but CPU projection handoff is pending.");
}
export async function forwardDeliveredInInvalidation(event: DurableDomainEvent) {
  if (event.eventType !== "production.materialise") return;
  const payload = event.payload as ExternalProductionMaterialisation & { publicationId?: string };
  const eventType = payload.status === "withdrawn" ? "withdrawn" : payload.status === "amended" ? "amended" : payload.status === "cancelled" ? "withdrawn" : "changed";
  const body = {
    sourceDomain: "menu-planning" as const,
    sourceEntityId: payload.sourceEntityId,
    ...(payload.publicationId ? { publicationId: payload.publicationId } : {}),
    eventId: event.eventId,
    eventType,
    serviceDate: payload.serviceDate,
    oplocId: payload.destinationOplocId,
    sourceVersion: String(payload.sourceVersion),
    ...(payload.sourceContentHash ? { contentHash: payload.sourceContentHash } : {}),
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env.DELIVERED_IN_INTERNAL_API_TOKEN || process.env.FIKA_INTERNAL_API_TOKEN;
  if (token) headers["x-fika-internal-token"] = token;
  try {
    const response = await fetch(`${deliveredInBaseUrl()}/api/delivered-in/invalidate`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    recordDataAccess({ app: "menu-planning", operation: response.ok ? "delivered-in.invalidation.success" : "delivered-in.invalidation.failure", source: "NETWORK_UPSTREAM", documents: 1, cacheHit: false });
    if (!response.ok) throw new Error(`Delivered-In invalidation failed (${response.status}).`);
  } catch (error) {
    if (error instanceof Error && /Delivered-In invalidation failed/.test(error.message)) throw error;
    recordDataAccess({ app: "menu-planning", operation: "delivered-in.invalidation.failure", source: "NETWORK_UPSTREAM", documents: 1, cacheHit: false });
    throw error;
  }
}
export async function forwardProductionMaterialisationEvent(event: DurableDomainEvent) {
  if (event.eventType !== "production.materialise") return;
  await Promise.all([forwardProductionMaterialisation(event.payload as ExternalProductionMaterialisation), forwardDeliveredInInvalidation(event)]);
}
