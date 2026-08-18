import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";

const Query = z.object({ eventRole: z.string().trim().min(1).max(160) });
export async function GET(request: NextRequest) {
  try {
    requireActor(request);
    const { eventRole } = Query.parse({ eventRole: request.nextUrl.searchParams.get("eventRole") || "" });
    const hub = process.env.INTEGRATION_HUB_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:3200" : "");
    if (!hub) return NextResponse.json({ error: { message: "The governed staffing source is not configured." } }, { status: 503 });
    const response = await fetch(`${hub}/api/event-staffing?eventRole=${encodeURIComponent(eventRole)}`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) return NextResponse.json({ error: body.error || { message: "Governed staffing suggestions are unavailable." } }, { status: response.status });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
