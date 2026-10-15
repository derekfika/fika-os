import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { gallagherDashboardBookings } from "@/lib/hospitality-booking-service";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

function requireGallagherBridge(request: NextRequest) {
  const expected = process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN?.trim();
  if (!expected) throw Object.assign(new Error("The Gallagher dashboard bridge is not configured."), { status: 503 });
  if (request.headers.get("x-fika-gallagher-bridge-token") !== expected) {
    throw Object.assign(new Error("Gallagher dashboard bridge access denied."), { status: 401 });
  }
}

/** Server-to-server, read-only projection from canonical Hospitality bookings. */
export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.gallagher-bookings.read", path: "/api/gallagher-bookings", requestId: request.headers.get("x-request-id") || undefined }, async () => {
    try {
      requireGallagherBridge(request);
      const bookings = await gallagherDashboardBookings();
      return NextResponse.json({ bookings }, { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" } });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
