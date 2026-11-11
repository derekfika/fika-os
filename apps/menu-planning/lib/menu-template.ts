import { dishCategoryForWrite, type CanonicalDishCategory } from "./dish-categories";
import { CANONICAL_MENU_SLOTS } from "../../shared/menu-section-order";

const prefixForCategory: Record<CanonicalDishCategory, string> = {
  Salad: "SALAD",
  "Starch/Side": "STARCH/SIDE",
  Garnish: "GARNISH",
  Sauce: "SAUCE",
  "Hot Main": "HOT MAIN",
  // Keep the stable menu-slot identity while the Dish Library category uses its approved name.
  "Vegan/Veggie Main": "VEGAN MAIN",
  Fish: "FISH",
  Soup: "SOUP",
  "Cold Protein": "COLD PROTEIN",
  Dessert: "DESSERT",
};
const canonicalSlotIds = new Set<string>(CANONICAL_MENU_SLOTS.map(slot => slot.id));

export function menuSlotPrefix(category: string) {
  return prefixForCategory[dishCategoryForWrite(category)];
}

/** Generate a governed slot identity from a category without accepting free-form labels. */
export function suggestMenuRowSlot(category: string, occupiedSlots: readonly string[]) {
  const prefix = menuSlotPrefix(category);
  const occupied = new Set(occupiedSlots.map(slot => slot.trim().toLocaleUpperCase().replace(/\s+/g, " ")));
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: (\\d+))?$`);
  let highest = 0;
  for (const slot of occupied) {
    const match = pattern.exec(slot);
    if (match) highest = Math.max(highest, match[1] ? Number(match[1]) : 1);
  }
  let sequence = highest + 1;
  while (occupied.has(`${prefix} ${sequence}`)) sequence += 1;
  return `${prefix} ${sequence}`;
}

export function isGovernedMenuSlot(slot: string) {
  const value = slot.trim();
  return canonicalSlotIds.has(value) || Object.values(prefixForCategory).some(prefix => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: \\d+)?$`, "i").test(value));
}
