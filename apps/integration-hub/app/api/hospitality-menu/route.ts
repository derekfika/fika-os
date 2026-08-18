import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { mnkMenuReadContract } from "@/lib/hospitality-booking-service";
import { requireBridgeAccess } from "@/lib/hospitality-bridge-auth";

/** Read-only portal contract. The bridge token is intentionally separate from Hub user sessions. */
export async function GET(request: NextRequest) {
  try {
    requireBridgeAccess(request);
    return NextResponse.json(await mnkMenuReadContract(), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
