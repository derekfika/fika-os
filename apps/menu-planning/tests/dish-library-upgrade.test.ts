import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { MenuItem } from "../lib/domain";
import { addTag, emptyDishTagRegistry, type DishTagRegistry } from "../lib/dish-tags";
import { applyAssignment, checkPublishedReferences, planLibraryUpgrade, resolveAssignmentTags, unexpectedChanges } from "../lib/dish-library-upgrade";

const AT = "2026-10-30T20:00:00.000Z";
const registry: DishTagRegistry = [
  { label: "Chicken", group: "type" },
  { label: "Indian", group: "cuisine" },
  { label: "Spiced", group: "style" },
].reduce((current, input) => addTag(current, input, "seed", AT).registry, emptyDishTagRegistry());

const dish = (id: string, name: string, over: Partial<MenuItem> = {}) => ({
  canonicalId: id, sourceName: name, displayName: name, category: "Hot Main", weekId: "w", dayId: "", sourceReference: { workbook: "x", sheet: "y" }, revision: 1, reviewStatus: "unreviewed",
  allergenEvidence: [{ allergen: "milk", value: "contains", source: "review" }], mayContainReviewed: true, audit: [], ...over,
}) as unknown as MenuItem;

test("assignment words resolve only to registry tags; unknown words are reported, never invented", () => {
  const result = resolveAssignmentTags({ type: ["Chicken", "Hot Main"], cuisine: ["Indian", "Somali-inspired"], style: ["Spiced"], occasion: [] }, registry);
  assert.deepEqual(result.tagIds, ["dish-tag:type:chicken", "dish-tag:cuisine:indian", "dish-tag:style:spiced"]);
  assert.deepEqual(result.skipped, ["type:Hot Main", "cuisine:Somali-inspired"]);
});

test("applying an assignment adds tags, a salad's slot and an audit line and changes nothing else", () => {
  const base = dish("d1", "Chicken Tikka", { sourceAliases: ["Tikka"] });
  const { item, tagsApplied } = applyAssignment(base, { confidence: "High", type: ["Chicken"], cuisine: ["Indian"] }, registry, "upgrade", AT);
  assert.deepEqual(item.tagIds, ["dish-tag:type:chicken", "dish-tag:cuisine:indian"]);
  assert.equal(tagsApplied, 2);
  assert.deepEqual(unexpectedChanges(base, item), []);
  assert.deepEqual(item.allergenEvidence, base.allergenEvidence);
  assert.deepEqual(item.sourceAliases, ["Tikka"]);
  assert.equal(item.canonicalId, "d1");
  assert.equal(item.audit.at(-1)?.action, "dish-library-upgrade-tags");
  const salad = applyAssignment(dish("s1", "Baby leaves", { category: "Salad" }), { confidence: "High", subtype: "Leaf" }, registry, "upgrade", AT);
  assert.equal(salad.item.subcategory, "Leaf");
  const notSalad = applyAssignment(dish("h1", "Stew"), { confidence: "High", subtype: "Leaf" }, registry, "upgrade", AT);
  assert.equal(notSalad.item.subcategory, undefined, "a salad slot is only ever set on a Salad");
  const unassigned = applyAssignment(dish("s2", "Mystery", { category: "Salad" }), { confidence: "Medium", subtype: "" }, registry, "upgrade", AT);
  assert.equal(unassigned.item.subcategory, undefined, "an unclassified salad stays unclassified");
});

test("Low-confidence (suspected test) dishes and dishes with no assignment are left exactly as they are", () => {
  const base = dish("t1", "Thursday Dish");
  assert.equal(applyAssignment(base, { confidence: "Low", type: ["Chicken"] }, registry, "u", AT).item, base);
  assert.equal(applyAssignment(base, undefined, registry, "u", AT).item, base);
});

test("the plan replaces overlapping dishes, adds new ones, archives old-only ones and deletes nothing", () => {
  const current = [dish("a", "A old", { revision: 5 }), dish("b", "B old"), dish("gone", "Only in staging", { revision: 2 }), dish("old-archived", "Already archived", { reviewStatus: "archived" })];
  const incoming = [dish("a", "A", { revision: 2 }), dish("c", "C new"), dish("b", "B")];
  const plan = planLibraryUpgrade({ current, incoming, assignments: { a: { confidence: "High", type: ["Chicken"] } }, registry, actor: "u", at: AT });
  const byId = new Map(plan.items.map((item) => [item.canonicalId, item]));
  assert.equal(byId.get("a")?.displayName, "A");
  assert.equal(byId.get("a")?.revision, 6, "outranks the old copy so the writer accepts it");
  assert.deepEqual(byId.get("a")?.tagIds, ["dish-tag:type:chicken"]);
  assert.equal(byId.get("c")?.revision, 1);
  assert.equal(byId.get("gone")?.reviewStatus, "archived");
  assert.equal(byId.get("gone")?.displayName, "Only in staging", "an old-only dish keeps its name and ID");
  assert.equal(byId.get("gone")?.revision, 3);
  assert.equal(byId.has("old-archived"), false, "an already-archived old dish needs no write");
  assert.deepEqual(plan.stats, { ...plan.stats, current: 4, incoming: 3, replaced: 2, added: 1, carriedArchived: 1, alreadyArchived: 1, tagged: 1, tagsApplied: 1, subtypesApplied: 0 });
  for (const item of current.filter((old) => old.reviewStatus !== "archived")) assert.ok(byId.has(item.canonicalId), `${item.canonicalId} must survive`);
});

test("an old-only dish that a published menu uses stays active and unchanged instead of being archived", () => {
  const current = [dish("pub", "Published only here"), dish("plain", "Not published")];
  const plan = planLibraryUpgrade({ current, incoming: [dish("n", "New")], assignments: {}, registry, actor: "u", at: AT, keepActiveIds: new Set(["pub"]) });
  const byId = new Map(plan.items.map((item) => [item.canonicalId, item]));
  assert.equal(byId.get("pub"), current[0], "the very same record: no revision bump, no write needed");
  assert.equal(byId.get("plain")?.reviewStatus, "archived");
  assert.deepEqual(plan.stats.retainedForPublished, ["pub"]);
  assert.equal(plan.stats.carriedArchived, 1);
  assert.deepEqual(checkPublishedReferences([{ publicationId: "p", weekCommencing: "2026-11-02", date: "2026-11-03", slot: "SOUP", dishId: "pub", dishName: "Published only here" }], plan.items, "2026-11-02"), []);
});

test("the plan reports unmatched assignments, skipped tag words and active-name collisions", () => {
  const incoming = [dish("a", "Same Name"), dish("b", "same name")];
  const plan = planLibraryUpgrade({ current: [], incoming, assignments: { a: { confidence: "High", type: ["Hot Main"] }, ghost: { confidence: "High", type: ["Chicken"] }, lowghost: { confidence: "Low" } }, registry, actor: "u", at: AT });
  assert.deepEqual(plan.stats.unmatchedAssignments, ["ghost"]);
  assert.deepEqual(plan.stats.skippedTagWords, { "type:Hot Main": 1 });
  assert.equal(plan.nameCollisions.length, 1);
  assert.match(plan.nameCollisions[0], /same name: a, b/);
});

test("only intended fields may differ from the source dish", () => {
  const before = dish("a", "A");
  assert.deepEqual(unexpectedChanges(before, { ...before, tagIds: ["x"], subcategory: "Leaf", revision: 9, reviewStatus: "archived", audit: [{ action: "x", at: AT, by: "u" }] }), []);
  assert.deepEqual(unexpectedChanges(before, { ...before, displayName: "Renamed", category: "Soup" }), ["displayName", "category"]);
  assert.deepEqual(unexpectedChanges(before, { ...before, allergenEvidence: [] }), ["allergenEvidence"]);
});

test("published dishes from the cutoff on must stay active with the same ID; removed, archived or merged ones block", () => {
  const finalItems = [dish("keep", "Keep"), dish("arch", "Archived Dish", { reviewStatus: "archived" }), dish("heir", "Merged Heir", { sourceAliases: ["Old Merged Name"] }), dish("twin", "Twin Name")];
  const ref = (dishId: string, dishName: string, date = "2026-11-03") => ({ publicationId: "p1", weekCommencing: "2026-11-02", date, slot: "SALAD 1", dishId, dishName });
  const problems = checkPublishedReferences([ref("keep", "Keep"), ref("arch", "Archived Dish"), ref("gone", "Totally Gone"), ref("old-merged", "Old Merged Name"), ref("old-twin", "twin name"), ref("past", "Past", "2026-10-01")], finalItems, "2026-11-02");
  assert.deepEqual(problems.map((problem) => [problem.dishId, problem.problem]), [["arch", "archived"], ["gone", "missing"], ["old-merged", "possibly-merged"], ["old-twin", "possibly-merged"]]);
  assert.match(problems[2].detail, /Merged Heir/);
  assert.deepEqual(checkPublishedReferences([ref("keep", "Keep")], finalItems, "2026-11-02"), []);
  assert.deepEqual(checkPublishedReferences([ref("gone", "Gone", "2026-10-31")], finalItems, "2026-11-02"), [], "dates before the cutoff are history");
});

const script = readFileSync(new URL("../scripts/replace-dish-library.ts", import.meta.url), "utf8");

test("the upgrade script is staging-only, dry-run by default, archives before it writes and never deletes", () => {
  assert.match(script, /const STAGING_PROJECT = "fika-os-dev"/);
  assert.match(script, /project !== STAGING_PROJECT/);
  assert.match(script, /if \(!execute \|\| blocked\)/);
  assert.match(script, /keepActiveIds/);
  assert.ok(script.indexOf("archiveRoot.set(") < script.indexOf("upsertCatalogueItemsInChunks(plan.items"), "archive completes before the library is written");
  assert.match(script, /Archive incomplete/);
  assert.match(script, /refusing to overwrite it/);
  assert.doesNotMatch(script, /\.delete\(|batch\.delete|recursiveDelete/);
  assert.match(script, /blocked = plan\.nameCollisions\.length > 0 \|\| problems\.length > 0 \|\| unexpected\.length > 0/);
});
