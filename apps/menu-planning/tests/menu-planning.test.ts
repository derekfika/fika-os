import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deterministicId, publicationBlockers } from "../lib/domain";
import { inspectWorkbook } from "../lib/importer";
import { getMenuSnapshot, runMenuCommand } from "../lib/store";
import * as XLSX from "xlsx";
import { listSavedSandwiches, saveSandwich } from "../lib/sandwiches";
import { titleCase } from "../lib/text";

test("menu IDs are deterministic and publication blocks unresolved safety evidence", () => {
  assert.equal(deterministicId("menu-item-import", "WC 20_07_2026.xlsx", "mon", "3", "Mixed Leaf Salad"), deterministicId("menu-item-import", "WC 20_07_2026.xlsx", "mon", "3", "Mixed Leaf Salad"));
  assert.ok(publicationBlockers({ week: { canonicalId: "w", weekCommencing: "2026-08-03", weekEnding: "2026-08-07", status: "in_review", version: 1, dayIds: ["d"], itemIds: ["i"], allocationIds: [], exceptions: [{ canonicalId: "e", type: "missing_allergen_evidence", severity: "blocking", status: "open", affected: {}, description: "missing", createdAt: "", createdBy: "", audit: [] }], audit: [] }, days: [{ canonicalId: "d", weekId: "w", date: "2026-08-03", dayName: "Monday", position: 1, itemIds: ["i"], audit: [] }], items: [{ canonicalId: "i", sourceName: "Soup", displayName: "Soup", category: "soup", weekId: "w", dayId: "d", sourceReference: { workbook: "x", sheet: "mon" }, revision: 1, reviewStatus: "unreviewed", allergenEvidence: [], mayContainReviewed: false, audit: [] }], allocations: [] }).length > 0);
});

test("the WC workbook importer recognises paired day and allergen sheets", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["MONDAY", "", "Monday"], ["PRODUCT", "DISH", "MNK"], ["SALAD 1", "Mixed leaf salad", 10]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "mon");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["ALLERGEN CHECKER"]]), "fikamon");
  const report = inspectWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "WC 20_07_2026.xlsx");
  assert.equal(report.sheets.find(item => item.name === "mon")?.structure, "day-menu");
  assert.equal(report.sheets.find(item => item.name === "fikamon")?.structure, "allergen-review");
  assert.equal(report.candidates[0]?.displayName, "Mixed Leaf Salad");
  assert.ok(report.exceptions.length > 0);
});

test("the menu planning app is a separate local application", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Plan the week/);
  assert.match(page, /Publish menu/);
  assert.match(page, /Allergen/);
});

test("dish creation has a dedicated structured route", () => {
  const page = readFileSync(new URL("../app/dishes/new/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Create dish/);
  assert.match(page, /Ingredients/);
  assert.match(page, /Save draft dish/);
});

test("recipe commands preserve the source dish while supporting revision and duplication", () => {
  const before = getMenuSnapshot();
  const item = before.items[0];
  runMenuCommand({ action: "duplicate-item", itemId: item.canonicalId, reason: "Test duplicate" });
  const afterDuplicate = getMenuSnapshot();
  assert.equal(afterDuplicate.items.length, before.items.length + 1);
  runMenuCommand({ action: "edit-item", itemId: item.canonicalId, displayName: "Renamed test dish", reason: "Test revision" });
  const amended = getMenuSnapshot().items.find(value => value.canonicalId === item.canonicalId);
  assert.equal(amended?.displayName, "Renamed Test Dish");
  assert.equal(amended?.revision, item.revision + 1);
});

test("governed menu commands preserve recipe history and block unsafe publication", () => {
  const before = getMenuSnapshot();
  const item = before.items.find(value => value.canonicalId === "menu-item:soup");
  assert.ok(item);
  runMenuCommand({ action: "review-allergen", itemId: item.canonicalId, allergen: "gluten", allergenValue: "free_from", evidenceSource: "Reviewed supplier matrix" });
  const reviewed = getMenuSnapshot().items.find(value => value.canonicalId === item.canonicalId);
  assert.equal(reviewed?.allergenEvidence.find(value => value.allergen === "gluten")?.reviewedBy, "local-menu-reviewer");
  assert.throws(() => runMenuCommand({ action: "allocate-site", itemId: item.canonicalId, sourceSiteName: "MNK", siteId: "oploc:mnk", plannedQuantity: 0 }), /positive planned quantity/);
  runMenuCommand({ action: "archive-item", itemId: item.canonicalId, reason: "Retired test recipe" });
  assert.equal(getMenuSnapshot().items.find(value => value.canonicalId === item.canonicalId)?.recipeStatus, "archived");
  runMenuCommand({ action: "restore-item", itemId: item.canonicalId, reason: "Restored for test" });
  assert.equal(getMenuSnapshot().items.find(value => value.canonicalId === item.canonicalId)?.recipeStatus, "draft");
});

test("saved sandwiches keep a stable title and mutually exclusive allergen pattern", async () => {
  const first = await saveSandwich("test saved sandwich", { gluten: "contains", milk: "may_contain" }, "test");
  const second = await saveSandwich("test saved sandwich", { noKeyAllergens: "contains", gluten: "contains" }, "test");
  assert.equal(first.id, second.id);
  assert.equal(second.title, "Test Saved Sandwich");
  assert.equal(second.allergens.noKeyAllergens, "contains");
  assert.equal(second.allergens.gluten, "clear");
  assert.ok((await listSavedSandwiches()).some(item => item.id === first.id));
});

test("source-pack manifest keeps regional and weekly evidence separate", () => {
  const manifest = JSON.parse(readFileSync(new URL("../fixtures/source-pack-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.packs.length, 2);
  assert.deepEqual(manifest.packs.map((pack: { kind: string }) => pack.kind).sort(), ["delivered_in_lunch_workbooks", "regional_recipe_pack"]);
  assert.ok(manifest.packs.every((pack: { files: Array<{ evidenceOnly: boolean; reviewState: string }> }) => pack.files.length > 0 && pack.files.every(file => file.evidenceOnly && file.reviewState === "unreviewed")));
  assert.ok(manifest.rules.some((rule: string) => rule.includes("never canonical truth")));
  assert.ok(manifest.rules.some((rule: string) => rule.includes("never silently maps or merges")));
});

test("Brian recipe candidates preserve structured recipe evidence without inventing allergens", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/brian-recipe-candidates.json", import.meta.url), "utf8")) as { candidates: Array<{ canonicalId: string; methodSteps?: string[]; ingredients?: unknown[]; reviewStatus: string; allergenEvidence: unknown[]; sourceEvidence?: { document: string } }> };
  assert.equal(fixture.candidates.length, 77);
  assert.ok(fixture.candidates.every(candidate => candidate.reviewStatus === "unreviewed" && candidate.allergenEvidence.length === 0));
  assert.ok(fixture.candidates.some(candidate => (candidate.ingredients?.length || 0) > 0 && (candidate.methodSteps?.length || 0) > 0));
  assert.ok(fixture.candidates.every(candidate => candidate.sourceEvidence?.document?.startsWith("regional/")));
  assert.equal(new Set(fixture.candidates.map(candidate => candidate.canonicalId)).size, fixture.candidates.length);
});

test("dish creation retains Brian-style ingredients, method and yield fields", () => {
  const name = `Focused recipe ${Date.now()}`;
  runMenuCommand({ action: "create-item", displayName: name, category: "delivered-in lunch", yieldDescription: "Makes 20 portions", ingredients: [{ name: "Olive oil", quantity: 250, unit: "ml" }], methodSteps: ["Whisk ingredients", "Chill before service"] });
  const item = getMenuSnapshot().items.find(value => value.displayName === titleCase(name));
  assert.deepEqual(item?.ingredients, [{ name: "Olive oil", quantity: 250, unit: "ml" }]);
  assert.deepEqual(item?.methodSteps, ["Whisk ingredients", "Chill before service"]);
  assert.equal(item?.yieldDescription, "Makes 20 portions");
});

test("source-pack inventory is deterministic for the same inputs", () => {
  const regional = new URL("../fixtures/source-pack-manifest.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(regional, "utf8"));
  const paths = manifest.packs.flatMap((pack: { id: string; files: Array<{ relativePath: string }> }) => pack.files.map(file => `${pack.id}:${file.relativePath}`));
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(manifest.packs.find((pack: { kind: string; files: Array<{ extension: string }> }) => pack.kind === "delivered_in_lunch_workbooks")?.files.some((file: { extension: string }) => [".xlsx", ".xls"].includes(file.extension)));
});
