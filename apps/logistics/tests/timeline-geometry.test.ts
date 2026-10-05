import assert from "node:assert/strict";
import test from "node:test";
import { ARRIVAL_MARKER_WIDTH_PX, timelineBlockWidth, timelineDurationMinutes } from "../lib/timeline-geometry";

test("explicit duration geometry stays proportional at normal, lower, higher and fit scales", () => {
  const scales = [2, 1, 2.5, 0.5];
  for (const pixelsPerMinute of scales) {
    for (const duration of [15, 30, 60, 90]) {
      assert.equal(timelineBlockWidth(600, 600 + duration, pixelsPerMinute), duration * pixelsPerMinute);
    }
  }
});

test("resize edge, live block and hit geometry use the explicit canonical end", () => {
  const scale = 2;
  const start = 10 * 60;
  const originalEnd = start + 30;
  const expandedEnd = start + 60;
  const reducedEnd = start + 15;
  assert.equal(timelineBlockWidth(start, originalEnd, scale), 60);
  assert.equal(timelineBlockWidth(start, expandedEnd, scale), 120);
  assert.equal(timelineBlockWidth(start, reducedEnd, scale), 30);
  assert.equal(timelineBlockWidth(start, expandedEnd, scale), (expandedEnd - start) * scale);
});

test("arrival-only work remains a distinct fixed marker instead of a false time window", () => {
  assert.equal(timelineBlockWidth(600, undefined, 2), ARRIVAL_MARKER_WIDTH_PX);
  assert.equal(timelineDurationMinutes(600, undefined), 15);
  assert.equal(timelineDurationMinutes(600, 630), 30);
});
