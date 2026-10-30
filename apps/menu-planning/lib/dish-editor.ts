import { similarDishNames, normaliseDishName } from "./dish-picker";
import { tagKey, type DishTag } from "./dish-tags";

/**
 * Pure rules for the Create/Edit Dish modal (#154): what pressing Enter on a typed name does,
 * duplicate and tag suggestions, and the exact payloads sent to the catalogue API.
 */

export type EditorDishRef = { id: string; name: string; aliases?: string[] };

export type EnterResolution =
  | { kind: "empty" }
  | { kind: "existing"; dish: EditorDishRef; via: "name" | "alias" }
  | { kind: "create"; name: string };

/** Canonical spelling of a typed dish name: trimmed and single spaced, casing as typed. */
export function cleanDishName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

const sameName = (a: string, b: string) => normaliseDishName(a) === normaliseDishName(b);

/**
 * Pressing Enter on a typed name: an exact existing dish name or alias is selected (never
 * duplicated); anything else opens the Create dish modal prefilled with the typed name.
 */
export function resolveEnter(dishes: readonly EditorDishRef[], typed: string): EnterResolution {
  const name = cleanDishName(typed);
  if (!name) return { kind: "empty" };
  const byName = dishes.find((dish) => sameName(dish.name, name));
  if (byName) return { kind: "existing", dish: byName, via: "name" };
  const byAlias = dishes.find((dish) => (dish.aliases || []).some((alias) => sameName(alias, name)));
  if (byAlias) return { kind: "existing", dish: byAlias, via: "alias" };
  return { kind: "create", name };
}

/** Similar dishes worth warning about before saving (the dish being edited is excluded). */
export function similarDishWarnings(dishes: readonly EditorDishRef[], name: string, excludeId?: string, limit = 5) {
  const clean = cleanDishName(name);
  if (clean.length < 3) return [];
  const candidates = dishes.filter((dish) => dish.id !== excludeId).map((dish) => ({ id: dish.id, name: dish.name }));
  return similarDishNames(candidates, clean).slice(0, limit);
}

/** Registry tags whose name or synonym appears as whole words in the dish name; never one already chosen. */
export function suggestTags(tags: readonly DishTag[], name: string, selectedIds: readonly string[], limit = 6): DishTag[] {
  const words = ` ${tagKey(name)} `;
  if (words.trim() === "") return [];
  const chosen = new Set(selectedIds);
  return tags
    .filter((tag) => !chosen.has(tag.id))
    .filter((tag) => [tag.label, ...tag.synonyms].some((text) => {
      const key = tagKey(text);
      return key.length >= 3 && words.includes(` ${key} `);
    }))
    .slice(0, limit);
}

export type DishFormState = { name: string; category: string; tagIds: readonly string[] };

export function validateDishForm(state: DishFormState, categories: readonly string[]): string | undefined {
  if (!cleanDishName(state.name)) return "A dish name is required.";
  if (!categories.includes(state.category)) return "Choose one of the dish categories.";
  return undefined;
}

export function buildCreatePayload(state: DishFormState) {
  return { action: "create-dish", displayName: cleanDishName(state.name), category: state.category, tagIds: [...new Set(state.tagIds)] };
}

/** Everything the existing record already holds that an update would otherwise blank out. */
export type PreservedDishFields = {
  subcategory?: string;
  description?: string;
  preparationNotes?: string;
  mayContainNotes?: string;
  ingredients?: unknown;
  methodSteps?: string[];
};

/**
 * The catalogue update replaces description, preparation notes and subcategory when they are
 * omitted, so an edit always sends the dish's current values back; only name, category and tags change.
 */
export function buildUpdatePayload(id: string, state: DishFormState, preserved: PreservedDishFields) {
  return {
    action: "update-dish-with-tags",
    id,
    displayName: cleanDishName(state.name),
    category: state.category,
    subcategory: preserved.subcategory,
    description: preserved.description,
    preparationNotes: preserved.preparationNotes,
    mayContainNotes: preserved.mayContainNotes,
    ingredients: preserved.ingredients,
    methodSteps: preserved.methodSteps,
    tagIds: [...new Set(state.tagIds)],
  };
}

/** The server matched an existing dish (by exact name or merged alias) instead of creating one. */
export function savedOutcomeIsExisting(outcome: unknown) {
  return outcome === "matched_active" || outcome === "matched_merged_alias";
}
