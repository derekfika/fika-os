import type { DishTagInput } from "./dish-tags";

/**
 * Approved starting vocabulary from FIKA_Dish_Library_Tag_Rescan_2026-10-29.xlsx (High and Medium
 * sheets). Owner-approved subset (30 Oct): the 8 dish-type words that are NOT also governed primary
 * categories, plus every cuisine and preparation/style word. Words that duplicate a primary category
 * (Salad, Hot Main, Soup, Sauce, Garnish, Side, Cold Protein, Vegetarian Main) are deliberately left
 * out so a tag never restates the category. The workbook has no occasion tags.
 *
 * This is a vocabulary only. It assigns no tag to any dish.
 */
export const DISH_TAG_SEED_SOURCE = "FIKA_Dish_Library_Tag_Rescan_2026-10-29.xlsx";
export const DISH_TAG_SEED_ACTOR = "seed:dish-library-tag-rescan-2026-10-29";

const group = (name: DishTagInput["group"], labels: string[]): DishTagInput[] => labels.map((label) => ({ label, group: name }));

export const DISH_TAG_SEED: readonly DishTagInput[] = [
  ...group("type", ["Vegetable Side", "Grain / Pulse", "Chicken", "Leaf Salad", "Fish / Seafood", "Slaw", "Beef", "Bread"]),
  ...group("cuisine", ["Indian", "Middle Eastern-inspired", "Italian", "Japanese", "Korean", "French-inspired", "Mexican-inspired", "Greek", "Thai", "Caribbean-inspired", "Chinese", "Somali-inspired"]),
  ...group("style", ["Spiced", "Roasted", "Grilled / Charred", "Smoked", "Fresh / Raw", "Braised / Stewed", "Fried", "BBQ"]),
];
