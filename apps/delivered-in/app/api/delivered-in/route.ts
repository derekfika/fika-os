import { NextRequest, NextResponse } from "next/server";
import { projectedWeeks } from "@/lib/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

async function handleGet(request: NextRequest) {
  try {
    const result = await projectedWeeks(request, request.nextUrl.searchParams.get("oplocId") || undefined);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Delivered-In could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
