import assert from "node:assert/strict";
import test from "node:test";
import { bookingNotificationId, buildBookingCancelledEmail, buildBookingConfirmedEmail, buildBookingSubmittedEmail } from "../lib/booking-notifications";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";

const booking = {
  canonicalId: "booking:mnk:notification-test", entityType: "Booking", schemaVersion: "0.1.0", version: 2, lifecycleStatus: "Approved", createdAt: "2026-07-31T10:00:00.000Z", createdBy: "test", updatedAt: "2026-07-31T10:00:00.000Z", updatedBy: "test",
  source: { provider: "mnk-booking-platform", sourceBookingId: "MNK-TEST-001", submissionTimestamp: "2026-07-31T10:00:00.000Z", contractVersion: "test", originalPayload: {} as never },
  client: { name: "Derek Buckley", companyName: "Gallagher", email: "derek@example.test", phone: "0123" },
  service: { eventDate: "2026-08-04", startTime: "12:00", guestCount: 10, portalSiteLabel: "MNK", roomOrArea: "Boardroom" },
  order: { eventType: "lunch", items: [{ itemId: "lunch", itemName: "Deli Style Sandwich Lunch", unitPrice: 9, quantity: 10, lineTotal: 90 }], netTotal: 90, currency: "GBP", vatTotal: 0, grossTotal: 90 },
  dietaries: {}, acknowledgements: {}, attachments: [], statusHistory: [], audit: [], quoteState: { revisions: [] },
} as CanonicalBooking;

test("submission notification preserves the legacy internal wording and booking summary", () => {
  const email = buildBookingSubmittedEmail(booking);
  assert.match(email.subject, /New Fika at MNK Hospitality booking request/);
  assert.match(email.text, /Please review the request and prepare the quote\./);
  assert.match(email.html, /Hospitality brochure 2026/);
  assert.match(email.html, /MNK-TEST-001/);
});

test("confirmation and cancellation notifications use the legacy client-facing subjects and details", () => {
  const confirmed = buildBookingConfirmedEmail(booking);
  const cancelled = buildBookingCancelledEmail({ ...booking, lifecycleStatus: "Cancelled" });
  assert.equal(confirmed.to[0], booking.client.email);
  assert.match(confirmed.subject, /Booking Confirmed/);
  assert.match(confirmed.html, /Your hospitality booking is confirmed/);
  assert.match(cancelled.subject, /Booking Cancelled/);
  assert.match(cancelled.html, /This email is to confirm that the following FIKA Hospitality booking has been cancelled/);
});

test("notification identity is deterministic per booking event version", () => {
  assert.equal(bookingNotificationId(booking, "confirmed", 2), bookingNotificationId(booking, "confirmed", 2));
  assert.notEqual(bookingNotificationId(booking, "confirmed", 2), bookingNotificationId(booking, "confirmed", 3));
});
