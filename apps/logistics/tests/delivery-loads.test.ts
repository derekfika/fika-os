import assert from "node:assert/strict";
import { test } from "node:test";
import { assignJob, assertDispatchable, compatibleAssignedLoad, compatibleLoad, createLoad, explainLoadCompatibility, findCompatibleLoad, loadSummary, removeAssignment, setJobCollectionStatus } from "../lib/delivery-loads";
import type { LogisticsAssignment, LogisticsJob } from "../lib/types";

const job = (id: string, destination = "oploc:mnk", time = "11:30", origin = "oploc:cpu"): LogisticsJob => ({ id, sourceType: "cpu-production", sourceId: `order:${id}`, serviceDate: "2026-08-24", originOplocId: origin, destinationOplocId: destination, requestedWindow: { startTime: time }, productionReadiness: "ready", collectionStatus: "awaiting", contents: [{ description: "Sandwich lunch", quantity: 30, unit: "portion" }], createdAt: "now", updatedAt: "now", version: 1, audit: [] });
const assignment = (jobId: string, loadId: string): LogisticsAssignment => ({ jobId, loadId, assignedAt: "now", assignedBy: "test", audit: [] });

test("three compatible jobs consolidate into one load without losing job assignments", () => {
  const first = job("a"); const second = job("b"); const third = job("c");
  const load = createLoad({ serviceDate: first.serviceDate, originOplocId: first.originOplocId!, destinationOplocId: first.destinationOplocId!, scheduledTime: "11:30", by: "test" });
  let assignments: LogisticsAssignment[] = [];
  for (const item of [first, second, third]) assignments.push(assignJob(item, load, assignments, "test").assignment);
  assert.equal(assignments.length, 3); assert.equal(findCompatibleLoad(first, [load])?.id, load.id); assert.deepEqual(loadSummary(load, [first, second, third], assignments), { jobCount: 3, totalUnits: 90, collectedCount: 0, collectionTotal: 3, productionWarnings: 0, readyToDispatch: false });
});
test("canonical date and location predicates prevent incorrect merges while source timing stays advisory", () => {
  const load = createLoad({ serviceDate: "2026-08-24", originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "11:30", by: "test" });
  assert(compatibleLoad(job("same"), load));
  const advisoryJob = { ...job("late", "oploc:mnk", "10:00"), requestedWindow: { startTime: "10:00", endTime: "11:00" } };
  const outsideAdvisory = { ...load, scheduledTime: "14:00" };
  assert(compatibleLoad(advisoryJob, outsideAdvisory));
  assert.deepEqual(explainLoadCompatibility(advisoryJob, outsideAdvisory).warnings, ["scheduled_arrival_outside_advisory_requested_window"]);
  assert(!compatibleLoad(job("other-destination", "oploc:cfc"), load)); assert(!compatibleLoad(job("other-origin", "oploc:mnk", "11:30", "oploc:angel"), load)); assert.equal(findCompatibleLoad({ ...job("missing"), originOplocId: undefined }, [load]), undefined);
});
test("split, independent collection and dispatch safety work at job level", () => {
  const jobs = [job("a"), job("b"), job("c")]; const load = createLoad({ serviceDate: jobs[0].serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "11:30", by: "test" }); const later = createLoad({ serviceDate: jobs[0].serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "14:00", by: "test" }); let assignments = jobs.map((item) => assignment(item.id, load.id));
  assert.throws(() => assertDispatchable(load, jobs, assignments), /must be loaded/);
  const collected = setJobCollectionStatus(jobs[0], "collected", "test"); const collectedB = setJobCollectionStatus(jobs[1], "collected", "test"); assert.equal(loadSummary(load, [collected, collectedB, jobs[2]], assignments).collectedCount, 2);
  const split = removeAssignment(assignments, "c", "test"); assignments = [...split.assignments, assignment("c", later.id)]; assert.equal(loadSummary(load, [collected, collectedB, jobs[2]], assignments).jobCount, 2); assert.equal(loadSummary(later, jobs, assignments).jobCount, 1);
  assert.doesNotThrow(() => assertDispatchable(load, [{ ...collected, deliveryStatus: "loaded" }, { ...collectedB, deliveryStatus: "loaded" }], assignments));
});
test("assigning an already assigned job is idempotent", () => { const item = job("a"); const load = createLoad({ serviceDate: item.serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "11:30", by: "test" }); const existing = [assignment(item.id, load.id)]; assert.equal(assignJob(item, load, existing, "test").assignment, existing[0]); });

test("cleared timing retains membership without authorising a new assignment or dispatch", () => {
  const item = { ...job("a"), deliveryStatus: "loaded" as const };
  const load = createLoad({ serviceDate: item.serviceDate, originOplocId: item.originOplocId!, destinationOplocId: item.destinationOplocId!, scheduledTime: "11:30", by: "test" });
  const cleared = { ...load, scheduledTime: undefined! };
  assert(compatibleAssignedLoad(item, cleared));
  assert(!compatibleLoad(item, cleared));
  assert.throws(() => assignJob(item, cleared, [], "test"), /not compatible/);
  assert.throws(() => assertDispatchable(cleared, [item], [assignment(item.id, load.id)]), /current source truth/);
  for (const invalid of [{ ...cleared, destinationOplocId: "other" }, { ...cleared, serviceDate: "2026-08-25" }, { ...cleared, status: "cancelled" as const }, { ...cleared, scheduledTime: "" }]) assert(!compatibleAssignedLoad(item, invalid));
  assert(compatibleAssignedLoad(item, { ...cleared, scheduledTime: "10:00" }), "upstream arrival mismatch is advisory after an operator schedules the load");
  assert(!compatibleAssignedLoad({ ...item, sourceStatus: "withdrawn" }, cleared));
});
