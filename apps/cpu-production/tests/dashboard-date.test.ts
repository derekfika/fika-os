import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dashboardOperationalDate, weekCommencingFor } from "../lib/cpu-dashboard-adapter";

test("dashboard uses the UK business date at BST midnight and after the GMT transition", () => {
  assert.equal(dashboardOperationalDate(new Date("2026-10-12T23:30:00Z")), "2026-10-13");
  assert.equal(dashboardOperationalDate(new Date("2026-10-26T23:30:00Z")), "2026-10-26");
  assert.equal(dashboardOperationalDate(new Date("2026-10-09T23:30:00Z")), "2026-10-12");
  assert.equal(weekCommencingFor(dashboardOperationalDate(new Date("2026-10-11T23:30:00Z"))), "2026-10-12");
});

test("CPU static HTML and first client render have no build-time date or fallback calendar", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\[todayKey, setTodayKey\] = useState\(""\)/);
  assert.match(page, /\[dayDate, setDayDate\] = useState\(""\)/);
  assert.match(page, /\[weekCommencing, setWeekCommencing\] = useState\(""\)/);
  assert.match(page, /weekCommencing \? <ProductionCalendar/);
  assert.match(page, /Loading date…/);
  assert.doesNotMatch(page, /useState\(dashboardOperationalDate\(/);
});
