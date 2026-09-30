import assert from "node:assert/strict";
import test from "node:test";
import { formatTimelineMinute, schedulableTimelineRuns, snapTimelineMinute, timelineQueueDuplicatesCanonical, timelineVisualSubrows } from "../lib/react-timeline-model";

test("pointer coordinate, scroll, grab offset and zoom resolve one exact quarter-hour anchor", () => {
  const minute = snapTimelineMinute(2200, 250, 900, 30, 2);
  assert.equal(minute, 1410);
  assert.equal(formatTimelineMinute(minute), "23:30");
  assert.equal(snapTimelineMinute(400 + 225 * 2, 400, 0, 0, 2), 225);
});

test("day horizon clamps to a safe final 15-minute start", () => {
  assert.equal(formatTimelineMinute(snapTimelineMinute(50000, 0, 0, 0, 2)), "23:45");
  assert.equal(formatTimelineMinute(snapTimelineMinute(50000, 0, 0, 0, 2, 30)), "23:15");
  assert.equal(formatTimelineMinute(snapTimelineMinute(50000, 0, 0, 0, 2, 60)), "22:45");
  assert.equal(formatTimelineMinute(snapTimelineMinute(50000, 0, 0, 0, 2, 60) + 60), "23:45");
});

test("overlapping readable card rectangles use visual subrows without changing canonical starts", () => {
  const entries = [
    { id: "a", startMinute: 8 * 60, durationMinutes: 68 },
    { id: "b", startMinute: 8 * 60 + 15, durationMinutes: 68 },
    { id: "c", startMinute: 8 * 60 + 30, durationMinutes: 68 },
  ];
  const rows = timelineVisualSubrows(entries);
  assert.deepEqual([...rows.values()], [0, 1, 2]);
  assert.deepEqual(entries.map((item) => item.startMinute), [480, 495, 510]);
});

test("canonical queue handoff requires a scheduled matching work identity at the proposed placement", () => {
  const proposed = { runId: "run-2", lane: "collection" as const, start: "12:15" };
  const unscheduledCollection: [] = [];
  assert.equal(timelineQueueDuplicatesCanonical(["load-1", "stop-collection"], unscheduledCollection, proposed), false);
  assert.equal(timelineQueueDuplicatesCanonical(["load-1"], [{ workIds: new Set(["stop-collection", "load-1"]), runId: "run-2", lane: "collection", start: "12:15" }], proposed), true);
  assert.equal(timelineQueueDuplicatesCanonical(["load-1"], [{ workIds: new Set(["stop-collection", "load-1"]), runId: "run-1", lane: "collection", start: "12:15" }], proposed), false);
  assert.equal(timelineQueueDuplicatesCanonical(["other-load"], [{ workIds: new Set(["stop-collection", "load-1"]), runId: "run-2", lane: "collection", start: "12:15" }], proposed), false);
});

test("three real runs remain schedulable while the synthetic projection run is excluded", () => {
  const runs = [{ runId: "run-1" }, { runId: "run-2" }, { runId: "run-3" }, { runId: "projection-run:2026-09-30:unassigned" }];
  assert.deepEqual(schedulableTimelineRuns(runs).map((run) => run.runId), ["run-1", "run-2", "run-3"]);
});

test("six simultaneous display cards receive six visual rows", () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({ id: `stop-${index}`, startMinute: 500, durationMinutes: 90 }));
  assert.deepEqual([...timelineVisualSubrows(entries).values()], [0, 1, 2, 3, 4, 5]);
});
