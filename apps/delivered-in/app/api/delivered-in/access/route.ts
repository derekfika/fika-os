import { NextRequest, NextResponse } from "next/server";
import { resolveAccess } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const service = request.nextUrl.searchParams.get("service") === "grab-and-go" ? "grab-and-go" as const : "delivered-in" as const;
    return NextResponse.json(await resolveAccess(request, service), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Delivered-In access could not be resolved." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
