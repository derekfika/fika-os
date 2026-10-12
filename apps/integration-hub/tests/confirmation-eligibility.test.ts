import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../lib/firebase-admin";
import { bookingNotificationRecord, type BookingNotificationRecord } from "../lib/booking-notifications";
import { gmailRawMessage, notificationIsCurrent, type BookingSender } from "../lib/booking-email-delivery";
import { bookingEmailStore } from "../lib/booking-email-firestore";
import { runBookingEmailWorker } from "../lib/booking-email-outbox";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";

// Preserved MNK UAT shape: confirmation v7, completion v8, commercial revision 2.
const committedAt = "2026-10-12T10:00:00.000Z";
const laterAt = "2026-10-12T10:01:00.000Z";
const booking = {
  canonicalId: "booking:mnk:7822fbccc144898ce12a7dd748e4b378", version: 7,
  commercialVersion: 2, lifecycleStatus: "Sent to CPU", updatedAt: committedAt,
  source: { sourceBookingId: "UAT-MNK" },
  service: { oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f", portalSiteId: "mnk", portalSiteLabel: "MNK", eventDate: "2026-11-03", startTime: "10:00", guestCount: 2 },
  client: { name: "FIKA OS UAT", companyName: "FIKA OS UAT", email: "derek@fikacatering.com" },
  order: { items: [{ itemId: "coffee", itemName: "Bloom Filter Coffee", quantity: 2, unitPrice: 3, lineTotal: 6 }], netTotal: 6, vatTotal: 0, grossTotal: 6 },
  statusHistory: [{ status: "Sent to CPU", changedAt: committedAt, changedBy: "uat", reason: "Production hand-off recorded." }],
  audit: [{ action: "booking-sent-to-cpu", at: committedAt, by: "uat", reason: "Production hand-off recorded." }],
} as CanonicalBooking;
const message = bookingNotificationRecord(booking, "confirmed", 7, committedAt);
const completed: CanonicalBooking = {
  ...booking, version: 8, lifecycleStatus: "Completed",
  statusHistory: [...booking.statusHistory, { status: "Completed", changedAt: laterAt, changedBy: "uat", reason: "Automatically completed after CPU hand-off." }],
  audit: [...booking.audit, { action: "workflow-complete", at: laterAt, by: "uat", reason: "complete workflow command" }],
};
const sender: BookingSender = { from: "mnk@fikacatering.com", replyTo: "mnk@fikacatering.com", authenticatedAccount: "mnk@fikacatering.com", displayName: "FIKA Hospitality at MNK", verifiedSendAs: true, enabled: ["confirmed"] };

test("confirmation v7 survives v8 auto-completion without rewriting its committed payload", () => {
  const before = JSON.stringify(message);
  assert.equal(notificationIsCurrent(message, completed), true);
  assert.equal(JSON.stringify(message), before);
});
test("exact v7 Sent to CPU and legacy Approved confirmations remain eligible", () => {
  assert.equal(notificationIsCurrent(message, booking), true);
  assert.equal(notificationIsCurrent(message, { ...booking, lifecycleStatus: "Approved" }), true);
});
test("confirmation rejects ahead, missing, fractional, zero and invalid source versions", () => {
  for (const version of [9, undefined, 0, -1, 7.5, NaN, Infinity]) {
    assert.equal(notificationIsCurrent({ ...message, bookingVersion: version }, completed), false);
  }
});
test("confirmation rejects another booking, commercial revision or OPLOC", () => {
  assert.equal(notificationIsCurrent(message, { ...completed, canonicalId: "booking:other" }), false);
  assert.equal(notificationIsCurrent(message, { ...completed, commercialVersion: 3 }), false);
  assert.equal(notificationIsCurrent(message, { ...completed, service: { ...completed.service, oplocId: "oploc:other" } }), false);
  assert.equal(notificationIsCurrent({ ...message, oplocId: undefined }, completed), false);
});
test("amendment, cancellation and renewed quote supersede a pending confirmation", () => {
  for (const lifecycleStatus of ["Reviewed", "Cancelled", "Quoted"] as const) {
    assert.equal(notificationIsCurrent(message, { ...completed, lifecycleStatus }), false);
  }
  for (const action of ["workflow-amend", "workflow-cancel", "workflow-quote", "workflow-set-additional-charges"]) {
    assert.equal(notificationIsCurrent(message, { ...completed, audit: [...completed.audit, { action, at: laterAt, by: "uat", reason: "Superseded" }] }), false);
  }
});
test("later or same-millisecond replacement confirmation supersedes the earlier message", () => {
  for (const at of [laterAt, committedAt]) {
    const replacement: CanonicalBooking = { ...booking, version: 9,
      statusHistory: [...booking.statusHistory, { status: "Sent to CPU", changedAt: at, changedBy: "uat", reason: "Replacement" }],
      audit: [...booking.audit, { action: "booking-sent-to-cpu", at, by: "uat", reason: "Replacement" }],
    };
    assert.equal(notificationIsCurrent(message, replacement), false);
    // Each source of durable transition evidence independently rejects replacement.
    assert.equal(notificationIsCurrent(message, { ...replacement, audit: [] }), false);
    assert.equal(notificationIsCurrent(message, { ...replacement, statusHistory: [] }), false);
  }
});
test("confirmation bookkeeping does not supersede; malformed enqueue time fails closed", () => {
  assert.equal(notificationIsCurrent(message, { ...completed, audit: [...completed.audit, { action: "workflow-quote-pdf-status", at: laterAt, by: "uat", reason: "Persistence evidence" }] }), true);
  assert.equal(notificationIsCurrent(message, { ...booking, version: 8,
    statusHistory: [...booking.statusHistory, { status: "Sent to CPU", changedAt: laterAt, changedBy: "uat", reason: "PDF saved" }],
    audit: [...booking.audit, { action: "workflow-quote-pdf-status", at: laterAt, by: "uat", reason: "PDF saved" }],
  }), true);
  assert.equal(notificationIsCurrent({ ...message, createdAt: "invalid" }, completed), false);
});
test("submitted, amended and cancelled retain exact-version and lifecycle policy", () => {
  for (const kind of ["submitted", "amended", "cancelled"] as const) {
    const row = { ...message, kind };
    const current = { ...booking, lifecycleStatus: kind === "cancelled" ? "Cancelled" as const : "Reviewed" as const };
    assert.equal(notificationIsCurrent(row, current), true);
    assert.equal(notificationIsCurrent(row, { ...current, version: 8 }), false);
    assert.equal(notificationIsCurrent(row, completed), false);
  }
});

// Exercise the actual claim/arm/finish transaction adapter without any Firestore I/O.
function transactionHarness(context: TestContext, source = completed) {
  const rows = new Map<string, unknown>([
    [`fikaBookings/${booking.canonicalId}`, structuredClone(source)],
    [`fikaBookingNotifications/${message.notificationId}`, structuredClone(message)],
  ]);
  const copy = <T>(value: T): T => structuredClone(value);
  type Ref = { path: string };
  const transaction = {
    async get(ref: Ref) { return { exists: rows.has(ref.path), data: () => copy(rows.get(ref.path)) }; },
    set(ref: Ref, value: object, options?: { merge?: boolean }) { rows.set(ref.path, copy(options?.merge ? { ...(rows.get(ref.path) as object), ...value } : value)); },
    update(ref: Ref, value: object) { assert.ok(rows.has(ref.path)); rows.set(ref.path, copy({ ...(rows.get(ref.path) as object), ...value })); },
    create(ref: Ref, value: object) { assert.equal(rows.has(ref.path), false); rows.set(ref.path, copy(value)); },
  };
  let tail = Promise.resolve();
  context.mock.method(db, "runTransaction", async (callback: (transaction: unknown) => Promise<unknown>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await callback(transaction); } finally { release(); }
  });
  const row = () => rows.get(`fikaBookingNotifications/${message.notificationId}`) as BookingNotificationRecord;
  const store = { ...bookingEmailStore, async candidates() { return ["pending", "failed"].includes(row().outboxStatus || "") ? [message.notificationId] : []; } };
  return { row, store, changeSource(next: CanonicalBooking) { rows.set(`fikaBookings/${booking.canonicalId}`, copy(next)); } };
}

test("actual claim and pre-send barrier both permit auto-completion; concurrent workers send once", async context => {
  const harness = transactionHarness(context);
  const payload = (row: BookingNotificationRecord) => ({ id: row.notificationId, version: row.bookingVersion, subject: row.subject, text: row.text, html: row.html, to: row.to, cc: row.cc });
  const before = payload(harness.row());
  let sends = 0;
  const deps = { sender: () => sender, token: async () => "mock-token", send: async (raw: string) => { assert.equal(raw, gmailRawMessage(message, sender)); sends++; return "mock-receipt"; } };
  await Promise.all([runBookingEmailWorker(harness.store, 25, deps), runBookingEmailWorker(harness.store, 25, deps)]);
  await runBookingEmailWorker(harness.store, 25, deps);
  assert.equal(sends, 1);
  assert.equal(harness.row().gmailMessageId, "mock-receipt");
  assert.equal(harness.row().delivery?.status, "delivered");
  assert.deepEqual(payload(harness.row()), before);
});
test("pre-send barrier permits completion that happens after claim", async context => {
  const harness = transactionHarness(context, booking);
  let sends = 0;
  await runBookingEmailWorker(harness.store, 25, { sender: () => sender, token: async () => { harness.changeSource(completed); return "mock"; }, send: async () => { sends++; return "mock-receipt"; } });
  assert.equal(sends, 1);
});
test("actual pre-send barrier suppresses an amendment racing after a valid claim", async context => {
  const harness = transactionHarness(context);
  let sends = 0;
  await runBookingEmailWorker(harness.store, 25, { sender: () => sender, token: async () => { harness.changeSource({ ...completed, version: 9, commercialVersion: 3, lifecycleStatus: "Reviewed" }); return "mock"; }, send: async () => { sends++; return "unexpected"; } });
  assert.equal(sends, 0);
  assert.equal(harness.row().outboxStatus, "dead-letter");
  assert.equal(harness.row().sendingStartedAt, undefined);
});

test("actual claim suppresses a superseded confirmation before authentication", async context => {
  const harness = transactionHarness(context, { ...completed, version: 9, commercialVersion: 3 });
  let authenticated = false;
  const result = await runBookingEmailWorker(harness.store, 25, { sender: () => sender, token: async () => { authenticated = true; return "mock"; }, send: async () => { throw new Error("Must not send"); } });
  assert.equal(result.attempted, 0);
  assert.equal(authenticated, false);
  assert.equal(harness.row().outboxStatus, "dead-letter");
});

for (const supersession of ["cancellation", "replacement confirmation"] as const) {
  test(`actual pre-send barrier suppresses ${supersession} after claim`, async context => {
    const harness = transactionHarness(context);
    let sends = 0;
    const next = supersession === "cancellation"
      ? { ...completed, version: 9, lifecycleStatus: "Cancelled" as const }
      : { ...completed, version: 9, statusHistory: [...completed.statusHistory, { status: "Sent to CPU" as const, changedAt: laterAt, changedBy: "uat", reason: "Replacement" }] };
    await runBookingEmailWorker(harness.store, 25, { sender: () => sender, token: async () => { harness.changeSource(next); return "mock"; }, send: async () => { sends++; return "unexpected"; } });
    assert.equal(sends, 0);
    assert.equal(harness.row().outboxStatus, "dead-letter");
    assert.equal(harness.row().sendingStartedAt, undefined);
  });
}
