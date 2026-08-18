import assert from "node:assert/strict";
import { test } from "node:test";
import { titleCase } from "../lib/text";

test("titleCase normalises menu names while preserving useful separators", () => {
  assert.equal(titleCase("  vegan feta, pesto / green salad "), "Vegan Feta, Pesto / Green Salad");
  assert.equal(titleCase("honey-mustard & egg mayo"), "Honey-Mustard & Egg Mayo");
});
