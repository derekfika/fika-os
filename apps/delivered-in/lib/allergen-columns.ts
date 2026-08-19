// UI labels follow the governed contract in apps/shared/allergen-contract.ts.
// The app keeps this presentation-only list local so the client bundle does
// not create a second runtime dependency on another Next application.
export const CANONICAL_ALLERGEN_COLUMNS = [
  ["no_key_allergens", "No key allergens"], ["peanuts", "Peanuts"], ["tree_nuts", "Tree nuts"],
  ["gluten", "Gluten"], ["sesame", "Sesame"], ["molluscs", "Molluscs"], ["fish", "Fish"],
  ["soya", "Soya"], ["celery", "Celery"], ["shellfish", "Shellfish"], ["eggs", "Eggs"],
  ["milk", "Milk"], ["mustard", "Mustard"], ["lupin", "Lupin"], ["sulphites", "Sulphites"],
] as const;
