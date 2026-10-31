import { NextRequest, NextResponse } from "next/server";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { hubFetch } from "@/lib/hub";
import { buildRcoaReplayHubPayload, buildTrustedRcoaHubPayload, RcoaBookingRequestSchema } from "@/lib/rcoa-booking-request";
import { loadGovernedRcoaMenu } from "@/lib/governed-rcoa-menu";
import { existingRcoaBookingIds } from "@/lib/rcoa-booking-replay";

export async function POST(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.create.rcoa", path: "/api/bookings/rcoa", outcome: "SUCCESS" }, async () => {
    const expectedOplocId = process.env.FIKA_RCOA_OPLOC_ID?.trim();
    if (!expectedOplocId) {
      return NextResponse.json({ error: { message: "RCoA booking is unavailable until its governed OPLOC mapping is configured." } }, { status: 503 });
    }
    let payload: ReturnType<typeof buildTrustedRcoaHubPayload>;
    let value: unknown;
    try { value = RcoaBookingRequestSchema.parse(await request.json()); }
    catch { return NextResponse.json({ error: { message: "The RCoA request is invalid." } }, { status: 400 }); }
    let existingOnly = false;
    let menuVerified = false;
    try {
      // Validate against the same governed catalogue the portal displays; unverifiable => fail closed.
      const governedMenu = await loadGovernedRcoaMenu(expectedOplocId);
      menuVerified = true;
      payload = buildTrustedRcoaHubPayload(value, governedMenu.menu, governedMenu.visibility);
    } catch (error) {
      // A historical retry must not create or amend anything when current availability changed.
      try {
        const parsed = RcoaBookingRequestSchema.parse(value);
        if (!(await existingRcoaBookingIds([parsed.bookingId])).has(parsed.bookingId)) return NextResponse.json({ error: { message: (error as Error).message || "The RCoA request is invalid." } }, { status: (error as { status?: number }).status || (menuVerified ? 400 : 503) });
        payload = buildRcoaReplayHubPayload(parsed); existingOnly = true;
      } catch (lookupError) { return NextResponse.json({ error: { message: (lookupError as Error).message } }, { status: 503 }); }
    }
    try {
      const response = await hubFetch("/api/bookings/mnk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fika-expected-rcoa-oploc-id": expectedOplocId,
          ...(existingOnly ? { "x-fika-rcoa-existing-only": "true" } : {}),
        },
        body: JSON.stringify(payload),
      });
      recordDataAccess({ operation: "booking.create.rcoa", source: "NETWORK_UPSTREAM", documents: 0, dataset: "hospitality/bookings" });
      const bodyText = await response.text();
      if (!response.ok) {
        try {
          const error = (JSON.parse(bodyText) as { error?: { code?: unknown; requestId?: unknown } }).error;
          console.error("hospitality.booking.create.upstream-rejected", { path: "/api/bookings/rcoa", status: response.status, code: typeof error?.code === "string" ? error.code : undefined, hubRequestId: typeof error?.requestId === "string" ? error.requestId : undefined });
        } catch { console.error("hospitality.booking.create.upstream-rejected", { path: "/api/bookings/rcoa", status: response.status }); }
      }
      try {
        return NextResponse.json(JSON.parse(bodyText), { status: response.status });
      } catch {
        return NextResponse.json({ error: { message: `The Canon bridge returned an unexpected response (HTTP ${response.status}).` } }, { status: response.ok ? 502 : response.status });
      }
    } catch (error) {
      setDataTraceOutcome("ERROR");
      const message = (error as Error).message || "The RCoA booking could not be submitted.";
      return NextResponse.json({ error: { message } }, { status: 503 });
    }
  });
}
