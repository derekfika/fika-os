/**
 * set-permitted-sites against the Firestore EMULATOR only.
 *   npx firebase emulators:exec --only firestore --project demo-fika-os "cross-env FIKA_CATALOGUE_EMULATOR_TEST=true npx tsx --test tests/hospitality-catalogue-permitted-sites.emulator.test.ts"
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";
import { runCatalogueCommand, type CatalogueCommand } from "../lib/hospitality-catalogue-admin";
import { loadCatalogueRows } from "../lib/hospitality-catalogue-loader";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const admin: Actor = { uid: "test:permitted-admin", name: "Catalogue Admin", role: "integration-admin", synthetic: true };
const reviewer: Actor = { uid: "test:permitted-reviewer", name: "Reviewer", role: "reviewer", synthetic: true };
const viewer: Actor = { uid: "test:permitted-viewer", name: "Viewer", role: "viewer", synthetic: true };
const canonical = () => db.collection("integrationHubCanonical");
const get = async (id: string) => (await canonical().doc(stableDocumentId(id)).get()).data() as CanonicalRecord;
const run = (command: CatalogueCommand, actor: Actor = admin) => runCatalogueCommand(actor, command);
const rejects = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, (error: Error) => { assert.match(error.message, pattern); return true; });
const unique = () => randomUUID().replace(/-/g, "").slice(0, 12);
const stamp = "2026-01-01T00:00:00.000Z";
const seedOploc = async (key: string, suffix: string, lifecycleState = "active") => {
  const canonicalId = `oploc:permitted-${key}-${suffix}`;
  await canonical().doc(stableDocumentId(canonicalId)).set({ canonicalId, entityType: "OPLOC", record: { schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "test:seed", updatedAt: stamp, updatedBy: "test:seed", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType: "OPLOC", canonicalId, approvedName: `Site ${suffix} ${key}`, lifecycleState }, dataHash: "seed", lifecycleStatus: "published", publicationStatus: "published" });
  return canonicalId;
};
const wine = (key: string, oplocIds: string[], restrict = true) => ({ action: "create-item" as const, requestId: `req-${key}-${unique()}`, name: `Test Wine ${key}`, category: "Wine", routing: "in_house" as const, defaultPrice: { amount: 27 }, defaultMinimumQuantity: 1, oplocIds, restrictToSelectedOplocs: restrict });
const audits = async (itemId: string) => (await db.collection("integrationHubGovernanceAudit").where("entityReference", "==", itemId).get()).docs.map(doc => doc.data());
const revisions = async (itemId: string) => (await db.collection("integrationHubCanonicalRevisions").where("canonicalId", "==", itemId).get()).docs.map(doc => doc.data());
const itemPrices = async (itemId: string) => (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(doc => doc.data()).filter(doc => doc.entityType === "Hospitality Menu Price");
const routingOf = async (itemId: string) => (await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(itemId)).get()).data();

test("set-permitted-sites adds a site to a restricted Item with version check, revision and audit, changing nothing else", { skip: !enabled }, async () => {
  const key = unique(); const [oac, rcoa, other] = [await seedOploc(key, "oac"), await seedOploc(key, "rcoa"), await seedOploc(key, "other")];
  const { itemIds: [itemId] } = await run(wine(key, [oac]));
  const item = await get(itemId); assert.deepEqual(item.record.allowedOplocIds, [oac]);
  const routingBefore = await routingOf(itemId), pricesBefore = await itemPrices(itemId);
  const version = Number(item.record.version);
  await rejects(run({ action: "set-site-availability", itemId, expectedVersion: version, oplocId: rcoa, available: true }), /governed site restriction/);

  // permissions, stale version, validation and a no-op all leave the record untouched
  for (const actor of [reviewer, viewer]) await assert.rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [oac, rcoa], reason: "RCoA requested wines" }, actor), (error: Error & { status?: number }) => error.status === 403);
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version + 5, allowedOplocIds: [oac, rcoa], reason: "RCoA requested wines" }), /changed elsewhere/);
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [oac, rcoa], reason: "short" }), /reason/);
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [], reason: "RCoA requested wines" }), /at least one/);
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [oac, `oploc:unknown-${key}`], reason: "RCoA requested wines" }), /not active/);
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [oac], reason: "RCoA requested wines" }), /already the permitted/);
  assert.equal(Number((await get(itemId)).record.version), version);
  assert.equal((await audits(itemId)).filter(event => event.action === "Hospitality Catalogue permitted sites changed").length, 0);

  const result = await run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [oac, rcoa], reason: "RCoA requested the existing wine list" });
  assert.deepEqual(result.itemIds, [itemId]);
  const after = await get(itemId); assert.deepEqual(after.record.allowedOplocIds, [oac, rcoa].sort()); assert.equal(Number(after.record.version), version + 1);
  assert.equal(after.record.name, item.record.name); assert.equal(after.canonicalId, itemId);
  const event = (await audits(itemId)).find(candidate => candidate.action === "Hospitality Catalogue permitted sites changed")!;
  assert.equal(event.actorId, admin.uid); assert.deepEqual(event.details.added, [rcoa]); assert.deepEqual(event.details.removed, []); assert.deepEqual(event.details.before.allowedOplocIds, [oac]);
  assert.ok((await revisions(itemId)).some(revision => revision.version === version + 1 && revision.previous?.record?.allowedOplocIds?.length === 1));
  assert.deepEqual(await routingOf(itemId), routingBefore); assert.deepEqual(await itemPrices(itemId), pricesBefore);
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [oac, rcoa, other], reason: "Replay with a stale version" }), /changed elsewhere/);

  const row = (await loadCatalogueRows([itemId]))[0];
  assert.deepEqual(row.permittedSites, [oac, rcoa].sort()); assert.ok(row.availableAt.includes(rcoa) && row.availableAt.includes(oac)); assert.ok(!row.availableAt.includes(other)); assert.ok(row.unavailableAt.includes(other));
  assert.equal(row.defaultPrice?.amount, 27);
});

test("removal needs explicit confirmation, unrestricted and archived Items are refused and a failed command writes nothing", { skip: !enabled }, async () => {
  const key = unique(); const [a, b] = [await seedOploc(key, "a"), await seedOploc(key, "b")];
  const { itemIds: [itemId] } = await run(wine(key, [a, b])); let version = Number((await get(itemId)).record.version);
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [a], reason: "Narrow the scope deliberately" }), /explicit confirmation/);
  assert.equal(Number((await get(itemId)).record.version), version);
  await run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [a], reason: "Narrow the scope deliberately", confirmRemoval: true }); version++;
  assert.deepEqual((await get(itemId)).record.allowedOplocIds, [a]);
  const open = await run(wine(unique(), [a], false));
  await rejects(run({ action: "set-permitted-sites", itemId: open.itemIds[0], expectedVersion: 1, allowedOplocIds: [a, b], reason: "Not a restricted item" }), /no governed site restriction/);
  await run({ action: "set-item-status", itemId, expectedVersion: version, status: "archived" }); version++;
  await rejects(run({ action: "set-permitted-sites", itemId, expectedVersion: version, allowedOplocIds: [a, b], reason: "Archived items stay closed" }), /Restore the item/);
  assert.deepEqual((await get(itemId)).record.allowedOplocIds, [a]);
});

test("an inactive legacy site already on the allowlist is preserved when other sites are edited", { skip: !enabled }, async () => {
  const key = unique(); const [a, b] = [await seedOploc(key, "a"), await seedOploc(key, "b")]; const legacy = await seedOploc(key, "legacy", "archived");
  const { itemIds: [itemId] } = await run(wine(key, [a])); const item = await get(itemId);
  await canonical().doc(stableDocumentId(itemId)).update({ "record.allowedOplocIds": [a, legacy] });
  await run({ action: "set-permitted-sites", itemId, expectedVersion: Number(item.record.version), allowedOplocIds: [a, b], reason: "Add site b only" });
  assert.deepEqual((await get(itemId)).record.allowedOplocIds, [a, b, legacy].sort());
});
