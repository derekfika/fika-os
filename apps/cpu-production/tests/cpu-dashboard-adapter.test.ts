import assert from "node:assert/strict";
import test from "node:test";
import { cpuProjectionToOrders, filterCpuProjectionForScope } from "../lib/cpu-dashboard-adapter";
import type { CpuDayProjection } from "../lib/cpu-projection";

const projection = {
  serviceDate: "2026-10-26",
  revision: 1,
  lastChangeSequence: 1,
  rebuiltAt: "2026-10-22T10:00:00.000Z",
  orders: [{
    id: "production-order:deli-lunch",
    serviceDate: "2026-10-26",
    requiredBy: "2026-10-26T08:00:00",
    serviceWindow: { startTime: "12:00" },
    origin: "hospitality_booking",
    sourceReference: "booking:deli-lunch",
    priority: "normal",
    status: "accepted",
    productionScope: "sandwiches,hospitality",
    quantities: [
      { sourceLineId: "line:deli", name: "Deli Style Sandwich Lunch", quantity: 12, unit: "portion", dietaries: {} },
      { sourceLineId: "line:buffet", name: "Buffet Lunch", quantity: 8, unit: "portion", dietaries: {} },
    ],
    allergenReadiness: "ready",
    planningReadiness: "ready",
    attention: [],
    version: 1,
  }],
  summary: { orders: 1, ready: 1, attention: 0, planned: 0, totalUnits: 20 },
} as CpuDayProjection;

test("projection scopes honor per-line workstreams before hospitality origin", () => {
  const sandwiches = filterCpuProjectionForScope(projection, "sandwiches");
  const hospitality = filterCpuProjectionForScope(projection, "hospitality");
  assert.deepEqual(sandwiches.orders[0].quantities.map((line) => [line.name, line.quantity]), [["Deli Style Sandwich Lunch", 12]]);
  assert.deepEqual(hospitality.orders[0].quantities.map((line) => [line.name, line.quantity]), [["Buffet Lunch", 8]]);
  assert.equal(sandwiches.summary.totalUnits, 12);
  assert.equal(hospitality.summary.totalUnits, 8);
  assert.deepEqual(cpuProjectionToOrders(sandwiches).flatMap((order) => order.lines.map((line) => line.workstream)), ["sandwiches"]);
});

test("projection adapter keeps unassigned workstream positions aligned with quantities", () => {
  const source = structuredClone(projection);
  source.orders[0].productionScope = "sandwiches,unassigned,hospitality";
  source.orders[0].quantities.push({ sourceLineId: "line:other", name: "Fruit", quantity: 4, unit: "portion", dietaries: {} });
  const lines = cpuProjectionToOrders(source).flatMap((order) => order.lines);
  assert.deepEqual(lines.map((line) => line.workstream), ["sandwiches", "unassigned", "hospitality"]);
});

test("legacy projection scope prefers an explicit Sandwiches assignment over booking origin", () => {
  const legacy = structuredClone(projection);
  legacy.orders[0].productionScope = "sandwiches";
  legacy.orders[0].quantities = [legacy.orders[0].quantities[0]];
  assert.equal(filterCpuProjectionForScope(legacy, "sandwiches").orders.length, 1);
  assert.equal(filterCpuProjectionForScope(legacy, "hospitality").orders.length, 0);
});
