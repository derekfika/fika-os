import type { NextRequest } from "next/server";
import type { ProductionOrder } from "@fika/contracts";

function hubUrl(path: string) {
  return `${(process.env.FIKA_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "")}${path}`;
}

async function callHub<T>(request: NextRequest, path: string, init: RequestInit, validate: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(hubUrl(path), {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { ...(init.headers || {}), ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}) },
    });
  } catch (error) {
    throw Object.assign(new Error("Integration Hub is unavailable."), { status: 503, cause: error });
  }
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { throw Object.assign(new Error("Integration Hub returned invalid JSON."), { status: 502 }); }
  if (!response.ok) throw Object.assign(new Error((body as { error?: { message?: string } })?.error?.message || `Integration Hub request failed (${response.status}).`), { status: response.status });
  if (!validate(body)) throw Object.assign(new Error("Integration Hub returned an invalid Production response."), { status: 502 });
  return body;
}

const isOrder = (value: unknown): value is ProductionOrder => Boolean(value && typeof value === "object" && typeof (value as { canonicalId?: unknown }).canonicalId === "string" && typeof (value as { version?: unknown }).version === "number");
const hasOrder = (value: unknown): value is { order: ProductionOrder } => Boolean(value && typeof value === "object" && isOrder((value as { order?: unknown }).order));
const hasOrders = (value: unknown): value is { orders: ProductionOrder[] } => Boolean(value && typeof value === "object" && Array.isArray((value as { orders?: unknown }).orders));

export async function productionQueue(request: NextRequest, serviceDate?: string) {
  const query = serviceDate ? `?serviceDate=${encodeURIComponent(serviceDate)}` : "";
  return (await callHub(request, `/api/production${query}`, { method: "GET", headers: { accept: "application/json" } }, hasOrders)).orders;
}

export async function productionOrderDetail(request: NextRequest, canonicalId: string) {
  const response = await callHub(request, `/api/production?canonicalId=${encodeURIComponent(canonicalId)}`, { method: "GET", headers: { accept: "application/json" } }, hasOrder);
  return response.order;
}

async function post<T>(request: NextRequest, body: unknown, validate: (value: unknown) => value is T) {
  return callHub(request, "/api/production", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }, validate);
}

export function createCpuProductionOrder(request: NextRequest, input: unknown, idempotencyKey: string) { return post(request, { ...(input as object), action: "cpu-create", idempotencyKey }, (value): value is { order?: ProductionOrder; created: boolean; status: string } => Boolean(value && typeof value === "object" && "created" in value)); }
export function updateProductionLines(request: NextRequest, input: unknown) { return post(request, input, hasOrder); }
export function reportProductionAllergenDiscrepancy(request: NextRequest, input: unknown) { return post(request, input, hasOrder); }
export function acknowledgeProductionCancellation(request: NextRequest, input: unknown) { return post(request, input, hasOrder); }
export function transitionProductionOrder(request: NextRequest, input: unknown) { return post(request, input, hasOrder); }

export type CpuActor = { uid: string; name?: string; role?: string; synthetic?: boolean };
