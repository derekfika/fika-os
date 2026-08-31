import { NextRequest, NextResponse } from "next/server";
import { hubFetch } from "@/lib/hub";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";

export async function POST(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.create", path: "/api/bookings", outcome: "SUCCESS" }, async () => { try {
    const payload = await request.json();
    const endpoint = "/api/bookings/mnk";
    const response = await hubFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    recordDataAccess({ operation: "booking.create", source: "NETWORK_UPSTREAM", documents: 0, dataset: "hospitality/bookings" });
    const bodyText = await response.text();
    try {
      return NextResponse.json(JSON.parse(bodyText), {
        status: response.status,
      });
    } catch {
      return NextResponse.json(
        {
          error: {
            message: `The Canon bridge returned an unexpected response (HTTP ${response.status}). Check that the Integration Hub is running on port 3200 and the bridge token matches.`,
          },
        },
        { status: response.ok ? 502 : response.status },
      );
    }
  } catch (error) { setDataTraceOutcome("ERROR");
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: 503 },
    );
  } });
}
