import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";
import { aggregateProductionTotals, groupEntriesByDestination, type PublishedMenuEntrySummary } from "../lib/published-menu-selection";

const entry = (slotId: string, name: string, quantity: number, dishId = `dish:${slotId}`, destinationLabel = "Site A"): PublishedMenuEntrySummary => {
  const slot = CANONICAL_MENU_SLOTS.find(item => item.id === slotId)!;
  return { sourceEntryId: `entry:${slotId}:${name}`, menuOrderVersion: "fika.menu-order.v1", slot: slotId, canonicalSlotId: slotId, canonicalOrderIndex: slot.order, dishName: name, canonicalDishId: dishId, portions: quantity, allocations: [{ destinationLabel, quantity }] };
};

test("published destination and totals views follow all 29 canonical slots instead of input or dish-name order", () => {
  const reversed = [...CANONICAL_MENU_SLOTS].reverse().map(slot => entry(slot.id, `Dish ${slot.order}`, 1));
  const totals = aggregateProductionTotals(reversed);
  assert.deepEqual(totals.map(item => item.canonicalSlotId), CANONICAL_MENU_SLOTS.map(slot => slot.id));
  const grouped = groupEntriesByDestination(reversed);
  assert.deepEqual(grouped[0].entries.map(item => item.canonicalSlotId), CANONICAL_MENU_SLOTS.map(slot => slot.id));
});

test("same dish and same slot aggregates across sites; distinct slots remain separate and ordered", () => {
  const rows = aggregateProductionTotals([
    entry("DESSERT 1", "Pear crumble", 2),
    entry("SALAD 1", "Mixed leaves", 3, "dish:salad", "Site A"),
    entry("HOT FISH", "Mixed leaves", 5, "dish:salad", "Site A"),
    entry("SALAD 1", "Mixed leaves", 4, "dish:salad", "Site B"),
  ]);
  assert.deepEqual(rows.map(row => [row.canonicalSlotId, row.dishName, row.quantity]), [
    ["SALAD 1", "Mixed leaves", 7],
    ["HOT FISH", "Mixed leaves", 5],
    ["DESSERT 1", "Pear crumble", 2],
  ]);
});

test("legacy unknown slots remain after canonical entries in stable source order", () => {
  const canonical = entry("SALAD 1", "Dish Z", 1);
  const unknown = (id: string, slot: string): PublishedMenuEntrySummary => ({ sourceEntryId: id, slot, dishName: "Soup name does not infer slot", portions: 1, allocations: [{ destinationLabel: "Site A", quantity: 1 }] });
  const rows = aggregateProductionTotals([unknown("entry:unknown-b", "OLD EXTRA B"), canonical, unknown("entry:unknown-a", "OLD EXTRA A")]);
  assert.deepEqual(rows.map(row => row.slot), ["SALAD 1", "OLD EXTRA B", "OLD EXTRA A"]);
});
