import assert from "node:assert/strict";
import test from "node:test";
import { categoryAllowedForService, effectiveServiceLayout, normaliseCategories, resolveServiceCategories, SERVICE_IDS, SERVICE_LAYOUT_SEED } from "@fika/server-shared/hospitality-service-layout";
import { buildCataloguePackage, type PackageSource } from "../lib/hospitality-catalogue-package";
import { layoutPackageFromDocuments, type StoredServiceLayout } from "../lib/hospitality-service-layout";

const RCOA = "oploc:rcoa", OAC = "oploc:oac";
const stamp = "2026-10-30T00:00:00.000Z";
const doc = (scope: "company" | "site", services: StoredServiceLayout["services"], version = 1, oplocId?: string): StoredServiceLayout => ({ schema: 1, scope, ...(oplocId ? { oplocId } : {}), version, services, createdAt: stamp, createdBy: "t", updatedAt: stamp, updatedBy: "t" });
const empty: PackageSource = { items: [], offerings: [], prices: [], oplocs: [], routing: [] };

test("with nothing stored the effective layout is exactly today's hard-coded behaviour", () => {
  const layout = effectiveServiceLayout();
  assert.deepEqual(Object.keys(layout.company).sort(), [...SERVICE_IDS].sort()); assert.deepEqual(layout.sites, {});
  for (const id of SERVICE_IDS) assert.deepEqual(resolveServiceCategories(layout, RCOA, id), SERVICE_LAYOUT_SEED[id].categories);
  assert.deepEqual(resolveServiceCategories(layout, undefined, "breakfast"), ["Drinks", "Breakfast", "Sweet treats"]);
  assert.equal(categoryAllowedForService(layout, RCOA, "breakfast", "Wine"), false, "wine is in no service today");
  assert.equal(categoryAllowedForService(layout, RCOA, "dining", "Drinks"), true);
});

test("a site override replaces one service at that site only; other sites and services keep the company default", () => {
  const layout = layoutPackageFromDocuments([doc("company", {}, 1), doc("site", { dining: { categories: ["Dining", "Drinks", "Wine"] } }, 1, RCOA)]);
  assert.deepEqual(resolveServiceCategories(layout, RCOA, "dining"), ["Dining", "Drinks", "Wine"]);
  assert.deepEqual(resolveServiceCategories(layout, OAC, "dining"), ["Dining", "Drinks"]);
  assert.deepEqual(resolveServiceCategories(layout, RCOA, "breakfast"), SERVICE_LAYOUT_SEED.breakfast.categories);
  assert.equal(categoryAllowedForService(layout, RCOA, "breakfast", "Wine"), false);
});

test("a stored company rule changes every site without an override; hidden and unknown services fail closed", () => {
  const layout = layoutPackageFromDocuments([doc("company", { breakfast: { categories: ["Breakfast"] }, bespoke: { categories: ["Bespoke Events"], hidden: true } }, 3)]);
  assert.deepEqual(resolveServiceCategories(layout, OAC, "breakfast"), ["Breakfast"]);
  assert.equal(resolveServiceCategories(layout, OAC, "bespoke"), undefined, "hidden");
  assert.equal(resolveServiceCategories(layout, OAC, "not_a_service"), undefined, "unknown");
  assert.equal(categoryAllowedForService(layout, OAC, "bespoke", "Bespoke Events"), false);
  assert.deepEqual(resolveServiceCategories(layout, OAC, "lunch"), SERVICE_LAYOUT_SEED.lunch.categories, "a service missing from storage never becomes silently empty");
});

test("category lists are trimmed, de-duplicated in order and bounded", () => {
  assert.deepEqual(normaliseCategories([" Drinks ", "Wine", "Drinks", ""]), ["Drinks", "Wine"]);
  assert.throws(() => normaliseCategories("Drinks"), /list/); assert.throws(() => normaliseCategories([1]), /text/);
  assert.throws(() => normaliseCategories(["x".repeat(121)]), /too long/); assert.throws(() => normaliseCategories(Array.from({ length: 41 }, (_, i) => `c${i}`)), /at most/);
});

test("the package carries the layout only when stored documents are supplied, deterministically, and never changes item or price content", () => {
  assert.equal(buildCataloguePackage(empty, "2026-10-30").serviceLayout, undefined, "existing package fixtures are unaffected");
  const stored = [doc("company", { breakfast: { categories: ["Breakfast"] } }, 2), doc("site", { dining: { categories: ["Dining", "Wine"] } }, 1, RCOA)];
  const first = buildCataloguePackage({ ...empty, serviceLayout: stored }, "2026-10-30"), second = buildCataloguePackage({ ...empty, serviceLayout: [...stored].reverse() }, "2026-10-30");
  assert.deepEqual(first, second); assert.notEqual(first.serviceLayout?.version, "seed");
  assert.equal(buildCataloguePackage({ ...empty, serviceLayout: [] }, "2026-10-30").serviceLayout?.version, "seed");
  const changed = buildCataloguePackage({ ...empty, serviceLayout: [doc("company", { breakfast: { categories: ["Breakfast"] } }, 3), stored[1]] }, "2026-10-30");
  assert.notEqual(changed.serviceLayout?.version, first.serviceLayout?.version, "a new stored version changes the package version");
  assert.deepEqual({ ...first, serviceLayout: undefined }, { ...changed, serviceLayout: undefined });
});
