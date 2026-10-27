import { db } from "./firebase";
import {
  MAX_PROCESSING_ATTEMPTS, processPendingDriverChanges,
  type DriverChangeEvent, type DriverNotificationStore, type InboxNotification,
} from "./driver-change-events";

export const driverChangeEvents = () => db.collection("fikaLogisticsDriverChangeEventsV1");
export const driverNotifications = () => db.collection("fikaLogisticsDriverNotificationsV1");

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
    await db.runTransaction(async transaction => {
      const eventRef = driverChangeEvents().doc(eventId);
      const noticeRefs = notices.map(notice => driverNotifications().doc(notice.id));
      // All reads first. A concurrent worker that already processed the event makes this a no-op, so workers are safe to overlap.
      const event = await transaction.get(eventRef);
      if (!event.exists || (event.data() as DriverChangeEvent).status !== "pending") return;
      const existing = await Promise.all(noticeRefs.map(ref => transaction.get(ref)));
      notices.forEach((notice, index) => {
        if (existing[index].exists) return;
        transaction.create(noticeRefs[index], { ...notice, readAt: null, expiresAt: new Date(new Date(notice.createdAt).getTime() + NOTIFICATION_RETENTION_DAYS * 86_400_000) });
      });
      transaction.set(eventRef, { status, processedAt }, { merge: true });
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
export function processDriverNotifications(now = new Date(), limit = 25) {
  return processPendingDriverChanges(firestoreDriverNotificationStore, now, limit);
}

/**
 * Best-effort processing after a planner save. A failure here is logged and left for retry; it can never fail or undo the
 * planner operation that already committed.
 */
export async function processDriverNotificationsSafely(now = new Date()) {
  try {
    return await processDriverNotifications(now);
  } catch (error) {
    console.error("[driver-notifications] processing deferred for retry", error instanceof Error ? error.message : "unknown error");
    return undefined;
  }
}
