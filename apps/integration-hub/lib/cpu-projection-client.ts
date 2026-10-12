import type { ProductionOrder } from "./production-domain";

type CpuProjectionOrder = Pick<ProductionOrder, "canonicalId" | "version" | "serviceDate" | "updatedAt" | "createdAt">;

export type CpuProjectionChangeType = "created" | "amended" | "withdrawn";

/**
 * CPU change identity is the canonical Production Order and its canonical VERSION - never a source/publication version.
 * A source version is reused by later transitions (withdrawal, stale replay) and would make the CPU deduplicate a real
 * canonical change as a replay of an earlier one.
 */
export function cpuProjectionIdempotencyKey(order: Pick<CpuProjectionOrder, "canonicalId" | "version">) {
  return `cpu-projection:${order.canonicalId}:v${order.version}`;
}

export function cpuProjectionChangeTypeForOrder(order: Pick<CpuProjectionOrder, "version"> & Pick<ProductionOrder, "status">): CpuProjectionChangeType {
  return order.status === "cancelled" ? "withdrawn" : order.version > 1 ? "amended" : "created";
}

export type CpuProjectionHandoff = {
  action: "sync-production-event";
  serviceDate: string;
  entityId: string;
  revision: number;
  changeType: CpuProjectionChangeType;
  actorId: string;
  changedAt: string;
  idempotencyKey: string;
};

export function cpuProjectionHandoffFor(order: CpuProjectionOrder, changeType: CpuProjectionChangeType, idempotencyKey = cpuProjectionIdempotencyKey(order)): CpuProjectionHandoff | undefined {
  if (!order.serviceDate) return undefined;
  return { action: "sync-production-event", serviceDate: order.serviceDate, entityId: order.canonicalId, revision: order.version, changeType, actorId: "integration-hub", changedAt: order.updatedAt || order.createdAt, idempotencyKey };
}

export function notifyMaterialisedCpuProjection(order: CpuProjectionOrder & Pick<ProductionOrder, "status">) {
  return notifyCpuProjection(order, cpuProjectionChangeTypeForOrder(order), cpuProjectionIdempotencyKey(order));
}

/**
 * One delivery attempt of a durable CPU handoff. Retries are owned by the durable outbox (`cpu-projection-outbox.ts`),
 * never by this call: a non-2xx or network failure throws so the obligation stays pending/failed until the CPU acknowledges.
 */
export async function postCpuProjectionHandoff(handoff: CpuProjectionHandoff) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const response = await fetch(`${cpuBase()}/api/production`, { method: "POST", headers, signal: AbortSignal.timeout(8000), body: JSON.stringify(handoff) });
  if (!response.ok) throw new Error(`CPU projection handoff failed (${response.status}).`);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  // The CPU acknowledges by applying (or idempotently re-acknowledging) the change; anything else is not an acknowledgement.
  if (body.applied !== true) throw new Error("CPU projection handoff was not acknowledged.");
  return body;
}

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
  const handoff = cpuProjectionHandoffFor(order, changeType, idempotencyKey);
  if (!handoff) return { applied: false, skipped: true };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN;
  const body = JSON.stringify(handoff);
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
