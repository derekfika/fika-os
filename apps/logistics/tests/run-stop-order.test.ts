import assert from "node:assert/strict";
import test from "node:test";
import { applyStoredStopOrder, emptyRunRetirementBlocker, physicalStops, projectedStopId, validateRunStopOrder } from "../lib/run-stop-order";
import { projectionToDashboardData } from "../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../lib/types";

const key = (load: { id: string; destinationOplocId?: string; scheduledTime?: string }, lane: string) => `${lane}|${load.destinationOplocId}|${load.scheduledTime}`;
const load = (id: string, destinationOplocId: string, scheduledTime = "10:00") => ({ id, destinationOplocId, scheduledTime, serviceDate: "2026-10-28", originOplocId: "cpu", status: "planned" as const });

test("merged loads at one placement are ONE physical stop and any member id names it", () => {
  const work = { native: [], legs: [{ load: load("a", "site:1"), lane: "delivery" as const }, { load: load("b", "site:1"), lane: "delivery" as const }, { load: load("c", "site:2", "11:00"), lane: "delivery" as const }] };
  assert.equal(physicalStops(work, key).length, 2);
  assert.equal(validateRunStopOrder([projectedStopId("delivery", "b"), projectedStopId("delivery", "c")], work, key), undefined);
  assert.match(validateRunStopOrder([projectedStopId("delivery", "a"), projectedStopId("delivery", "b"), projectedStopId("delivery", "c")], work, key)!, /same physical stop twice/);
});

test("a stop order must be an exact permutation: missing, foreign, duplicate and malformed ids are rejected", () => {
  const work = { native: [{ canonicalId: "stop:n" }], legs: [{ load: load("a", "site:1"), lane: "delivery" as const }, { load: load("a", "site:1"), lane: "collection" as const }] };
  assert.equal(physicalStops(work, key).length, 3, "native stop + delivery visit + collection visit");
  const all = ["stop:n", projectedStopId("delivery", "a"), projectedStopId("collection", "a")];
  assert.equal(validateRunStopOrder([all[2], all[0], all[1]], work, key), undefined);
  assert.match(validateRunStopOrder(all.slice(1), work, key)!, /every physical stop/);
  assert.match(validateRunStopOrder([...all, "stop:foreign"], work, key)!, /does not belong/);
  assert.match(validateRunStopOrder([all[0], all[0], all[1]], work, key)!, /duplicate/);
  assert.match(validateRunStopOrder("nope", work, key)!, /array/);
  assert.match(validateRunStopOrder([1, 2], work, key)!, /array/);
});

test("a native stop that already owns a load stops that load being counted as a second visit", () => {
  const work = { native: [{ canonicalId: "stop:n", canonicalLoadIds: ["a"] }], legs: [{ load: load("a", "site:1"), lane: "delivery" as const }] };
  assert.equal(physicalStops(work, key).length, 1);
});

test("only an empty draft or planned run can be retired; dispatched, completed, retired and busy runs are protected", () => {
  const empty = { native: [], legs: [] };
  assert.equal(emptyRunRetirementBlocker({ status: "draft", orderedStopIds: [] }, empty), undefined);
  assert.equal(emptyRunRetirementBlocker({ status: "planned", orderedStopIds: [] }, empty), undefined);
  assert.match(emptyRunRetirementBlocker({ status: "dispatched", orderedStopIds: [] }, empty)!, /Only a draft or planned/);
  assert.match(emptyRunRetirementBlocker({ status: "completed", orderedStopIds: [] }, empty)!, /Only a draft or planned/);
  assert.match(emptyRunRetirementBlocker({ status: "ready", orderedStopIds: [] }, empty)!, /Only a draft or planned/);
  assert.match(emptyRunRetirementBlocker({ status: "draft", orderedStopIds: [], retiredAt: "x" }, empty)!, /already retired/);
  assert.match(emptyRunRetirementBlocker({ status: "draft", orderedStopIds: [] }, { native: [{ canonicalId: "s" }], legs: [] })!, /operational work/);
  assert.match(emptyRunRetirementBlocker({ status: "draft", orderedStopIds: [] }, { native: [], legs: [{ load: load("a", "s"), lane: "delivery" }] })!, /operational work/);
});

test("stored order wins, unordered work follows by the fallback, aliases resolve regrouped loads", () => {
  const stops = [{ id: "x", aliases: [] }, { id: "y", aliases: ["old:y"] }, { id: "z", aliases: [] }];
  assert.deepEqual(applyStoredStopOrder(stops, ["z", "old:y"], (a, b) => a.id.localeCompare(b.id)).map((s) => s.id), ["z", "y", "x"]);
  assert.deepEqual(applyStoredStopOrder(stops, [], (a, b) => b.id.localeCompare(a.id)).map((s) => s.id), ["z", "y", "x"]);
});

const projectionWith = (orderedStopIds: string[]): LogisticsDayProjection => {
  const mk = (id: string, time: string, destination: string) => ({
    id, serviceDate: "2026-10-28", originOplocId: "cpu", destinationOplocId: destination, destinationLabelSnapshot: destination, scheduledTime: time,
    status: "planned" as const, runId: "run:1", vehicleId: "van1" as const, version: 1, jobs: [{ id: `job:${id}`, sourceId: id, sourceType: "cpu-production", sourceVersion: 1, totalUnits: 1, version: 1, productionReadiness: "ready" as const, collectionStatus: "awaiting" as const, contents: [], deliveryStatus: "pending" as const }],
    jobCount: 1, totalUnits: 1, collectedCount: 0, readiness: "ready" as const,
  });
  return {
    serviceDate: "2026-10-28", revision: 2, lastChangeSequence: 10, state: "CURRENT", planningQueue: [], exceptions: [], rebuiltAt: "2026-10-28T08:00:00.000Z",
    runs: [{ canonicalId: "run:1", serviceDate: "2026-10-28", status: "planned", vehicleLabel: "Van 1", vehicleId: "van1", version: 3, orderedStopIds }],
    deliveryLoads: [mk("a", "09:00", "Alpha"), mk("b", "10:00", "Bravo"), mk("c", "11:00", "Charlie")] as unknown as LogisticsDayProjection["deliveryLoads"],
    summary: { queuedJobs: 0, loads: 3, assignedJobs: 3, collectedJobs: 0 },
  };
};

test("with no stored order, projected stops follow planned time", () => {
  const result = projectionToDashboardData(projectionWith([]));
  assert.deepEqual(result.runs[0].orderedStopIds, ["projection-stop:delivery:a", "projection-stop:delivery:b", "projection-stop:delivery:c"]);
});

test("a stored order is honoured for projected stops, sequence follows it, and new work is appended by time", () => {
  const result = projectionToDashboardData(projectionWith(["projection-stop:delivery:c", "projection-stop:delivery:a"]));
  assert.deepEqual(result.runs[0].orderedStopIds, ["projection-stop:delivery:c", "projection-stop:delivery:a", "projection-stop:delivery:b"]);
  assert.deepEqual(result.planner.runs[0].stops.map((stop) => [stop.destination.label, stop.sequence]), [["Charlie", 1], ["Alpha", 2], ["Bravo", 3]]);
});

test("a stored id for work that has since left the run is ignored, not resurrected", () => {
  const result = projectionToDashboardData(projectionWith(["projection-stop:delivery:gone", "projection-stop:delivery:b"]));
  assert.deepEqual(result.runs[0].orderedStopIds, ["projection-stop:delivery:b", "projection-stop:delivery:a", "projection-stop:delivery:c"]);
});
