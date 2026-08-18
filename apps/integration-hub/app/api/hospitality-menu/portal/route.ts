import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireBridgeAccess } from "@/lib/hospitality-bridge-auth";
import { hospitalityPortalReadContract } from "@/lib/hospitality-catalogue-service";

const Query = z.object({ oplocId: z.string().min(8), operationalAreaId: z.string().min(8).optional(), serviceDate: z.string().date(), serviceContext: z.string().max(160).optional() });
/** Typed, read-only contract: portals receive governed offerings, never raw Hub records. */
export async function GET(request: NextRequest) {
  try { requireBridgeAccess(request); return NextResponse.json(await hospitalityPortalReadContract(Query.parse(Object.fromEntries(request.nextUrl.searchParams))), { headers: { "Cache-Control": "no-store, max-age=0" } }); }
  catch (error) { return errorResponse(error); }
}
