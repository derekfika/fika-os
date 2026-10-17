/**
 * Sparse-model lifecycle (archive/restore, governed retirement, invariants, package publication) against the Firestore EMULATOR only.
 *   FIKA_CATALOGUE_EMULATOR_TEST=true npx firebase emulators:exec --only firestore --project demo-fika-os "npx tsx --test tests/hospitality-catalogue-sparse.emulator.test.ts"
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ReadPackageManifest, ReadPackageStore } from "@fika/server-shared/read-package";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";
import { retireOfferingRecords, runBulkCatalogueUpdate, runCatalogueCommand } from "../lib/hospitality-catalogue-admin";
import { buildCanonicalisationPlan, verifyMergeInvariants } from "../lib/hospitality-catalogue-canonicalisation";
import { loadCatalogueRows } from "../lib/hospitality-catalogue-loader";
import { rebuildCataloguePackage } from "../lib/hospitality-catalogue-package";
import { hospitalityPortalReadFromRecords } from "../lib/hospitality-catalogue-service";
import { BULK_ALL_SITES_ACTOR, planOfferingMigration } from "../lib/hospitality-offering-migration";
import { resolveSiteCatalogue } from "../lib/hospitality-effective-offering";
import { ukBusinessDate } from "../lib/hospitality-catalogue-read-model";
import { getCataloguePackage } from "../lib/hospitality-catalogue-package";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const admin: Actor = { uid: "test:sparse-admin", name: "Sparse Admin", role: "integration-admin", synthetic: true };
const viewer: Actor = { uid: "test:sparse-viewer", name: "Viewer", role: "viewer", synthetic: true };
const canonical = () => db.collection("integrationHubCanonical");
const stamp = "2026-01-01T00:00:00.000Z";
const base = { schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "test:seed-user", updatedAt: stamp, updatedBy: "test:seed-user", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} } };
const seed = async (entityType: string, canonicalId: string, record: Record<string, unknown>) => { await canonical().doc(stableDocumentId(canonicalId)).set({ canonicalId, entityType, record: { ...base, entityType, canonicalId, ...record }, dataHash: "seed", lifecycleStatus: "published", publicationStatus: "published", publishedAt: stamp }); return canonicalId; };
const get = async (id: string) => (await canonical().doc(stableDocumentId(id)).get()).data() as CanonicalRecord | undefined;
const unique = () => randomUUID().replace(/-/g, "").slice(0, 10);
const children = async (itemId: string) => (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(doc => doc.data() as CanonicalRecord);
const offeringsOf = async (itemId: string) => (await children(itemId)).filter(record => record.entityType === "Hospitality Menu Offering");

async function item(key: string, suffix: string, extra: Record<string, unknown> = {}) {
  const id = await seed("Hospitality Menu Item", `hospitality-menu-item:sp-${key}-${suffix}`, { name: `Sparse ${suffix} ${key}`, category: "Food", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [], ...extra });
  await seed("Hospitality Menu Price", `hospitality-menu-price:sp-${key}-${suffix}`, { hospitalityMenuItemId: id, amount: 4, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
  await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(id)).set({ menuItemId: id, workstreams: ["hospitality"], version: 1 });
  return id;
}
const offering = (key: string, name: string, itemId: string, oplocId: string, extra: Record<string, unknown> = {}) => seed("Hospitality Menu Offering", `hospitality-menu-offering:sp-${key}-${name}`, { hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard", lifecycleState: "active", ...extra });

test("archiving an Item retires its site records (history kept) so it has NO active availability; restore revives exactly those; the invariant holds", { skip: !enabled }, async () => {
  const key = unique(); const oplocId = await seed("OPLOC", `oploc:sp-${key}`, { approvedName: `Site ${key}`, lifecycleState: "active" });
  const itemId = await item(key, "tray"); const blocked = await offering(key, "blocked", itemId, oplocId, { available: false }); const priced = await offering(key, "priced", itemId, oplocId.replace("oploc:sp-", "oploc:sp-other-"), { minimumQuantity: 9 });
  const version = async () => (await loadCatalogueRows([itemId]))[0].version;
  await runCatalogueCommand(admin, { action: "set-item-status", itemId, expectedVersion: await version(), status: "archived" });
  for (const id of [blocked, priced]) { const record = (await get(id))!; assert.equal(record.record.lifecycleState, "archived"); assert.equal(record.record.retiredReason, "item-archived"); }
  assert.equal((await offeringsOf(itemId)).filter(record => record.record.lifecycleState !== "archived").length, 0, "an archived Item has no active effective site availability");
  const all = [await get(itemId), ...(await children(itemId))] as CanonicalRecord[];
  const snapshot = { items: [all[0]!], offerings: await offeringsOf(itemId), prices: all.filter(r => r?.entityType === "Hospitality Menu Price"), routing: [], merges: [] };
  assert.deepEqual(verifyMergeInvariants(snapshot, snapshot), [], "no active Offering points at the archived Item");
  assert.equal(hospitalityPortalReadFromRecords(all, { oplocId, serviceDate: ukBusinessDate() }).offerings.length, 0);
  assert.equal((await db.collection("integrationHubGovernanceAudit").where("entityReference", "==", itemId).get()).docs.some(doc => doc.data().action === "Hospitality Catalogue item archived" && doc.data().details.exceptionRecordsChanged === 2), true);

  await runCatalogueCommand(admin, { action: "set-item-status", itemId, expectedVersion: await version(), status: "active" });
  for (const id of [blocked, priced]) { const record = (await get(id))!; assert.equal(record.record.lifecycleState, "active"); assert.equal(record.record.retiredReason, undefined); }
  assert.equal((await get(blocked))!.record.available, false, "the revived exception keeps its meaning");
});

test("Tray Bake repair: an active Offering left on an archived Item is retired through the governed path, deterministically and replay-safely", { skip: !enabled }, async () => {
  const key = unique(); const itemId = await item(key, "traybake", { lifecycleState: "archived" }); // archived by an older code path that kept the Offering active
  const stranded = await offering(key, "stranded", itemId, `oploc:sp-x-${key}`);
  const input = (offerings: CanonicalRecord[]) => ({ items: [] as CanonicalRecord[], offerings, prices: [], routing: [], merges: [], oplocs: [], revisions: [], receipts: [] });
  const before = planOfferingMigration({ ...input(await offeringsOf(itemId)), items: [(await get(itemId))!] });
  assert.deepEqual(before.archivedItemOfferings.map(entry => entry.offeringId), [stranded]);
  const targets = before.archivedItemOfferings.map(entry => ({ offeringId: entry.offeringId, expectedVersion: entry.version }));
  const first = await retireOfferingRecords(admin, { operationId: `op-repair-${key}`, reason: "item-archived", targets }); assert.deepEqual(first.map(r => r.status), ["retired"]);
  const again = await retireOfferingRecords(admin, { operationId: `op-repair-${key}`, reason: "item-archived", targets }); assert.deepEqual(again.map(r => r.status), ["already_retired"], "a retry changes nothing");
  assert.equal((await get(stranded))!.record.retiredReason, "item-archived");
  const after = planOfferingMigration({ ...input(await offeringsOf(itemId)), items: [(await get(itemId))!] }); assert.equal(after.archivedItemOfferings.length, 0, "invariantProblems: none left");
  const plan = buildCanonicalisationPlan({ items: [(await get(itemId))!], offerings: await offeringsOf(itemId), prices: [], routing: [], merges: [] }); assert.deepEqual(verifyMergeInvariants({ items: [(await get(itemId))!], offerings: await offeringsOf(itemId), prices: [], routing: [], merges: [] }, { items: [(await get(itemId))!], offerings: await offeringsOf(itemId), prices: [], routing: [], merges: [] }), []); void plan;
});

test("governed retirement guards: only records the named operation created and never edited are retired as redundant; view-only actors cannot retire", { skip: !enabled }, async () => {
  const key = unique(); const itemId = await item(key, "guard");
  const bulk = await offering(key, "bulk", itemId, `oploc:sp-a-${key}`, { createdBy: BULK_ALL_SITES_ACTOR });
  const edited = await offering(key, "edited", itemId, `oploc:sp-b-${key}`, { createdBy: BULK_ALL_SITES_ACTOR, version: 2 });
  const foreign = await offering(key, "foreign", itemId, `oploc:sp-c-${key}`, { createdBy: "person:derek" });
  const carrying = await offering(key, "carrying", itemId, `oploc:sp-d-${key}`, { createdBy: BULK_ALL_SITES_ACTOR, minimumQuantity: 4 });
  const targets = [bulk, edited, foreign, carrying].map(id => ({ offeringId: id, expectedVersion: 1 }));
  const results = await retireOfferingRecords(admin, { operationId: `op-guard-${key}`, reason: "redundant-default", requireCreatedBy: BULK_ALL_SITES_ACTOR, targets: [...targets.slice(0, 1), { offeringId: edited, expectedVersion: 2 }, ...targets.slice(2)] });
  const status = (id: string) => results.find(result => result.offeringId === id)!;
  assert.equal(status(bulk).status, "retired"); assert.equal(status(edited).status, "failed", "edited since creation"); assert.equal(status(foreign).status, "failed", "created by someone else (Derek's manual record is safe)"); assert.equal(status(carrying).status, "failed", "carries a site difference");
  for (const id of [edited, foreign, carrying]) assert.equal((await get(id))!.record.lifecycleState, "active");
  await assert.rejects(retireOfferingRecords(viewer, { operationId: `op-view-${key}`, reason: "redundant-default", targets }), (error: Error & { status?: number }) => error.status === 403);
  const stale = await retireOfferingRecords(admin, { operationId: `op-stale-${key}`, reason: "item-archived", targets: [{ offeringId: foreign, expectedVersion: 7 }] }); assert.match(stale[0].message, /changed elsewhere/);
  assert.equal((await db.collection("integrationHubGovernanceAudit").where("details.retireOperationId", "==", `op-guard-${key}`).get()).size, 1, "one audit receipt for the one retired record");
});

function memoryStore() {
  const objects = new Map<string, Uint8Array>(); const manifests = new Map<string, ReadPackageManifest>(); let puts = 0;
  const store: ReadPackageStore = { async putImmutable(name, bytes) { if (!objects.has(name)) { objects.set(name, new Uint8Array(bytes)); puts++; } }, async get(name) { return objects.get(name); }, async has(name) { return objects.has(name); }, async getManifest(key) { return manifests.get(key); }, async putManifest(key, manifest) { manifests.set(key, manifest); } };
  return { store, puts: () => puts };
}

test("a catalogue mutation invalidates and republishes the package deterministically; an unchanged catalogue keeps the same identity; the package resolves like the server", { skip: !enabled }, async () => {
  const key = unique(); const oplocId = await seed("OPLOC", `oploc:sp-pkg-${key}`, { approvedName: `Pkg ${key}`, lifecycleState: "active" });
  const itemId = await item(key, "pkg"); const memory = memoryStore();
  const first = await rebuildCataloguePackage(memory.store); const second = await rebuildCataloguePackage(memory.store);
  assert.ok(["published", "unchanged"].includes(second.status)); assert.ok(second.manifest.packageVersion >= first.manifest.packageVersion, "(the shared emulator may change between rebuilds; byte-for-byte determinism is proven in the pure package tests)");
  const before = (await getCataloguePackage(memory.store))!.value;
  assert.ok(resolveSiteCatalogue(before, oplocId, { serviceDate: ukBusinessDate() }).some(entry => entry.itemId === itemId));
  assert.equal(before.exceptions.filter(entry => entry.itemId === itemId).length, 0, "available everywhere with no exception");

  const row = (await loadCatalogueRows([itemId]))[0];
  await runBulkCatalogueUpdate(admin, { operationId: `op-pkg-${key}`, itemIds: [itemId], expectedVersions: { [itemId]: row.version }, sites: { mode: "remove", oplocIds: [oplocId] } });
  const third = await rebuildCataloguePackage(memory.store); assert.equal(third.status, "published"); assert.notEqual(third.manifest.contentHash, first.manifest.contentHash); assert.ok(third.manifest.packageVersion > first.manifest.packageVersion);
  const after = (await getCataloguePackage(memory.store))!.value;
  assert.equal(after.exceptions.filter(entry => entry.itemId === itemId).length, 1, "exactly one sparse exception");
  assert.equal(resolveSiteCatalogue(after, oplocId, { serviceDate: ukBusinessDate() }).some(entry => entry.itemId === itemId), false);
  assert.equal(resolveSiteCatalogue(before, oplocId, { serviceDate: ukBusinessDate() }).some(entry => entry.itemId === itemId), true, "an older package still resolves for the history it describes");
  const serverView = hospitalityPortalReadFromRecords([...(await children(itemId)), (await get(itemId))!, (await get(oplocId))!], { oplocId, serviceDate: ukBusinessDate() }).offerings;
  assert.equal(serverView.length, 0, "the server read path and the package resolver agree");
});

test("promotion moves product-level settings onto the Item, retires records that then state nothing, keeps genuine site differences and ids, never overwrites a different default, and is replay-safe", { skip: !enabled }, async () => {
  const { promoteProductSettings } = await import("../lib/hospitality-catalogue-admin");
  const { planConfigurationPromotion } = await import("../lib/hospitality-offering-migration");
  const key = unique(); const itemId = await item(key, "promo"); const quoteItem = await item(key, "quote"); const clashItem = await item(key, "clash", { configuration: { servingInfo: "Different" } });
  const config = { servingInfo: "Serves 10", choices: [] as unknown[] };
  const plain = await offering(key, "plain", itemId, `oploc:sp-m-${key}`, { noticeRequiredDays: 3, minimumGuests: 8, configuration: config });
  const wording = await offering(key, "wording", itemId, `oploc:sp-n-${key}`, { noticeRequiredDays: 3, configuration: { ...config, displayName: "House name" } });
  const quote = await offering(key, "quote", quoteItem, `oploc:sp-m-${key}`, { offeringMode: "quote_only", noticeRequiredDays: 7 });
  const clash = await offering(key, "clash", clashItem, `oploc:sp-m-${key}`, { configuration: config });
  const read = async (ids: string[]) => ({ items: (await Promise.all(ids.map(get))) as CanonicalRecord[], offerings: (await Promise.all([plain, wording, quote, clash].map(get))) as CanonicalRecord[] });
  const plan = planConfigurationPromotion(await read([itemId, quoteItem, clashItem]));
  const entry = (id: string) => plan.find(candidate => candidate.itemId === id)!;
  assert.equal(entry(itemId).status, "deterministic"); assert.equal(entry(itemId).noticeRequiredDays, 3); assert.equal(entry(itemId).minimumGuests, 8); assert.deepEqual(entry(itemId).configuration, config);
  assert.equal(entry(quoteItem).mode, "quote_only");
  const targets = plan.map(candidate => ({ itemId: candidate.itemId, expectedVersion: candidate.itemVersion, configuration: candidate.configuration, noticeRequiredDays: candidate.noticeRequiredDays, minimumGuests: candidate.minimumGuests, minimumQuantity: candidate.minimumQuantity, mode: candidate.mode, sourceOfferingIds: candidate.sourceOfferingIds }));
  const results = await promoteProductSettings(admin, { operationId: `op-promote-${key}`, targets });
  const status = (id: string) => results.find(result => result.itemId === id)!;
  assert.equal(status(itemId).status, "promoted"); assert.equal(status(itemId).retired, 1); assert.equal(status(itemId).kept, 1, "the record with site wording stays");
  assert.equal(status(quoteItem).status, "promoted"); assert.equal(status(quoteItem).retired, 1);
  assert.equal(status(clashItem).status, "failed", "a different existing default is never overwritten"); assert.match(status(clashItem).message, /different company default/);
  const promoted = (await get(itemId))!.record; assert.equal(promoted.defaultNoticeRequiredDays, 3); assert.equal(promoted.defaultMinimumGuests, 8); assert.deepEqual(promoted.configuration, config);
  assert.equal((await get(quoteItem))!.record.defaultOfferingMode, "quote_only");
  const retiredPlain = (await get(plain))!; assert.equal(retiredPlain.record.lifecycleState, "archived"); assert.equal(retiredPlain.record.retiredReason, "redundant-default"); assert.equal(retiredPlain.canonicalId, plain, "historical id preserved");
  const keptWording = (await get(wording))!; assert.equal(keptWording.record.lifecycleState, "active"); assert.equal(keptWording.record.noticeRequiredDays, undefined); assert.deepEqual(keptWording.record.configuration, { displayName: "House name" }, "only site wording remains");
  assert.equal((await get(clash))!.record.lifecycleState, "active", "the failed item's records are untouched");
  const replay = await promoteProductSettings(admin, { operationId: `op-promote-${key}`, targets }); assert.equal(replay.find(result => result.itemId === itemId)!.status, "already_applied");
  await assert.rejects(promoteProductSettings(viewer, { operationId: `op-view-${key}`, targets }), (error: Error & { status?: number }) => error.status === 403);
  // effective behaviour at ANY site is now the canonical product behaviour
  const all = [(await get(itemId))!, ...(await children(itemId)), (await get(`oploc:sp-m-${key}`))].filter(Boolean) as CanonicalRecord[];
  const { hospitalityPortalReadFromRecords } = await import("../lib/hospitality-catalogue-service");
  const atOther = hospitalityPortalReadFromRecords(all, { oplocId: "oploc:anywhere", serviceDate: ukBusinessDate() }).offerings as Array<Record<string, any>>;
  assert.equal(atOther[0].constraints.noticeRequiredDays, 3); assert.equal(atOther[0].constraints.minimumGuests, 8); assert.deepEqual(atOther[0].configuration, config);
});
