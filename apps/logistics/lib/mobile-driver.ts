import type { DeliveryRun, DeliveryStop } from "./types";

export const driverIssueTypes = [
  "Cannot access building",
  "Customer unavailable",
  "Missing / incorrect load",
  "Running late",
  "Vehicle issue",
  "Other",
] as const;

export function stopIsCollection(stop: Pick<DeliveryStop, "movementType" | "linkedOperation">) {
  return stop.movementType === "collection" || stop.linkedOperation === "collection";
}

export function stopCounts(stops: DeliveryStop[]) {
  return {
    total: stops.length,
    remaining: stops.filter((stop) => stop.status !== "completed").length,
    completed: stops.filter((stop) => stop.status === "completed").length,
  };
}

export function restoredStopStatus(stop: Pick<DeliveryStop, "completedFromStatus">): "planned" | "arrived" {
  return stop.completedFromStatus || "arrived";
}

export function showDispatchChecklist(status: DeliveryRun["status"]) {
  return status === "planned" || status === "ready";
}

export function announceDriverChange(serviceDate: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("fika-logistics-live");
  channel.postMessage({ serviceDate });
  channel.close();
}
