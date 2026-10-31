import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  UNASSIGNED_SUBTYPE,
  dishMatchesFilters,
  dishMatchesQuery,
  dishesForSlot,
  emptyPickerFilters,
  emptyPickerMessage,
  filterOptions,
  filterPickerDishes,
  hasPickerFilters,
  pickerChips,
  removeChip,
  searchFilterOptions,
  toggleValue,
  type PickerFilterDish,
} from "../lib/dish-picker-filters";
import type { DishTag } from "../lib/dish-tags";

const tag = (id: string, label: string): DishTag => ({ id, label, group: "type", synonyms: [], createdAt: "", createdBy: "" });
const TAGS = [tag("t:chicken", "Chicken"), tag("t:indian", "Indian"), tag("t:spiced", "Spiced"), tag("t:slaw", "Slaw")];

const dish = (id: string, name: string, over: Partial<PickerFilterDish> = {}): PickerFilterDish => ({ id, name, category: "Salad", ...over });
const dishes: PickerFilterDish[] = [
  dish("leaf1", "Baby Leaves", { subcategory: "Leaf", tagIds: ["t:slaw"] }),
  dish("leaf2", "Rocket and Parmesan", { subcategory: "Salad 1" }),
  dish("slaw1", "Asian Slaw", { subcategory: "Slaw", tagIds: ["t:slaw", "t:spiced"], aliases: ["Oriental coleslaw"] }),
  dish("veg1", "Roasted Veg", { subcategory: "Veg", tagIds: ["t:spiced"] }),
  dish("none1", "Mystery Salad"),
  dish("seasonal1", "Autumn Special", { subcategory: "FIKA Seasonal" }),
  dish("hot1", "Chicken Tikka", { category: "Hot Main", tagIds: ["t:chicken", "t:indian", "t:spiced"] }),
  dish("hot2", "Beef Stew", { category: "Hot Main", tagIds: ["t:spiced"] }),
  dish("fish1", "Baked Cod", { category: "Fish", tagIds: [] }),
  dish("soup1", "Tomato Soup", { category: "Soup" }),
];
const ids = (list: PickerFilterDish[]) => list.map((entry) => entry.id).sort();

test("a slot's primary category is the eligibility gate and all compatible salads remain browsable", () => {
  assert.deepEqual(ids(dishesForSlot(dishes, "SALAD 1")), ["leaf1", "leaf2", "none1", "seasonal1", "slaw1", "veg1"]);
  assert.deepEqual(ids(dishesForSlot(dishes, "SALAD 2")), ["leaf1", "leaf2", "none1", "seasonal1", "slaw1", "veg1"]);
  assert.deepEqual(ids(dishesForSlot(dishes, "SALAD 4")), ["leaf1", "leaf2", "none1", "seasonal1", "slaw1", "veg1"]);
  assert.deepEqual(ids(dishesForSlot(dishes, "SALAD 6")), ["leaf1", "leaf2", "none1", "seasonal1", "slaw1", "veg1"], "Seasonal recommendation remains explicit, but other compatible salads remain available in All compatible");
  assert.ok(dishesForSlot(dishes, "SALAD 1").some(entry => entry.id === "none1"), "Monday's eligible untagged salad remains discoverable through All compatible");
  assert.deepEqual(ids(dishesForSlot(dishes, "SOUP")), ["soup1"]);
  assert.deepEqual(ids(dishesForSlot(dishes, "HOT MAIN")), ["fish1", "hot1", "hot2"]);
});

test("search matches canonical names and aliases, ignoring case and spacing, and not tags or categories", () => {
  assert.equal(dishMatchesQuery(dishes[2], "  ASIAN   slaw "), true);
  assert.equal(dishMatchesQuery(dishes[2], "coleslaw"), true, "alias");
  assert.equal(dishMatchesQuery(dishes[2], "oriental"), true);
  assert.equal(dishMatchesQuery(dishes[2], "spiced"), false, "tags are filtered, not searched");
  assert.equal(dishMatchesQuery(dishes[2], "salad"), false, "category text is not searched");
  assert.equal(dishMatchesQuery(dishes[2], ""), true);
  assert.equal(dishMatchesQuery(dishes[2], "asian cabbage"), false, "every term must match");
});

test("tag filter matches any selected tag; categories and salad slots likewise", () => {
  const hot = dishesForSlot(dishes, "HOT MAIN");
  assert.deepEqual(ids(hot.filter((entry) => dishMatchesFilters(entry, { ...emptyPickerFilters, tagIds: ["t:indian"] }))), ["hot1"]);
  assert.deepEqual(ids(hot.filter((entry) => dishMatchesFilters(entry, { ...emptyPickerFilters, tagIds: ["t:indian", "t:spiced"] }))), ["hot1", "hot2"]);
  assert.deepEqual(ids(hot.filter((entry) => dishMatchesFilters(entry, { ...emptyPickerFilters, categories: ["Fish"] }))), ["fish1"]);
  assert.deepEqual(ids(hot.filter((entry) => dishMatchesFilters(entry, { ...emptyPickerFilters, categories: ["Fish", "Hot Main"] }))), ["fish1", "hot1", "hot2"]);
  const salad1 = dishesForSlot(dishes, "SALAD 1");
  assert.deepEqual(ids(salad1.filter((entry) => dishMatchesFilters(entry, { ...emptyPickerFilters, subtypes: ["Leaf"] }))), ["leaf1", "leaf2"]);
  assert.deepEqual(ids(salad1.filter((entry) => dishMatchesFilters(entry, { ...emptyPickerFilters, subtypes: [UNASSIGNED_SUBTYPE] }))), ["none1"]);
});

test("groups combine with AND and category filters cannot widen the slot's eligible categories", () => {
  const filters = { tagIds: ["t:spiced"], categories: ["Hot Main"], subtypes: [] };
  const result = filterPickerDishes(dishes, "HOT MAIN", "", filters);
  assert.deepEqual(ids(result.dishes), ["hot1", "hot2"]);
  assert.equal(result.offered, 3);
  assert.equal(result.shown, 2);
  const leafOnly = filterPickerDishes(dishes, "SALAD 2", "", { tagIds: ["t:slaw"], categories: [], subtypes: ["Leaf"] });
  assert.deepEqual(ids(leafOnly.dishes), ["leaf1"], "All compatible can deliberately override the default subtype recommendation");
  assert.equal(filterPickerDishes(dishes, "HOT MAIN", "", { tagIds: [], categories: ["Salad"], subtypes: [] }).shown, 0, "a category filter cannot pull another primary category into a slot");
  assert.equal(filterPickerDishes(dishes, "SOUP", "", { tagIds: ["t:slaw"], categories: [], subtypes: [] }).shown, 0);
});

test("search and filters combine; counts report offered versus shown", () => {
  const result = filterPickerDishes(dishes, "HOT MAIN", "stew", { tagIds: ["t:spiced"], categories: [], subtypes: [] });
  assert.deepEqual(ids(result.dishes), ["hot2"]);
  assert.deepEqual([result.offered, result.shown], [3, 1]);
  assert.equal(filterPickerDishes(dishes, "HOT MAIN", "", emptyPickerFilters).shown, 3);
});

test("options list only what the slot offers, with counts, in a stable order", () => {
  const salad = filterOptions(dishesForSlot(dishes, "SALAD 1"), TAGS);
  assert.deepEqual(salad.tagOptions, [{ value: "t:slaw", label: "Slaw", count: 2 }, { value: "t:spiced", label: "Spiced", count: 2 }]);
  assert.deepEqual(salad.categoryOptions, [{ value: "Salad", label: "Salad", count: 6 }]);
  assert.deepEqual(salad.subtypeOptions, [{ value: "Leaf", label: "Leaf", count: 2 }, { value: "Slaw", label: "Slaw", count: 1 }, { value: "Veg", label: "Veg", count: 1 }, { value: "FIKA Seasonal", label: "FIKA Seasonal", count: 1 }, { value: UNASSIGNED_SUBTYPE, label: "Not assigned yet", count: 1 }]);
  const hot = filterOptions(dishesForSlot(dishes, "HOT MAIN"), TAGS);
  assert.deepEqual(hot.tagOptions.map((option) => [option.label, option.count]), [["Chicken", 1], ["Indian", 1], ["Spiced", 2]]);
  assert.deepEqual(hot.categoryOptions.map((option) => option.value), ["Fish", "Hot Main"]);
  assert.deepEqual(hot.subtypeOptions, [], "no salad subtype filter outside salad slots");
  assert.deepEqual(filterOptions([], TAGS), { tagOptions: [], categoryOptions: [], subtypeOptions: [] });
});

test("an unknown tag ID is still shown, never hidden, and tag options can be searched", () => {
  const options = filterOptions([dish("x", "X", { tagIds: ["t:gone"] })], TAGS).tagOptions;
  assert.deepEqual(options, [{ value: "t:gone", label: "t:gone", count: 1 }]);
  const all = filterOptions(dishesForSlot(dishes, "HOT MAIN"), TAGS).tagOptions;
  assert.deepEqual(searchFilterOptions(all, "ind").map((option) => option.label), ["Indian"]);
  assert.deepEqual(searchFilterOptions(all, "").length, 3);
});

test("chips describe every active filter, removing one leaves the rest, and reset clears all", () => {
  const filters = { tagIds: ["t:indian", "t:gone"], categories: ["Fish"], subtypes: ["Leaf", UNASSIGNED_SUBTYPE] };
  const labels = new Map(TAGS.map((entry) => [entry.id, entry.label]));
  const chips = pickerChips(filters, { tags: labels });
  assert.deepEqual(chips.map((chip) => chip.label), ["Tag: Indian", "Tag: Unknown tag", "Category: Fish", "Salad slot: Leaf", "Salad slot: Not assigned yet"]);
  const without = removeChip(filters, chips[0]);
  assert.deepEqual(without.tagIds, ["t:gone"]);
  assert.deepEqual(without.categories, ["Fish"]);
  assert.equal(hasPickerFilters(filters), true);
  assert.equal(hasPickerFilters(emptyPickerFilters), false);
  assert.deepEqual(toggleValue(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleValue(["a", "b"], "a"), ["b"]);
});

test("empty states distinguish nothing offered, filters hiding everything and a search with no match", () => {
  assert.equal(emptyPickerMessage({ offered: 4, shown: 2 }, "", emptyPickerFilters), undefined);
  assert.match(emptyPickerMessage({ offered: 0, shown: 0 }, "", emptyPickerFilters) || "", /No dishes are available for this slot yet/);
  assert.match(emptyPickerMessage({ offered: 5, shown: 0 }, "", { ...emptyPickerFilters, tagIds: ["x"] }) || "", /No dishes match these filters\. 5 dishes are hidden/);
  assert.match(emptyPickerMessage({ offered: 1, shown: 0 }, "soup", { ...emptyPickerFilters, tagIds: ["x"] }) || "", /filters and search\. 1 dish is hidden/);
  assert.equal(emptyPickerMessage({ offered: 5, shown: 0 }, "zzz", emptyPickerFilters), "No dishes match your search.");
});

const planner = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/dish-picker-filters.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/dish-picker-filters.css", import.meta.url), "utf8");

test("the planner keeps filters and recommendation mode with the search so Cancel restores the picker and a new cell resets it", () => {
  assert.match(planner, /const \[pickerFilters, setPickerFilters\] = useState<PickerFilters>\(emptyPickerFilters\)/);
  assert.match(planner, /setQuery\(""\); setPickerFilters\(emptyPickerFilters\); setPickerMode\("recommended"\); setPicker\(/);
  assert.match(planner, /filters=\{pickerFilters\} setFilters=\{setPickerFilters\}/);
  assert.match(planner, /<DishPickerFilters /);
  assert.match(planner, /const \[pickerMode, setPickerMode\] = useState<"recommended" \| "all">\("recommended"\)/);
  assert.match(planner, /All compatible dishes/);
  assert.match(planner, /saladSlotMatches\(dish, slot, tags\)/);
  assert.match(planner, /setPickerMode\("recommended"\)/);
});

test("existing planner behaviour remains: Enter-to-create, choose, drag/copy, clear and publish commands", () => {
  assert.match(planner, /resolveEnter\(/);
  assert.match(planner, /onClick=\{\(\) => onChoose\(dish\)\}/);
  assert.match(planner, /assessDishCopyTarget/);
  assert.match(planner, /update-entry/);
  assert.match(planner, /create-entry/);
});

test("filters read the shared registry, never hard-code tags, and never write", () => {
  assert.match(planner, /fetch\("\/api\/dish-tags"/);
  for (const source of [panel, readFileSync(new URL("../lib/dish-picker-filters.ts", import.meta.url), "utf8")]) {
    assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"|localStorage|sessionStorage/);
  }
  assert.doesNotMatch(readFileSync(new URL("../lib/dish-picker-filters.ts", import.meta.url), "utf8"), /"Chicken"|"Indian"|"Spiced"/, "no hard-coded tag names");
});

test("the filter panel is accessible: toggle state, live count, chip removal, reset and tablet-safe targets", () => {
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /role="status" aria-live="polite"/);
  assert.match(panel, /Remove filter/);
  assert.match(panel, /Reset filters/);
  assert.match(panel, /<legend>/);
  assert.match(panel, /type="checkbox"/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
