import test from "node:test";
import assert from "node:assert/strict";
import { filterCatalogueEntries, type CatalogueEntry } from "../lib/catalogue";

const entries: CatalogueEntry[] = [
  { id: "menu-item:salad", kind: "canonical", name: "Green salad", category: "Salads", usage: ["delivered-in"], status: "approved", reviewStatus: "approved", sourceLabel: "Brian workbook", recipeAvailable: true, allergenCount: 0 },
  { id: "menu-item:sandwich", kind: "canonical", name: "Chicken sandwich", category: "sandwich", usage: ["hospitality", "production"], status: "draft", reviewStatus: "unreviewed", sourceLabel: "Chef source", recipeAvailable: false, allergenCount: 2 },
];

test("catalogue filters only canonical MenuItems", () => {
  assert.equal(entries.every((entry) => entry.kind === "canonical"), true);
  assert.equal(filterCatalogueEntries(entries, { query: "chicken" }).length, 1);
  assert.equal(filterCatalogueEntries(entries, { usage: "delivered-in" }).length, 1);
  assert.equal(filterCatalogueEntries(entries, { status: "approved" })[0]?.id, "menu-item:salad");
  assert.equal(filterCatalogueEntries(entries, { category: "Salads" })[0]?.id, "menu-item:salad");
});
