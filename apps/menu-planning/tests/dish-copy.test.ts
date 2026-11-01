import test from "node:test";
import assert from "node:assert/strict";
import { assessDishCopyTarget, compatibleDishCopyTargets, copyableDishForSource, dishCopyUnavailableReason } from "../lib/dish-copy";
import type { RollingSnapshot } from "../lib/rolling-menu-types";

function fixture(): RollingSnapshot {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday"].map((dayName, index) => ({ id: dayName, date: `2026-10-${19 + index}`, dayName, entryIds: [] }));
  return { week: { id: "week-2026-10-19", weekCommencing: "2026-10-19", weekEnding: "2026-10-25", status: "draft", version: 3, dayIds: days.map(day => day.id), entryIds: [], sourceFiles: [], audit: [] }, days, entries: [{ id: "source", dayId: "monday", date: days[0].date, slot: "COLD PROTEIN", itemId: "dish:chicken", itemLabel: "Chicken Breast", portions: 24, allocations: [{ destinationLabel: "Site A", quantity: 24 }], allergens: { gluten: "contains" }, audit: [] }] };
}
const dishes = [{ id: "dish:chicken", name: "Chicken Breast", category: "Cold Protein" }, { id: "dish:soup", name: "Tomato Soup", category: "Soup" }, { id: "dish:legacy", name: "Legacy Dish", category: "Other" }];

test("copy accepts a canonical compatible dish and preserves the source identity", () => {
  const snapshot = fixture();
  const sourceBefore = structuredClone(snapshot.entries[0]);
  const result = assessDishCopyTarget(snapshot, dishes, "source", { dayId: "tuesday", slot: "COLD PROTEIN" });
  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.equal(result.dish.id, "dish:chicken");
  assert.equal(result.dish.name, "Chicken Breast");
  assert.equal(result.blankTarget, undefined);
  assert.deepEqual(snapshot.entries[0], sourceBefore);
});

test("copy rejects same-day, cross-category, occupied, same-cell and duplicate target entries", () => {
  const snapshot = fixture();
  for (const target of [{ dayId: "monday", slot: "COLD PROTEIN" }, { dayId: "monday", slot: "SOUP" }, { dayId: "tuesday", slot: "SOUP" }]) assert.equal(assessDishCopyTarget(snapshot, dishes, "source", target).allowed, false);
  snapshot.entries.push({ id: "occupied", dayId: "tuesday", date: snapshot.days[1].date, slot: "COLD PROTEIN", itemLabel: "Existing Dish", portions: 0, allocations: [], allergens: {}, audit: [] });
  assert.equal(assessDishCopyTarget(snapshot, dishes, "source", { dayId: "tuesday", slot: "COLD PROTEIN" }).allowed, false);
  snapshot.entries.push({ id: "conflict", dayId: "wednesday", date: snapshot.days[2].date, slot: "COLD PROTEIN", itemLabel: "", portions: 0, allocations: [], allergens: {}, audit: [] });
  snapshot.entries.push({ id: "conflict-2", dayId: "wednesday", date: snapshot.days[2].date, slot: "COLD PROTEIN", itemLabel: "", portions: 0, allocations: [], allergens: {}, audit: [] });
  assert.equal(assessDishCopyTarget(snapshot, dishes, "source", { dayId: "wednesday", slot: "COLD PROTEIN" }).allowed, false);
});

test("blank target can be reused but review state is not inherited from source", () => {
  const snapshot = fixture();
  snapshot.entries.push({ id: "blank", dayId: "tuesday", date: snapshot.days[1].date, slot: "COLD PROTEIN", itemLabel: "", portions: 0, allocations: [], allergens: {}, audit: [] });
  const result = assessDishCopyTarget(snapshot, dishes, "source", { dayId: "tuesday", slot: "COLD PROTEIN" });
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.blankTarget?.id, "blank");
  assert.equal(copyableDishForSource(snapshot, dishes, "source")?.id, "dish:chicken");
});

test("legacy/noncanonical dishes and targets outside this week cannot be copied", () => {
  const snapshot = fixture();
  snapshot.entries[0].itemId = "dish:legacy";
  assert.equal(copyableDishForSource(snapshot, dishes, "source"), undefined);
  snapshot.entries[0].itemId = "dish:chicken";
  assert.equal(assessDishCopyTarget(snapshot, dishes, "source", { dayId: "another-week", slot: "COLD PROTEIN" }).allowed, false);
});

test("keyboard targets include only compatible empty destinations", () => {
  const snapshot = fixture();
  const targets = compatibleDishCopyTargets(snapshot, dishes, "source", ["COLD PROTEIN", "SOUP"]);
  assert.deepEqual(targets.map(target => target.key), ["tuesday|COLD PROTEIN", "wednesday|COLD PROTEIN", "thursday|COLD PROTEIN", "friday|COLD PROTEIN"]);
});

test("Friday Starch/Side copies expose Monday and all earlier and later weekdays", () => {
  const snapshot = fixture();
  snapshot.entries[0].dayId = "friday";
  snapshot.entries[0].date = snapshot.days[4].date;
  snapshot.entries[0].slot = "STARCH/SIDE 1";
  const starch = { id: "dish:side", name: "Roast potatoes", category: "Starch/Side" };
  snapshot.entries[0].itemId = starch.id;
  snapshot.entries[0].itemLabel = starch.name;
  const slots = ["STARCH/SIDE 1", "STARCH/SIDE 2", "EXTRAS 1"];
  const targets = compatibleDishCopyTargets(snapshot, [starch], "source", slots);
  assert.deepEqual([...new Set(targets.map(target => target.dayId))], ["monday", "tuesday", "wednesday", "thursday"]);
  assert.equal(targets[0].slot, "STARCH/SIDE 1");
  assert.equal(assessDishCopyTarget(snapshot, [starch], "source", { dayId: "monday", slot: "STARCH/SIDE 2" }).allowed, true);
  assert.equal(assessDishCopyTarget(snapshot, [starch], "source", { dayId: "thursday", slot: "EXTRAS 1" }).allowed, true);
});

test("copy target feedback distinguishes category mismatch, occupied cells and locked days", () => {
  const snapshot = fixture();
  snapshot.entries[0].slot = "STARCH/SIDE 1";
  const starch = { id: "dish:side", name: "Roast potatoes", category: "Starch/Side" };
  snapshot.entries[0].itemId = starch.id;
  snapshot.entries[0].itemLabel = starch.name;
  snapshot.entries[0].dayId = "friday";
  snapshot.entries[0].date = snapshot.days[4].date;
  snapshot.days.slice(1).forEach(day => snapshot.entries.push({ id: `occupied-${day.id}`, dayId: day.id, date: day.date, slot: "STARCH/SIDE 1", itemId: "dish:side", itemLabel: "Roast potatoes", portions: 0, allocations: [], allergens: {}, audit: [] }));
  assert.match(dishCopyUnavailableReason(snapshot, [starch], "source", ["STARCH/SIDE 1"]), /already occupied/);
  snapshot.entries = snapshot.entries.filter(entry => entry.id === "source");
  snapshot.week.dayStatuses = Object.fromEntries(snapshot.days.map(day => [day.id, day.id === "monday" ? "published" : "draft"]));
  const result = assessDishCopyTarget(snapshot, [starch], "source", { dayId: "monday", slot: "STARCH/SIDE 1" });
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.match(result.reason, /immutable/);
  snapshot.entries[0].slot = "SAUCE 1";
  assert.match(dishCopyUnavailableReason(snapshot, [starch], "source", ["STARCH/SIDE 1"]), /not compatible/);
});

test("fully occupied compatible weekday targets produce a clear disabled explanation", () => {
  const snapshot = fixture();
  snapshot.entries[0].slot = "STARCH/SIDE 1";
  const starch = { id: "dish:side", name: "Roast potatoes", category: "Starch/Side" };
  snapshot.entries[0].itemId = starch.id;
  snapshot.entries[0].itemLabel = starch.name;
  for (const day of snapshot.days.slice(1)) snapshot.entries.push({ id: `occupied-${day.id}`, dayId: day.id, date: day.date, slot: "STARCH/SIDE 1", itemLabel: "Other", portions: 1, allocations: [], allergens: {}, audit: [] });
  assert.equal(compatibleDishCopyTargets(snapshot, [starch], "source", ["STARCH/SIDE 1"]).length, 0);
  assert.equal(dishCopyUnavailableReason(snapshot, [starch], "source", ["STARCH/SIDE 1"]), "All compatible Starch/Side cells on editable weekdays are already occupied.");
});

test("Dessert-category dishes can be selected and copied between the three Dessert slots", () => {
  const snapshot = fixture();
  const dessert = { id: "dish:pavlova", name: "Mini pavlova", category: "Dessert" };
  snapshot.entries.push({ id: "dessert-source", dayId: "monday", date: snapshot.days[0].date, slot: "DESSERT 1", itemId: dessert.id, itemLabel: dessert.name, portions: 12, allocations: [{ destinationLabel: "Site A", quantity: 12 }], allergens: { eggs: "contains" }, audit: [] });
  const result = assessDishCopyTarget(snapshot, [dessert], "dessert-source", { dayId: "tuesday", slot: "DESSERT 2" });
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.dish.id, dessert.id);
  const targets = compatibleDishCopyTargets(snapshot, [dessert], "dessert-source", ["DESSERT 1", "DESSERT 2", "DESSERT 3"]);
  assert.equal(targets.some(target => target.dayId === "monday"), false);
  assert.ok(targets.some(target => target.dayId === "tuesday" && target.slot === "DESSERT 2"));
  assert.ok(targets.some(target => target.dayId === "tuesday" && target.slot === "DESSERT 3"));
  assert.ok(targets.every(target => target.slot.startsWith("DESSERT ")));
});
