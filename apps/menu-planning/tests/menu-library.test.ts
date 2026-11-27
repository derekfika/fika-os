import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSavedDailyMenuIntoDay,
  captureDayAsSavedMenuContent,
  menuStructureForWeek,
  mutateSavedDailyMenus,
  savedMenuCompatibilityReason,
  standardMainLunchStructure,
  validateSavedDailyMenuContent,
  type SavedDailyMenu,
} from "../lib/menu-library";
import { validateMenuStructure } from "../lib/menu-structure-library";
import type { RollingSnapshot } from "../lib/rolling-menu-types";

const breakfastStructure = () => validateMenuStructure({
  templateId: "breakfast-layout",
  templateVersion: 2,
  categories: [{ id: "breakfast-category", name: "Breakfast", rows: [
    { id: "breakfast-hot-row", slot: "HOT MAIN", name: "Hot dishes" },
    { id: "breakfast-fruit-row", slot: "SALAD 1", name: "Fruit and yoghurt" },
  ] }],
});

const menuContent = () => ({
  name: "Breakfast at Munich RE",
  serviceType: "Breakfast",
  category: "regular",
  tags: ["Munich RE", "weekday"],
  structure: breakfastStructure(),
  dishes: [{ slot: "HOT MAIN", dishId: "dish:eggs", dishName: "Scrambled eggs" }],
});

const breakfastSnapshot = (): RollingSnapshot => ({
  week: {
    id: "rolling-week:2026-11-23:menu:breakfast", weekCommencing: "2026-11-23", weekEnding: "2026-11-29", status: "draft", version: 4,
    dayIds: ["breakfast:monday"], entryIds: ["breakfast:monday:hot"], sourceFiles: [],
    supplementaryMenu: { id: "breakfast", name: "Breakfast service", serviceType: "Breakfast", siteIds: ["oploc:munich-re"], serviceTime: "08:30", recurrenceWeekdays: [1] },
    menuStructure: breakfastStructure(), audit: [],
  },
  days: [{ id: "breakfast:monday", date: "2026-11-23", dayName: "Monday", entryIds: ["breakfast:monday:hot"], destinationPax: { "oploc:munich-re": 45 } }],
  entries: [{
    id: "breakfast:monday:hot", dayId: "breakfast:monday", date: "2026-11-23", slot: "HOT MAIN", itemId: "dish:old", itemLabel: "Old breakfast dish",
    portions: 32, allocations: [{ destinationId: "oploc:munich-re", destinationLabel: "Munich RE", quantity: 32 }],
    allergens: { egg: "contains" }, allergenReview: { status: "confirmed", semantics: 2, confirmedBy: "person:reviewer", confirmedAt: "2026-11-20T08:00:00.000Z", statement: "recipe-ingredients-allergens-verified", inputFingerprint: "old-dish" },
    audit: [],
  }],
});

test("saved daily menus validate canonical rows, categories, tags and layout placements", () => {
  const content = validateSavedDailyMenuContent(menuContent());
  assert.equal(content.dishes[0].dishId, "dish:eggs");
  assert.deepEqual(content.tags, ["Munich RE", "weekday"]);
  assert.throws(() => validateSavedDailyMenuContent({ ...menuContent(), dishes: [{ ...menuContent().dishes[0], dishId: "" }] }), /canonical Dish Library ID/);
  assert.throws(() => validateSavedDailyMenuContent({ ...menuContent(), dishes: [{ ...menuContent().dishes[0], slot: "SOUP" }] }), /selected structure/);
});

test("a saved layout and daily menu content are copied independently of later template edits", () => {
  const layout = breakfastStructure();
  const menus: SavedDailyMenu[] = [];
  mutateSavedDailyMenus(menus, { action: "create", menu: { ...menuContent(), structure: layout } }, "person:owner", "2026-11-27T10:00:00.000Z", () => "saved-layout-independent");
  layout.categories[0].name = "Renamed source layout";
  layout.categories[0].rows[0].name = "Renamed source row";
  assert.equal(menus[0].structure.categories[0].name, "Breakfast");
  assert.equal(menus[0].structure.categories[0].rows[0].name, "Hot dishes");
});

test("saved menu edits retain a stable identity and immutable prior revision; duplicate and archive are independent", () => {
  const menus: SavedDailyMenu[] = [];
  mutateSavedDailyMenus(menus, { action: "create", menu: menuContent() }, "person:owner", "2026-11-27T10:00:00.000Z", () => "saved-breakfast-01");
  const id = menus[0].id;
  mutateSavedDailyMenus(menus, { action: "edit", menuId: id, expectedVersion: 1, menu: { ...menuContent(), name: "Breakfast at Munich RE revised", dishes: [] } }, "person:owner", "2026-11-27T11:00:00.000Z");
  assert.equal(menus[0].id, id);
  assert.equal(menus[0].version, 2);
  assert.equal(menus[0].revisions[0].content.dishes[0].dishId, "dish:eggs");
  mutateSavedDailyMenus(menus, { action: "duplicate", menuId: id, expectedVersion: 2, name: "Breakfast copy" }, "person:owner", "2026-11-27T12:00:00.000Z", () => "saved-breakfast-02");
  assert.equal(menus[1].id, "saved-breakfast-02");
  assert.notEqual(menus[1].id, id);
  assert.equal(menus[1].version, 1);
  mutateSavedDailyMenus(menus, { action: "edit", menuId: id, expectedVersion: 2, menu: { ...menuContent(), name: "Breakfast at Munich RE revised again", dishes: [] } }, "person:owner", "2026-11-27T12:30:00.000Z");
  assert.equal(menus[1].name, "Breakfast copy", "editing the source never silently alters a duplicate");
  assert.equal(menus[1].version, 1);
  mutateSavedDailyMenus(menus, { action: "archive", menuId: id, expectedVersion: 3 }, "person:owner", "2026-11-27T13:00:00.000Z");
  assert.equal(menus[0].archivedAt, "2026-11-27T13:00:00.000Z");
  assert.equal(menus[1].archivedAt, undefined);
});

test("loading a saved Breakfast resets quantities for changed dishes while preserving PAX, target date and service details", () => {
  const before = breakfastSnapshot();
  const menu = { serviceType: "Breakfast" as const, structure: breakfastStructure(), dishes: menuContent().dishes };
  assert.equal(savedMenuCompatibilityReason(menu, before), undefined);
  const after = loadSavedDailyMenuIntoDay(before, "breakfast:monday", menu);
  const loaded = after.entries.find(entry => entry.slot === "HOT MAIN")!;
  assert.equal(loaded.itemId, "dish:eggs");
  assert.equal(loaded.itemLabel, "Scrambled eggs");
  assert.equal(loaded.portions, 0);
  assert.deepEqual(loaded.allocations, [], "old per-dish portions and allocations cannot carry to another dish");
  assert.equal(loaded.allergenReviewInvalidated, true);
  assert.deepEqual(after.days[0].destinationPax, before.days[0].destinationPax);
  assert.equal(after.days[0].date, before.days[0].date);
  assert.deepEqual(after.week.supplementaryMenu, before.week.supplementaryMenu);
  assert.deepEqual(after.week.menuStructure, before.week.menuStructure);
  assert.equal(JSON.stringify(before.entries[0].allergenReview), JSON.stringify({ status: "confirmed", semantics: 2, confirmedBy: "person:reviewer", confirmedAt: "2026-11-20T08:00:00.000Z", statement: "recipe-ingredients-allergens-verified", inputFingerprint: "old-dish" }));
  assert.equal(after.week.status, "draft", "loading never publishes or creates downstream work");
});

test("loading a complete saved day clears dishes absent from the library content and does not change its original entry", () => {
  const before = breakfastSnapshot();
  const withFruit = structuredClone(before);
  withFruit.entries.push({ id: "breakfast:monday:fruit", dayId: "breakfast:monday", date: "2026-11-23", slot: "SALAD 1", itemId: "dish:fruit", itemLabel: "Fruit", portions: 18, allocations: [{ destinationId: "oploc:munich-re", destinationLabel: "Munich RE", quantity: 18 }], allergens: {}, audit: [] });
  withFruit.entries.push({ id: "breakfast:monday:extra", dayId: "breakfast:monday", date: "2026-11-23", slot: "EXTRAS 1", itemId: "dish:extra", itemLabel: "Extra row", portions: 4, allocations: [{ destinationId: "oploc:munich-re", destinationLabel: "Munich RE", quantity: 4 }], allergens: {}, audit: [] });
  withFruit.days[0].entryIds.push("breakfast:monday:fruit", "breakfast:monday:extra");
  withFruit.week.entryIds.push("breakfast:monday:fruit", "breakfast:monday:extra");
  const menu = { serviceType: "Breakfast" as const, structure: breakfastStructure(), dishes: menuContent().dishes };
  const after = loadSavedDailyMenuIntoDay(withFruit, "breakfast:monday", menu);
  const fruit = after.entries.find(entry => entry.id === "breakfast:monday:fruit")!;
  assert.equal(fruit.itemId, "");
  assert.equal(fruit.portions, 0);
  assert.deepEqual(fruit.allocations, []);
  const extra = after.entries.find(entry => entry.id === "breakfast:monday:extra")!;
  assert.equal(extra.itemId, "");
  assert.equal(extra.portions, 0);
  assert.deepEqual(extra.allocations, []);
  assert.equal(withFruit.entries.find(entry => entry.id === fruit.id)?.itemId, "dish:fruit", "library loading returns an independent planner draft snapshot");
  assert.equal(after.days[0].destinationPax?.["oploc:munich-re"], 45);
});

test("menu library rejects service and layout mismatches and supplies the canonical Main Lunch structure", () => {
  const snapshot = breakfastSnapshot();
  const menu = { serviceType: "Lunch" as const, structure: standardMainLunchStructure(), dishes: [] };
  assert.match(savedMenuCompatibilityReason(menu, snapshot) || "", /selected day is Breakfast/);
  const altered = { serviceType: "Breakfast" as const, structure: { categories: [{ ...breakfastStructure().categories[0], name: "Different layout" }] }, dishes: [] };
  assert.match(savedMenuCompatibilityReason(altered, snapshot) || "", /layout differs/);
  const mainLunch = { ...snapshot, week: { ...snapshot.week, supplementaryMenu: undefined, menuStructure: undefined } };
  assert.deepEqual(menuStructureForWeek(mainLunch), standardMainLunchStructure());
  assert.equal(standardMainLunchStructure().categories.flatMap(category => category.rows).length, 29);
  const customMainLunch = { ...mainLunch, week: { ...mainLunch.week, customSlots: ["SALAD 7"] }, entries: [{ id: "custom", dayId: "breakfast:monday", date: "2026-11-23", slot: "SALAD 7", itemId: "dish:extra", itemLabel: "Extra salad", portions: 1, allocations: [], allergens: {}, audit: [] }] };
  assert.throws(() => captureDayAsSavedMenuContent(customMainLunch, "breakfast:monday", { name: "Main Lunch with custom row", category: "regular", tags: [] }), /outside its reusable menu layout/);
});
