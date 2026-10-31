import assert from "node:assert/strict";
import test from "node:test";
import { dishSlotRecommendation, saladSlotMatches } from "../lib/dish-slot-recommendations";
import { dishTagId, type DishTag } from "../lib/dish-tags";
import { rankDishPickerItems } from "../lib/dish-picker";
import { buildCreatePayload } from "../lib/dish-editor";

const at = "2026-10-31T00:00:00.000Z";
const makeTag = (label: string, synonyms: string[] = []): DishTag => ({
  id: dishTagId("type", label), label, group: "type", synonyms, createdAt: at, createdBy: "test",
});
const leaf = makeTag("Leaf Salad");
const slaw = makeTag("Slaw");
const bread = makeTag("Bread");
const veg = makeTag("Vegetable Side", ["Veg side"]);
const grain = makeTag("Grain / Pulse");
const seasonal = makeTag("FIKA Seasonal");
const registry = [leaf, slaw, bread, veg, grain, seasonal];
const salad = (subcategory?: string, tagIds: string[] = []) => ({ category: "Salad", subcategory, tagIds });

test("the six canonical salad slots preserve distinct subtype recommendations", () => {
  const values = ["Leaf", "Slaw", "Starch", "Veg", "Grain/Pulse", "FIKA Seasonal"];
  values.forEach((subcategory, index) => {
    const slot = `SALAD ${index + 1}`;
    assert.equal(saladSlotMatches(salad(subcategory), slot, registry), true, slot);
    for (let other = 0; other < values.length; other++) {
      if (other === index) continue;
      assert.equal(saladSlotMatches(salad(subcategory), `SALAD ${other + 1}`, registry), false, `${subcategory} is not recommended for SALAD ${other + 1}`);
    }
  });
});

test("registry labels and aliases resolve stable dish tag IDs for the specified salad recommendations", () => {
  assert.equal(saladSlotMatches(salad(undefined, [leaf.id]), "SALAD 1", registry), true);
  assert.equal(saladSlotMatches(salad(undefined, [slaw.id]), "SALAD 2", registry), true);
  assert.equal(saladSlotMatches(salad(undefined, [veg.id]), "SALAD 4", registry), true);
  assert.equal(saladSlotMatches(salad(undefined, [grain.id]), "SALAD 5", registry), true);
  assert.equal(saladSlotMatches(salad(undefined, [grain.id]), "SALAD 3", registry), false, "grain/pulse is not a starch-slot substitute");
  assert.equal(saladSlotMatches(salad(undefined, [bread.id]), "SALAD 3", registry), true, "Bread is the explicit seeded starch descriptor");
  assert.equal(saladSlotMatches(salad(undefined, [seasonal.id]), "SALAD 6", registry), false, "a Seasonal tag does not replace explicit slot assignment");
});

test("category is the hard eligibility gate, with subcategory above a contradictory descriptive tag", () => {
  assert.equal(saladSlotMatches({ category: "Hot Main", tagIds: [slaw.id] }, "SALAD 2", registry), false);
  assert.equal(dishSlotRecommendation(salad("Leaf", [slaw.id]), "SALAD 1", registry).score, 100);
  assert.equal(dishSlotRecommendation(salad("Leaf", [slaw.id]), "SALAD 2", registry).score, 80);
});

test("slot-aware ranking boosts explicit slot matches and searches canonical aliases", () => {
  const items = [
    { id: "plain", name: "Mixed salad", category: "Salad" },
    { id: "slaw", name: "Cabbage", category: "Salad", tagIds: [slaw.id], aliases: ["House coleslaw"] },
  ];
  assert.deepEqual(rankDishPickerItems(items, "", "SALAD 2", registry).map((item) => item.id), ["slaw", "plain"]);
  assert.deepEqual(rankDishPickerItems(items, "coleslaw", "SALAD 2", registry).map((item) => item.id), ["slaw"]);
});

test("creating from a salad slot persists the preselected subtype and tag IDs for the refreshed picker", () => {
  const payload = buildCreatePayload({ name: "Asian Slaw", category: "Salad", subcategory: "Slaw", tagIds: [slaw.id] });
  assert.equal(payload.subcategory, "Slaw");
  assert.deepEqual(payload.tagIds, [slaw.id]);
  assert.equal(saladSlotMatches({ category: payload.category, subcategory: payload.subcategory, tagIds: payload.tagIds }, "SALAD 2", registry), true);
});
