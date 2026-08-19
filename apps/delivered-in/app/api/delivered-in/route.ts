import { NextRequest, NextResponse } from "next/server";
import { projectedWeeks } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await projectedWeeks(request, request.nextUrl.searchParams.get("oplocId") || undefined);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Delivered-In could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
