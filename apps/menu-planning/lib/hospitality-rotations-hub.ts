import { menuPlanningHubBaseUrl } from "./hub-url";

const HUB_PATH = "/api/hospitality-rotations";
const QUERY_KEYS = ["mode", "date", "revision"] as const;
const noStore = { "cache-control": "private, no-store" };

/** The user's own session cookie is the only credential: Hub AUTHMOD decides View/Manage/Publish server-side. */
export async function rotationsHubFetch(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${menuPlanningHubBaseUrl()}${path}`, { ...init, headers, cache: "no-store", redirect: "error" });
}

export function rotationsHubPath(url: URL) {
  const query = new URLSearchParams();
  for (const key of QUERY_KEYS) for (const value of url.searchParams.getAll(key)) query.append(key, value);
  const suffix = query.toString();
  return suffix ? `${HUB_PATH}?${suffix}` : HUB_PATH;
}

export async function forwardRotations(request: Request, method: "GET" | "POST", fetchHub: typeof rotationsHubFetch = rotationsHubFetch) {
  const init: RequestInit = method === "GET"
    ? { method }
    : { method, headers: { "content-type": request.headers.get("content-type") || "application/json" }, body: await request.text() };
  try {
    const upstream = await fetchHub(method === "GET" ? rotationsHubPath(new URL(request.url)) : HUB_PATH, request.headers.get("cookie"), init);
    const headers = new Headers(noStore);
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return Response.json({ error: { message: (error as Error).message } }, { status: 503, headers: noStore });
  }
}

export type RotationAccess = { permissions: { View: boolean; Manage: boolean; Publish: boolean }; principal?: { id: string; displayName?: string } };

/** Ask the Hub who the caller is and what rotation actions they hold. Never assumes access. */
export async function readRotationAccess(cookie: string | null, fetchHub: typeof rotationsHubFetch = rotationsHubFetch): Promise<RotationAccess> {
  const response = await fetchHub(`${HUB_PATH}?mode=access`, cookie, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({})) as Partial<RotationAccess> & { error?: { message?: string } };
  if (!response.ok || !body.permissions) throw Object.assign(new Error(body.error?.message || "Rotations access could not be verified."), { status: response.status || 503 });
  return { permissions: body.permissions, principal: body.principal };
}
