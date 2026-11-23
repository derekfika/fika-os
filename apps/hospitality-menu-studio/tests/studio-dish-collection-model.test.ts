import assert from "node:assert/strict";
import test from "node:test";
import type { Dish, Menu, Section } from "../lib/contract";
import {
  dishUsage,
  emptyDishFilters,
  filterDishes,
  sectionDishIds,
} from "../components/studio-dish-collection-model";

function dish(id: string, name: string, category: Dish["category"], temperature: Dish["temperature"]): Dish {
  return {
    id, name, category, temperature, version: 1, updatedAt: "",
    customerDescription: "", kitchenDescription: "", assortment: null,
  };
}

const library = [
  dish("tart-1", "Courgette & chèvre tart", "vegetarian", "hot"),
  dish("tart-2", "Courgette & chèvre tart", "vegan", "cold"),
  dish("fish", "Smoked fish tart", "fish", null),
];

const rotating: Section = {
  id: "finger-food", name: "Finger Food", mode: "rotation", catalogueItemId: "",
  staticDishIds: ["fish"], weeks: [["tart-1"], [], ["tart-1", "tart-2"], [], [], []],
};
const staticSection: Section = {
  id: "canapes", name: "Canapés", mode: "static", catalogueItemId: "",
  staticDishIds: ["fish", "tart-1"], weeks: [["tart-2"], [], [], [], [], []],
};

function menu(id: string, sections: Section[]): Menu {
  return { id, name: "Summer menu", sections, kind: "seasonal", version: 1, updatedAt: "",
    startDate: "", endDate: "", anchorMonday: "" };
}

test("search combines name, category and temperature while retaining distinct dish IDs", () => {
  const lookup = { ...emptyDishFilters, search: "  CHEVRE " };
  assert.deepEqual(filterDishes(library, { ...lookup, category: "veg" }).map((item) => item.id), ["tart-1", "tart-2"]);
  assert.deepEqual(filterDishes(library, { ...lookup, category: "veg", temperature: "hot" }), [library[0]]);
  assert.deepEqual(filterDishes(library, { ...lookup, category: "vegan" }), [library[1]]);
  assert.deepEqual(filterDishes(library, { ...emptyDishFilters, temperature: null }), [library[2]]);
});

test("usage counts each menu once across active sections and weeks", () => {
  const { byMenu, menuCounts } = dishUsage([
    menu("summer-1", [rotating, staticSection]), menu("summer-2", [rotating]),
  ]);
  assert.deepEqual(byMenu.get("summer-2"), new Set(["tart-1", "tart-2"]));
  assert.deepEqual(menuCounts, new Map([["tart-1", 2], ["tart-2", 2], ["fish", 1]]));
});

test("section assignment filters exclude hidden mode data and intersect with search", () => {
  assert.deepEqual(sectionDishIds(staticSection), ["fish", "tart-1"]);
  const inRotation = new Set(sectionDishIds(rotating));
  assert.deepEqual(filterDishes(library, { ...emptyDishFilters, search: "tart" }, inRotation), library.slice(0, 2));
  assert.deepEqual(filterDishes(library, emptyDishFilters, new Set()), []);
});
