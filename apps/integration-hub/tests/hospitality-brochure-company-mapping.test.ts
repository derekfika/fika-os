import assert from "node:assert/strict";
import test from "node:test";
import { buildMnkCanonicalBooking, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import { classifyHospitalityLine } from "../lib/hospitality-cpu-routing";
import type { CanonicalRecord } from "../lib/types";

// The company Menu Item for the Deli Style Sandwich Lunch. Its governed mapping to the CFC and Munich RE brochure rows is
// catalogue data that must be created through the Hub catalogue process; these fixtures only model that governed state.
const SANDWICH = "hospitality-menu-item:mnk:deli_sandwich_lunch";
const company = (mappings: Array<{ provider: string; sourceItemId: string }>, overrides: Record<string, unknown> = {}): CanonicalRecord => ({
  canonicalId: SANDWICH,
  entityType: "Hospitality Menu Item",
  lifecycleStatus: "published",
  publicationStatus: "published",
  dataHash: "fixture",
  record: {
    name: "Deli Style Sandwich Lunch",
    category: "Lunch",
    unitPrice: 9,
    minimumQuantity: 8,
    lifecycleState: "active",
    optionGroups: [],
    configuration: { servingInfo: "Per person" },
    providerMappings: [
      { provider: "mnk-booking-platform", sourceItemId: "deli_sandwich_lunch" },
      ...mappings,
    ],
    ...overrides,
  },
} as unknown as CanonicalRecord);

const brochure = (site: "cfc" | "munich-re") => site === "cfc"
  ? { provider: "cfc-hospitality-brochure", sourceItemId: "deli-sandwich-lunch" }
  : { provider: "munich-re-generic-brochure", sourceItemId: "deli-sandwich-lunch" };
const siteLabel = { cfc: "CFC", "munich-re": "Munich RE" } as const;

const payloadFor = (site: "cfc" | "munich-re", itemId: string, quantity: number, guests = 10): MnkBookingPayload => ({
  bookingId: `TEST-${site}-${itemId}-${quantity}`,
  submittedAt: "2026-10-27T10:00:00.000Z",
  site: siteLabel[site],
  siteId: site,
  client: { name: "Host", email: "host@example.com", companyName: "Client" },
  event: { eventDate: "2026-11-10", startTime: "12:00", guestCount: guests },
  order: {
    eventType: "lunch",
    items: [{ itemId, itemName: "Deli Style Sandwich Lunch", servingInfo: "3 pieces per person", unitPrice: 9, quantity, lineTotal: 9 * quantity }],
    netTotal: 9 * quantity,
  },
} as unknown as MnkBookingPayload);

for (const site of ["cfc", "munich-re"] as const) {
  test(`${siteLabel[site]}: a governed sandwich mapping prices at the company £9 and applies the site minimum (CFC 8, Munich RE 5 via the contextual override)`, () => {
    const records = [company([brochure(site)])];
    const order = trustedPublicOrder(payloadFor(site, "deli-sandwich-lunch", 8), records, site);
    assert.equal(order.items[0].unitPrice, 9);
    assert.equal(order.netTotal, 72);
    assert.throws(() => buildMnkCanonicalBooking(payloadFor(site, "deli-sandwich-lunch", 1), records, "2026-10-27T10:00:00.000Z"), site === "munich-re" ? /requires at least 5/ : /requires at least 8/);
  });

  test(`${siteLabel[site]}: the mapped sandwich routes to CPU Sandwiches through the company routing record`, () => {
    const records = [company([brochure(site)])];
    const booking = buildMnkCanonicalBooking(payloadFor(site, "deli-sandwich-lunch", 8), records, "2026-10-27T10:00:00.000Z").booking as unknown as { order: { items: Array<{ menuItemId?: string }> } };
    assert.equal(booking.order.items[0].menuItemId, SANDWICH);
    const routed = classifyHospitalityLine({ itemId: "deli-sandwich-lunch", menuItemId: SANDWICH }, site, { [SANDWICH]: ["sandwiches"] });
    assert.equal(routed.state, "cpu_sandwiches");
  });

  test(`${siteLabel[site]}: the company canonical ID is accepted once mapped, and quantity is never taken from the browser`, () => {
    const records = [company([brochure(site)])];
    const order = trustedPublicOrder({ ...payloadFor(site, SANDWICH, 8), order: { ...payloadFor(site, SANDWICH, 8).order, items: [{ ...payloadFor(site, SANDWICH, 8).order.items[0], unitPrice: 0.01, lineTotal: 0.08 }], netTotal: 0.08 } } as MnkBookingPayload, records, site);
    assert.equal(order.items[0].unitPrice, 9, "browser price is ignored");
    assert.equal(order.items[0].quantity, 8);
  });

  test(`${siteLabel[site]}: a retired company item is refused even when mapped`, () => {
    const retired = company([brochure(site)], { lifecycleState: "archived" });
    assert.throws(() => trustedPublicOrder(payloadFor(site, "deli-sandwich-lunch", 8), [retired], site), /no longer available/);
  });

  test(`${siteLabel[site]}: without a governed mapping the company sandwich is refused on this site, not guessed`, () => {
    // Without the governed mapping the Hub must not guess: the company item is not joined to this site.
    assert.throws(() => trustedPublicOrder(payloadFor(site, SANDWICH, 8), [company([])], site), /not mapped/);
  });
}

test("cross-site isolation: a CFC mapping never lets Munich RE accept the same brochure row, and an MNK-only item is refused on CFC", () => {
  const cfcOnly = [company([brochure("cfc")])];
  assert.throws(() => trustedPublicOrder(payloadFor("munich-re", SANDWICH, 8), cfcOnly, "munich-re"), /not mapped/);
  const mnkOnly = [company([])];
  assert.throws(() => trustedPublicOrder(payloadFor("cfc", SANDWICH, 8), mnkOnly, "cfc"), /not mapped/);
});

test("regression: unmapped brochure items keep the current brochure behaviour, including text minimums", () => {
  const breakfastPots = { ...payloadFor("cfc", "breakfast-pots", 1), order: { eventType: "lunch", items: [{ itemId: "breakfast-pots", itemName: "Breakfast Pots", servingInfo: "Per pot; minimum 12 per item", unitPrice: 3.95, quantity: 1, lineTotal: 3.95 }], netTotal: 3.95 } } as unknown as MnkBookingPayload;
  assert.throws(() => buildMnkCanonicalBooking(breakfastPots, [], "2026-10-27T10:00:00.000Z"), /requires at least 12/);
});
