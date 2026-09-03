import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGrabAndGoCatalogueSource } from "../lib/grab-and-go-catalogue-source";

test("catalogue publication normalizes the approved legacy input envelope in memory", () => {
  const products = [{ productId: "grab:test", name: "Test", category: "grab_250ml", rotationWeeks: [1], allowedDeliveryWeekdays: ["Monday"], active: true, sortOrder: 1 }];
  assert.deepEqual(normalizeGrabAndGoCatalogueSource({ version: 1, source: "Master Grab n Go.xlsx", products }), { schemaVersion: 1, products });
});

test("catalogue publication leaves package-shaped input unchanged", () => {
  const value = { schemaVersion: 1, products: [] };
  assert.deepEqual(normalizeGrabAndGoCatalogueSource(value), value);
});
