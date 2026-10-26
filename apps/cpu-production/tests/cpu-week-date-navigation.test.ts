import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { weekCommencingFor } from "../lib/cpu-dashboard-adapter";

test("a selected date resolves to the Monday-based week that contains it", () => {
  assert.equal(weekCommencingFor("2027-01-25"), "2027-01-25", "a Monday is its own week");
  assert.equal(weekCommencingFor("2027-01-27"), "2027-01-25", "mid-week resolves to that Monday");
  assert.equal(weekCommencingFor("2027-01-31"), "2027-01-25", "a Sunday belongs to the week that started six days earlier");
  assert.equal(weekCommencingFor("2026-10-26"), "2026-10-26");
});

test("the Week-view Date field navigates the calendar to the selected week", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const handler = page.slice(page.indexOf('<input type="date" value={date}'), page.indexOf('<input type="date" value={date}') + 400);
  assert.match(handler, /if \(view === "calendar" && next\) setWeekCommencing\(weekCommencingFor\(next\)\)/);
  assert.match(handler, /if \(view === "day"\) setDayDate\(next\)/, "Day view must still set the day date");
});

test("the calendar projection is keyed by the displayed week, so navigation loads that week", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const projectionDate = isDayProjection \? dayDate : weekCommencing;/);
  assert.match(page, /\}, \[view, date, dayDate, weekCommencing,/);
});
