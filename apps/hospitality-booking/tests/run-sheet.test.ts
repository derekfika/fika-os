import assert from "node:assert/strict";
import test from "node:test";
import { dailyRunSheetHtml, dailyRunSheetTitle, deliveryContext, runSheetHtml, runSheetTitle } from "../lib/run-sheet";
import type { CanonicalBooking } from "../lib/canonical-types";
import { FIKA_LOGO_DATA_URI, SITE_LOGO_DATA_URIS } from "../../shared/hospitality-quote-brand-assets.generated";
import { QUOTE_STYLESHEET_CSS, quoteMastheadCss, quoteMastheadHtml, resolveQuoteBranding } from "../../shared/hospitality-quote-document";

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
  assert.match(html, /Operational run sheet/);
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
  assert.match(html, /<header class="masthead"><img class="logo" src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /FIKA OS|logo-fallback/);
});

test("daily run sheet groups bookings beneath each service day", () => {
  const nextDay = structuredClone(booking);
  nextDay.source.sourceBookingId = "MNK-3";
  nextDay.service.eventDate = "2026-08-05";
  const html = dailyRunSheetHtml([nextDay, booking]);
  assert.ok(html.indexOf("Tuesday, 4 August 2026") < html.indexOf("Wednesday, 5 August 2026"));
  assert.equal((html.match(/class="day-section"/g) || []).length, 2);
});

test("run sheets use the shared quote masthead, stylesheet and brand resolution rather than a separate header", () => {
  const mnk = structuredClone(booking); mnk.service.portalSiteId = "mnk";
  const single = runSheetHtml(mnk);
  assert.ok(single.includes(quoteMastheadHtml(resolveQuoteBranding(mnk.service))));
  assert.ok(single.includes(QUOTE_STYLESHEET_CSS));
  assert.ok(single.indexOf(`src="${FIKA_LOGO_DATA_URI}"`) < single.indexOf(`src="${SITE_LOGO_DATA_URIS.mnk}"`));
  assert.doesNotMatch(single, /FIKA OS|\/api\/brand-assets|\/fonts\//);
  const daily = dailyRunSheetHtml([mnk]);
  assert.ok(daily.includes(quoteMastheadHtml(resolveQuoteBranding(mnk.service))));
  assert.ok(daily.includes(QUOTE_STYLESHEET_CSS) && daily.includes(quoteMastheadCss(12)));
  assert.match(daily, /@page\{size:A4 landscape;margin:0\}/);
});

test("a daily sheet mixing sites uses the neutral masthead; all services of a day stay in chronological order", () => {
  const a = structuredClone(booking); a.service.portalSiteId = "mnk"; a.service.startTime = "15:00"; a.client.companyName = "Third";
  const b = structuredClone(booking); b.service.portalSiteId = "rcoa"; b.service.startTime = "09:00"; b.client.companyName = "First";
  const c = structuredClone(booking); c.service.portalSiteId = "rcoa"; c.service.startTime = "11:00"; c.client.companyName = "Second";
  const html = dailyRunSheetHtml([a, b, c]);
  assert.ok(html.indexOf("First") < html.indexOf("Second") && html.indexOf("Second") < html.indexOf("Third"));
  assert.ok(html.includes(quoteMastheadHtml(resolveQuoteBranding({}))));
  const sameSite = dailyRunSheetHtml([b, c]);
  assert.ok(sameSite.includes(quoteMastheadHtml(resolveQuoteBranding(b.service))));
});
