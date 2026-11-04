import type { NextRequest } from "next/server";
import { forwardedHeaders, type CpuActor } from "./production-http-client";
import { getHubBaseUrl } from "./hub-url";
export type CpuDestinationScope = { allOplocs: boolean; oplocIds: string[] };
const accessByRequest = new WeakMap<NextRequest, Promise<{ actor: CpuActor; scope: CpuDestinationScope }>>();
async function loadCpuAccess(request: NextRequest): Promise<{ actor: CpuActor; scope: CpuDestinationScope }> {
  if (process.env.NODE_ENV !== "production" && !request.headers.get("cookie")) return { actor: { uid: "local-cpu", name: "Production chef (local)", role: "integration-admin", synthetic: true }, scope: { allOplocs: true, oplocIds: [] } };
  const base = getHubBaseUrl(); let response: Response;
  try { response = await fetch(`${base}/api/cpu-production/access`, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: forwardedHeaders(request) }); } catch { throw Object.assign(new Error("Integration Hub is unavailable."), { status: 503 }); }
  const body = await response.json().catch(() => undefined) as { principal?: { id?: string; displayName?: string }; allOplocs?: unknown; oplocs?: Array<{ id?: unknown }>; error?: { message?: string; code?: string } } | undefined;
  const sessionCode = response.status === 401 && (body?.error?.code === "FIKA_SESSION_MISSING" || body?.error?.code === "FIKA_SESSION_INVALID") ? body.error.code : undefined;
  if (!response.ok || !body?.principal?.id) throw Object.assign(new Error(body?.error?.message || "CPU Production access was not granted."), { status: response.status || 502, ...(sessionCode ? { code: sessionCode } : {}) });
  return { actor: { uid: body.principal.id, name: body.principal.displayName, role: "cpu-production" }, scope: { allOplocs: body.allOplocs === true, oplocIds: Array.isArray(body.oplocs) ? [...new Set(body.oplocs.flatMap(oploc => typeof oploc?.id === "string" && oploc.id ? [oploc.id] : []))] : [] } };
}

function accessFor(request: NextRequest) {
  let pending = accessByRequest.get(request);
  if (!pending) {
    pending = loadCpuAccess(request).catch(error => { accessByRequest.delete(request); throw error; });
    accessByRequest.set(request, pending);
  }
  return pending;
}
export async function requireCpuActor(request: NextRequest): Promise<CpuActor> { return (await accessFor(request)).actor; }
export async function requireCpuDestinationScope(request: NextRequest): Promise<CpuDestinationScope> { return (await accessFor(request)).scope; }
export function cpuDestinationAllowed(scope: CpuDestinationScope, destinationId?: string, destination?: import("./production-types").ProductionOrder["destination"]) {
  if (scope.allOplocs) return true;
  if (destination?.kind === "one-off" || destinationId?.includes(":one-off:")) return false;
  return Boolean(destinationId && scope.oplocIds.includes(destinationId));
}
