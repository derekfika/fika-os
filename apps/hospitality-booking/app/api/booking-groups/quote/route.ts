import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";

export async function POST(request: NextRequest) {
  try {
    const response = await hubUserFetch("/api/hospitality-booking-groups/quote", request.headers.get("cookie"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await request.json()) });
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { message: "The group quote could not be confirmed. Refresh and retry the same group to resume safely." } }, { status: 503 });
  }
}
