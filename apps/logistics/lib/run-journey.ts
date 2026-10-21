import type { DeliveryRun } from "./types";

export type RunJourneyTimes = { departure?: string; returnTime?: string };

export function validateRunJourneyTimes({ departure, returnTime }: RunJourneyTimes): string | undefined {
  const valid = (value?: string) => value === undefined || /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(value);
  if (!valid(departure) || !valid(returnTime)) return "Use 15-minute time increments.";
  if (Boolean(departure) !== Boolean(returnTime)) return "Set both planned CPU times, or clear both.";
  if (departure && returnTime && departure >= returnTime) return "Planned CPU return must be later than departure on the service date.";
  return undefined;
}

export function overlappingRunIds(runs: Array<Pick<DeliveryRun, "canonicalId" | "vehicleId" | "plannedCpuDepartureTime" | "plannedCpuReturnTime">>): Set<string> {
  const overlaps = new Set<string>();
  for (const run of runs) {
    if (!run.vehicleId || !run.plannedCpuDepartureTime || !run.plannedCpuReturnTime) continue;
    for (const other of runs) {
      if (other.canonicalId === run.canonicalId || other.vehicleId !== run.vehicleId || !other.plannedCpuDepartureTime || !other.plannedCpuReturnTime) continue;
      if (other.plannedCpuDepartureTime < run.plannedCpuReturnTime && other.plannedCpuReturnTime > run.plannedCpuDepartureTime) {
        overlaps.add(run.canonicalId);
        overlaps.add(other.canonicalId);
      }
    }
  }
  return overlaps;
}
