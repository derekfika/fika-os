import assert from "node:assert/strict";
import test from "node:test";
import { HOT_FORK_BUFFET_CHOICE_ID, HOT_FORK_BUFFET_MENU_VERSION, HOT_FORK_BUFFET_RULES_VERSION, HOT_FORK_BUFFET_SELECTION_CONTRACT, hotForkBuffetMenu } from "@fika/server-shared/hospitality-buffet-selection";
import type { ProductionOrder } from "../lib/production-domain";
import { projectDeliveredInBuffetOrder, projectDeliveredInBuffetOrders } from "../lib/hospitality-buffet-read-model";

const dish = (category: string, index: number) => hotForkBuffetMenu.dishes.filter(value => value.category === category)[index];
const choice = { id: HOT_FORK_BUFFET_CHOICE_ID, value: { contract: HOT_FORK_BUFFET_SELECTION_CONTRACT, menuVersion: HOT_FORK_BUFFET_MENU_VERSION, rulesVersion: HOT_FORK_BUFFET_RULES_VERSION, packageId: "gold", mains: [{ dishId: dish("meat", 0).id, portions: 16 }, { dishId: dish("vegan", 0).id, portions: 8 }], saladIds: [dish("salad", 0).id, dish("salad", 1).id, dish("salad", 2).id], dessertIds: [dish("dessert", 0).id, dish("dessert", 1).id] } };
const order = (extra: Record<string, unknown> = {}) => ({
  canonicalId: "production:buffet:1", origin: "hospitality_booking", serviceDate: "2026-11-30", destinationOplocId: "hospitality-menu-item:rcoa", destinationLabel: "RCoA", clientName: "Example client", serviceWindow: { startTime: "12:30" }, serviceLocation: { floorLevel: "First Floor", roomOrArea: "Boardroom 1" }, guestCount: 24, status: "needs_review", bookingDietaries: { vegetarian: 3 }, bookingNotes: "Internal client note", kitchenNotes: "Kitchen only", sourceQuoteRevisionId: "private-quote", lines: [{ itemName: "Hot Fork Buffet Gold", customerQuantity: 24, productionQuantity: 99, choices: [choice] }], ...extra,
} as unknown as ProductionOrder);
const scope = { serviceDate: "2026-11-30", oplocId: "hospitality-menu-item:rcoa" };

test("Delivered-In buffet read model returns only safe fields from the exact active canonical order", () => {
  const result = projectDeliveredInBuffetOrder(order(), scope)!;
  assert.deepEqual(result.serviceLocation, { floorLevel: "First Floor", roomOrArea: "Boardroom 1" });
  assert.equal(result.guestCount, 24);
  assert.equal(result.selectionState, "available");
  assert.deepEqual(result.selection, choice.value);
  assert.deepEqual(Object.keys(result).sort(), ["canonicalId", "clientName", "dietaries", "guestCount", "selection", "selectionState", "serviceDate", "serviceLocation", "serviceTime", "siteLabel", "status"].sort());
  assert.equal(JSON.stringify(result).includes("Internal client note"), false);
  assert.equal(JSON.stringify(result).includes("99"), false);
  assert.equal(JSON.stringify(result).includes("private-quote"), false);
});

test("Delivered-In buffet read model excludes wrong dates, sites, cancelled and superseded orders and deduplicates canonical IDs", () => {
  assert.equal(projectDeliveredInBuffetOrder(order(), { ...scope, serviceDate: "2026-12-01" }), undefined);
  assert.equal(projectDeliveredInBuffetOrder(order(), { ...scope, oplocId: "oploc:other" }), undefined);
  assert.equal(projectDeliveredInBuffetOrder(order({ status: "cancelled" }), scope), undefined);
  assert.equal(projectDeliveredInBuffetOrder(order({ supersededBy: "production:buffet:2" }), scope), undefined);
  assert.equal(projectDeliveredInBuffetOrders([order(), order()], scope).length, 1);
});

test("invalid or duplicate selections are visible as review-needed rather than silently selected", () => {
  const invalid = projectDeliveredInBuffetOrder(order({ lines: [{ choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: { ...choice.value, packageId: "bronze" } }] }] }), scope)!;
  assert.equal(invalid.selectionState, "needs_review");
  assert.equal(invalid.selection, undefined);
  const duplicate = projectDeliveredInBuffetOrder(order({ lines: [{ choices: [choice, choice] }] }), scope)!;
  assert.equal(duplicate.selectionState, "needs_review");
});
