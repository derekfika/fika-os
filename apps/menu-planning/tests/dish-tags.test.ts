import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { amendCanonicalMenuItemRecord } from "../lib/canonical-menu-repository";
import { canonicalEntry } from "../lib/catalogue";
import type { MenuItem } from "../lib/domain";
import {
  MAX_REGISTRY_TAGS,
  MAX_TAGS_PER_DISH,
  addTag,
  dishTagId,
  emptyDishTagRegistry,
  groupTags,
  mergeSeedTags,
  normaliseTagLabel,
  searchTags,
  tagLabels,
  validateDishTagIds,
  type DishTagRegistry,
} from "../lib/dish-tags";

const AT = "2026-10-30T12:00:00.000Z";
const status = (error: unknown) => (error as { status?: number }).status;

function registryWith(...inputs: Array<{ label: string; group: string; synonyms?: string[] }>): DishTagRegistry {
  return inputs.reduce((registry, input) => addTag(registry, input, "tester", AT).registry, emptyDishTagRegistry());
}

const dish = { canonicalId: "dish:stable", sourceName: "Dish", displayName: "Dish", description: "", preparationDescription: "", category: "Salad", subcategory: "Grain", ingredients: [], methodSteps: [], weekId: "w", dayId: "d", sourceReference: { workbook: "B.xlsx", sheet: "Menu" }, revision: 2, reviewStatus: "approved", recipeStatus: "draft", allergenEvidence: [{ allergen: "nuts", value: "contains", source: "review", reviewedBy: "reviewer" }], mayContainReviewed: true, audit: [] } as unknown as MenuItem;

test("tags get stable, group-scoped IDs and a canonical spelling", () => {
  assert.equal(dishTagId("cuisine", "Middle Eastern"), "dish-tag:cuisine:middle-eastern");
  assert.equal(dishTagId("cuisine", "  middle   eastern "), "dish-tag:cuisine:middle-eastern");
  assert.equal(dishTagId("ingredient", "Crème fraîche"), "dish-tag:ingredient:creme-fraiche");
  assert.equal(normaliseTagLabel("  Slow   cooked "), "Slow cooked");
  assert.throws(() => dishTagId("style", "***"), (error) => status(error) === 422);
});

test("creating a tag stores it once; repeating the request returns the same tag without a new write", () => {
  const first = addTag(emptyDishTagRegistry(), { label: "  Vegan ", group: "type" }, "ada", AT);
  assert.equal(first.outcome, "created");
  assert.deepEqual(first.tag, { id: "dish-tag:type:vegan", label: "Vegan", group: "type", synonyms: [], createdAt: AT, createdBy: "ada" });
  const again = addTag(first.registry, { label: "vegan", group: "type" }, "bob", AT);
  assert.equal(again.outcome, "existing");
  assert.equal(again.registry, first.registry, "a duplicate returns the same registry object, so nothing is written");
  assert.equal(again.tag.createdBy, "ada");
  assert.equal(again.registry.tags.length, 1);
});

test("synonyms find and de-duplicate against an existing tag but never create a second one", () => {
  const registry = registryWith({ label: "Aubergine", group: "ingredient", synonyms: ["Eggplant", "Brinjal"] });
  assert.equal(addTag(registry, { label: "eggplant", group: "ingredient" }, "x", AT).outcome, "existing");
  assert.equal(addTag(registry, { label: "BRINJAL", group: "ingredient" }, "x", AT).tag.id, "dish-tag:ingredient:aubergine");
  assert.equal(addTag(registry, { label: "Eggplant", group: "style" }, "x", AT).outcome, "created", "the same word in another group is a different tag");
  const clean = addTag(emptyDishTagRegistry(), { label: "Chilli", group: "ingredient", synonyms: ["chili", "CHILLI", " Chile "] }, "x", AT);
  assert.deepEqual(clean.tag.synonyms, ["chili", "Chile"]);
});

test("invalid tags are rejected with a 422 and never partially stored", () => {
  const empty = emptyDishTagRegistry();
  for (const input of [
    { label: "", group: "type" },
    { label: "   ", group: "type" },
    { label: "x".repeat(41), group: "type" },
    { label: "Fine", group: "colour" },
    { label: "Fine", group: "type", synonyms: ["ok", "y".repeat(41)] },
    { label: "Fine", group: "type", synonyms: Array.from({ length: 11 }, (_, index) => `syn${index}`) },
  ]) assert.throws(() => addTag(empty, input, "x", AT), (error) => status(error) === 422, JSON.stringify(input).slice(0, 60));
  assert.throws(() => addTag(empty, { label: 5 as unknown as string, group: "type" }, "x", AT), (error) => status(error) === 422);
});

test("the registry is bounded", () => {
  const full: DishTagRegistry = { ...emptyDishTagRegistry(), tags: Array.from({ length: MAX_REGISTRY_TAGS }, (_, index) => ({ id: `dish-tag:type:t${index}`, label: `T${index}`, group: "type", synonyms: [], createdAt: AT, createdBy: "x" })) };
  assert.throws(() => addTag(full, { label: "One more", group: "type" }, "x", AT), (error) => status(error) === 409);
  assert.equal(addTag(full, { label: "T5", group: "type" }, "x", AT).outcome, "existing", "an existing tag is still returned from a full registry");
});

test("search matches names and synonyms ignoring case, accents and spacing, in group order", () => {
  const registry = registryWith(
    { label: "Spicy", group: "style" },
    { label: "Thai", group: "cuisine" },
    { label: "Crème fraîche", group: "ingredient", synonyms: ["sour cream"] },
    { label: "Vegan", group: "type" },
  );
  assert.deepEqual(searchTags(registry, "").map((tag) => tag.label), ["Vegan", "Thai", "Crème fraîche", "Spicy"]);
  assert.deepEqual(searchTags(registry, "  CREME  ").map((tag) => tag.label), ["Crème fraîche"]);
  assert.deepEqual(searchTags(registry, "sour").map((tag) => tag.id), ["dish-tag:ingredient:creme-fraiche"]);
  assert.deepEqual(searchTags(registry, "", { group: "style" }).map((tag) => tag.label), ["Spicy"]);
  assert.deepEqual(searchTags(registry, "zzz"), []);
  assert.deepEqual(groupTags(searchTags(registry, "")).map((entry) => entry.group), ["type", "cuisine", "ingredient", "style"]);
});

test("seeding is additive and idempotent: it never edits or removes an existing tag", () => {
  const registry = registryWith({ label: "Vegan", group: "type", synonyms: ["plant based"] });
  const seeded = mergeSeedTags(registry, [{ label: "Plant based", group: "type" }, { label: "Italian", group: "cuisine" }, { label: "italian", group: "cuisine" }], "seed", AT);
  assert.deepEqual(seeded.added.map((tag) => tag.id), ["dish-tag:cuisine:italian"]);
  assert.equal(seeded.registry.tags.find((tag) => tag.id === "dish-tag:type:vegan"), registry.tags[0], "the existing tag object is untouched");
  assert.equal(mergeSeedTags(seeded.registry, [{ label: "Italian", group: "cuisine" }], "seed", AT).added.length, 0);
});

test("a dish may only reference known tags; duplicates collapse and order is kept", () => {
  const registry = registryWith({ label: "Vegan", group: "type" }, { label: "Thai", group: "cuisine" });
  assert.deepEqual(validateDishTagIds(registry, ["dish-tag:cuisine:thai", "dish-tag:type:vegan", "dish-tag:cuisine:thai"]), ["dish-tag:cuisine:thai", "dish-tag:type:vegan"]);
  assert.deepEqual(validateDishTagIds(registry, []), []);
  assert.throws(() => validateDishTagIds(registry, ["dish-tag:type:vegan", "dish-tag:type:ghost"]), (error) => status(error) === 422 && /ghost/.test((error as Error).message));
  assert.throws(() => validateDishTagIds(registry, "dish-tag:type:vegan"), (error) => status(error) === 422);
  assert.throws(() => validateDishTagIds(registry, [1]), (error) => status(error) === 422);
  assert.throws(() => validateDishTagIds(registry, Array.from({ length: MAX_TAGS_PER_DISH + 1 }, (_, index) => `dish-tag:type:t${index}`)), (error) => status(error) === 422);
  assert.deepEqual(tagLabels(registry, ["dish-tag:type:vegan", "dish-tag:type:gone"]), ["Vegan", "dish-tag:type:gone"], "an unresolved ID is shown, never hidden");
  assert.deepEqual(tagLabels(registry, undefined), []);
});

test("amending a dish stores tag IDs without changing identity, category, salad subtype or allergen evidence", () => {
  const amended = amendCanonicalMenuItemRecord(dish, [dish], { displayName: "Dish", category: "Salad", subcategory: "Grain", tagIds: ["dish-tag:type:vegan", "dish-tag:type:vegan"] }, "staff:1", AT);
  assert.deepEqual(amended.tagIds, ["dish-tag:type:vegan"]);
  assert.equal(amended.canonicalId, "dish:stable");
  assert.equal(amended.category, "Salad");
  assert.equal(amended.subcategory, "Grain");
  assert.deepEqual(amended.allergenEvidence, dish.allergenEvidence);
  assert.equal(amended.revision, 3);
});

test("omitting tagIds leaves existing tags alone; an empty list clears them; legacy dishes stay readable", () => {
  const tagged = { ...dish, tagIds: ["dish-tag:type:vegan"] } as MenuItem;
  assert.deepEqual(amendCanonicalMenuItemRecord(tagged, [tagged], { displayName: "Dish", category: "Salad" }, "staff:1", AT).tagIds, ["dish-tag:type:vegan"]);
  assert.equal("tagIds" in amendCanonicalMenuItemRecord(tagged, [tagged], { displayName: "Dish", category: "Salad", tagIds: [] }, "staff:1", AT), false);
  assert.equal(canonicalEntry(dish).tagIds, undefined, "a legacy dish exposes no tags");
  assert.deepEqual(canonicalEntry(tagged).tagIds, ["dish-tag:type:vegan"]);
  assert.equal(canonicalEntry(tagged).category, "Salad", "tags never replace the primary category");
});

test("source contracts: the tag API validates, is idempotent and the dish API passes tag IDs through", () => {
  const route = readFileSync(new URL("../app/api/dish-tags/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireCatalogueMutationActor/);
  assert.match(route, /result\.outcome === "created" \? 201 : 200/);
  assert.match(route, /expectedVersion/);
  const catalogue = readFileSync(new URL("../app/api/catalogue/route.ts", import.meta.url), "utf8");
  assert.match(catalogue, /tagIds: body\.tagIds/);
  const repository = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /validateDishTagIds\(await readDishTagRegistry\(\), input\.tagIds\)/);
  const store = readFileSync(new URL("../lib/dish-tag-store.ts", import.meta.url), "utf8");
  assert.match(store, /runTransaction/);
  assert.match(store, /kind: "dish-tag-registry"/);
  assert.doesNotMatch(store, /kind: "dish"/, "the registry document is never listed as a dish");
});
