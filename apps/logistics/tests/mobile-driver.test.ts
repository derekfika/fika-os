import test from "node:test";
import assert from "node:assert/strict";
import type { DeliveryStop } from "../lib/types";
import { driverIssueTypes, restoredStopStatus, showDispatchChecklist, stopCounts, stopIsCollection } from "../lib/mobile-driver";
import { liveRunStatus, liveStopStatus } from "../lib/planner-read-model";

const stop = (id: string, status: DeliveryStop["status"], extra: Partial<DeliveryStop> = {}): DeliveryStop => ({
  canonicalId: id,
  runId: "run:test",
  sequence: 1,
  locationOplocId: "oploc:test",
  locationLabelSnapshot: "Test site",
  requirementRefs: [],
  movementRequestIds: [],
  status,
  version: 1,
  createdAt: "now",
  updatedAt: "now",
  audit: [],
  ...extra,
});

test("delivery completion can undo back to its previous active state", () => {
  const completed = stop("delivery", "completed", { completedFromStatus: "planned" });
  assert.equal(restoredStopStatus(completed), "planned");
  assert.equal(restoredStopStatus(stop("arrived-completion", "completed", { completedFromStatus: "arrived" })), "arrived");
});

test("completed deliveries and collections remain countable and visible", () => {
  const deliveries = [stop("delivery-active", "planned"), stop("delivery-done", "completed", { completedFromStatus: "arrived" })];
  const collections = [stop("collection-active", "arrived", { movementType: "collection" }), stop("collection-done", "completed", { movementType: "collection", completedFromStatus: "arrived" })];
  assert.deepEqual(stopCounts(deliveries), { total: 2, remaining: 1, completed: 1 });
  assert.deepEqual(stopCounts(collections), { total: 2, remaining: 1, completed: 1 });
  assert.equal(stopIsCollection(collections[0]), true);
  assert.equal(deliveries.some((item) => item.status === "completed"), true);
});

test("dispatch checklist only appears before dispatch", () => {
  assert.equal(showDispatchChecklist("planned"), true);
  assert.equal(showDispatchChecklist("ready"), true);
  assert.equal(showDispatchChecklist("dispatched"), false);
  assert.equal(showDispatchChecklist("completed"), false);
});

test("driver issue flow exposes structured categories", () => {
  assert.deepEqual(driverIssueTypes, [
    "Cannot access building",
    "Customer unavailable",
    "Missing / incorrect load",
    "Running late",
    "Vehicle issue",
    "Other",
  ]);
});

test("live stop and run status distinguish dispatch, delivery, collection and attention", () => {
  const base = { attention: [], lane: "delivery" as const, movementTypes: ["delivery" as const] };
  assert.equal(liveStopStatus({ ...base, status: "planned" }, "dispatched"), "dispatched");
  assert.equal(liveStopStatus({ ...base, status: "arrived" }, "dispatched"), "in_progress");
  assert.equal(liveStopStatus({ ...base, status: "completed" }, "dispatched"), "delivered");
  assert.equal(liveStopStatus({ ...base, status: "completed", lane: "collection", movementTypes: ["collection"] }, "dispatched"), "collected");
  assert.equal(liveStopStatus({ ...base, status: "issue", attention: ["Access"] }, "dispatched"), "attention");
});

test("run progress is independent from individual stop completion", () => {
  const stops = [
    { operationalStatus: "delivered" as const },
    { operationalStatus: "dispatched" as const },
    { operationalStatus: "collected" as const },
  ];
  assert.equal(liveRunStatus({ status: "dispatched" }, stops), "in_progress");
  assert.equal(liveRunStatus({ status: "dispatched", returnToCpuPending: true }, [{ operationalStatus: "delivered" }]), "returning_to_cpu");
  assert.equal(liveRunStatus({ status: "completed", returnedToCpuAt: "now" }, [{ operationalStatus: "delivered" }]), "returned");
  assert.equal(liveRunStatus({ status: "completed" }, [{ operationalStatus: "delivered" }]), "complete");
  assert.equal(liveRunStatus({ status: "dispatched" }, [{ operationalStatus: "attention" }]), "attention");
});

test("reopening a stop removes return readiness", () => {
  const completed = [{ operationalStatus: "delivered" as const }, { operationalStatus: "collected" as const }];
  const reopened = [{ operationalStatus: "delivered" as const }, { operationalStatus: "in_progress" as const }];
  assert.equal(liveRunStatus({ status: "dispatched", returnToCpuPending: true }, completed), "returning_to_cpu");
  assert.equal(liveRunStatus({ status: "dispatched", returnToCpuPending: false }, reopened), "in_progress");
});
