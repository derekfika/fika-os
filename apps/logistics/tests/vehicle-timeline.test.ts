import assert from "node:assert/strict";
import test from "node:test";
import { vehicleTimelineRows } from "../app/journey-planner/vehicle-timeline";
import type { RunRowView } from "../app/journey-planner/model";

const run = (id: string, vehicleId: "van1" | "van2", departure?: string, returnTime?: string): RunRowView => ({ id, title: id, vehicleId, vehicleLabel: vehicleId === "van1" ? "Van 1" : "Van 2", status: "draft", departure, return: returnTime, stopCount: 0, loadCount: 0, chips: [], canRetire: true, editable: true });

test("several runs share their canonical van lane without changing identities or input order", () => {
  const runs = [run("late", "van1", "14:00", "16:00"), run("other", "van2", "09:00", "12:00"), run("early", "van1", "08:00", "11:00")];
  const before = structuredClone(runs);
  const rows = vehicleTimelineRows(runs);
  assert.deepEqual(rows.map(row => row.vehicleId), ["van1", "van2"]);
  assert.deepEqual(rows[0].runs.map(run => run.id), ["late", "early"]);
  assert.equal(rows[0].tracks.get("late"), rows[0].tracks.get("early"));
  assert.equal(rows[0].trackCount, 1);
  assert.deepEqual(runs, before);
});

test("overlapping runs stay individually reachable within one van lane", () => {
  const [row] = vehicleTimelineRows([run("a", "van1", "08:00", "12:00"), run("b", "van1", "10:00", "13:00"), run("c", "van1", "13:00", "14:00")]);
  assert.notEqual(row.tracks.get("a"), row.tracks.get("b"));
  assert.equal(row.trackCount, 2);
  assert.equal(row.tracks.get("c"), 0);
});

test("empty vans and untimed drafts remain explicit without inventing clock times", () => {
  const rows = vehicleTimelineRows([run("draft", "van2")]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].runs.length, 0);
  assert.equal(rows[1].runs[0].departure, undefined);
  assert.equal(rows[1].tracks.has("draft"), false);
  assert.deepEqual(vehicleTimelineRows([], ["van2"]).map(row => row.vehicleId), ["van2"]);
});

test("unsupported vehicle identity fails visibly instead of dropping its run", () => {
  assert.throws(() => vehicleTimelineRows([{ ...run("bad", "van1"), vehicleId: "unknown" } as unknown as RunRowView]), /unsupported vehicle/);
});
