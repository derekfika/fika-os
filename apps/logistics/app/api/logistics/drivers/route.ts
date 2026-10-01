import { NextRequest, NextResponse } from "next/server";
import { requireLogisticsAccess } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { fetchGovernedDrivers } from "@/lib/driver-authority";
import { vehicleScope } from "@/lib/resource-authority";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireLogisticsAccess(request);
    const permittedVehicleIds = vehicleScope(principal, request.nextUrl.searchParams.get("vehicle"));
    const drivers = await fetchGovernedDrivers(request.headers.get("cookie") || undefined);
    return NextResponse.json({ permittedVehicleIds, drivers: drivers.map(driver => ({ ...driver, permittedDriverVehicleIds: driver.permittedDriverVehicleIds.filter(id => permittedVehicleIds.includes(id)) })).filter(driver => driver.permittedDriverVehicleIds.length) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
