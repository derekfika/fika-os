import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCpuDayProjection } from "../lib/cpu-projection";
import { cpuProjectionToOrders } from "../lib/cpu-dashboard-adapter";
import type { ProductionOrder } from "../lib/production-types";
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

test("CPU projection retains cancellation notices and excludes superseded work", () => {
  const cancelled = { ...order("order:cancelled"), status: "cancelled" as const };
  const superseded = { ...order("order:superseded"), supersededBy: "order:new" };
  const projection = buildCpuDayProjection("2026-08-24", [cancelled, superseded]);
  assert.equal(projection.orders.length, 1);
  assert.equal(projection.orders[0].id, "order:cancelled");
  assert.equal(projection.orders[0].status, "cancelled");
  assert.equal(projection.orders[0].cancellationNotice, "Booking cancelled in Manager dashboard.");
  assert.equal(projection.summary.orders, 1);
});

test("CPU all-day projection keeps the service date on each order", () => {
  const projection = buildCpuDayProjection("all", [order("order:1", "2026-08-24"), order("order:2", "2026-08-25")]);
  assert.deepEqual(projection.orders.map((item) => item.serviceDate), ["2026-08-24", "2026-08-25"]);
});

test("empty week projection is a valid zero-order package payload", () => {
  const projection = buildCpuDayProjection("all", [], [], 0, 1, "2026-08-31T10:00:00.000Z");
  assert.deepEqual(projection.orders, []);
  assert.deepEqual(projection.summary, { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 });
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

test("CPU projection preserves allergen review source identity and evidence", () => {
  const source = {
    ...order("order:allergen-context"),
    sourceEntityId: "menu-publication:1",
    sourcePublicationDayId: "menu-publication-day:1",
    sourceVersion: 4,
    sourceContentHash: "sha256:menu",
    lines: [{
      ...order("order:allergen-context").lines[0],
      canonicalId: "production-line:1",
      sourceBookingLineId: "booking-line:1",
      sourceMenuItemId: "menu-item:1",
      allergenEvidenceStatus: "confirmed" as const,
      approvedAllergenSnapshot: {
        allergens: { milk: "contains" },
        mayContainNotes: "Prepared in a shared kitchen.",
        sourcePublicationDayId: "menu-publication-day:1",
        sourceVersion: 4,
        sourceContentHash: "sha256:menu",
      },
    }],
  };
  const projection = buildCpuDayProjection("2026-08-24", [source]);
  const projected = projection.orders[0];
  const hydrated = cpuProjectionToOrders(projection)[0];
  assert.equal(projected.sourceEntityId, "menu-publication:1");
  assert.equal(projected.sourcePublicationDayId, "menu-publication-day:1");
  assert.equal(projected.sourceVersion, 4);
  assert.equal(projected.quantities[0].sourceLineId, "production-line:1");
  assert.equal(projected.quantities[0].sourceMenuItemId, "menu-item:1");
  assert.equal(projected.quantities[0].allergenEvidenceStatus, "confirmed");
  assert.deepEqual(projected.quantities[0].approvedAllergenSnapshot, source.lines[0].approvedAllergenSnapshot);
  assert.equal(hydrated.sourcePublicationDayId, "menu-publication-day:1");
  assert.equal(hydrated.lines[0].canonicalId, "production-line:1");
  assert.equal(hydrated.lines[0].sourceMenuItemId, "menu-item:1");
  assert.deepEqual(hydrated.lines[0].approvedAllergenSnapshot, source.lines[0].approvedAllergenSnapshot);
});
