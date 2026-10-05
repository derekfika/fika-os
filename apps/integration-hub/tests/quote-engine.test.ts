import assert from "node:assert/strict";
import test from "node:test";
import { brandedQuoteDocumentHtml, calculateQuoteSnapshot, compactBrandedQuoteDocumentHtml, defaultDashboardQuoteSettings } from "../lib/quote-engine";
import { normalizeBookingAdditionalCharges, type BookingAdditionalChargeInput } from "../lib/hospitality-additional-charges";

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
test("compact quote renderer uses human-readable service details and hides the first revision label", () => {
  const quote = calculateQuoteSnapshot({ ...booking, order: { ...booking.order, eventType: "lunch" } }, defaultDashboardQuoteSettings("mnk-hospitality"));
  const html = compactBrandedQuoteDocumentHtml(quote, { id: "quote:test:r1", revision: 1, createdAt: "2026-07-31T10:00:00.000Z" });
  assert.match(html, />Lunch</);
  assert.match(html, />1 August 2026 · 12:00</);
  assert.match(html, /Generated 31 July 2026 at 11:00/);
  assert.doesNotMatch(html, /Revision 1/);
});

const manualCharge = (id: string, label: string, quantity: number, unitNet: number, category: "equipment" | "service" | "other" = "equipment"): BookingAdditionalChargeInput => ({ id, kind: "manual", category, label, quantity, unitNet });
const addCharges = (charges: BookingAdditionalChargeInput[], rates = defaultDashboardQuoteSettings("mnk-hospitality").labourRates || []) => normalizeBookingAdditionalCharges(charges, [], rates, "manager-1", "2026-10-05T10:00:00.000Z");

test("an empty additional-charge list leaves the existing quote snapshot unchanged", () => {
  const settings = defaultDashboardQuoteSettings("mnk-hospitality");
  const withoutField = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: true }, settings);
  const emptyList = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: true, additionalCharges: [] }, settings);
  assert.deepEqual(emptyList, withoutField);
});

test("manual additional charges contribute to charges, net, VAT and gross", () => {
  const charges = addCharges([manualCharge("equipment-100", "Equipment hire", 1, 100)]);
  const quote = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: false, additionalCharges: charges }, defaultDashboardQuoteSettings("mnk-hospitality"));
  assert.equal(quote.totals.itemsNet.amount, 90);
  assert.equal(quote.totals.chargesNet.amount, 100);
  assert.equal(quote.totals.net.amount, 190);
  assert.equal(quote.totals.vat.amount, 38);
  assert.equal(quote.totals.gross.amount, 228);
});

test("multiple manual charge lines sum once in the additional-charge subtotal", () => {
  const charges = addCharges([manualCharge("equipment-150", "Equipment hire", 1, 150), manualCharge("service-090", "Additional porterage", 2, 45, "service")]);
  const quote = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: false, additionalCharges: charges }, defaultDashboardQuoteSettings("mnk-hospitality"));
  assert.deepEqual(quote.charges.filter((charge) => charge.code === "booking_additional").map((charge) => charge.net.amount), [150, 90]);
  assert.equal(quote.totals.chargesNet.amount, 240);
});

test("labour is server-calculated and snapshots the complete rate calculation", () => {
  const settings = defaultDashboardQuoteSettings("mnk-hospitality");
  settings.labourRates = [{ id: "chef", label: "Chef", hourlyRate: 22 }];
  const charges = addCharges([{ id: "chef-labour", kind: "labour", category: "labour", label: "Chef labour", labour: { roleId: "chef", roleLabel: "Chef", staffCount: 2, hoursPerPerson: 5, hourlyRate: 22, multiplier: 1.5, rateSource: "configured" } }], settings.labourRates);
  const quote = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: false, additionalCharges: charges }, settings);
  const charge = quote.charges.find((item) => item.code === "booking_additional");
  assert.equal(charge?.net.amount, 330);
  assert.equal(charge?.sourceAdditionalChargeId, "chef-labour");
  assert.equal(charge?.detail, "2 staff × 5.00 hrs × £22.00 × 1.5");
  assert.deepEqual(charge?.labour, { roleId: "chef", roleLabel: "Chef", staffCount: 2, hoursPerPerson: 5, hourlyRate: 22, multiplier: 1.5, rateSource: "configured" });
});

test("manual-charge rounding follows the quote engine money semantics", () => {
  const charges = addCharges([manualCharge("rounding-1", "Rounding", 3, 0.335)]);
  assert.equal(charges[0].netTotal, 1.01);
});

test("invalid or zero additional-charge inputs are rejected", () => {
  for (const unitNet of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => addCharges([manualCharge("invalid-charge", "Invalid", 1, unitNet)]));
  }
  assert.throws(() => addCharges([manualCharge("invalid-charge", "Invalid", 0, 10)]));
  assert.throws(() => addCharges([{ id: "zero-labour", kind: "labour", category: "labour", label: "Chef labour", labour: { roleId: "chef", roleLabel: "Chef", staffCount: 2, hoursPerPerson: 5, hourlyRate: 0, multiplier: 1.5, rateSource: "custom" } }]));
});

test("manual charges do not change the existing management-fee base or compound", () => {
  const settings = defaultDashboardQuoteSettings("mnk-hospitality");
  settings.managementFee = { mode: "percentage", value: 10, label: "Management fee" };
  const charges = addCharges([manualCharge("fee-base", "Equipment hire", 1, 100)], settings.labourRates || []);
  const quote = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: true, additionalCharges: charges }, settings);
  assert.equal(quote.charges.find((charge) => charge.code === "management_fee")?.net.amount, 12.5);
  assert.equal(quote.totals.chargesNet.amount, 147.5);
});

test("quote documents show labour detail while keeping internal charge IDs hidden", () => {
  const settings = defaultDashboardQuoteSettings("mnk-hospitality");
  settings.labourRates = [{ id: "chef", label: "Chef", hourlyRate: 22 }];
  const charges = addCharges([{ id: "internal-labour-id", kind: "labour", category: "labour", label: "Chef labour", labour: { roleId: "chef", roleLabel: "Chef", staffCount: 2, hoursPerPerson: 5, hourlyRate: 22, multiplier: 1.5, rateSource: "configured" } }], settings.labourRates);
  const snapshot = calculateQuoteSnapshot({ ...booking, deliveryChargeRequired: false, additionalCharges: charges }, settings);
  const html = brandedQuoteDocumentHtml(snapshot, { id: "quote:test:r1", revision: 1, createdAt: "2026-10-05T10:00:00Z" });
  assert.match(html, /Chef labour/);
  assert.match(html, /2 staff × 5\.00 hrs × £22\.00 × 1\.5/);
  assert.doesNotMatch(html, /internal-labour-id/);
});
