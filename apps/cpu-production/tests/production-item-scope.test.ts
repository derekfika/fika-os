import test from "node:test";
import assert from "node:assert/strict";
import { DELI_STYLE_PARENT_KEY, DELIVERED_IN_LUNCH_PARENT_KEY, scopeProductionItems } from "../lib/production-item-scope";

test("saved sandwiches are scoped to Deli Style Sandwich Lunch", () => {
  const items = [
    { id: "sandwich:one", parentMenuItemKey: DELI_STYLE_PARENT_KEY },
    { id: "sandwich:other", parentMenuItemKey: "fruit-platter" },
    { id: "sandwich:unscoped" },
  ];
  assert.deepEqual(scopeProductionItems(items, "Deli Style Sandwich Lunch"), [items[0]]);
  assert.deepEqual(scopeProductionItems(items, "Fruit Platter"), []);
});

test("delivered-in lunch items remain separate from hospitality menu items", () => {
  const items = [
    { id: "production:delivered-in-lunch:salad", parentMenuItemKey: DELIVERED_IN_LUNCH_PARENT_KEY },
    { id: "sandwich:deli", parentMenuItemKey: DELI_STYLE_PARENT_KEY },
  ];
  assert.deepEqual(scopeProductionItems(items, "Delivered-in Lunch"), [items[0]]);
  assert.deepEqual(scopeProductionItems(items, "Deli Style Sandwich Lunch"), [items[1]]);
});
