import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SERVICE_IDS, SERVICE_LAYOUT_SEED, type ServiceRule } from "@fika/server-shared/hospitality-service-layout";
import {
  buildServiceLayoutView, clearServiceOverrideCommand, effectivePreview, layoutVocabulary, moveCategory, orphanCategories, saveBlocker, scopeVersion,
  serviceRuleAt, setCategoryIncluded, setServiceCategoriesCommand, unmappedCategories, SERVICE_LABELS, type ServiceLayoutView,
} from "../lib/hospitality-catalogue-types";

const RCOA = "oploc:rcoa", OAC = "oploc:oac";
type Doc = Parameters<typeof buildServiceLayoutView>[0][number];
const company = (services: Doc["services"], version = 1): Doc => ({ scope: "company", version, services });
const site = (oplocId: string, services: Doc["services"], version = 1): Doc => ({ scope: "site", oplocId, version, services });
const seedCategories = [...new Set(SERVICE_IDS.flatMap(id => SERVICE_LAYOUT_SEED[id].categories))];
const view = (documents: Doc[] = [], catalogue: string[] = seedCategories): ServiceLayoutView => buildServiceLayoutView(documents, catalogue);

test("payload versions: 0 when nothing is stored, the effective company rules are the seed, no site documents", () => {
  const layout = view();
  assert.equal(layout.company.version, 0);
  assert.deepEqual(Object.keys(layout.company.services).sort(), [...SERVICE_IDS].sort());
  for (const id of SERVICE_IDS) assert.deepEqual(layout.company.services[id]?.categories, SERVICE_LAYOUT_SEED[id].categories);
  assert.deepEqual(layout.sites, {});
  assert.equal(scopeVersion(layout), 0); assert.equal(scopeVersion(layout, RCOA), 0, "an unknown site is expectedVersion 0");
});

test("payload versions follow each stored document; an emptied site document keeps its version for the next expectedVersion", () => {
  const layout = view([company({ breakfast: { categories: ["Breakfast"] } }, 3), site(RCOA, { dining: { categories: ["Dining", "Wine"] } }, 2), site(OAC, {}, 5)]);
  assert.equal(layout.company.version, 3); assert.deepEqual(layout.company.services.breakfast?.categories, ["Breakfast"]);
  assert.deepEqual(layout.company.services.lunch?.categories, SERVICE_LAYOUT_SEED.lunch.categories, "gaps fall back to the seed");
  assert.equal(layout.sites[RCOA].version, 2); assert.deepEqual(Object.keys(layout.sites[RCOA].services), ["dining"]);
  assert.equal(layout.sites[OAC].version, 5); assert.deepEqual(layout.sites[OAC].services, {});
  assert.equal(scopeVersion(layout, OAC), 5);
});

test("vocabulary: catalogue categories are exact, de-duplicated and never trimmed or case-folded", () => {
  const layout = view([], ["Wine", "Drinks", "drinks", "Drinks ", "", "Wine"]);
  assert.deepEqual(layout.vocabulary.catalogueCategories, ["Drinks", "drinks", "Drinks ", "Wine"].sort((a, b) => a.localeCompare(b, "en-GB")));
  assert.deepEqual(layout.vocabulary.seedCategories, seedCategories);
});

test("matrix rows are only seed + live catalogue + categories already in a stored layout", () => {
  const layout = view([company({ dining: { categories: ["Dining", "Legacy Special"] } }), site(RCOA, { bespoke: { categories: ["Site Only"] } })], ["Wine", "Drinks"]);
  const rows = layoutVocabulary(layout);
  assert.deepEqual(new Set(rows), new Set([...seedCategories, "Wine", "Legacy Special", "Site Only"]));
  assert.equal(rows.length, new Set(rows).size);
  assert.deepEqual(rows.slice(0, seedCategories.length), seedCategories, "seed rows first, in seed order");
  assert.ok(!rows.includes("Alcohol"), "no category is invented");
});

test("orphan: in the layout but in no live item; unmapped: a live category in no company service; neither is auto-fixed", () => {
  const catalogue = ["Drinks", "Dining", "Wine"];
  const rules = view([company({ dining: { categories: ["Dining", "Drinks", "Ghost"] } })]).company.services;
  const orphans = orphanCategories(rules, catalogue);
  assert.ok(orphans.includes("Ghost") && orphans.includes("Breakfast") && !orphans.includes("Drinks") && !orphans.includes("Dining"));
  assert.deepEqual(unmappedCategories(rules, catalogue), ["Wine"]);
  assert.deepEqual(unmappedCategories(rules, ["Drinks ", "drinks"]), ["Drinks ", "drinks"], "exact match: case and spacing are significant");
  assert.deepEqual(orphanCategories({ dining: { categories: ["Drinks"] } }, ["drinks"]), ["Drinks"]);
  assert.deepEqual(rules.dining?.categories, ["Dining", "Drinks", "Ghost"], "detection does not mutate the layout");
});

test("ticking appends to the end, unticking keeps the order, reordering swaps one place and stops at the ends", () => {
  assert.deepEqual(setCategoryIncluded(["A", "B"], "C", true), ["A", "B", "C"]);
  assert.deepEqual(setCategoryIncluded(["A", "B", "C"], "B", false), ["A", "C"]);
  assert.deepEqual(setCategoryIncluded(["A", "B"], "A", true), ["B", "A"], "re-ticking never duplicates");
  assert.deepEqual(moveCategory(["A", "B", "C"], "B", -1), ["B", "A", "C"]);
  assert.deepEqual(moveCategory(["A", "B", "C"], "B", 1), ["A", "C", "B"]);
  assert.deepEqual(moveCategory(["A", "B", "C"], "A", -1), ["A", "B", "C"]);
  assert.deepEqual(moveCategory(["A", "B", "C"], "C", 1), ["A", "B", "C"]);
  assert.deepEqual(moveCategory(["A", "B"], "Z", 1), ["A", "B"]);
  const original = ["A", "B"]; moveCategory(original, "A", 1); assert.deepEqual(original, ["A", "B"], "inputs are not mutated");
});

test("inheritance vs override and the effective preview, including hidden services and unsaved drafts", () => {
  const layout = view([company({ bespoke: { categories: ["Bespoke Events"], hidden: true } }, 2), site(RCOA, { dining: { categories: ["Dining", "Wine"] } }, 1)]);
  assert.equal(serviceRuleAt(layout, RCOA, "dining").source, "site");
  assert.equal(serviceRuleAt(layout, RCOA, "lunch").source, "company");
  assert.equal(serviceRuleAt(layout, OAC, "dining").source, "company");
  assert.equal(serviceRuleAt(layout, undefined, "dining").source, "company");
  const preview = effectivePreview(layout, RCOA);
  assert.deepEqual(preview.map(entry => entry.serviceId), [...SERVICE_IDS], "services stay in fixed order");
  assert.deepEqual(preview.find(entry => entry.serviceId === "dining")?.categories, ["Dining", "Wine"]);
  const bespoke = preview.find(entry => entry.serviceId === "bespoke")!;
  assert.equal(bespoke.hidden, true); assert.deepEqual(bespoke.categories, ["Bespoke Events"], "a hidden service still shows its list");
  assert.ok(preview.every(entry => !entry.edited));
  const drafted = effectivePreview(layout, OAC, { lunch: { categories: ["Lunch"] }, dining: { ...layout.company.services.dining as ServiceRule } });
  assert.equal(drafted.find(entry => entry.serviceId === "lunch")?.edited, true);
  assert.equal(drafted.find(entry => entry.serviceId === "dining")?.edited, false, "a draft equal to the saved rule is not an edit");
  assert.deepEqual(Object.keys(SERVICE_LABELS), [...SERVICE_IDS]);
  assert.deepEqual(SERVICE_IDS.map(id => SERVICE_LABELS[id]), ["Breakfast", "Lunch", "Afternoon", "Meeting hospitality", "Finger food", "Event catering", "Dining", "Bespoke"]);
});

test("save rules mirror the server: reason, at least one category unless hidden, no no-op and no override equal to the company default", () => {
  const layout = view([company({}, 4), site(RCOA, { dining: { categories: ["Dining", "Wine"] } }, 2)]);
  const reason = "Owner wants wine at dinner";
  assert.match(saveBlocker(layout, undefined, "dining", { categories: [...SERVICE_LAYOUT_SEED.dining.categories] }, reason), /No changes/);
  assert.match(saveBlocker(layout, undefined, "dining", { categories: [] }, reason), /at least one category/);
  assert.equal(saveBlocker(layout, undefined, "dining", { categories: [], hidden: true }, reason), "", "hiding with no categories is allowed");
  assert.match(saveBlocker(layout, undefined, "dining", { categories: ["Dining"] }, "short"), /eight characters/);
  assert.match(saveBlocker(layout, OAC, "lunch", { categories: [...SERVICE_LAYOUT_SEED.lunch.categories] }, reason), /No changes/);
  assert.match(saveBlocker(layout, RCOA, "dining", { categories: [...SERVICE_LAYOUT_SEED.dining.categories] }, reason), /matches the company default/);
  assert.equal(saveBlocker(layout, RCOA, "dining", { categories: ["Dining", "Wine", "Drinks"] }, reason), "");
});

test("commands carry the expectedVersion of exactly the document written and the trimmed reason", () => {
  const layout = view([company({}, 4), site(RCOA, { dining: { categories: ["Dining", "Wine"] } }, 2)]);
  assert.deepEqual(setServiceCategoriesCommand(layout, undefined, "dining", { categories: ["Dining", "Drinks", "Wine"] }, "  Owner wants wine  "),
    { action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Drinks", "Wine"], expectedVersion: 4, reason: "Owner wants wine" });
  assert.deepEqual(setServiceCategoriesCommand(layout, RCOA, "lunch", { categories: ["Lunch"], hidden: true }, "Hide lunch here"),
    { action: "set-service-categories", serviceId: "lunch", categories: ["Lunch"], hidden: true, oplocId: RCOA, expectedVersion: 2, reason: "Hide lunch here" });
  assert.equal(setServiceCategoriesCommand(layout, OAC, "lunch", { categories: ["Lunch"] }, "First override here").expectedVersion, 0, "no stored site document = 0");
  assert.deepEqual(clearServiceOverrideCommand(layout, RCOA, "dining", "Back to company default"),
    { action: "clear-service-override", serviceId: "dining", oplocId: RCOA, expectedVersion: 2, reason: "Back to company default" });
});

test("source contracts: GET reads stored layout only, the editor uses only the existing commands and no browser dialogs", () => {
  const route = readFileSync(new URL("../app/api/hospitality-catalogue/route.ts", import.meta.url), "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.match(get, /attachServiceLayout/); assert.doesNotMatch(get, /republishAfterMutation|buildCataloguePackage|runCatalogueCommand/);
  const ui = readFileSync(new URL("../app/ui/HospitalityServiceLayout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /\balert\(|\bprompt\(|\bconfirm\(|dangerouslySetInnerHTML|localStorage/);
  assert.doesNotMatch(ui, /action: "(create-item|update-item|set-default-price|set-site-override|set-site-availability)"/);
  const mount = readFileSync(new URL("../app/ui/HospitalityCatalogue.tsx", import.meta.url), "utf8");
  assert.match(mount, /<HospitalityServiceLayout payload=\{payload\} canManage=\{canManage\}/);
  assert.match(ui, /disabled=\{disabled\}/); assert.match(ui, /aria-label=\{`\$\{category\} in \$\{entry\.label\}`\}/);
});
