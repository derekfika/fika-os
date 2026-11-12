import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";
import { emptyWeek } from "../lib/rolling-menu";
import { groupedSlots } from "../lib/week-planner-layout";
import { orderAllergenCheckerEntries } from "../lib/allergen-checker-order";

test("all 29 canonical dish rows match Week Planner order on every weekday", () => {
  const snapshot = emptyWeek("2026-11-16");
  const plannerSlotOrder = groupedSlots(snapshot).flatMap(([, slots]) => slots);
  assert.deepEqual(plannerSlotOrder, CANONICAL_MENU_SLOTS.map(slot => slot.id));

  const weekdays = snapshot.days.slice(0, 5);
  assert.deepEqual(weekdays.map(day => day.dayName), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  for (const day of weekdays) {
    const entries = [...plannerSlotOrder].reverse().map((slot, index) => ({
      id: `${day.id}:entry:${index}`,
      dayId: day.id,
      slot,
      itemId: `dish:${slot}`,
      itemLabel: `${day.dayName} ${slot}`,
      allergens: { milk: index % 2 ? "contains" : "may_contain" },
      allergenDetailNotes: `evidence-${index}`,
    }));
    const expected = plannerSlotOrder.map(slot => entries.find(entry => entry.slot === slot)!);
    const ordered = orderAllergenCheckerEntries(entries, plannerSlotOrder);
    assert.deepEqual(ordered.map(entry => entry.id), expected.map(entry => entry.id), day.dayName);
    for (const entry of ordered) assert.equal(entry, entries.find(candidate => candidate.id === entry.id), "sorting keeps each declaration and note with its original entry");
  }
});

test("historical aliases and legitimate additional rows follow the exact Week Planner positions", () => {
  const snapshot = emptyWeek("2026-11-16");
  snapshot.week.templateSlots = [...snapshot.week.templateSlots!, "COLD PROTEIN", "HOT MEAT"];
  snapshot.week.customSlots = ["Z EXTRA SIDE", "A EXTRA SIDE"];
  const plannerSlotOrder = groupedSlots(snapshot).flatMap(([, slots]) => slots);
  for (const day of snapshot.days.slice(0, 5)) {
    const rows = [
      ["A EXTRA SIDE", "Extra A"], ["COLD PROTEIN FISH", "Fish"], ["COLD PROTEIN", "Legacy meat"],
      ["Z EXTRA SIDE", "Extra Z"], ["COLD PROTEIN MEAT", "Meat"], ["HOT VEGAN", "Vegan"],
      ["HOT MEAT", "Legacy hot main"], ["HOT MAIN", "Hot main"],
    ] as const;
    const entries = [...rows].reverse().map(([slot, itemLabel], index) => ({ id: `${day.id}:entry:${index}`, dayId: day.id, slot, itemLabel }));
    const ordered = orderAllergenCheckerEntries(entries, plannerSlotOrder);
    const expected = plannerSlotOrder.flatMap(slot => entries.filter(entry => entry.slot === slot));
    assert.deepEqual(ordered.map(entry => entry.id), expected.map(entry => entry.id), day.dayName);
    assert.deepEqual(ordered.slice(-2).map(entry => entry.slot), ["Z EXTRA SIDE", "A EXTRA SIDE"], day.dayName);
    assert.deepEqual(ordered.filter(entry => entry.slot.startsWith("COLD PROTEIN")).map(entry => entry.slot), ["COLD PROTEIN MEAT", "COLD PROTEIN", "COLD PROTEIN FISH"], day.dayName);
    assert.ok(ordered.some(entry => entry.slot === "HOT MEAT"), "historical slot identity remains unchanged");
  }
});

test("repeated dish entries stay distinct and retain their saved order within the same Week Planner slot", () => {
  const snapshot = emptyWeek("2026-11-16");
  const plannerSlotOrder = groupedSlots(snapshot).flatMap(([, slots]) => slots);
  const repeated = [
    { id: "entry:b", slot: "SALAD 2", itemId: "dish:slaw", itemLabel: "Cabbage slaw", allergens: { eggs: "contains" } },
    { id: "entry:a", slot: "SALAD 2", itemId: "dish:slaw", itemLabel: "Cabbage slaw", allergens: { eggs: "may_contain" } },
  ];
  const ordered = orderAllergenCheckerEntries(repeated, plannerSlotOrder);
  assert.deepEqual(ordered.map(entry => entry.id), ["entry:b", "entry:a"]);
  assert.deepEqual(ordered.map(entry => entry.allergens.eggs), ["contains", "may_contain"]);
  assert.equal(new Set(ordered.map(entry => entry.id)).size, 2);
});
