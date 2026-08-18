export type DishPickerItem = {
  id: string;
  name: string;
  category?: string;
  subcategory?: string;
  description?: string;
  usageCount?: number;
  lastServed?: string;
  allergenEvidence?: Array<{ allergen: string; value: "contains" | "free_from" | "may_contain" | "unknown" }>;
  mayContainReviewed?: boolean;
};

import { categoryForSlot, normaliseDishCategory } from "./dish-categories";

export function normaliseDishName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function rankDishPickerItems(items: DishPickerItem[], query: string, slot: string) {
  const q = normaliseDishName(query);
  const slotWords = slot.toLocaleLowerCase().replace(/\d+/g, "").trim().split(/\s+/).filter(Boolean);
  const slotCategory = categoryForSlot(slot);
  const meatWords = "beef chicken pork lamb turkey meat brisket steak mince sausage";
  const vegWords = "veg vegan vegetarian plant tofu bean chickpea lentil aubergine mushroom cauliflower";
  return items
    .filter(item => normaliseDishCategory(item.category) === slotCategory)
    .filter(item => !q || normaliseDishName(`${item.name} ${item.category || ""} ${item.subcategory || ""} ${item.description || ""}`).includes(q))
    .map(item => {
      const text = `${item.name} ${item.category || ""} ${item.subcategory || ""} ${item.description || ""}`.toLocaleLowerCase();
      const context = slotWords.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0)
        + (item.category?.toLocaleLowerCase() === slot.toLocaleLowerCase() ? 6 : 0)
        + (normaliseDishCategory(item.category) === slotCategory ? 3 : 0)
        + (slotCategory === "Hot Main" && slot.toLocaleLowerCase().includes("meat") && meatWords.split(" ").some(word => text.includes(word)) ? 5 : 0)
        + (slotCategory === "Hot Main" && slot.toLocaleLowerCase().includes("veg") && vegWords.split(" ").some(word => text.includes(word)) ? 5 : 0);
      const nameScore = normaliseDishName(item.name) === q && q ? 100 : normaliseDishName(item.name).startsWith(q) && q ? 20 : 0;
      return { item, score: context * 5 + nameScore };
    })
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .map(value => value.item);
}

export function similarDishNames(items: DishPickerItem[], name: string) {
  const q = normaliseDishName(name);
  return items.filter(item => normaliseDishName(item.name) === q || normaliseDishName(item.name).includes(q) || q.includes(normaliseDishName(item.name)));
}
