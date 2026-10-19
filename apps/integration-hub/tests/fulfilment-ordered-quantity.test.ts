import assert from "node:assert/strict";
import test from "node:test";
import { fulfilmentFromProductionOrder, productionOrderFulfilmentContentHash } from "../../shared/fulfilment-requirement";

const order = (lines: Array<Record<string, unknown>>) => ({ canonicalId: "production-order:v1:booking:mnk:test", version: 1, origin: "hospitality_booking" as const, productionLocationId: "oploc:cpux", destinationOplocId: "oploc:angel", destinationLabel: "One Angel Court", serviceDate: "2026-11-24", requiredBy: "2026-11-24T10:00:00", serviceWindow: { startTime: "10:00" }, status: "ready", lines } as never);
const deli = { canonicalId: "line:deli", itemName: "Deli Style Sandwich Lunch", customerQuantity: 10, customerUnit: "Per person", productionQuantity: 30, productionUnit: "piece", sortOrder: 0 };

test("the fulfilment line keeps the operational 30 pieces and additionally carries the ordered 10 Per person", () => {
  const line = fulfilmentFromProductionOrder(order([deli]), "cpu").lines[0];
  assert.equal(line.quantity, 30);
  assert.equal(line.unit, "piece");
  assert.equal(line.orderedQuantity, 10);
  assert.equal(line.orderedUnit, "Per person");
});

test("ordered quantities are presentation-only: they never change the source content hash or trigger an amendment of an existing requirement", () => {
  const withoutOrdered = { ...deli, customerUnit: "" }; // a legacy line shape without customer unit carries no ordered fields
  const legacy = fulfilmentFromProductionOrder(order([withoutOrdered]), "cpu");
  assert.equal(legacy.lines[0].orderedQuantity, undefined);
  // Hash is computed from operational fields only.
  assert.equal(productionOrderFulfilmentContentHash(order([deli])), productionOrderFulfilmentContentHash(order([{ ...deli, customerQuantity: 10, customerUnit: "Per person" }])));
  const current = fulfilmentFromProductionOrder(order([deli]), "cpu");
  // Strip the ordered fields to emulate a requirement written before this change; re-deriving must return it unchanged (no new version).
  const previous = { ...current, lines: current.lines.map(({ orderedQuantity: _a, orderedUnit: _b, ...rest }) => rest) };
  const again = fulfilmentFromProductionOrder(order([deli]), "cpu", "2026-10-19T00:00:00.000Z", previous as never);
  assert.equal(again.version, previous.version, "no amendment and no new version for a presentation-only addition");
});
