import { NextRequest, NextResponse } from "next/server";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { hubFetch } from "@/lib/hub";
import { buildTrustedRcoaHubPayload } from "@/lib/rcoa-booking-request";

export async function POST(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.create.rcoa", path: "/api/bookings/rcoa", outcome: "SUCCESS" }, async () => {
    const expectedOplocId = process.env.FIKA_RCOA_OPLOC_ID?.trim();
    if (!expectedOplocId) {
      return NextResponse.json({ error: { message: "RCoA booking is unavailable until its governed OPLOC mapping is configured." } }, { status: 503 });
    }
    let payload: ReturnType<typeof buildTrustedRcoaHubPayload>;
    try {
      payload = buildTrustedRcoaHubPayload(await request.json());
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
