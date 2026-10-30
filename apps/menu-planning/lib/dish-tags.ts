/**
 * Shared Dish Library tag registry (#152).
 *
 * Tags are descriptive, many-per-dish labels. They are deliberately separate from the
 * governed primary category (one per dish, see dish-categories.ts) and from the salad
 * subtype (the dish's `subcategory`). A dish stores only stable tag IDs, so renaming or
 * correcting a tag's spelling never rewrites dishes, published menus or orders.
 *
 * This module is pure. Persistence and concurrency control live in dish-tag-store.ts.
 */

export const DISH_TAG_GROUPS = ["type", "cuisine", "ingredient", "style", "occasion"] as const;
export type DishTagGroup = typeof DISH_TAG_GROUPS[number];

export const DISH_TAG_GROUP_LABELS: Record<DishTagGroup, string> = {
  type: "Type",
  cuisine: "Cuisine",
  ingredient: "Ingredient",
  style: "Style",
  occasion: "Occasion",
};

export type DishTag = {
  id: string;
  label: string;
  group: DishTagGroup;
  /** Alternative spellings or names that find, but never duplicate, this tag. */
  synonyms: string[];
  createdAt: string;
  createdBy: string;
};

export type DishTagRegistry = {
  schemaVersion: 1;
  /** Optimistic-concurrency version; bumped by the store on every successful write. */
  version: number;
  tags: DishTag[];
};

export const MAX_TAG_LABEL_LENGTH = 40;
export const MAX_TAG_SYNONYMS = 10;
export const MAX_REGISTRY_TAGS = 500;
export const MAX_TAGS_PER_DISH = 30;

export const emptyDishTagRegistry = (): DishTagRegistry => ({ schemaVersion: 1, version: 0, tags: [] });

const fail = (message: string, status = 422): never => { throw Object.assign(new Error(message), { status }); };

/** Case-, accent- and spacing-insensitive comparison key. */
export function tagKey(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Canonical spelling: trimmed, single spaced. Casing is kept as the author typed it. */
export function normaliseTagLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function isDishTagGroup(value: unknown): value is DishTagGroup {
  return typeof value === "string" && (DISH_TAG_GROUPS as readonly string[]).includes(value);
}

export function dishTagId(group: DishTagGroup, label: string) {
  const slug = tagKey(label).replace(/ /g, "-");
  if (!slug) fail("A tag name must contain letters or numbers.");
  return `dish-tag:${group}:${slug}`;
}

export type DishTagInput = { label: string; group: string; synonyms?: string[] };

function cleanInput(input: DishTagInput) {
  if (typeof input.label !== "string") return fail("A tag name is required.");
  const label = normaliseTagLabel(input.label);
  if (!label) return fail("A tag name is required.");
  if (label.length > MAX_TAG_LABEL_LENGTH) return fail(`A tag name can be at most ${MAX_TAG_LABEL_LENGTH} characters.`);
  if (!isDishTagGroup(input.group)) return fail("Choose one of the governed tag groups.");
  const group = input.group;
  const seen = new Set([tagKey(label)]);
  const synonyms: string[] = [];
  for (const raw of input.synonyms || []) {
    if (typeof raw !== "string") return fail("Tag synonyms must be text.");
    const synonym = normaliseTagLabel(raw);
    if (!synonym || synonym.length > MAX_TAG_LABEL_LENGTH) return fail(`A tag synonym must be 1–${MAX_TAG_LABEL_LENGTH} characters.`);
    const key = tagKey(synonym);
    if (!key) return fail("A tag synonym must contain letters or numbers.");
    if (seen.has(key)) continue;
    seen.add(key);
    synonyms.push(synonym);
  }
  if (synonyms.length > MAX_TAG_SYNONYMS) return fail(`A tag can have at most ${MAX_TAG_SYNONYMS} synonyms.`);
  return { label, group, synonyms };
}

/** The existing tag in this group whose name or synonym equals the candidate, if any. */
export function findExistingTag(registry: DishTagRegistry, group: DishTagGroup, label: string) {
  const key = tagKey(label);
  return registry.tags.find((tag) => tag.group === group && (tagKey(tag.label) === key || tag.synonyms.some((synonym) => tagKey(synonym) === key)));
}

export type AddTagOutcome = "created" | "existing";

/**
 * Add a tag, or return the existing equivalent. Repeating the same request (a double click,
 * a retry) is a no-op that returns the same tag, so inline creation can never duplicate.
 */
export function addTag(registry: DishTagRegistry, input: DishTagInput, actor: string, at: string): { registry: DishTagRegistry; tag: DishTag; outcome: AddTagOutcome } {
  const clean = cleanInput(input);
  const existing = [clean.label, ...clean.synonyms].map((name) => findExistingTag(registry, clean.group, name)).find(Boolean);
  if (existing) return { registry, tag: existing, outcome: "existing" };
  if (registry.tags.length >= MAX_REGISTRY_TAGS) fail("The tag registry is full. Ask an administrator to review it.", 409);
  const id = dishTagId(clean.group, clean.label);
  if (registry.tags.some((tag) => tag.id === id)) fail("A tag with this identity already exists.", 409);
  const tag: DishTag = { id, label: clean.label, group: clean.group, synonyms: clean.synonyms, createdAt: at, createdBy: actor };
  return { registry: { ...registry, tags: [...registry.tags, tag] }, tag, outcome: "created" };
}

/** Additive seed: adds only tags that do not already exist; never edits or removes one. */
export function mergeSeedTags(registry: DishTagRegistry, seeds: readonly DishTagInput[], actor: string, at: string) {
  let next = registry;
  const added: DishTag[] = [];
  for (const seed of seeds) {
    const result = addTag(next, seed, actor, at);
    next = result.registry;
    if (result.outcome === "created") added.push(result.tag);
  }
  return { registry: next, added };
}

export function searchTags(registry: DishTagRegistry, query: string, options: { group?: string } = {}): DishTag[] {
  const terms = tagKey(query).split(" ").filter(Boolean);
  return registry.tags
    .filter((tag) => !options.group || tag.group === options.group)
    .filter((tag) => {
      if (!terms.length) return true;
      const haystack = tagKey([tag.label, ...tag.synonyms].join(" "));
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => DISH_TAG_GROUPS.indexOf(a.group) - DISH_TAG_GROUPS.indexOf(b.group) || a.label.localeCompare(b.label, "en-GB") || a.id.localeCompare(b.id));
}

export function groupTags(tags: readonly DishTag[]) {
  return DISH_TAG_GROUPS.map((group) => ({ group, label: DISH_TAG_GROUP_LABELS[group], tags: tags.filter((tag) => tag.group === group) })).filter((entry) => entry.tags.length);
}

/**
 * Validate the tag IDs a dish write refers to: every ID must be a known registry tag.
 * Duplicates collapse and the author's order is kept. Unknown IDs are rejected rather than
 * dropped, so a stale client cannot silently lose or invent a tag.
 */
export function validateDishTagIds(registry: DishTagRegistry, ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return fail("Dish tags must be a list of tag IDs.");
  const unique = [...new Set(ids as string[])];
  if (unique.length > MAX_TAGS_PER_DISH) return fail(`A dish can have at most ${MAX_TAGS_PER_DISH} tags.`);
  const known = new Set(registry.tags.map((tag) => tag.id));
  const unknown = unique.filter((id) => !known.has(id));
  if (unknown.length) return fail(`Unknown dish tag${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Refresh the tag list and try again.`);
  return unique;
}

/** Display labels for a dish's tag IDs; an ID missing from the registry is shown as-is, never hidden. */
export function tagLabels(registry: DishTagRegistry, ids: readonly string[] | undefined) {
  const byId = new Map(registry.tags.map((tag) => [tag.id, tag.label]));
  return (ids || []).map((id) => byId.get(id) || id);
}
