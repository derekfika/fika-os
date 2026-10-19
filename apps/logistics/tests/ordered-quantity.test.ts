import assert from "node:assert/strict";
import test from "node:test";
import { lineBreakdown, lineDisplayText, orderedUnitLabel } from "../lib/ordered-quantity";
import { projectionToDashboardData } from "../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../lib/types";

const projection = (): LogisticsDayProjection => ({
  serviceDate: "2026-11-24", revision: 2, lastChangeSequence: 10, state: "CURRENT", deliveryLoads: [], runs: [], exceptions: [],
  planningQueue: [{
    id: "job:angel", sourceType: "cpu-production", sourceId: "order:angel", workstream: "Hospitality", serviceDate: "2026-11-24", destinationOplocId: "oploc:angel", destinationLabelSnapshot: "One Angel Court",
    requestedWindow: { startTime: "10:00", endTime: "11:00" }, productionReadiness: "ready", deliveryStatus: "pending", collectionStatus: "awaiting", totalUnits: 48, sourceVersion: 1, version: 1,
    contents: [
      { description: "Breakfast Pots", quantity: 12, unit: "Per pot - minimum 12 per item", orderedQuantity: 12, orderedUnit: "Per pot - minimum 12 per item" },
      { description: "Deli Style Sandwich Lunch", quantity: 30, unit: "piece", orderedQuantity: 10, orderedUnit: "Per person" },
      { description: "Fresh Squeezed & Pressed Juice", quantity: 4, unit: "Per bottle", orderedQuantity: 4, orderedUnit: "Per bottle" },
    ],
  }],
  summary: { queuedJobs: 1, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: "2026-10-19T08:00:00.000Z",
} as never);

test("Logistics shows the ordered catering quantity: Deli Style Sandwich Lunch — 10 pax", () => {
  const group = projectionToDashboardData(projection()).planner.workGroups[0];
  const texts = group.combinedLines.map(lineDisplayText);
  assert.ok(texts.includes("Deli Style Sandwich Lunch — 10 pax"), texts.join(" | "));
  assert.ok(texts.includes("Breakfast Pots — 12 pots"));
});

test("the operational production quantity (30 piece) is preserved on the line, and no incompatible units are summed into a generic total", () => {
  const group = projectionToDashboardData(projection()).planner.workGroups[0];
  const sandwich = group.combinedLines.find((line) => line.displayName === "Deli Style Sandwich Lunch")!;
  assert.equal(sandwich.quantity, 30);
  assert.equal(sandwich.unit, "piece");
  assert.ok(!group.unitBreakdown.some((item) => item.unit === "unit"), "no generic 'N unit' total");
  assert.deepEqual(group.unitBreakdown, [{ unit: "pots", quantity: 12 }, { unit: "pax", quantity: 10 }, { unit: "bottles", quantity: 4 }]);
});

test("lines without an ordered quantity (pre-existing requirements) keep their operational display and unit grouping", () => {
  const legacy = { lineKey: "k", displayName: "Mixed Leaf", unit: "portion", quantity: 7, requirementRefs: [], sourceLineRefs: [] };
  assert.equal(lineDisplayText(legacy), "7 portion · Mixed Leaf");
  assert.deepEqual(lineBreakdown([legacy, { ...legacy, lineKey: "k2", quantity: 3 }]), [{ unit: "portion", quantity: 10 }]);
});

test("unit labels: per-person units are pax; other units use their noun", () => {
  assert.equal(orderedUnitLabel("Per person", 10), "pax");
  assert.equal(orderedUnitLabel("Per pot - minimum 12 per item", 12), "pots");
  assert.equal(orderedUnitLabel("Box feeds 12 people", 2), "boxes");
  assert.equal(orderedUnitLabel("Per bottle", 1), "bottle");
});
