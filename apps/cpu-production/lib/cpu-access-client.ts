import type { NextRequest } from "next/server";
import { forwardedHeaders, hubJson, type CpuActor } from "./production-http-client";
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
const aliasByRequest = new WeakMap<NextRequest, Map<string, Promise<string | undefined>>>();
type OplocIdentities = { oplocs: Array<{ canonicalId: string; requestedId?: string; label: string }> };
/** Resolve historical governed IDs through Hub authority before filtering; never rewrite source evidence. */
export async function resolveCpuDestinationScope(request: NextRequest, destinationIds: readonly string[]): Promise<CpuDestinationScope> {
  const scope = await requireCpuDestinationScope(request);
  if (scope.allOplocs) return scope;
  const ids = [...new Set(destinationIds.filter(id => id && !id.includes(":one-off:") && !scope.oplocIds.includes(id)))];
  if (!ids.length) return scope;
  let aliases = aliasByRequest.get(request);
  if (!aliases) { aliases = new Map(); aliasByRequest.set(request, aliases); }
  const missing = ids.filter(id => !aliases.has(id));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const token = process.env.FIKA_INTERNAL_API_TOKEN?.trim();
    // The existing server credential reads reference identity only. The user's
    // admitted canonical scope remains the authority for every returned alias.
    const pending = hubJson(request, "/api/oploc-labels", { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...(token ? { "x-fika-internal-token": token } : {}) }, body: JSON.stringify({ oplocIds: batch }) }, (value): value is OplocIdentities => Boolean(value && typeof value === "object" && Array.isArray((value as OplocIdentities).oplocs) && (value as OplocIdentities).oplocs.every(item => typeof item.canonicalId === "string" && typeof item.label === "string" && (item.requestedId === undefined || typeof item.requestedId === "string")))).then(value => {
      const resolved = new Map<string, string>();
      for (const item of value.oplocs) {
        const requested = item.requestedId || item.canonicalId;
        if (!batch.includes(requested) || (resolved.has(requested) && resolved.get(requested) !== item.canonicalId)) throw Object.assign(new Error("Hub returned inconsistent destination identity evidence."), { status: 503, code: "CPU_DESTINATION_IDENTITY_INVALID" });
        resolved.set(requested, item.canonicalId);
      }
      return resolved;
    });
    for (const id of batch) aliases.set(id, pending.then(resolved => resolved.get(id)));
  }
  const canonicalIds = await Promise.all(ids.map(id => aliases.get(id)!));
  return { ...scope, oplocIds: [...scope.oplocIds, ...ids.filter((_, index) => Boolean(canonicalIds[index] && scope.oplocIds.includes(canonicalIds[index]!)))] };
}
export function cpuDestinationAllowed(scope: CpuDestinationScope, destinationId?: string, destination?: import("./production-types").ProductionOrder["destination"]) {
  if (scope.allOplocs) return true;
  if (destination?.kind === "one-off" || destinationId?.includes(":one-off:")) return false;
  return Boolean(destinationId && scope.oplocIds.includes(destinationId));
}
