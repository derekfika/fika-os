import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyWeek } from "../lib/rolling-menu";
import { copyMenuStructure, validateMenuStructure } from "../lib/menu-structure-library";
import { groupedSlots } from "../lib/week-planner-layout";

const structure = () => ({
  categories: [
    { id: "category-breakfast", name: "Breakfast", rows: [{ id: "row-hot-main", slot: "HOT MAIN", name: "Hot dishes" }, { id: "row-cold-dish", slot: "SALAD 1", name: "Cold dishes" }] },
    { id: "category-sides", name: "Sides", rows: [{ id: "row-side-dish", slot: "HOT VEGAN", name: "Sides" }] },
  ],
});

test("menu structures validate stable placements and copy independently of saved templates", () => {
  const saved = validateMenuStructure(structure());
  const applied = copyMenuStructure(saved, { id: "saved-breakfast", version: 3 });
  assert.deepEqual(applied.templateId, "saved-breakfast");
  assert.deepEqual(applied.templateVersion, 3);
  applied.categories[0].rows[0].name = "Changed in this menu";
  applied.categories.reverse();
  assert.equal(saved.categories[0].rows[0].name, "Hot dishes");
  assert.equal(saved.categories[0].name, "Breakfast");
  const duplicatePlacement = structure().categories[0];
  assert.throws(() => validateMenuStructure({ categories: [{ ...duplicatePlacement, rows: [duplicatePlacement.rows[0], { ...duplicatePlacement.rows[1], slot: duplicatePlacement.rows[0].slot }] }] }), /unique placement/);
});

test("supplementary menu layouts keep category and row order without the Main Lunch grid", () => {
  const snapshot = emptyWeek("2026-11-23", "test", ["HOT MAIN", "SALAD 1", "HOT VEGAN"]);
  snapshot.week.supplementaryMenu = { id: "breakfast-service", name: "Breakfast", serviceType: "Breakfast", siteIds: ["oploc:munich-re"] };
  snapshot.week.menuStructure = validateMenuStructure(structure());
  const groups = groupedSlots(snapshot);
  assert.deepEqual(groups, [["Breakfast", ["HOT MAIN", "SALAD 1"]], ["Sides", ["HOT VEGAN"]]]);
});

test("obsolete Hospitality UI controls are absent while ordinary planning and backend contracts remain", () => {
  const shell = readFileSync(new URL("../app/menu-planning-shell.tsx", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../app/week-planner.tsx", import.meta.url), "utf8");
  const nav = readFileSync(new URL("../app/planning-context-nav.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /Hospitality Rotations/);
  assert.doesNotMatch(planner, /Make available to Hospitality|Remove Hospitality availability|set-hospitality-availability/);
  assert.match(planner, /Export menu/);
  assert.match(planner, /add-supplementary-menu/);
  assert.match(nav, /Main Lunch/);
  assert.match(route, /set-hospitality-availability/, "legacy API remains available to deployed consumers");
});
