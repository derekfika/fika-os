import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { ProductionOrder } from "./production-types";
import { getHubBaseUrl } from "./hub-url";
function base() { return getHubBaseUrl(); }
export function forwardedHeaders(request: NextRequest, headers: HeadersInit = {}) { return { ...headers, ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}), "x-request-id": request.headers.get("x-request-id") || randomUUID() }; }
async function call<T>(request: NextRequest, path: string, init: RequestInit, valid: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try { response = await fetch(`${base()}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(8_000), headers: forwardedHeaders(request, init.headers) }); }
  catch (cause) { throw Object.assign(new Error("Integration Hub is unavailable."), { status: 503, cause }); }
  const text = await response.text(); let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { throw Object.assign(new Error("Integration Hub returned invalid JSON."), { status: 502 }); }
  if (!response.ok) throw Object.assign(new Error((body as { error?: { message?: string } })?.error?.message || `Integration Hub request failed (${response.status}).`), { status: response.status });
  if (!valid(body)) throw Object.assign(new Error("Integration Hub returned an invalid response."), { status: 502 });
  return body;
}
export function hubJson<T>(request: NextRequest, path: string, init: RequestInit, valid: (value: unknown) => value is T) { return call(request, path, init, valid); }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const order = (value: unknown): value is ProductionOrder => record(value) && typeof value.canonicalId === "string" && typeof value.version === "number";
const orders = (value: unknown): value is { orders: ProductionOrder[] } => record(value) && Array.isArray(value.orders) && value.orders.every(order);
const one = (value: unknown): value is { order: ProductionOrder } => record(value) && order(value.order);
export async function productionQueue(request: NextRequest, serviceDate?: string) { const query = serviceDate ? `?serviceDate=${encodeURIComponent(serviceDate)}` : ""; return (await call(request, `/api/production${query}`, { method: "GET", headers: { accept: "application/json" } }, orders)).orders; }
export async function productionQueueForWeek(request: NextRequest, weekCommencing: string) { return (await call(request, `/api/production?weekCommencing=${encodeURIComponent(weekCommencing)}`, { method: "GET", headers: { accept: "application/json" } }, orders)).orders; }
export async function productionOrderDetail(request: NextRequest, canonicalId: string) { return (await call(request, `/api/production?canonicalId=${encodeURIComponent(canonicalId)}`, { method: "GET", headers: { accept: "application/json" } }, one)).order; }
async function post(request: NextRequest, body: unknown) { return call(request, "/api/production", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }, one); }
export function createCpuProductionOrder(request: NextRequest, input: unknown, idempotencyKey: string) { return call(request, "/api/production", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ...(input as object), action: "cpu-create", idempotencyKey }) }, (value): value is { created: boolean; status: string; order?: ProductionOrder } => record(value) && typeof value.created === "boolean" && typeof value.status === "string"); }
export const updateProductionLines = (request: NextRequest, input: unknown) => post(request, input);
export const reportProductionAllergenDiscrepancy = (request: NextRequest, input: unknown) => post(request, input);
export const acknowledgeProductionCancellation = (request: NextRequest, input: unknown) => post(request, input);
export const transitionProductionOrder = (request: NextRequest, input: unknown) => post(request, input);
export type CpuActor = { uid: string; name?: string; role?: string; synthetic?: boolean };
export type CpuCalendarScanResult = { runId: string; calendarId: string; events: number; imported: number; updated: number; skipped: number; review: number; lastScanAt: string; state: "succeeded" | "failed" };
export const cpuCalendarScanState = (request: NextRequest) => hubJson(request, "/api/cpu/calendar/scan", { method: "GET", headers: { accept: "application/json" } }, record);
export const runCpuCalendarScan = (request: NextRequest) => hubJson(request, "/api/cpu/calendar/scan", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ force: true }) }, (value): value is { result: CpuCalendarScanResult } => record(value) && record(value.result));
