import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateBulkSpec, MAX_BULK_ITEMS, type BulkSpec } from "../lib/hospitality-catalogue-admin";
import { buildCataloguePayload } from "../lib/hospitality-catalogue-read-model";
import { EMPTY_FILTERS, bulkImpact, pruneSelection, rowMatches, selectAllShown, selectableSites, sitesSummary, toggleSelection } from "../lib/hospitality-catalogue-view";
import type { CataloguePayload, CatalogueRow } from "../lib/hospitality-catalogue-types";
import type { CanonicalRecord } from "../lib/types";

const wrap = (entityType: string, canonicalId: string, record: Record<string, unknown>) => ({ canonicalId, entityType, record: { version: 1, canonicalId, ...record }, dataHash: "x", lifecycleStatus: "published", publicationStatus: "published" }) as unknown as CanonicalRecord;
const sites: CataloguePayload["oplocs"] = [
  { oplocId: "oploc:a", label: "Alpha", active: true, hospitality: true }, { oplocId: "oploc:b", label: "Bravo", active: true, hospitality: true }, { oplocId: "oploc:c", label: "Charlie", active: true, hospitality: true },
  { oplocId: "oploc:old", label: "Old Site", active: false, hospitality: true }, { oplocId: "oploc:other", label: "Not Hospitality", active: true, hospitality: false },
];
const row = (name: string, extra: Partial<CatalogueRow> = {}): CatalogueRow => ({ itemId: `hospitality-menu-item:${name}`, version: 1, name, category: "Drinks", description: "", status: "active", routing: { state: "cpu_hospitality", workstreams: ["hospitality"], version: 1 }, offerings: [], availableAt: [], overrideCount: 0, needsReview: [], sourceIds: [], providerMappings: [], dietaryInformation: [], allergenInformation: [], priceMigration: { status: "not_needed" }, ...extra });

test("Select all sites covers only active Hospitality locations: inactive and non-Hospitality ones are excluded", () => {
  assert.deepEqual(selectableSites(sites).map(site => site.oplocId), ["oploc:a", "oploc:b", "oploc:c"]);
  assert.deepEqual(selectableSites([]), []);
});

test("availability shows All sites when every selectable site is offered, and stays compact otherwise", () => {
  assert.equal(sitesSummary(row("x", { availableAt: ["oploc:a", "oploc:b", "oploc:c"] }), sites), "All sites");
  assert.equal(sitesSummary(row("x", { availableAt: ["oploc:a", "oploc:b", "oploc:c", "oploc:old"] }), sites), "All sites", "a retired extra site does not hide All sites");
  assert.equal(sitesSummary(row("x", { availableAt: ["oploc:a"] }), sites), "Alpha");
  assert.equal(sitesSummary(row("x", { availableAt: ["oploc:a", "oploc:b"] }), sites), "Alpha, Bravo");
  assert.equal(sitesSummary(row("x", { availableAt: [] }), sites), "Not available anywhere");
  assert.equal(sitesSummary(row("x", { availableAt: ["oploc:a", "oploc:b", "oploc:other"] }), sites), "3 of 3 sites", "never claims All sites unless every selectable site is offered");
});

test("selection: individual, select all shown, clear, and it follows the active/archived filter", () => {
  const rows = [row("A"), row("B"), row("C"), row("Old", { status: "archived" })];
  const shownActive = rows.filter(r => rowMatches(r, EMPTY_FILTERS));
  assert.deepEqual([...selectAllShown(shownActive)].sort(), ["hospitality-menu-item:A", "hospitality-menu-item:B", "hospitality-menu-item:C"]);
  let selection: ReadonlySet<string> = toggleSelection(new Set(), "hospitality-menu-item:A"); assert.equal(selection.size, 1);
  selection = toggleSelection(selection, "hospitality-menu-item:A"); assert.equal(selection.size, 0, "toggle off");
  assert.equal(selectAllShown(rows).has("hospitality-menu-item:Old"), false, "archived rows are never swept into select-all, even if shown");
  const filtered = rows.filter(r => rowMatches(r, { ...EMPTY_FILTERS, query: "b" }));
  const kept = pruneSelection(new Set(["hospitality-menu-item:A", "hospitality-menu-item:B"]), filtered); assert.deepEqual([...kept], ["hospitality-menu-item:B"], "selection drops items that left the result set");
  assert.equal(pruneSelection(new Set(["hospitality-menu-item:Old"]), rows).size, 0, "an archived item cannot stay selected");
  assert.equal(selectAllShown([]).size, 0, "clear/none");
});

test("impact preview states exactly what will change, flags mixed routes, and always says overrides are preserved", () => {
  const rows = [row("A", { availableAt: ["oploc:a"] }), row("B", { routing: { state: "in_house", workstreams: [], version: 1 }, availableAt: ["oploc:a", "oploc:b"] }), row("C", { routing: { state: "routing_required", workstreams: [], version: 0 } })];
  const lines = bulkImpact({ production: "in_house", price: { amount: 4.5 }, sites: { mode: "add", oplocIds: ["oploc:a", "oploc:b"] } }, rows, sites);
  const text = (label: string) => lines.find(line => line.label === label)?.value ?? "";
  assert.match(text("Production"), /2 items → No CPU \/ In house \(1 already set\)/);
  assert.ok(lines.some(line => line.label === "Mixed current routes" && line.tone === "warning"));
  assert.match(text("Price"), /Set company default to £4\.50 on 3 items/); assert.equal(text("Minimum"), "Unchanged");
  assert.match(text("Site availability"), /Add Alpha, Bravo: 3 new offerings/); assert.equal(text("Existing site overrides"), "Preserved");
  const removal = bulkImpact({ sites: { mode: "remove", oplocIds: ["oploc:a"] } }, rows, sites).find(line => line.label === "Site availability")!;
  assert.equal(removal.tone, "danger"); assert.match(removal.value, /2 offerings disabled \(overrides and history kept\)/);
  const replace = bulkImpact({ sites: { mode: "replace", oplocIds: ["oploc:c"] } }, rows, sites).find(line => line.label === "Site availability")!; assert.match(replace.value, /3 offerings added, 3 offerings disabled/);
  const archive = bulkImpact({ archive: true }, rows, sites); assert.equal(archive[0].tone, "danger"); assert.match(archive[0].value, /3 items will be archived/); assert.match(archive[0].value, /history are kept/);
  assert.match(bulkImpact({ minimum: { mode: "clear" } }, rows, sites).find(line => line.label === "Minimum")!.value, /Clear the company default/);
});

test("bulk spec validation: every field opt-in, bounded, archive exclusive, no empty site list", () => {
  const spec = (extra: Partial<BulkSpec>): BulkSpec => ({ operationId: "operation-12345", itemIds: ["hospitality-menu-item:a"], expectedVersions: { "hospitality-menu-item:a": 1 }, ...extra });
  assert.throws(() => validateBulkSpec(spec({})), /Choose at least one change/);
  assert.throws(() => validateBulkSpec(spec({ itemIds: [], production: "in_house" })), /Select at least one item/);
  assert.throws(() => validateBulkSpec(spec({ itemIds: Array.from({ length: MAX_BULK_ITEMS + 1 }, (_, i) => `hospitality-menu-item:${i}`), production: "in_house" })), /limited to/);
  assert.throws(() => validateBulkSpec(spec({ archive: true, production: "in_house" })), /cannot be combined/);
  assert.throws(() => validateBulkSpec(spec({ sites: { mode: "replace", oplocIds: [] } })), /at least one site/);
  assert.throws(() => validateBulkSpec(spec({ price: { amount: 1.234 } })), /two decimal places/);
  assert.throws(() => validateBulkSpec(spec({ minimum: { mode: "set", value: 0 } })), /whole number/);
  assert.throws(() => validateBulkSpec(spec({ production: "nonsense" as never })), /four production routes/);
  assert.deepEqual(validateBulkSpec(spec({ itemIds: ["hospitality-menu-item:b", "hospitality-menu-item:a", "hospitality-menu-item:a"], production: "in_house" })), ["hospitality-menu-item:a", "hospitality-menu-item:b"], "de-duplicated, deterministic order");
  assert.doesNotThrow(() => validateBulkSpec(spec({ minimum: { mode: "clear" } })));
});

test("post-canonicalisation counts and copy: 47 active, 42 archived, no stale per-site-copy message", () => {
  const items = Array.from({ length: 47 }, (_, i) => wrap("Hospitality Menu Item", `hospitality-menu-item:mnk:item${i}`, { name: `Item ${i}`, category: "Food", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: "mnk", sourceItemId: `item${i}` }] }))
    .concat(Array.from({ length: 42 }, (_, i) => wrap("Hospitality Menu Item", `hospitality-menu-item:rcoa:old${i}`, { name: `Old ${i}`, category: "Food", lifecycleState: "archived", dietaryInformation: [], allergenInformation: [], providerMappings: [] })));
  const payload = buildCataloguePayload({ items, offerings: [], prices: [], routing: [], today: "2026-10-17" }, sites, true);
  assert.equal(payload.counts.active, 47); assert.equal(payload.counts.archived, 42); assert.equal(payload.rows.length, 89);
  assert.equal(payload.canonicalisation.itemsAwaitingConsolidation, 0, "survivors keep their legacy ids but nothing is awaiting consolidation");
  const ui = readFileSync(`${process.cwd()}/app/ui/HospitalityCatalogue.tsx`, "utf8");
  assert.doesNotMatch(ui, /still separate per-site copies/);
  assert.match(ui, /active items/); assert.match(ui, /historical item records were archived during catalogue consolidation/);
  assert.doesNotMatch(ui, /\{visible\.length\} of \{rows\.length\} items shown/, "never 47 of 89");
  assert.match(ui, /Archived <strong>/, "archived chip");
});

test("UI contract: selection column, bulk bar, Leave unchanged defaults, modes, picker controls, impact preview and Add item default", () => {
  const ui = readFileSync(`${process.cwd()}/app/ui/HospitalityCatalogue.tsx`, "utf8");
  assert.match(ui, /Select all \$\{selectableShown\.length\} filtered items/); assert.match(ui, /aria-label="Bulk actions"/); assert.match(ui, /Clear selection/);
  for (const text of ["Leave unchanged", "Add selected sites", "Remove selected sites", "Replace availability with selected sites", "Select all sites", "Clear all", "Hospitality site", "Review changes", "Apply to ", "Existing site overrides"]) assert.ok(ui.includes(text) || readFileSync(`${process.cwd()}/lib/hospitality-catalogue-view.ts`, "utf8").includes(text), text);
  assert.match(ui, /useState<string\[\]>\(\(\) => selectableSites\(payload\.oplocs\)\.map/, "Add item defaults to every active Hospitality site from the live registry");
  assert.match(ui, /Archive \$\{rows\.length\} item/); assert.doesNotMatch(ui, /hard.?delete|\.delete\(/i);
  assert.match(ui, /canManage && chosen\.size > 0/, "bulk controls only for managers");
  assert.doesNotMatch(ui, /window\.(alert|confirm|prompt)/); assert.doesNotMatch(ui, /firebase|firestore/i);
  assert.match(ui, /disabled=\{disabled \|\| value\.length === sites\.length\}/);
  const css = readFileSync(`${process.cwd()}/app/ui/HospitalityCatalogue.css`, "utf8");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(/); assert.match(css, /\.hc-bulkbar \{ position: sticky/);
});
