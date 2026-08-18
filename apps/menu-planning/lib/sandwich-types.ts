export const sandwichAllergenColumns = [
  ["noKeyAllergens", "No key allergens"], ["peanuts", "Peanuts"], ["otherNuts", "Other nuts"],
  ["gluten", "Gluten"], ["sesame", "Sesame"], ["molluscs", "Molluscs"], ["fish", "Fish"],
  ["soya", "Soya"], ["celery", "Celery"], ["shellfish", "Shellfish"], ["eggs", "Eggs"],
  ["milk", "Milk"], ["mustard", "Mustard"], ["lupin", "Lupin"], ["sulphites", "Sulphites"],
] as const;
export type SandwichAllergens = Record<string, "clear" | "contains" | "may_contain">;
/** A saved production item is reusable only within its governed parent menu item. */
export type SavedSandwich = {
  id: string;
  title: string;
  allergens: SandwichAllergens;
  mayContainNotes?: string;
  parentMenuItemKey?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};
