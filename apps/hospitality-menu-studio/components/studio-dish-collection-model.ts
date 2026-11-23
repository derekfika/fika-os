import type { Dish, Menu, Section } from "../lib/contract";

export type DishFilters = {
  search: string;
  category: Dish["category"] | "all" | "veg";
  temperature: Dish["temperature"] | "all";
};

export const emptyDishFilters: DishFilters = {
  search: "",
  category: "all",
  temperature: "all",
};

function searchKey(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-GB");
}

export function sectionDishIds(section: Section): string[] {
  return section.mode === "rotation" ? section.weeks.flat() : section.staticDishIds;
}

export function dishUsage(menus: readonly Menu[]) {
  const byMenu = new Map<string, Set<string>>();
  const menuCounts = new Map<string, number>();
  for (const menu of menus) {
    const ids = new Set(menu.sections.flatMap(sectionDishIds));
    byMenu.set(menu.id, ids);
    for (const id of ids) menuCounts.set(id, (menuCounts.get(id) ?? 0) + 1);
  }
  return { byMenu, menuCounts };
}

export function filterDishes(
  dishes: readonly Dish[],
  filters: DishFilters,
  assignmentIds?: ReadonlySet<string>,
): Dish[] {
  const { category, temperature } = filters;
  const query = searchKey(filters.search);
  return dishes.filter((dish) => {
    const matchesCategory = category === "all" || category === dish.category ||
      (category === "veg" && (dish.category === "vegetarian" || dish.category === "vegan"));
    return matchesCategory &&
      (temperature === "all" || temperature === dish.temperature) &&
      (!assignmentIds || assignmentIds.has(dish.id)) &&
      (!query || searchKey(dish.name).includes(query));
  });
}
