import assert from "node:assert/strict";
import { test } from "node:test";
import { normaliseDishName, titleCase } from "../lib/text";

test("titleCase normalises menu names while preserving useful separators", () => {
  assert.equal(titleCase("  vegan feta, pesto / green salad "), "Vegan Feta, Pesto / Green Salad");
  assert.equal(titleCase("honey-mustard & egg mayo"), "Honey-Mustard & Egg Mayo");
});

test("normaliseDishName preserves spelling, capitalisation and punctuation", () => {
  assert.equal(normaliseDishName("  avocordo,corriander &  lime  "), "avocordo,corriander &  lime");
});
