import type { ProductionOrder } from "./production-domain";

type CpuProjectionOrder = Pick<ProductionOrder, "canonicalId" | "version" | "serviceDate" | "updatedAt" | "createdAt">;

const cpuBase = () => (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, "");

export async function notifyCpuProjection(order: CpuProjectionOrder, changeType: "created" | "amended" | "withdrawn", idempotencyKey: string) {
  if (!order.serviceDate) return { applied: false, skipped: true };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const response = await fetch(`${cpuBase()}/api/production`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      action: "sync-production-event",
      serviceDate: order.serviceDate,
      entityId: order.canonicalId,
      revision: order.version,
      changeType,
      actorId: "integration-hub",
      changedAt: order.updatedAt || order.createdAt,
      idempotencyKey,
    }),
  });
  if (!response.ok) throw new Error(`CPU projection handoff failed (${response.status}).`);
  return response.json();
}
