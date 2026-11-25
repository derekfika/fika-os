import assert from "node:assert/strict";
import test from "node:test";
import { filterPickerDishes } from "../components/product-menu-picker-model";

const dishes = [
  { id: "one", name: "Harissa chicken skewers", category: "poultry", customerDescription: "Lemon and herbs" },
  { id: "two", name: "Smoked salmon blinis", category: "fish", customerDescription: "Crème fraîche" },
  { id: "three", name: "Falafel bites", category: "vegan", customerDescription: "Tahini" },
];

test("dish picker searches and filters by category without offering already assigned dishes", () => {
  assert.deepEqual(filterPickerDishes(dishes, "  herbs ", "all", new Set()), [dishes[0]]);
  assert.deepEqual(filterPickerDishes(dishes, "", "fish", new Set()), [dishes[1]]);
  assert.deepEqual(filterPickerDishes(dishes, "", "all", new Set(["one", "three"])), [dishes[1]]);
});
