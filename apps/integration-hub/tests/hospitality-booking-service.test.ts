import assert from "node:assert/strict";
import test from "node:test";
import { buildMnkCanonicalBooking, canonicalBookingId, ingestMnkBookingFromExisting, menuForMnkPortal } from "../lib/hospitality-booking-service";
import type { CanonicalRecord } from "../lib/types";

const menu = (state: "active" | "archived" = "active"): CanonicalRecord => ({ canonicalId: "hospitality-menu-item:abc12345", entityType: "Hospitality Menu Item", lifecycleStatus: "published", dataHash: "x", record: { lifecycleState: state, name: "Breakfast box", category: "Breakfast", unitPrice: 12, vatRate: .2, providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "breakfast_box" }], dietaryInformation: [], allergenInformation: [] } });
const payload = { bookingId: "MNK-ONE", submittedAt: "2026-07-30T10:00:00.000Z", site: "MNK", siteId: "mnk", client: { name: "Host", email: "host@example.com", companyName: "Client" }, event: { eventDate: "2026-08-10", startTime: "12:00", guestCount: 10 }, order: { eventType: "lunch", items: [{ itemId: "breakfast_box", unitPrice: 12, quantity: 2, lineTotal: 24 }], netTotal: 24 } };
test("active canonical menu mappings are exposed to the MNK portal", () => { const result = menuForMnkPortal([menu(), menu("archived")]); assert.equal(result.menu.length, 1); assert.equal(result.menu[0].id, "breakfast_box"); });
test("an MNK payload creates one stable canonical Booking with commercial snapshot and provenance", () => { const result = buildMnkCanonicalBooking(payload, [menu()], "2026-07-30T10:01:00.000Z"); assert.equal(result.booking.canonicalId, canonicalBookingId("MNK-ONE")); assert.equal(result.booking.order.items[0].menuItemId, "hospitality-menu-item:abc12345"); assert.equal(result.booking.lifecycleStatus, "New"); assert.equal(result.booking.source.originalPayload.bookingId, "MNK-ONE"); });
test("inactive or unmapped menu items cannot enter a new canonical Booking", () => { assert.throws(() => buildMnkCanonicalBooking(payload, [menu("archived")])); });
test("site-scoped compatibility menus retain a booking snapshot while canonical mappings are being promoted", () => {
  const angelPayload = { ...payload, bookingId: "ANGEL-ONE", site: "Angel Court", siteId: "angel-court", order: { ...payload.order, items: [{ ...payload.order.items[0], itemId: "deli-style-sandwich", unitPrice: 10.95, lineTotal: 10.95 }] } };
  const result = buildMnkCanonicalBooking(angelPayload, [menu()], "2026-07-30T10:01:00.000Z");
  assert.equal(result.booking.order.items[0].itemId, "deli-style-sandwich");
  assert.equal(result.booking.order.items[0].menuItemId, undefined);
  assert.match(result.validationWarnings[0], /site-scoped compatibility evidence/);
});

test("site-scoped canonical mappings are used once a portal catalogue is promoted", () => {
  const angelPayload = { ...payload, bookingId: "ANGEL-MAPPED", site: "Angel Court", siteId: "angel-court", order: { ...payload.order, items: [{ ...payload.order.items[0], itemId: "deli-style-sandwich" }] } };
  const angelMenu = menu("active");
  angelMenu.canonicalId = "hospitality-menu-item:angel-court:deli-style-sandwich";
  angelMenu.record.providerMappings = [{ provider: "angel-court-hospitality-brochure", sourceItemId: "deli-style-sandwich" }];
  const result = buildMnkCanonicalBooking(angelPayload, [angelMenu]);
  assert.equal(result.booking.order.items[0].menuItemId, angelMenu.canonicalId);
  assert.equal(result.validationWarnings.length, 0);
});
test("canonical booking ID is deterministic across retry payloads", () => { assert.equal(canonicalBookingId("MNK-ONE"), canonicalBookingId("MNK-ONE")); });
test("a retry returns the existing canonical Booking rather than creating a duplicate", () => { const first = buildMnkCanonicalBooking(payload, [menu()]).booking; const retry = ingestMnkBookingFromExisting(first, payload, [menu()]); assert.equal(retry.created, false); assert.equal(retry.booking.canonicalId, first.canonicalId); });
test("canonical booking ingestion enforces a three-box minimum for governed summer rolls", () => {
  const minimumMenu = menu();
  minimumMenu.record.minimumQuantity = 3;
  const summerRollPayload = {
    ...payload,
    bookingId: "MNK-SUMMER-ROLLS",
    order: {
      ...payload.order,
      items: [{ ...payload.order.items[0], itemName: "Freshly Wrapped Rice Paper Rolls", quantity: 1 }],
    },
  };
  assert.throws(
    () => buildMnkCanonicalBooking(summerRollPayload, [minimumMenu]),
    /Freshly Wrapped Rice Paper Rolls requires at least 3 boxes/,
  );
});
