import assert from "node:assert/strict";
import test from "node:test";
import { dailyRunSheetHtml, dailyRunSheetTitle, deliveryContext, runSheetHtml, runSheetTitle } from "../lib/run-sheet";
import type { CanonicalBooking } from "../../integration-hub/lib/hospitality-booking-service";

const booking: CanonicalBooking = {
  canonicalId: "booking:mnk:test", entityType: "Booking", schemaVersion: "0.1.0", version: 1, lifecycleStatus: "Approved",
  createdAt: "2026-07-30T10:00:00.000Z", createdBy: "test", updatedAt: "2026-07-30T10:00:00.000Z", updatedBy: "test",
  source: { provider: "mnk-booking-platform", sourceBookingId: "MNK-1", submissionTimestamp: "2026-07-30T10:00:00.000Z", contractVersion: "test", originalPayload: {} as CanonicalBooking["source"]["originalPayload"] },
  client: { name: "Host", companyName: "Gallagher", email: "host@example.com" },
  service: { eventDate: "2026-08-04", startTime: "12:00", guestCount: 12, portalSiteLabel: "MNK", floorLevel: "5th Floor" },
  order: { currency: "GBP", netTotal: 90, vatTotal: 0, grossTotal: 90, items: [{ itemId: "item:1", itemName: "Lunch <special>", quantity: 12, unitPrice: 7.5, lineTotal: 90 }] },
  dietaries: { vegetarian: 2 }, acknowledgements: {}, notes: "Please use the lift.", attachments: [], statusHistory: [], audit: [],
};

test("run sheet uses the immutable booking snapshot and escapes requested item text", () => {
  assert.equal(runSheetTitle(booking), "MNK_Run_Sheet_2026-08-04_Gallagher");
  const html = runSheetHtml(booking);
  assert.match(html, /MNK-1/);
  assert.match(html, /Lunch &lt;special&gt;/);
  assert.match(html, /Please use the lift/);
  assert.match(html, /Booking for/);
  assert.match(html, /FIKA service site/);
  assert.match(html, /Floor \/ level/);
  assert.deepEqual(deliveryContext(booking), [{ label: "FIKA service site", value: "MNK" }, { label: "Floor / level", value: "5th Floor" }]);
});

test("daily run sheet is a scan-first ordered view across canonical Bookings", () => {
  const later = structuredClone(booking); later.source.sourceBookingId = "MNK-2"; later.service.startTime = "14:00"; later.client.companyName = "Second client";
  const html = dailyRunSheetHtml([later, booking]);
  assert.equal(dailyRunSheetTitle([booking]), "MNK_Daily_Run_Sheet_2026-08-04");
  assert.ok(html.indexOf("Gallagher") < html.indexOf("Second client"));
  assert.match(html, /daily operational run sheet/i);
  assert.match(html, /Floor \/ level/);
  assert.match(html, /Tuesday, 4 August 2026/);
  assert.match(html, /logo-fallback/);
});

test("daily run sheet groups bookings beneath each service day", () => {
  const nextDay = structuredClone(booking);
  nextDay.source.sourceBookingId = "MNK-3";
  nextDay.service.eventDate = "2026-08-05";
  const html = dailyRunSheetHtml([nextDay, booking]);
  assert.ok(html.indexOf("Tuesday, 4 August 2026") < html.indexOf("Wednesday, 5 August 2026"));
  assert.equal((html.match(/class="day-section"/g) || []).length, 2);
});
