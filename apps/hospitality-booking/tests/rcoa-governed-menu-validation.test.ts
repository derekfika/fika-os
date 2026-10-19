import assert from "node:assert/strict";
import test from "node:test";
import { portalMenuFromCatalogue } from "../lib/hospitality-portal-catalogue";
import { buildRcoaGroupHubPayloads } from "../lib/rcoa-booking-group";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import { localRcoaMenuCatalogue } from "../lib/local-rcoa-menu";
import { rcoaEventTypes } from "../lib/rcoa-portal";

const RCOA_OPLOC = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const SERVICE_DATE = "2026-10-19";

/** A governed catalogue package shaped like the published one: stable Item IDs in the hospitality-menu-item namespace (not the legacy source IDs). */
const governedId = (sourceItemId: string, index: number) => `hospitality-menu-item:${index % 6 === 0 ? "mnk" : "rcoa"}:${sourceItemId}`;
const pkg = {
  schemaVersion: 1, contract: "fika.hospitality-catalogue-package.v1",
  oplocs: [{ id: RCOA_OPLOC, label: "RCoA" }], exceptions: [],
  items: localRcoaMenuCatalogue.items.map((item, index) => ({
    id: governedId(item.source.sourceItemId, index), name: item.name, category: item.category, description: item.description,
    defaultPrices: [{ amount: item.pricing.unitPrice, vatRate: item.pricing.vatRate ?? 0.2, from: "2026-01-01" }], defaultMinimumQuantity: item.orderingConstraints.minimumQuantity,
    defaultMinimumGuests: item.orderingConstraints.minimumGuests || undefined, defaultMode: "standard",
    configuration: { servingInfo: item.pricing.servingInfo, choices: item.optionGroups.map((group) => ({ id: group.id, label: group.label, controlType: group.selectionType, required: group.required, options: group.options.map((option, optionIndex) => ({ id: `${group.id}:${optionIndex}`, label: option.label })) })) },
    dietaryInformation: [], allergenInformation: [],
  })),
};
const displayed = portalMenuFromCatalogue(pkg as never, RCOA_OPLOC, SERVICE_DATE);

const requestFor = (itemId: string, quantity: number, choices: Array<{ id: string; value: string }>, eventType: string, guests = 40) => ({
  bookingId: "RCOA-20261201090000-ABCD", submittedAt: "2026-10-19T09:00:00.000Z",
  client: { name: "T", email: "t@example.invalid", phone: "07000000000", companyName: "T" },
  event: { eventDate: "2026-12-01", startTime: "10:00", guestCount: guests, floorLevel: "1" },
  order: { eventType, items: [{ itemId, quantity, choices }] },
  dietaries: { hasDietaries: false, vegetarian: 0, vegan: 0, glutenFree: 0, coeliac: 0, dairyFree: 0, halal: 0, otherCount: 0, allergyDetails: "", severeAllergyAcknowledged: false, freeText: "" },
  acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true },
});
const occasionFor = (category: string) => rcoaEventTypes.find((event) => (event.categories as readonly string[]).includes(category))!.id;

test("the governed menu really is in the stable-ID namespace the portal sends (and not the legacy source IDs)", () => {
  assert.equal(displayed.length, localRcoaMenuCatalogue.items.length);
  assert.ok(displayed.every((item) => item.id.startsWith("hospitality-menu-item:")));
  assert.ok(displayed.some((item) => item.id.startsWith("hospitality-menu-item:mnk:")), "shared company items keep their own namespace");
});

test("every item displayed as bookable is accepted by booking validation, at its minimum quantity and with its required choices", () => {
  const rejected: string[] = [];
  for (const item of displayed) {
    const choices = (item.optionGroups || []).filter((group) => group.required).map((group) => ({ id: group.id, value: group.options[0].label }));
    try {
      const payload = buildTrustedRcoaHubPayload(requestFor(item.id, Math.max(item.minimumQuantity ?? 1, 1), choices, occasionFor(item.category), Math.max(item.minimumGuests ?? 10, 10)), displayed);
      assert.equal(payload.order.items[0].itemId, item.id, "the Hub receives the stable governed Item ID");
      assert.equal(payload.order.items[0].unitPrice, item.unitPrice, "priced from the governed Offering, never the client");
    } catch (error) { rejected.push(`${item.id}: ${(error as Error).message}`); }
  }
  assert.deepEqual(rejected, []);
});

test("the legacy source IDs are no longer the authority once a governed menu is supplied", () => {
  const legacy = localRcoaMenuCatalogue.items[1];
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(legacy.source.sourceItemId, 10, [], occasionFor(legacy.category)), displayed), /no longer available/);
});

test("an item that is not on the displayed governed menu (unavailable, withdrawn or unknown) is still refused", () => {
  const withoutFirst = displayed.slice(1);
  const hidden = displayed[0];
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(hidden.id, 10, [], occasionFor(hidden.category)), withoutFirst), /no longer available/);
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor("hospitality-menu-item:rcoa:does_not_exist", 10, [], "breakfast"), displayed), /no longer available|not available/);
});

test("normal quantity, guest, occasion and option rules still apply to governed items", () => {
  const constrained = displayed.find((item) => (item.minimumQuantity ?? 1) > 1)!;
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(constrained.id, (constrained.minimumQuantity ?? 1) - 1, [], occasionFor(constrained.category)), displayed), /minimum quantity/);
  const optioned = displayed.find((item) => (item.optionGroups || []).some((group) => group.required))!;
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(optioned.id, Math.max(optioned.minimumQuantity ?? 1, 1), [], occasionFor(optioned.category)), displayed), /Choose an option/);
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(displayed[0].id, 10, [], "not-an-occasion"), displayed));
});

test("the All Day Hospitality group path validates every service against the same governed menu", () => {
  const item = displayed.find((candidate) => !(candidate.optionGroups || []).some((group) => group.required) && (candidate.minimumQuantity ?? 1) <= 1)!;
  const child = (sequence: number) => ({ ...requestFor(item.id, 2, [], occasionFor(item.category)), bookingId: `RCOA-20261201090000-ABCD-0${sequence}`, bookingGroup: { id: "RCOA-20261201090000-ABCD", size: 2, sequence } });
  const built = buildRcoaGroupHubPayloads({ bookingGroup: { id: "RCOA-20261201090000-ABCD", size: 2 }, requests: [child(1), child(2)] }, displayed);
  assert.equal(built.payloads.length, 2);
  assert.equal(built.payloads[0].order.items[0].itemId, item.id);
});

test("the booking routes load the governed menu server-side and fail closed when it cannot be verified", async () => {
  const { readFileSync } = await import("node:fs");
  for (const route of ["../app/api/bookings/rcoa/route.ts", "../app/api/bookings/rcoa/group/route.ts"]) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.match(source, /loadGovernedRcoaMenu\(expectedOplocId\)/);
    assert.match(source, /\|\| 503/);
  }
  const loader = readFileSync(new URL("../lib/governed-rcoa-menu.ts", import.meta.url), "utf8");
  assert.match(loader, /source === "cache-unverified"/);
  assert.match(loader, /status: 503/);
});

test("root cause reproduced: validating a governed ID against the legacy local snapshot gives the original 400", () => {
  const item = displayed[1];
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(item.id, 10, [], occasionFor(item.category))), /A menu item is no longer available\. Refresh the menu and try again\./);
});
