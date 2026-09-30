import assert from "node:assert/strict";
import test from "node:test";
import { formatTimelineMinute, snapTimelineMinute, timelineQueueDuplicatesCanonical, timelineVisualSubrows } from "../lib/react-timeline-model";

test("pointer coordinate, scroll, grab offset and zoom resolve one exact quarter-hour anchor", () => {
  const minute = snapTimelineMinute(2200, 250, 900, 30, 2);
  assert.equal(minute, 1410);
  assert.equal(formatTimelineMinute(minute), "23:30");
  assert.equal(snapTimelineMinute(400 + 225 * 2, 400, 0, 0, 2), 225);
});

test("day horizon clamps to a safe final 15-minute start", () => {
  assert.equal(formatTimelineMinute(snapTimelineMinute(50000, 0, 0, 0, 2)), "23:45");
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

test("canonical handoff suppresses a queue card when any stable work identity is present", () => {
  assert.equal(timelineQueueDuplicatesCanonical(["req-1", "load-1"], new Set(["stop-1", "req-1"])), true);
  assert.equal(timelineQueueDuplicatesCanonical(["req-2"], new Set(["stop-1", "req-1"])), false);
});
