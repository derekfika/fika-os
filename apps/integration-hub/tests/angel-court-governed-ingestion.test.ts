import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../fixtures/mnk-legacy-menu-import.candidates.json";
import { angelCourtBookingConstraintRecords, mnkBookingPricingRecords } from "../lib/mnk-booking-catalogue";
import { ingestMnkBookingFromExisting, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import { hospitalityMenuDate } from "../../shared/hospitality-menu-date";
import type { CanonicalRecord } from "../lib/types";

// The governed relations (Items, sparse site Offerings, Prices) are resolved per OPLOC; the fixture OPLOC stands in for the Angel Court destination.
const records = [...fixture.items, ...fixture.offerings, ...fixture.prices].map(record => ({ canonicalId: record.canonicalId, entityType: record.entityType, record, dataHash: "fixture", lifecycleStatus: "published", publicationStatus: "published" })) as CanonicalRecord[];
const ANGEL_COURT_OPLOC = fixture.configuration.oplocId;
const NOW = "2026-10-18T12:00:00.000Z";
const price = (item: CanonicalRecord) => mnkBookingPricingRecords(records, { oplocId: ANGEL_COURT_OPLOC, serviceDate: hospitalityMenuDate(new Date(NOW)) }).find(record => record.canonicalId === item.canonicalId)!.record;

const orderable = records.filter(record => record.entityType === "Hospitality Menu Item" && record.record.lifecycleState === "active" && typeof price(record).unitPrice === "number"
  && !(price(record).optionGroups as Array<{ required?: boolean }> | undefined)?.some(group => group.required));
const simple = orderable.find(record => !price(record).minimumQuantity || Number(price(record).minimumQuantity) <= 1)!;
const constrained = orderable.find(record => Number(price(record).minimumQuantity) > 1);

const payloadFor = (itemId: string, quantity: number, bookingId = "UAT-AC-GOV"): MnkBookingPayload => ({
  bookingId, submittedAt: NOW, siteId: "angel-court", site: "Angel Court",
  client: { name: "UAT-20261018 Client", email: "uat-20261018@example.invalid", companyName: "UAT-20261018 Angel Court 01" },
  event: { eventDate: "2026-12-01", startTime: "10:00", guestCount: 40 },
  // Client-supplied prices must never win.
  order: { items: [{ itemId, quantity, unitPrice: 0.01, lineTotal: 0.01 }], netTotal: 0.01 },
}) as MnkBookingPayload;
const ingest = (payload: MnkBookingPayload, catalogue = records, oploc = ANGEL_COURT_OPLOC) => ingestMnkBookingFromExisting(undefined, payload, catalogue, NOW, oploc);

test("Angel Court accepts a governed catalogue Item by its canonical ID and prices it from the effective Offering, ignoring client prices", () => {
  const governedPrice = Number(price(simple).unitPrice);
  const quantity = Math.max(2, Number(price(simple).minimumQuantity || 1));
  const { booking } = ingest(payloadFor(simple.canonicalId, quantity));
  assert.equal(booking.order.items[0].menuItemId, simple.canonicalId);
  assert.equal(booking.order.items[0].unitPrice, governedPrice);
  assert.equal(booking.order.items[0].lineTotal, Math.round(governedPrice * quantity * 100) / 100);
  assert.equal(booking.order.netTotal, booking.order.items[0].lineTotal);
  assert.equal(booking.service.oplocId, ANGEL_COURT_OPLOC);
});

test("governed Angel Court minimums apply: below the Offering minimum is rejected, at the minimum is accepted", () => {
  assert.ok(constrained, "the fixture must contain an Item with a governed minimum quantity above one");
  const minimum = Number(price(constrained!).minimumQuantity);
  assert.throws(() => ingest(payloadFor(constrained!.canonicalId, minimum - 1)), /requires at least/);
  assert.equal(ingest(payloadFor(constrained!.canonicalId, minimum)).booking.order.items[0].quantity, minimum);
});

test("an Item with no effective Offering at the Angel Court destination, or an unknown Item, is still refused", () => {
  assert.throws(() => ingest(payloadFor(simple.canonicalId, 2), records, "oploc:some-other-site"), /not mapped|no longer|catalogue/i);
  assert.throws(() => ingest(payloadFor("hospitality-menu-item:does-not-exist", 2)), /not mapped|catalogue/i);
});

test("archived, withdrawn or unpublished governed Items cannot enter an Angel Court booking", () => {
  for (const change of [{ lifecycleStatus: "archived" }, { publicationStatus: "withdrawn" }, { record: { ...simple.record, lifecycleState: "archived" } }] as Array<Partial<CanonicalRecord>>) {
    const catalogue = records.map(record => record === simple ? { ...record, ...change } : record);
    assert.throws(() => ingest(payloadFor(simple.canonicalId, 2), catalogue), /not mapped|no longer|catalogue/i);
  }
});

test("only submitted governed Items are rewritten; other records are returned unchanged", () => {
  const resolved = angelCourtBookingConstraintRecords(records, payloadFor(simple.canonicalId, 2), ANGEL_COURT_OPLOC, NOW);
  assert.equal(resolved.length, records.length);
  const untouched = records.filter(record => record !== simple);
  for (const record of untouched) assert.equal(resolved[records.indexOf(record)], record);
  const mappings = (resolved[records.indexOf(simple)].record.providerMappings as Array<{ provider: string }>).map(mapping => mapping.provider);
  assert.ok(mappings.includes("angel-court-hospitality-brochure"));
});

test("a payload that submits only legacy brochure IDs leaves the catalogue records untouched", () => {
  const resolved = angelCourtBookingConstraintRecords(records, payloadFor("deli-style-sandwich", 10), ANGEL_COURT_OPLOC, NOW);
  assert.equal(resolved, records);
});
