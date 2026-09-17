import assert from "node:assert/strict";
import test from "node:test";
import { projectionToDashboardData } from "../lib/projection-dashboard-adapter";
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
