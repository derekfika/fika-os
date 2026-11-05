import test from "node:test";
import assert from "node:assert/strict";
import type { ProductionOrder } from "../lib/production-types";
import { cpuAttentionKey, cpuAttentionLabel, cpuAttentionReasons, cpuLifecycle, cpuLifecycleLabels, cpuRequiredTime, cpuServiceWindow, cpuSourceLabel, isAdHocProductionOrder, isAdHocProductionOrderId } from "../lib/production-presentation";
import { readFileSync } from "node:fs";

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
  assert.deepEqual(Object.values(cpuLifecycleLabels), ["Received", "Accepted", "Planning", "Planned", "Ready", "In production", "Complete", "Cancelled"]);
});

test("CPU presentation names source, destination timing, and exceptions explicitly", () => {
  assert.equal(cpuSourceLabel(order({ origin: "grab_and_go" })), "Grab & Go order");
  assert.equal(cpuSourceLabel(order({ origin: "menu_planning" })), "Published menu");
  assert.equal(cpuRequiredTime(order({ requiredBy: "" })), "Time TBC");
  assert.equal(cpuRequiredTime(order({ requiredBy: "2026-08-24T00:00" })), "Time TBC");
  assert.equal(cpuAttentionLabel(order({ status: "blocked" })), "Blocked");
});

test("amended draft workflow is presented for review instead of as ready or ordinary planning", () => {
  const orderNeedingReview = order({ status: "draft", workflowStatus: "amended", version: 2 });
  assert.equal(cpuAttentionLabel(orderNeedingReview), "Needs review");
  assert.equal(cpuAttentionKey(orderNeedingReview), "needs_review");
  assert.deepEqual(cpuAttentionReasons(orderNeedingReview), ["Needs review", "Amended"]);
});

test("missing production quantities are explicit and never inferred from ordered customer portions", () => {
  const incomplete = order({
    status: "draft",
    lines: [
      { canonicalId: "line:missing", sourceBookingLineId: "source:missing", itemName: "Lunch", customerQuantity: 12, customerUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 },
      { canonicalId: "line:configured", sourceBookingLineId: "source:configured", itemName: "Soup", customerQuantity: 12, customerUnit: "portion", productionQuantity: 42, productionUnit: "piece", dietaries: {}, status: "ready", sortOrder: 1 },
    ],
  });
  assert.deepEqual(cpuAttentionReasons(incomplete), ["Missing production quantities · 1 line"]);
  assert.equal(cpuAttentionKey(incomplete), "missing_quantities");
  assert.equal(cpuAttentionLabel(order({ status: "cancelled", lines: incomplete.lines })), "");
});

test("dashboard cards and order detail expose review and unconfigured production quantities", () => {
  const calendar = readFileSync(new URL("../app/ui/ProductionCalendar.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../app/ui/ProductionOrderDetail.tsx", import.meta.url), "utf8");
  assert.match(calendar, /cpuAttentionReasons\(order\)/);
  assert.match(detail, /Production quantities/);
  assert.match(detail, /Not configured/);
  assert.match(detail, /customer portions are not substituted/);
});

test("only the canonical Ad-Hoc order namespace gets the Ad-Hoc source label", () => {
  const adHoc = order({ canonicalId: "production-order:v1:ad-hoc:request:1", origin: "cpu_created", productionCategory: "grab_and_go" });
  assert.equal(isAdHocProductionOrderId(adHoc.canonicalId), true);
  assert.equal(isAdHocProductionOrder(adHoc), true);
  assert.equal(cpuSourceLabel(adHoc), "Ad-Hoc");

  const ordinaryCpuCreated = order({ canonicalId: "production-order:v1:cpu:manual", origin: "cpu_created", productionCategory: "other" });
  assert.equal(isAdHocProductionOrder(ordinaryCpuCreated), false);
  assert.equal(cpuSourceLabel(ordinaryCpuCreated), "CPU-created work");

  const detail = readFileSync(new URL("../app/ui/ProductionOrderDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /cpuSourceLabel\(order\)/);
  assert.doesNotMatch(detail, /sourceLabel\(order\.origin\)/);
});

test("CPU presentation tolerates legacy orders without a service window", () => {
  assert.equal(cpuServiceWindow(order({ serviceWindow: undefined as never })), "Time TBC");
});

test("withdrawn CPU orders never fall through to Received across canonical and workflow status combinations", () => {
  for (const candidate of [
    order({ status: "cancelled" }),
    order({ status: "planned", workflowStatus: "cancelled" }),
    order({ status: "cancelled", workflowStatus: "planned", cancellationNotice: "Booking cancelled" }),
    order({ status: "accepted", supersededBy: "production-order:replacement" }),
  ]) assert.equal(cpuLifecycle(candidate), "cancelled");
  assert.equal(cpuLifecycle(order({ status: "accepted", workflowStatus: "planned" })), "planned");
  assert.equal(cpuLifecycle(order({ status: "needs_review", cancellationNotice: "Investigate" })), "received");
});
