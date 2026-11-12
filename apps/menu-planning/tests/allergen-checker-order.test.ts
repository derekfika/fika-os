import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_MENU_SLOTS, orderMenuEntries } from "../../shared/menu-section-order";
import { groupedSlots } from "../lib/week-planner-layout";
import { emptyWeek } from "../lib/rolling-menu";
import { newWeekTemplateSlots, ROLLING_SLOTS } from "../lib/rolling-menu-types";
import { groupAllergenCheckerEntries, occurrenceLabels, orderAllergenCheckerEntries } from "../lib/allergen-checker-order";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

test("all 29 canonical placements follow the shared Week Planner order on every weekday", () => {
  assert.equal(CANONICAL_MENU_SLOTS.length, 29);
  for (const day of weekdays) {
    const shuffled = [...CANONICAL_MENU_SLOTS].reverse().map((slot, index) => ({ id: `${day}:${index}`, itemId: `${day}:dish:${index}`, itemLabel: `Dish ${index}`, slot: slot.id, allergens: { milk: index % 2 ? "contains" : "may_contain" }, allergenDetailNotes: `note ${index}` }));
    const expected = orderMenuEntries(shuffled.map((entry, originalIndex) => ({ ...entry, originalIndex }))).map((entry) => entry.slot);
    const ordered = orderAllergenCheckerEntries(shuffled);
    assert.deepEqual(ordered.map((entry) => entry.slot), expected, `${day} order matches the shared Week Planner comparator`);
    for (const entry of ordered) assert.equal(entry, shuffled.find((candidate) => candidate.id === entry.id), "ordering keeps each dish and its allergen declaration paired by entry identity");
  }
});

test("the 18 reported row types stay grouped in their canonical sections and placements", () => {
  const slots = ["COLD PROTEIN MEAT", "HOT FISH", "HOT VEGAN", "COLD PROTEIN FISH"];
  const entries = weekdays.flatMap((day) => slots.map((slot, index) => ({ id: `${day}:${index}`, itemLabel: `${day} dish ${index}`, slot })));
  const ordered = orderAllergenCheckerEntries(entries);
  assert.deepEqual(ordered.slice(0, 10).map((entry) => entry.slot), Array(5).fill("COLD PROTEIN MEAT").concat(Array(5).fill("COLD PROTEIN FISH")));
  assert.deepEqual(groupAllergenCheckerEntries(entries).map((group) => group.label), ["Cold Proteins", "Hot Mains"]);
  assert.deepEqual(new Set(ordered.map((entry) => entry.id)), new Set(entries.map((entry) => entry.id)));
});

test("custom and historical rows are deterministic without rewriting source slot identities", () => {
  const rows = [
    { id: "z-extra", slot: "Chef's Extra Row", itemLabel: "Extra greens" },
    { id: "alias", slot: "COLD PROTEIN", itemLabel: "Legacy meat" },
    { id: "a-extra", slot: "Chef's Extra Row", itemLabel: "Extra beans" },
    { id: "canonical", slot: "COLD PROTEIN MEAT", itemLabel: "Canonical meat" },
  ];
  const first = orderAllergenCheckerEntries(rows).map((entry) => entry.id);
  assert.deepEqual(orderAllergenCheckerEntries([...rows].reverse()).map((entry) => entry.id), first);
  assert.deepEqual(first.slice(0, 2), ["canonical", "alias"]);
  assert.deepEqual(orderAllergenCheckerEntries(rows).map((entry) => entry.slot), ["COLD PROTEIN MEAT", "COLD PROTEIN", "Chef's Extra Row", "Chef's Extra Row"]);
  assert.equal(groupAllergenCheckerEntries(rows).at(-1)?.label, "Additional menu rows");
});

test("repeated dish placements remain distinct and receive stable occurrence labels", () => {
  const repeated = [
    { id: "entry:b", slot: "SALAD 2", itemId: "dish:slaw", itemLabel: "Cabbage slaw" },
    { id: "entry:a", slot: "SALAD 2", itemId: "dish:slaw", itemLabel: "Cabbage slaw" },
  ];
  const labels = occurrenceLabels(repeated);
  assert.equal(labels.get("entry:a"), "Occurrence 1 of 2");
  assert.equal(labels.get("entry:b"), "Occurrence 2 of 2");
  assert.deepEqual(orderAllergenCheckerEntries(repeated).map((entry) => entry.id), ["entry:a", "entry:b"]);
});

test("each weekday renders the same canonical order as its Week Planner source entries", () => {
  const menu = weekdays.map((day) => ({ day, entries: CANONICAL_MENU_SLOTS.map((slot, index) => ({ id: `${day}:${index}`, slot: slot.id, itemLabel: `${slot.label} ${index}` })).reverse() }));
  for (const { day, entries } of menu) {
    const plannerOrder = orderMenuEntries(entries.map((entry, originalIndex) => ({ ...entry, originalIndex }))).map((entry) => entry.id);
    assert.deepEqual(orderAllergenCheckerEntries(entries).map((entry) => entry.id), plannerOrder, day);
  }
});

test("a newly opened week renders canonical slots once and filters superseded legacy aliases", () => {
  const week = emptyWeek("2026-11-16", "fixture", newWeekTemplateSlots(["COLD PROTEIN", "FISH 1", "VEGAN MAIN 1", "SALAD 6"]));
  const rendered = groupedSlots(week).flatMap(([, slots]) => slots);
  assert.deepEqual(rendered, ROLLING_SLOTS);
  assert.equal(new Set(rendered).size, 29);
  assert.equal(rendered.some((slot) => ["COLD PROTEIN", "FISH 1", "VEGAN MAIN 1"].includes(slot)), false);
});
