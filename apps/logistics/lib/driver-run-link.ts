import { isLogisticsVehicleId } from "../../shared/logistics-authority";
import { isOperationalDate } from "./date";
import type { PlannerRunView } from "./planner-read-model";

export type DriverLinkRun = Pick<PlannerRunView, "vehicleId" | "runId" | "serviceDate">;

export function driverRunLink({ vehicleId, runId, serviceDate }: DriverLinkRun) {
  if (!isLogisticsVehicleId(vehicleId) || !runId || !isOperationalDate(serviceDate)) return;
  return {
    vehicleId,
    href: `/mobile/${vehicleId}?run=${encodeURIComponent(runId)}&serviceDate=${encodeURIComponent(serviceDate)}`,
  };
}
