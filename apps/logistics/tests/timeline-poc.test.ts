import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustedPocPlacement,
  clampPocMinute,
  formatPocTime,
  pocLaneHeight,
  pocSubrowTop,
  pocVisualSubrows,
  snapPocMinute,
  type PocPlacement,
} from "../lib/timeline-poc";

const placement = (id: string, startMinute: number): PocPlacement => ({
  id, destination: `Site ${id}`, vehicle: "van-1", lane: "delivery", startMinute,
  durationMinutes: 15, loadCount: 1, kind: "delivery", state: "confirmed",
});

test("pointer snapping resolves exact quarter-hours before release, accounting for grab offset and scroll", () => {
  assert.equal(snapPocMinute(380, 100, 76, 14), 8 * 60 + 15);
  assert.equal(snapPocMinute(-100, 100, 0, 0), 6 * 60);
  assert.equal(snapPocMinute(10_000, 100, 0, 0), 14 * 60);
});

test("end-of-day clamping keeps explicit window duration inside the fixture horizon", () => {
  assert.equal(clampPocMinute(13 * 60 + 53, 60), 13 * 60);
  assert.equal(formatPocTime(clampPocMinute(13 * 60 + 53, 60)), "13:00");
});

test("visual collisions use extra display subrows while preserving exact operational starts", () => {
  const items = [placement("08:00", 8 * 60), placement("08:15", 8 * 60 + 15), placement("08:30", 8 * 60 + 30)];
  const rows = pocVisualSubrows(items);
  assert.deepEqual(items.map((item) => item.startMinute), [480, 495, 510]);
  assert.deepEqual(items.map((item) => rows.get(item.id)), [0, 1, 2]);
  assert.ok(pocSubrowTop(1) - pocSubrowTop(0) >= 74);
  assert.ok(pocLaneHeight(3) >= pocSubrowTop(2) + 74);
});

test("a non-overlapping readable card can reuse the first visual subrow", () => {
  const rows = pocVisualSubrows([placement("08:00", 8 * 60), placement("09:00", 9 * 60)]);
  assert.equal(rows.get("08:00"), 0);
  assert.equal(rows.get("09:00"), 0);
});

test("server-adjustment fixture settles at the canonical quarter-hour, not the requested time", () => {
  const adjusted = adjustedPocPlacement({ ...placement("stop", 8 * 60), state: "pending" }, 8 * 60 + 15);
  assert.equal(adjusted.startMinute, 8 * 60 + 30);
  assert.equal(adjusted.state, "confirmed");
});
