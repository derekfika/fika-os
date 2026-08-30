import assert from "node:assert/strict";
import test from "node:test";
import { quoteHtml } from "../lib/quote-document";

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
