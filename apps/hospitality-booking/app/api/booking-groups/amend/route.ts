import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";
export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("bookingGroupId") || "";
    const response = await hubUserFetch(`/api/hospitality-booking-groups/amend?bookingGroupId=${encodeURIComponent(id)}`, request.headers.get("cookie"));
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: { message: "The current booking could not be loaded." } }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  try {
    const response = await hubUserFetch("/api/hospitality-booking-groups/amend", request.headers.get("cookie"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await request.json()) });
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { message: "The amendment could not be confirmed. Refresh the booking before retrying." } }, { status: 503 });
  }
}
