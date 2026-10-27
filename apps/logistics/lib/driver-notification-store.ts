import { db } from "./firebase";
import { deliverPushes, type PushDeps } from "./driver-push";
import {
  MAX_PROCESSING_ATTEMPTS, processPendingDriverChanges,
  type DriverChangeEvent, type DriverNotificationStore, type InboxNotification,
} from "./driver-change-events";

export const driverChangeEvents = () => db.collection("fikaLogisticsDriverChangeEventsV1");
export const driverNotifications = () => db.collection("fikaLogisticsDriverNotificationsV1");
export const driverCaptureGaps = () => db.collection("fikaLogisticsDriverCaptureGapsV1");

/** Notices are kept for 30 days. `expiresAt` is a Date so a Firestore TTL policy on the field can also reclaim storage. */
export const NOTIFICATION_RETENTION_DAYS = 30;
const MARK_ALL_LIMIT = 200;
/** Firestore returns stored dates as Timestamp objects; tests and legacy rows may carry Date or ISO strings. */
export function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "string") { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? undefined : parsed; }
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") return (value as { toDate: () => Date }).toDate();
  return undefined;
}

function toInbox(data: Record<string, unknown>): InboxNotification {
  const { readAt, expiresAt: _expiresAt, ...rest } = data;
  return { ...(rest as unknown as InboxNotification), ...(readAt ? { readAt: String(readAt) } : {}) };
}

export const firestoreDriverNotificationStore: DriverNotificationStore = {
  async listPendingEvents(limit) {
    const snapshot = await driverChangeEvents().where("status", "==", "pending").orderBy("committedAt", "asc").limit(limit).get();
    return snapshot.docs
      .map(doc => doc.data() as DriverChangeEvent)
      .filter(event => (event.attempts ?? 0) < MAX_PROCESSING_ATTEMPTS)
      .sort((a, b) => a.committedAt.localeCompare(b.committedAt));
  },

  async commitProcessedEvent(eventId, notices, status, processedAt) {
    return db.runTransaction(async transaction => {
      const eventRef = driverChangeEvents().doc(eventId);
      const noticeRefs = notices.map(notice => driverNotifications().doc(notice.id));
      // All reads first. A concurrent worker that already processed the event makes this a no-op, so workers are safe to overlap.
      const event = await transaction.get(eventRef);
      if (!event.exists || (event.data() as DriverChangeEvent).status !== "pending") return false;
      const existing = await Promise.all(noticeRefs.map(ref => transaction.get(ref)));
      notices.forEach((notice, index) => {
        if (existing[index].exists) return;
        // pushStatus 'pending' marks the notice as waiting for its Web Push (sent after the commit, never inside this transaction).
        transaction.create(noticeRefs[index], { ...notice, readAt: null, pushStatus: "pending", expiresAt: new Date(new Date(notice.createdAt).getTime() + NOTIFICATION_RETENTION_DAYS * 86_400_000) });
      });
      transaction.set(eventRef, { status, processedAt }, { merge: true });
      return true;
    });
  },

  async recordFailure(eventId, message) {
    await db.runTransaction(async transaction => {
      const ref = driverChangeEvents().doc(eventId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const event = snapshot.data() as DriverChangeEvent;
      if (event.status !== "pending") return; // a processed event is never touched by a failed retry
      const attempts = (event.attempts ?? 0) + 1;
      transaction.set(ref, { attempts, lastError: message.slice(0, 300), status: attempts >= MAX_PROCESSING_ATTEMPTS ? "failed" : "pending" }, { merge: true });
    });
  },

  async listNotifications(vehicleId, limit) {
    const snapshot = await driverNotifications().where("vehicleId", "==", vehicleId).orderBy("createdAt", "desc").limit(limit).get();
    const now = Date.now();
    return snapshot.docs
      .map(doc => doc.data() as Record<string, unknown>)
      .filter(data => data.vehicleId === vehicleId)
      .filter(data => { const expiry = asDate(data.expiresAt); return !expiry || expiry.getTime() > now; })
      .map(toInbox)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async countUnread(vehicleId, now, cap) {
    // One aggregate read, never a document fetch. Expired-but-unreclaimed rows are excluded exactly as the list excludes them.
    const aggregate = await driverNotifications().where("vehicleId", "==", vehicleId).where("readAt", "==", null).where("expiresAt", ">", now).limit(cap).count().get();
    return Math.min(aggregate.data().count, cap);
  },

  async markRead(vehicleId, id, readAt) {
    return db.runTransaction(async transaction => {
      const ref = driverNotifications().doc(id);
      const snapshot = await transaction.get(ref);
      // Another vehicle's notice is indistinguishable from a missing one.
      if (!snapshot.exists || (snapshot.data() as { vehicleId?: string }).vehicleId !== vehicleId) return false;
      if (!(snapshot.data() as { readAt?: unknown }).readAt) transaction.set(ref, { readAt }, { merge: true });
      return true;
    });
  },

  async markAllRead(vehicleId, readAt) {
    const snapshot = await driverNotifications().where("vehicleId", "==", vehicleId).where("readAt", "==", null).limit(MARK_ALL_LIMIT).get();
    const docs = snapshot.docs.filter(doc => (doc.data() as { vehicleId?: string }).vehicleId === vehicleId);
    if (!docs.length) return 0;
    const batch = db.batch();
    for (const doc of docs) batch.set(doc.ref, { readAt }, { merge: true });
    await batch.commit();
    return docs.length;
  },
};

/** Process pending events into inbox notices. Safe to call concurrently and repeatedly. */
export async function processDriverNotifications(now = new Date(), limit = 25, options: { push?: "inline" | "after" | "off"; deps?: PushDeps } = {}) {
  const committed: string[] = [];
  const result = await processPendingDriverChanges(firestoreDriverNotificationStore, now, limit, notices => committed.push(...notices.map(notice => notice.id)));
  // Web Push goes out only AFTER the inbox transaction has committed, never inside it, and never blocks the inbox: deliverPushes cannot
  // throw. After a planner save it runs after the response is sent, so a slow push service cannot slow the planner.
  const mode = options.push ?? "inline";
  if (mode !== "off" && committed.length) {
    const deliver = () => deliverPushes(committed, options.deps);
    if (mode === "after") await runAfterResponse(deliver); else await deliver();
  }
  return result;
}

/** Run background work once the HTTP response has been sent. Outside a request (tests, scripts) it runs inline so nothing is lost. */
async function runAfterResponse(work: () => Promise<unknown>) {
  try { const { after } = await import("next/server"); after(() => work().catch(() => undefined)); }
  catch { await work().catch(() => undefined); }
}

/**
 * Best-effort processing after a planner save. A failure here is logged and left for retry; it can never fail or undo the
 * planner operation that already committed.
 */
export async function processDriverNotificationsSafely(now = new Date()) {
  try {
    return await processDriverNotifications(now, 25, { push: "after" });
  } catch (error) {
    console.error("[driver-notifications] processing deferred for retry", error instanceof Error ? error.message : "unknown error");
    return undefined;
  }
}

export type CaptureGap = { action: string; actorId: string; at: string; serviceDate: string; error: string; entities: string[] };

/**
 * A planner write committed but no change event could be staged, so drivers may not have been told. This cannot be replayed (the
 * before-state is gone), so it is made visible instead: a stable error log line for alerting plus an open gap record that the
 * processor route reports. Best-effort: if even this write fails, the log line is still emitted.
 */
export async function recordCaptureGap(gap: CaptureGap) {
  console.error("[driver-notifications] CAPTURE GAP: a committed change may not have notified drivers", JSON.stringify({ action: gap.action, serviceDate: gap.serviceDate, error: gap.error.slice(0, 200), entities: gap.entities.length }));
  try { await driverCaptureGaps().add({ ...gap, error: gap.error.slice(0, 300), status: "open" }); }
  catch (error) { console.error("[driver-notifications] CAPTURE GAP record failed", error instanceof Error ? error.message : "unknown error"); }
}

/** Bounded count of open capture gaps, for the recovery route's health output. */
export async function countOpenCaptureGaps(cap = 100): Promise<number> {
  const aggregate = await driverCaptureGaps().where("status", "==", "open").limit(cap).count().get();
  return Math.min(aggregate.data().count, cap);
}
