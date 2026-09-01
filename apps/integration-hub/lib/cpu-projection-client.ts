import type { ProductionOrder } from "./production-domain";

type CpuProjectionOrder = Pick<ProductionOrder, "canonicalId" | "version" | "serviceDate" | "updatedAt" | "createdAt">;

function cpuBase() {
  const configured = process.env.CPU_PRODUCTION_BASE_URL?.trim();
  const hosted = ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
  if (!configured) {
    if (hosted) throw new Error("CPU_PRODUCTION_BASE_URL is required outside local development.");
    return "http://localhost:3400";
  }
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new Error("CPU_PRODUCTION_BASE_URL must be a valid URL."); }
  if (hosted && parsed.protocol !== "https:") throw new Error("CPU_PRODUCTION_BASE_URL must use HTTPS outside local development.");
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("CPU_PRODUCTION_BASE_URL must use HTTP or HTTPS.");
  return configured.replace(/\/$/, "");
}

export async function notifyCpuProjection(order: CpuProjectionOrder, changeType: "created" | "amended" | "withdrawn", idempotencyKey: string) {
  if (!order.serviceDate) return { applied: false, skipped: true };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const body = JSON.stringify({ action: "sync-production-event", serviceDate: order.serviceDate, entityId: order.canonicalId, revision: order.version, changeType, actorId: "integration-hub", changedAt: order.updatedAt || order.createdAt, idempotencyKey });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(`${cpuBase()}/api/production`, { method: "POST", headers, signal: AbortSignal.timeout(8000), body });
      if (!response.ok) throw new Error(`CPU projection handoff failed (${response.status}).`);
      return { ...(await response.json() as Record<string, unknown>), attempts: attempt };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("CPU projection handoff failed.");
}
