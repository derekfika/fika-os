import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateBulkSpec, MAX_BULK_ITEMS, type BulkSpec } from "../lib/hospitality-catalogue-admin";
import { buildCataloguePayload } from "../lib/hospitality-catalogue-read-model";
import { EMPTY_FILTERS, bulkImpact, categoryVisibilityCheck, pruneSelection, rowMatches, selectAllShown, selectableSites, sitesSummary, toggleSelection } from "../lib/hospitality-catalogue-view";
import { buildServiceLayoutView, type CataloguePayload, type CatalogueRow } from "../lib/hospitality-catalogue-types";
import { SERVICE_IDS } from "@fika/server-shared/hospitality-service-layout";
import type { CanonicalRecord } from "../lib/types";

const wrap = (entityType: string, canonicalId: string, record: Record<string, unknown>) => ({ canonicalId, entityType, record: { version: 1, canonicalId, ...record }, dataHash: "x", lifecycleStatus: "published", publicationStatus: "published" }) as unknown as CanonicalRecord;
const sites: CataloguePayload["oplocs"] = [
  { oplocId: "oploc:a", label: "Alpha", active: true }, { oplocId: "oploc:b", label: "Bravo", active: true }, { oplocId: "oploc:c", label: "Charlie", active: true },
  { oplocId: "oploc:old", label: "Old Site", active: false }, { oplocId: "oploc:other", label: "Not Hospitality", active: true },
];
const row = (name: string, extra: Partial<CatalogueRow> = {}): CatalogueRow => ({ itemId: `hospitality-menu-item:${name}`, version: 1, name, category: "Drinks", description: "", status: "active", routing: { state: "cpu_hospitality", workstreams: ["hospitality"], version: 1 }, offerings: [], availableAt: [], unavailableAt: [], overrideCount: 0, needsReview: [], sourceIds: [], providerMappings: [], dietaryInformation: [], allergenInformation: [], priceMigration: { status: "not_needed" }, ...extra });

test("Select all sites means every ACTIVE OPLOC (all active FIKA locations are Hospitality-capable); inactive ones are excluded", () => {
  assert.deepEqual(selectableSites(sites).map(site => site.oplocId), ["oploc:a", "oploc:b", "oploc:c", "oploc:other"]);
  assert.deepEqual(selectableSites([]), []);
});

test("availability reads All sites unless sparse exceptions exclude some", () => {
  const all = ["oploc:a", "oploc:b", "oploc:c", "oploc:other"];
  assert.equal(sitesSummary(row("x", { availableAt: all, unavailableAt: [] }), sites), "All sites");
  assert.equal(sitesSummary(row("x", { availableAt: all.slice(1), unavailableAt: ["oploc:a"] }), sites), "All sites except Alpha");
  assert.equal(sitesSummary(row("x", { availableAt: ["oploc:c"], unavailableAt: ["oploc:a", "oploc:b", "oploc:other"] }), sites), "1 of 4 sites");
  assert.equal(sitesSummary(row("x", { availableAt: [] }), sites), "Not available anywhere");
  assert.equal(sitesSummary(row("x", { status: "archived", availableAt: all }), sites), "Not available anywhere", "an archived Item is available nowhere");
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
  const rows = [row("A", { availableAt: ["oploc:b", "oploc:c", "oploc:other"], unavailableAt: ["oploc:a"] }), row("B", { routing: { state: "in_house", workstreams: [], version: 1 } }), row("C", { routing: { state: "routing_required", workstreams: [], version: 0 } })];
  const lines = bulkImpact({ production: "in_house", price: { amount: 4.5 }, sites: { mode: "add", oplocIds: ["oploc:a", "oploc:b"] } }, rows, sites);
  const text = (label: string) => lines.find(line => line.label === label)?.value ?? "";
  assert.match(text("Production"), /2 items → No CPU \/ In house \(1 already set\)/);
  assert.ok(lines.some(line => line.label === "Mixed current routes" && line.tone === "warning"));
  assert.match(text("Price"), /Set company default to £4\.50 on 3 items/); assert.equal(text("Minimum"), "Unchanged");
  assert.match(text("Site availability"), /Add Alpha, Bravo: 1 exception cleared/); assert.match(text("Site availability"), /Nothing new is stored/); assert.equal(text("Existing site overrides"), "Preserved");
  const removal = bulkImpact({ sites: { mode: "remove", oplocIds: ["oploc:a"] } }, rows, sites).find(line => line.label === "Site availability")!;
  assert.equal(removal.tone, "danger"); assert.match(removal.value, /2 site exceptions recorded as unavailable \(overrides and history kept\)/);
  const everything = bulkImpact({ sites: { mode: "replace", oplocIds: ["oploc:a", "oploc:b", "oploc:c", "oploc:other"] } }, rows, sites).find(line => line.label === "Site availability")!;
  assert.match(everything.value, /available at ALL 4 sites/); assert.match(everything.value, /no per-site records are created/); assert.equal(everything.tone, undefined, "selecting all sites is not destructive");
  const replace = bulkImpact({ sites: { mode: "replace", oplocIds: ["oploc:c"] } }, rows, sites).find(line => line.label === "Site availability")!; assert.match(replace.value, /8 site exceptions recorded for the 3 sites left out/);
  const archive = bulkImpact({ archive: true }, rows, sites); assert.equal(archive[0].tone, "danger"); assert.match(archive[0].value, /3 items will be archived/); assert.match(archive[0].value, /history are kept/);
  assert.match(bulkImpact({ minimum: { mode: "clear" } }, rows, sites).find(line => line.label === "Minimum")!.value, /Clear the company default/);
});

test("category review shows distinct old-to-target effects, confirms assessed changes and holds unknown mappings", () => {
  const selected = [row("A", { availableAt: ["oploc:a"] }), row("B", { category: "Food", availableAt: ["oploc:b"] })];
  const impact = bulkImpact({ category: "Drinks" }, selected, sites);
  assert.match(impact.find(line => line.label === "Category")!.value, /1 item: 1 Food → Drinks; 1 already match/);
  const layout = buildServiceLayoutView([], ["Drinks", "Food", "Breakfast"]);
  assert.equal(categoryVisibilityCheck(layout, [selected[0]], "Drinks", sites).safe, true, "same category is a no-op for visibility");
  const changing = categoryVisibilityCheck(layout, [selected[0]], "Breakfast", sites);
  assert.equal(changing.safe, true); assert.equal(changing.requiresConfirmation, true); assert.match(changing.changes[0], /: .* → Breakfast, Meeting hospitality/);
  const unknown = categoryVisibilityCheck(layout, [selected[0]], "Unmapped new category", sites);
  assert.equal(unknown.safe, false); assert.match(unknown.reason, /no visible service mapping/);
  const [first, second] = SERVICE_IDS;
  const additive = buildServiceLayoutView([{ scope: "company", version: 1, services: Object.fromEntries(SERVICE_IDS.map(id => [id, { categories: id === first ? ["Drinks", "New drinks"] : id === second ? ["New drinks"] : [] }])) }], ["Drinks", "New drinks"]);
  const reviewed = categoryVisibilityCheck(additive, [selected[0]], "New drinks", sites);
  assert.equal(reviewed.safe, true); assert.equal(reviewed.requiresConfirmation, true); assert.match(reviewed.changes[0], /Breakfast → Breakfast, Lunch/);
  assert.equal(categoryVisibilityCheck(undefined, [selected[0]], "Drinks", sites).safe, false, "missing #175 stored layout fails closed");
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
  assert.doesNotThrow(() => validateBulkSpec(spec({ category: " New category " })), "category-only is a valid operation");
  assert.throws(() => validateBulkSpec(spec({ category: "   " })), /Category must be text/);
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
  for (const text of ["Leave unchanged", "Add selected sites", "Remove selected sites", "Replace availability with selected sites", "Select all sites", "Clear all", "site", "Review changes", "Apply to ", "Existing site overrides"]) assert.ok(ui.includes(text) || readFileSync(`${process.cwd()}/lib/hospitality-catalogue-view.ts`, "utf8").includes(text), text);
  assert.match(ui, /useState<string\[\]>\(\(\) => selectableSites\(payload\.oplocs\)\.map/, "Add item defaults to every active Hospitality site from the live registry");
  assert.match(ui, /Archive \$\{rows\.length\} item/); assert.doesNotMatch(ui, /hard.?delete|\.delete\(/i);
  assert.match(ui, /canManage && chosen\.size > 0/, "bulk controls only for managers");
  assert.doesNotMatch(ui, /window\.(alert|confirm|prompt)/); assert.doesNotMatch(ui, /firebase|firestore/i);
  assert.match(ui, /disabled=\{disabled \|\| value\.length === sites\.length\}/);
  const css = readFileSync(`${process.cwd()}/app/ui/HospitalityCatalogue.css`, "utf8");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(/); assert.match(css, /\.hc-bulkbar \{ position: sticky/);
});
