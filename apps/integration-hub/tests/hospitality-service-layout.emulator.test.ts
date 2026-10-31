/**
 * Governed service-layout commands against the Firestore EMULATOR only.
 *   npx firebase emulators:exec --only firestore --project demo-fika-os "cross-env FIKA_CATALOGUE_EMULATOR_TEST=true npx tsx --test tests/hospitality-service-layout.emulator.test.ts"
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";
import { runCatalogueCommand, type CatalogueCommand } from "../lib/hospitality-catalogue-admin";
import { buildCataloguePackage } from "../lib/hospitality-catalogue-package";
import { COMPANY_LAYOUT_ID, layoutCollection, layoutDocId, layoutRevisions, readStoredServiceLayouts, type StoredServiceLayout } from "../lib/hospitality-service-layout";
import { attachServiceLayout, loadStoredServiceLayoutView } from "../lib/hospitality-service-layout";
import type { CataloguePayload, CatalogueRow } from "../lib/hospitality-catalogue-types";
import { categoryAllowedForService, resolveServiceCategories, SERVICE_IDS, SERVICE_LAYOUT_SEED } from "@fika/server-shared/hospitality-service-layout";

const enabled = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const admin: Actor = { uid: "test:layout-admin", name: "Catalogue Admin", role: "integration-admin", synthetic: true };
const reviewer: Actor = { uid: "test:layout-reviewer", name: "Reviewer", role: "reviewer", synthetic: true };
const viewer: Actor = { uid: "test:layout-viewer", name: "Viewer", role: "viewer", synthetic: true };
const run = (command: CatalogueCommand, actor: Actor = admin) => runCatalogueCommand(actor, command);
const rejects = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, (error: Error) => { assert.match(error.message, pattern); return true; });
const stamp = "2026-01-01T00:00:00.000Z";
const seedOploc = async (suffix: string, lifecycleState = "active") => {
  const canonicalId = `oploc:layout-${randomUUID().slice(0, 8)}-${suffix}`;
  await db.collection("integrationHubCanonical").doc(stableDocumentId(canonicalId)).set({ canonicalId, entityType: "OPLOC", record: { schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "test:seed", updatedAt: stamp, updatedBy: "test:seed", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType: "OPLOC", canonicalId, approvedName: `Site ${suffix}`, lifecycleState }, dataHash: "seed", lifecycleStatus: "published", publicationStatus: "published" });
  return canonicalId;
};
const stored = async (oplocId?: string) => (await layoutCollection().doc(layoutDocId(oplocId)).get()).data() as StoredServiceLayout | undefined;
const audits = async (reference: string) => (await db.collection("integrationHubGovernanceAudit").where("entityReference", "==", reference).get()).docs.map(d => d.data());
const reset = async () => { for (const snapshot of (await layoutCollection().get()).docs) await snapshot.ref.delete(); };
const REASON = "Owner wants alcohol offered at dinner only";

test("company default: first save creates the document from the seed with one service changed, then versions, revisions and audits it", { skip: !enabled }, async () => {
  await reset();
  assert.equal(await stored(), undefined);
  for (const actor of [reviewer, viewer]) await assert.rejects(run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Wine"], expectedVersion: 0, reason: REASON }, actor), (e: Error & { status?: number }) => e.status === 403);
  await rejects(run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Wine"], expectedVersion: 4, reason: REASON }), /changed elsewhere/);
  assert.equal(await stored(), undefined, "refused commands write nothing");
  await run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Drinks", "Wine"], expectedVersion: 0, reason: REASON });
  const first = (await stored())!; assert.equal(first.version, 1); assert.equal(first.scope, "company");
  assert.deepEqual(first.services.dining?.categories, ["Dining", "Drinks", "Wine"]); assert.deepEqual(first.services.breakfast?.categories, SERVICE_LAYOUT_SEED.breakfast.categories, "every other service is the seed");
  assert.deepEqual(Object.keys(first.services).sort(), [...SERVICE_IDS].sort());
  const revision = (await layoutRevisions().doc(`${COMPANY_LAYOUT_ID}:1`).get()).data()!; assert.equal(revision.previous, null); assert.equal(revision.actorId, admin.uid);
  const event = (await audits("service-layout:company:dining"))[0]; assert.equal(event.actorId, admin.uid); assert.deepEqual(event.details.after.categories, ["Dining", "Drinks", "Wine"]); assert.deepEqual(event.details.before.categories, SERVICE_LAYOUT_SEED.dining.categories);
  await rejects(run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Drinks", "Wine"], expectedVersion: 1, reason: REASON }), /Nothing to change/);
  await rejects(run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining"], expectedVersion: 0, reason: REASON }), /changed elsewhere/);
  await run({ action: "set-service-categories", serviceId: "breakfast", categories: ["Drinks", "Breakfast", "Sweet treats"], hidden: true, expectedVersion: 1, reason: "Hide breakfast while menus are rebuilt" });
  assert.equal((await stored())!.version, 2); assert.equal((await stored())!.services.breakfast?.hidden, true);
  assert.equal((await layoutRevisions().doc(`${COMPANY_LAYOUT_ID}:2`).get()).data()!.previous.version, 1);
});

test("input validation: unknown service, empty categories, short reason, unknown or inactive site all fail without writing", { skip: !enabled }, async () => {
  await reset(); const site = await seedOploc("a"), inactive = await seedOploc("old", "archived");
  await rejects(run({ action: "set-service-categories", serviceId: "brunch", categories: ["Drinks"], expectedVersion: 0, reason: REASON }), /known service/);
  await rejects(run({ action: "set-service-categories", serviceId: "lunch", categories: [], expectedVersion: 0, reason: REASON }), /at least one category/);
  await rejects(run({ action: "set-service-categories", serviceId: "lunch", categories: ["Lunch"], expectedVersion: 0, reason: "short" }), /reason/);
  await rejects(run({ action: "set-service-categories", serviceId: "lunch", categories: ["Lunch"], oplocId: "oploc:nope", expectedVersion: 0, reason: REASON }), /active location/);
  await rejects(run({ action: "set-service-categories", serviceId: "lunch", categories: ["Lunch"], oplocId: inactive, expectedVersion: 0, reason: REASON }), /active location/);
  await rejects(run({ action: "clear-service-override", serviceId: "lunch", oplocId: site, expectedVersion: 1, reason: REASON }), /changed elsewhere|no override/);
  assert.equal((await layoutCollection().get()).size, 0);
});

test("site override: sparse, replaces one service at one site, refuses a no-op against the company default, can be cleared", { skip: !enabled }, async () => {
  await reset(); const [rcoa, oac] = [await seedOploc("rcoa"), await seedOploc("oac")];
  await rejects(run({ action: "set-service-categories", serviceId: "dining", categories: SERVICE_LAYOUT_SEED.dining.categories.slice(), oplocId: rcoa, expectedVersion: 0, reason: REASON }), /matches the company default/);
  await run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Drinks", "Wine"], oplocId: rcoa, expectedVersion: 0, reason: REASON });
  const siteDoc = (await stored(rcoa))!; assert.equal(siteDoc.scope, "site"); assert.equal(siteDoc.oplocId, rcoa); assert.deepEqual(Object.keys(siteDoc.services), ["dining"], "sparse: only the overridden service");
  assert.equal(await stored(), undefined, "the company document is untouched");
  const layout = buildCataloguePackage({ items: [], offerings: [], prices: [], oplocs: [], routing: [], serviceLayout: await readStoredServiceLayouts() }, "2026-10-30").serviceLayout!;
  assert.ok(categoryAllowedForService(layout, rcoa, "dining", "Wine")); assert.ok(!categoryAllowedForService(layout, oac, "dining", "Wine")); assert.ok(!categoryAllowedForService(layout, rcoa, "breakfast", "Wine"));
  assert.deepEqual(resolveServiceCategories(layout, oac, "dining"), SERVICE_LAYOUT_SEED.dining.categories);
  await rejects(run({ action: "clear-service-override", serviceId: "lunch", oplocId: rcoa, expectedVersion: 1, reason: REASON }), /no override/);
  await run({ action: "clear-service-override", serviceId: "dining", oplocId: rcoa, expectedVersion: 1, reason: "Back to the company default" });
  assert.deepEqual((await stored(rcoa))!.services, {}); assert.equal((await stored(rcoa))!.version, 2);
  const after = buildCataloguePackage({ items: [], offerings: [], prices: [], oplocs: [], routing: [], serviceLayout: await readStoredServiceLayouts() }, "2026-10-30").serviceLayout!;
  assert.deepEqual(after.sites, {}); assert.ok(!categoryAllowedForService(after, rcoa, "dining", "Wine"));
  assert.equal((await audits(`service-layout:${rcoa}:dining`)).length, 2);
});

test("editor read model: versions are 0 until stored, then the per-document versions; the read writes nothing", { skip: !enabled }, async () => {
  await reset(); const rcoa = await seedOploc("rcoa");
  const payload = { rows: [{ status: "active", category: "Wine" }, { status: "active", category: "Drinks" }, { status: "archived", category: "Gone" }] as CatalogueRow[] } as CataloguePayload;
  const before = (await attachServiceLayout(payload)).serviceLayout!;
  assert.equal(before.company.version, 0); assert.deepEqual(before.sites, {});
  assert.deepEqual(before.vocabulary.catalogueCategories, ["Drinks", "Wine"], "archived Items do not contribute categories");
  assert.equal((await layoutCollection().get()).size, 0, "a read stores nothing");
  await run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Drinks", "Wine"], expectedVersion: 0, reason: REASON });
  await run({ action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Wine"], oplocId: rcoa, expectedVersion: 0, reason: REASON });
  await run({ action: "set-service-categories", serviceId: "lunch", categories: ["Lunch"], oplocId: rcoa, expectedVersion: 1, reason: REASON });
  const after = (await attachServiceLayout(payload)).serviceLayout!;
  assert.equal(after.company.version, 1); assert.equal(after.sites[rcoa].version, 2); assert.deepEqual(Object.keys(after.sites[rcoa].services).sort(), ["dining", "lunch"]);
  await run({ action: "clear-service-override", serviceId: "dining", oplocId: rcoa, expectedVersion: after.sites[rcoa].version, reason: "Back to company default" });
  const stored = await loadStoredServiceLayoutView();
  assert.equal(stored.sites[rcoa].version, 3); assert.deepEqual(Object.keys(stored.sites[rcoa].services), ["lunch"]);
  await rejects(run({ action: "set-service-categories", serviceId: "lunch", categories: ["Lunch", "Drinks"], oplocId: rcoa, expectedVersion: 2, reason: REASON }), /changed elsewhere/);
});
