import assert from "node:assert/strict";
import test from "node:test";
import { productionItemId } from "../../shared/production-item-id";

test("identical saved item titles remain independent under different menu parents", () => {
  assert.notEqual(
    productionItemId("Test Salad", "deli-style-sandwich-lunch"),
    productionItemId("Test Salad", "salad-protein-lunch-platter"),
  );
});
