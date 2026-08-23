import assert from "node:assert/strict";
import { test } from "node:test";
import { assignJob, assertDispatchable, compatibleLoad, createLoad, findCompatibleLoad, loadSummary, removeAssignment, setJobCollectionStatus } from "../lib/delivery-loads";
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
test("canonical date/origin/destination/time compatibility prevents incorrect merges", () => {
  const load = createLoad({ serviceDate: "2026-08-24", originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "11:30", by: "test" });
  assert(compatibleLoad(job("same"), load)); assert(!compatibleLoad(job("late", "oploc:mnk", "14:00"), load)); assert(!compatibleLoad(job("other-destination", "oploc:cfc"), load)); assert(!compatibleLoad(job("other-origin", "oploc:mnk", "11:30", "oploc:angel"), load)); assert.equal(findCompatibleLoad({ ...job("missing"), originOplocId: undefined }, [load]), undefined);
});
test("split, independent collection and dispatch safety work at job level", () => {
  const jobs = [job("a"), job("b"), job("c")]; const load = createLoad({ serviceDate: jobs[0].serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "11:30", by: "test" }); const later = createLoad({ serviceDate: jobs[0].serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "14:00", by: "test" }); let assignments = jobs.map((item) => assignment(item.id, load.id));
  assert.throws(() => assertDispatchable(load, jobs, assignments), /not been collected/);
  const collected = setJobCollectionStatus(jobs[0], "collected", "test"); const collectedB = setJobCollectionStatus(jobs[1], "collected", "test"); assert.equal(loadSummary(load, [collected, collectedB, jobs[2]], assignments).collectedCount, 2);
  const split = removeAssignment(assignments, "c", "test"); assignments = [...split.assignments, assignment("c", later.id)]; assert.equal(loadSummary(load, [collected, collectedB, jobs[2]], assignments).jobCount, 2); assert.equal(loadSummary(later, jobs, assignments).jobCount, 1);
  assert.doesNotThrow(() => assertDispatchable(load, [collected, collectedB], assignments));
});
test("assigning an already assigned job is idempotent", () => { const item = job("a"); const load = createLoad({ serviceDate: item.serviceDate, originOplocId: "oploc:cpu", destinationOplocId: "oploc:mnk", scheduledTime: "11:30", by: "test" }); const existing = [assignment(item.id, load.id)]; assert.equal(assignJob(item, load, existing, "test").assignment, existing[0]); });
