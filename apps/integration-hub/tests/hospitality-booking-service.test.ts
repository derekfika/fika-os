import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertExpectedRcoaOploc, buildMnkCanonicalBooking, canonicalBookingId, ingestMnkBookingFromExisting, menuForMnkPortal, resolveHospitalityDestinationOploc } from "../lib/hospitality-booking-service";
import type { CanonicalRecord } from "../lib/types";
import { isGallagherBooking } from "../lib/gallagher-rules";
import { loadAngelCourtBookingCatalogue } from "../lib/mnk-booking-catalogue";

const bookingServiceSource = readFileSync(new URL("../lib/hospitality-booking-service.ts", import.meta.url), "utf8");

const menu = (state: "active" | "archived" = "active"): CanonicalRecord => ({ canonicalId: "hospitality-menu-item:abc12345", entityType: "Hospitality Menu Item", lifecycleStatus: "published", dataHash: "x", record: { lifecycleState: state, name: "Breakfast box", category: "Breakfast", unitPrice: 12, vatRate: .2, providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "breakfast_box" }], dietaryInformation: [], allergenInformation: [] } });
const payload = { bookingId: "MNK-ONE", submittedAt: "2026-07-30T10:00:00.000Z", site: "MNK", siteId: "mnk", client: { name: "Host", email: "host@example.com", companyName: "Client" }, event: { eventDate: "2026-08-10", startTime: "12:00", guestCount: 10 }, order: { eventType: "lunch", items: [{ itemId: "breakfast_box", unitPrice: 12, quantity: 2, lineTotal: 24 }], netTotal: 24 } };
test("active canonical menu mappings are exposed to the MNK portal", () => { const result = menuForMnkPortal([menu(), menu("archived")]); assert.equal(result.menu.length, 1); assert.equal(result.menu[0].id, "breakfast_box"); });
test("an MNK payload keeps its existing canonical ID and provider provenance", () => { const result = buildMnkCanonicalBooking(payload, [menu()], "2026-07-30T10:01:00.000Z"); assert.equal(result.booking.canonicalId, "booking:mnk:a60b2ecb2b226c4d56b61460830a38a6"); assert.equal(result.booking.canonicalId, canonicalBookingId("MNK-ONE")); assert.equal(result.booking.source.provider, "mnk-booking-platform"); assert.equal(result.booking.order.items[0].menuItemId, "hospitality-menu-item:abc12345"); assert.equal(result.booking.lifecycleStatus, "New"); assert.equal(result.booking.source.originalPayload.bookingId, "MNK-ONE"); });
test("inactive or unmapped menu items cannot enter a new canonical Booking", () => { assert.throws(() => buildMnkCanonicalBooking(payload, [menu("archived")])); });
test("site-scoped compatibility menus retain a booking snapshot while canonical mappings are being promoted", () => {
  const angelPayload = { ...payload, bookingId: "ANGEL-ONE", site: "Angel Court", siteId: "angel-court", order: { ...payload.order, items: [{ ...payload.order.items[0], itemId: "deli-style-sandwich", quantity: 10, unitPrice: 10.95, lineTotal: 10.95 }] } };
  const result = buildMnkCanonicalBooking(angelPayload, [menu()], "2026-07-30T10:01:00.000Z");
  assert.equal(result.booking.order.items[0].itemId, "deli-style-sandwich");
  assert.equal(result.booking.order.items[0].menuItemId, undefined);
  assert.ok(result.validationWarnings.some(warning => /site-scoped compatibility evidence/.test(warning)));
  assert.equal(result.booking.order.items[0].lineTotal, 109.5);
  assert.equal(result.booking.order.netTotal, 109.5);
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
    rcoa: "rcoa-hospitality-brochure",
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
test("RCoA requests have deterministic RCoA identity and source provenance", () => {
  const rcoaMenu = menu();
  rcoaMenu.record.providerMappings = [{ provider: "rcoa-hospitality-brochure", sourceItemId: "house_filter_coffee" }];
  const rcoaPayload = {
    ...payload,
    bookingId: "RCOA-20261005103000-AB12",
    site: "RCoA Hospitality",
    siteId: "rcoa",
    order: { ...payload.order, eventType: "breakfast", items: [{ itemId: "house_filter_coffee", itemName: "House Filter Coffee", category: "Drinks", unitPrice: 3, quantity: 2, lineTotal: 6 }] },
  };
  const result = buildMnkCanonicalBooking(rcoaPayload, [rcoaMenu], "2026-10-05T10:31:00.000Z");
  assert.equal(result.booking.source.sourceBookingId, rcoaPayload.bookingId);
  assert.equal(result.booking.source.originalPayload.siteId, "rcoa");
  assert.equal(result.booking.service.portalSiteId, "rcoa");
  assert.equal(result.booking.service.portalSiteLabel, "RCoA Hospitality");
  assert.equal(result.booking.order.items[0].menuItemId, rcoaMenu.canonicalId);
  assert.equal(result.booking.canonicalId, "booking:rcoa:914cffc5ac892755170676fbbb39da3f");
  assert.equal(result.booking.canonicalId, canonicalBookingId(rcoaPayload.bookingId, "rcoa"));
  assert.equal(result.booking.source.provider, "rcoa-booking-platform");
  assert.equal(result.booking.createdBy, "bridge:rcoa-booking-platform");
  assert.equal(result.booking.updatedBy, "bridge:rcoa-booking-platform");
  assert.match(result.booking.statusHistory[0].reason, /RCoA/);
  assert.equal(result.booking.statusHistory[0].changedBy, "bridge:rcoa-booking-platform");
  assert.match(result.booking.audit[0].reason, /RCoA/);
  assert.equal(result.booking.audit[0].by, "bridge:rcoa-booking-platform");
  const retry = ingestMnkBookingFromExisting(result.booking, rcoaPayload, []);
  assert.equal(retry.created, false);
  assert.equal(retry.booking.canonicalId, result.booking.canonicalId);
});
test("RCoA destination authority resolves only from the stable rcoa source key", () => {
  const records: CanonicalRecord[] = [{ canonicalId: "oploc:rcoa-confirmed", entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "x", record: { lifecycleState: "active" } }];
  const labelMapping = [{ sourceIdentifier: "Royal College of Anaesthetists", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: "oploc:rcoa-confirmed" }];
  const keyMapping = [{ sourceIdentifier: "rcoa", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: "oploc:rcoa-confirmed" }];
  const rcoaContext = { siteId: "rcoa", site: "Royal College of Anaesthetists" };
  assert.equal(resolveHospitalityDestinationOploc(rcoaContext, labelMapping, records), undefined);
  assert.equal(resolveHospitalityDestinationOploc(rcoaContext, keyMapping, records), "oploc:rcoa-confirmed");
  assert.equal(resolveHospitalityDestinationOploc({ site: "RCoA" }, keyMapping, records), undefined);
});
test("RCoA expected OPLOC must match its unique confirmed mapping and active canonical destination", () => {
  const expected = "oploc:rcoa-confirmed";
  assert.equal(assertExpectedRcoaOploc(expected, expected, expected), expected);
  assert.throws(() => assertExpectedRcoaOploc(expected, "oploc:other"), /configuration mismatch/);
  assert.throws(() => assertExpectedRcoaOploc(undefined, expected), /FIKA_RCOA_OPLOC_ID is not configured/);
  assert.throws(() => assertExpectedRcoaOploc(expected, undefined), /confirmed Hub provider-location mapping/);
  assert.throws(() => assertExpectedRcoaOploc(expected, expected, undefined), /not an active canonical destination/);
});
test("RCoA OPLOC equality guard runs before all booking, audit and notification transaction writes", () => {
  const start = bookingServiceSource.indexOf("export async function ingestMnkBooking(");
  const end = bookingServiceSource.indexOf("export async function notifyBookingConfirmedForProductionOrder(", start);
  const ingestion = bookingServiceSource.slice(start, end);
  const destinationGuard = ingestion.indexOf("if (isRcoa) assertExpectedRcoaOploc(expectedRcoaOplocId, destinationId, destinationOplocId);");
  const firstWrite = ingestion.indexOf("transaction.create(");
  assert.ok(start >= 0 && end > start);
  assert.ok(destinationGuard >= 0);
  assert.ok(firstWrite > destinationGuard);
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
  minimumMenu.record.name = "Freshly Wrapped Rice Paper Rolls";
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
  assert.equal(isGallagherBooking({ companyName: "G A L L A G H E R", email: "other@example.com" }), true);
  assert.equal(isGallagherBooking({ companyName: "Another client", email: "frontofhouse@redington.co.uk" }), true);
  assert.equal(isGallagherBooking({ companyName: "Gallagher-ish", email: "other@example.com" }), false);
  assert.equal(isGallagherBooking({ companyName: "Another client", email: "@redington.co.uk" }), false);
  assert.equal(isGallagherBooking({ companyName: "Another client", email: " FRONT@REDINGTON.CO.UK " }), true);
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

const angelCatalogue = (itemMinimum = 4, offeringMinimum?: number, itemId = "hospitality-menu-item:angel-1", offeringMinimumGuests?: number): CanonicalRecord[] => [
  { canonicalId: itemId, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "item", record: { lifecycleState: "active", name: "Angel Court lunch box", category: "Food", unitPrice: 12, defaultMinimumQuantity: itemMinimum, defaultMinimumGuests: 2, defaultNoticeRequiredDays: 14, minimumQuantity: 1, minimumGuests: 1, noticeRequiredDays: 0, providerMappings: [{ provider: "angel-court-hospitality-brochure", sourceItemId: "angel-lunch" }], dietaryInformation: [], allergenInformation: [] } },
  { canonicalId: "hospitality-offering:angel-1", entityType: "Hospitality Menu Offering", lifecycleStatus: "published", publicationStatus: "published", dataHash: "offering", record: { lifecycleState: "active", hospitalityMenuItemId: itemId, oplocId: "oploc:angel-court", offeringMode: "standard", ...(offeringMinimum !== undefined ? { minimumQuantity: offeringMinimum } : {}), ...(offeringMinimumGuests !== undefined ? { minimumGuests: offeringMinimumGuests } : {}) } },
  { canonicalId: "hospitality-price:angel-1", entityType: "Hospitality Menu Price", lifecycleStatus: "published", publicationStatus: "published", dataHash: "price", record: { lifecycleState: "active", hospitalityMenuItemId: itemId, amount: 12, vatRate: 0.2, effectiveFrom: "2025-01-01" } },
  { canonicalId: "oploc:angel-court", entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "oploc", record: { lifecycleState: "active", approvedName: "Angel Court" } },
];
const angelPayload = (quantity: number, overrides: Record<string, unknown> = {}) => ({
  ...payload,
  ...overrides,
  bookingId: `ANGEL-INGEST-${quantity}-${String(overrides.bookingId || "case")}`,
  site: "Angel Court",
  siteId: "angel-court",
  client: { ...payload.client, companyName: "Ordinary customer", ...(overrides.client as object || {}) },
  event: { ...payload.event, eventDate: "2026-11-03", guestCount: 10, ...(overrides.event as object || {}) },
  order: { ...payload.order, items: [{ itemId: "angel-lunch", itemName: "Angel Court lunch box", quantity, unitPrice: 0.01, lineTotal: 0.01, minimumQuantity: 1 }], netTotal: 0.01 },
}) as unknown as typeof payload;
const ingestAngel = async (quantity: number, records = angelCatalogue(), overrides: Record<string, unknown> = {}) => {
  const submission = angelPayload(quantity, overrides);
  const loaded = await loadAngelCourtBookingCatalogue(records.filter(record => record.entityType === "Hospitality Menu Item"), submission, "oploc:angel-court", async (field, ids) => records.filter(record => ids.includes(String(field === "canonicalId" ? record.canonicalId : record.record[field.replace("record.", "")]))));
  return ingestMnkBookingFromExisting(undefined, submission, loaded, "2026-10-18T12:00:00.000Z", "oploc:angel-court");
};

test("Angel Court public Hub ingestion rejects below the Item default, ignores stale/client minimums, and accepts the Item default", async () => {
  await assert.rejects(() => ingestAngel(1), /requires at least 4 boxes/);
  const accepted = await ingestAngel(4);
  assert.equal(accepted.booking.order.items[0].quantity, 4);
  assert.equal(accepted.booking.order.items[0].unitPrice, 12, "Angel Court keeps its existing server-owned brochure price calculation");
  assert.equal(accepted.booking.order.items[0].lineTotal, 48);
});

test("Angel Court public Hub ingestion uses Offering minimum overrides over Item defaults", async () => {
  await assert.rejects(() => ingestAngel(4, angelCatalogue(4, 6)), /requires at least 6 boxes/);
  assert.equal((await ingestAngel(6, angelCatalogue(4, 6))).booking.order.items[0].quantity, 6);
});

test("Angel Court applies the effective Offering minimum guest constraint", async () => {
  const records = angelCatalogue(4, undefined, undefined, 6);
  await assert.rejects(() => ingestAngel(4, records, { event: { guestCount: 5 } }), /requires at least 6 guests/);
  assert.equal((await ingestAngel(4, records, { event: { guestCount: 6 } })).booking.order.items[0].quantity, 4);
});

test("Angel Court resolves governed minimum before applying the Gallagher cap; ordinary customers keep the full minimum", async () => {
  const records = angelCatalogue(4, 8);
  const gallagher = { client: { companyName: "Gallagher", invoiceReference: "PO-123" } };
  assert.equal((await ingestAngel(5, records, gallagher)).booking.order.items[0].quantity, 5);
  await assert.rejects(() => ingestAngel(5, records), /requires at least 8 boxes/);
  await assert.rejects(() => ingestAngel(5, records, { event: { guestCount: 4 }, ...gallagher }), /at least 5 guests/);
  await assert.rejects(() => ingestAngel(5, records, { client: { companyName: "Gallagher" } }), /Invoice \/ PO reference/);
});

test("Angel Court notice remains guidance and other supported-site validation paths stay distinct", async () => {
  assert.equal((await ingestAngel(4, angelCatalogue(), { event: { eventDate: "2026-10-19" } })).booking.order.items[0].quantity, 4);
  const cfcMenu = menu();
  cfcMenu.record.minimumQuantity = 3;
  cfcMenu.record.providerMappings = [{ provider: "cfc-hospitality-brochure", sourceItemId: "cfc-box" }];
  const otherSite = { ...payload, bookingId: "CFC-UNCHANGED", site: "CFC", siteId: "cfc", order: { ...payload.order, items: [{ ...payload.order.items[0], itemId: "cfc-box", quantity: 1 }] } };
  assert.throws(() => ingestMnkBookingFromExisting(undefined, otherSite, [cfcMenu]), /requires at least 3 boxes/);
});
