import { db } from "./firebase-admin";
import { eventIsDue, markEventDeadLetter, resetEventForReplay, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import crypto from "node:crypto";
import { notificationIsCurrent } from "./booking-email-delivery";
import { claimBookingEmail, notificationEvent, notificationWithEvent, type EmailOutboxStore } from "./booking-email-outbox";
import type { BookingNotificationRecord } from "./booking-notifications";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { assertStagingEmailCandidate } from "./booking-email-uat-safety";
const notifications = () => db.collection("fikaBookingNotifications");
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Deliberate operator recovery only after verifying the previous attempt was NOT sent. */
export async function replayBookingEmail(id: string, reason: string, providerEvidence: string) {
  const at = new Date().toISOString();
  return db.runTransaction(async transaction => {
    const ref = notifications().doc(id);
    const row = await transaction.get(ref);
    if (!row.exists) throw new Error("Notification not found.");
    const message = row.data() as BookingNotificationRecord;
    const source = await transaction.get(db.collection("fikaBookings").doc(message.bookingId));
    if (message.delivery?.status !== "dead-letter" || message.gmailMessageId || !source.exists || !notificationIsCurrent(message, source.data() as CanonicalBooking)) throw new Error("Only an unsent current dead letter can be replayed.");
    const next = notificationWithEvent(message, resetEventForReplay(notificationEvent(message), at, reason));
    delete next.sendingStartedAt;
    transaction.create(ref.collection("recovery").doc(crypto.randomUUID()), clean({ at, reason, providerEvidence, priorDelivery: message.delivery, priorSendingStartedAt: message.sendingStartedAt }));
    transaction.set(ref, clean(next));
    return { notificationId: id, status: "pending" };
  });
}

export const bookingEmailStore: EmailOutboxStore = {
  async candidates(limit, at) {
    const rows = await notifications().where("outboxStatus", "in", ["pending", "failed"]).where("nextEligibleAt", "<=", at).orderBy("nextEligibleAt").limit(limit).get();
    // Inspect the complete bounded batch before any claim or business mutation.
    for (const row of rows.docs) assertStagingEmailCandidate(row.data() as BookingNotificationRecord);
    return rows.docs.map(row => row.id);
  },
  async claim(id, claimId, at) {
    return db.runTransaction(async transaction => {
      const ref = notifications().doc(id);
      const row = await transaction.get(ref);
      if (!row.exists) return undefined;
      const message = row.data() as BookingNotificationRecord;
      assertStagingEmailCandidate(message);
      if (!message.delivery || !eventIsDue(notificationEvent(message), new Date(at))) return undefined;
      const source = await transaction.get(db.collection("fikaBookings").doc(message.bookingId));
      const next = source.exists ? claimBookingEmail(message, source.data() as CanonicalBooking, claimId, at) : notificationWithEvent(message, markEventDeadLetter(notificationEvent(message), "Booking source missing; no email sent.", at));
      if (!next) return undefined;
      transaction.set(ref, clean(next));
      if (next.delivery?.status === "dead-letter") return undefined;
      transaction.create(ref.collection("attempts").doc(claimId), { claimId, at, bookingVersion: message.bookingVersion, outcome: "claimed" });
      return next;
    });
  },
  async arm(id, claimId, at, evidence) {
    return db.runTransaction(async transaction => {
      const ref = notifications().doc(id);
      const row = await transaction.get(ref);
      if (!row.exists) return false;
      const message = row.data() as BookingNotificationRecord;
      assertStagingEmailCandidate(message);
      if (message.delivery?.claimId !== claimId || message.sendingStartedAt || !message.delivery.leaseExpiresAt || message.delivery.leaseExpiresAt <= at) return false;
      const source = await transaction.get(db.collection("fikaBookings").doc(message.bookingId));
      if (!source.exists || !notificationIsCurrent(message, source.data() as CanonicalBooking)) {
        transaction.set(ref, clean(notificationWithEvent(message, markEventDeadLetter(notificationEvent(message), "Booking superseded before send.", at))));
        return false;
      }
      transaction.update(ref, { sendingStartedAt: at, ...(evidence ? { senderEvidence: evidence } : {}) });
      transaction.update(ref.collection("attempts").doc(claimId), { sendBarrierAt: at, ...(evidence ? { senderEvidence: evidence } : {}) });
      return true;
    });
  },
  async finish(id, claimId, event: DurableDomainEvent<BookingNotificationRecord>, receipt) {
    await db.runTransaction(async transaction => {
      const ref = notifications().doc(id);
      const row = await transaction.get(ref);
      if (!row.exists) return;
      const message = row.data() as BookingNotificationRecord;
      if (message.delivery?.claimId !== claimId) return;
      const next = notificationWithEvent(message, event);
      // A definitive rejection or pre-send failure is safe to retry. Unknown acceptance keeps the barrier.
      if (event.delivery.status === "failed") delete next.sendingStartedAt;
      if (receipt) { next.gmailMessageId = receipt; next.sentAt = event.delivery.deliveredAt; }
      transaction.set(ref, clean(next));
      transaction.set(ref.collection("attempts").doc(claimId), clean({ outcome: event.delivery.status, completedAt: event.delivery.lastAttemptAt, ...(receipt ? { gmailMessageId: receipt } : {}), ...(event.delivery.lastError ? { error: event.delivery.lastError } : {}) }), { merge: true });
    });
  },
};
