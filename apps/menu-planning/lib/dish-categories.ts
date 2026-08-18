export const CANONICAL_DISH_CATEGORIES = ["Salad", "Soup", "Hot Main", "Cold Protein", "Side", "Other"] as const;
export type CanonicalDishCategory = typeof CANONICAL_DISH_CATEGORIES[number];

export function normaliseDishCategory(value: string | undefined): CanonicalDishCategory {
  const category = (value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (/^salad(?: \d+)?s?$/.test(category)) return "Salad";
  if (category === "soup" || category === "soups") return "Soup";
  if (["hot main", "hot mains", "hot meat", "hot veg", "hot veg / vegan", "hot veg vegan"].includes(category)) return "Hot Main";
  if (["cold protein", "cold proteins"].includes(category)) return "Cold Protein";
  if (["side", "sides", "extras"].includes(category)) return "Side";
  if (category === "other" || !category) return "Other";
  return "Other";
}

export function categoryForSlot(slot: string): CanonicalDishCategory {
  const value = slot.toLocaleLowerCase();
  if (value.startsWith("salad")) return "Salad";
  if (value === "soup") return "Soup";
  if (value === "cold protein") return "Cold Protein";
  if (value.startsWith("extras") || value === "side") return "Side";
  if (value === "hot meat" || value === "hot veg vegan" || value === "hot veg / vegan") return "Hot Main";
  return normaliseDishCategory(slot);
}
