import { NextResponse } from "next/server";
import { portalSite } from "@/lib/portal-sites";
import { hubFetch } from "@/lib/hub";

/** Public, non-Firestore site identity lookup; booking authorization remains server-side on submission. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const site = portalSite(url.searchParams.get("site") || undefined);
  if (!site) return NextResponse.json({ error: { message: "A configured Hospitality site context is required." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (site.key === "cfc" || site.key === "munich-re") {
    try {
      const response = await hubFetch(`/api/hospitality-catalogue/public-site?site=${encodeURIComponent(site.key)}`);
      const body = await response.json() as { oplocId?: unknown; error?: { message?: string } };
      if (!response.ok || typeof body.oplocId !== "string" || !body.oplocId.trim()) return NextResponse.json({ error: { message: body.error?.message || "This Hospitality site has no confirmed catalogue location." } }, { status: response.ok ? 503 : response.status, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json({ oplocId: body.oplocId }, { headers: { "Cache-Control": "no-store" } });
    } catch { return NextResponse.json({ error: { message: "This Hospitality site's catalogue location could not be verified." } }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  }
  const oplocId = site.key === "rcoa" ? process.env.FIKA_RCOA_OPLOC_ID?.trim() : site.canonicalOplocId;
  if (!oplocId) return NextResponse.json({ error: { message: "This Hospitality site has no public catalogue OPLOC binding." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ oplocId }, { headers: { "Cache-Control": "public, max-age=300" } });
}
