import test from "node:test";
import assert from "node:assert/strict";
import type { ProductionOrder } from "../lib/production-types";
import { cpuAttentionLabel, cpuLifecycle, cpuLifecycleLabels, cpuRequiredTime, cpuServiceWindow, cpuSourceLabel } from "../lib/production-presentation";

function order(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    canonicalId: "production-order:test",
    entityType: "Production Order",
    schemaVersion: "0.1.0",
    version: 1,
    requirementIds: [],
    sourceBookingId: "booking:test",
    sourceQuoteRevisionId: "quote:test",
    productionLocationId: "oploc:cpu",
    destinationOplocId: "oploc:site",
    destinationLabel: "Site",
    requiredBy: "2026-08-24T09:00:00",
    serviceWindow: { startTime: "12:00" },
    status: "draft",
    priority: "normal",
    lines: [],
    exceptions: [],
    origin: "hospitality_booking",
    currentRevision: 1,
    createdAt: "2026-08-21T00:00:00Z",
    createdBy: "test",
    idempotencyKey: "presentation-test",
    externalReferences: [],
    audit: [],
    ...overrides,
  };
}

test("CPU presentation exposes one common lifecycle while retaining source state as attention", () => {
  assert.equal(cpuLifecycle(order({ status: "draft" })), "received");
  assert.equal(cpuLifecycle(order({ status: "planned" })), "planned");
  assert.equal(cpuLifecycle(order({ status: "scheduled" })), "ready");
  assert.equal(cpuLifecycle(order({ status: "in_production" })), "in_production");
  assert.equal(cpuLifecycle(order({ status: "needs_review" })), "received");
  assert.equal(cpuAttentionLabel(order({ status: "needs_review" })), "Needs review");
  assert.deepEqual(Object.values(cpuLifecycleLabels), ["Received", "Accepted", "Planning", "Planned", "Ready", "In production", "Complete"]);
});

test("CPU presentation names source, destination timing, and exceptions explicitly", () => {
  assert.equal(cpuSourceLabel(order({ origin: "grab_and_go" })), "Grab & Go order");
  assert.equal(cpuSourceLabel(order({ origin: "menu_planning" })), "Published menu");
  assert.equal(cpuRequiredTime(order({ requiredBy: "" })), "Time TBC");
  assert.equal(cpuRequiredTime(order({ requiredBy: "2026-08-24T00:00" })), "Time TBC");
  assert.equal(cpuAttentionLabel(order({ status: "blocked" })), "Blocked");
});

test("CPU presentation tolerates legacy orders without a service window", () => {
  assert.equal(cpuServiceWindow(order({ serviceWindow: undefined as never })), "Time TBC");
});
