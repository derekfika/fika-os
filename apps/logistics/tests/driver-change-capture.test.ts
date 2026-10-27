import assert from "node:assert/strict";
import test from "node:test";
import { buildDriverRunSnapshots, type DayState } from "../lib/driver-change-capture";
import { diffBatch } from "../lib/driver-notifications";

const DATE = "2026-10-28";
const job = (id: string) => ({ id, serviceDate: DATE, notes: "", contents: [{ description: "Sandwich box", quantity: 10, unit: "box" }] });
const state = (jobIds: string[]): DayState => ({
  runs: [{ canonicalId: "r1", serviceDate: DATE, vehicleId: "van1", vehicleLabel: "Van 1", version: 1, status: "planned", orderedStopIds: [] }] as never,
  loads: [{ id: "l1", serviceDate: DATE, runId: "r1", status: "planned", destinationLabelSnapshot: "One Angel Court", scheduledTime: "10:30" }] as never,
  assignments: jobIds.map(jobId => ({ jobId, loadId: "l1" })),
  jobs: jobIds.map(job) as never,
  stops: [],
});

test("identical quantity lines from different jobs stay represented, so removing one of two is detected", () => {
  const [two] = buildDriverRunSnapshots(DATE, state(["a", "b"]));
  const [one] = buildDriverRunSnapshots(DATE, state(["a"]));
  assert.notEqual(two.visits[0].quantities, one.visits[0].quantities, "two identical lines differ from one");
  const notices = diffBatch(DATE, [two], [one]);
  assert.deepEqual(notices.map(notice => notice.kind), ["load-details-changed"]);
});

test("the quantity summary does not depend on the order jobs are read", () => {
  const [forward] = buildDriverRunSnapshots(DATE, state(["a", "b"]));
  const [reverse] = buildDriverRunSnapshots(DATE, state(["b", "a"]));
  assert.equal(forward.visits[0].quantities, reverse.visits[0].quantities);
});
