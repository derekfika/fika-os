import assert from "node:assert/strict";
import test from "node:test";
import { allergenPageState } from "../app/allergens/allergen-page-state";

const base = { date: "2027-01-04", projectionLoading: false, matrixLoading: false, projectionError: "", matrixError: "", orderCount: 0 };

test("allergen page distinguishes loading from a genuine empty result", () => {
  assert.equal(allergenPageState({ ...base, date: "", projectionLoading: true }), "loading");
  assert.equal(allergenPageState({ ...base, projectionLoading: true }), "loading");
  assert.equal(allergenPageState({ ...base, matrixLoading: true }), "loading");
  assert.equal(allergenPageState(base), "empty");
});

test("allergen page distinguishes projection and matrix failures from empty data", () => {
  assert.equal(allergenPageState({ ...base, projectionError: "network" }), "error");
  assert.equal(allergenPageState({ ...base, matrixError: "network" }), "error");
});

test("allergen page is ready only when data is loaded and non-empty", () => {
  assert.equal(allergenPageState({ ...base, orderCount: 1 }), "ready");
});
