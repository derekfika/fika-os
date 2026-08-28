import assert from "node:assert/strict";
import test from "node:test";
import { buildMnkCanonicalBooking, canonicalBookingId, ingestMnkBookingFromExisting, menuForMnkPortal, resolveHospitalityDestinationOploc } from "../lib/hospitality-booking-service";
import type { CanonicalRecord } from "../lib/types";
import { isGallagherBooking } from "../lib/gallagher-rules";

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
test("all portal payloads preserve portal identity separately from governed OPLOC identity", () => {
  const providers = {
    mnk: "mnk-booking-platform",
    "angel-court": "angel-court-hospitality-brochure",
    cfc: "cfc-hospitality-brochure",
    "munich-re": "munich-re-generic-brochure",
  } as const;
  for (const [siteId, provider] of Object.entries(providers)) {
    const record = menu();
    record.record.providerMappings = [{ provider, sourceItemId: "portal-item" }];
    const result = buildMnkCanonicalBooking({
      ...payload,
      bookingId: `PORTAL-${siteId}`,
      siteId,
      site: siteId,
      order: { ...payload.order, items: [{ ...payload.order.items[0], itemId: "portal-item" }] },
    }, [record]);
    assert.equal(result.booking.service.portalSiteId, siteId);
    assert.equal(result.booking.service.oplocId, undefined);
  }
});
test("a legacy canonical OPLOC payload cannot switch MNK out of strict provider mode", () => {
  const legacyPayload = { ...payload, siteId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f", order: { ...payload.order, items: [{ ...payload.order.items[0], itemId: "unmapped-item" }] } };
  assert.throws(() => buildMnkCanonicalBooking(legacyPayload, [menu()]), /not mapped/);
});
test("canonical booking ID is deterministic across retry payloads", () => { assert.equal(canonicalBookingId("MNK-ONE"), canonicalBookingId("MNK-ONE")); });
test("governed Hospitality site mapping supplies the canonical destination OPLOC", () => {
  const records: CanonicalRecord[] = [{ canonicalId: "oploc:mnk", entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "x", record: { lifecycleState: "active" } }];
  const mappings = [{ sourceIdentifier: "mnk", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: "oploc:mnk" }];
  assert.equal(resolveHospitalityDestinationOploc({ siteId: "mnk" }, mappings, records), "oploc:mnk");
  const result = buildMnkCanonicalBooking(payload, [menu()], "2026-07-30T10:01:00.000Z");
  result.booking.service.oplocId = "oploc:mnk";
  assert.equal(result.booking.service.oplocId, "oploc:mnk");
  assert.equal(result.booking.service.roomOrArea, undefined);
});
test("unmapped delivery site cannot be resolved from customer-facing labels", () => {
  const records: CanonicalRecord[] = [{ canonicalId: "oploc:mnk", entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "x", record: { lifecycleState: "active" } }];
  assert.equal(resolveHospitalityDestinationOploc({ siteId: "unknown" }, [{ sourceIdentifier: "MNK", mappingStatus: "confirmed", oplocId: "oploc:mnk" }], records), undefined);
});
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
test("Gallagher detection accepts a normalised company name or a Redington email domain", () => {
  assert.equal(isGallagherBooking({ companyName: " Gallagher ", email: "other@example.com" }), true);
  assert.equal(isGallagherBooking({ companyName: "Another client", email: "frontofhouse@redington.co.uk" }), true);
  assert.equal(isGallagherBooking({ companyName: "Gallagher-ish", email: "other@example.com" }), false);
});
test("Gallagher bookings require five guests and an invoice reference", () => {
  const gallagher = { ...payload, bookingId: "GALLAGHER-FOUR", client: { ...payload.client, companyName: "Gallagher", invoiceReference: "PO-123" }, event: { ...payload.event, guestCount: 4 } };
  assert.throws(() => buildMnkCanonicalBooking(gallagher, [menu()]), /at least 5 guests/);
  const missingReference = { ...gallagher, bookingId: "GALLAGHER-NO-REF", event: { ...payload.event, guestCount: 5 }, client: { ...gallagher.client, invoiceReference: undefined } };
  assert.throws(() => buildMnkCanonicalBooking(missingReference, [menu()]), /Invoice \/ PO reference/);
});
test("Gallagher product minimums are capped at five without changing smaller minimums", () => {
  const minimumMenu = menu();
  minimumMenu.record.minimumQuantity = 8;
  const gallagher = { ...payload, bookingId: "GALLAGHER-MINIMUM", client: { ...payload.client, companyName: "Gallagher", invoiceReference: "INV-5" }, event: { ...payload.event, guestCount: 5 }, order: { ...payload.order, items: [{ ...payload.order.items[0], quantity: 5, lineTotal: 60 }] } };
  assert.equal(buildMnkCanonicalBooking(gallagher, [minimumMenu]).booking.order.items[0].quantity, 5);
});
