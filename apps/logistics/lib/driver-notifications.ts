/**
 * Driver notification rules. Pure functions: each run is compared with the last state that was notified for it, so
 * notifications come from authoritative before/after state, never from UI interactions or the change feed alone.
 * Only today's operational work (Europe/London service date) creates notifications.
 */

export type DriverVisit = {
  visitId: string;
  lane: "delivery" | "collection";
  destination: string;
  /** Logistics-owned operational time (HH:MM), never advisory source timing. */
  time?: string;
  jobIds: string[];
  /** Normalised, driver-visible quantity summary (e.g. "7 items · 85 pieces"). Never version numbers or internal ids. */
  quantities?: string;
  /** Normalised, driver-visible access and delivery instructions. */
  instructions?: string;
};

export type DriverRunSnapshot = {
  runId: string;
  /** Authoritative committed run version; identifies the change that produced this state. */
  version: number;
  vehicleId: "van1" | "van2";
  vehicleLabel: string;
  serviceDate: string;
  /** draft runs are planner-only and never driver-visible. */
  status: "draft" | "planned" | "ready" | "dispatched" | "completed" | "cancelled";
  departure?: string;
  return?: string;
  visits: DriverVisit[];
  /** Saved stop sequence (run.orderedStopIds). When present on both sides it is the authoritative order. */
  stopOrder?: string[];
};

export type DriverNotificationKind =
  | "run-assigned"
  | "delivery-assigned"
  | "collection-assigned"
  | "stop-removed"
  | "work-reassigned"
  | "collection-time-changed"
  | "delivery-time-changed"
  | "route-order-updated"
  | "departure-time-changed"
  | "return-time-changed"
  | "load-details-changed"
  | "delivery-instructions-updated"
  | "run-cancelled";

export type DriverNotification = {
  kind: DriverNotificationKind;
  vehicleId: "van1" | "van2";
  runId: string;
  serviceDate: string;
  title: string;
  /** Authenticated inbox detail. May name destinations and times; never shown on a locked screen. */
  inboxText: string;
  /** Push body: privacy-safe, no destinations or customer details. */
  pushBody: string;
  priority: "normal" | "high";
  /**
   * Identity of one committed change: the run version it produced plus the kind and subject. Replaying the same commit gives
   * the same key (idempotent); a later independent change to the same value gets a new version and therefore a new key.
   */
  dedupeKey: string;
  /** Committed run version the notice belongs to. */
  revision: number;
};

const DRIVER_VISIBLE: ReadonlyArray<DriverRunSnapshot["status"]> = ["planned", "ready", "dispatched", "completed"];
export const isDriverVisible = (run: DriverRunSnapshot) => DRIVER_VISIBLE.includes(run.status);

/** Operational business date in Europe/London, from the server clock (never the device clock). */
export function londonServiceDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A notice may be pushed only while its service date is still today in Europe/London. Checked again at send time. */
export function isEligibleNow(notice: Pick<DriverNotification, "serviceDate">, now: Date) {
  return notice.serviceDate === londonServiceDate(now);
}

const dateLabel = (serviceDate: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${serviceDate}T12:00:00Z`));

const pushPrefix = (vehicleLabel: string, serviceDate: string) => `${vehicleLabel} · ${dateLabel(serviceDate)}`;

const normalise = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

function note(kind: DriverNotificationKind, run: DriverRunSnapshot, revision: number, parts: { title: string; inboxText: string; pushTail: string; priority?: "normal" | "high"; subject: string; vehicleLabel?: string }): DriverNotification {
  return {
    kind,
    vehicleId: run.vehicleId,
    runId: run.runId,
    serviceDate: run.serviceDate,
    title: parts.title,
    inboxText: parts.inboxText,
    pushBody: `${pushPrefix(parts.vehicleLabel ?? run.vehicleLabel, run.serviceDate)} · ${parts.pushTail}`,
    priority: parts.priority ?? "normal",
    dedupeKey: `${run.runId}:v${revision}:${kind}:${parts.subject}`,
    revision,
  };
}

/**
 * Notifications for one run changing from `before` to `after`. `movedJobIds` are jobs that also appear on another run in the
 * same batch; they are reported once by `diffBatch` as a reassignment, not as a removal from this run.
 */
export function diffRun(before: DriverRunSnapshot | undefined, after: DriverRunSnapshot | undefined, movedJobIds: ReadonlySet<string> = new Set()): DriverNotification[] {
  const run = after ?? before;
  if (!run) return [];
  const revision = after?.version ?? before!.version;
  const notices: DriverNotification[] = [];
  const beforeVisible = Boolean(before && isDriverVisible(before));
  const afterVisible = Boolean(after && isDriverVisible(after));

  // A run appearing for the first time, populated, is a new assignment. Empty drafts never notify.
  if (!beforeVisible && afterVisible && after!.visits.length > 0) {
    notices.push(note("run-assigned", after!, revision, { title: "New run assigned", inboxText: `Run for ${dateLabel(after!.serviceDate)} has been added to your schedule with ${after!.visits.length} stop${after!.visits.length === 1 ? "" : "s"}.`, pushTail: "A new run is ready to view.", subject: "assigned" }));
    return notices;
  }

  if (beforeVisible && !afterVisible) {
    // A run that disappears is cancelled only if its work is not accounted for by a move to another run.
    const remaining = before!.visits.flatMap(visit => visit.jobIds).filter(id => !movedJobIds.has(id));
    if (remaining.length) notices.push(note("run-cancelled", before!, revision, { title: "Run cancelled", inboxText: `Your run for ${dateLabel(before!.serviceDate)} is no longer scheduled.`, pushTail: "Your assigned run is no longer scheduled.", priority: before!.status === "dispatched" ? "high" : "normal", subject: "cancelled" }));
    return notices;
  }
  if (!beforeVisible || !afterVisible) return notices;

  // Same run id, different vehicle: the old vehicle is told the run was reassigned, the new vehicle receives it as a new run.
  if (before!.vehicleId !== after!.vehicleId) {
    notices.push(note("work-reassigned", before!, revision, { title: "Run reassigned", inboxText: `Run for ${dateLabel(after!.serviceDate)} is now assigned to ${after!.vehicleLabel}.`, pushTail: "Your run has been reassigned.", priority: before!.status === "dispatched" ? "high" : "normal", subject: `vehicle:${after!.vehicleId}` }));
    notices.push(note("run-assigned", after!, revision, { title: "New run assigned", inboxText: `Run for ${dateLabel(after!.serviceDate)} has been added to your schedule with ${after!.visits.length} stop${after!.visits.length === 1 ? "" : "s"}.`, pushTail: "A new run is ready to view.", subject: "vehicle-assigned" }));
    return notices;
  }

  const beforeById = new Map(before!.visits.map(visit => [visit.visitId, visit]));
  const afterById = new Map(after!.visits.map(visit => [visit.visitId, visit]));
  const highPriority = before!.status === "dispatched" || after!.status === "dispatched";

  for (const visit of after!.visits) {
    const previous = beforeById.get(visit.visitId);
    if (!previous) {
      const added = visit.jobIds.filter(id => !movedJobIds.has(id));
      if (added.length) {
        const collection = visit.lane === "collection";
        notices.push(note(collection ? "collection-assigned" : "delivery-assigned", after!, revision, { title: collection ? "New collection assigned" : "New delivery assigned", inboxText: `${collection ? "Collection" : "Delivery"} at ${visit.destination}${visit.time ? ` at ${visit.time}` : ""} has been added to your run.`, pushTail: `A ${collection ? "collection" : "delivery"} has been added to your run.`, subject: `visit:${visit.visitId}` }));
      }
      continue;
    }
    // Partial load changes keep the physical stop: only the item-level change is reported.
    const removedJobs = previous.jobIds.filter(id => !visit.jobIds.includes(id) && !movedJobIds.has(id));
    const addedJobs = visit.jobIds.filter(id => !previous.jobIds.includes(id) && !movedJobIds.has(id));
    const quantitiesChanged = normalise(previous.quantities) !== normalise(visit.quantities);
    if (removedJobs.length || addedJobs.length) {
      notices.push(note("load-details-changed", after!, revision, { title: "Load details changed", inboxText: `Load at ${visit.destination} changed: ${addedJobs.length} item${addedJobs.length === 1 ? "" : "s"} added, ${removedJobs.length} removed.`, pushTail: "Review your updated load quantities.", priority: highPriority ? "high" : "normal", subject: `load:${visit.visitId}` }));
    } else if (quantitiesChanged) {
      notices.push(note("load-details-changed", after!, revision, { title: "Load details changed", inboxText: `Quantities at ${visit.destination} changed from ${normalise(previous.quantities) || "unspecified"} to ${normalise(visit.quantities) || "unspecified"}.`, pushTail: "Review your updated load quantities.", priority: highPriority ? "high" : "normal", subject: `quantities:${visit.visitId}` }));
    }
    if (normalise(previous.instructions) !== normalise(visit.instructions) && normalise(visit.instructions)) {
      notices.push(note("delivery-instructions-updated", after!, revision, { title: "Delivery instructions updated", inboxText: `Instructions for ${visit.destination} have changed. Open the stop to read them.`, pushTail: "Check the updated stop instructions.", priority: highPriority ? "high" : "normal", subject: `instructions:${visit.visitId}` }));
    }
    if (previous.time !== visit.time && visit.time) {
      const collection = visit.lane === "collection";
      notices.push(note(collection ? "collection-time-changed" : "delivery-time-changed", after!, revision, { title: collection ? "Collection time changed" : "Delivery time changed", inboxText: `${visit.destination} ${collection ? "collection" : "delivery"} moved from ${previous.time || "unscheduled"} to ${visit.time}.`, pushTail: `${previous.time || "unscheduled"} → ${visit.time}.`, priority: highPriority ? "high" : "normal", subject: `time:${visit.visitId}` }));
    }
  }

  for (const visit of before!.visits) {
    if (afterById.has(visit.visitId)) continue;
    const remaining = visit.jobIds.filter(id => !movedJobIds.has(id));
    if (!remaining.length) continue;
    notices.push(note("stop-removed", after!, revision, { title: "Stop removed", inboxText: `${visit.lane === "collection" ? "Collection" : "Delivery"} at ${visit.destination} has been removed from your route.`, pushTail: "A stop has been removed from your route.", priority: highPriority ? "high" : "normal", subject: `removed:${visit.visitId}` }));
  }

  // Stop order: only the order of visits present in both snapshots matters.
  // Stops that were added, removed or moved to another vehicle are reported by their own notices; they must not also read as a reorder.
  const stopOrderBefore = before!.stopOrder, stopOrderAfter = after!.stopOrder;
  const orderBefore = stopOrderBefore && stopOrderAfter ? stopOrderBefore.filter(id => stopOrderAfter.includes(id)) : before!.visits.map(visit => visit.visitId).filter(id => afterById.has(id));
  const orderAfter = stopOrderBefore && stopOrderAfter ? stopOrderAfter.filter(id => stopOrderBefore.includes(id)) : after!.visits.map(visit => visit.visitId).filter(id => beforeById.has(id));
  if (orderBefore.join("|") !== orderAfter.join("|")) {
    const first = after!.visits.find(visit => visit.visitId === orderAfter[0]);
    notices.push(note("route-order-updated", after!, revision, { title: "Route order updated", inboxText: first ? `${first.destination} is now your first stop.` : "Your stop order has changed.", pushTail: "Your stop sequence has changed.", priority: highPriority ? "high" : "normal", subject: `order:${orderAfter.join("|")}` }));
  }

  if (before!.departure !== after!.departure && after!.departure) notices.push(note("departure-time-changed", after!, revision, { title: "Departure time changed", inboxText: `Departure moved from ${before!.departure || "unscheduled"} to ${after!.departure}.`, pushTail: `Departure moved from ${before!.departure || "unscheduled"} to ${after!.departure}.`, priority: highPriority ? "high" : "normal", subject: `departure:${after!.departure}` }));
  if (before!.return !== after!.return && after!.return) notices.push(note("return-time-changed", after!, revision, { title: "Return time changed", inboxText: `Return moved from ${before!.return || "unscheduled"} to ${after!.return}.`, pushTail: `Return moved from ${before!.return || "unscheduled"} to ${after!.return}.`, priority: highPriority ? "high" : "normal", subject: `return:${after!.return}` }));
  return notices;
}

export type DiffBatchOptions = {
  /**
   * First run of notification tracking: record snapshots for existing runs without notifying anyone about them. Without a
   * baseline, every pre-existing driver-visible run would look like a new assignment.
   */
  baseline?: boolean;
};

/**
 * Notifications for a batch of runs. A job that leaves one run and appears on another in the same batch is a move:
 *  - a different vehicle gets "Work reassigned" (the losing vehicle) and "New delivery assigned" (the gaining vehicle);
 *  - the same vehicle gets one "Load details changed" for its run changes.
 * Only today's runs create notifications; future and past service dates are ignored.
 */
export function diffBatch(today: string, before: DriverRunSnapshot[], after: DriverRunSnapshot[], options: DiffBatchOptions = {}): DriverNotification[] {
  if (options.baseline) return [];
  const beforeByRun = new Map(before.filter(run => run.serviceDate === today).map(run => [run.runId, run]));
  const afterByRun = new Map(after.filter(run => run.serviceDate === today).map(run => [run.runId, run]));
  const runIds = new Set([...beforeByRun.keys(), ...afterByRun.keys()]);

  const ownerBefore = new Map<string, string>();
  for (const run of beforeByRun.values()) for (const visit of run.visits) for (const job of visit.jobIds) ownerBefore.set(job, run.runId);
  const ownerAfter = new Map<string, string>();
  for (const run of afterByRun.values()) for (const visit of run.visits) for (const job of visit.jobIds) ownerAfter.set(job, run.runId);

  const moved = new Map<string, { from: string; to: string }>();
  for (const [job, from] of ownerBefore) {
    const to = ownerAfter.get(job);
    if (to && to !== from) moved.set(job, { from, to });
  }

  const notices: DriverNotification[] = [];
  for (const runId of runIds) {
    const previous = beforeByRun.get(runId);
    const current = afterByRun.get(runId);
    const movedHere = new Set([...moved.entries()].filter(([, move]) => move.from === runId || move.to === runId).map(([job]) => job));
    notices.push(...diffRun(previous, current, movedHere));
  }

  // Moves are reported once per moved stop (not once per job) and name the destination, never an internal id. Each notice is keyed by
  // the destination run's committed version, so one move notifies once per affected vehicle. Wording follows the lane that moved.
  const groups = new Map<string, { from: string; to: string; lane: "delivery" | "collection"; destination: string; visitId: string; jobs: number }>();
  for (const [job, { from, to }] of moved) {
    const toRun = afterByRun.get(to);
    const visit = toRun?.visits.find(candidate => candidate.jobIds.includes(job));
    const key = `${from}>${to}|${visit?.visitId ?? job}`;
    const group = groups.get(key);
    if (group) group.jobs += 1;
    else groups.set(key, { from, to, lane: visit?.lane ?? "delivery", destination: visit?.destination ?? "your stop", visitId: visit?.visitId ?? job, jobs: 1 });
  }
  for (const group of groups.values()) {
    const fromRun = beforeByRun.get(group.from);
    const toRun = afterByRun.get(group.to);
    if (!toRun || !isDriverVisible(toRun)) continue;
    const work = group.lane === "collection" ? "collection" : "delivery";
    const Work = group.lane === "collection" ? "Collection" : "Delivery";
    const where = group.destination === "your stop" ? "" : ` at ${group.destination}`;
    if (fromRun && isDriverVisible(fromRun) && fromRun.vehicleId !== toRun.vehicleId) {
      // A partial move leaves the stop on this vehicle with fewer items: say part of it moved rather than that the stop was removed.
      const stillHere = afterByRun.get(group.from)?.visits.some(visit => visit.lane === group.lane && visit.destination === group.destination);
      notices.push(note("work-reassigned", fromRun, toRun.version, stillHere
        ? { title: "Work reassigned", inboxText: `Part of the ${work}${where} has been moved to another vehicle.`, pushTail: `Part of a ${work} has been moved to another vehicle.`, subject: `moved-out:${group.visitId}` }
        : { title: "Work reassigned", inboxText: `${Work}${where} has been removed from your run.`, pushTail: `A ${work} has been removed from your run.`, subject: `moved-out:${group.visitId}` }));
    } else if (fromRun && isDriverVisible(fromRun)) {
      notices.push(note("load-details-changed", toRun, toRun.version, { title: "Load details changed", inboxText: `${Work}${where} moved from one of your runs to another.`, pushTail: "Review your updated load quantities.", subject: `moved-within:${group.visitId}` }));
    }
    if (!fromRun || fromRun.vehicleId !== toRun.vehicleId) {
      notices.push(note(group.lane === "collection" ? "collection-assigned" : "delivery-assigned", toRun, toRun.version, { title: `New ${work} assigned`, inboxText: `${Work}${where} has been added to your run.`, pushTail: `A ${work} has been added to your run.`, subject: `moved-in:${group.visitId}` }));
    }
  }
  return notices;
}
