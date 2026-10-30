/**
 * One on/off switch per site for ANY Item, including Items created for specific sites (an `allowedOplocIds` list), against the Firestore EMULATOR only.
 *   npx firebase emulators:exec --only firestore --project demo-fika-os "cross-env FIKA_CATALOGUE_EMULATOR_TEST=true npx tsx --test tests/hospitality-catalogue-permitted-sites.emulator.test.ts"
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";
import { runBulkCatalogueUpdate, runCatalogueCommand, type CatalogueCommand } from "../lib/hospitality-catalogue-admin";
import { loadCatalogueRows } from "../lib/hospitality-catalogue-loader";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const admin: Actor = { uid: "test:switch-admin", name: "Catalogue Admin", role: "integration-admin", synthetic: true };
const reviewer: Actor = { uid: "test:switch-reviewer", name: "Reviewer", role: "reviewer", synthetic: true };
const viewer: Actor = { uid: "test:switch-viewer", name: "Viewer", role: "viewer", synthetic: true };
const canonical = () => db.collection("integrationHubCanonical");
const get = async (id: string) => (await canonical().doc(stableDocumentId(id)).get()).data() as CanonicalRecord;
const run = (command: CatalogueCommand, actor: Actor = admin) => runCatalogueCommand(actor, command);
const rejects = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, (error: Error) => { assert.match(error.message, pattern); return true; });
const unique = () => randomUUID().replace(/-/g, "").slice(0, 12);
const stamp = "2026-01-01T00:00:00.000Z";
const seedOploc = async (key: string, suffix: string) => {
  const canonicalId = `oploc:switch-${key}-${suffix}`;
  await canonical().doc(stableDocumentId(canonicalId)).set({ canonicalId, entityType: "OPLOC", record: { schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "test:seed", updatedAt: stamp, updatedBy: "test:seed", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType: "OPLOC", canonicalId, approvedName: `Site ${suffix} ${key}`, lifecycleState: "active" }, dataHash: "seed", lifecycleStatus: "published", publicationStatus: "published" });
  return canonicalId;
};
const wine = (key: string, oplocIds: string[]) => ({ action: "create-item" as const, requestId: `req-${key}-${unique()}`, name: `Test Wine ${key}`, category: "Wine", routing: "in_house" as const, defaultPrice: { amount: 27 }, defaultMinimumQuantity: 1, oplocIds, restrictToSelectedOplocs: true });
const audits = async (itemId: string) => (await db.collection("integrationHubGovernanceAudit").where("entityReference", "==", itemId).get()).docs.map(doc => doc.data());
const itemPrices = async (itemId: string) => (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(doc => doc.data()).filter(doc => doc.entityType === "Hospitality Menu Price");
const routingOf = async (itemId: string) => (await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(itemId)).get()).data();
const exceptions = async (itemId: string) => (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(doc => doc.data() as CanonicalRecord).filter(doc => doc.entityType === "Hospitality Menu Offering" && doc.record.lifecycleState !== "archived");
const row = async (itemId: string) => (await loadCatalogueRows([itemId]))[0];

test("switching a site ON for a site-restricted Item extends its site list in one audited step and changes nothing else; OFF/ON then use the normal exception", { skip: !enabled }, async () => {
  const key = unique(); const [oac, rcoa, other] = [await seedOploc(key, "oac"), await seedOploc(key, "rcoa"), await seedOploc(key, "other")];
  const { itemIds: [itemId] } = await run(wine(key, [oac]));
  const before = await get(itemId); const version = Number(before.record.version);
  const routingBefore = await routingOf(itemId), pricesBefore = await itemPrices(itemId);
  assert.ok(!(await row(itemId)).availableAt.includes(rcoa));

  for (const actor of [reviewer, viewer]) await assert.rejects(run({ action: "set-site-availability", itemId, expectedVersion: version, oplocId: rcoa, available: true }, actor), (error: Error & { status?: number }) => error.status === 403);
  await rejects(run({ action: "set-site-availability", itemId, expectedVersion: version + 4, oplocId: rcoa, available: true }), /changed elsewhere/);
  await rejects(run({ action: "set-site-availability", itemId, expectedVersion: version, oplocId: other, available: false }), /already unavailable/);
  assert.equal(Number((await get(itemId)).record.version), version, "refused commands write nothing");

  await run({ action: "set-site-availability", itemId, expectedVersion: version, oplocId: rcoa, available: true });
  const after = await get(itemId);
  assert.deepEqual(after.record.allowedOplocIds, [oac, rcoa].sort()); assert.equal(Number(after.record.version), version + 1);
  assert.equal(after.canonicalId, itemId); assert.equal(after.record.name, before.record.name);
  const event = (await audits(itemId)).find(candidate => candidate.action === "Hospitality Catalogue offering enabled")!;
  assert.equal(event.actorId, admin.uid); assert.deepEqual(event.details.siteListExtendedWith, [rcoa]);
  assert.deepEqual(await routingOf(itemId), routingBefore); assert.deepEqual(await itemPrices(itemId), pricesBefore); assert.equal((await exceptions(itemId)).length, 0);
  let current = await row(itemId); assert.ok(current.availableAt.includes(rcoa) && current.availableAt.includes(oac)); assert.ok(!current.availableAt.includes(other));
  await rejects(run({ action: "set-site-availability", itemId, expectedVersion: version, oplocId: rcoa, available: true }), /changed elsewhere/);

  await run({ action: "set-site-availability", itemId, expectedVersion: current.version, oplocId: rcoa, available: false });
  assert.deepEqual((await get(itemId)).record.allowedOplocIds, [oac, rcoa].sort(), "OFF keeps the site list and records a reversible exception");
  assert.equal((await exceptions(itemId)).length, 1); current = await row(itemId); assert.ok(!current.availableAt.includes(rcoa));
  await run({ action: "set-site-availability", itemId, expectedVersion: current.version, oplocId: rcoa, available: true });
  assert.equal((await exceptions(itemId)).length, 0); assert.ok((await row(itemId)).availableAt.includes(rcoa));
  assert.equal((await row(itemId)).defaultPrice?.amount, 27);
});

test("bulk ON extends the site list of restricted Items; bulk replace never creates exceptions for sites an Item was never permitted at", { skip: !enabled }, async () => {
  const key = unique(); const [a, b, c] = [await seedOploc(key, "a"), await seedOploc(key, "b"), await seedOploc(key, "c")];
  const first = (await run(wine(`${key}1`, [a]))).itemIds[0], second = (await run(wine(`${key}2`, [a]))).itemIds[0];
  const versions = async () => Object.fromEntries((await loadCatalogueRows([first, second])).map(item => [item.itemId, item.version]));
  const outcome = await runBulkCatalogueUpdate(admin, { operationId: `op-${key}-add`, itemIds: [first, second], expectedVersions: await versions(), sites: { mode: "add", oplocIds: [b] } });
  assert.equal(outcome.failed, 0, outcome.message);
  for (const id of [first, second]) { assert.deepEqual((await get(id)).record.allowedOplocIds, [a, b].sort()); assert.equal((await exceptions(id)).length, 0); }
  const replace = await runBulkCatalogueUpdate(admin, { operationId: `op-${key}-replace`, itemIds: [first], expectedVersions: await versions(), sites: { mode: "replace", oplocIds: [a] } });
  assert.equal(replace.failed, 0, replace.message);
  const exc = await exceptions(first); assert.deepEqual(exc.map(record => record.record.oplocId), [b], "only the permitted-but-now-unselected site gets an exception; c was never permitted so stores nothing");
  assert.ok(!(await exceptions(first)).some(record => record.record.oplocId === c));
});

test("an archived restricted Item cannot be switched on anywhere", { skip: !enabled }, async () => {
  const key = unique(); const [a, b] = [await seedOploc(key, "a"), await seedOploc(key, "b")];
  const { itemIds: [itemId] } = await run(wine(key, [a])); let version = Number((await get(itemId)).record.version);
  await run({ action: "set-item-status", itemId, expectedVersion: version, status: "archived" }); version++;
  await rejects(run({ action: "set-site-availability", itemId, expectedVersion: version, oplocId: b, available: true }), /Restore the item/);
  assert.deepEqual((await get(itemId)).record.allowedOplocIds, [a]);
});
