/**
 * Governed catalogue commands against the Firestore EMULATOR only (never an operational store).
 *   npx firebase emulators:exec --only firestore --project demo-fika-os "cross-env FIKA_CATALOGUE_EMULATOR_TEST=true npx tsx --test tests/hospitality-catalogue-admin.emulator.test.ts"
 * Skipped unless FIKA_CATALOGUE_EMULATOR_TEST=true and the Firestore host is a loopback emulator.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";
import { runCatalogueCommand, REVIEW_DECISIONS_COLLECTION, type CatalogueCommand } from "../lib/hospitality-catalogue-admin";
import { loadCataloguePayload, loadCatalogueRows } from "../lib/hospitality-catalogue-loader";
import { hospitalityPortalReadFromRecords } from "../lib/hospitality-catalogue-service";
import { ukBusinessDate } from "../lib/hospitality-catalogue-read-model";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_CATALOGUE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const admin: Actor = { uid: "test:catalogue-admin", name: "Catalogue Admin", role: "integration-admin", synthetic: true };
const reviewer: Actor = { uid: "test:catalogue-reviewer", name: "Reviewer", role: "reviewer", synthetic: true };
const viewer: Actor = { uid: "test:catalogue-viewer", name: "Viewer", role: "viewer", synthetic: true };
const canonical = () => db.collection("integrationHubCanonical");
const routing = () => db.collection("integrationHubHospitalityMenuProductionRouting");
const audit = () => db.collection("integrationHubGovernanceAudit");
const get = async (id: string) => (await canonical().doc(stableDocumentId(id)).get()).data() as CanonicalRecord | undefined;
const run = (command: CatalogueCommand, actor: Actor = admin) => runCatalogueCommand(actor, command);
const rejects = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, (error: Error) => { assert.match(error.message, pattern); return true; });
const stamp = "2026-01-01T00:00:00.000Z";
const base = { schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "test:seed-user", updatedAt: stamp, updatedBy: "test:seed-user", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} } };
const seed = async (entityType: string, canonicalId: string, record: Record<string, unknown>) => { await canonical().doc(stableDocumentId(canonicalId)).set({ canonicalId, entityType, record: { ...base, entityType, canonicalId, ...record }, dataHash: "seed", lifecycleStatus: "published", publicationStatus: "published", publishedAt: stamp }); return canonicalId; };
const livePrices = async (filter: { itemId?: string; offeringId?: string }) => {
  const field = filter.itemId ? "record.hospitalityMenuItemId" : "record.hospitalityMenuOfferingId";
  return (await canonical().where(field, "==", filter.itemId || filter.offeringId).get()).docs.map(doc => doc.data() as CanonicalRecord).filter(record => record.entityType === "Hospitality Menu Price");
};
const auditFor = async (entityReference: string) => (await audit().where("entityReference", "==", entityReference).get()).docs.map(doc => doc.data());
const newOploc = (key: string, suffix: string) => seed("OPLOC", `oploc:cat-${key}-${suffix}`, { approvedName: `Site ${suffix} ${key}`, lifecycleState: "active", hospitalityEnabled: true });
const unique = () => randomUUID().replace(/-/g, "").slice(0, 12);
const createInput = (key: string, oplocIds: string[], extra: Record<string, unknown> = {}) => ({ action: "create-item" as const, requestId: `req-${key}-${unique()}`, name: `Test Item ${key}`, category: "Drinks", routing: "cpu_hospitality" as const, defaultPrice: { amount: 3 }, oplocIds, ...extra });

test("create-item writes Item + default Price + Offerings + routing + audit atomically, replays safely and refuses duplicates", { skip: !enabled }, async () => {
  const key = unique(); const [a, b] = [await newOploc(key, "a"), await newOploc(key, "b")];
  const input = createInput(key, [a, b], { defaultMinimumQuantity: 6 });
  const created = await run(input); const itemId = created.itemIds[0];
  assert.match(itemId, /^hospitality-menu-item:[0-9a-f]{32}$/, "company-wide id, never site-prefixed");
  const item = await get(itemId); assert.equal(item?.record.defaultMinimumQuantity, 6); assert.equal(item?.record.lifecycleState, "active");
  const defaults = await livePrices({ itemId }); assert.equal(defaults.length, 1); assert.equal(defaults[0].record.amount, 3); assert.equal(defaults[0].record.effectiveFrom, ukBusinessDate());
  const offerings = (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(doc => doc.data() as CanonicalRecord).filter(record => record.entityType === "Hospitality Menu Offering");
  assert.equal(offerings.length, 2); assert.ok(offerings.every(offering => offering.record.minimumQuantity === undefined), "sparse: defaults are not copied into Offerings");
  assert.equal((await livePrices({ offeringId: offerings[0].canonicalId })).length, 0, "no price duplicated onto the Offering");
  assert.deepEqual((await routing().doc(stableDocumentId(itemId)).get()).data()?.workstreams, ["hospitality"]);
  const events = await auditFor(itemId); assert.equal(events.length, 1); assert.equal(events[0].actorId, admin.uid); assert.equal(events[0].action, "Hospitality Catalogue item created"); assert.equal(events[0].details.after.name, input.name);

  const replay = await run(input); assert.equal(replay.message, "This item was already created."); // double click / retry
  assert.equal((await auditFor(itemId)).length, 1); assert.equal((await livePrices({ itemId })).length, 1);

  await rejects(run({ ...createInput(key, [a]), name: input.name.toUpperCase() }), /already exists/);
  await rejects(run(createInput(`${key}x`, [])), /at least one site/);
  await rejects(run({ ...createInput(`${key}y`, [a, "oploc:does-not-exist-anywhere"]) }), /not an active Hospitality-enabled location/);
  assert.equal((await canonical().where("record.name", "==", `Test Item ${key}y`).get()).size, 0, "a failed create writes nothing");
  await rejects(run({ ...createInput(`${key}z`, [a]), routing: undefined as never }), /production route/);
  await rejects(run({ ...createInput(`${key}w`, [a]), defaultPrice: { amount: 1.234 } }), /two decimal places/);
});

test("view-only roles cannot run any catalogue command", { skip: !enabled }, async () => {
  const key = unique(); const a = await newOploc(key, "a");
  for (const actor of [reviewer, viewer]) await assert.rejects(run(createInput(key, [a]), actor), (error: Error & { status?: number }) => error.status === 403 && /hospitality\.catalogue\.manage/.test(error.message));
  assert.equal((await canonical().where("record.name", "==", `Test Item ${key}`).get()).size, 0);
});

test("edit, default price change, stale editors and audit before/after", { skip: !enabled }, async () => {
  const key = unique(); const a = await newOploc(key, "a");
  const { itemIds: [itemId] } = await run(createInput(key, [a]));
  const edit = { action: "update-item" as const, itemId, expectedVersion: 1, name: `Renamed ${key}`, category: "Hot drinks", description: "Fresh", defaultMinimumQuantity: 4, defaultPrice: { amount: 3.5 } };
  await run(edit);
  const item = await get(itemId); assert.equal(item?.record.version, 2); assert.equal(item?.record.name, `Renamed ${key}`); assert.equal(item?.record.defaultMinimumQuantity, 4);
  const prices = await livePrices({ itemId });
  assert.equal(prices.length, 2, "history kept: the earlier default is retained, never deleted or edited away");
  const current = prices.find(price => price.record.amount === 3.5)!; const old = prices.find(price => price.record.amount === 3)!;
  assert.equal(current.record.lifecycleState, "active"); assert.equal(current.record.effectiveFrom, ukBusinessDate());
  assert.equal(old.record.lifecycleState, "archived", "a default created today and replaced today never took effect for another day, so it is archived");
  // a default that has been in force is END-DATED the day before the replacement, not archived
  const seeded = await seed("Hospitality Menu Item", `hospitality-menu-item:cat-${key}-seeded`, { name: `Seeded ${key}`, category: "Food", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [] });
  const earlier = await seed("Hospitality Menu Price", `hospitality-menu-price:cat-${key}-earlier`, { hospitalityMenuItemId: seeded, amount: 2, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
  await run({ action: "set-default-price", itemId: seeded, expectedVersion: 1, price: { amount: 2.5 } });
  const ended = await get(earlier); assert.equal(ended?.record.lifecycleState, "active"); assert.equal(ended?.record.effectiveTo, new Date(Date.parse(`${ukBusinessDate()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
  const events = await auditFor(itemId);
  const priceEvent = events.find(event => event.action === "Hospitality Catalogue default price changed");
  assert.deepEqual(priceEvent?.details.before, { amount: 3, vatRate: 0.2 }); assert.deepEqual(priceEvent?.details.after, { amount: 3.5, vatRate: 0.2 });
  await rejects(run(edit), /changed elsewhere/); // stale editor with the old version
  await rejects(run({ action: "set-default-price", itemId, expectedVersion: 1, price: { amount: 9 } }), /changed elsewhere/);
  await rejects(run({ action: "set-default-price", itemId, expectedVersion: 2, price: { amount: 3.5 } }), /already in force/);
  await run({ action: "set-default-price", itemId, expectedVersion: 2, price: { amount: 4 } });
  const all = await livePrices({ itemId }); assert.equal(all.filter(price => price.record.amount === 4 && price.record.lifecycleState === "active").length, 1);
});

test("offerings: enable, disable, re-enable and duplicate refusal; sparse overrides inherit, override and reset safely", { skip: !enabled }, async () => {
  const key = unique(); const [a, b] = [await newOploc(key, "a"), await newOploc(key, "b")];
  const { itemIds: [itemId] } = await run(createInput(key, [a], { defaultMinimumQuantity: 5 }));
  await run({ action: "add-offering", itemId, expectedVersion: 1, oplocId: b });
  await rejects(run({ action: "add-offering", itemId, expectedVersion: 2, oplocId: b }), /already available/);
  const rows = await loadCatalogueRows([itemId]); const row = rows[0];
  const offeringB = row.offerings.find(offering => offering.oplocId === b)!;
  assert.equal(offeringB.price.source, "inherits"); assert.equal(offeringB.minimum.effective, 5);

  await rejects(run({ action: "set-offering-override", offeringId: offeringB.offeringId, expectedVersion: offeringB.version, price: { amount: 3 } }), /equals the company default/);
  await rejects(run({ action: "set-offering-override", offeringId: offeringB.offeringId, expectedVersion: offeringB.version, minimumQuantity: 5 }), /equals the company default minimum/);
  await run({ action: "set-offering-override", offeringId: offeringB.offeringId, expectedVersion: offeringB.version, price: { amount: 3.8 }, minimumQuantity: 12 });
  let current = (await loadCatalogueRows([itemId]))[0].offerings.find(offering => offering.offeringId === offeringB.offeringId)!;
  assert.equal(current.price.source, "overrides"); assert.equal(current.price.effective?.amount, 3.8); assert.equal(current.minimum.source, "overrides"); assert.equal(current.minimum.effective, 12);

  // concurrent override edits: the second editor, holding the old version, fails safely
  await rejects(run({ action: "set-offering-override", offeringId: offeringB.offeringId, expectedVersion: offeringB.version, price: { amount: 4.1 } }), /changed elsewhere/);

  // changing the company default moves every NON-overridden Offering and leaves the override alone
  await run({ action: "set-default-price", itemId, expectedVersion: 2, price: { amount: 4.25 } });
  const afterDefault = (await loadCatalogueRows([itemId]))[0];
  assert.equal(afterDefault.offerings.find(offering => offering.oplocId === a)!.price.effective?.amount, 4.25);
  assert.equal(afterDefault.offerings.find(offering => offering.oplocId === b)!.price.effective?.amount, 3.8);

  current = afterDefault.offerings.find(offering => offering.offeringId === offeringB.offeringId)!;
  await run({ action: "set-offering-override", offeringId: current.offeringId, expectedVersion: current.version, price: null, minimumQuantity: null });
  const reset = (await loadCatalogueRows([itemId]))[0].offerings.find(offering => offering.offeringId === current.offeringId)!;
  assert.equal(reset.price.source, "inherits"); assert.equal(reset.price.effective?.amount, 4.25); assert.equal(reset.minimum.source, "inherits");
  const archivedPrices = (await livePrices({ offeringId: current.offeringId })); assert.ok(archivedPrices.length >= 1 && archivedPrices.every(price => price.record.lifecycleState === "archived"), "reset archives, never deletes");
  await rejects(run({ action: "set-offering-override", offeringId: reset.offeringId, expectedVersion: reset.version, price: null }), /no price override to reset/);

  await run({ action: "set-offering-override", offeringId: reset.offeringId, expectedVersion: reset.version, displayName: "Local name", description: "Local words" });
  const wording = (await loadCatalogueRows([itemId]))[0].offerings.find(offering => offering.offeringId === reset.offeringId)!; assert.equal(wording.displayName, "Local name");

  await run({ action: "set-offering-status", offeringId: wording.offeringId, expectedVersion: wording.version, status: "archived" });
  const disabled = (await loadCatalogueRows([itemId]))[0]; assert.deepEqual(disabled.availableAt, [a]);
  await rejects(run({ action: "set-offering-status", offeringId: wording.offeringId, expectedVersion: wording.version, status: "archived" }), /changed elsewhere/);
  await run({ action: "add-offering", itemId, expectedVersion: disabled.version, oplocId: b }); // re-enables the same Offering, no duplicate
  const reenabled = await loadCatalogueRows([itemId]); assert.equal(reenabled[0].offerings.filter(offering => offering.oplocId === b).length, 1); assert.equal(reenabled[0].offerings.find(offering => offering.oplocId === b)!.displayName, "Local name", "re-enabling keeps its previous local wording");
  const events = (await auditFor(itemId)).map(event => event.action);
  for (const action of ["Hospitality Catalogue offering enabled", "Hospitality Catalogue override set", "Hospitality Catalogue override removed", "Hospitality Catalogue offering disabled"]) assert.ok(events.includes(action), action);
});

test("routing: explicit choice only, stale and repeated first-time saves fail, archived items refused", { skip: !enabled }, async () => {
  const key = unique(); const a = await newOploc(key, "a");
  const itemId = await seed("Hospitality Menu Item", `hospitality-menu-item:cat-${key}-unrouted`, { name: `Unrouted ${key}`, category: "Cakes", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "cookie_box" }] });
  let [row] = await loadCatalogueRows([itemId]); assert.equal(row.routing.state, "routing_required"); assert.equal(row.routingSuggestion?.choice, "cpu_hospitality", "exact source id evidence only"); assert.equal(row.routing.version, 0);
  assert.equal((await routing().doc(stableDocumentId(itemId)).get()).exists, false, "a suggestion is never applied");
  await run({ action: "set-routing", itemId, routing: "cpu_sandwiches", expectedRoutingVersion: 0 });
  await rejects(run({ action: "set-routing", itemId, routing: "in_house", expectedRoutingVersion: 0 }), /production routing changed elsewhere/);
  [row] = await loadCatalogueRows([itemId]); assert.equal(row.routing.state, "cpu_sandwiches"); assert.equal(row.routing.version, 1);
  await run({ action: "set-routing", itemId, routing: "in_house", expectedRoutingVersion: 1 });
  [row] = await loadCatalogueRows([itemId]); assert.equal(row.routing.state, "in_house", "an explicit empty decision is In house");
  const events = (await auditFor(itemId)).filter(event => event.action === "Hospitality Catalogue routing changed"); assert.equal(events.length, 2); assert.equal(events[0].details.itemId, itemId);
  await run({ action: "set-item-status", itemId, expectedVersion: 1, status: "archived" });
  await rejects(run({ action: "set-routing", itemId, routing: "cpu_delivered_in", expectedRoutingVersion: 2 }), /active catalogue item/);
  void a;
});

test("archive keeps every historical reference, removes the item from booking menus, and restore refuses to create a duplicate", { skip: !enabled }, async () => {
  const key = unique(); const a = await newOploc(key, "a");
  const { itemIds: [itemId] } = await run(createInput(key, [a]));
  const readMenu = async () => { const records = (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(doc => doc.data() as CanonicalRecord); return hospitalityPortalReadFromRecords([(await get(itemId))!, ...records], { oplocId: a, serviceDate: ukBusinessDate() }).offerings; };
  assert.equal((await readMenu()).length, 1);
  const before = (await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).size;
  await run({ action: "set-item-status", itemId, expectedVersion: 1, status: "archived" });
  assert.equal((await get(itemId))?.record.lifecycleState, "archived"); assert.equal((await readMenu()).length, 0, "archived items vanish from active booking menus");
  assert.equal((await canonical().where("record.hospitalityMenuItemId", "==", itemId).get()).size, before, "offerings and prices are retained");
  assert.equal((await routing().doc(stableDocumentId(itemId)).get()).exists, true, "routing retained for historical resolution");
  await rejects(run({ action: "set-item-status", itemId, expectedVersion: 2, status: "archived" }), /already archived/);
  await rejects(run({ action: "set-default-price", itemId, expectedVersion: 2, price: { amount: 9 } }), /Restore the item/);
  await rejects(run(createInput(key, [a])), /archived item called|already exists/);
  await run({ action: "set-item-status", itemId, expectedVersion: 2, status: "active" });
  assert.equal((await readMenu()).length, 1);
  const actions = (await auditFor(itemId)).map(event => event.action); assert.ok(actions.includes("Hospitality Catalogue item archived")); assert.ok(actions.includes("Hospitality Catalogue item restored"));
});

test("merge-items collapses duplicates, keeps every Offering/Price/override and routing, and refuses unsafe merges atomically", { skip: !enabled }, async () => {
  const key = unique(); const [a, b] = [await newOploc(key, "a"), await newOploc(key, "b")];
  const mk = (site: string, extra: Record<string, unknown> = {}) => seed("Hospitality Menu Item", `hospitality-menu-item:${site}:cat-${key}`, { name: `Canned Drinks ${key}`, category: "Drinks", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: `${site}-source`, sourceItemId: `canned-${key}` }], ...extra });
  const [mnk, rcoa] = [await mk("mnk"), await mk("rcoa", { name: `Canned drinks ${key}` })];
  const offer = (id: string, itemId: string, oplocId: string, extra: Record<string, unknown> = {}) => seed("Hospitality Menu Offering", id, { hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard", lifecycleState: "active", ...extra });
  const offerMnk = await offer(`hospitality-menu-offering:mnk-${key}`, mnk, a, { minimumQuantity: 6 }), offerRcoa = await offer(`hospitality-menu-offering:rcoa-${key}`, rcoa, b);
  const priceRecord = (id: string, offeringId: string, amount: number) => seed("Hospitality Menu Price", id, { hospitalityMenuOfferingId: offeringId, amount, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
  await priceRecord(`hospitality-menu-price:mnk-${key}`, offerMnk, 1.5); await priceRecord(`hospitality-menu-price:rcoa-${key}`, offerRcoa, 1.8);
  await routing().doc(stableDocumentId(rcoa)).set({ menuItemId: rcoa, workstreams: ["hospitality"], version: 1 });

  const versions = { [mnk]: 1, [rcoa]: 1 };
  await rejects(run({ action: "merge-items", survivorItemId: mnk, sourceItemIds: [rcoa], expectedVersions: { [mnk]: 1, [rcoa]: 9 } }), /changed elsewhere/);
  // allergen difference blocks the merge and writes nothing
  await canonical().doc(stableDocumentId(rcoa)).update({ "record.allergenInformation": ["Gluten"] });
  await rejects(run({ action: "merge-items", survivorItemId: mnk, sourceItemIds: [rcoa], expectedVersions: versions }), /allergen information differs/);
  assert.equal((await get(rcoa))?.record.lifecycleState, "active"); assert.equal((await get(offerRcoa))?.record.hospitalityMenuItemId, rcoa);
  await canonical().doc(stableDocumentId(rcoa)).update({ "record.allergenInformation": [] });
  // an Offering clash at the same site also blocks, atomically
  const clash = await offer(`hospitality-menu-offering:clash-${key}`, rcoa, a);
  await rejects(run({ action: "merge-items", survivorItemId: mnk, sourceItemIds: [rcoa], expectedVersions: versions }), /same site/);
  assert.equal((await get(clash))?.record.hospitalityMenuItemId, rcoa); await canonical().doc(stableDocumentId(clash)).delete();

  await run({ action: "merge-items", survivorItemId: mnk, sourceItemIds: [rcoa], expectedVersions: versions });
  assert.equal((await get(rcoa))?.record.lifecycleState, "archived"); assert.equal((await get(mnk))?.record.lifecycleState, "active");
  const moved = await get(offerRcoa); assert.equal(moved?.record.hospitalityMenuItemId, mnk); assert.equal((moved?.record.configuration as { displayName?: string } | undefined)?.displayName, `Canned drinks ${key}`, "the source wording is preserved on the Offering");
  assert.equal((await get(offerMnk))?.record.minimumQuantity, 6, "site minimum preserved");
  assert.equal((await livePrices({ offeringId: offerMnk }))[0].record.amount, 1.5); assert.equal((await livePrices({ offeringId: offerRcoa }))[0].record.amount, 1.8, "no Price discarded");
  assert.deepEqual((await routing().doc(stableDocumentId(mnk)).get()).data()?.workstreams, ["hospitality"], "routing carried to the survivor");
  assert.equal((await routing().doc(stableDocumentId(rcoa)).get()).data()?.supersededBy, mnk);
  assert.equal((await db.collection("integrationHubHospitalityMenuItemMerges").doc(stableDocumentId(rcoa)).get()).data()?.survivorMenuItemId, mnk);
  assert.equal((await db.collection(REVIEW_DECISIONS_COLLECTION).get()).docs.some(doc => doc.data().decision === "merge" && doc.data().survivorItemId === mnk), true);
  assert.equal((await auditFor(mnk)).filter(event => event.action === "Hospitality Catalogue items merged").length, 1);
  const [row] = await loadCatalogueRows([mnk]); assert.equal(row.availableAt.length, 2); assert.equal(row.routing.state, "cpu_hospitality");
});

test("adopt-company-default: operator-confirmed default makes equal site prices inherit and keeps differing ones as overrides", { skip: !enabled }, async () => {
  const key = unique(); const sites = [await newOploc(key, "a"), await newOploc(key, "b"), await newOploc(key, "c")];
  const itemId = await seed("Hospitality Menu Item", `hospitality-menu-item:cat-${key}-adopt`, { name: `Adopt ${key}`, category: "Food", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [] });
  const amounts = [4, 4, 5]; const offeringIds: string[] = [];
  for (const [index, oplocId] of sites.entries()) {
    const offeringId = await seed("Hospitality Menu Offering", `hospitality-menu-offering:adopt-${key}-${index}`, { hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard", lifecycleState: "active", minimumQuantity: 10 }); offeringIds.push(offeringId);
    await seed("Hospitality Menu Price", `hospitality-menu-price:adopt-${key}-${index}`, { hospitalityMenuOfferingId: offeringId, amount: amounts[index], currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" });
  }
  let [row] = await loadCatalogueRows([itemId]); assert.equal(row.priceMigration.status, "operator_required");
  await rejects(run({ action: "adopt-company-default", itemId, expectedVersion: 1, price: { amount: 4 }, minimumQuantity: 10, confirmed: false }), /Confirm the company default/);
  await run({ action: "adopt-company-default", itemId, expectedVersion: 1, price: { amount: 4 }, minimumQuantity: 10, confirmed: true });
  [row] = await loadCatalogueRows([itemId]);
  const by = (id: string) => row.offerings.find(offering => offering.offeringId === id)!;
  assert.equal(by(offeringIds[0]).price.source, "inherits"); assert.equal(by(offeringIds[1]).price.source, "inherits"); assert.equal(by(offeringIds[2]).price.source, "overrides"); assert.equal(by(offeringIds[2]).price.effective?.amount, 5);
  assert.ok(row.offerings.every(offering => offering.minimum.source === "inherits"), "equal site minimums became inherited");
  assert.equal(row.priceMigration.status, "not_needed");
  await rejects(run({ action: "adopt-company-default", itemId, expectedVersion: row.version, price: { amount: 4 }, confirmed: true }), /already has a company default/);
});

test("review decisions persist and the catalogue payload reflects them; the full payload exposes manage rights", { skip: !enabled }, async () => {
  const key = unique();
  const mk = (suffix: string) => seed("Hospitality Menu Item", `hospitality-menu-item:mnk:rev-${key}-${suffix}`, { name: `Cookie Box ${key}`, category: "Cakes", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: "x", sourceItemId: `cb-${key}` }] });
  const [x, y] = [await mk("one"), await mk("two")];
  let payload = await loadCataloguePayload(admin);
  assert.equal(payload.canManage, true); const group = payload.reviewGroups.find(candidate => candidate.memberIds.includes(x))!; assert.ok(group, "same-site duplicates are review-held, never auto-merged"); assert.ok(payload.rows.find(row => row.itemId === x)!.needsReview.includes("duplicate_candidate"));
  await run({ action: "record-review-decision", memberIds: group.memberIds, decision: "defer" });
  payload = await loadCataloguePayload(admin); assert.equal(payload.reviewGroups.find(candidate => candidate.id === group.id)?.decision, "defer");
  await run({ action: "record-review-decision", memberIds: group.memberIds, decision: "keep_separate" });
  payload = await loadCataloguePayload(admin); assert.equal(payload.reviewGroups.find(candidate => candidate.id === group.id)?.decision, "keep_separate"); assert.equal(payload.rows.find(row => row.itemId === x)!.needsReview.includes("duplicate_candidate"), false);
  assert.equal((await loadCataloguePayload(viewer)).canManage, false);
  void y;
});
