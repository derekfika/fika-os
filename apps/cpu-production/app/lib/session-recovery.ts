export const CPU_SESSION_OBSERVATION_EVENT = "fika:cpu-session-observation";
export type CpuSessionCode = "FIKA_SESSION_MISSING" | "FIKA_SESSION_INVALID";
export type CpuSessionObservation = { request: number; code: CpuSessionCode | "confirmed" | "denied" | "identity-changed" };

export function cpuSessionCode(status: number, body: unknown): CpuSessionCode | undefined {
  if (status !== 401 || !body || typeof body !== "object") return undefined;
  const code = (body as { error?: { code?: unknown } }).error?.code;
  return code === "FIKA_SESSION_MISSING" || code === "FIKA_SESSION_INVALID" ? code : undefined;
}

function notify(observation: CpuSessionObservation) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CPU_SESSION_OBSERVATION_EVENT, { detail: observation }));
}

let requestSequence = 0;
let verifiedCacheScope: string | undefined;
let scopeRequest = 0;
/** Observe session failures without consuming the response or retrying any command. */
export async function fetchCpuApi(path: string, init?: RequestInit, observe = notify): Promise<Response> {
  const request = ++requestSequence;
  const response = await fetch(path, init);
  if (response.status === 401) {
    const code = cpuSessionCode(response.status, await response.clone().json().catch(() => undefined));
    if (code) observe({ request, code });
  } else if (response.status === 403) {
    observe({ request, code: "denied" });
  } else if (response.ok && path === "/api/production?cacheScope=1") {
    const body = await response.clone().json().catch(() => undefined);
    if (typeof body?.cacheScope === "string" && body.cacheScope && request > scopeRequest) {
      scopeRequest = request;
      const identityChanged = verifiedCacheScope !== undefined && verifiedCacheScope !== body.cacheScope;
      verifiedCacheScope = body.cacheScope;
      observe({ request, code: identityChanged ? "identity-changed" : "confirmed" });
      if (identityChanged) throw new Error("The signed-in account changed. Reload CPU to continue.");
    }
  }
  return response;
}

/** The Hub validates returnTo against its configured application origins. */
export function cpuSignInUrl(hub: string | undefined, currentUrl: string, code: CpuSessionCode): string | undefined {
  if (!hub) return undefined;
  try {
    const target = new URL(hub);
    const current = new URL(currentUrl);
    const isLoopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const allowedProtocol = (url: URL) => url.protocol === "https:" || url.protocol === "http:" && isLoopback(url);
    if (!allowedProtocol(target) || !allowedProtocol(current) || target.username || target.password || current.username || current.password || target.pathname !== "/") return undefined;
    target.search = "";
    target.hash = "";
    target.searchParams.set("returnTo", current.href);
    target.searchParams.set("appId", "cpu-production");
    target.searchParams.set("launchError", code);
    return target.href;
  } catch { return undefined; }
}
