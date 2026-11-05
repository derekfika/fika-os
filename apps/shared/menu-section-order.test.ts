import assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_MENU_SLOTS, MENU_ORDER_VERSION, canonicalMenuSlotIdFor, menuSectionForSlot, orderMenuEntries } from "./menu-section-order";

test("canonical presentation contract contains Brian's 29 distinct slots in section order", () => {
  assert.equal(MENU_ORDER_VERSION, "fika.menu-order.v1");
  assert.equal(CANONICAL_MENU_SLOTS.length, 29);
  assert.equal(new Set(CANONICAL_MENU_SLOTS.map(slot => slot.id)).size, 29);
  assert.deepEqual(CANONICAL_MENU_SLOTS.map(slot => slot.label), [
    "Leaf Salad", "Slaw", "Starch", "Veg", "Grain/Pulse", "FIKA Seasonal",
    "Meat", "Fish", "Vegan", "Hot Main", "Fish", "Vegan/Veggie", "Soup",
    ...Array(4).fill("Starch/Side"), ...Array(4).fill("Garnish"),
    ...Array(4).fill("Sauce"), ...Array(4).fill("Dessert"),
  ]);
});

test("legacy saved slot labels map deterministically without changing their source values", () => {
  assert.equal(menuSectionForSlot("HOT MEAT 2").label, "HOT MAINS");
  assert.equal(menuSectionForSlot("FISH 1").label, "HOT MAINS");
  assert.equal(menuSectionForSlot("COLD PROTEIN").label, "COLD PROTEINS");
  assert.equal(menuSectionForSlot("EXTRAS 2").label, "STARCH/SIDES");
  assert.equal(menuSectionForSlot("CUSTOM SLOT").label, "OTHER");
  assert.equal(canonicalMenuSlotIdFor("EXTRAS 1"), "STARCH/SIDE 1");
  assert.equal(canonicalMenuSlotIdFor("EXTRAS 4"), "STARCH/SIDE 4");
  assert.equal(canonicalMenuSlotIdFor("EXTRAS 5"), undefined);
  assert.equal(canonicalMenuSlotIdFor("EXTRAS 6"), undefined);
  assert.equal(canonicalMenuSlotIdFor("COLD PROTEIN"), "COLD PROTEIN MEAT");
});

test("ordering preserves canonical slot order, stable legacy fallback, and duplicate dishes", () => {
  const entries = [
    { slot: "DESSERT 2", id: "one", name: "Zebra cake" },
    { slot: "SALAD 2", id: "two", name: "Z slaw" },
    { slot: "SALAD 1", id: "three", name: "A leaf salad" },
    { slot: "CUSTOM", id: "four", name: "Legacy" },
    { slot: "SALAD 1", id: "three", name: "A leaf salad" },
  ];
  assert.deepEqual(orderMenuEntries(entries).map(entry => entry.id), ["three", "three", "two", "one", "four"]);
  assert.deepEqual(entries.map(entry => entry.id), ["one", "two", "three", "four", "three"]);
});
