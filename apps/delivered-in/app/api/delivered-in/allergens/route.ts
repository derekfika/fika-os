import { NextRequest, NextResponse } from "next/server";
import { projectedAllergenDay } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const oplocId = request.nextUrl.searchParams.get("oplocId"); const publicationDayId = request.nextUrl.searchParams.get("publicationDayId");
    if (!oplocId || !publicationDayId) return NextResponse.json({ error: { message: "A site and published day are required." } }, { status: 422 });
    return NextResponse.json(await projectedAllergenDay(request, oplocId, publicationDayId), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The site allergen checker could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
