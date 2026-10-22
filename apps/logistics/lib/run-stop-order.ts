import type { DeliveryLoad, DeliveryRun, DeliveryStop } from "./types";

/**
 * Canonical visiting order for a Run.
 *
 * A Run's physical stops are (a) native Stop documents owned by the run and (b)
 * projected stops derived from DeliveryLoad legs (`projection-stop:<lane>:<loadId>`),
 * where loads sharing one placement key are ONE physical stop. The order is stored
 * on `DeliveryRun.orderedStopIds` (the existing canonical field), version-protected
 * by the run version. Any member load id may identify a merged projected stop, so a
 * later regrouping does not strand a stored order.
 */
export type RunStopWork = {
  native: Pick<DeliveryStop, "canonicalId" | "canonicalLoadIds">[];
  legs: Array<{ load: Pick<DeliveryLoad, "id"> & Partial<DeliveryLoad>; lane: "delivery" | "collection" }>;
};

export const projectedStopId = (lane: "delivery" | "collection", loadId: string) => `projection-stop:${lane}:${loadId}`;

export type PhysicalStop = { key: string; ids: string[] };

/** Every physical stop of the run, as the set of identities that may name it. */
export function physicalStops(work: RunStopWork, groupKey: (load: RunStopWork["legs"][number]["load"]) => string): PhysicalStop[] {
  const result: PhysicalStop[] = work.native.map((stop) => ({ key: stop.canonicalId, ids: [stop.canonicalId] }));
  const groups = new Map<string, string[]>();
  for (const leg of work.legs) {
    // A native stop that already owns the load represents it; never double count a visit.
    if (work.native.some((stop) => (stop.canonicalLoadIds || []).includes(leg.load.id))) continue;
    const key = `${leg.lane}|${groupKey(leg.load)}`;
    groups.set(key, [...(groups.get(key) || []), projectedStopId(leg.lane, leg.load.id)]);
  }
  for (const [key, ids] of groups) result.push({ key, ids });
  return result;
}

/** Returns a human-readable reason when `submitted` is not an exact permutation of the run's physical stops. */
export function validateRunStopOrder(submitted: unknown, work: RunStopWork, groupKey: Parameters<typeof physicalStops>[1]): string | undefined {
  if (!Array.isArray(submitted) || submitted.some((id) => typeof id !== "string" || !id)) return "Stop order must be an array of canonical stop IDs.";
  if (new Set(submitted).size !== submitted.length) return "Stop order contains a duplicate stop.";
  const stops = physicalStops(work, groupKey);
  const owner = new Map<string, string>();
  for (const stop of stops) for (const id of stop.ids) owner.set(id, stop.key);
  const seen = new Set<string>();
  for (const id of submitted as string[]) {
    const key = owner.get(id);
    if (!key) return "Stop order names a stop that does not belong to this run.";
    if (seen.has(key)) return "Stop order names the same physical stop twice.";
    seen.add(key);
  }
  if (seen.size !== stops.length) return "Stop order must include every physical stop in this run.";
  return undefined;
}

/** Why an empty Run cannot be retired, or undefined when it can. */
export function emptyRunRetirementBlocker(run: Pick<DeliveryRun, "status" | "orderedStopIds" | "retiredAt">, work: RunStopWork): string | undefined {
  if (run.retiredAt) return "This run is already retired.";
  if (!["draft", "planned"].includes(run.status)) return "Only a draft or planned run can be retired. Dispatched and completed runs are operational history.";
  if (work.native.length || work.legs.length) return "This run still contains operational work. Return its work to the queue first.";
  return undefined;
}

/**
 * Applies a stored order to the current stop ids. Stops named in `stored` keep that
 * relative order; stops not yet ordered (new work) follow, ordered by `fallback`.
 */
export function applyStoredStopOrder<T extends { id: string; aliases?: string[] }>(stops: T[], stored: string[], fallback: (a: T, b: T) => number): T[] {
  const index = (stop: T) => {
    const positions = [stop.id, ...(stop.aliases || [])].map((id) => stored.indexOf(id)).filter((position) => position >= 0);
    return positions.length ? Math.min(...positions) : -1;
  };
  const ordered = stops.filter((stop) => index(stop) >= 0).sort((a, b) => index(a) - index(b));
  const unordered = stops.filter((stop) => index(stop) < 0).sort(fallback);
  return [...ordered, ...unordered];
}
