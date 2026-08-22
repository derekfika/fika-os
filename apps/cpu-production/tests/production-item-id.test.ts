import assert from "node:assert/strict";
import test from "node:test";
import { productionItemId } from "../lib/production-item-id";

test("saved production item IDs include the parent menu scope", () => {
  assert.notEqual(productionItemId("Test Salad", "deli-style-sandwich"), productionItemId("Test Salad", "salad-protein-platter"));
  assert.equal(productionItemId("Test Salad", "deli-style-sandwich"), "sandwich:deli-style-sandwich:test-salad");
});
