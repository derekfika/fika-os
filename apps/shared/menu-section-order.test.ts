import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareMenuEntries,
  menuSectionForSlot,
  orderMenuEntries,
  PROVISIONAL_HOT_MAIN_SUBGROUP_ORDER,
  PROVISIONAL_MENU_SECTION_ORDER,
  SALAD_SLOT_ORDER,
} from "./menu-section-order";

test("the exported section and salad hierarchies are explicitly provisional", () => {
  assert.deepEqual(PROVISIONAL_MENU_SECTION_ORDER, [
    "HOT MAINS", "SOUP", "SALADS", "SAUCES", "GARNISHES", "DESSERTS", "OTHER",
  ]);
  assert.deepEqual(PROVISIONAL_HOT_MAIN_SUBGROUP_ORDER, [
    "HOT MEAT / HOT MAIN", "HOT FISH", "HOT VEG / VEGAN",
  ]);
  assert.deepEqual(SALAD_SLOT_ORDER, [
    "SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SALAD 5", "SALAD 6",
  ]);
});

test("canonical and legacy slot IDs map to their intended provisional sections", () => {
  assert.equal(menuSectionForSlot("HOT MAIN").id, "hot-mains");
  assert.equal(menuSectionForSlot("HOT MEAT").subgroupId, "hot-meat-main");
  assert.equal(menuSectionForSlot("FISH").subgroupId, "hot-fish");
  assert.equal(menuSectionForSlot("VEGAN MAIN").subgroupId, "hot-veg-vegan");
  assert.equal(menuSectionForSlot("HOT VEG VEGAN").subgroupId, "hot-veg-vegan");
  assert.equal(menuSectionForSlot("SOUP 1").id, "soup");
  assert.equal(menuSectionForSlot("SAUCE 4").id, "sauces");
  assert.equal(menuSectionForSlot("GARNISH 2").id, "garnishes");
  assert.equal(menuSectionForSlot("DESSERT 3").id, "desserts");
  assert.equal(menuSectionForSlot("EXTRAS 1").id, "other");
  assert.equal(menuSectionForSlot("COLD PROTEIN").id, "other");
});

test("Hot Mains subgroups use the provisional subgroup sequence", () => {
  const entries = [
    { slot: "VEGAN MAIN", sourceEntryId: "vegan" },
    { slot: "FISH", sourceEntryId: "fish" },
    { slot: "HOT MAIN", sourceEntryId: "meat" },
  ];
  assert.deepEqual(orderMenuEntries(entries).map(({ sourceEntryId }) => sourceEntryId), ["meat", "fish", "vegan"]);
});

test("all six salad positions sort explicitly before a custom salad slot", () => {
  const entries = [
    { slot: "SALAD 6", sourceEntryId: "seasonal" },
    { slot: "SALAD 2", sourceEntryId: "slaw" },
    { slot: "SALAD 5", sourceEntryId: "grain-pulse" },
    { slot: "SALAD 1", sourceEntryId: "leaf" },
    { slot: "SALAD 4", sourceEntryId: "veg" },
    { slot: "SALAD 3", sourceEntryId: "starch" },
    { slot: "SALAD 7", sourceEntryId: "custom" },
  ];
  assert.deepEqual(orderMenuEntries(entries).map(({ sourceEntryId }) => sourceEntryId), [
    "leaf", "slaw", "starch", "veg", "grain-pulse", "seasonal", "custom",
  ]);
});

test("section ordering preserves authored order within a section and never alphabetizes dishes", () => {
  const entries = [
    { slot: "SOUP 1", originalIndex: 2, sourceEntryId: "z-soup", label: "A soup" },
    { slot: "SOUP 2", originalIndex: 1, sourceEntryId: "a-soup", label: "Z soup" },
  ];
  assert.deepEqual(orderMenuEntries(entries).map(({ label }) => label), ["Z soup", "A soup"]);
  assert.equal(compareMenuEntries(entries[0], entries[1]) > 0, true);
});

test("unknown slots stay visible in stable OTHER order and duplicate entries are not removed", () => {
  const entries = [
    { slot: "CUSTOM BREAKFAST", sourceEntryId: "b" },
    { slot: "CUSTOM DRINKS", sourceEntryId: "a" },
    { slot: "CUSTOM BREAKFAST", sourceEntryId: "b" },
  ];
  const ordered = orderMenuEntries(entries);
  assert.equal(ordered.length, entries.length);
  assert.deepEqual(ordered.map(({ sourceEntryId }) => sourceEntryId), ["b", "a", "b"]);
  assert.ok(ordered.every(({ slot }) => menuSectionForSlot(slot).id === "other"));
});

test("sort returns a copy and preserves fallback array order rather than alphabetizing by ID", () => {
  const entries = [
    { slot: "CUSTOM", sourceEntryId: "z" },
    { slot: "CUSTOM", sourceEntryId: "a" },
  ];
  const ordered = orderMenuEntries(entries);
  assert.notEqual(ordered, entries);
  assert.deepEqual(ordered.map(({ sourceEntryId }) => sourceEntryId), ["z", "a"]);
  assert.equal(compareMenuEntries(entries[0], entries[1]) > 0, true);
});
