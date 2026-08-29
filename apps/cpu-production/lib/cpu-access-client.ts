import type { NextRequest } from "next/server";
import { forwardedHeaders, type CpuActor } from "./production-http-client";
import { getHubBaseUrl } from "./hub-url";
export async function requireCpuActor(request: NextRequest): Promise<CpuActor> {
  if (process.env.NODE_ENV !== "production" && !request.headers.get("cookie")) return { uid: "local-cpu", name: "Production chef (local)", role: "integration-admin", synthetic: true };
  const base = getHubBaseUrl(); let response: Response;
  try { response = await fetch(`${base}/api/cpu-production/access`, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: forwardedHeaders(request) }); } catch { throw Object.assign(new Error("Integration Hub is unavailable."), { status: 503 }); }
  const body = await response.json().catch(() => undefined) as { principal?: { id?: string; displayName?: string }; error?: { message?: string } } | undefined;
  if (!response.ok || !body?.principal?.id) throw Object.assign(new Error(body?.error?.message || "CPU Production access was not granted."), { status: response.status || 502 });
  return { uid: body.principal.id, name: body.principal.displayName, role: "cpu-production" };
}
