import test from "node:test";
import assert from "node:assert/strict";
import type { CatalogueEntry } from "../lib/catalogue";
import { filterCatalogueBrowserEntries } from "../lib/catalogue-browser-filter";

const entries = [
  { id: "menu-item:salad", kind: "canonical", name: "Green salad", description: "Leaves and herbs", category: "Salads", usage: ["delivered-in"], status: "approved", reviewStatus: "approved", sourceLabel: "Brian workbook", recipeAvailable: true, allergenCount: 0 },
  { id: "menu-item:sandwich", kind: "canonical", name: "Chicken sandwich", description: "Poached chicken", category: "sandwich", usage: ["hospitality", "production"], status: "draft", reviewStatus: "unreviewed", sourceLabel: "Chef source", recipeAvailable: false, allergenCount: 2 },
] as unknown as CatalogueEntry[];

const ids = (result: CatalogueEntry[]) => result.map(entry => entry.id);

test("browser search matches the exact stable ID shown in the Dish Library", () => {
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "menu-item:salad", "all", "all", "all")), ["menu-item:salad"]);
});

test("browser search matches a partial stable ID", () => {
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "menu-item:sand", "all", "all", "all")), ["menu-item:sandwich"]);
});

test("browser search is case-insensitive for stable IDs", () => {
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "MENU-ITEM:SALAD", "all", "all", "all")), ["menu-item:salad"]);
});

test("browser search still matches dish names, descriptions and source labels", () => {
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "chicken", "all", "all", "all")), ["menu-item:sandwich"]);
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "herbs", "all", "all", "all")), ["menu-item:salad"]);
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "brian", "all", "all", "all")), ["menu-item:salad"]);
});

test("browser category, usage and status filters are preserved", () => {
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "", "Salads", "all", "all")), ["menu-item:salad"]);
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "", "all", "delivered-in", "all")), ["menu-item:salad"]);
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "", "all", "all", "draft")), ["menu-item:sandwich"]);
});

test("browser search combines the ID query with the other filters", () => {
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "menu-item", "sandwich", "all", "all")), ["menu-item:sandwich"]);
  assert.deepEqual(ids(filterCatalogueBrowserEntries(entries, "menu-item:salad", "sandwich", "all", "all")), []);
});

test("an empty query returns every entry", () => {
  assert.equal(filterCatalogueBrowserEntries(entries, "", "all", "all", "all").length, 2);
});
