import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCpuDayProjection } from "../lib/cpu-projection";
import { cpuProjectionToOrders } from "../lib/cpu-dashboard-adapter";
import type { ProductionOrder } from "@hub/lib/production-domain";
import type { ProductionPlan } from "../app/lib/production-plan";

const order = (id: string, date = "2026-08-24"): ProductionOrder => ({
  canonicalId: id, entityType: "Production Order", schemaVersion: "0.1.0", version: 3,
  requirementIds: [], sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: "quote:1",
  serviceDate: date, requiredBy: `${date}T11:30`, serviceWindow: { startTime: "11:30" },
  status: "accepted", priority: "normal", origin: "hospitality_booking", guestCount: 10,
  destinationOplocId: "oploc:angel", destinationLabel: "Angel Court", clientName: "FIKA",
  lines: [{ canonicalId: `${id}:line:1`, sourceBookingLineId: "line:1", itemName: "Lunch", customerQuantity: 10, customerUnit: "portion", productionQuantity: 10, productionUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 }],
  exceptions: [], currentRevision: 3, createdAt: "now", createdBy: "test", idempotencyKey: id, externalReferences: [], audit: [],
});

const plan = (orderId: string): ProductionPlan => ({ id: `plan:${orderId}`, orderId, status: "planned", menuItems: [], planningNotes: "", updatedAt: "now", updatedBy: "chef", audit: [] });

test("CPU projection merges canonical orders with plan workflow state", () => {
  const projection = buildCpuDayProjection("2026-08-24", [order("order:1"), order("order:2", "2026-08-25")], [plan("order:1")], 17);
  assert.equal(projection.orders.length, 1);
  assert.equal(projection.orders[0].workflowStatus, "planned");
  assert.equal(projection.orders[0].destinationLabel, "Angel Court");
  assert.equal(projection.lastChangeSequence, 17);
  assert.equal(projection.summary.totalUnits, 10);
});

test("CPU projection excludes superseded and cancelled canonical work", () => {
  const cancelled = { ...order("order:cancelled"), status: "cancelled" as const };
  const superseded = { ...order("order:superseded"), supersededBy: "order:new" };
  const projection = buildCpuDayProjection("2026-08-24", [cancelled, superseded]);
  assert.deepEqual(projection.orders, []);
  assert.equal(projection.summary.orders, 0);
});

test("CPU all-day projection keeps the service date on each order", () => {
  const projection = buildCpuDayProjection("all", [order("order:1", "2026-08-24"), order("order:2", "2026-08-25")]);
  assert.deepEqual(projection.orders.map((item) => item.serviceDate), ["2026-08-24", "2026-08-25"]);
});

test("CPU projection preserves booking dietary and note context", () => {
  const source = { ...order("order:context"), bookingDietaries: { vegetarian: 3, gluten_free: 1 }, bookingNotes: "Use the side entrance.", lines: [{ ...order("order:context").lines[0], productionQuantity: 24, productionUnit: "piece", dietaries: { vegetarian: 3 }, productionInstructions: "Label each portion." }] };
  const projection = buildCpuDayProjection("2026-08-24", [source]);
  const hydrated = cpuProjectionToOrders(projection)[0];
  assert.deepEqual(projection.orders[0].bookingDietaries, { vegetarian: 3, gluten_free: 1 });
  assert.equal(projection.orders[0].bookingNotes, "Use the side entrance.");
  assert.equal(projection.orders[0].quantities[0].quantity, 10);
  assert.equal(projection.orders[0].quantities[0].productionQuantity, 24);
  assert.deepEqual(hydrated.lines[0].dietaries, { vegetarian: 3 });
  assert.equal(hydrated.lines[0].productionInstructions, "Label each portion.");
});
