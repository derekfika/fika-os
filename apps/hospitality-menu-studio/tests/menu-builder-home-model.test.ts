import assert from "node:assert/strict";
import test from "node:test";
import { filterMenuBuilderProducts, menuChoicesForCategory } from "../components/menu-builder-home-model";

test("standalone drinks and wine do not offer dish menu creation", () => {
  for (const category of ["Drinks", " beverages ", "WINE", "Wines"]) {
    assert.equal(menuChoicesForCategory(category), false, category);
  }
});

test("Menu Builder status filters keep configured drafts and unconfigured products distinct", () => {
  const products = [
    { itemId: "finger-food", name: "Finger Food", category: "Reception" },
    { itemId: "breakfast", name: "Breakfast Pots", category: "Breakfast" },
  ];
  const configured = new Set(["finger-food"]);
  const published = new Set<string>();
  assert.deepEqual(filterMenuBuilderProducts(products, configured, "", "draft", published), [products[0]]);
  assert.deepEqual(filterMenuBuilderProducts(products, configured, "pots", "not-configured", published), [products[1]]);
  assert.deepEqual(filterMenuBuilderProducts(products, configured, "reception", "all", published), [products[0]]);
});

test("Published filter includes only products with a current verified Hub publication", () => {
  const products = [
    { itemId: "current", name: "Current", category: "Reception" },
    { itemId: "edited", name: "Edited", category: "Reception" },
    { itemId: "unverified", name: "Unverified", category: "Reception" },
  ];
  const configured = new Set(products.map(({ itemId }) => itemId));
  const published = new Set(["current"]);
  assert.deepEqual(filterMenuBuilderProducts(products, configured, "", "published", published), [products[0]]);
  assert.deepEqual(filterMenuBuilderProducts(products, configured, "", "draft", published), products.slice(1));
});

test("hospitality food products remain eligible for a dish menu", () => {
  for (const category of ["Finger Food", "Canapés", "Breakfast Pots", "", "Food & drink"] ) {
    assert.equal(menuChoicesForCategory(category), true, category);
  }
});
