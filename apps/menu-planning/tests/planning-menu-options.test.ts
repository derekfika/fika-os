import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { menuWeeksForPlanner } from "../app/planning-context-nav";
import { emptyWeek, supplementaryMenuWeekId } from "../lib/rolling-menu";

const monday = "2026-11-23";
const main = emptyWeek(monday).week;
const supplementary = (id: string, name: string, weekdays: number[]) => ({
  ...main,
  id: supplementaryMenuWeekId(monday, id),
  supplementaryMenu: { id, name, serviceType: "Breakfast" as const, siteIds: [id], recurrenceWeekdays: weekdays },
});
const munich = supplementary("munich-re", "Munich RE", [1]);
const wise = supplementary("wise", "Wise", [5]);
const oneOff = { ...supplementary("one-off", "One-off service", []), supplementaryMenu: { ...supplementary("one-off", "One-off service", []).supplementaryMenu, serviceDate: "2026-11-25" } };
const otherWeek = emptyWeek("2026-11-30").week;
const weeks = [otherWeek, wise, oneOff, main, munich];

test("Week Planner offers the main and all same-week supplementary menus independent of today's recurrence", () => {
  const options = menuWeeksForPlanner(weeks, munich.id);
  assert.deepEqual(options.map(week => week.id), [main.id, munich.id, oneOff.id, wise.id]);
  assert.equal(new Set(options.map(week => week.id)).size, 4);
  assert.ok(!options.some(week => week.id === otherWeek.id));
});

test("Week Planner menu switching selects the whole week and leaves existing draft protection enabled", () => {
  const component = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../app/planning-context-nav.tsx", import.meta.url), "utf8");
  assert.match(component, /<PlanningContextNav weeks=\{weeks\} currentWeek=\{snapshot\.week\.id\} showMenuSelector \/>/);
  assert.match(navigation, /if \(!showDay\) \{ if \(onSelectWeek\) onSelectWeek\(weekId\); else window\.dispatchEvent\(new CustomEvent\("menu-week-select"/);
  assert.match(navigation, /Main Lunch/);
  assert.match(component, /<WeekDraftNotices draft=\{draft\} selectWeek=\{selectWeek\} \/>/);
});
