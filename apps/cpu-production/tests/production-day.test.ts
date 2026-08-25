import test from "node:test";
import assert from "node:assert/strict";
import type { ProductionOrder } from "@hub/lib/production-domain";
import { aggregateDeliveredIn, categorySummary, deliveredInTotals, firstDeliveredInOrder, groupByRequiredTime, orderSummary } from "../lib/production-day";
import { readFileSync } from "node:fs";
import { buildAllergenReviewRows, buildDeliveredInAllergenReview, buildDeliveredInDishRows } from "../lib/production-day";

function order(destinationLabel: string, quantity: number, sourceMenuItemId = "dish:leaf"): ProductionOrder {
  return { canonicalId: `production-order:${destinationLabel}`, entityType: "Production Order", schemaVersion: "0.1.0", version: 1, requirementIds: [], sourceBookingId: "production-order:test", sourceQuoteRevisionId: "", sourceEntityId: "rolling-week:day:1", sourceVersion: 1, destinationOplocId: `oploc:${destinationLabel.toLowerCase()}`, destinationLabel, serviceDate: "2026-08-24", requiredBy: "2026-08-24T00:00", serviceWindow: { startTime: "00:00" }, status: "menu_available", priority: "normal", lines: [{ canonicalId: `${destinationLabel}:line`, sourceBookingLineId: `${destinationLabel}:source`, sourceMenuItemId, itemName: "Mixed Baby Leaf", customerQuantity: quantity, customerUnit: "portion", productionQuantity: quantity, productionUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0, workstream: "delivered_in" }], exceptions: [], origin: "menu_planning", currentRevision: 1, createdAt: "2026-08-21T00:00:00Z", createdBy: "test", idempotencyKey: `test:${destinationLabel}`, externalReferences: [], audit: [] };
}

test("Delivered-In day aggregation consolidates the same dish across destination allocations", () => {
  const rows = aggregateDeliveredIn([order("Haleon", 10), order("FIKA Xchange", 10), order("Angel Court", 15)]);
  assert.deepEqual(rows, [{ key: "dish:leaf", dishName: "Mixed Baby Leaf", total: 35, destinations: [{ label: "Angel Court", quantity: 15 }, { label: "FIKA Xchange", quantity: 10 }, { label: "Haleon", quantity: 10 }] }]);
});

test("Day grouping keeps operational times and compact quantities separate from dish detail", () => {
  const first = { ...order("Haleon", 10), requiredBy: "2026-08-24T08:00" };
  const second = { ...order("FIKA Xchange", 10), canonicalId: "production-order:fika", requiredBy: "2026-08-24T08:00" };
  assert.equal(orderSummary(first), "10 portions ordered · 1 line");
  assert.equal(groupByRequiredTime([first, second])[0].orders.length, 2);
});

test("Day Delivered-In action opens the canonical Production Order used by the detail", () => {
  const menuOrders = [order("Haleon", 10), order("FIKA Xchange", 10)];
  assert.equal(firstDeliveredInOrder(menuOrders)?.canonicalId, "production-order:Haleon");
  assert.equal(categorySummary(menuOrders), "1 production job · 20 lunch portions");
  const view = readFileSync(new URL("../app/ui/ProductionDayView.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(view, /Open production/);
  assert.match(view, /open\(deliveredInOrder\)/);
  assert.match(page, /<DeliveredInProductionDetail/);
  assert.match(page, /<Queue orders=\{visible\} open=\{openOrder\}/);
  assert.match(page, /<ProductionCalendar orders=\{baseVisible\}/);
});

test("Golden Week Monday Delivered-In detail totals aggregate to 315 portions, 15 dishes, and 2 destinations", () => {
  const line = (index: number, quantity: number, snapshot?: Record<string, string>) => ({ canonicalId: `line:${index}`, sourceBookingLineId: `source:${index}`, sourceMenuItemId: `dish:${index}`, itemName: `Dish ${index}`, customerQuantity: quantity, customerUnit: "portion", productionQuantity: quantity, productionUnit: "portion", dietaries: {}, status: "ready" as const, sortOrder: index, workstream: "delivered_in" as const, ...(snapshot ? { approvedAllergenSnapshot: { allergens: snapshot } } : {}) });
  const left = { ...order("Haleon", 0), lines: Array.from({ length: 8 }, (_, index) => line(index, 20)) };
  const right = { ...order("FIKA Xchange", 0), canonicalId: "production-order:xchange", lines: Array.from({ length: 7 }, (_, index) => line(index + 8, index === 0 ? 35 : 20)) };
  assert.deepEqual(deliveredInTotals([left, right]), { portions: 315, dishes: 15, destinations: 2 });
  assert.equal(buildDeliveredInDishRows([left, right]).length, 15);
});

test("Delivered-In matrix keeps one row per dish and preserves contains/may-contain states", () => {
  const make = (destinationLabel: string, state: string) => ({ ...order(destinationLabel, 10), lines: [{ ...order(destinationLabel, 10).lines[0], sourceMenuItemId: "dish:shared", approvedAllergenSnapshot: { allergens: { mustard: state } }, allergenEvidenceStatus: "confirmed" as const }] });
  const rows = buildDeliveredInDishRows([make("Haleon", "contains"), make("FIKA Xchange", "may_contain")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshot?.allergens.mustard, "contains");
});

test("published day fixture consolidates three dishes across two destination orders", () => {
  const make = (destinationLabel: string, destinationQuantity: number, index: number, allergens: Record<string, string>) => ({ ...order(destinationLabel, 0, `dish:${index}`), sourcePublicationDayId: "menu-publication: monday:v1", sourceContentHash: "hash:monday:v1", lines: [{ ...order(destinationLabel, 0, `dish:${index}`).lines[0], canonicalId: `${destinationLabel}:line:${index}`, sourceBookingLineId: `menu-entry:${index}`, sourceMenuItemId: `dish:${index}`, itemName: `Dish ${index}`, customerQuantity: destinationQuantity, approvedAllergenSnapshot: { allergens, sourcePublicationDayId: "menu-publication: monday:v1", sourceVersion: 1, sourceContentHash: "hash:monday:v1" }, allergenEvidenceStatus: "confirmed" as const }] });
  const orders = [make("Destination A", 10, 1, { milk: "contains" }), make("Destination A", 12, 2, { gluten: "contains", sesame: "may_contain" }), make("Destination A", 8, 3, { no_key_allergens: "contains" }), make("Destination B", 5, 1, { milk: "contains" }), make("Destination B", 6, 2, { gluten: "contains", sesame: "may_contain" }), make("Destination B", 4, 3, { no_key_allergens: "contains" })];
  const review = buildDeliveredInAllergenReview(orders);
  assert.equal(review?.orders.length, 6);
  assert.equal(review?.destinations.length, 2);
  assert.equal(review?.rows.length, 3);
  assert.equal(review?.rows.reduce((sum, row) => sum + row.quantity, 0), 45);
  assert.equal(buildAllergenReviewRows(orders).length, 3);
});

test("conflicting published snapshots block the consolidated review instead of being merged", () => {
  const make = (state: string) => ({ ...order("Haleon", 10), sourcePublicationDayId: "menu-publication: monday:v1", lines: [{ ...order("Haleon", 10).lines[0], sourceMenuItemId: "dish:shared", approvedAllergenSnapshot: { allergens: { mustard: state }, sourcePublicationDayId: "menu-publication: monday:v1", sourceVersion: 1, sourceContentHash: "hash:monday:v1" }, allergenEvidenceStatus: "confirmed" as const }] });
  const rows = buildAllergenReviewRows([make("contains"), { ...make("may_contain"), canonicalId: "production-order:xchange", destinationLabel: "FIKA Xchange" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshotMismatch?.detail, "Published allergen snapshot mismatch between destination Production Orders.");
  assert.equal(rows[0].attention, true);
});
