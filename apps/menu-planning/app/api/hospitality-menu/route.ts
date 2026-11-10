import { NextRequest, NextResponse } from "next/server";
import { resolveMenuActor } from "@/lib/auth";
import { hospitalityMenuPreview } from "@/lib/hospitality-menu-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveMenuActor(request);
    const date = request.nextUrl.searchParams.get("date") || "";
    const oplocId = request.nextUrl.searchParams.get("oplocId") || "";
    return NextResponse.json(await hospitalityMenuPreview(date, oplocId, actor), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Hospitality menu is unavailable." } }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}