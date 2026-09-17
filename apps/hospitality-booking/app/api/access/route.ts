import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";
import { portalSiteForAuthorisedOploc } from "@/lib/portal-sites";

export async function GET(request: NextRequest) {
  try {
    const response = await hubUserFetch("/api/hospitality/access", request.headers.get("cookie"));
    const body = await response.json();
    if (response.ok && Array.isArray(body.sites)) {
      body.sites = body.sites.flatMap((site: { id: string; label: string }) => {
        const portal = portalSiteForAuthorisedOploc(site);
        return portal ? [{ ...site, portalSiteKey: portal.key }] : [];
      });
    }
    if (response.ok && Array.isArray(body.sites)) {
      // Both surfaces are governed by this single AUTHMOD application
      // assignment. Keep access authority in Hub; this is only a surface
      // description for the Hospitality chooser.
      body.surfaces = {
        bookingPlatform: body.sites.length > 0,
        operationsDashboard: body.sites.length > 0,
      };
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: 503 }); }
}
