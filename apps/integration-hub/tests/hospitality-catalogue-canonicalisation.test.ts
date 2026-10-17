import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyOperations, buildCanonicalisationPlan, existingCandidatesForNewItem, inventory, isActiveItem, routingReviewRows, verifyMergeInvariants, type CatalogueSnapshot } from "../lib/hospitality-catalogue-canonicalisation";
import { localMnkMenuCatalogue, localRcoaMenuCatalogue } from "@fika/server-shared/hospitality-catalogue";
import { hospitalityPortalReadFromRecords } from "../lib/hospitality-catalogue-service";
import type { CanonicalRecord } from "../lib/types";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const OPLOC = { mnk: "oploc:mnk-0001", rcoa: "oploc:rcoa-001", cfc: "oploc:cfc-0001" } as const;
type Site = keyof typeof OPLOC;

const item = (site: Site, slug: string, over: Record<string, unknown> = {}): CanonicalRecord => ({
  canonicalId: `hospitality-menu-item:${site}:${slug}`, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "x",
  record: { name: slug.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()), category: "Breakfast", lifecycleState: "active", version: 1, dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: `${site}-source`, sourceItemId: slug }], ...over },
} as unknown as CanonicalRecord);
const offering = (site: Site, slug: string, over: Record<string, unknown> = {}): CanonicalRecord => ({
  canonicalId: `hospitality-menu-offering:${site}:${slug}`, entityType: "Hospitality Menu Offering", lifecycleStatus: "published", publicationStatus: "published", dataHash: "x",
  record: { hospitalityMenuItemId: `hospitality-menu-item:${site}:${slug}`, oplocId: OPLOC[site], offeringMode: "standard", lifecycleState: "active", version: 1, noticeRequiredDays: site === "mnk" ? 3 : 1, configuration: { servingInfo: `${site} serving`, sortOrder: 10 }, ...over },
} as unknown as CanonicalRecord);
const price = (site: Site, slug: string, amount: number): CanonicalRecord => ({ canonicalId: `hospitality-menu-price:${site}:${slug}`, entityType: "Hospitality Menu Price", lifecycleStatus: "published", record: { hospitalityMenuOfferingId: `hospitality-menu-offering:${site}:${slug}`, amount, vatRate: 0.2, lifecycleState: "active" } } as unknown as CanonicalRecord);

function twoSites(slugs: string[]): CatalogueSnapshot {
  return {
    items: slugs.flatMap(slug => [item("mnk", slug), item("rcoa", slug)]),
    offerings: slugs.flatMap(slug => [offering("mnk", slug), offering("rcoa", slug)]),
    prices: slugs.flatMap((slug, index) => [price("mnk", slug, 10 + index), price("rcoa", slug, 20 + index)]),
    routing: [],
  };
}

test("MNK and RCoA end up referencing the same canonical item, and the routing screen shows it once", () => {
  const before = twoSites(["bagel_box"]);
  assert.equal(routingReviewRows(before).length, 2);
  const plan = buildCanonicalisationPlan(before);
  assert.equal(plan.groups.length, 1); assert.equal(plan.review.length, 0);
  const after = applyOperations(before, plan.groups[0].operations);
  const rows = routingReviewRows(after);
  assert.equal(rows.length, 1); assert.equal(rows[0].name, "Bagel Box");
  assert.deepEqual(rows[0].offeredAt, [OPLOC.mnk, OPLOC.rcoa].sort());
  const itemIds = new Set(after.offerings.map(o => o.record.hospitalityMenuItemId));
  assert.equal(itemIds.size, 1);
  assert.deepEqual(verifyMergeInvariants(before, after), []);
});

test("site-specific price, availability and lead time stay independent after canonicalisation", () => {
  const before = twoSites(["bagel_box"]);
  const plan = buildCanonicalisationPlan(before);
  assert.equal(plan.groups[0].defaults.state, "operator_required", "differing site prices: no default is guessed");
  const after = applyOperations(before, plan.groups[0]?.operations ?? []);
  const mnk = after.offerings.find(o => o.record.oplocId === OPLOC.mnk)!; const rcoa = after.offerings.find(o => o.record.oplocId === OPLOC.rcoa)!;
  assert.equal(rcoa.record.lifecycleState, "active"); assert.equal(mnk.record.lifecycleState, "active");
  assert.equal(mnk.record.noticeRequiredDays, 3); assert.equal(rcoa.record.noticeRequiredDays, 1);
  assert.deepEqual(after.prices!.map(p => [p.canonicalId, p.record.amount]), before.prices!.map(p => [p.canonicalId, p.record.amount]));
  assert.notEqual(after.prices!.find(p => p.canonicalId.includes(":mnk:"))!.record.amount, after.prices!.find(p => p.canonicalId.includes(":rcoa:"))!.record.amount);
});

test("production routing is stored once and every site inherits it, including IDs that were merged away", () => {
  const before = twoSites(["mini_pastries"]); before.routing = [{ menuItemId: "hospitality-menu-item:rcoa:mini_pastries", workstreams: ["hospitality"] }];
  const plan = buildCanonicalisationPlan(before);
  assert.equal(plan.groups[0].survivorId, "hospitality-menu-item:rcoa:mini_pastries", "the item already carrying the routing decision survives");
  const after = applyOperations(before, plan.groups[0].operations);
  const rows = routingReviewRows(after); assert.equal(rows.length, 1); assert.deepEqual(rows[0].workstreams, ["hospitality"]);
  assert.ok(after.merges!.some(m => m.sourceMenuItemId === "hospitality-menu-item:mnk:mini_pastries" && m.survivorMenuItemId === "hospitality-menu-item:rcoa:mini_pastries"));
  assert.deepEqual(verifyMergeInvariants(before, after), []);
});

test("a routing decision on the item that does not survive is inherited, never dropped", () => {
  const before = twoSites(["bagel_box"]); before.routing = [{ menuItemId: "hospitality-menu-item:rcoa:bagel_box", workstreams: ["sandwiches"] }];
  // Give the unrouted MNK copy more offerings so it would normally survive; routing must still win.
  const plan = buildCanonicalisationPlan(before);
  const after = applyOperations(before, plan.groups[0].operations);
  assert.equal(routingReviewRows(after).filter(r => r.workstreams.join() === "sandwiches").length, 1);
  assert.deepEqual(verifyMergeInvariants(before, after), []);
});

test("conflicting routing decisions block the merge instead of picking a winner", () => {
  const before = twoSites(["bagel_box"]);
  before.routing = [{ menuItemId: "hospitality-menu-item:mnk:bagel_box", workstreams: ["sandwiches"] }, { menuItemId: "hospitality-menu-item:rcoa:bagel_box", workstreams: ["hospitality"] }];
  const plan = buildCanonicalisationPlan(before);
  assert.equal(plan.groups.length, 0); assert.equal(plan.review.length, 1);
  assert.match(plan.review[0].reasons.join(" "), /routing decisions disagree/);
});

test("adding a third site reuses the same catalogue item instead of creating another", () => {
  const before = twoSites(["bagel_box"]);
  before.items.push(item("cfc", "bagel_box")); before.offerings.push(offering("cfc", "bagel_box"));
  const plan = buildCanonicalisationPlan(before);
  assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].memberIds.length, 3);
  const after = applyOperations(before, plan.groups[0].operations);
  assert.equal(routingReviewRows(after).length, 1);
  assert.deepEqual(routingReviewRows(after)[0].offeredAt, [OPLOC.cfc, OPLOC.mnk, OPLOC.rcoa].sort());
  // New brochures must pick the existing item; a name that is already in the catalogue is refused without explicit confirmation.
  assert.deepEqual(existingCandidatesForNewItem(after.items, { name: "  bagel BOX " }), [plan.groups[0].survivorId]);
  assert.deepEqual(existingCandidatesForNewItem(after.items, { name: "Brand new product" }), []);
});

test("site offerings survive repointing intact, with site-local presentation preserved on the offering", () => {
  const before = twoSites(["glow_bowl"]);
  before.items.find(i => i.canonicalId.endsWith(":mnk:glow_bowl"))!.record.name = "Fika Glow Bowl";
  before.items.find(i => i.canonicalId.endsWith(":rcoa:glow_bowl"))!.record.name = "FIKA GLOW BOWL"; // casing only: still decisive
  before.items.find(i => i.canonicalId.endsWith(":rcoa:glow_bowl"))!.record.description = "RCoA wording";
  before.items.find(i => i.canonicalId.endsWith(":mnk:glow_bowl"))!.record.description = "MNK wording";
  const plan = buildCanonicalisationPlan(before); assert.equal(plan.groups.length, 1);
  const after = applyOperations(before, plan.groups[0].operations);
  assert.equal(after.offerings.length, before.offerings.length);
  const moved = after.offerings.find(o => o.canonicalId === plan.groups[0].operations.find(op => op.op === "repoint-offering")!["offeringId" as never])!;
  assert.equal(moved.record.hospitalityMenuItemId, plan.groups[0].survivorId);
  assert.equal((moved.record.configuration as { servingInfo: string }).servingInfo, `${moved.record.oplocId === OPLOC.mnk ? "mnk" : "rcoa"} serving`);
  assert.ok((moved.record.configuration as { description?: string }).description, "the site wording is kept as an Offering-level override");
  assert.deepEqual(verifyMergeInvariants(before, after), []);
});

test("the portal read serves the offering-level site wording while identity stays on the shared item", () => {
  const shared = item("mnk", "glow_bowl", { name: "Fika Glow Bowl", description: "Canonical wording" });
  const records = [shared, offering("mnk", "glow_bowl"), offering("rcoa", "glow_bowl", { canonicalId: "hospitality-menu-offering:rcoa:glow_bowl", hospitalityMenuItemId: shared.canonicalId, configuration: { displayName: "Propper Salads", description: "RCoA wording" } }), price("mnk", "glow_bowl", 12), price("rcoa", "glow_bowl", 14)]
    .map(record => ({ ...record, lifecycleStatus: "published", publicationStatus: "published", record: { ...record.record, ...(record.entityType === "Hospitality Menu Price" ? { effectiveFrom: "2026-01-01" } : {}) } })) as unknown as CanonicalRecord[];
  const read = (oplocId: string) => hospitalityPortalReadFromRecords(records, { oplocId, serviceDate: "2026-11-05" }).offerings as Array<{ itemId: string; name: string; description?: string }>;
  const mnk = read(OPLOC.mnk)[0]; const rcoa = read(OPLOC.rcoa)[0];
  assert.equal(mnk.itemId, rcoa.itemId);
  assert.equal(mnk.name, "Fika Glow Bowl"); assert.equal(mnk.description, "Canonical wording");
  assert.equal(rcoa.name, "Propper Salads"); assert.equal(rcoa.description, "RCoA wording");
});

test("ambiguous duplicates are reported for review and never auto-merged", () => {
  const snapshot: CatalogueSnapshot = { routing: [], offerings: [], prices: [], items: [
    // same name, no shared source id
    item("mnk", "cookie_box", { name: "Cookie Box" }), item("rcoa", "biscuit_box", { name: "Cookie Box" }),
    // shared source id but allergen data differs
    item("mnk", "tray_bake_box", { name: "Tray Bake Box" }), item("rcoa", "tray_bake_box", { name: "Tray Bake Box", allergenInformation: ["nuts"] }),
    // shared source id but different product name
    item("mnk", "glow_bowl", { name: "Fika Glow Bowl" }), item("rcoa", "glow_bowl", { name: "Propper Salads" }),
    // similar names, no shared id
    item("mnk", "house_coffee", { name: "House Filter Coffee", category: "Drinks" }), item("rcoa", "bloom_coffee", { name: "Bloom Filter Coffee", category: "Drinks" }),
    // same name twice inside one site
    item("mnk", "juice_a", { name: "Fresh Juice", category: "Drinks" }), item("mnk", "juice_b", { name: "Fresh Juice", category: "Drinks" }),
  ] };
  const plan = buildCanonicalisationPlan(snapshot);
  assert.equal(plan.groups.length, 0, "nothing is merged without decisive evidence");
  const reviewed = new Set(plan.review.flatMap(group => group.memberIds));
  for (const id of snapshot.items.map(i => i.canonicalId)) assert.ok(reviewed.has(id), `${id} is flagged for review`);
  assert.match(plan.review.flatMap(g => g.reasons).join(" "), /allergen information differs/);
  assert.equal(applyOperations(snapshot, plan.groups.flatMap(g => g.operations)).items.filter(isActiveItem).length, snapshot.items.length);
});

test("a name match alone never merges, and a different-name twin is never suggested once it has a confirmed match", () => {
  const snapshot: CatalogueSnapshot = { routing: [], offerings: [], prices: [], items: [item("mnk", "a", { name: "Same Name" }), item("rcoa", "b", { name: "Same Name" })] };
  assert.equal(buildCanonicalisationPlan(snapshot).groups.length, 0);
  const withTwin = twoSites(["hot_fork_buffet_gold", "hot_fork_buffet_silver"].map(s => s));
  withTwin.items.forEach(i => { i.record.name = i.canonicalId.includes("gold") ? "Hot Fork Buffet Gold" : "Hot Fork Buffet Silver"; });
  const plan = buildCanonicalisationPlan(withTwin);
  assert.equal(plan.groups.length, 2); assert.equal(plan.review.length, 0, "gold/silver are not suggested as duplicates of each other");
});

test("planning is idempotent: a canonicalised catalogue produces no further merges", () => {
  const before = twoSites(["a_item", "b_item", "c_item"]);
  const first = buildCanonicalisationPlan(before); assert.equal(first.groups.length, 3);
  const after = applyOperations(before, first.groups.flatMap(g => g.operations));
  const second = buildCanonicalisationPlan(after);
  assert.equal(second.groups.length, 0); assert.equal(second.summary.itemsAfter, 3);
  assert.equal(first.planHash, buildCanonicalisationPlan(before).planHash, "the plan hash is deterministic");
});

test("the checked-in MNK and RCoA catalogues lose no brochure item when canonicalised", () => {
  const toRecords = (site: Site, catalogue: typeof localMnkMenuCatalogue) => catalogue.items.map(source => item(site, source.source.sourceItemId, { name: source.name, category: source.category, description: source.description, dietaryInformation: source.dietaryInformation, allergenInformation: source.allergenInformation }));
  const snapshot: CatalogueSnapshot = { items: [...toRecords("mnk", localMnkMenuCatalogue), ...toRecords("rcoa", localRcoaMenuCatalogue)], offerings: [], prices: [], routing: [] };
  snapshot.offerings = snapshot.items.map(i => offering(i.canonicalId.includes(":mnk:") ? "mnk" : "rcoa", i.canonicalId.split(":").pop()!));
  const plan = buildCanonicalisationPlan(snapshot);
  const after = applyOperations(snapshot, plan.groups.flatMap(g => g.operations));
  assert.deepEqual(verifyMergeInvariants(snapshot, after), []);
  assert.equal(after.offerings.length, snapshot.offerings.length, "every site offering is kept");
  const activeIds = new Set(after.items.filter(isActiveItem).map(i => i.canonicalId));
  for (const offeringRecord of after.offerings) assert.ok(activeIds.has(String(offeringRecord.record.hospitalityMenuItemId)));
  assert.ok(inventory(after).length < inventory(snapshot).length);
  assert.ok(plan.review.length > 0, "the RCoA brochure wording differences are surfaced for review, not merged");
});

test("invariant checks catch a migration that would lose an offering, a price or a routing decision", () => {
  const before = twoSites(["bagel_box"]); before.routing = [{ menuItemId: "hospitality-menu-item:rcoa:bagel_box", workstreams: ["hospitality"] }];
  const bad = structuredClone(before); bad.offerings.pop(); bad.routing = [];
  const problems = verifyMergeInvariants(before, bad);
  assert.ok(problems.some(p => /offering count changed/.test(p))); assert.ok(problems.some(p => /routing decision/.test(p)));
});

test("the Hub merge command and routing projection keep one routing decision per canonical item", () => {
  const service = read("../lib/connections-service.ts");
  assert.match(service, /different production routing decisions/);
  assert.match(service, /supersededBy: survivor\.canonicalId/);
  assert.match(service, /inheritedFrom: source\.canonicalId/);
  assert.match(service, /resolveHospitalityRouting/);
  assert.match(service, /merges.doc\(stableDocumentId\(id\)\).get\(\)/);

});

test("brochure review refuses to create a second canonical item for a product that already exists", () => {
  const source = read("../lib/hospitality-catalogue-service.ts");
  assert.match(source, /existingCandidatesForNewItem\(activeItems/);
  assert.match(source, /Select it as the existing item so this site offers it/);
  assert.match(read("../app/api/hospitality-brochures/review/route.ts"), /confirmDistinctItem: z\.boolean\(\)\.optional\(\)/);
});

test("the migration CLI is read-only by default and cannot apply without the reviewed plan hash and a separate approval", () => {
  const cli = read("../scripts/hospitality-catalogue-canonicalisation.ts");
  assert.match(cli, /Default behaviour is READ-ONLY/);
  assert.match(cli, /--plan-hash does not match/);
  assert.match(cli, /FIKA_CATALOGUE_CANONICALISATION_APPROVED must equal the plan hash/);
  assert.match(cli, /Refusing to modify the production project without --allow-production/);
  assert.match(cli, /Dry run violates invariants/);
  const apply = cli.slice(cli.indexOf("if (flag(\"--apply\"))"));
  assert.ok(apply.indexOf("--plan-hash") < apply.indexOf("applyPlan(project"));
});

test("seed promotion resolves a product to its existing canonical item instead of creating a site-prefixed copy", async () => {
  const { resolveCanonicalItemForSource } = await import("../lib/hospitality-catalogue-canonicalisation");
  const existing = [item("mnk", "bagel_box")];
  assert.equal(resolveCanonicalItemForSource(existing, { siteKey: "rcoa", sourceItemId: "bagel_box", name: "Bagel Box", category: "Breakfast" })?.canonicalId, "hospitality-menu-item:mnk:bagel_box");
  // Weaker evidence must never resolve silently.
  assert.equal(resolveCanonicalItemForSource(existing, { siteKey: "rcoa", sourceItemId: "bagel_box", name: "Bagel Box", category: "Breakfast", allergenInformation: ["gluten"] }), undefined);
  assert.equal(resolveCanonicalItemForSource(existing, { siteKey: "rcoa", sourceItemId: "other_slug", name: "Bagel Box", category: "Breakfast" }), undefined);
  const promote = read("../scripts/promote-local-portal-menu-items.ts"); const offerings = read("../scripts/create-site-menu-offerings.ts");
  assert.match(promote, /resolveCanonicalItemForSource\(seen/); assert.match(promote, /coveredByExistingCanonicalItem/);
  assert.match(offerings, /resolveCanonicalItemForSource\(\[\.\.\.itemById\.values\(\)\]/);
});
