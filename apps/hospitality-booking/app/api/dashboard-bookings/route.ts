import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function readHubJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`The Integration Hub returned an unexpected response (${response.status}).`);
  }
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.list", path: "/api/dashboard-bookings", outcome: "SUCCESS" }, async () => { try {
    const site = request.nextUrl.searchParams.get("site");
    const oploc = request.nextUrl.searchParams.get("oploc");
    const archive = request.nextUrl.searchParams.get("archive");
    const params = new URLSearchParams();
    if (site) params.set("site", site);
    if (oploc) params.set("oploc", oploc);
    if (archive) params.set("archive", archive);
    const path = params.toString() ? `/api/hospitality-bookings?${params}` : "/api/hospitality-bookings";
    const response = await hubUserFetch(path, request.headers.get("cookie"));
    recordDataAccess({ operation: "booking.list", source: "NETWORK_UPSTREAM", documents: 0, dataset: "hospitality/bookings" });
    const body = await readHubJson(response);
    return NextResponse.json(body, { status: response.status });
  } catch (error) { setDataTraceOutcome("ERROR");
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: 503 },
    );
  } });
}
export async function POST(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.mutate", path: "/api/dashboard-bookings", outcome: "SUCCESS" }, async () => { try {
    const response = await hubUserFetch(
      "/api/hospitality-bookings",
      request.headers.get("cookie"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await request.json()),
      },
    );
    recordDataAccess({ operation: "booking.mutate", source: "NETWORK_UPSTREAM", documents: 0, dataset: "hospitality/bookings" });
    const body = await readHubJson(response);
    return NextResponse.json(body, { status: response.status });
  } catch (error) { setDataTraceOutcome("ERROR");
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: 503 },
    );
  } });
}
