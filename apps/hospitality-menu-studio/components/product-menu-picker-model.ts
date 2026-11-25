export type PickerDish = { id: string; name: string; category: string; customerDescription: string };

export function filterPickerDishes<T extends PickerDish>(dishes: T[], query: string, category: string, assigned: ReadonlySet<string>) {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  return dishes.filter((dish) => !assigned.has(dish.id) &&
    (category === "all" || dish.category === category) &&
    (!needle || `${dish.name} ${dish.category} ${dish.customerDescription}`.toLocaleLowerCase("en-GB").includes(needle)));
}
