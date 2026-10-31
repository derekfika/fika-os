import { categoriesForMenuSlot, normaliseDishCategory } from "./dish-categories";
import { dishFitsSaladSlot, normaliseSaladSubtype, SALAD_SUBTYPES } from "./dish-editor";
import { normaliseDishName } from "./dish-picker";
import { tagKey, type DishTag } from "./dish-tags";

/**
 * Week Planner dish-picker filters (#155). Filters narrow what the slot already offers; they never
 * widen it, so the slot's category rule and the salad-slot rule always apply first. Selections within
 * one filter group match ANY chosen value; separate groups combine with AND.
 */

export type PickerFilterDish = {
  id: string;
  name: string;
  category?: string;
  subcategory?: string;
  description?: string;
  aliases?: string[];
  tagIds?: string[];
  usage?: string[];
};

export const UNASSIGNED_SUBTYPE = "unassigned";

export type PickerFilters = {
  /** Selected tag IDs; a dish matches when it has any of them. */
  tagIds: readonly string[];
  /** Selected operational categories (governed Dish Library categories). */
  categories: readonly string[];
  /** Selected salad subtypes, or `unassigned` for a salad with no subtype yet. */
  subtypes: readonly string[];
};

export const emptyPickerFilters: PickerFilters = { tagIds: [], categories: [], subtypes: [] };

export function hasPickerFilters(filters: PickerFilters) {
  return Boolean(filters.tagIds.length || filters.categories.length || filters.subtypes.length);
}

/** The dishes a slot offers before any filter: its categories and, for salads, its own subtype slot. */
export function dishesForSlot<T extends PickerFilterDish>(dishes: readonly T[], slot: string): T[] {
  const categories = new Set(categoriesForMenuSlot(slot));
  return dishes.filter((dish) => categories.has(normaliseDishCategory(dish.category)) && dishFitsSaladSlot(dish, slot));
}

function subtypeOf(dish: PickerFilterDish) {
  if (normaliseDishCategory(dish.category) !== "Salad") return undefined;
  return normaliseSaladSubtype(dish.subcategory) || UNASSIGNED_SUBTYPE;
}

export function dishMatchesFilters(dish: PickerFilterDish, filters: PickerFilters): boolean {
  if (filters.tagIds.length && !(dish.tagIds || []).some((id) => filters.tagIds.includes(id))) return false;
  if (filters.categories.length && !filters.categories.includes(normaliseDishCategory(dish.category))) return false;
  if (filters.subtypes.length) {
    const subtype = subtypeOf(dish);
    if (!subtype || !filters.subtypes.includes(subtype)) return false;
  }
  return true;
}

/** Search text for a dish: its canonical name and its aliases, not tags or descriptions. */
export function dishSearchText(dish: PickerFilterDish) {
  return normaliseDishName([dish.name, ...(dish.aliases || [])].join(" "));
}

export function dishMatchesQuery(dish: PickerFilterDish, query: string) {
  const terms = normaliseDishName(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const text = dishSearchText(dish);
  return terms.every((term) => text.includes(term));
}

export type PickerResult<T> = { dishes: T[]; offered: number; shown: number };

/**
 * Apply search then filters to the dishes a slot offers. `offered` is the slot's own count, so the
 * picker can say "12 of 40 dishes" and distinguish "no match" from "nothing offered for this slot".
 */
export function filterPickerDishes<T extends PickerFilterDish>(dishes: readonly T[], slot: string, query: string, filters: PickerFilters): PickerResult<T> {
  const offered = dishesForSlot(dishes, slot);
  const matching = offered.filter((dish) => dishMatchesQuery(dish, query) && dishMatchesFilters(dish, filters));
  return { dishes: matching, offered: offered.length, shown: matching.length };
}

export type FilterOption = { value: string; label: string; count: number };

/** Options present in what the slot offers, with counts, so a filter never lists an empty choice. */
export function filterOptions<T extends PickerFilterDish>(offered: readonly T[], tags: readonly DishTag[]) {
  const tagCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  const subtypeCount = new Map<string, number>();
  for (const dish of offered) {
    for (const id of new Set(dish.tagIds || [])) tagCount.set(id, (tagCount.get(id) || 0) + 1);
    const category = normaliseDishCategory(dish.category);
    categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
    const subtype = subtypeOf(dish);
    if (subtype) subtypeCount.set(subtype, (subtypeCount.get(subtype) || 0) + 1);
  }
  const labelFor = new Map(tags.map((tag) => [tag.id, tag.label]));
  const tagOptions: FilterOption[] = [...tagCount.entries()]
    .map(([value, count]) => ({ value, label: labelFor.get(value) || value, count }))
    .sort((a, b) => a.label.localeCompare(b.label, "en-GB") || a.value.localeCompare(b.value));
  const categoryOptions: FilterOption[] = [...categoryCount.entries()].map(([value, count]) => ({ value, label: value, count })).sort((a, b) => a.label.localeCompare(b.label, "en-GB"));
  const subtypeOptions: FilterOption[] = [
    ...SALAD_SUBTYPES.filter((subtype) => subtypeCount.has(subtype)).map((subtype) => ({ value: subtype as string, label: subtype as string, count: subtypeCount.get(subtype) || 0 })),
    ...(subtypeCount.has(UNASSIGNED_SUBTYPE) ? [{ value: UNASSIGNED_SUBTYPE, label: "Not assigned yet", count: subtypeCount.get(UNASSIGNED_SUBTYPE) || 0 }] : []),
  ];
  return { tagOptions, categoryOptions, subtypeOptions };
}

export function searchFilterOptions(options: readonly FilterOption[], query: string) {
  const terms = tagKey(query).split(" ").filter(Boolean);
  if (!terms.length) return [...options];
  return options.filter((option) => terms.every((term) => tagKey(option.label).includes(term)));
}

export function toggleValue(values: readonly string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export type PickerChip = { key: string; group: "tag" | "category" | "subtype"; value: string; label: string };

export function pickerChips(filters: PickerFilters, labels: { tags: ReadonlyMap<string, string> }): PickerChip[] {
  return [
    ...filters.tagIds.map((value): PickerChip => ({ key: `tag:${value}`, group: "tag", value, label: `Tag: ${labels.tags.get(value) || "Unknown tag"}` })),
    ...filters.categories.map((value): PickerChip => ({ key: `category:${value}`, group: "category", value, label: `Category: ${value}` })),
    ...filters.subtypes.map((value): PickerChip => ({ key: `subtype:${value}`, group: "subtype", value, label: `Salad slot: ${value === UNASSIGNED_SUBTYPE ? "Not assigned yet" : value}` })),
  ];
}

export function removeChip(filters: PickerFilters, chip: PickerChip): PickerFilters {
  if (chip.group === "tag") return { ...filters, tagIds: filters.tagIds.filter((value) => value !== chip.value) };
  if (chip.group === "category") return { ...filters, categories: filters.categories.filter((value) => value !== chip.value) };
  return { ...filters, subtypes: filters.subtypes.filter((value) => value !== chip.value) };
}

/** What to tell the user when the list is empty. */
export function emptyPickerMessage(result: { offered: number; shown: number }, query: string, filters: PickerFilters) {
  if (result.shown > 0) return undefined;
  if (result.offered === 0) return "No dishes are available for this slot yet.";
  if (hasPickerFilters(filters)) return `No dishes match these filters${query.trim() ? " and search" : ""}. ${result.offered} dish${result.offered === 1 ? " is" : "es are"} hidden by them.`;
  return "No dishes match your search.";
}
