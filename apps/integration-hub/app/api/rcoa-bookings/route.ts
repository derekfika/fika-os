import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { rcoaDashboardBookings } from "@/lib/rcoa-dashboard-bookings";

const privateHeaders = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };

function requireRcoaDashboardBridge(request: NextRequest) {
  const expected = process.env.RCOA_DASHBOARD_BRIDGE_TOKEN?.trim();
  if (!expected) throw Object.assign(new Error("The RCoA dashboard bridge is not configured."), { status: 503 });
  const provided = Buffer.from(request.headers.get("x-fika-rcoa-dashboard-token") || "");
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw Object.assign(new Error("RCoA dashboard bridge access denied."), { status: 401 });
  }
}

/** Server-to-server, read-only projection from canonical RCoA Hospitality bookings. */
export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.rcoa-dashboard.read", path: "/api/rcoa-bookings", requestId: request.headers.get("x-request-id") || undefined }, async () => {
    try {
      requireRcoaDashboardBridge(request);
      const bookings = await rcoaDashboardBookings();
      return NextResponse.json({ bookings }, { headers: privateHeaders });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
