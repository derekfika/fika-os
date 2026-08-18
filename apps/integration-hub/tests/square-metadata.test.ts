import assert from "node:assert/strict";
import test from "node:test";
import { squareFixture } from "../fixtures/square";
import { squareObjects } from "../lib/connectors/square";

test("Square Till Items retain category, location, tax and modifier context", () => {
  const objects = squareObjects({ mode: "fixture", ...squareFixture, fullReconciliation: true });
  const item = objects.items[0];
  assert.equal(item.name, "Synthetic Flat White");
  assert.equal(item.categoryReferences[0].name, "Hot Drinks");
  assert.equal(item.taxReferences[0].name, "VAT");
  assert.equal(item.modifierListReferences[0].name, "Milk");
  assert.equal(item.locationAvailability.presentAtAllLocations, false);
  assert.equal(item.description, "Synthetic espresso with steamed milk");
});

test("Square Till Item Variations retain base and location-specific pricing", () => {
  const objects = squareObjects({ mode: "fixture", ...squareFixture, fullReconciliation: true });
  const variation = objects.variations[0];
  assert.deepEqual(variation.basePrice, { amount: 350, currency: "GBP" });
  assert.equal(variation.locationPrices[0].locationName, "Synthetic Riverside Till");
  assert.equal(variation.locationPrices[0].amount, 375);
  assert.equal(variation.pricingType, "FIXED_PRICING");
});
