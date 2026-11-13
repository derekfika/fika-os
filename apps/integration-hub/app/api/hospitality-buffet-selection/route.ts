import { NextRequest, NextResponse } from "next/server";
import { hotForkBuffetMenu } from "@fika/server-shared/hospitality-buffet-selection";
import { errorResponse } from "@/lib/api";
import { authoriseCatalogueRead } from "@/lib/hospitality-catalogue-read-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public-safe source menu. Existing bridge authentication permits customer portals to read it. */
export async function GET(request: NextRequest) {
  try {
    if (process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED !== "true") return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    await authoriseCatalogueRead(request);
    return NextResponse.json(hotForkBuffetMenu, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
