import type { DeliveryStop } from "../../lib/types";

/** Driver-facing reasons a run cannot depart yet. Mirrors the server's assertRunReady; the server stays authoritative. */
export function dispatchBlockers({ hasStops, deliveries, openIssues, unscheduled }: {
  hasStops: boolean;
  deliveries: Pick<DeliveryStop, "loaded">[];
  openIssues: number;
  unscheduled: number;
}): string[] {
  const blockers: string[] = [];
  if (!hasStops) blockers.push("This run has no stops to load.");
  const unloaded = deliveries.filter((stop) => !stop.loaded).length;
  if (unloaded) blockers.push(`${unloaded} ${unloaded === 1 ? "delivery" : "deliveries"} still to load`);
  if (openIssues) blockers.push(`Resolve ${openIssues} open ${openIssues === 1 ? "issue" : "issues"} before departure`);
  if (unscheduled) blockers.push(`${unscheduled} ${unscheduled === 1 ? "stop has" : "stops have"} no scheduled time`);
  return blockers;
}

/** Same fields the server reads when it checks for scheduled timing. */
export const hasScheduledTime = (stop: DeliveryStop) => Boolean(stop.plannedWindow?.startTime || stop.plannedArrivalTime || stop.window?.startTime || stop.requiredTime);
