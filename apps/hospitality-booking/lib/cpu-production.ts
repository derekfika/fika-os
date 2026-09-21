import { randomUUID } from "node:crypto";

export function cpuProductionBaseUrl() {
  return (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, "");
}

export function cpuForwardedHeaders(request: Request, extra?: HeadersInit) {
  const headers = new Headers(extra);
  if (!headers.has("accept")) headers.set("accept", request.headers.get("accept") || "application/json");
  for (const name of ["cookie", "x-fika-internal-token", "x-request-id"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("x-request-id")) headers.set("x-request-id", randomUUID());
  return headers;
}

export function cpuProductionPlanUrl(orderId: string, query = "") {
  return `${cpuProductionBaseUrl()}/api/production-plan?orderId=${encodeURIComponent(orderId)}${query ? `&${query}` : ""}`;
}

export function fetchCpuProductionPlan(
  request: Request,
  orderId: string,
  query = "",
  init: RequestInit = {},
) {
  return fetch(cpuProductionPlanUrl(orderId, query), {
    ...init,
    headers: cpuForwardedHeaders(request, init.headers),
    cache: "no-store",
  });
}

export async function readCpuJson(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function cpuBodyErrorMessage(body: Record<string, unknown>, status: number) {
  const error = body.error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (typeof body.message === "string") return body.message;
  return `CPU Production returned HTTP ${status}.`;
}

export function cpuNotFound(response: Response, body: Record<string, unknown>) {
  if (response.status === 404) return true;
  const error = body.error;
  return Boolean(error && typeof error === "object" && ["NOT_FOUND", "CPU_ORDER_NOT_FOUND"].includes(String((error as { code?: unknown }).code)));
}
