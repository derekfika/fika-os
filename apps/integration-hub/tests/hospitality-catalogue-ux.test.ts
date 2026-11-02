import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildServiceLayoutView, setServiceCategoriesCommand } from "../lib/hospitality-catalogue-types";
import { CATALOGUE_TABS, categoryItems, guidedBlocker, guidedChange, guidedDraft, impactLines, impactSentence, itemServiceVisibility, otherServices, scopePhrase } from "../app/ui/hospitality-catalogue-ux/model";

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
test("catalogue exposes Items | Booking Services tabs instead of the hidden disclosure", () => {
  const source = read("app/ui/HospitalityCatalogue.tsx");
  assert.deepEqual(CATALOGUE_TABS.map(t => t.label), ["Items", "Booking Services"]);
  assert.ok(!source.includes("Booking service categories"));
  assert.ok(!source.includes("layoutOpen"));
  assert.match(source, /role="tablist"/); assert.match(source, /role="tab"/); assert.match(source, /role="tabpanel"/);
  assert.match(source, /<ServiceCategoryGuide /); assert.match(source, /onManageServices/);
  assert.match(source, /Manage booking services for/);
});

test("guided editor uses only the governed command and has no alert/prompt or hard coded counts", () => {
  const source = read("app/ui/hospitality-catalogue-ux/ServiceCategoryGuide.tsx");
  assert.match(source, /setServiceCategoriesCommand/);
  assert.ok(!/\b(alert|prompt|confirm)\(/.test(source));
  assert.ok(!/\b11\b/.test(source));
  assert.match(source, /scopePhrase/); assert.match(source, /Reason for the change/);
});
