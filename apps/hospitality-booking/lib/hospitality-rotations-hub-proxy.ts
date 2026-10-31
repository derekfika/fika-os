import { hubUserFetch } from "./hub";

const HUB_PATH = "/api/hospitality-rotations";
const QUERY_KEYS = ["mode", "date", "revision", "resource"] as const;

export function hospitalityRotationsHubPath(url: URL) {
  const query = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    for (const value of url.searchParams.getAll(key)) query.append(key, value);
  }
  for (const key of ["dishIds", "itemIds"] as const) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value.slice(0, 32_000));
  }
  const suffix = query.toString();
  return suffix ? `${HUB_PATH}?${suffix}` : HUB_PATH;
}

export async function forwardHospitalityRotations(request: Request, method: "GET" | "POST", fetchHub: typeof hubUserFetch = hubUserFetch) {
  const target = method === "GET" ? hospitalityRotationsHubPath(new URL(request.url)) : HUB_PATH;
  const init: RequestInit = method === "GET"
    ? { method }
    : { method, headers: { "content-type": request.headers.get("content-type") || "application/json" }, body: await request.text() };
  try {
    const upstream = await fetchHub(target, request.headers.get("cookie"), init);
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.set("cache-control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return Response.json({ error: { message: (error as Error).message } }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
