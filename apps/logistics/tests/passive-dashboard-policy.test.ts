import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_CORE_REFRESH_MS,
  dashboardPassiveRefreshIntervalMs,
  dashboardRefreshPeriod,
  mayAutoRefreshDashboard,
} from "../../shared/passive-dashboard-refresh";

const instant = (iso: string) => Date.parse(iso);

test("UK weekday windows use five minutes only from 06:00 through 15:59", () => {
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T05:59:59Z")), null);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T06:00:00Z")), DASHBOARD_CORE_REFRESH_MS);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T15:59:59Z")), DASHBOARD_CORE_REFRESH_MS);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T16:00:00Z")), null);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-09T00:00:00Z")), null);
  assert.equal(dashboardRefreshPeriod(instant("2026-11-05T16:00:00Z")), "inactive");
});

test("no passive requests on UK Saturdays and Sundays, including DST changes", () => {
  for (const value of ["2026-11-07T12:00:00Z", "2026-11-08T12:00:00Z", "2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z", "2026-10-25T01:30:00Z"]) {
    assert.equal(dashboardRefreshPeriod(instant(value)), "weekend");
    assert.equal(dashboardPassiveRefreshIntervalMs(instant(value)), null);
  }
});

test("UK summer-time core starts at 05:00 UTC, not 06:00 UTC", () => {
  assert.equal(dashboardRefreshPeriod(instant("2026-07-01T04:59:59Z")), "inactive");
  assert.equal(dashboardRefreshPeriod(instant("2026-07-01T05:00:00Z")), "core");
  assert.equal(dashboardRefreshPeriod(instant("2026-07-01T14:59:59Z")), "core");
  assert.equal(dashboardRefreshPeriod(instant("2026-07-01T15:00:00Z")), "inactive");
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-07-01T15:00:00Z")), null);
});

test("passive reads respect elapsed budget, hidden tabs, in-flight reads and older slower throttles", () => {
  const now = instant("2026-11-05T12:00:00Z");
  const base = { now, visible: true, lastAttemptAt: now - DASHBOARD_CORE_REFRESH_MS };
  assert.equal(mayAutoRefreshDashboard(base), true);
  assert.equal(mayAutoRefreshDashboard({ ...base, lastAttemptAt: now - DASHBOARD_CORE_REFRESH_MS + 1 }), false);
  assert.equal(mayAutoRefreshDashboard({ ...base, visible: false }), false);
  assert.equal(mayAutoRefreshDashboard({ ...base, inFlight: true }), false);
  assert.equal(mayAutoRefreshDashboard({ ...base, requestsBlocked: true }), false);
  assert.equal(mayAutoRefreshDashboard({ ...base, minimumIntervalMs: 15 * 60_000 }), false);
  assert.equal(mayAutoRefreshDashboard({ ...base, lastAttemptAt: now - 15 * 60_000, minimumIntervalMs: 15 * 60_000 }), true);
  assert.equal(mayAutoRefreshDashboard({ ...base, now: instant("2026-11-07T12:00:00Z"), lastAttemptAt: undefined }), false);
});

test("standalone CPU dashboard uses the same UK weekday window", () => {
  const script = readFileSync(new URL("../../../shared/cpu-dashboard/Script.html", import.meta.url), "utf8");
  assert.match(script, /parts\.weekday === "Sat" \|\| parts\.weekday === "Sun"/);
  assert.match(script, /hour < 6 \|\| hour >= 16/);
  assert.match(script, /return 5 \* 60 \* 1000/);
});
