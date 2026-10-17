import { NextResponse } from "next/server";
import { portalSite } from "@/lib/portal-sites";

/** Public, non-Firestore site identity lookup; booking authorization remains server-side on submission. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const site = portalSite(url.searchParams.get("site") || undefined);
  if (!site) return NextResponse.json({ error: { message: "A configured Hospitality site context is required." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const oplocId = site.key === "rcoa" ? process.env.FIKA_RCOA_OPLOC_ID?.trim() : site.canonicalOplocId;
  if (!oplocId) return NextResponse.json({ error: { message: "This Hospitality site has no public catalogue OPLOC binding." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ oplocId }, { headers: { "Cache-Control": "public, max-age=300" } });
}
