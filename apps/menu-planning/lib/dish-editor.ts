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

/**
 * Salad slots. A salad's subtype (stored in `subcategory`) decides which planner salad slot offers it:
 * a Leaf salad appears only in SALAD 1, a Slaw only in SALAD 2, and so on. Descriptive tags are not
 * used for this; they are not reliable proxies. SALAD 6 ("FIKA Seasonal") is an explicit choice only and
 * is never inferred from a dish name.
 */
export const SALAD_SLOT_SUBTYPES = [
  { slot: "SALAD 1", subtype: "Leaf" },
  { slot: "SALAD 2", subtype: "Slaw" },
  { slot: "SALAD 3", subtype: "Starch" },
  { slot: "SALAD 4", subtype: "Veg" },
  { slot: "SALAD 5", subtype: "Grain/Pulse" },
  { slot: "SALAD 6", subtype: "FIKA Seasonal" },
] as const;
export type SaladSubtype = typeof SALAD_SLOT_SUBTYPES[number]["subtype"];
export const SALAD_SUBTYPES = SALAD_SLOT_SUBTYPES.map((entry) => entry.subtype) as readonly SaladSubtype[];

const subtypeKey = (value: string) => value.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/g, "");

/** A stored subtype (including the legacy "Salad N" slot names) as one of the six governed subtypes, if it is one. */
export function normaliseSaladSubtype(value: string | undefined): SaladSubtype | undefined {
  const key = subtypeKey(value || "");
  if (!key) return undefined;
  const direct = SALAD_SUBTYPES.find((subtype) => subtypeKey(subtype) === key);
  if (direct) return direct;
  if (key === "grainpulse" || key === "grain" || key === "pulse") return "Grain/Pulse";
  if (key === "seasonal") return "FIKA Seasonal";
  const numbered = /^salad([1-6])$/.exec(key);
  return numbered ? SALAD_SLOT_SUBTYPES[Number(numbered[1]) - 1].subtype : undefined;
}

export function saladSubtypeForSlot(slot: string): SaladSubtype | undefined {
  const match = /^SALAD\s*([1-6])$/i.exec(slot.trim());
  return match ? SALAD_SLOT_SUBTYPES[Number(match[1]) - 1].subtype : undefined;
}

/**
 * Whether the picker for `slot` should offer this dish. Outside the six salad slots nothing changes.
 * In a salad slot a classified salad appears only in its own subtype's slot; a salad with no subtype yet
 * is still offered (so no dish vanishes before it is classified) and is flagged as needing a slot. A slot
 * for FIKA Seasonal offers only dishes explicitly classified that way.
 */
export function dishFitsSaladSlot(dish: { category?: string; subcategory?: string }, slot: string): boolean {
  const slotSubtype = saladSubtypeForSlot(slot);
  if (!slotSubtype) return true;
  const dishSubtype = normaliseSaladSubtype(dish.subcategory);
  if (dishSubtype) return dishSubtype === slotSubtype;
  return slotSubtype !== "FIKA Seasonal";
}

export const saladNeedsSlot = (dish: { category?: string; subcategory?: string }) => dish.category === "Salad" && !normaliseSaladSubtype(dish.subcategory);

export type DishFormState = { name: string; category: string; tagIds: readonly string[]; subcategory?: string };

export function validateDishForm(state: DishFormState, categories: readonly string[]): string | undefined {
  if (!cleanDishName(state.name)) return "A dish name is required.";
  if (!categories.includes(state.category)) return "Choose one of the dish categories.";
  return undefined;
}

export function buildCreatePayload(state: DishFormState) {
  const subtype = state.category === "Salad" ? normaliseSaladSubtype(state.subcategory) : undefined;
  return { action: "create-dish", displayName: cleanDishName(state.name), category: state.category, ...(subtype ? { subcategory: subtype } : {}), tagIds: [...new Set(state.tagIds)] };
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
    // Only a Salad's subtype is editable here; any other dish keeps the value it already had.
    // undefined = the user did not touch the salad slot, so whatever is stored (even a legacy value) stays.
    subcategory: state.category === "Salad" && state.subcategory !== undefined ? normaliseSaladSubtype(state.subcategory) : preserved.subcategory,
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
