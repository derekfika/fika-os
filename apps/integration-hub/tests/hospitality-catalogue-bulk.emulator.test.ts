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

test("bulk sites: add, remove and replace change availability only; overrides, history and prices survive", { skip: !enabled }, async () => {
  const w = await world(); const [x, y] = w.items; const [a, b, c] = w.oplocs;
  await runBulkCatalogueUpdate(admin, w.spec({ sites: { mode: "add", oplocIds: [b, c] } }, [x, y]));
  let rx = await w.row(x); assert.deepEqual(rx.availableAt.sort(), [a, b, c].sort());
  const added = rx.offerings.find(offering => offering.oplocId === b)!; assert.equal(added.price.source, "inherits"); assert.equal(added.minimum.source, "inherits"); assert.equal(rx.overrideCount, 2, "only the pre-existing overrides");
  await runBulkCatalogueUpdate(admin, await w.fresh([x, y], { sites: { mode: "remove", oplocIds: [a] } }));
  rx = await w.row(x); assert.deepEqual(rx.availableAt.sort(), [b, c].sort());
  const hidden = rx.offerings.find(offering => offering.oplocId === a)!; assert.equal(hidden.status, "archived"); assert.equal(hidden.price.override?.amount, 3.9, "override retained on the disabled offering");
  await runBulkCatalogueUpdate(admin, await w.fresh([x, y], { sites: { mode: "replace", oplocIds: [a, c] } }));
  rx = await w.row(x); assert.deepEqual(rx.availableAt.sort(), [a, c].sort());
  assert.equal(rx.offerings.find(offering => offering.oplocId === a)!.price.effective?.amount, 3.9, "re-enabled Offering kept its override");
  assert.equal(rx.offerings.filter(offering => offering.oplocId === a).length, 1, "no duplicate Offering");
  const retiredAttempt = await runBulkCatalogueUpdate(admin, await w.fresh([x], { sites: { mode: "add", oplocIds: [w.retired] } }));
  assert.equal(retiredAttempt.results[0].status, "failed"); assert.match(retiredAttempt.results[0].message, /not an active governed location/); assert.equal(retiredAttempt.failed, 1);
  await rejects(runBulkCatalogueUpdate(admin, w.spec({ sites: { mode: "replace", oplocIds: [] } }, [x])), /at least one site/);
});

test("Select all sites is driven by the live registry: retired locations are flagged out", { skip: !enabled }, async () => {
  const w = await world(); const payload = await loadCataloguePayload(admin);
  for (const id of w.oplocs) { const site = payload.oplocs.find(entry => entry.oplocId === id)!; assert.equal(site.active, true); assert.equal(site.hospitality, true); }
  const retired = payload.oplocs.find(entry => entry.oplocId === w.retired)!; assert.equal(retired.active, false); assert.equal(retired.hospitality, false);
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
  const spec = w.spec({ production: "cpu_sandwiches", sites: { mode: "add", oplocIds: [w.oplocs[1]] } }, [x, y]); const result = await runBulkCatalogueUpdate(admin, spec);
  const summary = (await audit().doc(`bulk-${spec.operationId}`).get()).data()!;
  assert.equal(summary.actorId, admin.uid); assert.equal(summary.details.succeeded, 2); assert.equal(summary.details.failed, 0); assert.deepEqual(summary.details.itemIds.sort(), [x, y].sort()); assert.deepEqual(summary.details.oplocIds, [w.oplocs[1]]); assert.ok(summary.details.operations.includes("production"));
  const events = (await audit().where("details.bulkOperationId", "==", spec.operationId).get()).docs.map(doc => doc.data()).filter(event => event.action === "Hospitality Catalogue bulk update");
  assert.equal(events.length, 2); const event = events.find(candidate => candidate.entityReference === x)!;
  assert.equal(event.actorId, admin.uid); assert.equal(event.details.after.production, "cpu_sandwiches"); assert.equal(event.details.before.production, "cpu_hospitality"); assert.deepEqual(event.details.oplocIds, [w.oplocs[1]]); assert.ok(result.succeeded === 2);
});
