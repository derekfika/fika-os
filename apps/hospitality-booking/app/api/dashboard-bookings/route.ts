import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";

async function readHubJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`The Integration Hub returned an unexpected response (${response.status}).`);
  }
}

export async function GET(request: NextRequest) {
  try {
    const site = request.nextUrl.searchParams.get("site");
    const path = site
      ? `/api/hospitality-bookings?site=${encodeURIComponent(site)}`
      : "/api/hospitality-bookings";
    const response = await hubUserFetch(path, request.headers.get("cookie"));
    const body = await readHubJson(response);
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const response = await hubUserFetch(
      "/api/hospitality-bookings",
      request.headers.get("cookie"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await request.json()),
      },
    );
    const body = await readHubJson(response);
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: 503 },
    );
  }
}
