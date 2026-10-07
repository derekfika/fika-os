import assert from "node:assert/strict";
import test from "node:test";
import { productionQuantitySummary } from "../lib/production-day";
import type { ProductionLine } from "../lib/production-types";
const line = (productionQuantity?: number, productionUnit?: string) => ({ customerQuantity: 12, customerUnit: "portion", productionQuantity, productionUnit }) as ProductionLine;

test("Hospitality calendar uses 36 production pieces independently of 12 commercial portions", () => {
  assert.equal(productionQuantitySummary({ lines: [line(36, "piece")] }), "36 piece");
});
test("production totals combine matching units and preserve unlike units", () => {
  assert.equal(productionQuantitySummary({ lines: [line(36, "piece"), line(12, "piece"), line(2, "tray")] }), "48 piece · 2 tray");
});
test("unconfigured production quantity is explicit rather than inferred from ordered portions", () => {
  assert.equal(productionQuantitySummary({ lines: [line()] }), "1 line not configured");
  assert.equal(productionQuantitySummary({ lines: [line(36, "piece"), line(12)] }), "36 piece · 1 line not configured");
});
test("zero is valid and invalid production values remain unconfigured", () => {
  assert.equal(productionQuantitySummary({ lines: [line(0, "piece")] }), "0 piece");
  assert.equal(productionQuantitySummary({ lines: [line(NaN, "piece"), line(-1, "piece")] }), "2 lines not configured");
  assert.equal(productionQuantitySummary({ lines: [] }), "No production quantities");
});
