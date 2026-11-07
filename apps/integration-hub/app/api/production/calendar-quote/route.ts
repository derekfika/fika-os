import { NextRequest, NextResponse } from "next/server";
import { stagingDriveAccessBlocked } from "@fika/server-shared/drive-owner";
import { errorResponse } from "@/lib/api";
import { internalProductionRequestAllowed } from "@/lib/production-internal-auth";
import { productionOrderDetail } from "@/lib/production-domain";
import { getBookingByCanonicalId } from "@/lib/hospitality-booking-service";
import { assertCpuXCalendarQuoteAccess, cpuXCalendarQuoteContext } from "@/lib/cpux-calendar-quote";
import { requireFikaSession } from "@/lib/fika-session";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const internal = Boolean(process.env.FIKA_INTERNAL_API_TOKEN?.trim()) && internalProductionRequestAllowed(request);
    // Authenticate before any business read. Interactive readers never inherit service authority.
    const session = internal ? undefined : await requireFikaSession(request);
    if (await stagingDriveAccessBlocked()) {
      return NextResponse.json({ error: { code: "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED", message: "The saved quote PDF is unavailable in this environment." } }, { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    const context = await cpuXCalendarQuoteContext(request.nextUrl.searchParams.get("bookingId") || "", {
      order: productionOrderDetail, booking: getBookingByCanonicalId,
    });
    if (session) {
      const repository = new FirestoreAuthModRepository();
      const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
      await assertCpuXCalendarQuoteAccess(repository, principal, context.oplocId);
      if (!context.quote) throw Object.assign(new Error("No current saved quote PDF matches the active Production Order."), { status: 409 });
      return NextResponse.json({ quote: context.quote }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json(context, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
