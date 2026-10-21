export const CANONICAL_DISH_CATEGORIES = [
  "Salad",
  "Starch/Side",
  "Garnish",
  "Sauce",
  "Hot Main",
  "Vegan/Veggie Main",
  "Fish",
  "Soup",
  "Cold Protein",
] as const;

/** Values retained so legacy Dish Library records remain readable during transition. */
export const LEGACY_DISH_CATEGORIES = ["Other"] as const;
export type CanonicalDishCategory = typeof CANONICAL_DISH_CATEGORIES[number];
export type ReadableDishCategory = CanonicalDishCategory | typeof LEGACY_DISH_CATEGORIES[number];

const normalisedText = (value: string | undefined) => (value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function isCanonicalDishCategory(value: string | undefined): value is CanonicalDishCategory {
  return CANONICAL_DISH_CATEGORIES.includes((value || "").trim() as CanonicalDishCategory);
}

/** Strict boundary for newly authored categories. Legacy aliases are read-only. */
export function dishCategoryForWrite(value: string | undefined): CanonicalDishCategory {
  const category = normaliseDishCategory(value);
  if (!isCanonicalDishCategory(category) || normalisedText(value) !== normalisedText(category)) {
    throw Object.assign(new Error("Choose one of the governed Dish Library categories."), { status: 422 });
  }
  return category;
}

/** Normalizes legacy records for display and filtering without changing their stored document. */
export function normaliseDishCategory(value: string | undefined): ReadableDishCategory {
  const category = normalisedText(value);
  if (/^salad(?: \d+)?s?$/.test(category)) return "Salad";
  if (["starch/side", "starch / side", "side", "sides", "extras"].includes(category)) return "Starch/Side";
  if (["garnish", "garnishes"].includes(category)) return "Garnish";
  if (["sauce", "sauces"].includes(category)) return "Sauce";
  if (["hot main", "hot mains", "hot meat", "hot meats"].includes(category)) return "Hot Main";
  if (["vegan/veggie main", "vegan / veggie main", "vegan main", "vegan mains", "hot veg", "hot veg / vegan", "hot veg vegan"].includes(category)) return "Vegan/Veggie Main";
  if (["fish", "seafood"].includes(category)) return "Fish";
  if (["soup", "soups"].includes(category)) return "Soup";
  if (["cold protein", "cold proteins"].includes(category)) return "Cold Protein";
  return "Other";
}

/** A slot is a menu placement and may deliberately accept more than one Dish Library category. */
export function categoriesForMenuSlot(slot: string): readonly ReadableDishCategory[] {
  const value = slot.trim().toLocaleUpperCase().replace(/\s+/g, " ");
  if (/^SALAD(?: \d+)?$/.test(value)) return ["Salad"];
  if (/^SOUP(?: \d+)?$/.test(value)) return ["Soup"];
  if (/^COLD PROTEIN(?: \d+)?$/.test(value)) return ["Cold Protein"];
  if (/^(?:STARCH\/SIDE|EXTRAS|SIDE)(?: \d+)?$/.test(value)) return ["Starch/Side"];
  if (/^GARNISH(?: \d+)?$/.test(value)) return ["Garnish"];
  if (/^SAUCE(?: \d+)?$/.test(value)) return ["Sauce"];
  if (/^(?:HOT MAIN|HOT MEAT)(?: \d+)?$/.test(value)) return ["Hot Main", "Fish"];
  if (/^(?:VEGAN MAIN|VEGAN\/VEGGIE MAIN|HOT VEG VEGAN|HOT VEG \/ VEGAN)(?: \d+)?$/.test(value)) return ["Vegan/Veggie Main"];
  if (/^FISH(?: \d+)?$/.test(value)) return ["Fish"];
  return [normaliseDishCategory(slot)];
}

/** Retained for callers that need the primary category represented by a menu slot. */
export function categoryForSlot(slot: string): ReadableDishCategory {
  return categoriesForMenuSlot(slot)[0];
}

/** Return a catalogue category only when a menu slot has a governed mapping. */
export function canonicalDishCategoryForSlot(slot: string): CanonicalDishCategory | undefined {
  const category = categoryForSlot(slot);
  return isCanonicalDishCategory(category) ? category : undefined;
}
