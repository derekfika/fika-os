import type { DeliveryStop } from "../../lib/types";
import { stopIsCollection } from "../../lib/mobile-driver";

export type RunVisitStatus = "planned" | "current" | "attention" | "completed";

/** One physical stop on the run: the delivery and/or collection lanes that share a visit. */
export type RunVisit = {
  key: string;
  stops: DeliveryStop[];
  status: RunVisitStatus;
  /** 1-based position in the dispatcher's saved visiting order. */
  visitNumber: number;
};

export const hasOpenIssue = (stop: DeliveryStop) => stop.status === "issue" || (stop.issues || []).some((issue) => issue.status === "open");

function visitStatus(stops: DeliveryStop[]): RunVisitStatus {
  if (stops.some(hasOpenIssue)) return "attention";
  if (stops.every((stop) => stop.status === "completed")) return "completed";
  if (stops.some((stop) => stop.status === "arrived")) return "current";
  return "planned";
}

/**
 * Groups the run's ordered lane stops into physical visits. Order is the dispatcher's saved sequence
 * (Run.orderedStopIds); stops that share a visit id are one visit, so mixed stops stay together.
 */
export function groupRunVisits(orderedStops: DeliveryStop[]): RunVisit[] {
  const groups = new Map<string, DeliveryStop[]>();
  for (const stop of orderedStops) {
    const key = stop.visitId || stop.canonicalId;
    groups.set(key, [...(groups.get(key) || []), stop]);
  }
  return [...groups].map(([key, stops], index) => ({ key, stops, status: visitStatus(stops), visitNumber: index + 1 }));
}

export function visitProgress(visits: RunVisit[]) {
  const completed = visits.filter((visit) => visit.status === "completed").length;
  return { completed, total: visits.length, percent: visits.length ? Math.round((completed / visits.length) * 100) : 0 };
}

export function visitLaneCounts(visits: RunVisit[]) {
  const stops = visits.flatMap((visit) => visit.stops);
  return {
    deliveries: stops.filter((stop) => !stopIsCollection(stop)).length,
    collections: stops.filter((stop) => stopIsCollection(stop)).length,
    attention: visits.filter((visit) => visit.status === "attention").length,
  };
}

/** The first visit that is not yet complete, in run order. */
export const nextRunVisit = (visits: RunVisit[]) => visits.find((visit) => visit.status !== "completed");
