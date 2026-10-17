/**
 * Decisive canonicalisation with company-default materialisation, applied against the Firestore EMULATOR only.
 *   npx firebase emulators:exec --only firestore --project demo-fika-os "npx tsx --test tests/hospitality-catalogue-defaults.emulator.test.ts"   (with FIKA_CATALOGUE_EMULATOR_TEST=true)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { applyCanonicalisationGroup } from "../lib/hospitality-catalogue-apply";
import { buildCanonicalisationPlan, type CatalogueSnapshot } from "../lib/hospitality-catalogue-canonicalisation";
import { loadCatalogueRows } from "../lib/hospitality-catalogue-loader";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const stamp = "2026-01-01T00:00:00.000Z";
const base = { schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "test:seed-user", updatedAt: stamp, updatedBy: "test:seed-user", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} } };
const wrap = (entityType: string, canonicalId: string, record: Record<string, unknown>) => ({ canonicalId, entityType, record: { ...base, entityType, canonicalId, ...record }, dataHash: "seed", lifecycleStatus: "published", publicationStatus: "published", publishedAt: stamp }) as unknown as CanonicalRecord;
const canonical = () => db.collection("integrationHubCanonical");
const get = async (id: string) => (await canonical().doc(stableDocumentId(id)).get()).data() as CanonicalRecord | undefined;

async function seedWorld(key: string, prices: [number, number | undefined], minimums: [number | undefined, number | undefined] = [undefined, undefined]) {
  const ids = (site: string) => ({ item: `hospitality-menu-item:${site}:dflt-${key}`, offering: `hospitality-menu-offering:${site}:dflt-${key}`, price: `hospitality-menu-price:${site}:dflt-${key}` });
  const sites = ["mnk", "rcoa"] as const; const records: CanonicalRecord[] = [];
  sites.forEach((site, index) => {
    const id = ids(site);
    records.push(wrap("Hospitality Menu Item", id.item, { name: `Default ${key}`, category: "Drinks", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: `${site}-src`, sourceItemId: `dflt-${key}` }] }));
    records.push(wrap("Hospitality Menu Offering", id.offering, { hospitalityMenuItemId: id.item, oplocId: `oploc:${site}-${key}`, offeringMode: "standard", lifecycleState: "active", ...(minimums[index] !== undefined ? { minimumQuantity: minimums[index] } : {}) }));
    if (prices[index] !== undefined) records.push(wrap("Hospitality Menu Price", id.price, { hospitalityMenuOfferingId: id.offering, amount: prices[index], currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-02-01", lifecycleState: "active" }));
  });
  for (const record of records) await canonical().doc(stableDocumentId(record.canonicalId)).set(record);
  await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(ids("mnk").item)).set({ menuItemId: ids("mnk").item, workstreams: ["hospitality"], version: 1 });
  const by = (type: string) => records.filter(record => record.entityType === type);
  const snapshot: CatalogueSnapshot = { items: by("Hospitality Menu Item"), offerings: by("Hospitality Menu Offering"), prices: by("Hospitality Menu Price"), routing: [{ menuItemId: ids("mnk").item, workstreams: ["hospitality"], version: 1 }], merges: [] };
  return { ids, snapshot, group: buildCanonicalisationPlan(snapshot).groups[0] };
}

test("decisive apply lands merge + company default + redundant-override archive + repoint + routing + receipt together, and a retry changes nothing", { skip: !enabled }, async () => {
  const key = randomUUID().slice(0, 8); const { ids, group } = await seedWorld(key, [2.5, 2.5], [10, 10]);
  assert.equal(group.defaults.state, "materialised");
  assert.equal(await applyCanonicalisationGroup(db as never, group), "applied");
  const survivor = (await get(group.survivorId))!; assert.equal(survivor.record.defaultMinimumQuantity, 10);
  const defaultOp = group.operations.find(operation => operation.op === "set-company-default") as { price: { priceId: string } };
  const defaultPrice = (await get(defaultOp.price.priceId))!;
  assert.equal(defaultPrice.record.hospitalityMenuItemId, group.survivorId); assert.equal(defaultPrice.record.amount, 2.5);
  for (const site of ["mnk", "rcoa"] as const) { assert.equal((await get(ids(site).price))?.record.lifecycleState, "archived", "redundant site price archived, not deleted"); assert.equal((await get(ids(site).offering))?.record.minimumQuantity, undefined); assert.equal((await get(ids(site).offering))?.record.hospitalityMenuItemId, group.survivorId); }
  assert.equal((await get(group.sourceIds[0]))?.record.lifecycleState, "archived");
  const [row] = await loadCatalogueRows([group.survivorId]);
  assert.equal(row.offerings.length, 2); assert.ok(row.offerings.every(offer => offer.price.source === "inherits" && offer.price.effective?.amount === 2.5 && offer.minimum.source === "inherits")); assert.equal(row.routing.state, "cpu_hospitality"); assert.equal(row.overrideCount, 0);
  const scoped = async () => (await canonical().where("record.hospitalityMenuItemId", "==", group.survivorId).get()).size; const before = await scoped(); const versions = survivor.record.version;
  assert.equal(await applyCanonicalisationGroup(db as never, group), "already-applied");
  assert.equal(await scoped(), before, "retry creates no second default or offering"); assert.equal((await get(group.survivorId))?.record.version, versions);
  const receipts = (await db.collection("integrationHubGovernanceAudit").where("entityReference", "==", group.id).get()).size; assert.equal(receipts, 1);
});

test("stale price state refuses the whole group before any write", { skip: !enabled }, async () => {
  const key = randomUUID().slice(0, 8); const { ids, group } = await seedWorld(key, [3, 3]);
  await canonical().doc(stableDocumentId(ids("rcoa").price)).update({ "record.amount": 3.5 }); // drift after review
  const snapshotBefore = JSON.stringify([(await get(group.survivorId)), (await get(group.sourceIds[0])), (await get(ids("rcoa").offering))]);
  await assert.rejects(applyCanonicalisationGroup(db as never, group), /Stale catalogue plan/);
  assert.equal(JSON.stringify([(await get(group.survivorId)), (await get(group.sourceIds[0])), (await get(ids("rcoa").offering))]), snapshotBefore);
  assert.equal((await get(ids("mnk").price))?.record.lifecycleState, "active", "nothing was archived");
  assert.equal((await db.collection("integrationHubGovernanceAudit").where("entityReference", "==", group.id).get()).size, 0, "no receipt");
});

test("conflicting site prices merge WITHOUT a default: site prices stay active and nothing is guessed", { skip: !enabled }, async () => {
  const key = randomUUID().slice(0, 8); const { ids, group } = await seedWorld(key, [9.5, 10.5]);
  assert.equal(group.defaults.state, "operator_required");
  assert.equal(await applyCanonicalisationGroup(db as never, group), "applied");
  assert.equal((await get(ids("mnk").price))?.record.amount, 9.5); assert.equal((await get(ids("rcoa").price))?.record.amount, 10.5);
  assert.equal((await get(ids("mnk").price))?.record.lifecycleState, "active"); assert.equal((await get(ids("rcoa").price))?.record.lifecycleState, "active");
  const [row] = await loadCatalogueRows([group.survivorId]); assert.equal(row.defaultPrice, undefined); assert.equal(row.priceMigration.status, "operator_required");
});

test("a repointed Offering without its own price inherits the materialised default and stays bookable", { skip: !enabled }, async () => {
  const key = randomUUID().slice(0, 8); const { group, ids } = await seedWorld(key, [4, undefined]);
  assert.equal(group.defaults.offeringsInheriting, 1);
  await applyCanonicalisationGroup(db as never, group);
  const [row] = await loadCatalogueRows([group.survivorId]);
  const unpriced = row.offerings.find(offer => offer.offeringId === ids("rcoa").offering)!; assert.equal(unpriced.price.source, "inherits"); assert.equal(unpriced.price.effective?.amount, 4);
});
