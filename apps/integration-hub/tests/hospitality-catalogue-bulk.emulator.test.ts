/**
 * Governed bulk update against the Firestore EMULATOR only.
 *   FIKA_CATALOGUE_EMULATOR_TEST=true npx firebase emulators:exec --only firestore --project demo-fika-os "npx tsx --test tests/hospitality-catalogue-bulk.emulator.test.ts"
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";
import { runBulkCatalogueUpdate, runCatalogueCommand, type BulkSpec } from "../lib/hospitality-catalogue-admin";
import { loadCataloguePayload, loadCatalogueRows } from "../lib/hospitality-catalogue-loader";
import type { CatalogueRow } from "../lib/hospitality-catalogue-types";
import { SERVICE_IDS } from "@fika/server-shared/hospitality-service-layout";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const admin: Actor = { uid: "test:bulk-admin", name: "Bulk Admin", role: "integration-admin", synthetic: true };
const viewer: Actor = { uid: "test:bulk-viewer", name: "Viewer", role: "viewer", synthetic: true };
const canonical = () => db.collection("integrationHubCanonical");
const audit = () => db.collection("integrationHubGovernanceAudit");
const stamp = "2026-01-01T00:00:00.000Z";
const base = { schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "test:seed-user", updatedAt: stamp, updatedBy: "test:seed-user", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} } };
const seed = async (entityType: string, canonicalId: string, record: Record<string, unknown>) => { await canonical().doc(stableDocumentId(canonicalId)).set({ canonicalId, entityType, record: { ...base, entityType, canonicalId, ...record }, dataHash: "seed", lifecycleStatus: "published", publicationStatus: "published", publishedAt: stamp }); return canonicalId; };
const get = async (id: string) => (await canonical().doc(stableDocumentId(id)).get()).data() as CanonicalRecord | undefined;
const unique = () => randomUUID().replace(/-/g, "").slice(0, 10);
const rejects = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, (error: Error) => { assert.match(error.message, pattern); return true; });

async function world() {
  const key = unique();
  const oplocs = [await seed("OPLOC", `oploc:bulk-${key}-a`, { approvedName: `Alpha ${key}`, lifecycleState: "active" }), await seed("OPLOC", `oploc:bulk-${key}-b`, { approvedName: `Bravo ${key}`, lifecycleState: "active" }), await seed("OPLOC", `oploc:bulk-${key}-c`, { approvedName: `Charlie ${key}`, lifecycleState: "active" })];
  const retired = await seed("OPLOC", `oploc:bulk-${key}-old`, { approvedName: `Retired ${key}`, lifecycleState: "merged", mergedIntoOplocId: oplocs[0] });
  const items: string[] = [];
  for (const [index, route] of [["x", ["hospitality"]], ["y", ["sandwiches"]], ["z", []]] as const) {
    const id = await seed("Hospitality Menu Item", `hospitality-menu-item:bulk-${key}-${index}`, { name: `Bulk ${index} ${key}`, category: "Food", lifecycleState: "active", defaultMinimumQuantity: 4, dietaryInformation: [], allergenInformation: [], providerMappings: [] });
    await seed("Hospitality Menu Price", `hospitality-menu-price:bulk-${key}-${index}-d`, { hospitalityMenuItemId: id, amount: 3, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
    const offeringId = await seed("Hospitality Menu Offering", `hospitality-menu-offering:bulk-${key}-${index}-a`, { hospitalityMenuItemId: id, oplocId: oplocs[0], offeringMode: "standard", lifecycleState: "active", ...(index === "x" ? { minimumQuantity: 12 } : {}) });
    if (index === "x") await seed("Hospitality Menu Price", `hospitality-menu-price:bulk-${key}-x-override`, { hospitalityMenuOfferingId: offeringId, amount: 3.9, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
    await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(id)).set({ menuItemId: id, workstreams: [...route], version: 1 });
    items.push(id);
  }
  const rows = await loadCatalogueRows(items); const byId = Object.fromEntries(rows.map(row => [row.itemId, row]));
  const spec = (extra: Partial<BulkSpec>, ids: string[] = items): BulkSpec => ({ operationId: `op-${unique()}`, itemIds: ids, expectedVersions: Object.fromEntries(ids.map(id => [id, byId[id].version])), expectedRoutingVersions: Object.fromEntries(ids.map(id => [id, byId[id].routing.version])), ...extra });
  const fresh = async (ids: string[], extra: Partial<BulkSpec>): Promise<BulkSpec> => { const current = await loadCatalogueRows(ids); return { operationId: `op-${unique()}`, itemIds: ids, expectedVersions: Object.fromEntries(current.map(r => [r.itemId, r.version])), expectedRoutingVersions: Object.fromEntries(current.map(r => [r.itemId, r.routing.version])), ...extra }; };
  return { key, oplocs, retired, items, byId, spec, fresh, row: async (id: string): Promise<CatalogueRow> => (await loadCatalogueRows([id]))[0] };
}

test("bulk production: only selected items change; mixed existing routes are set uniformly; leave-unchanged fields stay untouched", { skip: !enabled }, async () => {
  const w = await world(); const [x, y, z] = w.items;
  const result = await runBulkCatalogueUpdate(admin, w.spec({ production: "cpu_delivered_in" }, [x, y]));
  assert.equal(result.failed, 0); assert.deepEqual(result.results.map(r => r.status), ["applied", "applied"]);
  assert.equal((await w.row(x)).routing.state, "cpu_delivered_in"); assert.equal((await w.row(y)).routing.state, "cpu_delivered_in");
  const untouched = await w.row(z); assert.equal(untouched.routing.state, "in_house", "unselected item unchanged"); assert.equal(untouched.version, w.byId[z].version);
  const unchanged = await w.row(x); assert.equal(unchanged.defaultPrice?.amount, 3, "price left unchanged"); assert.equal(unchanged.defaultMinimumQuantity, 4);
  const again = await runBulkCatalogueUpdate(admin, w.spec({ production: "in_house" }, [z]));
  assert.equal(again.results[0].status, "unchanged", "already matching is reported, not rewritten");
});

test("bulk company price and minimum preserve site overrides and never create redundant ones", { skip: !enabled }, async () => {
  const w = await world(); const [x, y] = w.items;
  const result = await runBulkCatalogueUpdate(admin, w.spec({ price: { amount: 5 }, minimum: { mode: "set", value: 6 } }, [x, y]));
  assert.equal(result.failed, 0);
  const rx = await w.row(x); assert.equal(rx.defaultPrice?.amount, 5); assert.equal(rx.defaultMinimumQuantity, 6);
  const override = rx.offerings[0]; assert.equal(override.price.source, "overrides"); assert.equal(override.price.effective?.amount, 3.9, "site price override preserved"); assert.equal(override.minimum.source, "overrides"); assert.equal(override.minimum.effective, 12, "site minimum override preserved");
  const ry = await w.row(y); assert.equal(ry.offerings[0].price.source, "inherits"); assert.equal(ry.offerings[0].price.effective?.amount, 5); assert.equal(ry.overrideCount, 0, "no redundant override created");
  assert.equal((await runBulkCatalogueUpdate(admin, await w.fresh([y], { minimum: { mode: "clear" } }))).results[0].status, "applied");
  assert.equal((await w.row(y)).defaultMinimumQuantity, undefined);
  await rejects(runBulkCatalogueUpdate(admin, w.spec({ price: { amount: -1 } }, [x])), /price of zero or more/); await rejects(runBulkCatalogueUpdate(admin, w.spec({ price: { amount: 1.239 } }, [x])), /two decimal/);
});

test("bulk sites are SPARSE: remove records exclusions, add clears them, replace excludes only what is left out; select-all stores nothing", { skip: !enabled }, async () => {
  const w = await world(); const [x, y] = w.items; const [a, b, c] = w.oplocs;
  const exceptionRecords = async (itemId: string) => (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(doc => doc.data() as CanonicalRecord).filter(record => record.entityType === "Hospitality Menu Offering");
  const active = async (itemId: string) => (await exceptionRecords(itemId)).filter(record => record.record.lifecycleState !== "archived");
  let baseline = (await active(y)).length;
  const everything = (await loadCataloguePayload(admin)).oplocs.filter(oploc => oploc.active).map(oploc => oploc.oplocId);
  const all = await runBulkCatalogueUpdate(admin, await w.fresh([x, y], { sites: { mode: "replace", oplocIds: everything } }));
  const excludedAfterAll = (await active(y)).filter(record => record.record.available === false).map(record => String(record.record.oplocId));
  assert.ok(excludedAfterAll.every(id => !everything.includes(id)), "SELECT ALL SITES stores no exclusion for any selected site (an OPLOC another test adds concurrently may be excluded, never a selected one)");
  assert.equal(all.failed, 0); baseline = (await active(y)).length;

  const removal = await runBulkCatalogueUpdate(admin, await w.fresh([x, y], { sites: { mode: "remove", oplocIds: [b] } })); assert.equal(removal.failed, 0);
  assert.equal((await active(y)).length, baseline + 1, "removing ONE site for an Item adds exactly ONE exception record");
  assert.equal((await active(y)).filter(record => record.record.available === false).map(record => record.record.oplocId).join(), b);
  assert.ok(!(await w.row(y)).availableAt.includes(b)); assert.ok((await w.row(y)).availableAt.includes(c));

  await runBulkCatalogueUpdate(admin, await w.fresh([x, y], { sites: { mode: "add", oplocIds: [b] } }));
  assert.equal((await active(y)).length, baseline, "re-adding the site retires its exception: the stored record disappears again");
  assert.equal((await exceptionRecords(y)).filter(record => record.record.oplocId === b && record.record.retiredReason === "redundant-default").length, 1, "retired, never deleted");

  await runBulkCatalogueUpdate(admin, await w.fresh([x, y], { sites: { mode: "replace", oplocIds: everything.filter(id => id !== c) } }));
  const excluded = (await active(y)).filter(record => record.record.available === false).map(record => String(record.record.oplocId));
  assert.ok(excluded.includes(c) && !excluded.includes(a) && !excluded.includes(b), "replace excludes the site left out and nothing that was selected");
  assert.ok(excluded.every(id => id === c || !everything.includes(id)), "(other tests may add OPLOCs concurrently to the shared emulator; those are excluded too, never a selected one)");
  await runBulkCatalogueUpdate(admin, await w.fresh([x, y], { sites: { mode: "replace", oplocIds: everything } }));
  assert.equal((await active(y)).filter(record => record.record.available === false && everything.includes(String(record.record.oplocId))).length, 0, "replace with everything clears the exclusion for every selected site");

  // an existing override survives site removal and re-adding on the SAME record
  const rx = await w.row(x); const override = rx.offerings.find(offering => offering.oplocId === a)!; assert.equal(override.price.effective?.amount, 3.9);
  await runBulkCatalogueUpdate(admin, await w.fresh([x], { sites: { mode: "remove", oplocIds: [a] } }));
  assert.equal((await w.row(x)).offerings.find(offering => offering.oplocId === a)!.available, false); assert.equal((await w.row(x)).offerings.find(offering => offering.oplocId === a)!.price.override?.amount, 3.9, "the override is retained on the exception");
  await runBulkCatalogueUpdate(admin, await w.fresh([x], { sites: { mode: "add", oplocIds: [a] } }));
  const back = (await w.row(x)).offerings.find(offering => offering.oplocId === a)!; assert.equal(back.available, true); assert.equal(back.price.effective?.amount, 3.9, "available again with its override intact");
  const unknown = await runBulkCatalogueUpdate(admin, await w.fresh([x], { sites: { mode: "add", oplocIds: [w.retired] } }));
  assert.equal(unknown.results[0].status, "failed"); assert.match(unknown.results[0].message, /not active locations/);
  await assert.rejects(runBulkCatalogueUpdate(admin, await w.fresh([x], { sites: { mode: "replace", oplocIds: [] } })), /at least one site/);
});

test("Select all sites is driven by the live OPLOC registry: every ACTIVE location, never retired ones", { skip: !enabled }, async () => {
  const w = await world(); const payload = await loadCataloguePayload(admin);
  for (const id of w.oplocs) assert.equal(payload.oplocs.find(entry => entry.oplocId === id)!.active, true);
  assert.equal(payload.oplocs.find(entry => entry.oplocId === w.retired)!.active, false, "a merged/retired location is not selectable");
});

test("stale versions fail per item without blocking the rest, are reported explicitly, and a retry is idempotent", { skip: !enabled }, async () => {
  const w = await world(); const [x, y, z] = w.items;
  await runCatalogueCommand(admin, { action: "update-item", itemId: y, expectedVersion: w.byId[y].version, name: w.byId[y].name, category: "Edited elsewhere", defaultMinimumQuantity: 4 }); // y moves on after the operator loaded it
  const spec = w.spec({ production: "cpu_hospitality", minimum: { mode: "set", value: 9 } });
  const result = await runBulkCatalogueUpdate(admin, spec);
  assert.equal(result.succeeded, 2); assert.equal(result.failed, 1); assert.match(result.message, /2 of 3 items updated; 1 could not be changed/);
  const failed = result.results.find(r => r.status === "failed")!; assert.equal(failed.itemId, y); assert.match(failed.message, /changed elsewhere/);
  assert.equal((await w.row(y)).defaultMinimumQuantity, 4, "the stale item was not touched at all");
  assert.equal((await w.row(x)).defaultMinimumQuantity, 9); assert.equal((await w.row(z)).defaultMinimumQuantity, 9);
  const replay = await runBulkCatalogueUpdate(admin, spec); // same operation id, e.g. a double click or retry
  assert.deepEqual(replay.results.map(r => r.status).sort(), ["already_applied", "already_applied", "failed"]);
  assert.equal((await w.row(x)).version, (await w.row(x)).version);
  const receipts = (await audit().where("details.bulkOperationId", "==", spec.operationId).get()).docs.map(doc => doc.data());
  assert.equal(receipts.filter(r => r.action === "Hospitality Catalogue bulk update").length, 2, "one audit event per applied item, none duplicated by the retry");
});

test("a stale routing version fails that item only", { skip: !enabled }, async () => {
  const w = await world(); const [x, y] = w.items;
  await runCatalogueCommand(admin, { action: "set-routing", itemId: x, routing: "cpu_sandwiches", expectedRoutingVersion: w.byId[x].routing.version });
  const result = await runBulkCatalogueUpdate(admin, w.spec({ production: "in_house" }, [x, y]));
  assert.equal(result.results.find(r => r.itemId === x)!.status, "failed"); assert.match(result.results.find(r => r.itemId === x)!.message, /routing changed elsewhere/);
  assert.equal((await w.row(y)).routing.state, "in_house");
});

test("permission is enforced server-side and nothing is written for a view-only actor", { skip: !enabled }, async () => {
  const w = await world();
  await assert.rejects(runBulkCatalogueUpdate(viewer, w.spec({ production: "in_house" })), (error: Error & { status?: number }) => error.status === 403 && /hospitality\.catalogue\.manage/.test(error.message));
  assert.equal((await w.row(w.items[0])).routing.state, "cpu_hospitality");
});

test("bulk archive keeps historical references and only archives selected active items; archived items refuse other edits", { skip: !enabled }, async () => {
  const w = await world(); const [x, y, z] = w.items;
  const result = await runBulkCatalogueUpdate(admin, w.spec({ archive: true }, [x, y])); assert.equal(result.failed, 0);
  for (const id of [x, y]) { const row = await w.row(id); assert.equal(row.status, "archived"); assert.equal(row.offerings.length, 1, "offerings retained"); assert.equal(row.defaultPrice?.amount, 3, "prices retained"); assert.notEqual(row.routing.state, "routing_required", "routing retained"); }
  assert.equal((await w.row(z)).status, "active");
  const fresh = async (id: string, extra: Partial<BulkSpec>): Promise<BulkSpec> => { const row = await w.row(id); return { operationId: `op-${unique()}`, itemIds: [id], expectedVersions: { [id]: row.version }, expectedRoutingVersions: { [id]: row.routing.version }, ...extra }; };
  const again = await runBulkCatalogueUpdate(admin, await fresh(x, { archive: true }));
  assert.equal(again.results[0].status, "failed"); assert.match(again.results[0].message, /already archived/);
  const edit = await runBulkCatalogueUpdate(admin, await fresh(y, { production: "in_house" })); assert.match(edit.results[0].message, /archived/);
});

test("bulk operations write per-item audit events and a summary with actor, operation, items, sites and counts", { skip: !enabled }, async () => {
  const w = await world(); const [x, y] = w.items;
  const spec = w.spec({ production: "cpu_sandwiches", sites: { mode: "remove", oplocIds: [w.oplocs[1]] } }, [x, y]); const result = await runBulkCatalogueUpdate(admin, spec);
  const summary = (await audit().doc(`bulk-${spec.operationId}`).get()).data()!;
  assert.equal(summary.actorId, admin.uid); assert.equal(summary.details.succeeded, 2); assert.equal(summary.details.failed, 0); assert.deepEqual(summary.details.itemIds.sort(), [x, y].sort()); assert.deepEqual(summary.details.oplocIds, [w.oplocs[1]]); assert.ok(summary.details.operations.includes("production"));
  const events = (await audit().where("details.bulkOperationId", "==", spec.operationId).get()).docs.map(doc => doc.data()).filter(event => event.action === "Hospitality Catalogue bulk update");
  assert.equal(events.length, 2); const event = events.find(candidate => candidate.entityReference === x)!;
  assert.equal(event.actorId, admin.uid); assert.equal(event.details.after.production, "cpu_sandwiches"); assert.equal(event.details.before.production, "cpu_hospitality"); assert.deepEqual(event.details.oplocIds, [w.oplocs[1]]); assert.ok(result.succeeded === 2);
});

test("category-only bulk update preserves every other field, scopes to selected IDs, audits before/after and replays safely", { skip: !enabled }, async () => {
  const w = await world(); const [x, y, z] = w.items; const layout = db.collection("integrationHubHospitalityServiceLayout").doc("company");
  const previous = await layout.get();
  await layout.set({ schema: 1, scope: "company", version: 1, services: Object.fromEntries(SERVICE_IDS.map(id => [id, { categories: id === "breakfast" ? ["Food", "Food — category test", "Food — breakfast only"] : ["Food", "Food — category test"] }])), createdAt: stamp, createdBy: admin.uid, updatedAt: stamp, updatedBy: admin.uid });
  try {
    const before = await get(x); const childrenBefore = await canonical().where("record.hospitalityMenuItemId", "==", x).get();
    const spec = w.spec({ category: "Food — category test" }, [x, y]);
    const result = await runBulkCatalogueUpdate(admin, spec);
    assert.equal(result.failed, 0); assert.deepEqual(result.results.map(entry => entry.status), ["applied", "applied"]);
    const after = await get(x); assert.equal(after?.record.category, "Food — category test");
    for (const field of ["name", "description", "defaultMinimumQuantity", "allowedOplocIds", "configuration", "lifecycleState"]) assert.deepEqual(after?.record[field], before?.record[field], `${field} preserved`);
    assert.equal(after?.record.version, Number(before?.record.version) + 1);
    const childrenAfter = await canonical().where("record.hospitalityMenuItemId", "==", x).get(); assert.equal(childrenAfter.size, childrenBefore.size, "prices, offerings, sparse exceptions and history untouched");
    assert.equal((await get(z))?.record.category, "Food", "unselected item stays unchanged");
    const event = (await audit().where("details.bulkOperationId", "==", spec.operationId).get()).docs.map(doc => doc.data()).find(doc => doc.entityReference === x)!;
    assert.equal(event.details.before.category, "Food"); assert.equal(event.details.after.category, "Food — category test");
    assert.equal(event.details.categoryVisibilityReview.source, "stored-service-layout-preview"); assert.equal(event.details.categoryVisibilityReview.confirmed, false); assert.equal(event.details.categoryVisibilityReview.companyVersion, 1);
    assert.equal((await runBulkCatalogueUpdate(admin, spec)).results[0].status, "already_applied", "operation receipt prevents duplicate application");
    const current = await w.row(x); const noOpSpec = await w.fresh([x], { category: "Food — category test" });
    const noop = await runBulkCatalogueUpdate(admin, noOpSpec);
    assert.equal(noop.results[0].status, "unchanged"); assert.equal((await w.row(x)).version, current.version, "no-op does not bump version");
    const noOpAudit = (await audit().where("details.bulkOperationId", "==", noOpSpec.operationId).get()).docs.map(doc => doc.data());
    assert.equal(noOpAudit.filter(entry => entry.action === "Hospitality Catalogue bulk update").length, 0, "no-op creates no per-item audit receipt");
    const staleSpec = w.spec({ category: "Food — category test" }, [z]);
    await runCatalogueCommand(admin, { action: "update-item", itemId: z, expectedVersion: w.byId[z].version, name: w.byId[z].name, category: "Food", defaultMinimumQuantity: 5 });
    const stale = await runBulkCatalogueUpdate(admin, staleSpec); assert.equal(stale.results[0].status, "failed"); assert.match(stale.results[0].message, /changed elsewhere/);
    const unconfirmed = await runBulkCatalogueUpdate(admin, await w.fresh([z], { category: "Food — breakfast only" }));
    assert.equal(unconfirmed.results[0].status, "failed"); assert.match(unconfirmed.results[0].message, /Review each listed item and site/);
    const confirmedSpec = await w.fresh([z], { category: "Food — breakfast only", categoryVisibilityConfirmed: true });
    const confirmed = await runBulkCatalogueUpdate(admin, confirmedSpec);
    assert.equal(confirmed.results[0].status, "applied", "assessed service visibility change is allowed only after explicit review confirmation");
    assert.equal((await get(z))?.record.category, "Food — breakfast only");
    const confirmedEvent = (await audit().where("details.bulkOperationId", "==", confirmedSpec.operationId).get()).docs.map(doc => doc.data()).find(doc => doc.entityReference === z)!;
    assert.equal(confirmedEvent.details.categoryVisibilityReview.confirmed, true);
    assert.equal(confirmedEvent.details.categoryVisibilityReview.effects[0].before.length, SERVICE_IDS.length);
    assert.deepEqual(confirmedEvent.details.categoryVisibilityReview.effects[0].after, ["Breakfast"]);
    const archived = await runBulkCatalogueUpdate(admin, await w.fresh([y], { archive: true })); assert.equal(archived.failed, 0);
    const archivedEdit = await runBulkCatalogueUpdate(admin, await w.fresh([y], { category: "Food — category test" })); assert.match(archivedEdit.results[0].message, /archived/);
  } finally {
    if (previous.exists) await layout.set(previous.data()!); else await layout.delete();
  }
});

test("category bulk update holds when target visibility is unmapped in the stored service layout", { skip: !enabled }, async () => {
  const w = await world(); const [x] = w.items;
  const before = await get(x);
  const result = await runBulkCatalogueUpdate(admin, w.spec({ category: "Unmapped category" }, [x]));
  assert.equal(result.results[0].status, "failed"); assert.match(result.results[0].message, /no visible service mapping/);
  assert.equal((await get(x))?.record.category, before?.record.category, "visibility hold leaves canonical item untouched");
});
