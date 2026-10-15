import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { localAngelCourtMenuCatalogue, localCfcMenuCatalogue, localMnkMenuCatalogue, localMunichReMenuCatalogue, localRcoaMenuCatalogue } from "@fika/server-shared/hospitality-catalogue";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { db } from "../lib/firebase-admin";
import { LEGACY_HOSPITALITY_MENU_ROUTING } from "../lib/connections-service";
import { bookingWorkspace, createProductionOrder, executeBookingWorkflow, ingestMnkBooking, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { classifyHospitalityLine, governedRoutingPlatforms, hospitalityPlatformOf, isGovernedRoutingPlatform, planHospitalityCpuRouting } from "../lib/hospitality-cpu-routing";
import { buildCanonicalMenuItem, planBrochurePromotion, type BrochureItem } from "../lib/hospitality-menu-promotion";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import { createProductionFromApprovedBooking } from "../lib/production-domain";
import { saveConnectionCommand } from "../lib/connections-service";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

/**
 * The governed per-item routing model is the standard for EVERY Hospitality platform. Pure rules always run; hand-off, dashboard feed and
 * persistence tests run against the Firestore emulator:
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/integration-hub && npx tsx --test tests/hospitality-routing-platforms.test.ts"
 */
const NOW = "2026-10-15T12:00:00.000Z";
const platforms = { mnk: localMnkMenuCatalogue, "angel-court": localAngelCourtMenuCatalogue, cfc: localCfcMenuCatalogue, "munich-re": localMunichReMenuCatalogue, rcoa: localRcoaMenuCatalogue } as const;
const id = (platform: string, key: string) => `hospitality-menu-item:${platform}:${key}`;
const line = (itemId: string, itemName = itemId) => ({ itemId, itemName });

test("platform identity: stable site key, with the RCoA provider winning; governed platforms are an explicit, environment-controlled list", () => {
  assert.equal(hospitalityPlatformOf({ source: { provider: "rcoa-booking-platform" }, service: { portalSiteId: "angel-court" } }), "rcoa");
  assert.equal(hospitalityPlatformOf({ source: { provider: "hospitality-booking-platform" }, service: { portalSiteId: "Angel-Court" } }), "angel-court");
  assert.equal(hospitalityPlatformOf({ source: { provider: "mnk-booking-platform" }, service: {} }), "mnk");
  assert.deepEqual(governedRoutingPlatforms({}), ["rcoa"], "default: only RCoA is governed");
  assert.deepEqual(governedRoutingPlatforms({ HOSPITALITY_GOVERNED_ROUTING_PLATFORMS: "rcoa, MNK" }), ["rcoa", "mnk"]);
  assert.equal(isGovernedRoutingPlatform("cfc", {}), false);
  assert.equal(isGovernedRoutingPlatform("cfc", { HOSPITALITY_GOVERNED_ROUTING_PLATFORMS: "cfc" }), true);
});

test("4. same-name items on two platforms keep INDEPENDENT routing (identity is the platform-specific canonical id, never the name)", () => {
  const explicit = { [id("mnk", "mini_pastries")]: ["hospitality"], [id("rcoa", "mini_pastries")]: [] as string[] };
  assert.equal(classifyHospitalityLine({ itemId: "mini_pastries" }, "mnk", explicit).state, "cpu_hospitality");
  assert.equal(classifyHospitalityLine({ itemId: "mini_pastries" }, "rcoa", explicit).state, "in_house");
  assert.equal(classifyHospitalityLine({ itemId: "mini_pastries" }, "cfc", explicit).state, "routing_required", "another platform's record is never borrowed");
  // an Angel Court line that merely shares a NAME with a classified MNK item stays unclassified
  assert.equal(classifyHospitalityLine({ itemId: "mini-pastries", itemName: "Mini Pastries" }, "angel-court", explicit).state, "routing_required");
});

test("3. Angel Court / CFC / Munich Re (and RCoA) promotion is deterministic, idempotent, platform-scoped, unmapped and creates no routing", () => {
  const seen = new Set<string>();
  for (const [platform, catalogue] of Object.entries(platforms).filter(([name]) => name !== "mnk")) {
    const items = catalogue.items as unknown as BrochureItem[];
    const first = items.map((item) => buildCanonicalMenuItem(item, NOW, platform));
    const second = items.map((item) => buildCanonicalMenuItem(item, NOW, platform));
    assert.deepEqual(first.map((r) => r.dataHash), second.map((r) => r.dataHash), `${platform}: deterministic`);
    for (const [index, record] of first.entries()) {
      assert.ok(record.canonicalId.startsWith(`hospitality-menu-item:${platform}:`), `${platform}: platform-scoped identity`);
      assert.equal((record.record.ownership as { providerOwned: { sourceItemId: string } }).providerOwned.sourceItemId, items[index].source.sourceItemId, `${platform}: stable source key kept`);
      assert.deepEqual(record.record.providerMappings, [], `${platform}: no provider mapping`);
      assert.ok(!seen.has(record.canonicalId), "no identity shared between platforms");
      seen.add(record.canonicalId);
    }
    const empty = planBrochurePromotion(items, new Map());
    assert.equal(empty.create.length, items.length);
    const existing = new Map(items.map((item) => [item.canonicalId, { canonicalId: item.canonicalId, name: item.name, category: item.category, sourceItemId: item.source.sourceItemId }]));
    const rerun = planBrochurePromotion(items, existing);
    assert.deepEqual([rerun.create.length, rerun.reused.length, rerun.conflicts.length], [0, items.length, 0], `${platform}: idempotent`);
  }
  assert.deepEqual(["angel-court", "cfc", "munich-re"].map((p) => platforms[p as keyof typeof platforms].items.length), [33, 40, 40]);
});

test("11. pricing and booking validation are unchanged by promotion: promoted (unmapped) items never replace the brochure price on any platform", () => {
  for (const platform of ["angel-court", "cfc", "munich-re", "rcoa"] as const) {
    const items = platforms[platform].items as unknown as Array<BrochureItem & { pricing: { unitPrice: number } }>;
    const records = items.map((item) => buildCanonicalMenuItem(item, NOW, platform));
    const first = items[0];
    const payload = { bookingId: `T-${platform}`, siteId: platform, site: platform, submittedAt: NOW, client: { name: "x", companyName: "x", email: "x@example.test" }, event: { eventDate: "2026-12-10", startTime: "09:00", guestCount: 10 }, order: { items: [{ itemId: first.source.sourceItemId, quantity: 20, unitPrice: 0.01, lineTotal: 0.2 }], netTotal: 0.2 } } as never;
    const withPromotion = trustedPublicOrder(payload, records, platform);
    const without = trustedPublicOrder(payload, [], platform);
    assert.deepEqual(withPromotion.items.map((i) => [i.unitPrice, i.lineTotal]), without.items.map((i) => [i.unitPrice, i.lineTotal]), `${platform}: identical pricing with and without promoted items`);
    assert.equal(withPromotion.items[0].unitPrice, first.pricing.unitPrice);
  }
});

test("12. legacy fallback exists ONLY where explicitly required: advisory for ungoverned platforms, never for a governed one", () => {
  const legacyKey = "mini_pastries";
  assert.equal(classifyHospitalityLine({ itemId: legacyKey }, "mnk", {}, LEGACY_HOSPITALITY_MENU_ROUTING).state, "cpu_hospitality");
  assert.equal(classifyHospitalityLine({ itemId: legacyKey }, "mnk", {}, LEGACY_HOSPITALITY_MENU_ROUTING).source, "legacy");
  assert.equal(classifyHospitalityLine({ itemId: legacyKey }, "rcoa", {}).state, "routing_required", "governed platforms pass no legacy map");
  // a governed record always beats the legacy fallback
  assert.equal(classifyHospitalityLine({ itemId: legacyKey }, "mnk", { [id("mnk", legacyKey)]: [] }, LEGACY_HOSPITALITY_MENU_ROUTING).state, "in_house");
  // legacy usage per platform catalogue (documented in the retirement plan)
  const usage = Object.fromEntries(Object.entries(platforms).map(([platform, catalogue]) => [platform, catalogue.items.filter((item) => item.source.sourceItemId in LEGACY_HOSPITALITY_MENU_ROUTING).length]));
  assert.deepEqual(usage, { mnk: 8, "angel-court": 3, cfc: 1, "munich-re": 1, rcoa: 8 });
});

// ---- emulator: real hand-off, dashboard feed and per-platform persistence ----
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };
const actor = { uid: "test-platform-routing", role: "integration-admin" } as Actor;
const routingDoc = (canonicalId: string) => db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(canonicalId));
const ordersFor = async (bookingId: string) => (await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", bookingId).get()).docs.map((doc) => doc.data());
type Line = { key: string; name: string; quantity: number };

async function platformFixture(platform: string, lines: Line[], decisions: Record<string, string[]>) {
  const key = `platform-routing-${crypto.randomUUID()}`;
  const oploc = `oploc:${key}`;
  const menu = { canonicalId: `hospitality-menu-item:${key}`, dataHash: "test", entityType: "Hospitality Menu Item", lifecycleStatus: "published", record: { lifecycleState: "active", name: "Fixture", unitPrice: 12, providerMappings: [{ provider: "cfc-hospitality-brochure", sourceItemId: key }] } } as CanonicalRecord;
  const payload = { bookingId: key, siteId: "cfc", site: "CFC", submittedAt: NOW, client: { name: "Test Host", companyName: "Test", email: "host@example.test" }, event: { eventDate: "2026-10-19", startTime: "12:00", guestCount: 3 }, order: { items: [{ itemId: key, unitPrice: .01, quantity: 3, lineTotal: .01 }], netTotal: .01 } };
  const mappingRef = db.collection("integrationHubSourceMappings").doc(`${key}-cfc`);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(menu.canonicalId)).set(menu);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(oploc)).set({ canonicalId: oploc, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active" } });
  await mappingRef.set({ sourceProvider: "hospitality-booking-platform", sourceIdentifier: "cfc", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: oploc });
  let booking: CanonicalBooking = (await ingestMnkBooking(payload)).booking;
  await mappingRef.delete(); // only needed at ingestion; removing it lets several fixtures coexist
  booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote" })).booking;
  const revisionId = booking.quoteState!.currentRevisionId!;
  booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote-pdf-status", revisionId, status: "saved", driveFileId: "drive-file-1", driveUrl: "https://drive.example.test/1" })).booking;
  const template = booking.order.items[0];
  // (ingested through the CFC site key, which no other test file uses, so parallel test files cannot collide on the OPLOC mapping)
  // present the same governed booking as a booking of the requested platform (as that platform's lines would arrive: MNK lines carry the canonical menuItemId)
  await db.collection("fikaBookings").doc(booking.canonicalId).update({
    "source.provider": platform === "rcoa" ? "rcoa-booking-platform" : platform === "mnk" ? "mnk-booking-platform" : "hospitality-booking-platform",
    "service.portalSiteId": platform,
    "order.items": lines.map((item) => ({ ...template, itemId: item.key, itemName: item.name, quantity: item.quantity, lineTotal: item.quantity * template.unitPrice, menuItemId: platform === "mnk" ? id("mnk", item.key) : undefined })),
  });
  for (const [canonicalId, workstreams] of Object.entries(decisions)) await routingDoc(canonicalId).set({ menuItemId: canonicalId, workstreams, version: 1 });
  return {
    bookingId: booking.canonicalId, version: (await db.collection("fikaBookings").doc(booking.canonicalId).get()).data()!.version as number,
    cleanup: async () => { await Promise.all(Object.keys(decisions).map((canonicalId) => routingDoc(canonicalId).delete())); },
  };
}
const withGoverned = async (value: string | undefined, run: () => Promise<void>) => {
  const previous = process.env.HOSPITALITY_GOVERNED_ROUTING_PLATFORMS;
  if (value === undefined) delete process.env.HOSPITALITY_GOVERNED_ROUTING_PLATFORMS; else process.env.HOSPITALITY_GOVERNED_ROUTING_PLATFORMS = value;
  try { await run(); } finally { if (previous === undefined) delete process.env.HOSPITALITY_GOVERNED_ROUTING_PLATFORMS; else process.env.HOSPITALITY_GOVERNED_ROUTING_PLATFORMS = previous; }
};

for (const platform of ["mnk", "rcoa", "angel-court", "cfc", "munich-re"] as const) {
  const u = crypto.randomUUID().slice(0, 8);
  const tea = { key: `tea-${u}`, name: "Tea & Coffee", quantity: 1 };
  const pastry = { key: `pastry-${u}`, name: "Pastries", quantity: 20 };
  const sandwich = { key: `sandwich-${u}`, name: "Sandwich Lunch", quantity: 10 };
  const bad = { key: `odd-${u}`, name: "Odd Item", quantity: 2 };

  test(`1/2/7. [${platform}] governed hand-off: mixed booking keeps every line on Hospitality and sends only the governed CPU lines`, opts, async () => {
    await withGoverned(`${platform}`, async () => {
      const f = await platformFixture(platform, [tea, pastry, sandwich], { [id(platform, tea.key)]: [], [id(platform, pastry.key)]: ["hospitality"], [id(platform, sandwich.key)]: ["sandwiches"] });
      try {
        const result = await createProductionFromApprovedBooking(actor, f.bookingId, `route-${f.bookingId}`);
        assert.deepEqual(result.order!.lines.map((l) => [l.itemName, l.workstream]), [["Pastries", "hospitality"], ["Sandwich Lunch", "sandwiches"]]);
        const booking = (await db.collection("fikaBookings").doc(f.bookingId).get()).data() as CanonicalBooking;
        assert.equal(booking.order.items.length, 3, "Hospitality retains the complete booking");
      } finally { await f.cleanup(); }
    });
  });

  test(`6. [${platform}] all-In-house booking creates no Production Order and returns no_cpu_production_required`, opts, async () => {
    await withGoverned(`${platform}`, async () => {
      const f = await platformFixture(platform, [tea, bad], { [id(platform, tea.key)]: [], [id(platform, bad.key)]: ["delivered_in"] });
      try {
        const outcome = await createProductionOrder(actor, f.bookingId, f.version);
        assert.equal(outcome.status, "no_cpu_production_required");
        assert.equal((await ordersFor(f.bookingId)).length, 0);
      } finally { await f.cleanup(); }
    });
  });

  test(`8/9. [${platform}] missing routing and routing conflict fail closed with no partial Production Order`, opts, async () => {
    await withGoverned(`${platform}`, async () => {
      const missing = await platformFixture(platform, [pastry, bad], { [id(platform, pastry.key)]: ["hospitality"] });
      try {
        await assert.rejects(() => createProductionFromApprovedBooking(actor, missing.bookingId, `route-${missing.bookingId}`), (error: Error & { code?: string }) => error.code === "ROUTING_REQUIRED" && /Odd Item/.test(error.message) && !/Pastries/.test(error.message));
        assert.equal((await ordersFor(missing.bookingId)).length, 0);
      } finally { await missing.cleanup(); }
      const conflict = await platformFixture(platform, [pastry, bad], { [id(platform, pastry.key)]: ["hospitality"], [id(platform, bad.key)]: ["sandwiches", "hospitality"] });
      try {
        await assert.rejects(() => createProductionFromApprovedBooking(actor, conflict.bookingId, `route-${conflict.bookingId}`), (error: Error & { code?: string }) => error.code === "ROUTING_CONFLICT" && /Odd Item/.test(error.message));
        assert.equal((await ordersFor(conflict.bookingId)).length, 0);
      } finally { await conflict.cleanup(); }
    });
  });
}

test("2b. [rcoa] the sandwich line keeps the governed three-pieces-per-person conversion and the sandwiches workstream", opts, async () => {
  await withGoverned("rcoa", async () => {
    const key = "rt:deli_sandwich_lunch";
    const f = await platformFixture("rcoa", [{ key, name: "Deli Style Sandwich Lunch", quantity: 10 }], { [id("rcoa", key)]: ["sandwiches"] });
    try {
      const order = (await createProductionFromApprovedBooking(actor, f.bookingId, `route-${f.bookingId}`)).order!;
      assert.equal(order.lines[0].workstream, "sandwiches");
      assert.equal(order.lines[0].productionQuantity, 30);
      assert.equal(order.lines[0].productionUnit, "piece");
    } finally { await f.cleanup(); }
  });
});

test("12. a platform that is NOT governed keeps today's hand-off: every line goes to CPU, no fail-closed, even with no routing records", opts, async () => {
  await withGoverned(undefined, async () => {
    const u = crypto.randomUUID().slice(0, 8);
    const f = await platformFixture("cfc", [{ key: `tea-${u}`, name: "Tea & Coffee", quantity: 1 }, { key: `pastry-${u}`, name: "Pastries", quantity: 20 }], {});
    try {
      const order = (await createProductionFromApprovedBooking(actor, f.bookingId, `route-${f.bookingId}`)).order!;
      assert.equal(order.lines.length, 2, "unchanged transitional behaviour");
    } finally { await f.cleanup(); }
  });
});

test("10. dashboard feed: every platform gets per-line and booking-level state; governed platforms are enforced, others advisory with the legacy fallback", opts, async () => {
  await withGoverned("rcoa", async () => {
    const u = crypto.randomUUID().slice(0, 8);
    const fixtures = [] as Array<{ platform: string; f: Awaited<ReturnType<typeof platformFixture>> }>;
    try {
      for (const platform of ["mnk", "angel-court", "rcoa"]) {
        const lines = [{ key: `tea-${u}`, name: "Tea & Coffee", quantity: 1 }, { key: `pastry-${u}`, name: "Pastries", quantity: 20 }];
        fixtures.push({ platform, f: await platformFixture(platform, lines, { [id(platform, `tea-${u}`)]: [], [id(platform, `pastry-${u}`)]: ["hospitality"] }) });
      }
      const workspace = (await bookingWorkspace(undefined, undefined, true)) as { cpuRouting?: Record<string, { status: string; statusLabel: string; platform: string; enforced: boolean; lines: Array<{ label: string }> }> };
      for (const { platform, f } of fixtures) {
        const view = workspace.cpuRouting?.[f.bookingId];
        assert.ok(view, `${platform}: has a routing view`);
        assert.equal(view.platform, platform);
        assert.equal(view.enforced, platform === "rcoa");
        assert.equal(view.statusLabel, "CPU required");
        assert.deepEqual(view.lines.map((l) => l.label), ["In house", "CPU · Hospitality"]);
      }
    } finally { for (const { f } of fixtures) await f.cleanup(); }
  });
});

test("5. saving one platform's routing never mutates another platform's record (same key on every platform)", opts, async () => {
  const key = `shared-${crypto.randomUUID().slice(0, 8)}`;
  const ids = Object.keys(platforms).map((platform) => id(platform, key));
  for (const canonicalId of ids) {
    await db.collection("integrationHubCanonical").doc(stableDocumentId(canonicalId)).set({ canonicalId, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "x", record: { name: "Same Name", category: "Test", lifecycleState: "active", providerMappings: [] } });
    await routingDoc(canonicalId).set({ menuItemId: canonicalId, workstreams: ["hospitality"], version: 7, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", updatedBy: "someone" });
  }
  const snapshot = async (canonicalId: string) => { const snap = await routingDoc(canonicalId).get(); return JSON.stringify([snap.data(), snap.updateTime!.toMillis()]); };
  try {
    for (const target of ids) {
      const before = Object.fromEntries(await Promise.all(ids.filter((other) => other !== target).map(async (other) => [other, await snapshot(other)] as const)));
      await saveConnectionCommand(actor, { action: "save-hospitality-menu-production-routing", menuItemId: target, workstreams: target.includes(":cfc:") ? [] : ["sandwiches"] });
      for (const [other, value] of Object.entries(before)) assert.equal(await snapshot(other), value, `saving ${target} left ${other} byte-for-byte unchanged`);
    }
  } finally {
    for (const canonicalId of ids) { await routingDoc(canonicalId).delete(); await db.collection("integrationHubCanonical").doc(stableDocumentId(canonicalId)).delete(); }
  }
});
