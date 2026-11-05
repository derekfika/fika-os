import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_CORE_REFRESH_MS,
  DASHBOARD_OVERNIGHT_REFRESH_MS,
  dashboardPassiveRefreshIntervalMs,
  dashboardRefreshPeriod,
  mayAutoRefreshDashboard,
} from "../../shared/passive-dashboard-refresh";

const instant = (iso: string) => Date.parse(iso);

test("UK weekday windows use 5 minutes 06:00-18:00 and one hour otherwise", () => {
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T05:59:59Z")), DASHBOARD_OVERNIGHT_REFRESH_MS);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T06:00:00Z")), DASHBOARD_CORE_REFRESH_MS);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T17:59:59Z")), DASHBOARD_CORE_REFRESH_MS);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-05T18:00:00Z")), DASHBOARD_OVERNIGHT_REFRESH_MS);
  assert.equal(dashboardPassiveRefreshIntervalMs(instant("2026-11-09T00:00:00Z")), DASHBOARD_OVERNIGHT_REFRESH_MS);
});

test("no passive requests on UK Saturdays and Sundays, including DST changes", () => {
  for (const value of ["2026-11-07T12:00:00Z", "2026-11-08T12:00:00Z", "2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z", "2026-10-25T01:30:00Z"]) {
    assert.equal(dashboardRefreshPeriod(instant(value)), "weekend");
    assert.equal(dashboardPassiveRefreshIntervalMs(instant(value)), null);
  }
});

test("UK summer-time core starts at 05:00 UTC, not 06:00 UTC", () => {
  assert.equal(dashboardRefreshPeriod(instant("2026-07-01T04:59:59Z")), "overnight");
  assert.equal(dashboardRefreshPeriod(instant("2026-07-01T05:00:00Z")), "core");
  assert.equal(dashboardRefreshPeriod(instant("2026-07-01T17:00:00Z")), "overnight");
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
