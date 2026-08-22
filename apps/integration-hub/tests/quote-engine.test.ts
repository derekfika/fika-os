import assert from "node:assert/strict";
import test from "node:test";
import { brandedQuoteDocumentHtml, calculateQuoteSnapshot, compactBrandedQuoteDocumentHtml, defaultDashboardQuoteSettings } from "../lib/quote-engine";

const booking = { canonicalId: "booking:test", client: { name: "Derek", companyName: "Client", email: "derek@example.test" }, service: { eventDate: "2026-08-01", startTime: "12:00", guestCount: 10, portalSiteLabel: "MNK" }, order: { items: [{ itemId: "lunch", itemName: "Lunch", quantity: 10, unitPrice: 9 }] }, dietaries: {} };
test("shared quote engine applies a dashboard management fee, per-booking delivery and VAT", () => { const settings = defaultDashboardQuoteSettings("mnk-hospitality"); settings.managementFee = { mode: "percentage", value: 10, label: "Management fee" }; const quote = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: true }, settings); assert.equal(quote.totals.itemsNet.amount, 90); assert.equal(quote.charges.find(charge => charge.code === "delivery")?.net.amount, 35); assert.equal(quote.charges.find(charge => charge.code === "management_fee")?.net.amount, 12.5); assert.equal(quote.totals.net.amount, 137.5); assert.equal(quote.totals.vat.amount, 27.5); assert.equal(quote.totals.gross.amount, 165); });
test("delivery charge is omitted when a booking is internal", () => { const quote = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: false }, defaultDashboardQuoteSettings("mnk-hospitality")); assert.equal(quote.charges.some(charge => charge.code === "delivery"), false); });
test("dashboard quote settings remain independent", () => { const mnk = defaultDashboardQuoteSettings("mnk-hospitality"); const events = defaultDashboardQuoteSettings("events-dashboard"); events.managementFee.value = 20; assert.equal(mnk.managementFee.value, 0); assert.equal(events.dashboardId, "events-dashboard"); });
test("Angel Court applies its 8% fee and building charges only for 100+ guest bookings", () => {
  const settings = defaultDashboardQuoteSettings("angel-court-hospitality");
  const quote = calculateQuoteSnapshot({ ...booking, service: { ...booking.service, guestCount: 100, endTime: "21:00" } }, settings);
  assert.equal(settings.managementFee.value, 8);
  assert.equal(quote.charges.find(charge => charge.code === "housekeeping")?.net.amount, 213.12);
  assert.equal(quote.charges.find(charge => charge.code === "security")?.net.amount, 269.55);
  assert.equal(quote.charges.find(charge => charge.code === "aircon")?.net.amount, 400);
  assert.equal(quote.charges.find(charge => charge.code === "management_fee")?.net.amount, 77.81);
});
test("Angel Court 100+ guest quotes require an end time", () => {
  assert.throws(() => calculateQuoteSnapshot({ ...booking, service: { ...booking.service, guestCount: 100, endTime: undefined } }, defaultDashboardQuoteSettings("angel-court-hospitality")), /end time is required/);
});
test("branded quote renderer uses FIKA typography and a scan-friendly commercial layout", () => { const quote = calculateQuoteSnapshot(booking, defaultDashboardQuoteSettings("mnk-hospitality")); const html = brandedQuoteDocumentHtml(quote, { id: "quote:test:r1", revision: 1, createdAt: "2026-07-31T10:00:00.000Z" }, "/api/brand-assets/fika-logo-white.png"); assert.match(html, /GILROY-REGULAR\.TTF/); assert.match(html, /Hospitality quotation/); assert.match(html, /Total to pay/); assert.match(html, /fika-logo-white\.png/); });
test("compact quote renderer keeps the reference in the quiet footer", () => { const quote = calculateQuoteSnapshot(booking, defaultDashboardQuoteSettings("mnk-hospitality")); const html = compactBrandedQuoteDocumentHtml(quote, { id: "quote:test:r1", revision: 1, createdAt: "2026-07-31T10:00:00.000Z" }); assert.doesNotMatch(html, /meta-label\">Quote reference/); assert.match(html, /footer-reference\">Quote reference/); });
