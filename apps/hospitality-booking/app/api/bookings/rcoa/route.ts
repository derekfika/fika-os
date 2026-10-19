import { NextRequest, NextResponse } from "next/server";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { hubFetch } from "@/lib/hub";
import { buildTrustedRcoaHubPayload } from "@/lib/rcoa-booking-request";
import { loadGovernedRcoaMenu } from "@/lib/governed-rcoa-menu";

export async function POST(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.create.rcoa", path: "/api/bookings/rcoa", outcome: "SUCCESS" }, async () => {
    const expectedOplocId = process.env.FIKA_RCOA_OPLOC_ID?.trim();
    if (!expectedOplocId) {
      return NextResponse.json({ error: { message: "RCoA booking is unavailable until its governed OPLOC mapping is configured." } }, { status: 503 });
    }
    let payload: ReturnType<typeof buildTrustedRcoaHubPayload>;
    let governedMenu: Awaited<ReturnType<typeof loadGovernedRcoaMenu>>;
    try {
      // Validate against the same governed catalogue the portal displays; unverifiable => fail closed.
      governedMenu = await loadGovernedRcoaMenu(expectedOplocId);
    } catch (error) {
      return NextResponse.json({ error: { message: (error as Error).message || "The menu could not be verified." } }, { status: (error as { status?: number }).status || 503 });
    }
    try {
      payload = buildTrustedRcoaHubPayload(await request.json(), governedMenu);
    } catch (error) {
      const message = (error as Error).message || "The RCoA request is invalid.";
      return NextResponse.json({ error: { message } }, { status: 400 });
    }
    try {
      const response = await hubFetch("/api/bookings/mnk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fika-expected-rcoa-oploc-id": expectedOplocId,
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
