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
  assert.deepEqual(ranked.map(item => item.id), ["salad-2", "salad-1", "hot-1"]);
});

test("dish picker includes dishes outside the selected category", () => {
  const ranked = rankDishPickerItems(items, "Beef", "SALAD 1");
  assert.deepEqual(ranked.map(item => item.id), ["hot-1"]);
});

test("dish picker applies the governed category to every standard slot", () => {
  assert.equal(rankDishPickerItems(items, "", "SOUP")[0].id, "soup-1");
  assert.equal(rankDishPickerItems(items, "", "COLD PROTEIN")[0].id, "cold-1");
  assert.equal(rankDishPickerItems(items, "", "HOT MEAT")[0].id, "hot-1");
});

test("duplicate warning detects exact and likely dish names", () => {
  assert.deepEqual(similarDishNames(items, "asian greens").map(item => item.name), ["Asian Greens"]);
  assert.deepEqual(similarDishNames(items, "Asian Green").map(item => item.name), ["Asian Greens"]);
});

test("uncategorised almonds and exact Shallots aliases remain discoverable; a 500-dish catalogue searches locally", () => {
  const catalogue = [...Array.from({ length: 500 }, (_, i) => ({ id: `dish:${i}`, name: `Fixture ${i}`, category: "Salad" })), { id: "almonds", name: "Toasted Almonds", category: "", aliases: ["Almond garnish"] }, { id: "shallots", name: "Roasted Beetroot with Yoghurt & Pickled Shallots", category: "Salad", aliases: ["Pickled Shallot"] }];
  const start = performance.now();
  for (let i = 0; i < 30; i++) assert.equal(rankDishPickerItems(catalogue, "Toasted Almonds", "GARNISH 1")[0].id, "almonds");
  console.log(`500-dish local search mean: ${((performance.now() - start) / 30).toFixed(2)} ms`);
  assert.equal(rankDishPickerItems(catalogue, "Pickled Shallots", "GARNISH 1")[0].id, "shallots");
  assert.equal(rankDishPickerItems(catalogue, "Pickled Shallot", "GARNISH 1")[0].id, "shallots");
});
