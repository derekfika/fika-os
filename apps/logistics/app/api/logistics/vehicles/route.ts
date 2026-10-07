import { NextRequest, NextResponse } from "next/server";
import { requireLogisticsAccess } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { vehicleScope } from "@/lib/resource-authority";

/** Session authority, independent of optional historical driver assignments. */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireLogisticsAccess(request);
    const permittedVehicleIds = vehicleScope(principal, request.nextUrl.searchParams.get("vehicle"));
    return NextResponse.json({ permittedVehicleIds }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
