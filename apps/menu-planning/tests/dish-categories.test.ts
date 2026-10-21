import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_DISH_CATEGORIES, categoriesForMenuSlot, dishCategoryForWrite, normaliseDishCategory } from "../lib/dish-categories";
import { rankDishPickerItems, type DishPickerItem } from "../lib/dish-picker";

test("Dish Library exposes exactly the nine governed taxonomy values", () => {
  assert.deepEqual(CANONICAL_DISH_CATEGORIES, ["Salad", "Starch/Side", "Garnish", "Sauce", "Hot Main", "Vegan Main", "Fish", "Soup", "Cold Protein"]);
});

test("legacy Side and Other records remain readable without rewriting their stored values", () => {
  assert.equal(normaliseDishCategory("Side"), "Starch/Side");
  assert.equal(normaliseDishCategory("EXTRAS"), "Starch/Side");
  assert.equal(normaliseDishCategory("Other"), "Other");
  assert.equal(normaliseDishCategory("Unrecognised historical category"), "Other");
  assert.throws(() => dishCategoryForWrite("Side"), /governed Dish Library categories/);
  assert.throws(() => dishCategoryForWrite("Other"), /governed Dish Library categories/);
  assert.throws(() => dishCategoryForWrite("Dessert"), /governed Dish Library categories/);
});

test("menu slots stay distinct from dish categories and Hot Main accepts Fish dishes", () => {
  assert.deepEqual(categoriesForMenuSlot("HOT MAIN"), ["Hot Main", "Fish"]);
  const fish: DishPickerItem = { id: "fish-1", name: "Roast Salmon", category: "Fish" };
  assert.deepEqual(rankDishPickerItems([fish], "", "HOT MAIN").map(item => item.id), ["fish-1"]);
  assert.equal(fish.category, "Fish");
  assert.deepEqual(rankDishPickerItems([{ id: "side-1", name: "Roast Potatoes", category: "Side" }], "", "STARCH/SIDE 1").map(item => item.id), ["side-1"]);
});
