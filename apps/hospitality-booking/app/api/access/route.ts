import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";
import { portalSiteForOploc } from "@/lib/portal-sites";

export async function GET(request: NextRequest) {
  try {
    const response = await hubUserFetch("/api/hospitality/access", request.headers.get("cookie"));
    const body = await response.json();
    if (response.ok && Array.isArray(body.sites)) {
      body.sites = body.sites.flatMap((site: { id: string; label: string }) => {
        const portal = portalSiteForOploc(site);
        return portal ? [{ ...site, portalSiteKey: portal.key }] : [];
      });
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: 503 }); }
}
