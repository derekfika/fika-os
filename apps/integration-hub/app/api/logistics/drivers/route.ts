import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireFikaSession } from "@/lib/fika-session";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { assertAllowed, createAuthModEvaluationContext, resolvePermittedVehicleIds, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { listLogisticsDrivers, resolveLogisticsDriver } from "@/lib/authmod-core/logistics-drivers";
import { isLogisticsVehicleId } from "../../../../../shared/logistics-authority";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFikaSession(request);
    const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, identityKind: session.identityKind };
    const repository = new FirestoreAuthModRepository();
    const context = createAuthModEvaluationContext(repository, principal);
    assertAllowed(await resolveUserAccess(repository, { principal, appId: "logistics" }, context));
    const vehicles = await resolvePermittedVehicleIds(repository, { principal }, context);
    if (vehicles.resolutionFailed) throw Object.assign(new Error("Vehicle authority unavailable."), { status: 503 });
    const requestedVehicle = request.nextUrl.searchParams.get("vehicle");
    if (!vehicles.permittedVehicleIds.length || requestedVehicle && (!isLogisticsVehicleId(requestedVehicle) || !vehicles.permittedVehicleIds.includes(requestedVehicle))) throw Object.assign(new Error("Vehicle access denied."), { status: 403 });
    const allowed = requestedVehicle ? [requestedVehicle] : vehicles.permittedVehicleIds;
    const driverId = request.nextUrl.searchParams.get("driverId");
    const drivers = driverId ? [await resolveLogisticsDriver(repository, driverId)].filter(item => Boolean(item)) : await listLogisticsDrivers(repository);
    const scoped = drivers.flatMap(driver => driver ? [{ ...driver, permittedDriverVehicleIds: driver.permittedDriverVehicleIds.filter(id => allowed.includes(id)) }] : []).filter(driver => driver.permittedDriverVehicleIds.length);
    if (driverId && !scoped.length) throw Object.assign(new Error("The selected driver is no longer eligible for this vehicle."), { status: 422 });
    return NextResponse.json({ drivers: scoped }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(Object.assign(error instanceof Error ? error : new Error("Driver authority unavailable."), { status: (error as { status?: number }).status || 503 })); }
}
