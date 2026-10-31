import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyWeek } from "../lib/rolling-menu";
import { assertMenuSlotCanBeRemoved } from "../lib/rolling-menu-types";
import { groupedSlots } from "../lib/week-planner-layout";
import { weekPlannerSlotLabel } from "../lib/week-planner-slot-label";

test("Week Planner shows owner-approved salad display names without changing generic slot labels", () => {
  const labels = ["Leaf Salad", "Slaw", "Starch", "Veg", "Grain/Pulse", "FIKA Seasonal"];
  labels.forEach((label, index) => {
    assert.equal(weekPlannerSlotLabel(`SALAD ${index + 1}`, "Salad"), label);
  });
  assert.equal(weekPlannerSlotLabel("HOT MAIN", "Hot Main"), "Hot Main");
  assert.equal(weekPlannerSlotLabel("CUSTOM SLOT", "Custom display"), "Custom display");
  const component = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
  assert.match(component, /<strong>\{plannerSlotLabel\(slot\)\}<\/strong>/, "slot row headings show the explicit subtype");
  assert.match(component, /<small>\{plannerSlotLabel\(slot\)\}<\/small>/, "picker headings show the explicit subtype");
  assert.match(component, /Select dish for \$\{day\.dayName\}, \$\{plannerSlotLabel\(slot\)\}/, "Monday and other day cells expose the same specific label");
  assert.match(component, /No slot-specific recommendations yet\. Showing all category-compatible salads\./, "a zero-match default still explains its eligible catalogue fallback");
});

test("Fish follows Hot Main, Soup has its own section, and permanent Dessert rows stay last", () => {
  const snapshot = emptyWeek("2026-11-02");
  assert.deepEqual(snapshot.week.templateSlots?.slice(-3), ["DESSERT 1", "DESSERT 2", "DESSERT 3"]);
  snapshot.week.templateSlots = ["HOT MAIN", "FISH 1", "SOUP", "SAUCE 1", "DESSERT 1"];
  const groups = groupedSlots(snapshot);
  assert.deepEqual(groups.map(([name]) => name), ["HOT MAIN", "FISH", "SOUP", "SAUCE", "DESSERTS"]);
  assert.deepEqual(groups.at(-1)?.[1], ["DESSERT 1", "DESSERT 2", "DESSERT 3"]);
});

test("legacy draft weeks show each permanent Dessert row once without saved-week rewrites", () => {
  const draft = emptyWeek("2026-11-02");
  draft.week.templateSlots = ["SALAD 1", "DESSERT 1"];
  draft.week.customSlots = ["DESSERT 2"];
  draft.week.removedSlots = ["DESSERT 3"];
  const before = structuredClone(draft.week);
  const groups = groupedSlots(draft);
  assert.deepEqual(groups.at(-1)?.[1], ["DESSERT 1", "DESSERT 2", "DESSERT 3"]);
  assert.deepEqual(draft.week, before);
});

test("completed and published historical weeks do not gain Dessert rows", () => {
  const published = emptyWeek("2026-10-19");
  published.week.status = "published";
  published.week.templateSlots = ["HOT MAIN", "SOUP"];
  const groups = groupedSlots(published);
  assert.deepEqual(groups.map(([name]) => name), ["HOT MAIN", "SOUP"]);
});

test("new templates include all six salad positions while saved historical plans keep their exact rows", () => {
  const newlyAuthored = emptyWeek("2026-11-02");
  assert.deepEqual(newlyAuthored.week.templateSlots?.slice(0, 6), ["SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SALAD 5", "SALAD 6"]);
  const published = emptyWeek("2026-10-19");
  published.week.status = "published";
  published.week.templateSlots = ["SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SOUP"];
  const before = structuredClone(published.week);
  assert.deepEqual(groupedSlots(published).flatMap(([, slots]) => slots), before.templateSlots);
  assert.deepEqual(published.week, before);
});

test("standard Dessert rows are permanent and cannot be removed from a draft week", () => {
  assert.throws(() => assertMenuSlotCanBeRemoved("DESSERT 2"), (error: any) => error.status === 409);
  assert.doesNotThrow(() => assertMenuSlotCanBeRemoved("SALAD 1"));
});
