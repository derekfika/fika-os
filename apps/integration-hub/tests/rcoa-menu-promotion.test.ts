import assert from "node:assert/strict";
import test from "node:test";
import { localMnkMenuCatalogue, localRcoaMenuCatalogue } from "@fika/server-shared/hospitality-catalogue";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { db } from "../lib/firebase-admin";
import { connectionsOverview, saveConnectionCommand } from "../lib/connections-service";
import { readFileSync } from "node:fs";
import { groupMenuItems, groupRoutingSummary, memberRoutingState, platformLabel } from "../lib/menu-routing-grouping";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import { buildRcoaCanonicalMenuItem, planRcoaPromotion, type PromotionExisting, type RcoaBrochureItem } from "../lib/rcoa-menu-promotion";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

const NOW = "2026-10-15T12:00:00.000Z";
const brochure = localRcoaMenuCatalogue.items as unknown as RcoaBrochureItem[];
const P = "hospitality-menu-item:rcoa:";

test("promoted records are schema-valid, deterministic, keep the stable source key and carry no provider mapping", () => {
  const records = brochure.map((item) => buildRcoaCanonicalMenuItem(item, NOW));
  assert.equal(records.length, 46);
  assert.equal(new Set(records.map((r) => r.canonicalId)).size, 46);
  for (const [index, record] of records.entries()) {
    assert.equal(record.canonicalId, brochure[index].canonicalId);
    assert.ok(record.canonicalId.startsWith(P));
    const owned = (record.record.ownership as { providerOwned: { sourceItemId: string } }).providerOwned;
    assert.equal(owned.sourceItemId, brochure[index].source.sourceItemId);
    assert.deepEqual(record.record.providerMappings, [], "no mapping: RCoA pricing/validation stays on the server brochure");
    assert.equal(record.entityType, "Hospitality Menu Item");
  }
  assert.deepEqual(brochure.map((item) => buildRcoaCanonicalMenuItem(item, NOW).dataHash), records.map((r) => r.dataHash), "deterministic");
});

test("promotion plan is idempotent and never touches other sites: create all when empty, reuse identical, report differing, ignore MNK", () => {
  const empty = planRcoaPromotion(brochure, new Map());
  assert.equal(empty.create.length, 46);
  assert.ok(empty.create.every((item) => item.canonicalId.startsWith(P)), "only RCoA identities are ever created");
  const existing = new Map<string, PromotionExisting>(brochure.map((item) => [item.canonicalId, { canonicalId: item.canonicalId, name: item.name, category: item.category, sourceItemId: item.source.sourceItemId }]));
  existing.set("hospitality-menu-item:mnk:mini_pastries", { canonicalId: "hospitality-menu-item:mnk:mini_pastries", name: "Mini Pastries", category: "Breakfast" });
  const rerun = planRcoaPromotion(brochure, existing);
  assert.deepEqual([rerun.create.length, rerun.reused.length, rerun.conflicts.length], [0, 46, 0]);
  existing.set(`${P}mini_pastries`, { canonicalId: `${P}mini_pastries`, name: "Something else", category: "Breakfast" });
  const differing = planRcoaPromotion(brochure, existing);
  assert.deepEqual(differing.conflicts.map((c) => c.canonicalId), [`${P}mini_pastries`], "a differing record is reported, never overwritten");
});

test("RCoA booking pricing and validation are unchanged by the promoted (unmapped) items", () => {
  const records = brochure.map((item) => buildRcoaCanonicalMenuItem(item, NOW));
  const catalogueItem = brochure.find((item) => item.source.sourceItemId === "mini_pastries") as unknown as { pricing: { unitPrice: number } };
  const payload = { bookingId: "RCOA-TEST", siteId: "rcoa", site: "RCoA", submittedAt: NOW, client: { name: "x", companyName: "x", email: "x@example.test" }, event: { eventDate: "2026-12-10", startTime: "09:00", guestCount: 10 }, order: { items: [{ itemId: "mini_pastries", quantity: 5, unitPrice: 0.01, lineTotal: 0.05 }], netTotal: 0.05 } } as never;
  const trusted = trustedPublicOrder(payload, records, "rcoa");
  assert.equal(trusted.items[0].unitPrice, catalogueItem.pricing.unitPrice, "priced from the server brochure, not from a missing canonical price");
});

test("grouping: a row is decided only when every member is; flags come from decided members; partial and inconsistent are reported", () => {
  const item = (canonicalId: string, workstreams: string[], routingDecided: boolean) => ({ canonicalId, name: "Mini Pastries", lifecycleState: "active", scopes: [], workstreams, routingDecided });
  const partial = groupMenuItems([item("hospitality-menu-item:mnk:mini_pastries", [], false), item(`${P}mini_pastries`, ["hospitality"], true)])[0];
  assert.deepEqual([partial.routingDecided, partial.routingPartial, partial.workstreams, partial.sourceIds.length], [false, true, ["hospitality"], 2]);
  const both = groupMenuItems([item("a", ["hospitality"], true), item("b", ["hospitality"], true)])[0];
  assert.deepEqual([both.routingDecided, both.routingPartial, both.routingInconsistent], [true, false, false]);
  const disagree = groupMenuItems([item("a", ["hospitality"], true), item("b", ["sandwiches"], true)])[0];
  assert.equal(disagree.routingInconsistent, true);
  const none = groupMenuItems([item("a", [], false), item("b", [], false)])[0];
  assert.deepEqual([none.routingDecided, none.routingPartial], [false, false], "never saved = Unclassified, not In house");
});

// ---- the real Hub service against the Firestore emulator ----
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };
const actor = { uid: "test-rcoa-promotion", role: "integration-admin" } as Actor;
const routing = (id: string) => db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(id));

test("Hub overview lists all 46 promoted RCoA items; the 8 bound routing records show their status, the other 38 are Unclassified; saves persist", opts, async () => {
  const records = brochure.map((item) => buildRcoaCanonicalMenuItem(item, NOW));
  const bound: Record<string, string[]> = { cookie_box: ["hospitality"], tray_bake_box: ["hospitality"], exotic_fruit_box: ["hospitality"], mini_pastries: ["hospitality"], large_pastries: ["hospitality"], filled_savoury_croissant: ["hospitality"], vegan_savoury_croissant: ["hospitality"], deli_sandwich_lunch: ["sandwiches"] };
  for (const record of records) await db.collection("integrationHubCanonical").doc(stableDocumentId(record.canonicalId)).set(record);
  for (const [key, workstreams] of Object.entries(bound)) await routing(`${P}${key}`).set({ menuItemId: `${P}${key}`, workstreams, version: 1 });
  try {
    const overview = (await connectionsOverview()) as unknown as { menuItems: Array<{ canonicalId: string; workstreams: string[]; routingDecided: boolean; lifecycleState: string }> };
    const rcoa = overview.menuItems.filter((item) => item.canonicalId.startsWith(P));
    assert.equal(rcoa.length, 46, "all expected RCoA brochure items are visible");
    for (const item of rcoa) {
      const key = item.canonicalId.slice(P.length);
      if (key in bound) assert.deepEqual([item.routingDecided, item.workstreams], [true, bound[key]], `${key} binds to its governed record`);
      else assert.deepEqual([item.routingDecided, item.workstreams], [false, []], `${key} is Unclassified`);
    }
    assert.equal(rcoa.filter((item) => !item.routingDecided).length, 38);

    // Save as In house => an explicit EMPTY record exists (decided, no flags)
    const teaId = `${P}specialty_tea_coffee`;
    await saveConnectionCommand(actor, { action: "save-hospitality-menu-production-routing", menuItemId: teaId, workstreams: [] });
    const tea = (await routing(teaId).get()).data();
    assert.deepEqual(tea?.workstreams, []);
    assert.equal(tea?.menuItemId, teaId);
    // Sandwiches / Hospitality selections persist
    const bagelId = `${P}bagel_box`;
    await saveConnectionCommand(actor, { action: "save-hospitality-menu-production-routing", menuItemId: bagelId, workstreams: ["sandwiches"] });
    assert.deepEqual((await routing(bagelId).get()).data()?.workstreams, ["sandwiches"]);
    await saveConnectionCommand(actor, { action: "save-hospitality-menu-production-routing", menuItemId: bagelId, workstreams: ["hospitality"] });
    assert.deepEqual((await routing(bagelId).get()).data()?.workstreams, ["hospitality"]);
    const after = (await connectionsOverview()) as unknown as { menuItems: Array<{ canonicalId: string; workstreams: string[]; routingDecided: boolean }> };
    const find = (id: string) => after.menuItems.find((item) => item.canonicalId === id)!;
    assert.deepEqual([find(teaId).routingDecided, find(teaId).workstreams], [true, []], "explicit In house");
    assert.deepEqual([find(bagelId).routingDecided, find(bagelId).workstreams], [true, ["hospitality"]]);
    assert.equal(after.menuItems.filter((item) => item.canonicalId.startsWith(P) && !item.routingDecided).length, 36);
  } finally {
    for (const record of records) await db.collection("integrationHubCanonical").doc(stableDocumentId(record.canonicalId)).delete();
    for (const item of brochure) await routing(item.canonicalId).delete();
  }
});

// ---- grouping is presentation only: every canonical item keeps its own independent routing record ----
const MNK = "hospitality-menu-item:mnk:mini_pastries";
const RCOA = `${P}mini_pastries`;
const routingRow = (id: string) => ({ canonicalId: id, name: "Mini Pastries", lifecycleState: "active", scopes: [], workstreams: [] as string[], routingDecided: false });

test("1. a same-name MNK + RCoA row exposes BOTH underlying states, each labelled by platform", () => {
  const [row] = groupMenuItems([{ ...routingRow(MNK), workstreams: ["hospitality"], routingDecided: true }, routingRow(RCOA)]);
  assert.equal(row.members.length, 2);
  const byPlatform = Object.fromEntries(row.members.map((m) => [platformLabel(m.canonicalId), memberRoutingState(m.workstreams, m.routingDecided)]));
  assert.deepEqual(byPlatform, { MNK: "routed", RCoA: "unclassified" });
});

test("5. aggregate state is derived from the children: Partly classified, Mixed routing, Conflict, consistent, Unclassified", () => {
  const m = (workstreams: string[], routingDecided: boolean) => ({ workstreams, routingDecided });
  assert.equal(groupRoutingSummary([m(["hospitality"], true), m([], false)]), "partly-classified");
  assert.equal(groupRoutingSummary([m(["hospitality"], true), m(["sandwiches"], true)]), "mixed-routing");
  assert.equal(groupRoutingSummary([m(["hospitality"], true), m(["sandwiches", "hospitality"], true)]), "conflict");
  assert.equal(groupRoutingSummary([m([], true), m([], true)]), "consistent");
  assert.equal(groupRoutingSummary([m([], false), m([], false)]), "unclassified");
});

test("6. same-name grouping is presentation only: the UI saves exactly one canonical id and nothing in grouping writes", () => {
  const ui = readFileSync(new URL("../app/ui/Connections.tsx", import.meta.url), "utf8");
  assert.match(ui, /menuItemId: member\.canonicalId, workstreams/);
  assert.doesNotMatch(ui, /for \(const menuItemId of item\.sourceIds/, "no loop over every same-name record");
  assert.doesNotMatch(ui, /draft\[menuItemId\] \|\| draft\[item\.canonicalId\]/, "no fall-back to another record's draft");
  const grouping = readFileSync(new URL("../lib/menu-routing-grouping.ts", import.meta.url), "utf8");
  assert.doesNotMatch(grouping, /firebase|fetch\(|db|\.doc\(|saveConnectionCommand/);
});

const rawDoc = async (id: string) => { const snap = await routing(id).get(); return snap.exists ? { data: JSON.stringify(snap.data()), updateTime: snap.updateTime!.toMillis() } : undefined; };

test("2/3/4. saving the RCoA item changes only the RCoA record (MNK byte-for-byte unchanged), and saving MNK changes only MNK", opts, async () => {
  await routing(MNK).set({ menuItemId: MNK, workstreams: ["hospitality"], version: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", updatedBy: "someone" });
  await db.collection("integrationHubCanonical").doc(stableDocumentId(MNK)).set({ canonicalId: MNK, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "x", record: { name: "Mini Pastries", category: "Breakfast", lifecycleState: "active", providerMappings: [] } });
  const rcoaRecord = buildRcoaCanonicalMenuItem(brochure.find((item) => item.canonicalId === RCOA)!, NOW);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(RCOA)).set(rcoaRecord);
  try {
    const mnkBefore = await rawDoc(MNK);
    assert.equal(await rawDoc(RCOA), undefined);
    await saveConnectionCommand(actor, { action: "save-hospitality-menu-production-routing", menuItemId: RCOA, workstreams: ["sandwiches"] });
    assert.deepEqual((await routing(RCOA).get()).data()?.workstreams, ["sandwiches"]);
    assert.deepEqual(await rawDoc(MNK), mnkBefore, "MNK routing is byte-for-byte unchanged (data and update time)");

    const rcoaBefore = await rawDoc(RCOA);
    await saveConnectionCommand(actor, { action: "save-hospitality-menu-production-routing", menuItemId: MNK, workstreams: [] });
    assert.deepEqual((await routing(MNK).get()).data()?.workstreams, []);
    assert.deepEqual(await rawDoc(RCOA), rcoaBefore, "saving MNK leaves RCoA untouched");

    const overview = (await connectionsOverview()) as unknown as { menuItems: Array<{ canonicalId: string; workstreams: string[]; routingDecided: boolean; name: string; lifecycleState: string; scopes: never[] }> };
    const [row] = groupMenuItems(overview.menuItems.filter((item) => item.canonicalId === MNK || item.canonicalId === RCOA));
    assert.equal(groupRoutingSummary(row.members), "mixed-routing");
  } finally {
    await routing(MNK).delete(); await routing(RCOA).delete();
    await db.collection("integrationHubCanonical").doc(stableDocumentId(MNK)).delete();
    await db.collection("integrationHubCanonical").doc(stableDocumentId(RCOA)).delete();
  }
});
