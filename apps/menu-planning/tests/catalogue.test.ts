import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterCatalogueEntries, type CatalogueEntry } from "../lib/catalogue";

const entries: CatalogueEntry[] = [
  { id: "menu-item:salad", kind: "canonical", name: "Green salad", category: "Salads", usage: ["delivered-in"], status: "approved", reviewStatus: "approved", sourceLabel: "Brian workbook", recipeAvailable: true, allergenCount: 0 },
  { id: "menu-item:sandwich", kind: "canonical", name: "Chicken sandwich", category: "sandwich", usage: ["hospitality", "production"], status: "draft", reviewStatus: "unreviewed", sourceLabel: "Chef source", recipeAvailable: false, allergenCount: 2 },
];

test("catalogue filters only canonical MenuItems", () => {
  assert.equal(entries.every((entry) => entry.kind === "canonical"), true);
  assert.equal(filterCatalogueEntries(entries, { query: "chicken" }).length, 1);
  assert.equal(filterCatalogueEntries(entries, { usage: "delivered-in" }).length, 1);
  assert.equal(filterCatalogueEntries(entries, { status: "approved" })[0]?.id, "menu-item:salad");
  assert.equal(filterCatalogueEntries(entries, { category: "Salads" })[0]?.id, "menu-item:salad");
});

test("catalogue reads do not reconcile or mutate rolling state", () => {
  const source = readFileSync(new URL("../lib/catalogue.ts", import.meta.url), "utf8");
  const listBody = source.slice(source.indexOf("export async function listCatalogueEntries"), source.indexOf("/** Explicit maintenance reconciliation"));
  assert.doesNotMatch(listBody, /syncRollingEntries|attachCanonicalDishIds|saveSnapshot|writeItems/);
  assert.match(source, /export async function reconcileCatalogueFromRollingEntries/);
});

test("hosted catalogue writes are targeted and transaction guarded", () => {
  const source = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  assert.match(source, /fikaMenuPlanningCatalogue/);
  assert.match(source, /runTransaction/);
  assert.match(source, /changed = items\.filter/);
  assert.doesNotMatch(source, /read-only until its mutation API is enabled/);
});

test("publication reconciliation is scoped to the selected day", () => {
  const catalogue = readFileSync(new URL("../lib/catalogue.ts", import.meta.url), "utf8");
  const rolling = readFileSync(new URL("../lib/rolling-menu.ts", import.meta.url), "utf8");
  assert.match(catalogue, /scope\?: \{ weekId: string; dayId: string \}/);
  assert.match(catalogue, /entry\.dayId === scope\.dayId/);
  assert.match(rolling, /scope\?\.dayId/);
});

test("hosted reconciliation preserves reviewed catalogue records", () => {
  const source = readFileSync(new URL("../lib/canonical-menu-repository.ts", import.meta.url), "utf8");
  assert.match(source, /const reviewed = existing\.reviewStatus !== "unreviewed" \|\| existing\.mayContainReviewed/);
  assert.match(source, /existing\.displayName !== name && !reviewed/);
  assert.match(source, /existingRecord\.revision > item\.revision/);
});
