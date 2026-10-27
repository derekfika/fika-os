import { createHash } from "node:crypto";
import { diffBatch, isEligibleNow, londonServiceDate, type DriverNotification, type DriverRunSnapshot, type DriverVisit } from "./driver-notifications";

/**
 * Durable, immutable record of one committed planner change. It is written inside the same Firestore transaction as the
 * planner write, so the change and its notification history commit together or not at all. Notifications are later derived
 * from the event's own before/after snapshots, so a later edit never hides an intermediate change.
 */
export type DriverChangeEvent = {
  /** Deterministic identity of the committed change (see `driverChangeEventId`). */
  eventId: string;
  serviceDate: string;
  sourceAction: string;
  actorId: string;
  committedAt: string;
  before: DriverRunSnapshot[];
  after: DriverRunSnapshot[];
  status: "pending" | "processed" | "expired";
  processedAt?: string;
};

/** Parent run versions are unique per commit (optimistic concurrency), so each committed change has a unique identity. */
export function driverChangeEventId(sourceAction: string, runs: Array<{ runId: string; beforeVersion: number; afterVersion: number }>) {
  const identity = `${sourceAction}|${runs.map(run => `${run.runId}@${run.beforeVersion}>${run.afterVersion}`).sort().join("|")}`;
  return createHash("sha256").update(identity).digest("hex");
}

/** Stable document id for one notice, so writing the same notice twice cannot create two inbox rows. */
export const driverNotificationDocId = (dedupeKey: string) => createHash("sha256").update(dedupeKey).digest("hex");

type Leg = { lane: "delivery" | "collection"; load: { id: string; destinationLabelSnapshot?: string; scheduledTime?: string; collectionScheduledTime?: string; notes?: string }; jobs: Array<{ id: string; contents?: Array<{ description?: string; quantity?: number; unit?: string }> }> };

/** Driver-visible visits for a run, built from the authoritative legs already read inside the transaction. */
export function driverVisitsFromLegs(legs: Leg[]): DriverVisit[] {
  return legs.map(leg => {
    const collection = leg.lane === "collection";
    const contents = leg.jobs.flatMap(job => job.contents ?? []);
    return {
      visitId: `${leg.load.id}:${leg.lane}`,
      lane: leg.lane,
      destination: leg.load.destinationLabelSnapshot || "Destination",
      time: collection ? leg.load.collectionScheduledTime : leg.load.scheduledTime,
      jobIds: leg.jobs.map(job => job.id).sort(),
      quantities: contents.map(item => `${item.quantity ?? 0} ${item.unit ?? ""}`.trim()).sort().join(" · "),
      instructions: leg.load.notes ?? "",
    };
  }).sort((a, b) => a.visitId.localeCompare(b.visitId));
}

/** Stage the committed change inside the caller's planner transaction. Replaying the same change rewrites identical content. */
export function stageDriverChangeEvent(transaction: { set(ref: unknown, value: unknown): unknown }, ref: unknown, event: Omit<DriverChangeEvent, "status" | "processedAt">) {
  transaction.set(ref, { ...event, status: "pending" });
}

export type DriverNotificationStore = {
  /** Pending events, oldest first. Bounded by the caller. */
  listPendingEvents(limit: number): Promise<DriverChangeEvent[]>;
  /**
   * Atomically: create each notice that does not already exist, and mark the event processed. Any failure leaves the event
   * pending, so the next processing run retries it without duplicating notices.
   */
  commitProcessedEvent(eventId: string, notices: Array<DriverNotification & { id: string; createdAt: string }>, status: "processed" | "expired", processedAt: string): Promise<void>;
  /** Vehicle-scoped listing, newest first, bounded. */
  listNotifications(vehicleId: "van1" | "van2", limit: number): Promise<InboxNotification[]>;
  markRead(vehicleId: "van1" | "van2", id: string, readAt: string): Promise<boolean>;
  markAllRead(vehicleId: "van1" | "van2", readAt: string): Promise<number>;
};

export type InboxNotification = DriverNotification & { id: string; createdAt: string; readAt?: string; eventId: string };

/**
 * Process pending committed changes into inbox notices. An event is interpreted from its own captured before/after state, so
 * processing can be delayed, crash and resume, or run after later edits without losing or inventing changes.
 * Events for a previous service date are marked expired and produce no notices (no retrospective flood).
 */
export async function processPendingDriverChanges(store: DriverNotificationStore, now: Date, limit = 50): Promise<{ processed: number; created: number; expired: number }> {
  const today = londonServiceDate(now);
  const processedAt = now.toISOString();
  let created = 0;
  let expired = 0;
  const events = await store.listPendingEvents(limit);
  for (const event of events) {
    if (event.serviceDate !== today || !isEligibleNow({ serviceDate: event.serviceDate }, now)) {
      await store.commitProcessedEvent(event.eventId, [], "expired", processedAt);
      expired += 1;
      continue;
    }
    const notices = diffBatch(event.serviceDate, event.before, event.after).map(notice => ({ ...notice, id: driverNotificationDocId(notice.dedupeKey), createdAt: processedAt, eventId: event.eventId }));
    await store.commitProcessedEvent(event.eventId, notices, "processed", processedAt);
    created += notices.length;
  }
  return { processed: events.length, created, expired };
}

/** Inbox read model. Only ever returns the authenticated vehicle's own notices. */
export async function inboxFor(store: DriverNotificationStore, vehicleId: "van1" | "van2", limit = 50) {
  const items = await store.listNotifications(vehicleId, limit);
  return { vehicleId, unreadCount: items.filter(item => !item.readAt).length, items: items.filter(item => item.vehicleId === vehicleId) };
}

/** Mark one notice read. A notice belonging to another vehicle is treated as not found, never as a successful write. */
export async function markNotificationRead(store: DriverNotificationStore, vehicleId: "van1" | "van2", id: string, now: Date) {
  return store.markRead(vehicleId, id, now.toISOString());
}

export async function markAllNotificationsRead(store: DriverNotificationStore, vehicleId: "van1" | "van2", now: Date) {
  return store.markAllRead(vehicleId, now.toISOString());
}
