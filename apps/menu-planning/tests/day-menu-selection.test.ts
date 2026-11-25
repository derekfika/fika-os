import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayMenuSelect } from "../app/day-menu-select";
import { defaultWeekForDate, emptyWeek, requestedMenuWeek, supplementaryMenuWeekId } from "../lib/rolling-menu";

const monday = "2026-11-23";
const main = emptyWeek(monday);
const menu = (id: string, name: string, schedule: { recurrenceWeekdays?: number[]; serviceDate?: string }) => ({
  ...main.week, id: supplementaryMenuWeekId(monday, id),
  supplementaryMenu: { id, name, serviceType: "Breakfast" as const, siteIds: [id], ...schedule },
});
const munich = menu("munich-re", "Munich RE", { recurrenceWeekdays: [1] });
const extra = menu("one-off", "Extra breakfast", { serviceDate: monday });
const wise = menu("wise", "Wise", { recurrenceWeekdays: [5] });
const other = emptyWeek("2026-11-30").week;
const weeks = [other, wise, extra, main.week, munich];
const select = (current = main.week, day = main.days[0], available = weeks) =>
  renderToStaticMarkup(createElement(DayMenuSelect, { weeks: available, current, day, onSelect() {} }));

test("Main menu and each applicable Monday menu keep their actual week IDs whichever is selected", () => {
  for (const current of [main.week, munich, extra]) {
    const html = select(current);
    for (const target of [main.week, munich, extra]) {
      assert.ok(html.includes(`<option value="${target.id}"${target.id === current.id ? ' selected=""' : ""}>`), html);
    }
    assert.ok(html.includes(">Main menu</option>"));
    assert.ok(!html.includes(wise.id));
    assert.ok(!html.includes(other.id));
  }
});

test("Friday offers Wise and the primary menu when a Monday menu is open", () => {
  const html = select(munich, main.days[4]);
  assert.ok(html.includes("Choose menu"));
  assert.ok(html.includes(`value="${main.week.id}">Main menu`));
  assert.ok(html.includes(`value="${wise.id}">Wise`));
  assert.ok(!html.includes(munich.id));
  assert.equal(select(main.week, main.days[0], [main.week]), "");
  assert.ok(select(munich, main.days[0], [munich]).includes(`value="${main.week.id}">Main menu`));
});

test("reopened supplementary URLs and main date URLs resolve independently of summary order", () => {
  for (const list of [weeks, [...weeks].reverse()]) {
    assert.equal(requestedMenuWeek(list, munich.id, other.weekCommencing)?.id, munich.id);
    assert.equal(requestedMenuWeek(list, monday, monday)?.id, main.week.id);
    assert.equal(requestedMenuWeek(list, supplementaryMenuWeekId(monday, "missing"), monday), undefined);
    assert.equal(defaultWeekForDate(list, monday)?.id, main.week.id);
  }
});
