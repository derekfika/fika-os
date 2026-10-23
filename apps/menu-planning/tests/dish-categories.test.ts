import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_DISH_CATEGORIES, canonicalDishCategoryForSlot, categoriesForMenuSlot, dishCategoryForWrite, normaliseDishCategory } from "../lib/dish-categories";
import { rankDishPickerItems, type DishPickerItem } from "../lib/dish-picker";

test("Dish Library exposes exactly the ten governed taxonomy values", () => {
  assert.deepEqual(CANONICAL_DISH_CATEGORIES, ["Salad", "Starch/Side", "Garnish", "Sauce", "Hot Main", "Vegan/Veggie Main", "Fish", "Soup", "Cold Protein", "Dessert"]);
  for (const category of CANONICAL_DISH_CATEGORIES) {
    assert.equal(normaliseDishCategory(category), category);
    assert.equal(dishCategoryForWrite(category), category);
  }
});

test("legacy Side and Other records remain readable without rewriting their stored values", () => {
  assert.equal(normaliseDishCategory("Side"), "Starch/Side");
  assert.equal(normaliseDishCategory("EXTRAS"), "Starch/Side");
  assert.equal(normaliseDishCategory("Vegan Main"), "Vegan/Veggie Main");
  assert.equal(normaliseDishCategory("Other"), "Other");
  assert.equal(normaliseDishCategory("Unrecognised historical category"), "Other");
  assert.throws(() => dishCategoryForWrite("Side"), /governed Dish Library categories/);
  assert.throws(() => dishCategoryForWrite("Other"), /governed Dish Library categories/);
  assert.throws(() => dishCategoryForWrite("Vegan Main"), /governed Dish Library categories/);
  assert.equal(normaliseDishCategory("Pudding"), "Dessert");
  assert.throws(() => dishCategoryForWrite("Pudding"), /governed Dish Library categories/);
});

test("menu slots stay distinct from dish categories and Hot Main accepts Fish dishes", () => {
  assert.deepEqual(categoriesForMenuSlot("HOT MAIN"), ["Hot Main", "Fish"]);
  assert.equal(canonicalDishCategoryForSlot("HOT MAIN"), "Hot Main");
  assert.equal(canonicalDishCategoryForSlot("STARCH/SIDE 1"), "Starch/Side");
  assert.equal(canonicalDishCategoryForSlot("DESSERT 1"), "Dessert");
  assert.deepEqual(categoriesForMenuSlot("DESSERT 3"), ["Dessert"]);
  assert.equal(canonicalDishCategoryForSlot("CUSTOM DESSERT"), undefined);
  const fish: DishPickerItem = { id: "fish-1", name: "Roast Salmon", category: "Fish" };
  assert.deepEqual(rankDishPickerItems([fish], "", "HOT MAIN").map(item => item.id), ["fish-1"]);
  assert.equal(fish.category, "Fish");
  assert.deepEqual(categoriesForMenuSlot("VEGAN MAIN"), ["Vegan/Veggie Main"]);
  assert.deepEqual(rankDishPickerItems([{ id: "vegan-1", name: "Roast Tofu", category: "Vegan/Veggie Main" }], "", "HOT VEG VEGAN").map(item => item.id), ["vegan-1"]);
  assert.deepEqual(rankDishPickerItems([{ id: "side-1", name: "Roast Potatoes", category: "Side" }], "", "STARCH/SIDE 1").map(item => item.id), ["side-1"]);
  assert.deepEqual(rankDishPickerItems([{ id: "sauce-1", name: "Salsa Verde", category: "Sauce" }], "", "SAUCE 1").map(item => item.id), ["sauce-1"]);
  assert.deepEqual(rankDishPickerItems([{ id: "garnish-1", name: "Chopped Herbs", category: "Garnish" }], "", "GARNISH 1").map(item => item.id), ["garnish-1"]);
  assert.deepEqual(rankDishPickerItems([{ id: "salad-1", name: "Green Salad", category: "Salad" }], "", "HOT MAIN").map(item => item.id), []);
});
