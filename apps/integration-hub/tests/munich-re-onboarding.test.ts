import assert from "node:assert/strict";
import test from "node:test";
import { hospitalityCatalogues, MUNICH_RE_LOCATIONS, munichReFormItems, munichReFormMapping, munichReLocationDisplay } from "@fika/server-shared/hospitality-catalogue";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import type { MnkBookingPayload } from "../lib/hospitality-booking-service";

const mr = hospitalityCatalogues["munich-re"];
const active = mr.items.filter((item) => item.lifecycleState === "active");
const byId = (id: string) => active.find((item) => item.source.sourceItemId === id)!;

test("Munich RE serves exactly the booking-form products with the form's prices", () => {
  assert.equal(active.length, munichReFormItems.length);
  assert.equal(active.length, 28);
  const price = (id: string) => byId(id).pricing.unitPrice;
  assert.deepEqual([price("mr-tea-coffee"), price("mr-tea-coffee-biscuits"), price("mr-canned-soft-drinks"), price("mr-cold-pressed-juice"), price("mr-jug-of-juice"), price("mr-seasonal-smoothie-jug")], [2.5, 3.5, 2.5, 4, 10, 22.5]);
  assert.deepEqual([price("mr-breakfast-pastries-platter"), price("mr-breakfast-bap-platter"), price("mr-premium-breakfast"), price("mr-fresh-fruit-bowl")], [20, 25, 25, 20]);
  assert.deepEqual([price("mr-rice-paper-rolls"), price("mr-deli-sandwich-platter"), price("mr-salad-protein-platter")], [45, 50, 70]);
  assert.deepEqual([price("mr-finger-food"), price("mr-light-table-lunch"), price("mr-garden-mezze")], [18.75, 150, 160]);
  assert.deepEqual([price("mr-afternoon-tea-platter"), price("mr-charcuterie-platter"), price("mr-bar-snack-platter"), price("mr-bottled-beer")], [150, 120, 25, 3.5]);
  assert.deepEqual([price("mr-champagne-devaux"), price("mr-sparkling-prosecco"), price("mr-white-macabeo"), price("mr-red-monastrell"), price("mr-rose-rosado")], [54, 24, 18, 18, 18]);
  assert.deepEqual([price("mr-dessert-pots-platter"), price("mr-loaf-cake-platter"), price("mr-traybake-bites-platter")], [25, 25, 25]);
});

test("serving sizes, choices and notice come from the form; the unpriced Flex water is never orderable", () => {
  assert.equal(byId("mr-light-table-lunch").orderingConstraints.serves, 10);
  assert.equal(byId("mr-deli-sandwich-platter").orderingConstraints.serves, 5);
  assert.deepEqual(byId("mr-deli-sandwich-platter").optionGroups[0].options.map((o) => o.label), ["Mixed", "Meat", "Veggie"]);
  assert.equal(byId("mr-finger-food").optionGroups[0].options.length, 10);
  assert.equal(byId("mr-rice-paper-rolls").optionGroups[0].options.length, 6);
  assert.equal(byId("mr-tea-coffee").orderingConstraints.noticeRequiredDays, 1, "tea/coffee 24 hours");
  assert.equal(byId("mr-finger-food").orderingConstraints.noticeRequiredDays, 3, "food 72 hours / 3 working days");
  assert.ok(!active.some((item) => /flex/i.test(item.source.sourceItemId)));
  for (const item of active) assert.ok(item.pricing.unitPrice > 0 && item.orderingConstraints.minimumQuantity === 1, `${item.name} carries no standard minimum of its own`);
});

test("the superseded CFC-derived brochure rows are retained as archived history and are refused for new bookings", () => {
  const archived = mr.items.filter((item) => item.lifecycleState === "archived");
  assert.equal(archived.length, 37);
  const payload = { bookingId: "MR-OLD", submittedAt: "2026-10-29T10:00:00.000Z", site: "Munich RE", siteId: "munich-re", client: { name: "H", email: "h@example.com", companyName: "C" }, event: { eventDate: "2026-11-16", startTime: "12:00", guestCount: 10 },
    order: { eventType: "lunch", items: [{ itemId: "deli-sandwich-lunch", itemName: "Deli", unitPrice: 9, quantity: 8, lineTotal: 72 }], netTotal: 72 } } as unknown as MnkBookingPayload;
  assert.throws(() => trustedPublicOrder(payload, [], "munich-re"), /not mapped/);
});

test("Hub prices a Munich RE form item from the server catalogue, ignoring the browser price", () => {
  const payload = { bookingId: "MR-NEW", submittedAt: "2026-10-29T10:00:00.000Z", site: "Munich RE", siteId: "munich-re", client: { name: "H", email: "h@example.com", companyName: "C" }, event: { eventDate: "2026-11-16", startTime: "12:00", guestCount: 10 },
    order: { eventType: "lunch", items: [{ itemId: "mr-light-table-lunch", itemName: "Light Table Lunch", unitPrice: 0.01, quantity: 2, lineTotal: 0.02 }], netTotal: 0.02 } } as unknown as MnkBookingPayload;
  const order = trustedPublicOrder(payload, [], "munich-re");
  assert.equal(order.items[0].unitPrice, 150);
  assert.equal(order.netTotal, 300);
});

test("no catalogue setting leaks to other sites and form items are not duplicated across catalogues", () => {
  for (const site of ["mnk", "cfc", "angel-court", "rcoa"] as const) assert.ok(!hospitalityCatalogues[site].items.some((item) => item.source.sourceItemId.startsWith("mr-")), site);
  assert.equal(new Set(active.map((item) => item.source.sourceItemId)).size, active.length);
  assert.equal(munichReFormMapping.length, active.length);
});

test("every form product has an explicit mapping classification and canonical candidates are named", () => {
  const counts = Object.fromEntries(["existing-direct", "existing-mr-config", "missing", "ambiguous"].map((c) => [c, munichReFormMapping.filter((m) => m.classification === c).length]));
  assert.deepEqual(counts, { "existing-direct": 1, "existing-mr-config": 2, missing: 17, ambiguous: 8 });
  for (const row of munichReFormMapping.filter((m) => m.classification !== "missing")) assert.ok(row.canonicalCandidate, row.sourceItemId);
});

test("locations: seven rooms and three collection points, with capacities and kinds from the form", () => {
  assert.equal(MUNICH_RE_LOCATIONS.length, 10);
  assert.deepEqual(MUNICH_RE_LOCATIONS.map(munichReLocationDisplay), ["Acacia (20 seater)", "Aloe (5 seater)", "Ginko (5 seater)", "Ironbark (14 seater)", "Avon (16 seater)", "Amazon (16 seater)", "Flex (Avon and Amazon combined)", "Collection from Level 2 Pantry", "Collection from Level 3 Reception", "Collection from Level 5 Cafe"]);
  assert.equal(MUNICH_RE_LOCATIONS.filter((l) => l.kind === "meeting-room").length, 7);
  assert.equal(MUNICH_RE_LOCATIONS.filter((l) => l.kind === "collection-point").length, 3);
  assert.equal(MUNICH_RE_LOCATIONS.find((l) => l.id === "flex")!.capacity, undefined, "Flex capacity is not assumed");
  assert.deepEqual(MUNICH_RE_LOCATIONS.find((l) => l.id === "flex")!.combines, ["avon", "amazon"]);
});
