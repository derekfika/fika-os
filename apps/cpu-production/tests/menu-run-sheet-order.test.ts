import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";
import type { ProductionLine, ProductionOrder } from "../lib/production-types";
import { runSheetMenuSections } from "../lib/menu-run-sheet-order";

const line = (id: string, slot: string, index: number, name = id, canonicalSlotId = slot) => ({
  canonicalId: `order:line:${id}`, sourceBookingLineId: `entry:${id}`, itemName: name,
  customerQuantity: index + 1, customerUnit: "portions", dietaries: {}, status: "ready",
  sortOrder: index, menuOrderVersion: "fika.menu-order.v1", slot,
  ...(canonicalSlotId ? { canonicalSlotId, canonicalOrderIndex: CANONICAL_MENU_SLOTS.findIndex(item => item.id === canonicalSlotId) } : {}),
} as unknown as ProductionLine);

const order = (lines: ProductionLine[], origin: ProductionOrder["origin"] = "menu_planning") => ({
  canonicalId: "order:menu", origin, status: "planned", version: 1, lines,
} as unknown as ProductionOrder);

test("run sheet renders all 29 canonical slots in the exact shared order", () => {
  const reversed = [...CANONICAL_MENU_SLOTS].reverse().map((slot, index) => line(`item-${index}`, slot.id, index, `Dish ${index}`));
  const ordered = runSheetMenuSections(order(reversed)).flatMap(section => section.lines.map(item => item.line.canonicalSlotId));
  assert.deepEqual(ordered, CANONICAL_MENU_SLOTS.map(slot => slot.id));
});

test("legacy aliases map deliberately and repeated slot labels retain distinct display numbers", () => {
  const sections = runSheetMenuSections(order([
    line("sauce-two", "SAUCE 2", 1), line("old-hot-meat", "HOT MEAT", 0),
    line("garnish-two", "GARNISH 2", 3), line("sauce-one", "SAUCE 1", 2),
    line("garnish-one", "GARNISH 1", 4),
  ]));
  assert.deepEqual(sections.map(section => section.label), ["HOT MAINS", "GARNISHES", "SAUCES"]);
  assert.deepEqual(sections[0].lines.map(item => item.slotLabel), ["Hot Main"]);
  assert.deepEqual(sections[1].lines.map(item => item.slotLabel), ["Garnish 1", "Garnish 2"]);
  assert.deepEqual(sections[2].lines.map(item => item.slotLabel), ["Sauce 1", "Sauce 2"]);
});

test("unknown legacy placements remain visible after canonical sections without name-based classification", () => {
  const sections = runSheetMenuSections(order([
    line("unknown-later", "", 5, "Tomato Salad Special", ""),
    line("canonical", "SALAD 1", 7, "Leaf Bowl"),
    line("unknown-first", "OLD EXTRA", 1, "Soup of the day", ""),
  ]));
  assert.deepEqual(sections.map(section => section.label), ["SALADS", "OTHER PLACEMENTS"]);
  assert.deepEqual(sections[0].lines.map(item => item.line.canonicalId), ["order:line:canonical"]);
  assert.deepEqual(sections[1].lines.map(item => item.line.canonicalId), ["order:line:unknown-first", "order:line:unknown-later"]);
  assert.deepEqual(sections[1].lines.map(item => item.slotLabel), ["OLD EXTRA", "Published placement missing"]);
});

test("non-menu production lines retain upstream order and are not inferred into Menu categories", () => {
  const sections = runSheetMenuSections(order([line("second", "DESSERT 4", 2), line("first", "SALAD 1", 1)], "hospitality_booking"));
  assert.deepEqual(sections.map(section => section.label), ["PRODUCTION ITEMS"]);
  assert.deepEqual(sections[0].lines.map(item => item.line.canonicalId), ["order:line:second", "order:line:first"]);
});
