import type { LogisticsDriverOption, LogisticsVehicleId } from "../../shared/logistics-authority";
import { requiredUpstreamUrl } from "./runtime";

export async function fetchGovernedDrivers(cookie?: string, input: { vehicleId?: LogisticsVehicleId; driverId?: string } = {}): Promise<LogisticsDriverOption[]> {
  const query = new URLSearchParams({ ...(input.vehicleId ? { vehicle: input.vehicleId } : {}), ...(input.driverId ? { driverId: input.driverId } : {}) });
  const response = await fetch(`${requiredUpstreamUrl("FIKA_HUB_BASE_URL")}/api/logistics/drivers?${query}`, { headers: { ...(cookie ? { cookie } : {}) }, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.drivers)) throw Object.assign(new Error("Governed driver authority is unavailable or the selected driver is no longer eligible."), { status: response.ok ? 503 : response.status });
  return body.drivers;
}
export async function requireGovernedDriver(driverId: string, vehicleId: LogisticsVehicleId, cookie?: string) {
  const drivers = await fetchGovernedDrivers(cookie, { vehicleId, driverId });
  const driver = drivers.find(item => item.driverId === driverId && item.permittedDriverVehicleIds.includes(vehicleId));
  if (!driver) throw Object.assign(new Error("The selected driver is no longer eligible for this vehicle."), { status: 422 });
  return { driverId: driver.driverId, driverLabel: driver.displayName };
}
