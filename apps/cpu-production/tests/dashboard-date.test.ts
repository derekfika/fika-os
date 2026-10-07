import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dashboardOperationalDate, weekCommencingFor } from "../lib/cpu-dashboard-adapter";
import { europeLondonDate } from "../lib/operational-date";

test("production Today and allergen defaults retain actual London dates across DST and weekends", () => {
  for (const [instant, expected] of [
    ["2026-03-28T23:30:00Z", "2026-03-28"],
    ["2026-03-29T23:30:00Z", "2026-03-30"],
    ["2026-10-09T23:30:00Z", "2026-10-10"],
    ["2026-10-24T23:30:00Z", "2026-10-25"],
    ["2026-10-25T23:30:00Z", "2026-10-25"],
    ["2026-10-26T23:30:00Z", "2026-10-26"],
  ]) assert.equal(europeLondonDate(new Date(instant)), expected);
  const day = readFileSync(new URL("../app/ui/ProductionDayView.tsx", import.meta.url), "utf8");
  const allergens = readFileSync(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  assert.match(day, /onChangeDate\(europeLondonDate\(\)\)/);
  assert.match(allergens, /setDate\(params\.get\("date"\) \|\| europeLondonDate\(\)\)/);
});

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
