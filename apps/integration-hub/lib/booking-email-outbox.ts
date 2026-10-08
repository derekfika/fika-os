import crypto from "node:crypto";
import { claimEvent, eventIsDue, markEventDeadLetter, markEventDelivered, markEventFailed, outboxRecord, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import type { BookingNotificationRecord } from "./booking-notifications";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { bookingGmailToken, GmailSendFailure, gmailRawMessage, notificationIsCurrent, resolveBookingSender, sendBookingGmail } from "./booking-email-delivery";

export function notificationEvent(message: BookingNotificationRecord): DurableDomainEvent<BookingNotificationRecord> {
  return { eventId: message.notificationId, eventType: `hospitality.email.${message.kind}`, sourceAggregateId: message.bookingId, sourceVersion: message.bookingVersion || 0, occurredAt: message.createdAt, schemaVersion: "fika.booking-email.v2", payload: message, delivery: message.delivery || { status: message.status === "sent" ? "delivered" : "pending", attempts: message.attempts } };
}
export function notificationWithEvent(message: BookingNotificationRecord, event: DurableDomainEvent<BookingNotificationRecord>): BookingNotificationRecord {
  const row = outboxRecord(event);
  const { nextEligibleAt: _old, ...history } = message;
  const retryable = event.delivery.status === "pending" || event.delivery.status === "failed";
  return { ...history, delivery: event.delivery, outboxStatus: event.delivery.status, ...(retryable ? { nextEligibleAt: event.delivery.nextEligibleAt || event.delivery.leaseExpiresAt || event.delivery.nextAttemptAt || row.nextEligibleAt || event.occurredAt } : {}), attempts: event.delivery.attempts, status: event.delivery.status === "delivered" ? "sent" : event.delivery.status === "pending" ? "queued" : "failed" };
}
export type EmailOutboxStore = {
  candidates(limit: number, at: string): Promise<string[]>;
  claim(id: string, claimId: string, at: string): Promise<BookingNotificationRecord | undefined>;
  arm(id: string, claimId: string, at: string, evidence?: { from: string; replyTo: string; displayName: string; authenticatedAccount: string; messageHash: string }): Promise<boolean>;
  finish(id: string, claimId: string, event: DurableDomainEvent<BookingNotificationRecord>, receipt?: string): Promise<void>;
};

/** The send barrier is durable before network I/O. Expired armed claims never auto-send again. */
export async function runBookingEmailWorker(store: EmailOutboxStore, limit = 25, deps = { sender: resolveBookingSender, token: bookingGmailToken, send: sendBookingGmail }) {
  const at = new Date().toISOString();
  const ids = await store.candidates(Math.max(1, Math.min(25, Math.floor(limit) || 25)), at);
  let attempted = 0;
  for (const id of ids) {
    const claimId = crypto.randomUUID();
    const message = await store.claim(id, claimId, new Date().toISOString());
    if (!message) continue;
    attempted++;
    const event = notificationEvent(message);
    if (message.sendingStartedAt) {
      await store.finish(id, claimId, markEventDeadLetter(event, "Expired send barrier: acceptance uncertain; operator review required.", at));
      continue;
    }
    let raw: string, token: string, evidence: { from: string; replyTo: string; displayName: string; authenticatedAccount: string; messageHash: string };
    try { const sender = deps.sender(message.oplocId, message.kind); raw = gmailRawMessage(message, sender); token = await deps.token(sender); evidence = { from: sender.from, replyTo: sender.replyTo, displayName: sender.displayName, authenticatedAccount: sender.authenticatedAccount, messageHash: crypto.createHash("sha256").update(raw).digest("hex") }; }
    catch { await store.finish(id, claimId, markEventFailed(event, "Sender configuration or Gmail authentication unavailable before send.", new Date().toISOString())); continue; }
    if (!await store.arm(id, claimId, new Date().toISOString(), evidence)) continue;
    try {
      const receipt = await deps.send(raw, token);
      await store.finish(id, claimId, markEventDelivered(event, new Date().toISOString()), receipt);
    } catch (error) {
      const failure = error instanceof GmailSendFailure && error.definitelyRejected && error.retryable
        ? markEventFailed(event, error, new Date().toISOString())
        : markEventDeadLetter(event, error instanceof GmailSendFailure ? error.message : "Send receipt persistence uncertain; operator review required.", new Date().toISOString());
      await store.finish(id, claimId, failure);
    }
  }
  return { candidates: ids.length, attempted };
}

// Export the canonical claim decision for store adapters and isolated behavioral tests.
export function claimBookingEmail(message: BookingNotificationRecord, booking: CanonicalBooking, claimId: string, at: string) {
  const event = notificationEvent(message);
  if (!message.delivery || !eventIsDue(event, new Date(at))) return undefined; // historical v1 records are never bulk-reissued
  const claimed = claimEvent(event, claimId, at);
  if (!notificationIsCurrent(message, booking)) return notificationWithEvent(message, markEventDeadLetter(claimed, "Superseded Booking transition; no email sent.", at));
  return notificationWithEvent(message, claimed);
}
