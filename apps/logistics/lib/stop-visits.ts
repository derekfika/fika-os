import type { DeliveryLoad } from "./types";

/**
 * Durable physical-visit identity for load-backed work.
 *
 * A DeliveryLoad carries up to two LEGS: delivery (Run `runId`) and collection (Run
 * `collectionRunId`, or `runId` when none is stated). Each leg may name a physical visit
 * (`deliveryVisitId` / `collectionVisitId`). Legs that share a visit id are ONE physical
 * Stop on their Run; an id shared by a delivery leg and a collection leg is one MIXED Stop.
 * Legs may live on different Runs and therefore in different visits.
 *
 * Membership is by explicit id — never by display name, never by OPLOC alone, and never by
 * planned time — so editing one load's time cannot split an established visit. Loads that
 * pre-date this contract have no id and keep the original rule (identical placement =
 * one stop); they are given an id only when work is deliberately joined to them.
 *
 * Collections happen at the CUSTOMER (`destinationOplocId`), not at CPU (`originOplocId`);
 * CPU is only the eventual return destination.
 */
export type Lane = "delivery" | "collection";

export type VisitLoad = Pick<DeliveryLoad, "id" | "serviceDate" | "originOplocId" | "destinationOplocId" | "status"> & Partial<Pick<DeliveryLoad,
  "runId" | "vehicleId" | "scheduledTime" | "scheduledEnd" | "collectionRequired" | "collectionRunId" | "collectionScheduledTime" | "collectionScheduledEnd" | "deliveryVisitId" | "collectionVisitId">> & { loadIds?: string[] };

export const VISIT_PREFIX = "visit:";
export const visitStopId = (visitId: string) => `projection-visit:${visitId}`;
export const isVisitStopId = (id: string) => id.startsWith("projection-visit:");
export const visitIdFromStopId = (id: string) => id.slice("projection-visit:".length);
export const newVisitId = (random: () => string = () => globalThis.crypto.randomUUID()) => `${VISIT_PREFIX}${random()}`;

/** The Run that owns a leg (a collection with no explicit Run rides with the delivery Run). */
export const legRunId = (load: Pick<VisitLoad, "runId" | "collectionRunId" | "collectionRequired">, lane: Lane) =>
  lane === "delivery" ? load.runId : load.collectionRunId || (load.collectionRequired ? load.runId : undefined);
export const legVisitId = (load: Pick<VisitLoad, "deliveryVisitId" | "collectionVisitId">, lane: Lane) => lane === "delivery" ? load.deliveryVisitId : load.collectionVisitId;
export const hasLeg = (load: VisitLoad, lane: Lane) => lane === "delivery" ? Boolean(load.runId) : Boolean(load.collectionRequired && legRunId(load, "collection"));

/**
 * One key for "these loads form one projected/executed group". Used identically by the
 * projection merge, projected execution and run stop-order validation so they cannot
 * disagree. With a visit id the planned time is deliberately NOT part of the key.
 */
export function projectionGroupKey(load: VisitLoad): string {
  return JSON.stringify([
    load.serviceDate, load.originOplocId, load.destinationOplocId, load.runId, load.vehicleId,
    load.deliveryVisitId ?? [load.scheduledTime, load.scheduledEnd],
    Boolean(load.collectionRequired), load.collectionRunId,
    load.collectionVisitId ?? [load.collectionScheduledTime, load.collectionScheduledEnd],
    load.status,
  ]);
}

/** Identity of the PHYSICAL stop a leg belongs to on its Run. */
export function physicalStopKey(load: VisitLoad, lane: Lane): string {
  const visit = legVisitId(load, lane);
  return visit ? `visit:${visit}` : `${lane}|${projectionGroupKey(load)}`;
}

export type VisitCandidate = {
  /** Existing explicit visit id, or undefined for a legacy placement that has none yet. */
  visitId?: string;
  /** Every load leg currently in this visit (lane + load id). */
  legs: Array<{ loadId: string; lane: Lane }>;
  /** Earliest planned time of any leg, for labelling only. */
  firstTime?: string;
};

/** Visits already on `runId` for this customer OPLOC, across both lanes. */
export function visitCandidates(loads: VisitLoad[], input: { runId: string; customerOplocId: string; excludeLegs?: Array<{ loadId: string; lane: Lane }> }): VisitCandidate[] {
  const excluded = new Set((input.excludeLegs || []).map((leg) => `${leg.lane}:${leg.loadId}`));
  const byKey = new Map<string, VisitCandidate>();
  for (const load of loads) {
    if (load.status === "cancelled" || load.destinationOplocId !== input.customerOplocId) continue;
    for (const lane of ["delivery", "collection"] as const) {
      // An UNSCHEDULED collection leg is queue work, not yet a visit, so it is never a join target.
      if (excluded.has(`${lane}:${load.id}`) || !hasLeg(load, lane) || legRunId(load, lane) !== input.runId || (lane === "collection" && !load.collectionScheduledTime)) continue;
      const explicit = legVisitId(load, lane);
      const key = explicit ? `visit:${explicit}` : `legacy:${lane}|${projectionGroupKey(load)}`;
      const time = lane === "delivery" ? load.scheduledTime : load.collectionScheduledTime;
      const existing = byKey.get(key) || { ...(explicit ? { visitId: explicit } : {}), legs: [] as VisitCandidate["legs"] };
      existing.legs.push({ loadId: load.id, lane });
      if (time && (!existing.firstTime || time < existing.firstTime)) existing.firstTime = time;
      byKey.set(key, existing);
    }
  }
  // A legacy delivery group and a legacy collection group of the SAME loads are one legacy visit.
  const merged: VisitCandidate[] = [];
  for (const candidate of byKey.values()) {
    if (!candidate.visitId) {
      const twin = merged.find((item) => !item.visitId && item.legs.some((leg) => candidate.legs.some((other) => other.loadId === leg.loadId)));
      if (twin) { twin.legs.push(...candidate.legs); if (candidate.firstTime && (!twin.firstTime || candidate.firstTime < twin.firstTime)) twin.firstTime = candidate.firstTime; continue; }
    }
    merged.push(candidate);
  }
  return merged.sort((a, b) => (a.firstTime || "99:99").localeCompare(b.firstTime || "99:99"));
}

/** The identifier a client sends to pick this visit. */
export const visitRequestFor = (candidate: VisitCandidate) => candidate.visitId ?? `member:${candidate.legs[0].loadId}`;

export type VisitChoice =
  | { kind: "new" }
  | { kind: "join"; candidate: VisitCandidate }
  | { kind: "choice-required"; candidates: VisitCandidate[] }
  | { kind: "invalid"; reason: string };

/**
 * Assignment policy: an explicit request wins ("new" or a visit id that really exists at this
 * customer on this Run); otherwise one unambiguous visit is joined; none means a new visit;
 * several means Franco must choose. Never merges by name or OPLOC alone when ambiguous.
 */
export function chooseVisit(candidates: VisitCandidate[], requested?: string): VisitChoice {
  if (requested === "new") return { kind: "new" };
  if (requested) {
    // `member:<loadId>` names a legacy placement that has no visit id yet, by any load it contains.
    const match = requested.startsWith("member:")
      ? candidates.find((candidate) => candidate.legs.some((leg) => leg.loadId === requested.slice("member:".length)))
      : candidates.find((candidate) => candidate.visitId === requested);
    return match ? { kind: "join", candidate: match } : { kind: "invalid", reason: "That visit is not at this customer on this run." };
  }
  if (candidates.length === 0) return { kind: "new" };
  if (candidates.length === 1) return { kind: "join", candidate: candidates[0] };
  return { kind: "choice-required", candidates };
}

/** Rows for Organise Run: legs/stops sharing a visit id are one row; everything else is its own row. */
export function groupIntoVisitRows<T extends { stopId: string; visitId?: string }>(stops: T[]): Array<{ key: string; stops: T[] }> {
  const rows: Array<{ key: string; stops: T[] }> = [];
  for (const stop of stops) {
    const key = stop.visitId ? visitStopId(stop.visitId) : stop.stopId;
    const row = stop.visitId ? rows.find((item) => item.key === key) : undefined;
    if (row) row.stops.push(stop); else rows.push({ key, stops: [stop] });
  }
  return rows;
}
