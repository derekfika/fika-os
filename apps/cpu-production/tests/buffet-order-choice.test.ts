import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOT_FORK_BUFFET_CHOICE_ID, HOT_FORK_BUFFET_MENU_VERSION, HOT_FORK_BUFFET_RULES_VERSION, HOT_FORK_BUFFET_SELECTION_CONTRACT, HOT_FORK_BUFFET_LEGACY_SELECTION_CONTRACT, hotForkBuffetMenu } from "@fika/server-shared/hospitality-buffet-selection";
import BuffetOrderChoice, { ProductionOrderChoices, isBuffetChoice } from "../app/ui/BuffetOrderChoice";
import BuffetProductionCardContent, { hasHotForkBuffetSelection } from "../app/ui/BuffetProductionCardContent";

const dish = (category: string, index: number) => hotForkBuffetMenu.dishes.filter(value => value.category === category)[index];
const choice = {
  id: HOT_FORK_BUFFET_CHOICE_ID,
  value: {
    contract: HOT_FORK_BUFFET_SELECTION_CONTRACT,
    menuVersion: HOT_FORK_BUFFET_MENU_VERSION,
    rulesVersion: HOT_FORK_BUFFET_RULES_VERSION,
    packageId: "gold",
    mains: [{ dishId: dish("meat", 0).id, portions: 36 }, { dishId: dish("vegan", 0).id, portions: 24 }],
    saladIds: [dish("salad", 0).id, dish("salad", 1).id, dish("salad", 2).id],
    dessertIds: [dish("dessert", 0).id, dish("dessert", 1).id],
  },
};

test("CPU order detail displays selected dishes and honest quantity status", () => {
  const html = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [choice] }));
  assert.match(html, /Main choices: 36 ×/);
  assert.match(html, new RegExp(dish("meat", 0).name.split(",")[0]));
  assert.match(html, /Salad choices \(chef allocates portions\)/);
  assert.match(html, /Dessert choices \(50\/50 intent; chef allocates portions\)/);
  assert.match(html, new RegExp(dish("dessert", 0).name.split(",")[0]));
  assert.match(html, new RegExp(dish("salad", 1).name.split(",")[0]));
  assert.doesNotMatch(html, /30 portions|portions to confirm/);
  assert.match(html, /allergen and dietary information is unrecorded/i);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test("CPU distinguishes historical or invalid buffet choice evidence without inventing dish names", () => {
  const historical = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [{ ...choice, value: { ...choice.value, menuVersion: "older-menu" } }] }));
  assert.match(historical, /Historical menu names need review/);
  assert.match(historical, /name unavailable for saved menu version/);
  assert.doesNotMatch(historical, new RegExp(dish("meat", 0).name.split(",")[0]));
  const invalid = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: null }] }));
  assert.match(invalid, /stored choice is invalid/);
  assert.equal(isBuffetChoice({ id: "ordinary-choice", value: "large" }), false);
  const mixed = renderToStaticMarkup(createElement(ProductionOrderChoices, { choices: [choice, { id: "side", value: "Bread" }] }));
  assert.match(mixed, /Main choices: 36 ×/);
  assert.match(mixed, /side: Bread/);
  assert.doesNotMatch(mixed, /\[object Object\]/);
  const legacy = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [{ ...choice, value: { contract: HOT_FORK_BUFFET_LEGACY_SELECTION_CONTRACT, menuVersion: HOT_FORK_BUFFET_MENU_VERSION, packageId: "gold", mains: choice.value.mains, saladIds: choice.value.saladIds, desserts: choice.value.dessertIds.map(dishId => ({ dishId, portions: 30 })) } }] }));
  assert.match(legacy, /historical rules/);
  assert.match(legacy, /30 portions/);
});

test("buffet display names resolve only against the exact saved source menu version", () => {
  const current = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [choice] }));
  const older = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [{ ...choice, value: { ...choice.value, menuVersion: "later-unregistered-version" } }] }));
  assert.match(current, new RegExp(dish("meat", 0).name.split(",")[0]));
  assert.doesNotMatch(older, new RegExp(dish("meat", 0).name.split(",")[0]));
});

test("CPU shows a Hot Fork Buffet-specific card with package, guest and room evidence, without production quantities", () => {
  const cardChoice = { ...choice, value: { ...choice.value, mains: [{ dishId: dish("meat", 0).id, portions: 16 }, { dishId: dish("vegan", 0).id, portions: 8 }] as [{ dishId: string; portions: number }, { dishId: string; portions: number }] } };
  const html = renderToStaticMarkup(createElement(BuffetProductionCardContent, { order: {
    origin: "hospitality_booking", clientName: "Example Client", destinationLabel: "RCoA", destinationOplocId: "rcoa", serviceDate: "2026-11-30", serviceWindow: { startTime: "12:30" }, serviceLocation: { floorLevel: "First Floor", roomOrArea: "Boardroom 1" }, guestCount: 24, status: "needs_review", bookingDietaries: { vegetarian: 3 }, lines: [{ choices: [choice], productionQuantity: 999 }],
  } as any }));
  assert.equal(hasHotForkBuffetSelection({ origin: "hospitality_booking", lines: [{ choices: [choice] }] } as any), true);
  assert.match(html, /HOT FORK BUFFET · GOLD/);
  assert.match(html, /Boardroom 1/);
  assert.match(html, /Guests/);
  assert.match(html, /12:30/);
  assert.match(html, new RegExp(dish("meat", 0).name.split(",")[0]));
  const cardHtml = renderToStaticMarkup(createElement(BuffetProductionCardContent, { order: { origin: "hospitality_booking", clientName: "Example Client", destinationLabel: "RCoA", destinationOplocId: "rcoa", serviceDate: "2026-11-30", serviceWindow: { startTime: "12:30" }, serviceLocation: { floorLevel: "First Floor", roomOrArea: "Boardroom 1" }, guestCount: 24, status: "needs_review", bookingDietaries: { vegetarian: 3 }, lines: [{ choices: [cardChoice], productionQuantity: 999 }] } as any }));
  assert.match(cardHtml, /16 ×/);
  assert.match(cardHtml, /8 ×/);
  assert.match(html, /50\/50 intent/);
  assert.doesNotMatch(cardHtml, /999/);
});
