import { seedVisibility } from "./support/rcoa-service-visibility";
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
  type RcoaBookingDraft,
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

function requestFor(item?: PortalMenuItem, eventType: "breakfast" | "lunch" = "breakfast") {
  return {
    bookingId: "RCOA-20261005103000-AB12",
    submittedAt: "2026-10-05T10:30:00.000Z",
    client: { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "College" },
    event: { eventDate: "2026-10-20", startTime: "10:00", guestCount: 12, floorLevel: "First floor", roomOrArea: "Boardroom" },
    order: {
      eventType,
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
  assert.equal(localRcoaMenuCatalogue.source.itemCount, 46);
  assert.equal(localRcoaMenuCatalogue.items.length, 46);
  assert.equal(localRcoaMenuCatalogue.categories.length, 14);
  assert.equal(new Set(localRcoaMenuCatalogue.items.map((item) => item.source.sourceItemId)).size, 46);
  assert.ok(localRcoaMenuCatalogue.items.every((item) => item.pricing.vatRate === 0.2));
  assert.ok(localRcoaMenuCatalogue.items.every((item) => item.dietaryInformation.length === 0));
  assert.deepEqual(localRcoaMenuCatalogue.items.find((item) => item.source.sourceItemId === "tray_bake_box")?.allergenInformation, ["Nuts"]);
  assert.match(localRcoaMenuCatalogue.validationReport.missingCanonicalFields.find((field) => field.field === "allergenInformation")?.reason || "", /empty list is not a clear declaration/);
  assert.ok(localRcoaMenuCatalogue.items.some((item) => item.optionGroups.length > 0));
});

test("RCoA requested commercial values and distinct traybake variants come from the canonical menu", () => {
  const byId = new Map(localRcoaMenuCatalogue.items.map((item) => [item.source.sourceItemId, item]));
  const cookie = byId.get("cookie_box")!;
  assert.equal(cookie.name, "Cookie Box");
  assert.equal(cookie.pricing.unitPrice, 64);
  assert.equal(cookie.pricing.servingInfo, "Feeds 20 people");

  const loaf = byId.get("loaf_cake")!;
  assert.equal(loaf.name, "Loaf Cake");
  assert.equal(loaf.pricing.unitPrice, 38);
  assert.equal(loaf.pricing.servingInfo, "Feeds 14 people");

  const doughnuts = byId.get("doughnut_box")!;
  assert.equal(doughnuts.name, "Doughnut Box");
  assert.equal(doughnuts.pricing.unitPrice, 42);
  assert.equal(doughnuts.pricing.servingInfo, "Feeds 12 people");

  const containsNuts = byId.get("tray_bake_box")!;
  const nutFree = byId.get("tray_bake_box_nut_free")!;
  assert.notEqual(containsNuts.canonicalId, nutFree.canonicalId);
  assert.equal(containsNuts.name, "Traybake Box — Contains Nuts");
  assert.equal(nutFree.name, "Traybake Box — Nut Free");
  for (const item of [containsNuts, nutFree]) {
    assert.equal(item.pricing.unitPrice, 75);
    assert.equal(item.pricing.servingInfo, "Feeds 24 or 48 smaller bites");
  }
});

test("Propper Salads preserves all four named menu pairs and validates totals at and above its minimum", () => {
  const item = localRcoaMenuCatalogue.items.find((candidate) => candidate.source.sourceItemId === "glow_bowl")!;
  assert.equal(item.name, "Propper Salads");
  assert.equal(item.pricing.unitPrice, 12.5);
  assert.equal(item.orderingConstraints.minimumQuantity, 25);
  assert.equal(item.source.sourceItemId, "glow_bowl", "existing menu identity remains stable");
  assert.deepEqual(item.optionGroups[0].options.map((option) => option.label), [
    "Menu 1 — Cajun Chicken & Avo Mex Bowl",
    "Menu 1 — Vegan BBQ & Avo Mex Bowl",
    "Menu 2 — Hot Honey Roasted Sweet Potato Jerk Chicken & Quinoa Bowl",
    "Menu 2 — Hot Honey Roasted Sweet Potato & Quinoa Bowl",
    "Menu 3 — Roasted Miso Salmon & Edamame Bowl",
    "Menu 3 — Char-Sui Smoked Tofu & Edamame Bowl",
    "Menu 4 — Mediterranean Chicken & Halloumi Bowl",
    "Menu 4 — Mediterranean Falafel Bowl",
  ]);
  assert.match(item.description || "", /Char-Sui Smoked Tofu & Edamame Bowl/);

  const draft = createEmptyRcoaDraft();
  draft.lines = [{ itemId: "glow_bowl", quantity: 25, choices: { bowl: "Menu 1 — Cajun Chicken & Avo Mex Bowl" } }];
  assert.equal(calculateRcoaTotal(draft.lines, menu), 312.5);
  draft.lines[0].quantity = 26;
  assert.equal(calculateRcoaTotal(draft.lines, menu), 325);

  const request = requestFor(menu.find((candidate) => candidate.id === "glow_bowl")!, "lunch");
  request.event.guestCount = 25;
  request.order.items[0].quantity = 25;
  request.order.items[0].choices = [{ id: "bowl", value: "Menu 1 — Cajun Chicken & Avo Mex Bowl" }];
  const minimum = buildTrustedRcoaHubPayload(request, undefined, seedVisibility);
  assert.equal(minimum.order.items[0].unitPrice, 12.5);
  assert.equal(minimum.order.items[0].lineTotal, 312.5);
  request.order.items[0].quantity = 26;
  const aboveMinimum = buildTrustedRcoaHubPayload(request, undefined, seedVisibility);
  assert.equal(aboveMinimum.order.items[0].lineTotal, 325);
  request.order.items[0].quantity = 24;
  assert.throws(() => buildTrustedRcoaHubPayload(request, undefined, seedVisibility), /requires a minimum quantity of 25/);
});

test("RCoA occasion categories and menu search filter the shared compatibility menu", () => {
  const breakfast = filterRcoaMenu(menu, "breakfast", "all", "coffee", seedVisibility);
  assert.ok(breakfast.length > 0);
  assert.ok(breakfast.every((item) => item.category === "Drinks" || item.category === "Breakfast" || item.category === "Sweet treats"));
  assert.deepEqual(filterRcoaMenu(menu, "breakfast", "Dining", "", seedVisibility), []);
});

test("changing occasions retains compatible menu lines and does not erase drafts before menu load", () => {
  const breakfast = menu.find((item) => item.category === "Breakfast")!;
  const dining = menu.find((item) => item.category === "Dining")!;
  const lines = [
    { itemId: breakfast.id, quantity: 2, choices: {} },
    { itemId: dining.id, quantity: 1, choices: {} },
  ];
  assert.deepEqual(retainRcoaLinesForOccasion(lines, "breakfast", menu, seedVisibility).map((line) => line.itemId), [breakfast.id]);
  assert.deepEqual(retainRcoaLinesForOccasion(lines, "dining", [], seedVisibility), lines);
});

test("request construction uses stable RCoA identity and the server reprices from its menu snapshot", () => {
  const item = menu.find((candidate) => candidate.category === "Breakfast")!;
  const draft = createEmptyRcoaDraft();
  draft.occasion = "breakfast";
  draft.contact = { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "College", invoiceReference: "" };
  draft.event = { eventDate: "2026-10-20", guestCount: 12, startTime: "10:00", endTime: "", floorLevel: "First floor", roomOrArea: "Boardroom", deliveryPoint: "", onsiteContactName: "", onsiteContactPhone: "" };
  draft.lines = [{ itemId: item.id, quantity: Math.max(1, item.minimumQuantity || 1), choices: Object.fromEntries((item.optionGroups || []).filter((group) => group.required).map((group) => [group.id, group.options[0]?.label || ""])) }];
  draft.acknowledgements = { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true };
  const clientRequest = buildRcoaClientRequest(draft, menu, { bookingId: "RCOA-20261005103000-AB12", submittedAt: "2026-10-05T10:30:00.000Z" });
  assert.equal("siteId" in clientRequest, false);
  assert.equal("unitPrice" in clientRequest.order.items[0], false);
  assert.equal(calculateRcoaTotal(draft.lines, menu), item.unitPrice * draft.lines[0].quantity);
  const trusted = buildTrustedRcoaHubPayload(clientRequest, undefined, seedVisibility);
  assert.equal(trusted.siteId, "rcoa");
  assert.equal(trusted.site, "RCoA Hospitality");
  assert.equal(trusted.order.items[0].unitPrice, item.unitPrice);
  assert.equal(trusted.order.items[0].lineTotal, item.unitPrice * draft.lines[0].quantity);
  assert.throws(() => buildTrustedRcoaHubPayload({ ...clientRequest, siteId: "mnk" }, undefined, seedVisibility));
});

test("server rejects unavailable categories and quantities below source minimums", () => {
  const dining = menu.find((item) => item.category === "Dining")!;
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(dining), undefined, seedVisibility), /not available for this occasion/);

  const minimumItem = menu.find((item) => (item.minimumQuantity || 1) > 1)!;
  const invalidQuantity = requestFor(minimumItem);
  invalidQuantity.order.items[0].quantity = minimumItem.minimumQuantity! - 1;
  assert.throws(() => buildTrustedRcoaHubPayload(invalidQuantity, undefined, seedVisibility), /requires a minimum quantity/);
});

test("server requires listed menu choices and the severe-allergy acknowledgement", () => {
  const choiceItem = menu.find((item) => item.category === "Breakfast" && item.optionGroups?.some((group) => group.required))!;
  const missingChoice = requestFor(choiceItem);
  missingChoice.order.items[0].choices = [];
  assert.throws(() => buildTrustedRcoaHubPayload(missingChoice, undefined, seedVisibility), /Choose an option/);

  const allergyRequest = requestFor(menu.find((item) => item.category === "Breakfast")!);
  allergyRequest.dietaries.allergyDetails = "Peanut allergy reported";
  assert.throws(() => buildTrustedRcoaHubPayload(allergyRequest, undefined, seedVisibility), /severe allergy and cross-contamination/);
});

test("bespoke may submit without itemised selections while other occasions require a menu", () => {
  assert.equal(rcoaAllowsEmptyOrder("bespoke"), true);
  assert.equal(rcoaAllowsEmptyOrder("breakfast"), false);
  const draft = createEmptyRcoaDraft();
  draft.occasion = "breakfast";
  assert.equal(validateRcoaStep(3, draft, menu, seedVisibility).items, "Choose at least one menu item.");
  assert.doesNotThrow(() => buildTrustedRcoaHubPayload({ ...requestFor(), order: { ...requestFor().order, eventType: "bespoke" } }, undefined, seedVisibility));
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
  assert.deepEqual(rcoaNoticeWarnings(draft, [], new Date("2026-03-26T12:00:00.000Z")), ["No deliveries on Saturdays or Sundays."]);

  draft.occasion = "event_catering";
  assert.ok(rcoaNoticeWarnings(draft, [], new Date("2026-03-26T12:00:00.000Z")).some((warning) => warning.includes("seven-working-day")));

  draft.event.startTime = "01:30";
  assert.ok(rcoaNoticeWarnings(draft, [], new Date("2026-03-26T12:00:00.000Z")).some((warning) => warning.includes("does not occur in Europe/London")));
  assert.match(validateRcoaStep(2, draft, menu, seedVisibility).startTime || "", /does not occur in Europe\/London/);
  const invalidWallTimeRequest = requestFor(menu.find((item) => item.category === "Breakfast")!);
  invalidWallTimeRequest.event.eventDate = "2026-03-29";
  invalidWallTimeRequest.event.startTime = "01:30";
  assert.throws(() => buildTrustedRcoaHubPayload(invalidWallTimeRequest, undefined, seedVisibility), /does not occur in Europe\/London/);
});

test("RCoA Event step requires a floor level and room, trimming whitespace-only values", () => {
  const withEvent = (overrides: Partial<RcoaBookingDraft["event"]>) => ({ ...createEmptyRcoaDraft(), event: { ...createEmptyRcoaDraft().event, eventDate: "2026-10-20", startTime: "10:00", guestCount: 12, ...overrides } });
  assert.equal(validateRcoaStep(2, withEvent({ floorLevel: "", roomOrArea: "Boardroom" }), menu, seedVisibility).floorLevel, "Enter the floor level.");
  assert.equal(validateRcoaStep(2, withEvent({ floorLevel: "7", roomOrArea: "   " }), menu, seedVisibility).roomOrArea, "Enter the room or area.");
  assert.equal(validateRcoaStep(2, withEvent({ floorLevel: " 7 ", roomOrArea: " Boardroom ", deliveryPoint: "" }), menu, seedVisibility).floorLevel, undefined);
  assert.equal(validateRcoaStep(2, withEvent({ floorLevel: "7", roomOrArea: "Boardroom", deliveryPoint: "" }), menu, seedVisibility).roomOrArea, undefined);
});
