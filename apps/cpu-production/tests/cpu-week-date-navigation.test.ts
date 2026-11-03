import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardInitialDate, dashboardInitialOrderId, weekCommencingFor } from "../lib/cpu-dashboard-adapter";
import { calendarDateInputPatch, calendarWeekChangePatch } from "../lib/cpu-week-date-sync";

test("a selected date resolves to the Monday-based week that contains it", () => {
  assert.equal(weekCommencingFor("2027-01-25"), "2027-01-25", "a Monday is its own week");
  assert.equal(weekCommencingFor("2027-01-27"), "2027-01-25", "mid-week resolves to that Monday");
  assert.equal(weekCommencingFor("2027-01-31"), "2027-01-25", "a Sunday belongs to the week that started six days earlier");
  assert.equal(weekCommencingFor("2026-10-26"), "2026-10-26");
});

test("a fresh CPU deep link initializes the requested date and its containing week", () => {
  const selected = dashboardInitialDate("?date=2027-01-04", "2026-10-26");
  assert.equal(selected, "2027-01-04");
  assert.equal(weekCommencingFor(selected), "2027-01-04");
});

test("invalid or malformed CPU deep-link dates fall back to the operational date", () => {
  assert.equal(dashboardInitialDate("?date=2027-02-29", "2026-10-26"), "2026-10-26");
  assert.equal(dashboardInitialDate("?date=not-a-date", "2026-10-26"), "2026-10-26");
  assert.equal(dashboardInitialDate("?other=2027-01-04", "2026-10-26"), "2026-10-26");
});

test("CPU order links accept bounded opaque canonical IDs and ignore empty or excessive values", () => {
  assert.equal(dashboardInitialOrderId("?order=po%3Abooking%3A123&date=2027-01-04"), "po:booking:123");
  assert.equal(dashboardInitialOrderId("?order=%20%20"), undefined);
  assert.equal(dashboardInitialOrderId(`?order=${"a".repeat(257)}`), undefined);
});

test("the calendar projection is keyed by the displayed week, so navigation loads that week", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const projectionDate = isDayProjection \? dayDate : weekCommencing;/);
  assert.match(page, /\}, \[view, date, dayDate, weekCommencing,/);
});

test("the page wires the Date field and week arrows through the shared date-sync module", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /calendarDateInputPatch\(event\.target\.value, view\)/);
  assert.match(page, /calendarWeekChangePatch\(nextWeek\)/);
});

test("the page opens the canonical order selected by a Calendar deep link", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /dashboardInitialOrderId\(window\.location\.search\)/);
  assert.match(page, /void openOrder\(\{ canonicalId \}\)/);
});
