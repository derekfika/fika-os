import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { ProductionOrder } from "./production-types";
import { getHubBaseUrl } from "./hub-url";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
function base() { return getHubBaseUrl(); }
export function forwardedHeaders(request: NextRequest, headers: HeadersInit = {}) { return { ...headers, ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}), ...(request.headers.get("x-fika-internal-token") ? { "x-fika-internal-token": request.headers.get("x-fika-internal-token")! } : {}), "x-request-id": request.headers.get("x-request-id") || randomUUID() }; }
export type CanonicalProductionFailure = Error & { status?: number; code?: string; failureKind?: "hub_unavailable" | "authority_failure" | "not_found" | "malformed_response" | "invalid_response"; upstreamPath?: string; upstreamStatus?: number; upstreamContentType?: string; hubOrigin?: string; requestId?: string };
export function canonicalProductionFailureKind(error: Pick<CanonicalProductionFailure, "status" | "code" | "failureKind">) {
  if (error.failureKind) return error.failureKind;
  if (error.code === "CPU_HUB_TIMEOUT" || error.code === "CPU_HUB_NETWORK_FAILURE") return "hub_unavailable" as const;
  if (error.status === 401 || error.status === 403) return "authority_failure" as const;
  if (error.status === 404) return "not_found" as const;
  if (error.code === "CPU_HUB_INVALID_JSON" || error.code === "CPU_HUB_INVALID_RESPONSE") return "malformed_response" as const;
  if (typeof error.status === "number" && error.status >= 500) return "hub_unavailable" as const;
  return "invalid_response" as const;
}
async function call<T>(request: NextRequest, path: string, init: RequestInit, valid: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  const requestId = request.headers.get("x-request-id") || randomUUID();
  let hubOrigin = "unknown";
  try { hubOrigin = new URL(base()).origin; } catch { /* getHubBaseUrl supplies the user-facing configuration error */ }
  try { response = await fetch(`${base()}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { ...forwardedHeaders(request, init.headers), "x-request-id": requestId } }); }
  catch (cause) {
    const timeout = cause instanceof DOMException && cause.name === "TimeoutError";
    throw Object.assign(new Error(timeout ? "Integration Hub request timed out." : "Integration Hub is unavailable."), { status: 503, code: timeout ? "CPU_HUB_TIMEOUT" : "CPU_HUB_NETWORK_FAILURE", failureKind: "hub_unavailable" as const, upstreamPath: path, hubOrigin, requestId, cause });
  }
  recordDataAccess({ app: "cpu-production", operation: `hub.${path.split("?")[0].replace(/^\//, "").replaceAll("/", ".")}`, source: "NETWORK_UPSTREAM", dataset: "integration-hub", documents: 0, cacheResult: "BYPASS" });
  const text = await response.text(); let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { throw Object.assign(new Error("Integration Hub returned invalid JSON."), { status: 502, code: "CPU_HUB_INVALID_JSON", failureKind: "malformed_response" as const, upstreamPath: path, upstreamStatus: response.status, upstreamContentType: response.headers.get("content-type") || undefined, hubOrigin, requestId }); }
  if (!response.ok) {
    const safeMessage = (body as { error?: { message?: unknown; code?: unknown } })?.error;
    const code = typeof safeMessage?.code === "string" ? safeMessage.code : undefined;
    const error = Object.assign(new Error(typeof safeMessage?.message === "string" ? safeMessage.message : `Integration Hub request failed (${response.status}).`), { status: response.status, ...(code ? { upstreamErrorCode: code } : {}), upstreamPath: path, upstreamStatus: response.status, upstreamContentType: response.headers.get("content-type") || undefined, hubOrigin, requestId });
    throw Object.assign(error, { failureKind: canonicalProductionFailureKind(error) });
  }
  if (!valid(body)) throw Object.assign(new Error("Integration Hub returned an invalid response."), { status: 502, code: "CPU_HUB_INVALID_RESPONSE", failureKind: "malformed_response" as const, upstreamPath: path, upstreamStatus: response.status, upstreamContentType: response.headers.get("content-type") || undefined, hubOrigin, requestId });
  return body;
}
export function hubJson<T>(request: NextRequest, path: string, init: RequestInit, valid: (value: unknown) => value is T) { return call(request, path, init, valid); }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const order = (value: unknown): value is ProductionOrder => record(value) && typeof value.canonicalId === "string" && typeof value.version === "number";
const orders = (value: unknown): value is { orders: ProductionOrder[] } => record(value) && Array.isArray(value.orders) && value.orders.every(order);
const one = (value: unknown): value is { order: ProductionOrder } => record(value) && order(value.order);
export async function productionQueue(request: NextRequest, serviceDate?: string) { const query = serviceDate ? `?serviceDate=${encodeURIComponent(serviceDate)}` : ""; return (await call(request, `/api/production${query}`, { method: "GET", headers: { accept: "application/json" } }, orders)).orders; }
export async function productionQueueForWeek(request: NextRequest, weekCommencing: string) { return (await call(request, `/api/production?weekCommencing=${encodeURIComponent(weekCommencing)}`, { method: "GET", headers: { accept: "application/json" } }, orders)).orders; }
export async function productionOrderDetail(request: NextRequest, canonicalId: string) {
  const path = `/api/production?canonicalId=${encodeURIComponent(canonicalId)}`;
  try { return (await call(request, path, { method: "GET", headers: { accept: "application/json" } }, one)).order; }
  catch (cause) {
    const error = cause as CanonicalProductionFailure;
    const failureKind = canonicalProductionFailureKind(error);
    const safe = { app: "cpu-production", operation: `cpu-production.canonical-production.${failureKind === "not_found" ? "not-found" : failureKind === "authority_failure" ? "auth-failure" : failureKind === "hub_unavailable" ? "upstream-unavailable" : failureKind === "invalid_response" ? "stale-identity" : "resolve"}`, requestPath: request.nextUrl.pathname, productionOrderId: canonicalId, serviceDate: request.nextUrl.searchParams.get("serviceDate") || undefined, weekCommencing: request.nextUrl.searchParams.get("weekCommencing") || undefined, upstreamPath: error.upstreamPath || path, upstreamStatus: error.upstreamStatus || error.status, upstreamContentType: error.upstreamContentType, hubOrigin: error.hubOrigin, requestId: error.requestId || request.headers.get("x-request-id"), authForwardingAttempted: Boolean(request.headers.get("cookie") || request.headers.get("x-fika-internal-token")), responseClass: failureKind, runtimeMode: process.env.FIKA_RUNTIME_MODE || "unknown", buildSha: process.env.FIKA_BUILD_SHA || "unknown", kServicePresent: Boolean(process.env.K_SERVICE), kRevisionPresent: Boolean(process.env.K_REVISION), errorName: error.name, errorMessage: error.message, stack: error.stack };
    console.error("FIKA canonical production resolution", safe);
    throw error;
  }
}
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
