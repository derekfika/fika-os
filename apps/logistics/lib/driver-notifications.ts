/**
 * Driver notification rules. Pure functions: a run is compared with the last state that was notified for it, so
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
};

export type DriverRunSnapshot = {
  runId: string;
  vehicleId: "van1" | "van2";
  vehicleLabel: string;
  serviceDate: string;
  /** draft runs are planner-only and never driver-visible. */
  status: "draft" | "planned" | "ready" | "dispatched" | "completed" | "cancelled";
  departure?: string;
  return?: string;
  visits: DriverVisit[];
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
  /** Stable identity for idempotent storage: the same change never creates two inbox rows. */
  dedupeKey: string;
};

const DRIVER_VISIBLE: ReadonlyArray<DriverRunSnapshot["status"]> = ["planned", "ready", "dispatched", "completed"];
export const isDriverVisible = (run: DriverRunSnapshot) => DRIVER_VISIBLE.includes(run.status);

/** Operational business date in Europe/London, from the server clock (never the device clock). */
export function londonServiceDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const dateLabel = (serviceDate: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${serviceDate}T12:00:00Z`));

const pushPrefix = (run: { vehicleLabel: string; serviceDate: string }) => `${run.vehicleLabel} · ${dateLabel(run.serviceDate)}`;

function note(kind: DriverNotificationKind, run: DriverRunSnapshot, parts: { title: string; inboxText: string; pushTail: string; priority?: "normal" | "high"; key: string }): DriverNotification {
  return {
    kind,
    vehicleId: run.vehicleId,
    runId: run.runId,
    serviceDate: run.serviceDate,
    title: parts.title,
    inboxText: parts.inboxText,
    pushBody: `${pushPrefix(run)} · ${parts.pushTail}`,
    priority: parts.priority ?? "normal",
    dedupeKey: `${run.runId}:${kind}:${parts.key}`,
  };
}

const visitKey = (visit: DriverVisit) => visit.visitId;

/**
 * Notifications for one run changing from `before` to `after`. `movedJobIds` are jobs that also appear on another vehicle's
 * run in the same batch; they are reported once as a reassignment, not as a removal from this run.
 */
export function diffRun(before: DriverRunSnapshot | undefined, after: DriverRunSnapshot | undefined, movedJobIds: ReadonlySet<string> = new Set()): DriverNotification[] {
  const run = after ?? before;
  if (!run) return [];
  const notices: DriverNotification[] = [];
  const beforeVisible = Boolean(before && isDriverVisible(before));
  const afterVisible = Boolean(after && isDriverVisible(after));

  // A run appearing for the first time, populated, is a new assignment. Empty drafts never notify.
  if (!beforeVisible && afterVisible && after!.visits.length > 0) {
    notices.push(note("run-assigned", after!, { title: "New run assigned", inboxText: `Run for ${dateLabel(after!.serviceDate)} has been added to your schedule with ${after!.visits.length} stop${after!.visits.length === 1 ? "" : "s"}.`, pushTail: "A new run is ready to view.", key: "assigned" }));
    return notices;
  }

  if (beforeVisible && !afterVisible) {
    // Work that moved to another vehicle is reported as a reassignment, not as a cancelled run.
    const remaining = before!.visits.flatMap(visit => visit.jobIds).filter(id => !movedJobIds.has(id));
    if (remaining.length) notices.push(note("run-cancelled", before!, { title: "Run cancelled", inboxText: `Your run for ${dateLabel(before!.serviceDate)} is no longer scheduled.`, pushTail: "Your assigned run is no longer scheduled.", priority: before!.status === "dispatched" ? "high" : "normal", key: "cancelled" }));
    return notices;
  }
  if (!beforeVisible || !afterVisible) return notices;

  const beforeById = new Map(before!.visits.map(visit => [visitKey(visit), visit]));
  const afterById = new Map(after!.visits.map(visit => [visitKey(visit), visit]));
  const highPriority = before!.status === "dispatched" || after!.status === "dispatched";

  for (const visit of after!.visits) {
    const previous = beforeById.get(visitKey(visit));
    if (!previous) {
      const kind = visit.lane === "collection" ? "collection-assigned" : "delivery-assigned";
      const added = visit.jobIds.filter(id => !movedJobIds.has(id));
      if (added.length) notices.push(note(kind, after!, { title: visit.lane === "collection" ? "New collection assigned" : "New delivery assigned", inboxText: `${visit.lane === "collection" ? "Collection" : "Delivery"} at ${visit.destination}${visit.time ? ` at ${visit.time}` : ""} has been added to your run.`, pushTail: `A ${visit.lane === "collection" ? "collection" : "delivery"} has been added to your run.`, key: `${visit.visitId}:added` }));
      continue;
    }
    const removedJobs = previous.jobIds.filter(id => !visit.jobIds.includes(id) && !movedJobIds.has(id));
    const addedJobs = visit.jobIds.filter(id => !previous.jobIds.includes(id) && !movedJobIds.has(id));
    // Partial load changes keep the physical stop: only the item-level change is reported.
    if (removedJobs.length || addedJobs.length) notices.push(note("load-details-changed", after!, { title: "Load details changed", inboxText: `Load at ${visit.destination} changed: ${addedJobs.length} item${addedJobs.length === 1 ? "" : "s"} added, ${removedJobs.length} removed.`, pushTail: "Review your updated load quantities.", priority: highPriority ? "high" : "normal", key: `${visit.visitId}:load:${[...addedJobs, ...removedJobs].sort().join(",")}` }));
    if (previous.time !== visit.time && visit.time) {
      const isCollection = visit.lane === "collection";
      notices.push(note(isCollection ? "collection-time-changed" : "delivery-time-changed", after!, { title: isCollection ? "Collection time changed" : "Delivery time changed", inboxText: `${visit.destination} ${isCollection ? "collection" : "delivery"} moved from ${previous.time || "unscheduled"} to ${visit.time}.`, pushTail: `${previous.time || "unscheduled"} → ${visit.time}.`, priority: highPriority ? "high" : "normal", key: `${visit.visitId}:time:${visit.time}` }));
    }
  }

  for (const visit of before!.visits) {
    if (afterById.has(visitKey(visit))) continue;
    const remaining = visit.jobIds.filter(id => !movedJobIds.has(id));
    if (!remaining.length) continue;
    notices.push(note("stop-removed", after!, { title: "Stop removed", inboxText: `${visit.lane === "collection" ? "Collection" : "Delivery"} at ${visit.destination} has been removed from your route.`, pushTail: "A stop has been removed from your route.", priority: highPriority ? "high" : "normal", key: `${visit.visitId}:removed` }));
  }

  // Stop order: only the order of visits present in both snapshots matters.
  const commonBefore = before!.visits.map(visitKey).filter(key => afterById.has(key));
  const commonAfter = after!.visits.map(visitKey).filter(key => beforeById.has(key));
  if (commonBefore.join("|") !== commonAfter.join("|")) {
    const first = after!.visits.find(visit => visitKey(visit) === commonAfter[0]);
    notices.push(note("route-order-updated", after!, { title: "Route order updated", inboxText: first ? `${first.destination} is now your first stop.` : "Your stop order has changed.", pushTail: "Your stop sequence has changed.", priority: highPriority ? "high" : "normal", key: `order:${commonAfter.join("|")}` }));
  }

  if (before!.departure !== after!.departure && after!.departure) notices.push(note("departure-time-changed", after!, { title: "Departure time changed", inboxText: `Departure moved from ${before!.departure || "unscheduled"} to ${after!.departure}.`, pushTail: `Departure moved from ${before!.departure || "unscheduled"} to ${after!.departure}.`, priority: highPriority ? "high" : "normal", key: `departure:${after!.departure}` }));
  if (before!.return !== after!.return && after!.return) notices.push(note("return-time-changed", after!, { title: "Return time changed", inboxText: `Return moved from ${before!.return || "unscheduled"} to ${after!.return}.`, pushTail: `Return moved from ${before!.return || "unscheduled"} to ${after!.return}.`, priority: highPriority ? "high" : "normal", key: `return:${after!.return}` }));
  return notices;
}

/**
 * Notifications for a batch of runs. Jobs that leave one vehicle's run and appear on another's in the same batch are a
 * reassignment: the losing vehicle gets "Work reassigned", the gaining vehicle gets "New delivery assigned".
 * Only runs for `today` create notifications; future and past service dates are ignored.
 */
export function diffBatch(today: string, before: DriverRunSnapshot[], after: DriverRunSnapshot[]): DriverNotification[] {
  const beforeByRun = new Map(before.filter(run => run.serviceDate === today).map(run => [run.runId, run]));
  const afterByRun = new Map(after.filter(run => run.serviceDate === today).map(run => [run.runId, run]));
  const runIds = new Set([...beforeByRun.keys(), ...afterByRun.keys()]);

  const jobOwnerBefore = new Map<string, string>();
  for (const run of beforeByRun.values()) for (const visit of run.visits) for (const job of visit.jobIds) jobOwnerBefore.set(job, run.runId);
  const jobOwnerAfter = new Map<string, string>();
  for (const run of afterByRun.values()) for (const visit of run.visits) for (const job of visit.jobIds) jobOwnerAfter.set(job, run.runId);

  // A job leaving one run and arriving on another (any vehicle) is a move, whether or not the vehicles differ.
  const moved = new Set<string>();
  for (const [job, from] of jobOwnerBefore) {
    const to = jobOwnerAfter.get(job);
    if (to && to !== from) moved.add(job);
  }

  const notices: DriverNotification[] = [];
  for (const runId of runIds) {
    const previous = beforeByRun.get(runId);
    const current = afterByRun.get(runId);
    const movedHere = new Set([...moved].filter(job => jobOwnerBefore.get(job) === runId || jobOwnerAfter.get(job) === runId));
    notices.push(...diffRun(previous, current, movedHere));
  }

  // Reassignment notices, one per affected vehicle, identified by the job that moved.
  for (const job of moved) {
    const fromRun = beforeByRun.get(jobOwnerBefore.get(job)!);
    const toRun = afterByRun.get(jobOwnerAfter.get(job)!);
    if (fromRun && isDriverVisible(fromRun) && afterByRun.get(fromRun.runId) && fromRun.vehicleId !== toRun?.vehicleId) {
      notices.push(note("work-reassigned", fromRun, { title: "Work reassigned", inboxText: `A delivery has been removed from your run (${job}).`, pushTail: "A delivery has been removed from your run.", priority: "normal", key: `moved-out:${job}` }));
    }
    if (toRun && isDriverVisible(toRun)) {
      notices.push(note("delivery-assigned", toRun, { title: "New delivery assigned", inboxText: `A delivery has been added to your run (${job}).`, pushTail: "A delivery has been added to your run.", priority: "normal", key: `moved-in:${job}` }));
    }
  }
  return notices;
}
