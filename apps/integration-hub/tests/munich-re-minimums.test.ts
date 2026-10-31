import assert from "node:assert/strict";
import test from "node:test";
import { catalogueMinimums, effectiveProductMinimum, validateCatalogueRules, type RuleItem } from "@fika/server-shared/hospitality-effective-offering";
import { buildMnkCanonicalBooking, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import { isGallagherBooking } from "../lib/gallagher-rules";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import type { CanonicalRecord } from "../lib/types";

const ordinary = { gallagher: false, siteId: "angel-court" };
const gallagherAtOac = { gallagher: true, siteId: "angel-court" };
const munichRe = { gallagher: false, siteId: "munich-re" };

test("standard minimum 8: ordinary One Angel Court keeps 8; Gallagher and Munich RE resolve 5; other sites unchanged", () => {
  assert.equal(effectiveProductMinimum(8, ordinary), 8);
  assert.equal(effectiveProductMinimum(8, gallagherAtOac), 5);
  assert.equal(effectiveProductMinimum(8, munichRe), 5);
  for (const siteId of ["mnk", "cfc", "rcoa", undefined, null]) assert.equal(effectiveProductMinimum(8, { gallagher: false, siteId }), 8);
  assert.equal(effectiveProductMinimum(8, true), 5, "the legacy boolean form still means Gallagher");
});

test("genuine product minimums, fixed pack sizes and smaller minimums survive the Munich RE override", () => {
  for (const minimum of [1, 3, 4, 5, 10, 12, 20, 30]) assert.equal(effectiveProductMinimum(minimum, munichRe), minimum);
  assert.equal(effectiveProductMinimum(undefined, munichRe), 1);
  // Established Gallagher behaviour is unchanged: it caps any product minimum above 5.
  assert.equal(effectiveProductMinimum(12, gallagherAtOac), 5);
  assert.equal(effectiveProductMinimum(3, gallagherAtOac), 3);
  assert.equal(effectiveProductMinimum(8, { gallagher: true, siteId: "munich-re" }), 5);
});

test("Gallagher Re company names and look-alikes never receive the Gallagher override", () => {
  assert.equal(isGallagherBooking({ companyName: "Gallagher Re", email: "x@example.com" }), false);
  assert.equal(effectiveProductMinimum(8, { gallagher: isGallagherBooking({ companyName: "Gallagher Re", email: "x@example.com" }), siteId: "angel-court" }), 8);
  assert.equal(effectiveProductMinimum(8, { gallagher: isGallagherBooking({ companyName: "Gallagher", email: "x@example.com" }), siteId: "angel-court" }), 5);
  assert.equal(effectiveProductMinimum(8, { gallagher: isGallagherBooking({ companyName: "Other", email: "a@redington.co.uk" }), siteId: "angel-court" }), 5);
});

const item: RuleItem = { id: "item:deli", name: "Deli Style Sandwich Lunch", minimumQuantity: 8 };
const context = { guestCount: 20, eventDate: "2026-11-16", startTime: "12:00", now: "2026-10-29T07:00:00Z" };
const reject = (quantity: number, gallagher: boolean, siteId: string) => () => validateCatalogueRules([item], [{ itemId: item.id, quantity }], { ...context, gallagher, siteId });

test("shared validation: 7 rejected / 8 accepted (OAC), 4 rejected / 5 accepted (Gallagher, Munich RE)", () => {
  assert.throws(reject(7, false, "angel-court"), /at least 8/);
  assert.doesNotThrow(reject(8, false, "angel-court"));
  assert.throws(reject(4, true, "angel-court"), /at least 5/);
  assert.doesNotThrow(reject(5, true, "angel-court"));
  assert.throws(reject(4, false, "munich-re"), /at least 5/);
  assert.doesNotThrow(reject(5, false, "munich-re"));
  assert.throws(reject(7, false, "cfc"), /at least 8/);
  assert.equal(catalogueMinimums(item, munichRe).quantity, 5);
  assert.equal(item.minimumQuantity, 8, "the canonical item is never mutated");
});

// Hub enforcement uses the same governed-company-item fixture as the CFC/Munich RE mapping regression tests.
const SANDWICH = "hospitality-menu-item:mnk:deli_sandwich_lunch";
const company = (provider: string): CanonicalRecord => ({
  canonicalId: SANDWICH, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "fixture",
  record: { name: "Deli Style Sandwich Lunch", category: "Lunch", unitPrice: 9, minimumQuantity: 8, lifecycleState: "active", optionGroups: [], configuration: { servingInfo: "Per person" },
    providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "deli_sandwich_lunch" }, { provider, sourceItemId: "deli-sandwich-lunch" }] },
} as unknown as CanonicalRecord);
const labels: Record<string, string> = { "munich-re": "Munich RE", cfc: "CFC" };
const payloadFor = (site: "cfc" | "munich-re", quantity: number, companyName = "Client"): MnkBookingPayload => ({
  bookingId: `MIN-${site}-${quantity}-${companyName}`, submittedAt: "2026-10-29T10:00:00.000Z", site: labels[site], siteId: site,
  client: { name: "Host", email: "host@example.com", companyName },
  event: { eventDate: "2026-11-16", startTime: "12:00", guestCount: 10 },
  order: { eventType: "lunch", items: [{ itemId: "deli-sandwich-lunch", itemName: "Deli Style Sandwich Lunch", servingInfo: "3 pieces per person", unitPrice: 9, quantity, lineTotal: 9 * quantity }], netTotal: 9 * quantity },
} as unknown as MnkBookingPayload);
const at = "2026-10-29T10:00:00.000Z";

test("Hub ingestion: Munich RE accepts 5 and rejects 4 for a standard-minimum item; CFC keeps 8", () => {
  const mr = [company("munich-re-generic-brochure")];
  assert.throws(() => buildMnkCanonicalBooking(payloadFor("munich-re", 4), mr, at), /requires at least 5/);
  const booking = buildMnkCanonicalBooking(payloadFor("munich-re", 5), mr, at).booking as unknown as { order: { items: Array<{ quantity: number }> } };
  assert.equal(booking.order.items[0].quantity, 5, "the persisted quantity is the ordered quantity");
  const cfc = [company("cfc-hospitality-brochure")];
  assert.throws(() => buildMnkCanonicalBooking(payloadFor("cfc", 7), cfc, at), /requires at least 8/);
  assert.doesNotThrow(() => buildMnkCanonicalBooking(payloadFor("cfc", 8), cfc, at));
  // Gallagher Re is not Gallagher: it keeps the CFC minimum of 8.
  assert.throws(() => buildMnkCanonicalBooking(payloadFor("cfc", 5, "Gallagher Re"), cfc, at), /requires at least 8/);
});

test("Hub price trust: the Munich RE minimum is enforced on the trusted-order path and does not leak to CFC", () => {
  const mr = [company("munich-re-generic-brochure")];
  assert.equal(trustedPublicOrder(payloadFor("munich-re", 5), mr, "munich-re").items[0].quantity, 5);
});
