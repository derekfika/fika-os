import assert from "node:assert/strict";
import test from "node:test";
import { quoteHtml } from "../lib/quote-document";
import { FIKA_LOGO_DATA_URI, SITE_LOGO_DATA_URIS } from "../lib/quote-brand-assets.generated";

test("quote branding uses immutable portal identity and self-contained existing assets", () => {
  const render = (portalSiteId: string, portalSiteLabel: string) => quoteHtml({
    quoteState: { currentRevisionId: "quote-1", revisions: [{ id: "quote-1", revision: 1, createdAt: "2026-10-06T12:00:00Z", snapshot: {
      client: { companyName: "UAT", name: "Operator", email: "uat@example.test" },
      service: { portalSiteId, portalSiteLabel, eventDate: "2026-10-13", startTime: "12:00", guestCount: 12 },
      order: { lines: [] }, charges: [], dietaries: {},
      totals: { itemsNet: { amount: 0 }, chargesNet: { amount: 0 }, net: { amount: 0 }, vat: { amount: 0 }, gross: { amount: 0 }, vatRate: 0.2 },
    } }] },
  } as never);
  const mnk = render("mnk", "MNK");
  assert.ok(mnk.includes(`class="site-logo" src="${SITE_LOGO_DATA_URIS.mnk}" alt="MNK"`));
  const cfc = render("cfc", "CFC");
  assert.ok(cfc.includes(SITE_LOGO_DATA_URIS.cfc));
  assert.ok(!cfc.includes(SITE_LOGO_DATA_URIS.mnk));
  const unknown = render("unknown", "MNK");
  assert.ok(unknown.includes(FIKA_LOGO_DATA_URI));
  assert.ok(!unknown.includes(SITE_LOGO_DATA_URIS.mnk));
  assert.match(unknown, /masthead-label">MNK/);
  assert.ok(!render("rcoa", "RCoA").includes(SITE_LOGO_DATA_URIS.mnk));
});

test("quoteHtml renders a self-contained branded immutable quote snapshot", () => {
  const booking = {
    canonicalId: "booking-1",
    client: { name: "Alex Client", companyName: "Example Company", email: "alex@example.test", phone: "020 0000 0000" },
    service: { eventDate: "2026-08-28", startTime: "12:00", endTime: "14:00", portalSiteLabel: "MNK", roomOrArea: "Boardroom", guestCount: 24 },
    order: { eventType: "client_lunch", items: [], netTotal: 0, vatTotal: 0, grossTotal: 0, currency: "GBP" },
    dietaries: { vegetarian: 3 }, notes: "Please label the dietary meals.",
    quoteState: { currentRevisionId: "quote-rev-7", revisions: [{ id: "quote-rev-7", revision: 7, createdAt: "2026-08-28T10:00:00.000Z", snapshot: { bookingId: "booking-1", client: { name: "Alex Client", companyName: "Example Company", email: "alex@example.test", phone: "020 0000 0000" }, service: { eventDate: "2026-08-28", startTime: "12:00", endTime: "14:00", portalSiteLabel: "MNK", roomOrArea: "Boardroom", guestCount: 24 }, order: { eventType: "client_lunch", lines: [{ itemId: "dish-1", name: "Summer lunch", description: "Seasonal menu", quantity: 24, unitNet: { amount: 12.5 }, lineNet: { amount: 300 }, servingInfo: "Buffet", comments: "No nuts" }] }, charges: [{ label: "Delivery", net: { amount: 35 } }], totals: { itemsNet: { amount: 300 }, chargesNet: { amount: 35 }, net: { amount: 335 }, vat: { amount: 67 }, gross: { amount: 402 }, vatRate: 0.2 }, dietaries: { vegetarian: 3 }, notes: "Please label the dietary meals." } }] },
  } as never;
  const html = quoteHtml(booking);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /font-family:Vim/);
  assert.match(html, /font-family:Gilroy/);
  assert.doesNotMatch(html, /FIKA OS|Revision 7|Quote reference|quote-rev-7|booking-1/);
  assert.match(html, /Example Company/);
  assert.match(html, /client_lunch|Client Lunch/);
  assert.match(html, /Summer lunch/);
  assert.match(html, /Delivery/);
  assert.match(html, /£300\.00/);
  assert.match(html, /£67\.00/);
  assert.match(html, /£402\.00/);
  assert.match(html, /vegetarian/);
  assert.match(html, /Please label the dietary meals/);
  assert.doesNotMatch(html, /stylesheet|globals\.css|tailwind|font-family:Arial|font-family:sans-serif/i);
});

test("quoteHtml rejects a missing or stale immutable revision", () => {
  assert.throws(() => quoteHtml({ quoteState: { revisions: [], currentRevisionId: "missing" } } as never), /No current quote revision/);
});

test("labour detail renders from the immutable quote snapshot without exposing its internal ID", () => {
  const booking = {
    canonicalId: "booking-1",
    client: { name: "Alex Client", companyName: "Example Company", email: "alex@example.test" },
    service: { eventDate: "2026-08-28", startTime: "12:00", portalSiteLabel: "MNK", guestCount: 10 },
    order: { items: [], netTotal: 0, vatTotal: 0, grossTotal: 0, currency: "GBP" },
    dietaries: {},
    additionalCharges: [{ id: "new-booking-charge", kind: "manual", category: "equipment", label: "New equipment", quantity: 1, unitNet: 500, netTotal: 500, createdAt: "2026-08-29T10:00:00Z", createdBy: "manager" }],
    quoteState: {
      currentRevisionId: "quote-rev-8",
      revisions: [{ id: "quote-rev-8", revision: 8, createdAt: "2026-08-28T10:00:00.000Z", snapshot: {
        bookingId: "booking-1",
        client: { name: "Alex Client", companyName: "Example Company", email: "alex@example.test" },
        service: { eventDate: "2026-08-28", startTime: "12:00", portalSiteLabel: "MNK", guestCount: 10 },
        order: { lines: [] },
        charges: [{ sourceAdditionalChargeId: "private-charge-id", category: "labour", label: "Chef labour", detail: "2 staff × 5.00 hrs × £22.00 × 1.5", labour: { roleId: "chef", roleLabel: "Chef", staffCount: 2, hoursPerPerson: 5, hourlyRate: 22, multiplier: 1.5, rateSource: "configured" }, net: { currency: "GBP", amount: 330 }, vatRate: 0.2 }],
        totals: { itemsNet: { amount: 0 }, chargesNet: { amount: 330 }, net: { amount: 330 }, vat: { amount: 66 }, gross: { amount: 396 }, vatRate: 0.2 },
        dietaries: {},
      } }],
    },
  } as never;
  const html = quoteHtml(booking);
  assert.match(html, /Chef labour/);
  assert.match(html, /2 staff × 5\.00 hrs × £22\.00 × 1\.5/);
  assert.doesNotMatch(html, /private-charge-id|new-booking-charge|New equipment/);
  assert.match(html, /£396\.00/);
});
