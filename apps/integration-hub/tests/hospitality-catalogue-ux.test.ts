import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildServiceLayoutView, setServiceCategoriesCommand } from "../lib/hospitality-catalogue-types";
import { CATALOGUE_TABS, categoryItems, guidedBlocker, guidedChange, guidedDraft, impactLines, impactSentence, itemServiceVisibility, manageServicesContext, otherServices, scopePhrase } from "../app/ui/hospitality-catalogue-ux/model";

const RCOA = "oploc-rcoa";
const view = buildServiceLayoutView([
  { scope: "company", version: 3, services: { dining: { categories: ["Dining", "Drinks"] }, breakfast: { categories: ["Breakfast"] } } },
], ["Dining", "Drinks", "Wine", "Breakfast"]);
const item = (name: string, category: string, availableAt: string[], status = "active") => ({ name, category, status: status as "active", availableAt });
const rows = [item("Red A", "Wine", [RCOA]), item("Red B", "Wine", [RCOA]), item("White C", "Wine", ["oploc-other"]), item("Old", "Wine", [RCOA], "archived"), item("Cola", "Drinks", [RCOA])];

test("wine impact is derived from live rows, not hard coded", () => {
  const draft = guidedDraft(view, RCOA, "dining", "Wine", true);
  const change = guidedChange(view, RCOA, "dining", draft.categories);
  assert.deepEqual(change.added, ["Wine"]); assert.deepEqual(change.removed, []);
  assert.equal(change.createsOverride, true); assert.equal(change.source, "company");
  const { lines } = impactLines(rows, change, RCOA, "RCoA", "Dining");
  assert.equal(lines[0].orderable, 2); assert.equal(lines[0].notPermitted, 1); // archived excluded; other-site item not permitted
  assert.match(impactSentence(lines[0], "RCoA", "Dining"), /2 items will appear in RCoA Dining\..*1 item in this category is not permitted at RCoA/);
  const more = impactLines([...rows, item("Rose", "Wine", [RCOA])], change, RCOA, "RCoA", "Dining").lines[0];
  assert.equal(more.orderable, 3);
});

test("the change only ever targets the chosen site and service; Breakfast is never touched", () => {
  const draft = guidedDraft(view, RCOA, "dining", "Wine", true);
  const command = setServiceCategoriesCommand(view, RCOA, "dining", draft, " Add wine for RCoA dinners ");
  assert.equal(command.action, "set-service-categories"); assert.equal(command.serviceId, "dining"); assert.equal(command.oplocId, RCOA);
  assert.deepEqual(command.categories, ["Dining", "Drinks", "Wine"]); assert.equal(command.expectedVersion, 0); assert.equal(command.reason, "Add wine for RCoA dinners");
  assert.ok(!otherServices("dining").includes("Dining")); assert.ok(otherServices("dining").includes("Breakfast"));
  const breakfast = guidedChange(view, RCOA, "breakfast", guidedDraft(view, RCOA, "breakfast", "Breakfast", true).categories);
  assert.equal(breakfast.changed, false); assert.ok(!breakfast.after.includes("Wine"));
});

test("scope phrase is exact and unticking removes", () => {
  assert.equal(scopePhrase("RCoA", "dining"), "Only RCoA Dining");
  const removed = guidedChange(view, RCOA, "dining", guidedDraft(view, RCOA, "dining", "Drinks", false).categories);
  assert.deepEqual(removed.removed, ["Drinks"]);
});

test("save is blocked until change, reason and scope confirmation are all present", () => {
  const change = guidedChange(view, RCOA, "dining", ["Dining", "Drinks", "Wine"]);
  assert.match(guidedBlocker(guidedChange(view, RCOA, "dining", ["Dining", "Drinks"]), "long enough reason", true), /Choose a category/);
  assert.match(guidedBlocker(change, "short", true), /eight characters/);
  assert.match(guidedBlocker(change, "long enough reason", false), /confirm the scope/);
  assert.equal(guidedBlocker(change, "long enough reason", true), "");
  assert.match(guidedBlocker(guidedChange(view, RCOA, "dining", []), "long enough reason", true), /at least one category/);
});

test("site override is reported and a site override changes the baseline", () => {
  const withOverride = { ...view, sites: { [RCOA]: { version: 2, services: { dining: { categories: ["Dining", "Wine"] } } } } };
  const change = guidedChange(withOverride, RCOA, "dining", ["Dining"]);
  assert.equal(change.source, "site"); assert.equal(change.createsOverride, false); assert.deepEqual(change.removed, ["Wine"]);
  assert.equal(setServiceCategoriesCommand(withOverride, RCOA, "dining", { categories: ["Dining"] }, "reason text").expectedVersion, 2);
});

test("item inspector shows effective services per permitted site", () => {
  const withOverride = { ...view, sites: { [RCOA]: { version: 1, services: { dining: { categories: ["Dining", "Wine"] } } } } };
  const [site] = itemServiceVisibility(withOverride, rows[0], [RCOA]);
  assert.deepEqual(site.shownIn.map(s => s.serviceId), ["dining"]);
  assert.ok(site.notShownIn.some(s => s.serviceId === "breakfast"));
  const [none] = itemServiceVisibility(view, rows[0], [RCOA]);
  assert.equal(none.shownIn.length, 0);
  assert.deepEqual(itemServiceVisibility(undefined, rows[0], [RCOA]), []);
  assert.equal(categoryItems(rows, "Wine", RCOA).orderable.length, 2);
});

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
test("catalogue exposes Overview, Items, Services and Locations as first-class tabs", () => {
  const source = read("app/ui/HospitalityCatalogue.tsx");
  const styles = read("app/ui/HospitalityCatalogue.css");
  assert.deepEqual(CATALOGUE_TABS.map(t => t.id), ["overview", "items", "services", "locations"]);
  assert.deepEqual(CATALOGUE_TABS.map(t => t.label), ["Overview", "Items", "Services", "Locations"]);
  assert.match(source, /role="tablist"/); assert.match(source, /role="tab"/); assert.match(source, /role="tabpanel"/);
  assert.match(source, /useState<CatalogueTab>\("overview"\)/);
  assert.match(source, /catalogueTab/); assert.match(source, /popstate/);
  assert.match(source, /HospitalityCatalogueOverview/); assert.match(source, /HospitalityCatalogueServices/);
  assert.match(source, /onManageServices/);
  assert.match(source, /Manage booking services for/);
  assert.match(styles, /\.hc \.scg-tabs\s*\{/);
  assert.match(styles, /\.hc \.scg-tab\s*\{/);
  assert.match(styles, /\.hc \.scg-tab:hover:not\(\[aria-selected="true"\]\)/);
  assert.match(styles, /\.hc \.scg-tab:focus-visible/);
  assert.match(styles, /\.hc-btn--primary\s*\{\s*min-height:\s*var\(--control-height\)/);
  assert.match(styles, /\.hco-card-copy small, \.hco-attention-list li p, \.hco-how li small\) \{ font-size: var\(--text-sm\); line-height: 1\.45; \}/);
  assert.match(source, /import "\.\/HospitalityCatalogue\.css"/);
  assert.doesNotMatch(source, /<small>\{entry\.hint\}<\/small>/);
  assert.doesNotMatch(source, /ServiceCategoryGuide\.css/);
  assert.match(source, /<h2 className="hc-overview-title">Catalogue at a glance<\/h2>/);
  assert.match(styles, /\.hc-overview-tab \.hco-header h2/);
  assert.match(source, /<h1 id="hc-title">Hospitality Catalogue<\/h1>/);
});

test("bulk editor separates Item category, customer service visibility, routing, sites and defaults", () => {
  const source = read("app/ui/HospitalityCatalogue.tsx");
  assert.match(source, /aria-labelledby="hc-bulk-category-title"/);
  assert.match(source, /aria-labelledby="hc-bulk-services-title"/);
  assert.match(source, /aria-labelledby="hc-bulk-production-title"/);
  assert.match(source, /aria-labelledby="hc-bulk-sites-title"/);
  assert.match(source, /Current categories:/);
  assert.match(source, /Current prices:/);
  assert.match(source, /Current minima:/);
  assert.match(source, /Review changes/);
  assert.match(source, /Review all \{categoryCheck\.changes\.length\} site visibility effect/);
});

test("Item inspector summarizes company and site values without claiming orderability", () => {
  const source = read("app/ui/HospitalityCatalogue.tsx");
  assert.match(source, /Item summary/);
  assert.match(source, /Effective values at locations with item exceptions/);
  assert.match(source, /Site permission/);
  assert.match(source, /RCoA reads service visibility from its verified published catalogue package/);
  assert.doesNotMatch(source, /Current booking portals do not consume that layout/);
});

test("guided editor uses only the governed command and has no alert/prompt or hard coded counts", () => {
  const source = read("app/ui/hospitality-catalogue-ux/ServiceCategoryGuide.tsx");
  assert.match(source, /setServiceCategoriesCommand/);
  assert.ok(!/\b(alert|prompt|confirm)\(/.test(source));
  assert.ok(!/\b11\b/.test(source));
  assert.match(source, /scopePhrase/); assert.match(source, /Reason for the change/);
});

test("Manage booking services never preselects a service", () => {
  const context = manageServicesContext(RCOA, "Wine");
  assert.deepEqual(context, { oplocId: RCOA, category: "Wine" });
  assert.equal("serviceId" in context, false);
  assert.deepEqual(manageServicesContext(RCOA, "Wine", "hospitality-menu-item:red-a"), { oplocId: RCOA, category: "Wine", itemId: "hospitality-menu-item:red-a" });
  assert.ok(!/serviceId:\s*site\.notShownIn/.test(read("app/ui/HospitalityCatalogue.tsx")));
});

test("untick then retick is not a change and keeps the stored order", () => {
  const off = guidedDraft(view, RCOA, "dining", "Dining", false).categories;
  const back = guidedDraft(view, RCOA, "dining", "Dining", true, off).categories;
  assert.deepEqual(back, ["Dining", "Drinks"]);
  assert.equal(guidedChange(view, RCOA, "dining", back).changed, false);
  assert.equal(guidedChange(view, RCOA, "dining", ["Drinks", "Dining"]).changed, false); // order alone is not a change
});

test("status and conflict notices live in the parent so they survive the reload remount", () => {
  const source = read("app/ui/hospitality-catalogue-ux/ServiceCategoryGuide.tsx");
  assert.match(source, /const \[notice, setNotice\] = useState/);
  assert.ok(!/const \[status, setStatus\] = useState/.test(source));
});
