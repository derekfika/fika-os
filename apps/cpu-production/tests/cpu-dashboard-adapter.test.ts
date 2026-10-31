import assert from "node:assert/strict";
import test from "node:test";
import { cpuProjectionHasAmbiguousWorkstreamMapping, cpuProjectionToOrders, filterCpuProjectionForScope } from "../lib/cpu-dashboard-adapter";
import type { CpuDayProjection } from "../lib/cpu-projection";
import { aggregateProductionTotals } from "../lib/production-day";

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

test("mixed legacy Sandwiches and Hospitality projection is withheld for authoritative recovery", () => {
  const legacy = structuredClone(projection);
  legacy.orders[0].productionScope = "sandwiches,hospitality";
  legacy.orders[0].quantities.push({ sourceLineId: "line:unassigned", name: "Fruit", quantity: 4, unit: "portion", dietaries: {} });

  assert.equal(cpuProjectionHasAmbiguousWorkstreamMapping(legacy), true);
  const sandwiches = filterCpuProjectionForScope(legacy, "sandwiches");
  const hospitality = filterCpuProjectionForScope(legacy, "hospitality");
  assert.deepEqual(sandwiches.orders, []);
  assert.deepEqual(hospitality.orders, []);
  assert.equal(sandwiches.summary.totalUnits, 0);
  assert.equal(hospitality.summary.totalUnits, 0);
});

test("Ad-Hoc day/week projections stay whole in Hospitality, preserve cancellations, and contribute totals once", () => {
  const source = structuredClone(projection);
  source.orders = [
    { ...source.orders[0], id: "production-order:v1:ad-hoc:request:1", origin: "cpu_created", productionCategory: "grab_and_go", productionScope: "sandwiches,delivered_in,grab_and_go", quantities: [
      { sourceLineId: "adhoc:line:1", name: "Sandwich", quantity: 2, unit: "pieces", dietaries: {} },
      { sourceLineId: "adhoc:line:2", name: "Lunch", quantity: 3, unit: "portions", dietaries: {} },
      { sourceLineId: "adhoc:line:3", name: "Fruit", quantity: 2, unit: "items", dietaries: {} },
    ] },
    { ...source.orders[0], id: "production-order:v1:ad-hoc:request:cancelled", origin: "cpu_created", productionCategory: "delivered_in", status: "cancelled", workflowStatus: "cancelled", cancellationNotice: "Cancelled by requester", productionScope: "delivered_in", quantities: [{ sourceLineId: "adhoc:cancelled:line", name: "Historical line", quantity: 99, unit: "portions", dietaries: {} }] },
  ];
  source.summary = { orders: 2, ready: 1, attention: 0, planned: 0, totalUnits: 106 };

  const hospitality = filterCpuProjectionForScope(source, "hospitality");
  assert.equal(hospitality.orders.length, 2);
  assert.equal(hospitality.summary.orders, 2);
  assert.equal(hospitality.summary.totalUnits, 106);
  assert.deepEqual(hospitality.orders[0].quantities.map(line => [line.sourceLineId, line.quantity]), [["adhoc:line:1", 2], ["adhoc:line:2", 3], ["adhoc:line:3", 2]]);
  assert.equal(hospitality.orders[1].status, "cancelled");
  assert.equal(hospitality.orders[1].workflowStatus, "cancelled");
  assert.equal(hospitality.orders[1].cancellationNotice, "Cancelled by requester");

  for (const scope of ["sandwiches", "delivered_in", "grab_and_go"] as const) {
    const filtered = filterCpuProjectionForScope(source, scope);
    assert.deepEqual(filtered.orders, []);
    assert.equal(filtered.summary.orders, 0);
    assert.equal(filtered.summary.totalUnits, 0);
  }

  const totals = aggregateProductionTotals(cpuProjectionToOrders(hospitality));
  assert.deepEqual(totals.map(({ category, orderCount, items }) => [category, orderCount, items.reduce((sum, item) => sum + item.quantity, 0)]), [["Hospitality", 1, 7]]);
  assert.equal(filterCpuProjectionForScope(source, "all"), source);
});

test("ordinary cpu_created projection is not treated as Ad-Hoc", () => {
  const ordinary = structuredClone(projection);
  ordinary.orders[0].id = "production-order:v1:cpu:ordinary";
  ordinary.orders[0].origin = "cpu_created";
  ordinary.orders[0].productionCategory = "other";
  ordinary.orders[0].productionScope = "unassigned,unassigned";

  assert.deepEqual(filterCpuProjectionForScope(ordinary, "hospitality").orders, []);
  assert.equal(filterCpuProjectionForScope(ordinary, "delivered_in").orders.length, 1);
});
