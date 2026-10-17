import assert from "node:assert/strict";
import test from "node:test";
import { BULK_ALL_SITES_ACTOR, BULK_CREATED_REASON, planOfferingMigration, type MigrationInput } from "../lib/hospitality-offering-migration";
import type { CanonicalRecord } from "../lib/types";

const wrap = (entityType: string, canonicalId: string, record: Record<string, unknown>) => ({ canonicalId, entityType, record: { version: 1, canonicalId, ...record }, dataHash: "x", lifecycleStatus: "published", publicationStatus: "published" }) as unknown as CanonicalRecord;
const item = (id: string, extra: Record<string, unknown> = {}) => wrap("Hospitality Menu Item", id, { name: id, category: "Food", lifecycleState: "active", defaultMinimumQuantity: 5, dietaryInformation: [], allergenInformation: [], providerMappings: [], ...extra });
const offering = (id: string, itemId: string, oplocId: string, extra: Record<string, unknown> = {}) => wrap("Hospitality Menu Offering", id, { hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard", lifecycleState: "active", createdBy: "person:derek", ...extra });
const price = (id: string, scope: { itemId?: string; offeringId?: string }, amount: number) => wrap("Hospitality Menu Price", id, { ...(scope.itemId ? { hospitalityMenuItemId: scope.itemId } : { hospitalityMenuOfferingId: scope.offeringId }), amount, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
const OP = "op-hospitality-all-sites-20261017";
const base = (extra: Partial<MigrationInput> = {}): MigrationInput => ({
  items: [item("i:1"), item("i:2"), item("i:archived", { lifecycleState: "archived" })], prices: [price("p:1", { itemId: "i:1" }, 4), price("p:2", { itemId: "i:2" }, 4)], routing: [], merges: [], today: "2026-10-17",
  oplocs: ["a", "b", "c"].map(id => ({ oplocId: `oploc:${id}`, active: true })), revisions: [], receipts: [], offerings: [], ...extra,
});
const bulkEvidence = (offeringIds: string[], itemId: string, sites: string[]) => ({ revisions: offeringIds.map(id => ({ canonicalId: id, version: 1, actorId: BULK_ALL_SITES_ACTOR, reason: BULK_CREATED_REASON })), receipts: [{ entityReference: itemId, action: "Hospitality Catalogue bulk update", actorId: BULK_ALL_SITES_ACTOR, details: { bulkOperationId: OP, oplocIds: sites } }] });

test("the bulk-created default-availability Offerings are identified by revision AND receipt evidence, never by timestamp", () => {
  const created = [offering("o:b", "i:1", "oploc:b", { createdBy: BULK_ALL_SITES_ACTOR, createdAt: "2026-10-17T09:55:00.000Z" }), offering("o:c", "i:1", "oploc:c", { createdBy: BULK_ALL_SITES_ACTOR, createdAt: "2026-10-17T09:55:00.000Z" })];
  // Same actor and time, but NO revision/receipt evidence: must not be touched.
  const lookalike = offering("o:look", "i:2", "oploc:b", { createdBy: BULK_ALL_SITES_ACTOR, createdAt: "2026-10-17T09:55:00.000Z" });
  const plan = planOfferingMigration(base({ offerings: [...created, lookalike], ...bulkEvidence(["o:b", "o:c"], "i:1", ["oploc:b", "oploc:c"]) }), OP);
  assert.deepEqual(plan.bulkCreatedRedundant.map(v => v.offeringId).sort(), ["o:b", "o:c"]);
  assert.ok(!plan.verdicts.find(v => v.offeringId === "o:look")!.bulkCreated, "a look-alike without evidence is not identified");
  assert.equal(planOfferingMigration(base({ offerings: created, ...bulkEvidence(["o:b", "o:c"], "i:1", ["oploc:b", "oploc:c"]) }), "another-operation").bulkCreatedRedundant.length, 0, "a different operation id identifies nothing");
  assert.equal(planOfferingMigration(base({ offerings: created, revisions: bulkEvidence(["o:b"], "i:1", []).revisions }), OP).bulkCreatedRedundant.length, 0, "a revision without its receipt is not enough");
});

test("redundant records retire; genuine site differences survive as exceptions with their ids; a bulk record someone later edited is kept", () => {
  const offerings = [
    offering("o:plain", "i:1", "oploc:a"),                                                                       // legacy, states nothing -> redundant
    offering("o:min", "i:1", "oploc:b", { minimumQuantity: 12 }),                                                  // minimum override
    offering("o:price", "i:2", "oploc:a"), offering("o:blocked", "i:2", "oploc:b", { available: false }),         // price override / unavailable
    offering("o:words", "i:2", "oploc:c", { configuration: { displayName: "Local" } }),                            // wording
    offering("o:notice", "i:1", "oploc:c", { noticeRequiredDays: 3 }),                                            // constraint
    offering("o:edited", "i:2", "oploc:c", { createdBy: BULK_ALL_SITES_ACTOR, version: 2, minimumQuantity: 9 }),   // created by bulk, then given a minimum
  ];
  const plan = planOfferingMigration(base({ offerings, prices: [price("p:1", { itemId: "i:1" }, 4), price("p:2", { itemId: "i:2" }, 4), price("p:o", { offeringId: "o:price" }, 4.5)], ...bulkEvidence(["o:edited"], "i:2", ["oploc:c"]) }), OP);
  const verdict = (id: string) => plan.verdicts.find(v => v.offeringId === id)!;
  assert.equal(verdict("o:plain").verdict, "redundant");
  assert.deepEqual(verdict("o:min").reasons, ["site minimum override"]); assert.deepEqual(verdict("o:price").reasons, ["site price override"]);
  assert.deepEqual(verdict("o:blocked").reasons, ["site unavailable"]); assert.deepEqual(verdict("o:words").reasons, ["site wording"]); assert.deepEqual(verdict("o:notice").reasons, ["notice/guests constraint"]);
  assert.ok(plan.exceptions.every(v => v.verdict === "exception")); assert.equal(plan.exceptions.length, 6);
  assert.deepEqual(plan.legacyRedundant.map(v => v.offeringId), ["o:plain"]);
  const edited = verdict("o:edited"); assert.equal(edited.bulkCreated, true); assert.equal(edited.verdict, "exception"); assert.deepEqual(plan.bulkCreatedRedundant, [], "an edited bulk record is never retired as redundant"); assert.equal(plan.bulkCreatedNotRedundant.length, 1);
  assert.ok(plan.verdicts.every(v => v.offeringId.startsWith("o:")), "historical ids are carried through unchanged");
});

test("a site price that equals the company default is redundant; with no company default it is a genuine exception", () => {
  const equal = planOfferingMigration(base({ offerings: [offering("o:eq", "i:1", "oploc:a")], prices: [price("p:1", { itemId: "i:1" }, 4), price("p:eq", { offeringId: "o:eq" }, 4)] }), OP);
  assert.equal(equal.verdicts[0].verdict, "redundant");
  const noDefault = planOfferingMigration(base({ items: [item("i:1")], offerings: [offering("o:np", "i:1", "oploc:a")], prices: [price("p:np", { offeringId: "o:np" }, 4)] }), OP);
  assert.equal(noDefault.verdicts[0].verdict, "exception"); assert.deepEqual(noDefault.verdicts[0].reasons, ["price with no company default"]);
});

test("an archived Item must have no active Offering records: they are listed for governed retirement (Tray Bake state)", () => {
  const plan = planOfferingMigration(base({ offerings: [offering("o:tray", "i:archived", "oploc:a", { version: 3 }), offering("o:ok", "i:1", "oploc:a")] }), OP);
  assert.deepEqual(plan.archivedItemOfferings, [{ offeringId: "o:tray", itemId: "i:archived", oplocId: "oploc:a", version: 3 }]);
  assert.equal(plan.summary.activeOfferingsOnArchivedItems, 1);
});

test("item-intrinsic booking settings promote deterministically from legacy site records; conflicts are never guessed", async () => {
  const { planConfigurationPromotion } = await import("../lib/hospitality-offering-migration");
  const one = planConfigurationPromotion({ items: [item("i:1"), item("i:2"), item("i:3")], offerings: [
    offering("o:1", "i:1", "oploc:a", { noticeRequiredDays: 3, minimumGuests: 8, configuration: { servingInfo: "Serves 10", displayName: "Local" } }),
    offering("o:2", "i:2", "oploc:a", { noticeRequiredDays: 3 }), offering("o:3", "i:2", "oploc:b", { noticeRequiredDays: 5 }),
    offering("o:4", "i:3", "oploc:a", { minimumQuantity: 4 }),
  ] });
  const entry = (id: string) => one.find(candidate => candidate.itemId === id);
  assert.equal(entry("i:1")?.status, "deterministic"); assert.deepEqual(entry("i:1")?.configuration, { servingInfo: "Serves 10" }, "site wording is not product configuration"); assert.equal(entry("i:1")?.noticeRequiredDays, 3); assert.equal(entry("i:1")?.minimumGuests, 8);
  assert.equal(entry("i:2")?.status, "conflict"); assert.deepEqual(entry("i:2")?.conflicts, ["notice days differ between sites"]);
  assert.equal(entry("i:3"), undefined, "an Item with nothing to promote is not listed");
});
