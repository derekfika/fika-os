import { createHash } from "node:crypto";
import { diffBatch, isEligibleNow, londonServiceDate, type DriverNotification, type DriverRunSnapshot } from "./driver-notifications";

/**
 * Durable, immutable record of one committed planner change. It is written inside the same Firestore transaction as the
 * planner write, so the change and its notification history commit together or not at all. Notifications are later derived
 * from the event's own before/after snapshots, so a later edit never hides an intermediate change.
 */
/** One authoritative entity version change inside the committed mutation (run, load, stop or job). */
export type ChangeMutation = { entityType: "run" | "load" | "stop" | "job" | "movement"; entityId: string; beforeVersion: number; afterVersion: number };

export type DriverChangeEvent = {
  /** Deterministic identity of the committed change (see `driverChangeEventId`). */
  eventId: string;
  serviceDate: string;
  sourceAction: string;
  actorId: string;
  committedAt: string;
  before: DriverRunSnapshot[];
  after: DriverRunSnapshot[];
  /** Every entity version this mutation advanced. Part of the event identity. */
  mutations: ChangeMutation[];
  status: "pending" | "processed" | "expired" | "failed";
  /** Bounded processing attempts; an event that keeps failing is parked as failed rather than retried forever. */
  attempts?: number;
  lastError?: string;
  processedAt?: string;
};

/**
 * Identity of one committed mutation: the action plus every entity version it advanced. Optimistic concurrency makes each
 * (entity, beforeVersion) unique per commit, so two stop or load edits that leave the parent run version unchanged still differ
 * by the stop or load version they advanced.
 */
export function driverChangeEventId(sourceAction: string, runs: Array<{ runId: string; beforeVersion: number; afterVersion: number }>, mutations: ChangeMutation[] = []) {
  const parts = [
    ...runs.map(run => `run:${run.runId}@${run.beforeVersion}>${run.afterVersion}`),
    ...mutations.map(item => `${item.entityType}:${item.entityId}@${item.beforeVersion}>${item.afterVersion}`),
  ];
  const identity = `${sourceAction}|${[...new Set(parts)].sort().join("|")}`;
  return createHash("sha256").update(identity).digest("hex");
}

/**
 * Stable document id for one notice: the committed event plus the notice subject. Including the event keeps two independent
 * committed changes distinct even when they leave the parent run version unchanged, while processing the same event twice
 * writes the same documents.
 */
export const driverNotificationDocId = (eventId: string, dedupeKey: string) => createHash("sha256").update(`${eventId}|${dedupeKey}`).digest("hex");

type StageTransaction = { get(ref: unknown): Promise<{ exists: boolean }>; create(ref: unknown, value: unknown): unknown };

/**
 * Stage the committed change inside the caller's planner transaction. The event is created only if absent: a retry or replay can
 * never overwrite an existing event, reset a processed event to pending, or alter its captured before/after state. The read must
 * happen before the planner transaction's first write, as Firestore requires.
 */
export async function stageDriverChangeEvent(transaction: StageTransaction, ref: unknown, event: Omit<DriverChangeEvent, "status" | "processedAt" | "attempts">): Promise<"staged" | "exists"> {
  const existing = await transaction.get(ref);
  if (existing.exists) return "exists";
  transaction.create(ref, { ...event, status: "pending", attempts: 0 });
  return "staged";
}

/** Documented display cap: the app shows "99+" above 99 unread notices; the count is exact up to this cap. */
export const UNREAD_COUNT_CAP = 100;
export const MAX_PROCESSING_ATTEMPTS = 8;

export type DriverNotificationStore = {
  /** Pending events, oldest first. Bounded by the caller. */
  listPendingEvents(limit: number): Promise<DriverChangeEvent[]>;
  /**
   * Atomically: create each notice that does not already exist, and mark the event processed. Any failure leaves the event
   * pending, so the next processing run retries it without duplicating notices.
   */
  commitProcessedEvent(eventId: string, notices: InboxNotification[], status: "processed" | "expired", processedAt: string): Promise<void>;
  /** Records a failed attempt. After MAX_PROCESSING_ATTEMPTS the event is parked as failed and no longer retried. */
  recordFailure(eventId: string, message: string): Promise<void>;
  /** Vehicle-scoped listing, newest first, bounded. */
  listNotifications(vehicleId: "van1" | "van2", limit: number): Promise<InboxNotification[]>;
  /** Unread, unexpired notices for the vehicle, counted server-side and capped (one aggregate read), independent of the list page size. */
  countUnread(vehicleId: "van1" | "van2", now: Date, cap: number): Promise<number>;
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
    const notices = diffBatch(event.serviceDate, event.before, event.after).map(notice => ({ ...notice, id: driverNotificationDocId(event.eventId, notice.dedupeKey), createdAt: processedAt, eventId: event.eventId }));
    try {
      await store.commitProcessedEvent(event.eventId, notices, "processed", processedAt);
    } catch (error) {
      await store.recordFailure(event.eventId, error instanceof Error ? error.message : "processing failed").catch(() => undefined);
      throw error;
    }
    created += notices.length;
  }
  return { processed: events.length, created, expired };
}

/** Inbox read model. Only ever returns the authenticated vehicle's own notices. */
export async function inboxFor(store: DriverNotificationStore, vehicleId: "van1" | "van2", limit = 50, now = new Date()) {
  const [items, unreadCount] = await Promise.all([store.listNotifications(vehicleId, limit), store.countUnread(vehicleId, now, UNREAD_COUNT_CAP)]);
  return { vehicleId, unreadCount, items: items.filter(item => item.vehicleId === vehicleId) };
}

/** Mark one notice read. A notice belonging to another vehicle is treated as not found, never as a successful write. */
export async function markNotificationRead(store: DriverNotificationStore, vehicleId: "van1" | "van2", id: string, now: Date) {
  return store.markRead(vehicleId, id, now.toISOString());
}

export async function markAllNotificationsRead(store: DriverNotificationStore, vehicleId: "van1" | "van2", now: Date) {
  return store.markAllRead(vehicleId, now.toISOString());
}
