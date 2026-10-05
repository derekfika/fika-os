import assert from "node:assert/strict";
import test from "node:test";
import { localRcoaMenuCatalogue } from "../lib/local-rcoa-menu";
import { buildRcoaClientRequest } from "../lib/rcoa-booking-request-client";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import {
  calculateRcoaTotal,
  createEmptyRcoaDraft,
  filterRcoaMenu,
  rcoaAllowsEmptyOrder,
  rcoaNoticeWarnings,
  retainRcoaLinesForOccasion,
  rcoaSuggestedQuantity,
  validateRcoaStep,
} from "../lib/rcoa-portal";
import type { PortalMenuItem } from "../lib/mnk-contract";

const menu: PortalMenuItem[] = localRcoaMenuCatalogue.items
  .filter((item) => item.lifecycleState === "active")
  .map((item) => ({
    canonicalId: item.canonicalId,
    id: item.source.sourceItemId,
    name: item.name,
    description: item.description,
    category: item.category,
    unitPrice: item.pricing.unitPrice,
    vatRate: item.pricing.vatRate,
    dietaryInformation: item.dietaryInformation,
    allergenInformation: item.allergenInformation,
    minimumQuantity: item.orderingConstraints.minimumQuantity,
    minimumGuests: item.orderingConstraints.minimumGuests || undefined,
    noticeRequiredDays: item.orderingConstraints.noticeRequiredDays,
    serves: item.orderingConstraints.serves,
    suggestionType: item.orderingConstraints.suggestionType,
    suggestionLabel: item.orderingConstraints.suggestionLabel,
    suggestionUnit: item.orderingConstraints.suggestionUnit,
    optionGroups: item.optionGroups,
    servingInfo: item.pricing.servingInfo,
  }));

function requestFor(item?: PortalMenuItem) {
  return {
    bookingId: "RCOA-20261005103000-AB12",
    submittedAt: "2026-10-05T10:30:00.000Z",
    client: { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "College" },
    event: { eventDate: "2026-10-20", startTime: "10:00", guestCount: 12, floorLevel: "First floor" },
    order: {
      eventType: "breakfast" as const,
      items: item ? [{
        itemId: item.id,
        quantity: Math.max(1, item.minimumQuantity || 1),
        choices: (item.optionGroups || []).filter((group) => group.required).map((group) => ({ id: group.id, value: group.options[0]?.label || "" })),
      }] : [],
    },
    dietaries: { hasDietaries: false, vegetarian: 0, vegan: 0, glutenFree: 0, coeliac: 0, dairyFree: 0, halal: 0, otherCount: 0, allergyDetails: "", severeAllergyAcknowledged: false, freeText: "" },
    acknowledgements: { quoteSubjectToConfirmation: true as const, noticePolicyAccepted: true as const, dietaryResponsibilityAccepted: true as const },
  };
}

test("RCoA menu snapshot preserves source identities, options, notices, VAT, and missing safety data", () => {
  assert.equal(localRcoaMenuCatalogue.source.itemCount, 43);
  assert.equal(localRcoaMenuCatalogue.items.length, 43);
  assert.equal(localRcoaMenuCatalogue.categories.length, 14);
  assert.equal(new Set(localRcoaMenuCatalogue.items.map((item) => item.source.sourceItemId)).size, 43);
  assert.ok(localRcoaMenuCatalogue.items.every((item) => item.pricing.vatRate === 0.2));
  assert.ok(localRcoaMenuCatalogue.items.every((item) => item.dietaryInformation.length === 0 && item.allergenInformation.length === 0));
  assert.match(localRcoaMenuCatalogue.validationReport.missingCanonicalFields.find((field) => field.field === "allergenInformation")?.reason || "", /empty list is not a clear declaration/);
  assert.ok(localRcoaMenuCatalogue.items.some((item) => item.optionGroups.length > 0));
});

test("RCoA occasion categories and menu search filter the shared compatibility menu", () => {
  const breakfast = filterRcoaMenu(menu, "breakfast", "all", "coffee");
  assert.ok(breakfast.length > 0);
  assert.ok(breakfast.every((item) => item.category === "Drinks" || item.category === "Breakfast" || item.category === "Sweet treats"));
  assert.deepEqual(filterRcoaMenu(menu, "breakfast", "Dining", ""), []);
});

test("changing occasions retains compatible menu lines and does not erase drafts before menu load", () => {
  const breakfast = menu.find((item) => item.category === "Breakfast")!;
  const dining = menu.find((item) => item.category === "Dining")!;
  const lines = [
    { itemId: breakfast.id, quantity: 2, choices: {} },
    { itemId: dining.id, quantity: 1, choices: {} },
  ];
  assert.deepEqual(retainRcoaLinesForOccasion(lines, "breakfast", menu).map((line) => line.itemId), [breakfast.id]);
  assert.deepEqual(retainRcoaLinesForOccasion(lines, "dining", []), lines);
});

test("request construction uses stable RCoA identity and the server reprices from its menu snapshot", () => {
  const item = menu.find((candidate) => candidate.category === "Breakfast")!;
  const draft = createEmptyRcoaDraft();
  draft.occasion = "breakfast";
  draft.contact = { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "College", invoiceReference: "" };
  draft.event = { eventDate: "2026-10-20", guestCount: 12, startTime: "10:00", endTime: "", floorLevel: "First floor", roomOrArea: "", deliveryPoint: "", onsiteContactName: "", onsiteContactPhone: "" };
  draft.lines = [{ itemId: item.id, quantity: Math.max(1, item.minimumQuantity || 1), choices: Object.fromEntries((item.optionGroups || []).filter((group) => group.required).map((group) => [group.id, group.options[0]?.label || ""])) }];
  draft.acknowledgements = { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true };
  const clientRequest = buildRcoaClientRequest(draft, menu, { bookingId: "RCOA-20261005103000-AB12", submittedAt: "2026-10-05T10:30:00.000Z" });
  assert.equal("siteId" in clientRequest, false);
  assert.equal("unitPrice" in clientRequest.order.items[0], false);
  assert.equal(calculateRcoaTotal(draft.lines, menu), item.unitPrice * draft.lines[0].quantity);
  const trusted = buildTrustedRcoaHubPayload(clientRequest);
  assert.equal(trusted.siteId, "rcoa");
  assert.equal(trusted.site, "RCoA Hospitality");
  assert.equal(trusted.order.items[0].unitPrice, item.unitPrice);
  assert.equal(trusted.order.items[0].lineTotal, item.unitPrice * draft.lines[0].quantity);
  assert.throws(() => buildTrustedRcoaHubPayload({ ...clientRequest, siteId: "mnk" }));
});

test("server rejects unavailable categories and quantities below source minimums", () => {
  const dining = menu.find((item) => item.category === "Dining")!;
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(dining)), /not available for this occasion/);

  const minimumItem = menu.find((item) => (item.minimumQuantity || 1) > 1)!;
  const invalidQuantity = requestFor(minimumItem);
  invalidQuantity.order.items[0].quantity = minimumItem.minimumQuantity! - 1;
  assert.throws(() => buildTrustedRcoaHubPayload(invalidQuantity), /requires a minimum quantity/);
});

test("server requires listed menu choices and the severe-allergy acknowledgement", () => {
  const choiceItem = menu.find((item) => item.category === "Breakfast" && item.optionGroups?.some((group) => group.required))!;
  const missingChoice = requestFor(choiceItem);
  missingChoice.order.items[0].choices = [];
  assert.throws(() => buildTrustedRcoaHubPayload(missingChoice), /Choose an option/);

  const allergyRequest = requestFor(menu.find((item) => item.category === "Breakfast")!);
  allergyRequest.dietaries.allergyDetails = "Peanut allergy reported";
  assert.throws(() => buildTrustedRcoaHubPayload(allergyRequest), /severe allergy and cross-contamination/);
});

test("bespoke may submit without itemised selections while other occasions require a menu", () => {
  assert.equal(rcoaAllowsEmptyOrder("bespoke"), true);
  assert.equal(rcoaAllowsEmptyOrder("breakfast"), false);
  const draft = createEmptyRcoaDraft();
  draft.occasion = "breakfast";
  assert.equal(validateRcoaStep(3, draft, menu).items, "Choose at least one menu item.");
  assert.doesNotThrow(() => buildTrustedRcoaHubPayload({ ...requestFor(), order: { ...requestFor().order, eventType: "bespoke" } }));
});

test("quantity suggestions use source serve counts and booking totals round to pence", () => {
  assert.equal(rcoaSuggestedQuantity({ ...menu[0], serves: 5, suggestionType: "ceil_by_guests", minimumQuantity: 2 }, 11), 3);
  assert.equal(calculateRcoaTotal([{ itemId: menu[0].id, quantity: 3, choices: {} }], menu), Math.round(menu[0].unitPrice * 3 * 100) / 100);
});

test("notice rules compare London wall time across the spring BST transition", () => {
  const draft = createEmptyRcoaDraft();
  draft.occasion = "breakfast";
  draft.event.eventDate = "2026-03-29";
  draft.event.startTime = "13:00";
  assert.deepEqual(rcoaNoticeWarnings(draft, [], new Date("2026-03-26T12:00:00.000Z")), []);

  draft.occasion = "event_catering";
  assert.ok(rcoaNoticeWarnings(draft, [], new Date("2026-03-26T12:00:00.000Z")).some((warning) => warning.includes("seven-working-day")));

  draft.event.startTime = "01:30";
  assert.ok(rcoaNoticeWarnings(draft, [], new Date("2026-03-26T12:00:00.000Z")).some((warning) => warning.includes("does not occur in Europe/London")));
  assert.match(validateRcoaStep(2, draft, menu).startTime || "", /does not occur in Europe\/London/);
  const invalidWallTimeRequest = requestFor(menu.find((item) => item.category === "Breakfast")!);
  invalidWallTimeRequest.event.eventDate = "2026-03-29";
  invalidWallTimeRequest.event.startTime = "01:30";
  assert.throws(() => buildTrustedRcoaHubPayload(invalidWallTimeRequest), /does not occur in Europe\/London/);
});
