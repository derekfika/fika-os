import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOT_FORK_BUFFET_CHOICE_ID, HOT_FORK_BUFFET_MENU_VERSION, HOT_FORK_BUFFET_SELECTION_CONTRACT, hotForkBuffetMenu } from "@fika/server-shared/hospitality-buffet-selection";
import BuffetOrderChoice, { ProductionOrderChoices, isBuffetChoice } from "../app/ui/BuffetOrderChoice";

const dish = (category: string, index: number) => hotForkBuffetMenu.dishes.filter(value => value.category === category)[index];
const choice = {
  id: HOT_FORK_BUFFET_CHOICE_ID,
  value: {
    contract: HOT_FORK_BUFFET_SELECTION_CONTRACT,
    menuVersion: HOT_FORK_BUFFET_MENU_VERSION,
    packageId: "gold",
    mains: [{ dishId: dish("meat", 0).id, portions: 36 }, { dishId: dish("vegan", 0).id, portions: 24 }],
    saladIds: [dish("salad", 0).id, dish("salad", 1).id, dish("salad", 2).id],
    desserts: [{ dishId: dish("dessert", 0).id, portions: 30 }, { dishId: dish("dessert", 1).id, portions: null }],
  },
};

test("CPU order detail displays selected dishes and honest quantity status", () => {
  const html = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [choice] }));
  assert.match(html, /Main choices: 36 ×/);
  assert.match(html, new RegExp(dish("meat", 0).name.split(",")[0]));
  assert.match(html, /Salad choices \(portions to confirm\)/);
  assert.match(html, /30 portions/);
  assert.match(html, /portions to confirm/);
  assert.match(html, /allergen and dietary information is unrecorded/i);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test("CPU distinguishes historical or invalid buffet choice evidence without inventing dish names", () => {
  const historical = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [{ ...choice, value: { ...choice.value, menuVersion: "older-menu" } }] }));
  assert.match(historical, /Historical menu names need review/);
  assert.match(historical, new RegExp(dish("meat", 0).id));
  assert.doesNotMatch(historical, new RegExp(dish("meat", 0).name.split(",")[0]));
  const invalid = renderToStaticMarkup(createElement(BuffetOrderChoice, { choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: null }] }));
  assert.match(invalid, /stored choice is invalid/);
  assert.equal(isBuffetChoice({ id: "ordinary-choice", value: "large" }), false);
  const mixed = renderToStaticMarkup(createElement(ProductionOrderChoices, { choices: [choice, { id: "side", value: "Bread" }] }));
  assert.match(mixed, /Main choices: 36 ×/);
  assert.match(mixed, /side: Bread/);
  assert.doesNotMatch(mixed, /\[object Object\]/);
});
