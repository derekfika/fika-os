import assert from "node:assert/strict";
import test from "node:test";
import { projectionToDashboardData } from "../lib/projection-dashboard-adapter";
import { untimedAssignedDeliveryStop, workGroupQueueState } from "../lib/planner-read-model";
import type { LogisticsDayProjection } from "../lib/types";

const base = (): LogisticsDayProjection => ({
  serviceDate: "2026-09-17", revision: 2, lastChangeSequence: 10, state: "CURRENT",
  planningQueue: [], deliveryLoads: [], runs: [], exceptions: [],
  summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: "2026-09-17T08:00:00.000Z",
});

test("an authoritative empty projection stays empty and does not invent a van", () => {
  const result = projectionToDashboardData(base());
  assert.deepEqual(result.runs, []);
  assert.deepEqual(result.stops, []);
  assert.equal(result.planner.summary.loads, 0);
});

test("a load whose run is absent never leaks onto another canonical run", () => {
  const projection = base();
  projection.runs = [{ canonicalId: "run:other", status: "planned", vehicleLabel: "Van 1" }];
  projection.deliveryLoads = [{
    id: "load:one", serviceDate: projection.serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:site",
    scheduledTime: "10:00", status: "planned", runId: "run:missing", vehicleId: "van:two", jobs: [], jobCount: 0,
    totalUnits: 0, collectedCount: 0, readiness: "ready",
  }];
  const result = projectionToDashboardData(projection);
  assert.equal(result.stops[0].runId, "run:missing");
  assert.equal(result.runs.find((run) => run.canonicalId === "run:missing")?.vehicleLabel, "van:two");
  assert.equal(result.runs.find((run) => run.canonicalId === "run:other")?.orderedStopIds.length, 0);
});

test("projection carries explicit workstream into queue and assigned stop labels", () => {
  const projection = base();
  projection.planningQueue = [{ id: "job:queue", sourceType: "cpu-production", sourceId: "order:queue", workstream: "Hospitality", serviceDate: projection.serviceDate, destinationOplocId: "oploc:site", destinationLabelSnapshot: "Commerzbank", requestedWindow: { startTime: "07:00" }, productionReadiness: "ready", collectionStatus: "awaiting", contents: [{ description: "Lunch", quantity: 12, unit: "portion" }], totalUnits: 12 }];
  projection.runs = [{ canonicalId: "run:one", serviceDate: projection.serviceDate, status: "planned", vehicleLabel: "Van 1", orderedStopIds: [], version: 1, createdAt: "now", updatedAt: "now", audit: [] }];
  const result = projectionToDashboardData(projection);
  assert.deepEqual(result.planner.workGroups[0].sourceLabels, ["Hospitality"]);
  assert.equal(result.planner.workGroups[0].requirementRefs[0].workstream, "Hospitality");
  assert.deepEqual(result.planner.workGroups[0].combinedLines.map(line => [line.displayName, line.quantity, line.unit]), [["Lunch", 12, "portion"]]);
  assert.deepEqual(result.planner.workGroups[0].deliveryWindow, { startTime: "07:00" });
});

test("assigned untimed delivery stays reachable with merged canonical authority after projection reload", () => {
  const projection = base();
  projection.runs = [{ canonicalId: "run:two", serviceDate: projection.serviceDate, status: "planned", vehicleLabel: "Van 2", version: 2 }];
  projection.deliveryLoads = [{
    id: "group:stable", loadIds: ["load:a", "load:b"], loadVersions: { "load:a": 7, "load:b": 4 },
    serviceDate: projection.serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:site", destinationLabelSnapshot: "Haleon",
    status: "planned", runId: "run:two", vehicleId: "van2", version: 7, scheduledTime: "10:30",
    jobs: [{ id: "job:a", sourceId: "order:a", sourceType: "cpu-production", sourceVersion: 1, workstream: "Delivered-In", totalUnits: 2, version: 2, productionReadiness: "ready", collectionStatus: "awaiting", contents: [{ description: "Salad", quantity: 2, unit: "portion" }] },
      { id: "job:b", sourceId: "order:b", sourceType: "cpu-production", sourceVersion: 2, workstream: "Hospitality", totalUnits: 3, version: 4, productionReadiness: "ready", collectionStatus: "awaiting", contents: [{ description: "Lunch", quantity: 3, unit: "portion" }] }],
    jobCount: 2, totalUnits: 5, collectedCount: 0, readiness: "ready",
  }];
  // Clear time removes the persisted field; the older write type still requires it.
  Reflect.deleteProperty(projection.deliveryLoads[0], "scheduledTime");
  const untouched = structuredClone(projection);
  const result = projectionToDashboardData(projection);
  const group = result.planner.workGroups.find(item => item.groupKey === "projection-delivery:group:stable");
  assert.ok(group, "an assigned untimed delivery must have a needs-time work group");
  assert.equal(workGroupQueueState(group, result.planner.runs), "needs_time");
  assert.equal(untimedAssignedDeliveryStop(group, result.planner.runs)?.stopId, "projection-stop:delivery:group:stable");
  assert.deepEqual(group.requirementRefs.map(ref => [ref.requirementId, ref.runId, ref.stopId]), [
    ["job:a", "run:two", "projection-stop:delivery:group:stable"], ["job:b", "run:two", "projection-stop:delivery:group:stable"],
  ]);
  assert.deepEqual(group.sourceLabels, ["Delivered-In", "Hospitality"]);
  assert.deepEqual(group.unitBreakdown, [{ unit: "portion", quantity: 5 }]);
  assert.deepEqual(group.combinedLines.map(item => item.displayName), ["Salad", "Lunch"]);
  const stop = result.stops.find(item => item.canonicalId === group.requirementRefs[0].stopId)!;
  assert.deepEqual(stop.canonicalLoadIds, ["load:a", "load:b"]);
  assert.deepEqual(stop.canonicalLoadVersions, { "load:a": 7, "load:b": 4 });
  assert.deepEqual(projection, untouched, "adapter cannot mutate canonical authority");
  projection.deliveryLoads[0].collectionRequired = true;
  const collectionReload = projectionToDashboardData(projection);
  assert.deepEqual(collectionReload.planner.workGroups.map(item => item.groupKey), ["projection-delivery:group:stable", "projection-collection:group:stable"]);
  assert.equal(untimedAssignedDeliveryStop(collectionReload.planner.workGroups[1], collectionReload.planner.runs), undefined);
  projection.deliveryLoads[0].scheduledTime = "10:30";
  const scheduled = projectionToDashboardData(projection);
  assert.deepEqual(scheduled.planner.workGroups.map(item => item.groupKey), ["projection-collection:group:stable"]);
  assert.equal(untimedAssignedDeliveryStop(group, scheduled.planner.runs), undefined);
});
