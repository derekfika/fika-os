import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateDaily, calculateBaseline, calculateStatus, londonDayStart, parseUsageRange, resolutionForDuration } from "../lib/usage-observatory";

const config = { projectId: "fika-os-local", watchPercent: 0.5, highPercent: 0.75, criticalPercent: 0.9, spikeMultiplier: 2, maxWindowDays: 31, cacheTtlMs: 180000 };

test("custom ranges validate and preserve narrow diagnostic windows", () => {
  const range = parseUsageRange({ start: "2026-08-29T13:05:00+01:00", end: "2026-08-29T13:20:00+01:00" }, new Date("2026-08-29T14:00:00Z"), config);
  assert.equal(range.timezone, "Europe/London");
  assert.equal(Date.parse(range.end) - Date.parse(range.start), 15 * 60000);
  assert.throws(() => parseUsageRange({ start: range.end, end: range.start }, new Date(), config), /after/);
  assert.throws(() => parseUsageRange({ start: "2026-01-01T00:00:00Z", end: "2026-03-01T00:00:00Z" }, new Date("2026-03-02T00:00:00Z"), config), /too large/);
});

test("resolution is centralised by duration", () => {
  assert.equal(resolutionForDuration(2 * 3600000), "1m");
  assert.equal(resolutionForDuration(24 * 3600000), "5m");
  assert.equal(resolutionForDuration(7 * 86400000), "1h");
  assert.equal(resolutionForDuration(8 * 86400000), "1d");
});

test("London day start handles BST and GMT deliberately", () => {
  assert.equal(londonDayStart(new Date("2026-08-29T12:00:00Z")).toISOString(), "2026-08-28T23:00:00.000Z");
  assert.equal(londonDayStart(new Date("2026-01-29T12:00:00Z")).toISOString(), "2026-01-29T00:00:00.000Z");
});

test("quota status and baseline are explainable", () => {
  assert.equal(calculateStatus(0.6, config), "watch");
  assert.equal(calculateStatus(undefined, config), "unknown");
  assert.equal(calculateBaseline([{ timestamp: "1", value: 10 }, { timestamp: "2", value: 10 }, { timestamp: "3", value: 20 }, { timestamp: "4", value: 10 }, { timestamp: "5", value: 30 }], 2).available, true);
  assert.equal(calculateBaseline([{ timestamp: "1", value: 0 }, { timestamp: "2", value: 1 }], 2).message, "Not enough baseline data");
});

test("daily aggregation is bounded to seven London-labelled buckets", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const result = aggregateDaily([{ timestamp: "2026-08-29T10:00:00Z", value: 12 }, { timestamp: "2026-08-28T10:00:00Z", value: 8 }], now);
  assert.equal(result.length, 7);
  assert.equal(result.at(-1)?.value, 12);
});

test("usage API is administrator guarded and does not scan operational Firestore", () => {
  const route = readFileSync(new URL("../app/api/usage/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireAuthmodAdminContext/);
  assert.doesNotMatch(route, /collection\(|getDocs\(|onSnapshot\(/);
});
