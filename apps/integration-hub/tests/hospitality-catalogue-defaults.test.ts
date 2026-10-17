import assert from "node:assert/strict";
import test from "node:test";
import { applyOperations, buildCanonicalisationPlan, verifyMergeInvariants, type CatalogueSnapshot } from "../lib/hospitality-catalogue-canonicalisation";
import { buildCatalogueRows } from "../lib/hospitality-catalogue-read-model";
import { hospitalityPortalReadFromRecords } from "../lib/hospitality-catalogue-service";
import type { CanonicalRecord } from "../lib/types";

const TODAY = "2026-10-17";
type Data = Record<string, unknown>;
const wrap = (entityType: string, canonicalId: string, record: Data): CanonicalRecord => ({ canonicalId, entityType, record: { version: 1, canonicalId, ...record }, dataHash: "x", lifecycleStatus: "published", publicationStatus: "published" } as unknown as CanonicalRecord);
const item = (site: string, slug: string, extra: Data = {}) => wrap("Hospitality Menu Item", `hospitality-menu-item:${site}:${slug}`, { name: slug, category: "Drinks", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: `${site}-src`, sourceItemId: slug }], ...extra });
const offering = (site: string, slug: string, extra: Data = {}) => wrap("Hospitality Menu Offering", `hospitality-menu-offering:${site}:${slug}`, { hospitalityMenuItemId: `hospitality-menu-item:${site}:${slug}`, oplocId: `oploc:${site}`, offeringMode: "standard", lifecycleState: "active", ...extra });
const price = (site: string, slug: string, amount: number, extra: Data = {}) => wrap("Hospitality Menu Price", `hospitality-menu-price:${site}:${slug}`, { hospitalityMenuOfferingId: `hospitality-menu-offering:${site}:${slug}`, amount, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-02-01", lifecycleState: "active", ...extra });
const world = (parts: Partial<CatalogueSnapshot> & { items?: CanonicalRecord[] }): CatalogueSnapshot => ({ items: [], offerings: [], prices: [], routing: [], merges: [], ...parts });
const merged = (snapshot: CatalogueSnapshot) => { const plan = buildCanonicalisationPlan(snapshot); const after = applyOperations(snapshot, plan.groups.flatMap(group => group.operations)); return { plan, after, rows: buildCatalogueRows({ items: after.items, offerings: after.offerings, prices: after.prices || [], routing: after.routing, merges: after.merges, today: TODAY }).rows.filter(row => row.status === "active") }; };

const pair = (slug: string, sites: Array<{ site: string; amount?: number; minimum?: number }>) => world({
  items: sites.map(entry => item(entry.site, slug)), offerings: sites.map(entry => offering(entry.site, slug, entry.minimum !== undefined ? { minimumQuantity: entry.minimum } : {})),
  prices: sites.filter(entry => entry.amount !== undefined).map(entry => price(entry.site, slug, entry.amount!)),
});

test("uniform site price and minimum become the company default; repointed Offerings inherit it and no redundant override remains", () => {
  const before = pair("filter_coffee", [{ site: "mnk", amount: 2.5, minimum: 10 }, { site: "rcoa", amount: 2.5, minimum: 10 }]);
  const { plan, after, rows } = merged(before);
  assert.equal(plan.groups.length, 1); const group = plan.groups[0];
  assert.equal(group.defaults.state, "materialised"); assert.equal(group.defaults.amount, 2.5); assert.equal(group.defaults.minimumQuantity, 10); assert.equal(group.defaults.redundantOverrides, 4);
  assert.deepEqual(verifyMergeInvariants(before, after), []);
  assert.equal(rows.length, 1); const [row] = rows;
  assert.equal(row.defaultPrice?.amount, 2.5); assert.equal(row.defaultMinimumQuantity, 10); assert.equal(row.overrideCount, 0, "equal site values leave no override");
  assert.ok(row.offerings.every(offer => offer.price.source === "inherits" && offer.minimum.source === "inherits" && offer.price.effective?.amount === 2.5));
  assert.equal(after.prices!.filter(candidate => candidate.record.lifecycleState === "archived").length, 2, "redundant site Prices are archived, never deleted");
  assert.equal(after.prices!.length, 3, "history kept plus one company default");
  assert.equal(row.priceMigration.status, "not_needed");
});

test("a repointed Offering with no price of its own stays bookable by inheriting the default", () => {
  const before = pair("loaf", [{ site: "mnk", amount: 4 }, { site: "rcoa" }]); // RCoA copy has an Offering but no Price
  const { after } = merged(before);
  const records = [...after.items.filter(candidate => candidate.record.lifecycleState === "active"), ...after.offerings, ...(after.prices || [])];
  const offered = (oplocId: string) => hospitalityPortalReadFromRecords(records, { oplocId, serviceDate: TODAY }).offerings as Array<Record<string, any>>;
  assert.equal(offered("oploc:mnk")[0].price.amount, 4); assert.equal(offered("oploc:rcoa").length, 1, "bookable"); assert.equal(offered("oploc:rcoa")[0].price.amount, 4);
  // control: without materialisation the unpriced Offering would be unbookable
  assert.equal(hospitalityPortalReadFromRecords([...before.items, ...before.offerings, ...before.prices!], { oplocId: "oploc:rcoa", serviceDate: TODAY }).offerings.length, 0);
});

test("differing site prices are NOT guessed: no default, site prices untouched, merge still safe", () => {
  const before = pair("wrap", [{ site: "mnk", amount: 9.5 }, { site: "rcoa", amount: 10.5 }]);
  const { plan, after, rows } = merged(before);
  assert.equal(plan.groups[0].defaults.state, "operator_required"); assert.match(plan.groups[0].defaults.reasons.join(" "), /no governed rule/);
  assert.equal(plan.groups[0].operations.some(operation => operation.op === "set-company-default"), false);
  assert.deepEqual(after.prices!.map(candidate => [candidate.canonicalId, candidate.record.amount, candidate.record.lifecycleState]), before.prices!.map(candidate => [candidate.canonicalId, candidate.record.amount, candidate.record.lifecycleState]));
  assert.equal(rows[0].defaultPrice, undefined); assert.equal(rows[0].priceMigration.status, "operator_required");
  assert.deepEqual(verifyMergeInvariants(before, after), []);
});

test("no priced Offering fabricates no default price; no minimum fabricates no default minimum; partial minimums are not invented", () => {
  const none = merged(pair("water", [{ site: "mnk" }, { site: "rcoa" }]));
  assert.equal(none.plan.groups[0].defaults.state, "none"); assert.equal(none.after.prices!.length, 0); assert.equal(none.rows[0].defaultPrice, undefined); assert.equal(none.rows[0].defaultMinimumQuantity, undefined);
  const priceOnly = merged(pair("tea", [{ site: "mnk", amount: 2 }, { site: "rcoa", amount: 2 }]));
  assert.equal(priceOnly.plan.groups[0].defaults.minimumQuantity, undefined); assert.equal(priceOnly.rows[0].defaultMinimumQuantity, undefined);
  const partial = merged(pair("juice", [{ site: "mnk", amount: 3, minimum: 6 }, { site: "rcoa", amount: 3 }]));
  assert.equal(partial.rows[0].defaultMinimumQuantity, undefined, "one site has a minimum, the other has none: nothing is invented");
  assert.equal(partial.rows[0].offerings.find(offer => offer.oplocId === "oploc:mnk")!.minimum.effective, 6, "the existing minimum survives on its site");
  assert.match(partial.plan.groups[0].defaults.reasons.join(" "), /minimums differ/);
  const differing = merged(pair("cake", [{ site: "mnk", amount: 3, minimum: 6 }, { site: "rcoa", amount: 3, minimum: 8 }]));
  assert.equal(differing.rows[0].defaultMinimumQuantity, undefined); assert.deepEqual(differing.rows[0].offerings.map(offer => offer.minimum.effective).sort(), [6, 8]);
  assert.equal(differing.rows[0].defaultPrice?.amount, 3, "the equal price still materialises independently of the minimum");
});

test("an existing company default is the authority: nothing is materialised and a differing site value stays a sparse override", () => {
  const before = pair("soup", [{ site: "mnk", amount: 4 }, { site: "rcoa", amount: 5 }]);
  before.prices!.push(wrap("Hospitality Menu Price", "hospitality-menu-price:default-soup", { hospitalityMenuItemId: "hospitality-menu-item:mnk:soup", amount: 4, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" }));
  const { plan, rows } = merged(before);
  assert.equal(plan.groups[0].defaults.state, "none");
  const row = rows[0]; assert.equal(row.defaultPrice?.amount, 4);
  assert.equal(row.offerings.find(offer => offer.oplocId === "oploc:rcoa")!.price.source, "overrides"); assert.equal(row.offerings.find(offer => offer.oplocId === "oploc:rcoa")!.price.effective?.amount, 5);
});

test("the invariant check catches a migration that silently changes an effective price or minimum", () => {
  const before = pair("bun", [{ site: "mnk", amount: 2, minimum: 5 }, { site: "rcoa", amount: 2, minimum: 5 }]);
  const { after } = merged(before);
  const tampered = structuredClone(after); const def = tampered.prices!.find(candidate => candidate.canonicalId.includes("company-default"))!; def.record.amount = 3;
  assert.match(verifyMergeInvariants(before, tampered).join(";"), /effective price/);
  const dropped = structuredClone(after); dropped.prices = dropped.prices!.filter(candidate => !candidate.canonicalId.includes(":mnk:"));
  assert.match(verifyMergeInvariants(before, dropped).join(";"), /was discarded/);
  const minimum = structuredClone(after); minimum.items.find(candidate => candidate.canonicalId.includes(":mnk:"))!.record.defaultMinimumQuantity = 7;
  assert.match(verifyMergeInvariants(before, minimum).join(";"), /effective minimum/);
});

test("review-held and unmatched Items receive no operations: no defaults, no merge, no routing", () => {
  const a = item("mnk", "cookie_box", { name: "Cookie Box", allergenInformation: ["Gluten"] }), b = item("rcoa", "cookie_box", { name: "Freshly Baked Cookie Box", allergenInformation: ["Gluten", "Nuts"] }), solo = item("mnk", "doughnut_box");
  const before = world({ items: [a, b, solo], offerings: [offering("mnk", "cookie_box"), offering("rcoa", "cookie_box"), offering("mnk", "doughnut_box")], prices: [price("mnk", "cookie_box", 18), price("rcoa", "cookie_box", 18), price("mnk", "doughnut_box", 12)] });
  const plan = buildCanonicalisationPlan(before);
  assert.equal(plan.groups.length, 0); assert.equal(plan.review.length, 1); assert.deepEqual(plan.unmatched, [solo.canonicalId]);
  assert.deepEqual(applyOperations(before, plan.groups.flatMap(group => group.operations)).prices, before.prices, "nothing changes for held or standalone Items");
});

test("the plan is deterministic and its reviewed state covers prices so price drift invalidates the plan hash", () => {
  const make = (amount: number) => pair("scone", [{ site: "mnk", amount }, { site: "rcoa", amount }]);
  assert.equal(buildCanonicalisationPlan(make(2)).planHash, buildCanonicalisationPlan(make(2)).planHash);
  assert.notEqual(buildCanonicalisationPlan(make(2)).planHash, buildCanonicalisationPlan(make(2.5)).planHash);
  const group = buildCanonicalisationPlan(make(2)).groups[0];
  assert.equal(group.expectedState.prices!.length, 2);
  const op = group.operations.find(operation => operation.op === "set-company-default");
  assert.ok(op && op.op === "set-company-default" && op.price?.priceId.startsWith("hospitality-menu-price:company-default-"), "deterministic default id makes retries idempotent");
});
