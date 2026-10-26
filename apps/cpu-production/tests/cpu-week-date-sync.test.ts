import test from "node:test";
import assert from "node:assert/strict";
import { weekCommencingFor } from "../lib/cpu-dashboard-adapter";
import { calendarDateInputPatch, calendarWeekChangePatch } from "../lib/cpu-week-date-sync";

type State = { view: string; date: string; dayDate: string; weekCommencing: string };

const start: State = { view: "calendar", date: "2027-01-25", dayDate: "2027-01-25", weekCommencing: "2027-01-25" };

/** Apply a Date-field change the way the page does. */
const chooseDate = (state: State, value: string): State => {
  const patch = calendarDateInputPatch(value, state.view);
  return { ...state, date: patch.date, dayDate: patch.dayDate ?? state.dayDate, weekCommencing: patch.weekCommencing ?? state.weekCommencing };
};

/** Apply a previous/next/this-week change the way the page does. */
const changeWeek = (state: State, nextWeek: string): State => {
  const patch = calendarWeekChangePatch(nextWeek);
  return { ...state, weekCommencing: patch.weekCommencing, date: patch.date };
};

/** The invariant the UI relies on: the Date field sits in the displayed week. */
const coherent = (state: State) => weekCommencingFor(state.date) === state.weekCommencing;

test("choosing a Monday displays that Monday's week with the Date field on it", () => {
  const state = chooseDate({ ...start, view: "calendar" }, "2027-02-08");
  assert.equal(state.weekCommencing, "2027-02-08");
  assert.equal(state.date, "2027-02-08");
  assert.ok(coherent(state));
});

test("choosing a Sunday displays the Monday-based week and keeps the chosen Date", () => {
  const state = chooseDate({ ...start, view: "calendar" }, "2027-01-31");
  assert.equal(state.weekCommencing, "2027-01-25");
  assert.equal(state.date, "2027-01-31");
  assert.ok(coherent(state));
});

test("next and previous week arrows move the displayed week and bring the Date field with them", () => {
  let state: State = { ...start, view: "calendar" };
  state = changeWeek(state, "2027-02-01");
  assert.equal(state.weekCommencing, "2027-02-01");
  assert.equal(state.date, "2027-02-01", "after Next week the Date field shows a day in the displayed week");
  assert.ok(coherent(state));
  state = changeWeek(state, "2027-01-25");
  assert.equal(state.weekCommencing, "2027-01-25");
  assert.equal(state.date, "2027-01-25");
  assert.ok(coherent(state));
});

test("arrow navigation after a Sunday selection never leaves the Date field in the previous week", () => {
  let state = chooseDate({ ...start, view: "calendar" }, "2027-01-31");
  state = changeWeek(state, "2027-02-01");
  assert.ok(coherent(state));
  state = changeWeek(state, "2027-01-25");
  assert.ok(coherent(state));
});

test("Week to Day to Week keeps the calendar and Date field on the same week", () => {
  let state: State = { ...start, view: "calendar" };
  state = changeWeek(state, "2027-02-01");
  // Week -> Day: the Day view opens on the Date field's day.
  state = { ...state, view: "day", dayDate: state.date };
  state = chooseDate(state, "2027-02-03");
  assert.equal(state.dayDate, "2027-02-03", "Day view changes the day, not the displayed week");
  assert.equal(state.weekCommencing, "2027-02-01");
  // Day -> Week: the calendar stays on the week containing the chosen day.
  state = { ...state, view: "calendar" };
  assert.ok(coherent(state));
  assert.equal(state.weekCommencing, "2027-02-01");
});

test("Queue, Run Sheet and Totals date changes do not move the Week calendar", () => {
  for (const view of ["queue", "run-sheet", "totals"]) {
    const patch = calendarDateInputPatch("2027-02-10", view);
    assert.equal(patch.date, "2027-02-10", `${view} keeps its own date`);
    assert.equal(patch.weekCommencing, undefined, `${view} must not change the Week calendar`);
    assert.equal(patch.dayDate, undefined, `${view} must not change the Day date`);
  }
});

test("clearing the Date field leaves the displayed week alone", () => {
  const patch = calendarDateInputPatch("", "calendar");
  assert.equal(patch.date, "");
  assert.equal(patch.weekCommencing, undefined);
});
