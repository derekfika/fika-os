import { hubFetch } from "./hub";

/** Only the server bridge token reaches Hub. The endpoint contains customer-safe menu metadata. */
export async function forwardBuffetMenu(fetchHub: typeof hubFetch = hubFetch) {
  if (process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED !== "true") return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
  try {
    const upstream = await fetchHub("/api/hospitality-buffet-selection", { method: "GET", signal: AbortSignal.timeout(10_000) });
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: { message: "The buffet menu is unavailable. Please try again." } }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
