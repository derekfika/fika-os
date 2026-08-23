import test from "node:test";
import assert from "node:assert/strict";
import { rankDishPickerItems, similarDishNames, type DishPickerItem } from "../lib/dish-picker";

const items: DishPickerItem[] = [
  { id: "salad-1", name: "Asian Greens", category: "SALAD 1" },
  { id: "salad-2", name: "Asian Noodle Salad", category: "SALAD 2" },
  { id: "hot-1", name: "Asian Beef", category: "HOT MEAT" },
  { id: "soup-1", name: "Tomato Soup", category: "Soup" },
  { id: "cold-1", name: "Chicken Breast", category: "Cold Protein" },
];

test("dish picker filters text and ranks the selected slot first", () => {
  const ranked = rankDishPickerItems(items, "Asian", "SALAD 2");
  assert.deepEqual(ranked.map(item => item.id), ["salad-2", "salad-1"]);
});

test("dish picker excludes dishes outside the selected category", () => {
  const ranked = rankDishPickerItems(items, "Beef", "SALAD 1");
  assert.equal(ranked.length, 0);
});

test("dish picker applies the governed category to every standard slot", () => {
  assert.deepEqual(rankDishPickerItems(items, "", "SOUP").map(item => item.id), ["soup-1"]);
  assert.deepEqual(rankDishPickerItems(items, "", "COLD PROTEIN").map(item => item.id), ["cold-1"]);
  assert.deepEqual(rankDishPickerItems(items, "", "HOT MEAT").map(item => item.id), ["hot-1"]);
});

test("duplicate warning detects exact and likely dish names", () => {
  assert.deepEqual(similarDishNames(items, "asian greens").map(item => item.name), ["Asian Greens"]);
  assert.deepEqual(similarDishNames(items, "Asian Green").map(item => item.name), ["Asian Greens"]);
});
