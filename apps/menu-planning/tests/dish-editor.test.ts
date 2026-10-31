import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CANONICAL_DISH_CATEGORIES } from "../lib/dish-categories";
import {
  buildCreatePayload,
  buildUpdatePayload,
  cleanDishName,
  dishFitsSaladSlot,
  normaliseSaladSubtype,
  resolveEnter,
  saladNeedsSlot,
  saladSubtypeForSlot,
  SALAD_SLOT_SUBTYPES,
  savedOutcomeIsExisting,
  similarDishWarnings,
  suggestTags,
  validateDishForm,
} from "../lib/dish-editor";
import { addTag, emptyDishTagRegistry } from "../lib/dish-tags";

const AT = "2026-10-30T12:00:00.000Z";
const dishes = [
  { id: "dish:a", name: "Chicken Tikka Masala", aliases: ["CTM"] },
  { id: "dish:b", name: "Roasted Beetroot Salad" },
  { id: "dish:c", name: "Beetroot" },
];

test("cleanDishName trims and collapses spaces but keeps the author's casing", () => {
  assert.equal(cleanDishName("  Spiced   lentil soup "), "Spiced lentil soup");
  assert.equal(cleanDishName("   "), "");
});

test("Enter on an exact existing name or alias selects it, ignoring case and spacing, and never creates a duplicate", () => {
  assert.deepEqual(resolveEnter(dishes, "  chicken  TIKKA masala "), { kind: "existing", dish: dishes[0], via: "name" });
  assert.deepEqual(resolveEnter(dishes, "ctm"), { kind: "existing", dish: dishes[0], via: "alias" });
  assert.deepEqual(resolveEnter(dishes, "Beetroot"), { kind: "existing", dish: dishes[2], via: "name" });
});

test("Enter on an unknown name opens Create prefilled with the cleaned typed name; empty does nothing", () => {
  assert.deepEqual(resolveEnter(dishes, "  Harissa   carrots "), { kind: "create", name: "Harissa carrots" });
  assert.deepEqual(resolveEnter(dishes, "Roasted Beetroot"), { kind: "create", name: "Roasted Beetroot" }, "a partial match is not an exact match");
  assert.deepEqual(resolveEnter(dishes, "   "), { kind: "empty" });
  assert.deepEqual(resolveEnter([], "Anything"), { kind: "create", name: "Anything" });
});

test("a name match wins over an alias match on a different dish", () => {
  const list = [{ id: "x", name: "Lentil Dhal", aliases: ["Dal"] }, { id: "y", name: "Dal", aliases: [] }];
  assert.deepEqual(resolveEnter(list, "dal"), { kind: "existing", dish: list[1], via: "name" });
});

test("duplicate warnings list similar dishes, exclude the dish being edited and stay quiet for short text", () => {
  assert.deepEqual(similarDishWarnings(dishes, "Beetroot salad").map((d) => d.id), ["dish:b", "dish:c"], "a query that contains an existing name or is contained in one is flagged");
  assert.deepEqual(similarDishWarnings(dishes, "Harissa carrots").map((d) => d.id), []);
  assert.deepEqual(similarDishWarnings(dishes, "Roasted Beetroot Salad").map((d) => d.id), ["dish:b", "dish:c"]);
  assert.deepEqual(similarDishWarnings(dishes, "Roasted Beetroot Salad", "dish:b").map((d) => d.id), ["dish:c"]);
  assert.deepEqual(similarDishWarnings(dishes, "ab"), []);
  assert.ok(similarDishWarnings(Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, name: `Beetroot ${i}` })), "Beetroot").length <= 5);
});

test("tag suggestions rank whole phrases and synonyms with reasons, skip chosen tags and cap at five", () => {
  let registry = emptyDishTagRegistry();
  for (const input of [
    { label: "Chicken", group: "type" },
    { label: "Indian", group: "cuisine", synonyms: ["Tikka"] },
    { label: "Fish / Seafood", group: "type", synonyms: ["Seafood"] },
    { label: "Fried", group: "style" },
    { label: "Beef", group: "type" },
  ]) registry = addTag(registry, input, "t", AT).registry;
  const ids = (name: string, chosen: string[] = []) => suggestTags(registry.tags, name, chosen).map(({ tag }) => tag.label);
  assert.deepEqual(ids("Chicken Tikka Masala"), ["Chicken", "Indian"]);
  assert.deepEqual(ids("Chicken Tikka Masala", ["dish-tag:type:chicken"]), ["Indian"]);
  assert.deepEqual(ids("Seafood chowder"), ["Fish / Seafood"]);
  assert.deepEqual(ids("Beefy stew"), [], "a tag only matches a whole word");
  assert.deepEqual(ids(""), []);
  assert.match(suggestTags(registry.tags, "Chicken Tikka Masala", [])[0].reason, /“Chicken”/);
  let manyRegistry = registry;
  for (let index = 0; index < 8; index++) manyRegistry = addTag(manyRegistry, { label: `Special ${index}`, group: "style" }, "t", AT).registry;
  assert.ok(suggestTags(manyRegistry.tags, "Special 1 Special 2 Special 3 Special 4 Special 5 Special 6 Special 7 Special 8", []).length <= 5);
});

test("UK spelling and culinary synonyms match phrases without fish-sauce or substring false positives", () => {
  let registry = emptyDishTagRegistry();
  for (const input of [
    { label: "Aubergine", group: "ingredient" },
    { label: "Coriander", group: "ingredient" },
    { label: "Fish / Seafood", group: "type", synonyms: ["Fish main", "Seafood"] },
    { label: "Ham", group: "ingredient" },
  ]) registry = addTag(registry, input, "t", AT).registry;
  const labels = (name: string) => suggestTags(registry.tags, name, []).map(({ tag }) => tag.label);
  assert.deepEqual(labels("Eggplant coriander salad"), ["Aubergine", "Coriander"]);
  assert.deepEqual(labels("Fish sauce noodles"), []);
  assert.deepEqual(labels("Chamomile tea"), []);
  assert.deepEqual(labels("Roast ham"), ["Ham"]);
});

test("similarity hints can only come from already-tagged dishes and explain their source", () => {
  let registry = emptyDishTagRegistry();
  registry = addTag(registry, { label: "Roasted", group: "style" }, "t", AT).registry;
  const tag = registry.tags[0];
  const similarDishes = [
    { id: "tagged", name: "Roasted Beetroot", tagIds: [tag.id] },
    { id: "untagged", name: "Roasted Carrots", tagIds: [] },
  ];
  const suggestions = suggestTags(registry.tags, "Roasted Carrot Salad", [], { similarDishes });
  assert.equal(suggestions[0]?.tag.id, tag.id);
  assert.match(suggestions[0].reason, /Roasted Beetroot/);
  assert.doesNotMatch(suggestTags(registry.tags, "Roasted Carrot Salad", [], { similarDishes: similarDishes.slice(1) })[0].reason, /similar tagged dish/i);
});

test("the form needs a name and one of the governed categories", () => {
  const categories = CANONICAL_DISH_CATEGORIES as readonly string[];
  assert.equal(validateDishForm({ name: "  ", category: "Salad", tagIds: [] }, categories), "A dish name is required.");
  assert.equal(validateDishForm({ name: "Dal", category: "Starters", tagIds: [] }, categories), "Choose one of the dish categories.");
  assert.equal(validateDishForm({ name: "Dal", category: "Starch/Side", tagIds: [] }, categories), undefined);
});

test("create sends the canonical dish with cleaned name, category and de-duplicated tag IDs, and no allergen state", () => {
  const payload = buildCreatePayload({ name: " New  dish ", category: "Salad", tagIds: ["dish-tag:type:slaw", "dish-tag:type:slaw"] });
  assert.deepEqual(payload, { action: "create-dish", displayName: "New dish", category: "Salad", tagIds: ["dish-tag:type:slaw"] });
  assert.ok(!("allergenEvidence" in payload) && !("mayContainNotes" in payload));
});

test("edit sends the dish's current values back so description, preparation notes and subcategory are never blanked", () => {
  const payload = buildUpdatePayload("dish:stable", { name: "Renamed", category: "Salad", tagIds: ["dish-tag:style:fried"] }, { subcategory: "Grain", description: "Keep me", preparationNotes: "Also me", mayContainNotes: "may contain nuts", ingredients: [{ name: "Oats" }], methodSteps: ["Mix"] });
  assert.equal(payload.action, "update-dish-with-tags");
  assert.equal(payload.id, "dish:stable");
  assert.equal(payload.subcategory, "Grain");
  assert.equal(payload.description, "Keep me");
  assert.equal(payload.preparationNotes, "Also me");
  assert.equal(payload.mayContainNotes, "may contain nuts");
  assert.deepEqual(payload.tagIds, ["dish-tag:style:fried"]);
});

test("a server match by exact name or merged alias is treated as selecting an existing dish, not a new one", () => {
  assert.equal(savedOutcomeIsExisting("matched_active"), true);
  assert.equal(savedOutcomeIsExisting("matched_merged_alias"), true);
  assert.equal(savedOutcomeIsExisting("created_new"), false);
  assert.equal(savedOutcomeIsExisting(undefined), false);
});

const planner = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("../app/dish-editor-modal.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/dish-editor-modal.css", import.meta.url), "utf8");

test("the planner opens the modal from Enter, keeps the picker cell for the save and returns to the picker on cancel", () => {
  assert.match(planner, /event\.key === "Enter" && !event\.nativeEvent\.isComposing/);
  assert.match(planner, /resolveEnter\(/);
  assert.match(planner, /\{picker && !editor && <DishPicker/);
  assert.match(planner, /\{picker && editor && <DishEditorModal/);
  assert.match(planner, /onCancel=\{\(\) => setEditor\(undefined\)\}/);
  assert.match(planner, /if \(saved\.outcome !== "updated"\) await choose\(\{ id: saved\.id, name: saved\.name, category: saved\.category \}\)/);
  assert.doesNotMatch(planner, /const createDish = async/, "the planner no longer creates dishes from a bare name");
});

test("existing planner flows are untouched: drag/copy, publish and the select-dish command remain", () => {
  assert.match(planner, /assessDishCopyTarget/);
  assert.match(planner, /update-entry/);
  assert.match(planner, /create-entry/);
  assert.match(planner, /SpellcheckPanel/);
});

test("the modal saves through the catalogue API, never writes allergens and guards double submits", () => {
  assert.match(modal, /fetch\("\/api\/catalogue"/);
  assert.match(modal, /buildUpdatePayload\(dishId, state, preserved\)/);
  assert.match(modal, /buildCreatePayload\(state\)/);
  assert.match(modal, /savingRef\.current/);
  assert.match(modal, /invalidateCatalogueCache\(\)/);
  assert.doesNotMatch(modal, /allergenEvidence|mayContainReviewed/, "the modal never authors allergen evidence");
  assert.match(modal, /dismissible=\{!saving\}/);
  assert.match(modal, /role="alert"/);
});

test("the modal is a labelled, keyboard-operable dialog with tag search, inline creation and suggestions", () => {
  assert.match(modal, /data-modal-autofocus/);
  assert.match(modal, /<legend>Tags/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /type="search"/);
  assert.match(modal, /action: "create-tag"/);
  assert.match(modal, /Add suggested tag/);
  assert.match(modal, /Save accepted or dismissed suggestions on this device/);
  assert.match(modal, /fika-menu-tag-suggestion-feedback-v1/);
  assert.match(modal, /reason\}/);
  assert.match(modal, /type="button"/);
  assert.match(modal, /Similar dishes already exist/);
  assert.match(modal, /Check the spelling/);
  assert.match(modal, /event\.key === "Enter"\) \{ event\.preventDefault\(\); void addTag\(\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test("the six salad slots map to the six governed subtypes, in slot order", () => {
  assert.deepEqual(SALAD_SLOT_SUBTYPES.map((entry) => `${entry.slot}=${entry.subtype}`), ["SALAD 1=Leaf", "SALAD 2=Slaw", "SALAD 3=Starch", "SALAD 4=Veg", "SALAD 5=Grain/Pulse", "SALAD 6=FIKA Seasonal"]);
  assert.equal(saladSubtypeForSlot("SALAD 1"), "Leaf");
  assert.equal(saladSubtypeForSlot(" salad 5 "), "Grain/Pulse");
  assert.equal(saladSubtypeForSlot("SALAD 7"), undefined);
  assert.equal(saladSubtypeForSlot("SOUP"), undefined);
  assert.equal(saladSubtypeForSlot("COLD PROTEIN"), undefined);
});

test("stored subtypes normalise, including spelling variants and the legacy Salad N names", () => {
  assert.equal(normaliseSaladSubtype("leaf"), "Leaf");
  assert.equal(normaliseSaladSubtype("Grain / Pulse"), "Grain/Pulse");
  assert.equal(normaliseSaladSubtype("grain"), "Grain/Pulse");
  assert.equal(normaliseSaladSubtype("Salad 4"), "Veg");
  assert.equal(normaliseSaladSubtype("SALAD 6"), "FIKA Seasonal");
  assert.equal(normaliseSaladSubtype("FIKA seasonal"), "FIKA Seasonal");
  assert.equal(normaliseSaladSubtype("Cold"), undefined);
  assert.equal(normaliseSaladSubtype(undefined), undefined);
  assert.equal(normaliseSaladSubtype(""), undefined);
});

test("a classified salad appears only in its own salad slot; leaf salads only in the leaf slot", () => {
  const leaf = { category: "Salad", subcategory: "Leaf" };
  for (const entry of SALAD_SLOT_SUBTYPES) assert.equal(dishFitsSaladSlot(leaf, entry.slot), entry.subtype === "Leaf", entry.slot);
  const legacy = { category: "Salad", subcategory: "Salad 2" };
  assert.equal(dishFitsSaladSlot(legacy, "SALAD 2"), true);
  assert.equal(dishFitsSaladSlot(legacy, "SALAD 1"), false);
});

test("unclassified salads stay offered in the five regular salad slots but never in FIKA Seasonal", () => {
  const unassigned = { category: "Salad" };
  for (const slot of ["SALAD 1", "SALAD 2", "SALAD 3", "SALAD 4", "SALAD 5"]) assert.equal(dishFitsSaladSlot(unassigned, slot), true, slot);
  assert.equal(dishFitsSaladSlot(unassigned, "SALAD 6"), false);
  assert.equal(dishFitsSaladSlot({ category: "Salad", subcategory: "FIKA Seasonal" }, "SALAD 6"), true);
  assert.equal(dishFitsSaladSlot({ category: "Salad", subcategory: "FIKA Seasonal" }, "SALAD 1"), false);
  assert.equal(saladNeedsSlot(unassigned), true);
  assert.equal(saladNeedsSlot({ category: "Salad", subcategory: "Veg" }), false);
  assert.equal(saladNeedsSlot({ category: "Soup" }), false);
});

test("non-salad slots are never affected by the salad rule", () => {
  for (const slot of ["SOUP", "HOT MAIN", "STARCH/SIDE", "DESSERT", "GARNISH"]) {
    assert.equal(dishFitsSaladSlot({ category: "Soup", subcategory: "Leaf" }, slot), true, slot);
    assert.equal(dishFitsSaladSlot({ category: "Salad" }, slot), true, slot);
  }
});

test("the salad slot is saved only for Salad dishes and other dishes keep their existing subcategory", () => {
  const create = buildCreatePayload({ name: "Baby leaves", category: "Salad", tagIds: [], subcategory: "leaf" });
  assert.equal(create.subcategory, "Leaf");
  assert.equal("subcategory" in buildCreatePayload({ name: "Baby leaves", category: "Salad", tagIds: [] }), false, "unassigned stays unassigned");
  assert.equal("subcategory" in buildCreatePayload({ name: "Soup", category: "Soup", tagIds: [], subcategory: "Leaf" }), false);
  const edit = buildUpdatePayload("d", { name: "Baby leaves", category: "Salad", tagIds: [], subcategory: "Veg" }, { subcategory: "Leaf" });
  assert.equal(edit.subcategory, "Veg");
  const cleared = buildUpdatePayload("d", { name: "Baby leaves", category: "Salad", tagIds: [], subcategory: "" }, { subcategory: "Leaf" });
  assert.equal(cleared.subcategory, undefined);
  const other = buildUpdatePayload("d", { name: "Soup", category: "Soup", tagIds: [] }, { subcategory: "House" });
  assert.equal(other.subcategory, "House");
});

test("the planner picker and modal apply and expose the salad slot rule", () => {
  assert.match(planner, /subcategory: saladSubtypeForSlot\(slot\)/);
  assert.match(planner, /initialSubcategory=\{editor\.subcategory\}/);
  assert.match(planner, /needs a salad slot/);
  assert.match(modal, /Salad slot/);
  assert.match(modal, /mode === "create" \? initialSubcategory : undefined/);
  assert.match(modal, /Not assigned yet/);
  assert.match(modal, /FIKA Seasonal is an explicit choice only/);
});
