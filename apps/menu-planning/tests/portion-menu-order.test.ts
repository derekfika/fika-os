import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";
import { orderPortionPlannerEntries } from "../lib/portion-menu-order";

test("Portion Planner follows all 29 canonical slots and preserves source entries", () => {
  const reversed = [...CANONICAL_MENU_SLOTS].reverse().map((slot, index) => ({ id: `entry:${slot.id}`, slot: slot.id, portions: index + 1 }));
  const ordered = orderPortionPlannerEntries(reversed);
  assert.deepEqual(ordered.map(entry => entry.slot), CANONICAL_MENU_SLOTS.map(slot => slot.id));
  assert.deepEqual(ordered.map(entry => entry.portions), CANONICAL_MENU_SLOTS.map(slot => 29 - slot.order));
  assert.equal(reversed[0].slot, CANONICAL_MENU_SLOTS.at(-1)?.id, "sorting never mutates the snapshot entries");
});

test("Portion Planner maps legacy aliases into the canonical slot sequence and keeps unknown rows last", () => {
  const rows = [
    { id: "legacy-extra", slot: "EXTRAS 2" },
    { id: "dessert", slot: "DESSERT 2" },
    { id: "unknown-b", slot: "OLD EXTRA B" },
    { id: "salad", slot: "SALAD 1" },
    { id: "unknown-a", slot: "OLD EXTRA A" },
  ];
  assert.deepEqual(orderPortionPlannerEntries(rows).map(entry => entry.id), ["salad", "legacy-extra", "dessert", "unknown-b", "unknown-a"]);
});
