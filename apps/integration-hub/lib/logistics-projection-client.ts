type LogisticsChange = { serviceDate?: string; sourceDomain: string; sourceEntityId: string; sourceVersion: number; sourceContentHash?: string; changedAt: string; changeType: "amended" | "cancelled" | "withdrawn" | "superseded" | "status-changed" };

const logisticsBase = () => (process.env.FIKA_LOGISTICS_BASE_URL || "http://localhost:3900").replace(/\/$/, "");

export async function notifyLogisticsProjection(change: LogisticsChange) {
  if (!change.serviceDate) return { applied: false, skipped: true };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const response = await fetch(`${logisticsBase()}/api/logistics/invalidate`, { method: "POST", headers, signal: AbortSignal.timeout(8000), body: JSON.stringify(change) });
  if (!response.ok) throw new Error(`Logistics projection invalidation failed (${response.status}).`);
  return response.json();
}
