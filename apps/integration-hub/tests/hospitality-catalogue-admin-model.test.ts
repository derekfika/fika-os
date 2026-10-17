import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hospitalityPortalReadFromRecords } from "../lib/hospitality-catalogue-service";
import { applyOperations, buildCanonicalisationPlan, verifyMergeInvariants, type CatalogueSnapshot } from "../lib/hospitality-catalogue-canonicalisation";
import { buildCataloguePayload, buildCatalogueRows, reviewGroupId, routingStateOf, ukBusinessDate } from "../lib/hospitality-catalogue-read-model";
import { EMPTY_FILTERS, rowMatches, sortRows, withDuplicateFlag } from "../lib/hospitality-catalogue-view";
import { hasPermission, permissionsForRole } from "../lib/authmod";
import { parseCanonical } from "../lib/schemas";
import type { CanonicalRecord } from "../lib/types";

const TODAY = "2026-10-17";
type Data = Record<string, unknown>;
const wrap = (entityType: string, canonicalId: string, record: Data): CanonicalRecord => ({ canonicalId, entityType, record: { version: 1, ...record, canonicalId }, dataHash: canonicalId, lifecycleStatus: "published", publicationStatus: "published" } as unknown as CanonicalRecord);
const item = (id: string, name: string, extra: Data = {}) => wrap("Hospitality Menu Item", id, { name, category: "Drinks", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [], ...extra });
const offering = (id: string, itemId: string, oplocId: string, extra: Data = {}) => wrap("Hospitality Menu Offering", id, { hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard", lifecycleState: "active", ...extra });
const price = (id: string, scope: { offeringId?: string; itemId?: string }, amount: number, extra: Data = {}) => wrap("Hospitality Menu Price", id, { ...(scope.offeringId ? { hospitalityMenuOfferingId: scope.offeringId } : { hospitalityMenuItemId: scope.itemId }), amount, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active", ...extra });
const build = (input: Partial<Parameters<typeof buildCatalogueRows>[0]>) => buildCatalogueRows({ items: [], offerings: [], prices: [], routing: [], today: TODAY, ...input });

test("one row per canonical Item aggregates offerings and resolves inherited vs overridden price and minimum", () => {
  const coffee = item("hospitality-menu-item:coffee", "Filter Coffee", { defaultMinimumQuantity: 10 });
  const result = build({
    items: [coffee], routing: [{ menuItemId: coffee.canonicalId, workstreams: [], version: 3 }],
    offerings: [offering("o:a", coffee.canonicalId, "oploc:a"), offering("o:b", coffee.canonicalId, "oploc:b", { minimumQuantity: 20 }), offering("o:c", coffee.canonicalId, "oploc:c", { configuration: { displayName: "House Coffee" } }), offering("o:q", coffee.canonicalId, "oploc:q", { offeringMode: "quote_only" })],
    prices: [price("p:default", { itemId: coffee.canonicalId }, 3), price("p:b", { offeringId: "o:b" }, 3.5)],
  });
  assert.equal(result.rows.length, 1);
  const row = result.rows[0]; const by = (id: string) => row.offerings.find(offer => offer.offeringId === id)!;
  assert.equal(row.defaultPrice?.amount, 3); assert.equal(row.defaultMinimumQuantity, 10);
  assert.equal(by("o:a").price.source, "inherits"); assert.equal(by("o:a").price.effective?.amount, 3); assert.equal(by("o:a").minimum.source, "inherits"); assert.equal(by("o:a").minimum.effective, 10);
  assert.equal(by("o:b").price.source, "overrides"); assert.equal(by("o:b").price.effective?.amount, 3.5); assert.equal(by("o:b").minimum.source, "overrides"); assert.equal(by("o:b").minimum.effective, 20);
  assert.equal(by("o:c").displayName, "House Coffee");
  assert.equal(by("o:q").price.source, "quote_only", "a quote-only Offering never inherits a price");
  assert.equal(row.overrideCount, 3, "price + minimum on B and display name on C; inherited values are not counted");
  assert.deepEqual(row.availableAt, ["oploc:a", "oploc:b", "oploc:c", "oploc:q"]);
  assert.equal(row.routing.state, "in_house");
});

test("a site price equal to the company default is flagged redundant, not silently dropped", () => {
  const tea = item("hospitality-menu-item:tea", "Tea");
  const [row] = build({ items: [tea], offerings: [offering("o:a", tea.canonicalId, "oploc:a")], prices: [price("p:d", { itemId: tea.canonicalId }, 2), price("p:a", { offeringId: "o:a" }, 2)] }).rows;
  assert.equal(row.offerings[0].price.redundant, true);
});

test("routing states fail closed: missing, unknown, superseded and conflicting records are never treated as In house", () => {
  assert.equal(routingStateOf(undefined).state, "routing_required");
  assert.equal(routingStateOf({ menuItemId: "x", workstreams: ["bogus"] }).state, "routing_required");
  assert.equal(routingStateOf({ menuItemId: "x", workstreams: [], supersededBy: "y" }).state, "routing_required");
  assert.equal(routingStateOf({ menuItemId: "x", workstreams: ["sandwiches", "hospitality"] }).state, "routing_conflict");
  assert.equal(routingStateOf({ menuItemId: "x", workstreams: [] }).state, "in_house");
  assert.equal(routingStateOf({ menuItemId: "x", workstreams: ["sandwiches"] }).state, "cpu_sandwiches");
  assert.equal(routingStateOf({ menuItemId: "x", workstreams: ["hospitality"] }).state, "cpu_hospitality");
  assert.equal(routingStateOf({ menuItemId: "x", workstreams: ["delivered_in"] }).state, "cpu_delivered_in");
});

test("unresolved routing and missing prices are counted as needing review; archived items are not", () => {
  const a = item("hospitality-menu-item:a", "Unrouted Cake");
  const b = item("hospitality-menu-item:b", "Routed Cake");
  const gone = item("hospitality-menu-item:gone", "Old Cake", { lifecycleState: "archived" });
  const payload = buildCataloguePayload({ items: [a, b, gone], offerings: [offering("o:a", a.canonicalId, "oploc:a"), offering("o:b", b.canonicalId, "oploc:a")], prices: [price("p:b", { offeringId: "o:b" }, 2)], routing: [{ menuItemId: b.canonicalId, workstreams: ["hospitality"], version: 1 }], today: TODAY }, [{ oplocId: "oploc:a", label: "Site A", active: true }], true);
  const rowA = payload.rows.find(row => row.name === "Unrouted Cake")!;
  assert.deepEqual(rowA.needsReview, ["routing_required", "price_missing"]);
  assert.equal(payload.rows.find(row => row.name === "Routed Cake")!.needsReview.length, 0);
  assert.equal(payload.rows.find(row => row.name === "Old Cake")!.needsReview.length, 0);
  assert.deepEqual(payload.counts, { active: 2, archived: 1, needsReview: 1, routingRequired: 1 });
});

test("price migration analysis: equal site values propose a default; differing values require the operator, never first/lowest/highest", () => {
  const same = item("hospitality-menu-item:same", "Same"), differ = item("hospitality-menu-item:differ", "Differ"), partial = item("hospitality-menu-item:partial", "Partial");
  const rows = build({
    items: [same, differ, partial],
    offerings: [offering("s:1", same.canonicalId, "oploc:a", { minimumQuantity: 5 }), offering("s:2", same.canonicalId, "oploc:b", { minimumQuantity: 5 }), offering("d:1", differ.canonicalId, "oploc:a"), offering("d:2", differ.canonicalId, "oploc:b"), offering("p:1", partial.canonicalId, "oploc:a"), offering("p:2", partial.canonicalId, "oploc:b")],
    prices: [price("ps1", { offeringId: "s:1" }, 4), price("ps2", { offeringId: "s:2" }, 4), price("pd1", { offeringId: "d:1" }, 4), price("pd2", { offeringId: "d:2" }, 5), price("pp1", { offeringId: "p:1" }, 4)],
  }).rows;
  const get = (name: string) => rows.find(row => row.name === name)!.priceMigration;
  const uniform = get("Same"); assert.equal(uniform.status, "uniform"); if (uniform.status === "uniform") { assert.equal(uniform.amount, 4); assert.equal(uniform.minimumQuantity, 5); }
  const differing = get("Differ"); assert.equal(differing.status, "operator_required"); if (differing.status === "operator_required") assert.match(differing.reason, /no governed business rule/);
  assert.equal(get("Partial").status, "operator_required", "a site without a price cannot be assumed equal");
});

test("the portal read contract inherits the company default price and minimum, honours overrides, and keeps quote-only and archived items out", () => {
  const cake = item("hospitality-menu-item:cake", "Cake", { defaultMinimumQuantity: 8 });
  const records = [cake, offering("o:a", cake.canonicalId, "oploc:a"), offering("o:b", cake.canonicalId, "oploc:b", { minimumQuantity: 12 }), offering("o:q", cake.canonicalId, "oploc:a", { operationalAreaId: "operational-area:x", offeringMode: "quote_only" }), price("p:d", { itemId: cake.canonicalId }, 3), price("p:b", { offeringId: "o:b" }, 3.75)];
  const at = (oplocId: string, operationalAreaId?: string) => hospitalityPortalReadFromRecords(records, { oplocId, operationalAreaId, serviceDate: TODAY }).offerings as Array<Record<string, any>>;
  const a = at("oploc:a")[0]; assert.equal(a.price.amount, 3); assert.equal(a.constraints.minimumQuantity, 8);
  const b = at("oploc:b")[0]; assert.equal(b.price.amount, 3.75); assert.equal(b.constraints.minimumQuantity, 12);
  const q = at("oploc:a", "operational-area:x").find(offer => offer.offeringMode === "quote_only")!; assert.equal(q.quoteRequired, true); assert.equal("price" in q, false);
  const archived = records.map(record => record.canonicalId === cake.canonicalId ? { ...record, record: { ...record.record, lifecycleState: "archived" } } : record);
  assert.equal(hospitalityPortalReadFromRecords(archived, { oplocId: "oploc:a", serviceDate: TODAY }).offerings.length, 0, "archived items vanish from active booking menus");
  const noPrice = records.filter(record => record.canonicalId !== "p:d");
  assert.equal(hospitalityPortalReadFromRecords(noPrice, { oplocId: "oploc:a", serviceDate: TODAY }).offerings.length, 0, "no default and no override: not bookable");
  const ambiguous = [...records, price("p:d2", { itemId: cake.canonicalId }, 9)];
  assert.equal(hospitalityPortalReadFromRecords(ambiguous, { oplocId: "oploc:a", serviceDate: TODAY }).offerings.length, 0, "ambiguous defaults fail closed");
});

test("Price scope is exactly one of Offering or Item at the schema boundary", () => {
  const valid = (extra: Data) => parseCanonical("Hospitality Menu Price", { schemaVersion: "0.1.0", version: 1, createdAt: "2026-01-01T00:00:00.000Z", createdBy: "user:00000001", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "user:00000001", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType: "Hospitality Menu Price", canonicalId: "hospitality-menu-price:00000001", amount: 1, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active", ...extra }).success;
  assert.equal(valid({ hospitalityMenuOfferingId: "hospitality-menu-offering:1" }), true);
  assert.equal(valid({ hospitalityMenuItemId: "hospitality-menu-item:1" }), true);
  assert.equal(valid({}), false); assert.equal(valid({ hospitalityMenuOfferingId: "hospitality-menu-offering:1", hospitalityMenuItemId: "hospitality-menu-item:1" }), false);
});

test("canonicalisation collapses site-prefixed copies into one catalogue Item; offerings, prices, overrides and routing survive", () => {
  const mnk = item("hospitality-menu-item:mnk:canned_drinks", "Canned Drinks", { providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "canned_drinks" }] });
  const rcoa = item("hospitality-menu-item:rcoa:canned_drinks", "Canned Drinks", { providerMappings: [{ provider: "rcoa-hospitality-brochure", sourceItemId: "canned_drinks" }] });
  const snapshot: CatalogueSnapshot = {
    items: [mnk, rcoa], offerings: [offering("o:mnk", mnk.canonicalId, "oploc:mnk", { minimumQuantity: 6 }), offering("o:rcoa", rcoa.canonicalId, "oploc:rcoa")],
    prices: [price("p:mnk", { offeringId: "o:mnk" }, 1.5), price("p:rcoa", { offeringId: "o:rcoa" }, 1.5)], routing: [{ menuItemId: mnk.canonicalId, workstreams: ["hospitality"], version: 2 }], merges: [],
  };
  const plan = buildCanonicalisationPlan(snapshot);
  assert.equal(plan.groups.length, 1); assert.equal(plan.review.length, 0);
  const after = applyOperations(snapshot, plan.groups.flatMap(group => group.operations));
  assert.deepEqual(verifyMergeInvariants(snapshot, after), []);
  const result = buildCatalogueRows({ items: after.items, offerings: after.offerings, prices: snapshot.prices!, routing: after.routing, merges: after.merges, today: TODAY });
  const active = result.rows.filter(row => row.status === "active");
  assert.equal(active.length, 1, "one catalogue Item per product");
  assert.equal(active[0].offerings.length, 2); assert.deepEqual(active[0].availableAt.sort(), ["oploc:mnk", "oploc:rcoa"]);
  assert.equal(active[0].routing.state, "cpu_hospitality", "routing preserved on the survivor");
  assert.equal(active[0].offerings.find(offer => offer.offeringId === "o:mnk")!.minimum.override, 6, "site minimum preserved as an override");
  assert.equal(result.rows.filter(row => row.status === "archived").length, 1);
  assert.equal(active[0].priceMigration.status, "operator_required", "mixed minimums: the operator, not a guess, picks the company default");
  assert.equal(snapshot.prices!.length, 2, "no Price is discarded by the merge");
});

test("ambiguous groups stay review-held and never auto-merge; decisions are honoured by id", () => {
  const a = item("hospitality-menu-item:mnk:cookie_box", "Cookie Box", { providerMappings: [{ provider: "x", sourceItemId: "cookie_box" }], allergenInformation: ["Gluten"] });
  const b = item("hospitality-menu-item:rcoa:cookie_box", "Cookie Box", { providerMappings: [{ provider: "y", sourceItemId: "cookie_box" }], allergenInformation: ["Gluten", "Nuts"] });
  const plan = buildCanonicalisationPlan({ items: [a, b], offerings: [], prices: [], routing: [] });
  assert.equal(plan.groups.length, 0); assert.equal(plan.review.length, 1);
  const id = reviewGroupId(plan.review[0].memberIds);
  const held = buildCatalogueRows({ items: [a, b], offerings: [], prices: [], routing: [], today: TODAY });
  assert.ok(held.rows.every(row => row.needsReview.includes("duplicate_candidate")));
  const kept = buildCatalogueRows({ items: [a, b], offerings: [], prices: [], routing: [], today: TODAY, decisions: [{ groupId: id, memberIds: plan.review[0].memberIds, decision: "keep_separate" }] });
  assert.ok(kept.rows.every(row => !row.needsReview.includes("duplicate_candidate")));
  assert.equal(kept.reviewGroups[0].decision, "keep_separate");
  const deferred = buildCatalogueRows({ items: [a, b], offerings: [], prices: [], routing: [], today: TODAY, decisions: [{ groupId: id, memberIds: plan.review[0].memberIds, decision: "defer" }] });
  assert.ok(deferred.rows.every(row => row.needsReview.includes("duplicate_candidate")), "deferred is still outstanding");
  assert.equal(withDuplicateFlag({ ...kept.rows[0], needsReview: [] }, held.reviewGroups).needsReview.includes("duplicate_candidate"), true, "a targeted refresh re-derives the flag from the loaded groups");
});

test("search, filters and sorting", () => {
  const items = [item("hospitality-menu-item:a", "Zesty Wrap", { category: "Lunch", defaultMinimumQuantity: 2, providerMappings: [{ provider: "mnk", sourceItemId: "zesty_wrap_01" }] }), item("hospitality-menu-item:b", "Apple Cake", { category: "Cake" }), item("hospitality-menu-item:c", "Old Bun", { category: "Cake", lifecycleState: "archived" })];
  const rows = build({ items, offerings: [offering("o:a", "hospitality-menu-item:a", "oploc:a", { minimumQuantity: 4 }), offering("o:b", "hospitality-menu-item:b", "oploc:b")], prices: [price("p:ad", { itemId: "hospitality-menu-item:a" }, 8), price("p:a", { offeringId: "o:a" }, 9), price("p:b", { offeringId: "o:b" }, 2)], routing: [{ menuItemId: "hospitality-menu-item:a", workstreams: ["sandwiches"], version: 1 }] }).rows;
  const names = (filters: Partial<typeof EMPTY_FILTERS>) => rows.filter(row => rowMatches(row, { ...EMPTY_FILTERS, ...filters })).map(row => row.name);
  assert.deepEqual(names({}), ["Apple Cake", "Zesty Wrap"], "archived hidden by default");
  assert.deepEqual(names({ status: "archived" }), ["Old Bun"]); assert.equal(names({ status: "all" }).length, 3);
  assert.deepEqual(names({ query: "zesty_wrap" }), ["Zesty Wrap"], "supplier source id is searchable");
  assert.deepEqual(names({ query: "APPLE" }), ["Apple Cake"]);
  assert.deepEqual(names({ category: "Lunch" }), ["Zesty Wrap"]);
  assert.deepEqual(names({ route: "cpu_sandwiches" }), ["Zesty Wrap"]); assert.deepEqual(names({ route: "routing_required" }), ["Apple Cake"]);
  assert.deepEqual(names({ oplocId: "oploc:b" }), ["Apple Cake"]);
  assert.deepEqual(names({ hasOverrides: true }), ["Zesty Wrap"]); assert.deepEqual(names({ needsReview: true }), ["Apple Cake"]);
  assert.deepEqual(names({ priceNotSet: true }), ["Apple Cake"], "Apple Cake has only a site value and no company default");
  assert.equal(rows.find(row => row.name === "Apple Cake")!.offerings[0].price.source, "site_only", "a site price with no company default is not an override of anything");
  const ordered = (key: "name" | "category" | "production" | "price", direction: "asc" | "desc") => sortRows(rows.filter(row => row.status === "active"), { key, direction }).map(row => row.name);
  assert.deepEqual(ordered("name", "desc"), ["Zesty Wrap", "Apple Cake"]); assert.deepEqual(ordered("price", "asc"), ["Apple Cake", "Zesty Wrap"]); assert.deepEqual(ordered("production", "asc"), ["Zesty Wrap", "Apple Cake"]);
});

test("UK business date uses Europe/London across the BST boundary, not the UTC slice", () => {
  assert.equal(ukBusinessDate(new Date("2026-06-30T23:30:00Z")), "2026-07-01", "00:30 BST is already the next UK day");
  assert.equal(ukBusinessDate(new Date("2026-12-31T23:30:00Z")), "2026-12-31", "GMT in winter");
  assert.equal(ukBusinessDate(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
});

test("AUTHMOD: only integration-admin holds hospitality.catalogue.manage; reviewers and viewers are view-only", () => {
  const actor = (role: "integration-admin" | "reviewer" | "viewer") => ({ uid: "u", role, name: "n" }) as never;
  assert.equal(hasPermission(actor("integration-admin"), "hospitality.catalogue.manage"), true);
  assert.equal(hasPermission(actor("reviewer"), "hospitality.catalogue.manage"), false);
  assert.equal(hasPermission(actor("viewer"), "hospitality.catalogue.manage"), false);
  assert.equal(hasPermission(actor("viewer"), "canonical.view"), true);
  assert.ok(permissionsForRole("integration-admin").includes("hospitality.catalogue.manage"));
});

const ui = readFileSync(`${process.cwd()}/app/ui/HospitalityCatalogue.tsx`, "utf8");
const css = readFileSync(`${process.cwd()}/app/ui/HospitalityCatalogue.css`, "utf8");
test("UI contract: no browser Firestore, native dialogs or raw IDs in the ordinary surface; view-only users get no edit controls", () => {
  assert.doesNotMatch(ui, /firebase|firestore/i); assert.doesNotMatch(ui, /window\.(alert|confirm|prompt)\s*\(|\bconfirm\(|\balert\(/);
  assert.match(ui, /ConfirmationModal/); assert.match(ui, /\/api\/hospitality-catalogue/);
  const ordinary = ui.slice(0, ui.indexOf('<details className="hc-section hc-advanced">'));
  assert.doesNotMatch(ordinary.slice(ordinary.indexOf("function ItemPanel")), />\s*\{(row|offering|member)\.(itemId|oplocId|offeringId)\}\s*</, "raw IDs only inside the collapsed advanced section");
  assert.match(ui, /canManage && <button type="button" className="hc-btn hc-btn--primary" onClick=\{\(\) => setAdding\(true\)\}/, "Add item only for managers");
  assert.match(ui, /canManage && !inactive && <button type="submit"/); assert.match(ui, /disabled=\{!canManage \|\| inactive\}/);
  assert.match(ui, /INHERITS/); assert.match(ui, /OVERRIDES/); assert.match(ui, /Reset to company default/); assert.match(ui, /ROUTING REQUIRED/);
  for (const label of ["No CPU / In house", "CPU · Hospitality", "CPU · Sandwiches", "CPU · Delivered-In"]) assert.match(readFileSync(`${process.cwd()}/lib/hospitality-catalogue-types.ts`, "utf8"), new RegExp(label));
  assert.match(ui, /Same product — merge/); assert.match(ui, /Keep separate/); assert.match(ui, /Defer/);
  assert.match(ui, /Loading the catalogue/); assert.match(ui, /No items match these filters/); assert.match(ui, /The catalogue could not be loaded/);
  assert.match(ui, /role="dialog"/); assert.match(ui, /aria-modal="true"/); assert.match(ui, /aria-label="Close item panel"/); assert.match(ui, /event\.key === "Escape"/);
});
test("UI contract: semantic tokens only, focus-visible, narrow-screen cards and reduced motion", () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(/); assert.match(css, /:focus-visible/); assert.match(css, /max-width: 760px/); assert.match(css, /\.hc-cards \{ display: grid/); assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /background:\s*var\(--color-brand-dark\)\s*;?\s*color:\s*#fff/);
});
