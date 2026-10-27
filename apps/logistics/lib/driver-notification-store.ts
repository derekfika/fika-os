import { db } from "./firebase";
import type { DeliveryRun } from "./types";
import { londonServiceDate, type DriverRunSnapshot, type DriverVisit } from "./driver-notifications";
import {
  MAX_PROCESSING_ATTEMPTS, driverChangeEventId, processPendingDriverChanges, stageDriverChangeEvent,
  type ChangeMutation, type DriverChangeEvent, type DriverNotificationStore, type InboxNotification,
} from "./driver-change-events";

export const driverChangeEvents = () => db.collection("fikaLogisticsDriverChangeEventsV1");
export const driverNotifications = () => db.collection("fikaLogisticsDriverNotificationsV1");

/** Notices are kept for 30 days. `expiresAt` is a Date so a Firestore TTL policy on the field can also reclaim storage. */
export const NOTIFICATION_RETENTION_DAYS = 30;
const MARK_ALL_LIMIT = 200;
const asDate = (value: unknown) => (value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined);

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

const vehicleLabelFor = (run: Pick<DeliveryRun, "vehicleId" | "vehicleLabel">) => run.vehicleLabel || (run.vehicleId === "van2" ? "Van 2" : "Van 1");

/** Driver-visible snapshot of a run, or undefined when the run is not a vehicle run the driver app can show. */
export function driverRunSnapshotFromRun(run: DeliveryRun, visits: DriverVisit[] = []): DriverRunSnapshot | undefined {
  if (run.vehicleId !== "van1" && run.vehicleId !== "van2") return undefined;
  return {
    runId: run.canonicalId,
    version: run.version,
    vehicleId: run.vehicleId,
    vehicleLabel: vehicleLabelFor(run),
    serviceDate: run.serviceDate,
    status: run.retiredAt ? "cancelled" : run.status,
    departure: run.plannedCpuDepartureTime,
    return: run.plannedCpuReturnTime,
    visits,
    stopOrder: run.orderedStopIds,
  };
}

type Transaction = Parameters<Parameters<typeof db.runTransaction>[0]>[0];

/**
 * Stage the immutable change event inside the planner transaction that is committing `after`. Must be called after the
 * transaction's reads and before its first write. Only today's driver-relevant runs are recorded; everything else is skipped
 * so storage stays bounded and future-dated edits can never notify later.
 */
export async function stageDriverRunChange(transaction: Transaction, input: { action: string; actorId: string; now: string; before: DeliveryRun; after: DeliveryRun; beforeVisits?: DriverVisit[]; afterVisits?: DriverVisit[]; mutations?: ChangeMutation[] }) {
  if (input.after.serviceDate !== londonServiceDate(new Date(input.now))) return "skipped" as const;
  const before = driverRunSnapshotFromRun(input.before, input.beforeVisits);
  const after = driverRunSnapshotFromRun(input.after, input.afterVisits);
  if (!before || !after) return "skipped" as const;
  const mutations = [{ entityType: "run" as const, entityId: input.after.canonicalId, beforeVersion: input.before.version, afterVersion: input.after.version }, ...(input.mutations ?? [])];
  const eventId = driverChangeEventId(input.action, [{ runId: after.runId, beforeVersion: before.version, afterVersion: after.version }], mutations);
  const result = await stageDriverChangeEvent(transaction as never, driverChangeEvents().doc(eventId), { eventId, serviceDate: after.serviceDate, sourceAction: input.action, actorId: input.actorId, committedAt: input.now, before: [before], after: [after], mutations });
  return result;
}
