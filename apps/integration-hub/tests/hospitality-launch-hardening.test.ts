import assert from "node:assert/strict";
import test from "node:test";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import { hospitalityCatalogues } from "@fika/server-shared/hospitality-catalogue";
import { bookingNotificationRecord } from "../lib/booking-notifications";
import { claimBookingEmail, notificationEvent, notificationWithEvent, runBookingEmailWorker, type EmailOutboxStore } from "../lib/booking-email-outbox";
import { GmailSendFailure, gmailRawMessage, notificationIsCurrent, resolveBookingSender, sendBookingGmail, type BookingSender } from "../lib/booking-email-delivery";
import { markEventDelivered, markEventFailed } from "@fika/server-shared/durable-outbox";
import type { CanonicalBooking, MnkBookingPayload } from "../lib/hospitality-booking-service";

const item = hospitalityCatalogues.cfc.items.find(item => item.lifecycleState === "active")!;
const payload = { order: { items: [{ itemId: item.source.sourceItemId, quantity: 3, unitPrice: .01, lineTotal: .01 }], netTotal: .01 } } as MnkBookingPayload;
const booking = { canonicalId: "booking:test", version: 4, commercialVersion: 2, lifecycleStatus: "Sent to CPU", updatedAt: "2026-10-08T10:00:00Z", updatedBy: "multi-site-manager", source: { sourceBookingId: "TEST-001" }, service: { oplocId: "oploc:mnk", portalSiteId: "mnk", portalSiteLabel: "MNK", eventDate: "2026-10-19", startTime: "12:00", guestCount: 3 }, client: { name: "Host", email: "host@example.test", companyName: "Test" }, order: { items: [{ itemId: "test", itemName: "Current lunch", quantity: 3, unitPrice: 12, lineTotal: 36 }], netTotal: 36, vatTotal: 0, grossTotal: 36 } } as CanonicalBooking;
const sender: BookingSender = { from: "mnk@example.test", replyTo: "mnk@example.test", displayName: "MNK Catering", authenticatedAccount: "delivery@example.test", verifiedSendAs: true, enabled: ["submitted", "confirmed", "amended", "cancelled"] };

test("public price, line and overall tampering cannot alter canonical totals; quantity is authoritative input", () => {
  const actual = trustedPublicOrder(payload, [], "cfc");
  assert.equal(actual.items[0].unitPrice, item.pricing.unitPrice);
  assert.equal(actual.items[0].lineTotal, Math.round(item.pricing.unitPrice * 3 * 100) / 100);
  assert.equal(actual.netTotal, actual.items[0].lineTotal);
  const normal = { ...payload, order: { ...actual } };
  assert.deepEqual(trustedPublicOrder(normal, [], "cfc"), actual);
  assert.equal(trustedPublicOrder({ ...payload, order: { ...payload.order, items: [{ ...payload.order.items[0], quantity: 6 }] } }, [], "cfc").netTotal, actual.netTotal * 2);
});
test("unknown, archived, missing-price and non-finite quantity cannot be priced", () => {
  assert.throws(() => trustedPublicOrder({ ...payload, order: { ...payload.order, items: [{ ...payload.order.items[0], itemId: "unknown" }] } }, [], "cfc"));
  const record = { canonicalId: item.source.sourceItemId, entityType: "Hospitality Menu Item", lifecycleStatus: "archived", record: { lifecycleState: "archived", unitPrice: 99, providerMappings: [{ provider: "cfc-hospitality-brochure", sourceItemId: item.source.sourceItemId }] } } as never;
  assert.throws(() => trustedPublicOrder(payload, [record], "cfc"));
  assert.throws(() => trustedPublicOrder({ ...payload, order: { ...payload.order, items: [{ ...payload.order.items[0], quantity: Infinity }] } }, [], "cfc"));
});
test("canonical mapped price overrides compatibility catalogue without changing VAT rules", () => {
  const record = { canonicalId: "menu:1", entityType: "Hospitality Menu Item", lifecycleStatus: "published", record: { lifecycleState: "active", unitPrice: 14, name: "Canonical", providerMappings: [{ provider: "cfc-hospitality-brochure", sourceItemId: item.source.sourceItemId }] } } as never;
  assert.equal(trustedPublicOrder(payload, [record], "cfc").netTotal, 42);
});
test("four lifecycle revisions own distinct immutable obligations and exact replay identity", () => {
  const original = bookingNotificationRecord(booking, "submitted", 1, "2026-10-08T10:00:00Z");
  const bytes = JSON.stringify(original);
  const confirmed = bookingNotificationRecord(booking, "confirmed", 4, booking.updatedAt);
  const amended = bookingNotificationRecord({ ...booking, version: 5 }, "amended", 5, booking.updatedAt);
  const cancelled = bookingNotificationRecord({ ...booking, version: 6, lifecycleStatus: "Cancelled" }, "cancelled", 6, booking.updatedAt);
  assert.equal(new Set([original, confirmed, amended, cancelled].map(value => value.notificationId)).size, 4);
  assert.equal(bookingNotificationRecord(booking, "confirmed", 4, booking.updatedAt).notificationId, confirmed.notificationId);
  assert.equal(JSON.stringify(original), bytes);
  assert.equal(original.to[0], booking.client.email);
  assert.match(original.text, /subject to confirmation/);
  assert.match(confirmed.text, /Total GBP 36.00/);
  assert.match(amended.text, /updated/);
  assert.match(cancelled.text, /cancelled/);
});
test("stale or cancelled source never emits a current confirmation", () => {
  const message = bookingNotificationRecord(booking, "confirmed", 4, booking.updatedAt);
  assert.equal(notificationIsCurrent(message, { ...booking, version: 5, commercialVersion: 3 }), false);
  assert.equal(notificationIsCurrent(message, { ...booking, lifecycleStatus: "Cancelled" }), false);
  assert.equal(claimBookingEmail(message, { ...booking, lifecycleStatus: "Cancelled" }, "claim", booking.updatedAt)?.delivery?.status, "dead-letter");
});
test("site OPLOC selects From/Reply-To independently of multi-site manager; missing or unverified sender fails closed", () => {
  const env = { FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ "oploc:mnk": sender, "oploc:rcoa": { ...sender, from: "rcoa@example.test" } }) };
  assert.equal(resolveBookingSender(booking.service.oplocId, "confirmed", env).from, sender.from);
  assert.equal(resolveBookingSender("oploc:rcoa", "confirmed", env).from, "rcoa@example.test");
  assert.throws(() => resolveBookingSender("missing", "confirmed", env));
  assert.throws(() => resolveBookingSender("oploc:mnk", "confirmed", { FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ "oploc:mnk": { ...sender, verifiedSendAs: false } }) }));
  const raw = gmailRawMessage(bookingNotificationRecord(booking, "confirmed", 4, booking.updatedAt), sender);
  assert.match(raw, /<mnk@example.test>/); assert.match(raw, /Reply-To: mnk@example.test/); assert.match(raw, /multipart\/alternative/);
  assert.doesNotMatch(raw, /attachment/);
});

function harness() {
  let row = bookingNotificationRecord(booking, "confirmed", 4, "2026-10-01T00:00:00Z");
  const store: EmailOutboxStore = {
    async candidates() { return row.outboxStatus === "pending" || row.outboxStatus === "failed" ? [row.notificationId] : []; },
    async claim(_id, claimId, at) { const next = claimBookingEmail(row, booking, claimId, at); if (next) row = next; return next; },
    async arm(_id, claimId, at) { if (row.delivery?.claimId !== claimId || row.sendingStartedAt) return false; row.sendingStartedAt = at; return true; },
    async finish(_id, claimId, event, receipt) { if (row.delivery?.claimId !== claimId) return; row = notificationWithEvent(row, event); if (event.delivery.status === "failed") delete row.sendingStartedAt; if (receipt) row.gmailMessageId = receipt; },
  };
  return { store, row: () => row };
}
test("delivered exact retry and concurrent workers send once", async () => {
  const run = harness(); let sends = 0;
  const deps = { sender: () => sender, token: async () => "mock", send: async () => { sends++; return "gmail-receipt"; } };
  await Promise.all([runBookingEmailWorker(run.store, 25, deps), runBookingEmailWorker(run.store, 25, deps)]);
  await runBookingEmailWorker(run.store, 25, deps);
  assert.equal(sends, 1); assert.equal(run.row().delivery?.status, "delivered"); assert.equal(run.row().nextEligibleAt, undefined);
});
test("missing sender records retryable failure without changing Booking or sending", async () => {
  const run = harness(); const before = JSON.stringify(booking); let sends = 0;
  await runBookingEmailWorker(run.store, 25, { sender: () => { throw new Error("missing"); }, token: async () => "mock", send: async () => { sends++; return "receipt"; } });
  assert.equal(run.row().delivery?.status, "failed"); assert.equal(sends, 0); assert.equal(JSON.stringify(booking), before);
  let event = notificationEvent(run.row());
  for (let i = event.delivery.attempts; i < 10; i++) event = markEventFailed(event, "unavailable", booking.updatedAt);
  assert.equal(event.delivery.status, "dead-letter"); assert.equal(event.payload.subject, run.row().subject);
  assert.equal(markEventDelivered(event, booking.updatedAt).delivery.status, "delivered");
});
test("ambiguous Gmail outcome holds dead letter and never automatically resends", async () => {
  const run = harness(); let sends = 0;
  const deps = { sender: () => sender, token: async () => "mock", send: async () => { sends++; throw new GmailSendFailure(false, false, "uncertain"); } };
  await runBookingEmailWorker(run.store, 25, deps); await runBookingEmailWorker(run.store, 25, deps);
  assert.equal(sends, 1); assert.equal(run.row().delivery?.status, "dead-letter"); assert.ok(run.row().sendingStartedAt);
});
test("Gmail API construction uses raw MIME and records receipts; 429 rejects safely, 5xx/transport are uncertain", async () => {
  const mock: typeof fetch = async (url, init) => { assert.match(String(url), /messages\/send$/); assert.equal(JSON.parse(String(init?.body)).raw, Buffer.from("MIME").toString("base64url")); return Response.json({ id: "receipt" }); };
  assert.equal(await sendBookingGmail("MIME", "mock", mock), "receipt");
  await assert.rejects(sendBookingGmail("MIME", "mock", async () => new Response("", { status: 429 })), error => error instanceof GmailSendFailure && error.definitelyRejected && error.retryable);
  await assert.rejects(sendBookingGmail("MIME", "mock", async () => new Response("", { status: 500 })), error => error instanceof GmailSendFailure && !error.definitelyRejected);
});
