import test from "node:test";
import assert from "node:assert/strict";
import { dismissOccasion, londonDateKey, occasionsForDate, parseThemeDate, syncDue, type ThemeDayEvent } from "../lib/theme-days";

const events: ThemeDayEvent[] = [
  { id: "a", occasion: "Bonfire Night", annualMonthDay: "11-05", scope: "uk" },
  { id: "b", occasion: "Diwali", date: "2026-11-08", scope: "international" },
  { id: "c", occasion: "bonfire night", annualMonthDay: "11-05", scope: "uk", notes: "duplicate row" },
  { id: "d", occasion: "Halloween", annualMonthDay: "10-31", scope: "unspecified" },
];

test("parses ISO and UK date formats and rejects ambiguous or impossible dates", () => {
  assert.equal(parseThemeDate("2026-11-05"), "2026-11-05");
  assert.equal(parseThemeDate("05/11/2026"), "2026-11-05");
  assert.equal(parseThemeDate("5-11-2026"), "2026-11-05");
  assert.equal(parseThemeDate("31/02/2026"), undefined);
  assert.equal(parseThemeDate("not a date"), undefined);
  assert.equal(parseThemeDate(""), undefined);
});

test("London day keys follow Europe/London across the BST boundary", () => {
  // BST ends 25 Oct 2026 at 01:00 UTC; 23:30 UTC on the 25th is still the 25th in London.
  assert.equal(londonDateKey(new Date("2026-10-25T23:30:00Z")), "2026-10-25");
  assert.equal(londonDateKey(new Date("2026-10-26T00:30:00Z")), "2026-10-26");
  // 2026-03-29 00:30 UTC is 01:30 BST on the same London day.
  assert.equal(londonDateKey(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
});

test("sync is due at most once per London day", () => {
  const morning = new Date("2026-11-05T07:00:00Z");
  assert.equal(syncDue(undefined, morning), true);
  assert.equal(syncDue("2026-11-05", morning), false);
  assert.equal(syncDue("2026-11-04", morning), true);
});

test("annual occasions recur, one-offs match only their date, and duplicates collapse", () => {
  const onFifthNovember = occasionsForDate(events, "2027-11-05");
  assert.deepEqual(onFifthNovember.map(item => item.id), ["a"]);
  assert.deepEqual(occasionsForDate(events, "2026-11-08").map(item => item.id), ["b"]);
  assert.deepEqual(occasionsForDate(events, "2026-11-09"), []);
});

test("several occasions on one date are returned in a stable order", () => {
  const sameDay: ThemeDayEvent[] = [
    { id: "x", occasion: "Zebra day", date: "2026-11-08", scope: "international" },
    { id: "y", occasion: "Apple day", date: "2026-11-08", scope: "uk" },
  ];
  assert.deepEqual(occasionsForDate(sameDay, "2026-11-08").map(item => item.occasion), ["Apple day", "Zebra day"]);
});

test("dismissal hides an occasion locally and never removes the source event", () => {
  const dismissed = dismissOccasion(new Set(), "b");
  assert.deepEqual(occasionsForDate(events, "2026-11-08", dismissed), []);
  assert.equal(events.find(item => item.id === "b")?.date, "2026-11-08");
});
