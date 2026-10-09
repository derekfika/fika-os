import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../fixtures/mnk-legacy-menu-import.candidates.json";
import { hospitalityPortalReadFromRecords } from "../lib/hospitality-catalogue-service";
import { loadMnkBookingCatalogue, mnkBookingPricingRecords } from "../lib/mnk-booking-catalogue";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import { buildMnkCanonicalBooking, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import type { CanonicalRecord } from "../lib/types";
import { hospitalityMenuDate } from "../../shared/hospitality-menu-date";

const records = [...fixture.items, ...fixture.offerings, ...fixture.prices].map(record => ({ canonicalId: record.canonicalId, entityType: record.entityType, record, dataHash: "fixture", lifecycleStatus: "published", publicationStatus: "published" })) as CanonicalRecord[];
const request = { oplocId: fixture.configuration.oplocId, serviceDate: "2026-10-09" };
const payloadFor = (id: string, choices: unknown[] = []): MnkBookingPayload => ({ order: { items: [{ itemId: id, quantity: 3, unitPrice: .01, lineTotal: .01, choices }], netTotal: .01 } }) as MnkBookingPayload;

test("every orderable MNK offering shares numeric canonical pricing with strict ingestion; bogus client totals never win", () => {
  const portal = hospitalityPortalReadFromRecords(records, request);
  const pricing = mnkBookingPricingRecords(records, request);
  const orderable = portal.offerings.filter(offering => offering.offeringMode === "standard");
  assert.ok(orderable.length > 30);
  for (const offering of orderable) {
    const price = offering.price as { amount: number };
    assert.equal(typeof price.amount, "number");
    const configuration = offering.configuration as { choices?: Array<{ id: string; required?: boolean; options: Array<{ label: string }> }> } | undefined;
    const choices = (configuration?.choices || []).filter(group => group.required).map(group => ({ id: group.id, value: group.options[0].label }));
    const order = trustedPublicOrder(payloadFor(String(offering.itemId), choices), pricing, "mnk");
    assert.equal(order.items[0].unitPrice, price.amount);
    assert.equal(order.items[0].lineTotal, Math.round(price.amount * 3 * 100) / 100);
    assert.equal(order.netTotal, order.items[0].lineTotal);
  }
});

test("unknown, retired, withdrawn, unpublished and ambiguous MNK authority fail closed", () => {
  const item = records.find(record => record.entityType === "Hospitality Menu Item" && record.record.name === "Bloom Filter Coffee")!;
  const offering = records.find(record => record.entityType === "Hospitality Menu Offering" && record.record.hospitalityMenuItemId === item.canonicalId)!;
  const price = records.find(record => record.entityType === "Hospitality Menu Price" && record.record.hospitalityMenuOfferingId === offering.canonicalId)!;
  const order = (catalogue: CanonicalRecord[], id = item.canonicalId) => trustedPublicOrder(payloadFor(id), mnkBookingPricingRecords(catalogue, request), "mnk");
  assert.throws(() => order(records, "unknown"));
  for (const target of [item, offering, price]) {
    const replacements: CanonicalRecord[] = [{ ...target, publicationStatus: "withdrawn" }, { ...target, lifecycleStatus: "draft" }, { ...target, record: { ...target.record, lifecycleState: "archived" } }];
    for (const replacement of replacements) {
      assert.throws(() => order(records.map(record => record === target ? replacement : record)));
    }
  }
  assert.throws(() => order([...records, { ...price, canonicalId: "hospitality-menu-price:duplicate" }]));
  assert.throws(() => order([...records, { ...item, canonicalId: "hospitality-menu-item:duplicate" }], "bloom_filter_coffee"));
  assert.throws(() => order([...records, { ...offering, canonicalId: "hospitality-menu-offering:duplicate" }, { ...price, canonicalId: "hospitality-menu-price:duplicate", record: { ...price.record, hospitalityMenuOfferingId: "hospitality-menu-offering:duplicate" } }]));
  assert.throws(() => order(records.map(record => record === price ? { ...record, record: { ...record.record, amount: "3" } } : record)));
});

test("Offering options remain authoritative; retired Item.unitPrice cannot become a fallback", () => {
  const required = hospitalityPortalReadFromRecords(records, request).offerings.find(offering => (offering.configuration as { choices?: Array<{ required?: boolean }> })?.choices?.some(group => group.required) && offering.offeringMode === "standard")!;
  assert.throws(() => trustedPublicOrder(payloadFor(String(required.itemId)), mnkBookingPricingRecords(records, request), "mnk"));
  const itemsOnly = records.filter(record => record.entityType === "Hospitality Menu Item").map(record => ({ ...record, record: { ...record.record, unitPrice: 999 } }));
  assert.throws(() => trustedPublicOrder(payloadFor(String(required.itemId)), mnkBookingPricingRecords(itemsOnly, request), "mnk"));
});

test("catalogue relation reads are restricted to affected stable IDs and preserve historical data", async () => {
  const item = fixture.items.find(item => item.name === "Bloom Filter Coffee")!;
  const calls: Array<{ field: string; ids: string[] }> = [];
  const before = JSON.stringify(records);
  const loaded = await loadMnkBookingCatalogue(records.filter(record => record.entityType === "Hospitality Menu Item"), payloadFor(item.canonicalId), request.oplocId, async (field, ids) => {
    calls.push({ field, ids });
    return records.filter(record => ids.includes(String(record.record[field.replace("record.", "")])));
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].ids, [item.canonicalId]);
  assert.equal(calls[1].ids.length, 1);
  assert.equal(loaded.filter(record => record.entityType === "Hospitality Menu Price").length, 1);
  assert.equal(JSON.stringify(records), before);
});

test("portal and ingestion catalogue date follows UK midnight across BST/GMT", () => {
  assert.equal(hospitalityMenuDate(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
  assert.equal(hospitalityMenuDate(new Date("2026-12-01T23:30:00Z")), "2026-12-01");
  assert.equal(hospitalityMenuDate(new Date("2026-10-25T01:30:00Z")), "2026-10-25");
});

test("canonical MNK booking preserves identity, options and VAT while freezing the governed server price", () => {
  const item = fixture.items.find(item => item.name === "Bloom Filter Coffee")!;
  const pricing = mnkBookingPricingRecords(records, request);
  const payload = { ...payloadFor(item.canonicalId), bookingId: "UAT-MNK-PRICING", submittedAt: "2026-10-09T12:00:00Z", siteId: "mnk", site: "MNK", client: { name: "UAT", email: "uat@example.test", companyName: "UAT" }, event: { eventDate: "2026-11-03", startTime: "10:00", guestCount: 3 } };
  const result = buildMnkCanonicalBooking(payload, pricing, "2026-10-09T12:00:00Z").booking;
  assert.equal(result.order.items[0].unitPrice, 3);
  assert.equal(result.order.items[0].lineTotal, 9);
  assert.equal(result.order.netTotal, 9);
  assert.equal(result.order.vatTotal, 0);
  assert.equal(result.order.grossTotal, 9);
  assert.equal(result.order.items[0].menuItemId, item.canonicalId);
});
