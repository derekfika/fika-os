import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CANONICAL_DISH_CATEGORIES } from "../lib/dish-categories";
import {
  buildCreatePayload,
  buildUpdatePayload,
  cleanDishName,
  resolveEnter,
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

test("tag suggestions match whole words and synonyms, skip chosen tags and are bounded", () => {
  let registry = emptyDishTagRegistry();
  for (const input of [
    { label: "Chicken", group: "type" },
    { label: "Indian", group: "cuisine", synonyms: ["Tikka"] },
    { label: "Fish / Seafood", group: "type", synonyms: ["Seafood"] },
    { label: "Fried", group: "style" },
    { label: "Beef", group: "type" },
  ]) registry = addTag(registry, input, "t", AT).registry;
  const ids = (name: string, chosen: string[] = []) => suggestTags(registry.tags, name, chosen).map((tag) => tag.label);
  assert.deepEqual(ids("Chicken Tikka Masala"), ["Chicken", "Indian"]);
  assert.deepEqual(ids("Chicken Tikka Masala", ["dish-tag:type:chicken"]), ["Indian"]);
  assert.deepEqual(ids("Seafood chowder"), ["Fish / Seafood"]);
  assert.deepEqual(ids("Beefy stew"), [], "a tag only matches a whole word");
  assert.deepEqual(ids(""), []);
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
  assert.match(modal, /Similar dishes already exist/);
  assert.match(modal, /Check the spelling/);
  assert.match(modal, /event\.key === "Enter"\) \{ event\.preventDefault\(\); void addTag\(\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
