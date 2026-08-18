import test from "node:test";
import assert from "node:assert/strict";
import { rankDishPickerItems, similarDishNames, type DishPickerItem } from "../lib/dish-picker";

const items: DishPickerItem[] = [
  { id: "salad-1", name: "Asian Greens", category: "SALAD 1" },
  { id: "salad-2", name: "Asian Noodle Salad", category: "SALAD 2" },
  { id: "hot-1", name: "Asian Beef", category: "HOT MEAT" },
];

test("dish picker filters text and ranks the selected slot first", () => {
  const ranked = rankDishPickerItems(items, "Asian", "SALAD 2");
  assert.deepEqual(ranked.map(item => item.id), ["salad-2", "salad-1"]);
});

test("dish picker excludes dishes outside the selected category", () => {
  const ranked = rankDishPickerItems(items, "Beef", "SALAD 1");
  assert.equal(ranked.length, 0);
});

test("duplicate warning detects exact and likely dish names", () => {
  assert.deepEqual(similarDishNames(items, "asian greens").map(item => item.name), ["Asian Greens"]);
  assert.deepEqual(similarDishNames(items, "Asian Green").map(item => item.name), ["Asian Greens"]);
});
