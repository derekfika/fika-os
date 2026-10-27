import type { NextRequest } from "next/server";
import { requireLogisticsAccess } from "@/lib/auth";

export const denied = (message: string, code: string, status = 403) => Object.assign(new Error(message), { status, code });

/**
 * The authenticated driver vehicle. It comes only from the signed vehicle PIN session, never from the URL or request body, so
 * one vehicle can neither read nor change another vehicle's notifications or push subscriptions.
 */
export async function driverVehicle(request: NextRequest): Promise<"van1" | "van2"> {
  const principal = await requireLogisticsAccess(request);
  if (principal.sessionKind !== "mobile-pin") throw denied("Driver notifications are available to vehicle sessions only.", "LOGISTICS_NOTIFICATIONS_VEHICLE_REQUIRED");
  const permitted = principal.permittedVehicleIds ?? [];
  const vehicle = permitted[0];
  if (permitted.length !== 1 || (vehicle !== "van1" && vehicle !== "van2")) throw denied("This session cannot access notifications.", "LOGISTICS_NOTIFICATIONS_VEHICLE_DENIED");
  const requested = request.nextUrl.searchParams.get("vehicle");
  if (requested && requested !== vehicle) throw denied("This session cannot access the requested vehicle.", "LOGISTICS_MOBILE_VEHICLE_DENIED");
  return vehicle;
}
