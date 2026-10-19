import assert from "node:assert/strict";
import test from "node:test";
import { bookingNotificationId, bookingNotificationRecord, buildBookingCancelledEmail, buildBookingConfirmedEmail, buildBookingEmail, buildBookingSubmittedEmail } from "../lib/booking-notifications";
import { gmailRawMessage } from "../lib/booking-email-delivery";
import { emailInlineImages } from "../lib/booking-email-template";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";

const booking = {
  canonicalId: "booking:mnk:notification-test", entityType: "Booking", schemaVersion: "0.1.0", version: 2, lifecycleStatus: "Approved", createdAt: "2026-07-31T10:00:00.000Z", createdBy: "test", updatedAt: "2026-07-31T10:00:00.000Z", updatedBy: "test",
  source: { provider: "mnk-booking-platform", sourceBookingId: "MNK-TEST-001", submissionTimestamp: "2026-07-31T10:00:00.000Z", contractVersion: "test", originalPayload: {} as never },
  client: { name: "Derek Buckley", companyName: "Gallagher", email: "derek@example.test", phone: "0123" },
  service: { eventDate: "2026-08-04", startTime: "12:00", guestCount: 10, portalSiteLabel: "MNK", roomOrArea: "Boardroom" },
  order: { eventType: "lunch", items: [{ itemId: "lunch", itemName: "Deli Style Sandwich Lunch", unitPrice: 9, quantity: 10, lineTotal: 90 }], netTotal: 90, currency: "GBP", vatTotal: 0, grossTotal: 90 },
  dietaries: {}, acknowledgements: {}, attachments: [], statusHistory: [], audit: [], quoteState: { revisions: [] },
} as CanonicalBooking;

test("customer lifecycle emails share one template and use customer-facing wording", () => {
  const submitted = buildBookingSubmittedEmail(booking);
  const confirmed = buildBookingConfirmedEmail(booking);
  const cancelled = buildBookingCancelledEmail({ ...booking, lifecycleStatus: "Cancelled" });
  assert.equal(submitted.to[0], booking.client.email);
  assert.equal(confirmed.to[0], booking.client.email);
  assert.match(submitted.subject, /Booking request received/);
  assert.match(confirmed.subject, /Booking confirmed/);
  assert.match(cancelled.subject, /Booking cancelled/);
  assert.match(submitted.html, /subject to confirmation/);
  assert.match(confirmed.html, /Your booking is confirmed/);
  assert.match(cancelled.html, /has been cancelled/);
  assert.match(confirmed.html, /MNK-TEST-001/);
  for (const email of [submitted, confirmed, cancelled]) assert.doesNotMatch(email.html + email.text, /Dashboard status|dashboard|Sent to CPU|Approved/);
});

test("emails show UK dates, currency, ordered items and totals; empty fields are hidden", () => {
  const email = buildBookingConfirmedEmail(booking);
  assert.match(email.html, /Tuesday, 4 August 2026|Tuesday 4 August 2026/);
  assert.match(email.html, /Deli Style Sandwich Lunch/);
  assert.match(email.html, /£9.00/);
  assert.match(email.html, /£90.00/);
  assert.doesNotMatch(email.html, /Guest.*undefined|undefined|NaN/);
  assert.doesNotMatch(email.html, />Contact phone|>Floor/);
  const bare = buildBookingConfirmedEmail({ ...booking, service: { ...booking.service, guestCount: 0, roomOrArea: "" }, order: { ...booking.order, items: [], netTotal: undefined as never } } as CanonicalBooking);
  assert.doesNotMatch(bare.html, />Guests<|>Location<|Booked items|Subtotal/);
});

test("requested, confirmed, amended and cancelled states are visibly distinct and site name is not repeated in subjects", () => {
  const states = (["submitted", "confirmed", "amended", "cancelled"] as const).map(kind => buildBookingEmail(kind, booking));
  assert.equal(new Set(states.map(value => value.subject)).size, 4);
  assert.match(states[0].html, /Received · awaiting confirmation/);
  assert.match(states[2].html, /subject to renewed confirmation/);
  assert.match(states[3].html, /Cancelled/);
  assert.doesNotMatch(states[3].html, /Your booked items/);
  for (const state of states) assert.equal((state.subject.match(/MNK/g) || []).length, 1);
});

test("notification identity is deterministic per booking event version", () => {
  assert.equal(bookingNotificationId(booking, "confirmed", 2), bookingNotificationId(booking, "confirmed", 2));
  assert.notEqual(bookingNotificationId(booking, "confirmed", 2), bookingNotificationId(booking, "confirmed", 3));
});

test("RCoA emails carry the FIKA logo left and the RCoA logo right with the quote palette, and use only email-safe images", () => {
  const rcoa = {
    ...booking,
    source: { ...booking.source, sourceBookingId: "RCOA-20261005103000-AB12" },
    service: { ...booking.service, portalSiteId: "rcoa", portalSiteLabel: "RCoA Hospitality" },
  } as CanonicalBooking;
  const confirmed = buildBookingConfirmedEmail(rcoa);
  assert.match(confirmed.subject, /^RCoA Hospitality | Booking confirmed |/);
  assert.ok(confirmed.html.indexOf("cid:fika-logo") < confirmed.html.indexOf("cid:site-logo-rcoa"));
  assert.match(confirmed.html, /#24115c/);
  assert.match(confirmed.html, /#4df7c2/);
  assert.doesNotMatch(confirmed.html, /data:image|<svg|.svg/);
  assert.deepEqual(emailInlineImages(confirmed.html).map(image => image.contentId).sort(), ["fika-logo", "site-logo-rcoa"]);
});

test("a site without artwork falls back to its text label and unknown sites to FIKA Hospitality", () => {
  const unknown = buildBookingConfirmedEmail({ ...booking, service: { ...booking.service, portalSiteId: "new-site", portalSiteLabel: "New Site" } } as CanonicalBooking);
  assert.match(unknown.html, />New Site</);
  assert.deepEqual(emailInlineImages(unknown.html).map(image => image.contentId), ["fika-logo"]);
  assert.match(unknown.subject, /^New Site Hospitality |/);
  const blank = buildBookingConfirmedEmail({ ...booking, service: { ...booking.service, portalSiteLabel: undefined, portalSiteId: undefined } } as CanonicalBooking);
  assert.match(blank.subject, /^FIKA Hospitality |/);
});

test("RCoA submission notification has only the customer recipient even when internal recipients are configured", () => {
  const previous = process.env.FIKA_RCOA_NOTIFICATION_RECIPIENTS;
  process.env.FIKA_RCOA_NOTIFICATION_RECIPIENTS = "ops@fikacatering.com";
  try {
    const rcoa = { ...booking, source: { ...booking.source, sourceBookingId: "RCOA-NO-CC-TEST" }, client: { ...booking.client, email: "customer@example.test" }, service: { ...booking.service, portalSiteId: "rcoa", portalSiteLabel: "RCoA Hospitality", oplocId: "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2" } } as CanonicalBooking;
    const message = bookingNotificationRecord(rcoa, "submitted", rcoa.version, rcoa.updatedAt);
    assert.deepEqual(message.to, ["customer@example.test"]);
    assert.deepEqual(message.cc, []);
  } finally {
    if (previous === undefined) delete process.env.FIKA_RCOA_NOTIFICATION_RECIPIENTS;
    else process.env.FIKA_RCOA_NOTIFICATION_RECIPIENTS = previous;
  }
});

test("raw MIME embeds the brand logos as inline cid parts, keeps one footer and no stray contact line", () => {
  const rcoa = { ...booking, service: { ...booking.service, portalSiteId: "rcoa", portalSiteLabel: "RCoA Hospitality", oplocId: "oploc:rcoa" } } as CanonicalBooking;
  const sender = { from: "rcoa@example.test", replyTo: "rcoa@example.test", displayName: "RCoA Hospitality", enabled: ["confirmed"], authenticatedAccount: "rcoa@example.test", verifiedSendAs: true } as never;
  const raw = gmailRawMessage(bookingNotificationRecord(rcoa, "confirmed", 2, "2026-07-31T10:00:00.000Z"), sender);
  assert.match(raw, /multipart\/related/);
  assert.match(raw, /Content-ID: <fika-logo>/);
  assert.match(raw, /Content-ID: <site-logo-rcoa>/);
  assert.match(raw, /Content-Disposition: inline/);
  assert.doesNotMatch(raw, /Content-Disposition: attachment/);
  const html = Buffer.from(raw.split("Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString();
  assert.equal((html.match(/reply to/gi) || []).length, 1);
  assert.match(html, /^<!doctype html>/);
});
