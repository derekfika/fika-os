import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { bookingWorkspace, executeBookingWorkflow, ingestMnkBooking, createProductionOrder, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { createProductionFromApprovedBooking } from "../lib/production-domain";
import { classifyRcoaLine, planRcoaCpuHandoff, rcoaRoutingKeys, routingBlockedMessage } from "../lib/rcoa-cpu-routing";
import { planRcoaRoutingBootstrap } from "../lib/rcoa-routing-bootstrap";
import { LEGACY_HOSPITALITY_MENU_ROUTING } from "../lib/connections-service";
import { localMnkMenuCatalogue, localRcoaMenuCatalogue } from "@fika/server-shared/hospitality-catalogue";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

/**
 * Per-item RCoA CPU routing from the governed Production visibility records: Hospitality keeps the complete booking; only lines routed to
 * exactly one of Sandwiches/Hospitality reach CPU. Pure rules always run; the hand-off tests run through the real service against the
 * Firestore emulator:
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/integration-hub && npx tsx --test tests/rcoa-cpu-routing.test.ts"
 */
const P = "hospitality-menu-item:rcoa:";
const line = (itemId: string, itemName = itemId) => ({ itemId, itemName });
// governed records: a record existing IS the decision; [] = In house; an absent key = never classified
const routing = {
  [`${P}specialty_tea_coffee`]: [],
  [`${P}mini_pastries`]: ["hospitality"],
  [`${P}deli_sandwich_lunch`]: ["sandwiches"],
  [`${P}exotic_fruit_box`]: ["hospitality"],
  [`${P}delivered_only`]: ["delivered_in"],
  [`${P}both_flags`]: ["sandwiches", "hospitality"],
  [`${P}bad_value`]: ["not-a-workstream"],
} as Record<string, string[]>;
const states = (items: string[]) => planRcoaCpuHandoff(items.map((id) => line(id)), routing).lines.map((l) => l.state);

test("state semantics A-F: empty record = In house; sandwiches; hospitality; delivered_in only = not CPU; MISSING = Routing required; both = Routing conflict", () => {
  assert.deepEqual(states(["specialty_tea_coffee", "deli_sandwich_lunch", "mini_pastries", "delivered_only", "bagel_box", "both_flags"]), ["in_house", "cpu_sandwiches", "cpu_hospitality", "in_house", "routing_required", "routing_conflict"]);
  assert.equal(classifyRcoaLine(line("bad_value"), routing), "routing_required", "an unrecognised value is not a governed decision");
  assert.equal(classifyRcoaLine(line("cookie_box"), {}), "routing_required", "legacy defaults are never consulted for RCoA; missing is not In house");
});

test("1/6. all items In house (explicit empty records, or Delivered-In only) -> No CPU production, no Production Order", () => {
  const plan = planRcoaCpuHandoff([line("specialty_tea_coffee"), line("delivered_only")], routing);
  assert.equal(plan.status, "no_cpu_production");
  assert.deepEqual(plan.cpuLines, []);
});

test("2. Tea & Coffee (In house) + Mini Pastries (Hospitality) -> CPU gets the pastries only", () => {
  const plan = planRcoaCpuHandoff([line("specialty_tea_coffee"), line("mini_pastries")], routing);
  assert.equal(plan.status, "cpu_required");
  assert.deepEqual(plan.cpuLines, [{ index: 1, workstream: "hospitality" }]);
});

test("3/4/5. Sandwiches, Hospitality-only and mixed bookings route each CPU line to its own single workstream", () => {
  assert.deepEqual(planRcoaCpuHandoff([line("deli_sandwich_lunch")], routing).cpuLines, [{ index: 0, workstream: "sandwiches" }]);
  assert.deepEqual(planRcoaCpuHandoff([line("exotic_fruit_box")], routing).cpuLines, [{ index: 0, workstream: "hospitality" }]);
  const mixed = planRcoaCpuHandoff([line("exotic_fruit_box"), line("specialty_tea_coffee"), line("deli_sandwich_lunch")], routing);
  assert.deepEqual(mixed.cpuLines, [{ index: 0, workstream: "hospitality" }, { index: 2, workstream: "sandwiches" }]);
});

test("7. any Routing required or Routing conflict line blocks the whole hand-off and names the exact item(s)", () => {
  const plan = planRcoaCpuHandoff([line("mini_pastries"), line("bagel_box", "Bagel Box"), line("both_flags", "Odd Item")], routing);
  assert.equal(plan.status, "routing_required");
  assert.deepEqual(plan.required.map((l) => l.itemName), ["Bagel Box"]);
  assert.deepEqual(plan.conflicts.map((l) => l.itemName), ["Odd Item"]);
  const message = routingBlockedMessage(plan);
  assert.match(message, /Routing required.*Bagel Box/);
  assert.match(message, /Routing conflict: Odd Item/);
  assert.equal(planRcoaCpuHandoff([line("both_flags")], routing).status, "routing_conflict");
});

test("8. an empty booking never produces an empty Production Order", () => assert.equal(planRcoaCpuHandoff([], routing).status, "no_cpu_production"));

test("routing keys: canonical menu item id first, then the RCoA canonical id derived from the stable source item id", () => {
  assert.deepEqual(rcoaRoutingKeys({ itemId: "mini_pastries", menuItemId: `${P}mini_pastries` }), [`${P}mini_pastries`]);
  assert.deepEqual(rcoaRoutingKeys({ itemId: "mini_pastries" }), [`${P}mini_pastries`]);
});

test("bootstrap plan: 45/46 exact stable-key matches; the 8 legacy decisions become governed records; everything else stays Unclassified; nothing overwritten", () => {
  const active = <T extends { lifecycleState: string }>(items: readonly T[]) => items.filter((item) => item.lifecycleState === "active");
  const toItem = (item: (typeof localRcoaMenuCatalogue.items)[number]) => ({ sourceItemId: item.source.sourceItemId, name: item.name, category: item.category, canonicalId: item.canonicalId });
  const input = { legacy: LEGACY_HOSPITALITY_MENU_ROUTING, rcoaItems: active(localRcoaMenuCatalogue.items).map(toItem), mnkItems: active(localMnkMenuCatalogue.items).map(toItem) };
  const plan = planRcoaRoutingBootstrap({ ...input, existing: {} });
  assert.equal(plan.matchedByStableKey.length, 45);
  assert.deepEqual(plan.unmatchedKeys, ["house_filter_coffee"]);
  assert.deepEqual(plan.create.map((r) => [r.sourceItemId, r.workstreams.join()]).sort(), [["cookie_box", "hospitality"], ["deli_sandwich_lunch", "sandwiches"], ["exotic_fruit_box", "hospitality"], ["filled_savoury_croissant", "hospitality"], ["large_pastries", "hospitality"], ["mini_pastries", "hospitality"], ["tray_bake_box", "hospitality"], ["vegan_savoury_croissant", "hospitality"]]);
  assert.equal(plan.unclassified.length, 38);
  assert.ok(plan.unclassified.some((item) => item.sourceItemId === "specialty_tea_coffee"), "Tea & Coffee is NOT guessed");
  assert.ok(!plan.create.some((r) => r.sourceItemId === "tray_bake_box_nut_free"), "nothing inferred from names/categories");
  const rerun = planRcoaRoutingBootstrap({ ...input, existing: { [`${P}mini_pastries`]: ["sandwiches"], [`${P}cookie_box`]: ["hospitality"] } });
  assert.deepEqual(rerun.conflicts.map((c) => c.canonicalId), [`${P}mini_pastries`], "a differing governed record is reported, never overwritten");
  assert.ok(!rerun.create.some((r) => r.sourceItemId === "mini_pastries" || r.sourceItemId === "cookie_box"));
});

test("9. only RCoA bookings are filtered; non-RCoA keeps its behaviour; one routing store; dashboard and Hub UI use the governed states", () => {
  const domain = readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  assert.match(domain, /booking\.source\?\.provider === RCOA_PROVIDER/);
  assert.match(domain, /adaptCpuProductionWorkstreams\(assignments\)\.workstreams\[0\] \|\| "unassigned"/, "non-RCoA fallback unchanged");
  const service = readFileSync(new URL("../lib/connections-service.ts", import.meta.url), "utf8");
  assert.equal((service.match(/db\.collection\("integrationHubHospitalityMenuProductionRouting"\)/g) || []).length, 1, "a single routing store");
  const ui = readFileSync(new URL("../app/ui/Connections.tsx", import.meta.url), "utf8");
  for (const text of ["Unclassified", "In house", "Routing conflict", "Delivered-In only"]) assert.ok(ui.includes(text), text);
  const dashboard = readFileSync(new URL("../../hospitality-booking/app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /booking\.cpuRouting/);
  const labels = readFileSync(new URL("../lib/rcoa-cpu-routing.ts", import.meta.url), "utf8");
  for (const label of ["In house", "CPU · Sandwiches", "CPU · Hospitality", "Routing required", "Routing conflict", "CPU required", "No CPU production"]) assert.ok(labels.includes(label), label);
});

// ---- real hand-off against the emulator ----
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };
const actor = { uid: "test-rcoa-routing", role: "integration-admin" } as Actor;
const routingCollection = () => db.collection("integrationHubHospitalityMenuProductionRouting");
const ordersFor = async (bookingId: string) => (await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", bookingId).get()).docs.map((doc) => doc.data());
type Line = { itemId: string; itemName: string; quantity: number };

async function rcoaFixture(items: Line[], decisions: Record<string, string[]>) {
  const key = `rcoa-routing-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const oploc = `oploc:${key}`;
  const menu = { canonicalId: `hospitality-menu-item:${key}`, dataHash: "test", entityType: "Hospitality Menu Item", lifecycleStatus: "published", record: { lifecycleState: "active", name: "Fixture", unitPrice: 12, providerMappings: [{ provider: "angel-court-hospitality-brochure", sourceItemId: key }] } } as CanonicalRecord;
  const payload = { bookingId: key, siteId: "angel-court", site: "One Angel Court", submittedAt: now, client: { name: "Test Host", companyName: "Test", email: "host@example.test" }, event: { eventDate: "2026-10-19", startTime: "12:00", guestCount: 3 }, order: { items: [{ itemId: key, unitPrice: .01, quantity: 3, lineTotal: .01 }], netTotal: .01 } };
  const mappingRef = db.collection("integrationHubSourceMappings").doc(`${key}-angel-court`);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(menu.canonicalId)).set(menu);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(oploc)).set({ canonicalId: oploc, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active" } });
  await mappingRef.set({ sourceProvider: "hospitality-booking-platform", sourceIdentifier: "angel-court", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: oploc });
  let booking: CanonicalBooking = (await ingestMnkBooking(payload)).booking;
  booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote" })).booking;
  const revisionId = booking.quoteState!.currentRevisionId!;
  booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote-pdf-status", revisionId, status: "saved", driveFileId: "drive-file-1", driveUrl: "https://drive.example.test/1" })).booking;
  // present the same governed booking as an RCoA booking carrying the requested lines
  const template = booking.order.items[0];
  await db.collection("fikaBookings").doc(booking.canonicalId).update({
    "source.provider": "rcoa-booking-platform",
    "order.items": items.map((item) => ({ ...template, itemId: item.itemId, itemName: item.itemName, quantity: item.quantity, lineTotal: item.quantity * template.unitPrice, menuItemId: undefined })),
  });
  for (const [id, workstreams] of Object.entries(decisions)) await routingCollection().doc(stableDocumentId(id)).set({ menuItemId: id, workstreams, version: 1 });
  return {
    bookingId: booking.canonicalId, version: (await db.collection("fikaBookings").doc(booking.canonicalId).get()).data()!.version as number,
    cleanup: async () => { await mappingRef.delete(); await Promise.all(Object.keys(decisions).map((id) => routingCollection().doc(stableDocumentId(id)).delete())); },
  };
}
const tea: Line = { itemId: "rt_tea_coffee", itemName: "Specialty Tea & Coffee", quantity: 1 };
const pastries: Line = { itemId: "rt_mini_pastries", itemName: "Mini Pastries", quantity: 20 };

test("hand-off: Tea & Coffee (explicit In house) + Mini Pastries (Hospitality) -> Production Order with the pastries only; booking keeps both", opts, async () => {
  const f = await rcoaFixture([tea, pastries], { [`${P}rt_tea_coffee`]: [], [`${P}rt_mini_pastries`]: ["hospitality"] });
  try {
    const result = await createProductionFromApprovedBooking(actor, f.bookingId, `rcoa-${f.bookingId}`);
    assert.equal(result.created, true);
    assert.deepEqual(result.order!.lines.map((l) => [l.itemName, l.workstream]), [["Mini Pastries", "hospitality"]]);
    assert.equal(result.order!.lines[0].sourceBookingLineId, `${f.bookingId}:line:2`, "traceable to the original booking line");
    const booking = (await db.collection("fikaBookings").doc(f.bookingId).get()).data() as CanonicalBooking;
    assert.deepEqual(booking.order.items.map((i) => i.itemId), ["rt_tea_coffee", "rt_mini_pastries"], "Hospitality retains the complete booking");
  } finally { await f.cleanup(); }
});

test("hand-off: sandwich lunch keeps the governed three-pieces-per-person conversion and the sandwiches workstream", opts, async () => {
  const f = await rcoaFixture([{ itemId: "rt:deli_sandwich_lunch", itemName: "Deli Style Sandwich Lunch", quantity: 10 }], { [`${P}rt:deli_sandwich_lunch`]: ["sandwiches"] });
  try {
    const order = (await createProductionFromApprovedBooking(actor, f.bookingId, `rcoa-${f.bookingId}`)).order!;
    assert.equal(order.lines[0].workstream, "sandwiches");
    assert.equal(order.lines[0].productionQuantity, 30);
    assert.equal(order.lines[0].productionUnit, "piece");
  } finally { await f.cleanup(); }
});

test("hand-off: all In house (empty record + Delivered-In only) -> explicit 'no CPU production required', no Production Order, not marked Sent to CPU", opts, async () => {
  const f = await rcoaFixture([tea, { itemId: "rt_delivered_only", itemName: "Delivered-In only item", quantity: 2 }], { [`${P}rt_tea_coffee`]: [], [`${P}rt_delivered_only`]: ["delivered_in"] });
  try {
    const outcome = await createProductionOrder(actor, f.bookingId, f.version);
    assert.equal(outcome.status, "no_cpu_production_required");
    assert.equal(outcome.created, false);
    assert.equal((await ordersFor(f.bookingId)).length, 0);
    assert.notEqual(((await db.collection("fikaBookings").doc(f.bookingId).get()).data() as CanonicalBooking).lifecycleStatus, "Sent to CPU");
  } finally { await f.cleanup(); }
});

test("hand-off: a MISSING routing record fails closed (Routing required), names the item and creates no partial Production Order", opts, async () => {
  const f = await rcoaFixture([pastries, { itemId: "rt_bagel_box", itemName: "Bagel Box", quantity: 5 }], { [`${P}rt_mini_pastries`]: ["hospitality"] });
  try {
    await assert.rejects(() => createProductionFromApprovedBooking(actor, f.bookingId, `rcoa-${f.bookingId}`), (error: Error & { code?: string }) => error.code === "ROUTING_REQUIRED" && /Routing required/.test(error.message) && /Bagel Box/.test(error.message) && !/Mini Pastries/.test(error.message));
    assert.equal((await ordersFor(f.bookingId)).length, 0);
  } finally { await f.cleanup(); }
});

test("hand-off: Sandwiches AND Hospitality on one item is a Routing conflict: no arbitrary pick, no partial Production Order", opts, async () => {
  const f = await rcoaFixture([pastries, { itemId: "rt_both_flags", itemName: "Both Flags Item", quantity: 5 }], { [`${P}rt_mini_pastries`]: ["hospitality"], [`${P}rt_both_flags`]: ["sandwiches", "hospitality"] });
  try {
    await assert.rejects(() => createProductionFromApprovedBooking(actor, f.bookingId, `rcoa-${f.bookingId}`), (error: Error & { code?: string }) => error.code === "ROUTING_CONFLICT" && /Routing conflict/.test(error.message) && /Both Flags Item/.test(error.message));
    assert.equal((await ordersFor(f.bookingId)).length, 0);
  } finally { await f.cleanup(); }
});

test("dashboard feed: the booking workspace derives per-line and booking-level CPU state from the governed records, not deliveryChargeRequired", opts, async () => {
  const f = await rcoaFixture([tea, pastries, { itemId: "rt_bagel_box", itemName: "Bagel Box", quantity: 5 }], { [`${P}rt_tea_coffee`]: [], [`${P}rt_mini_pastries`]: ["hospitality"] });
  try {
    await db.collection("fikaBookings").doc(f.bookingId).update({ deliveryChargeRequired: false });
    const workspace = (await bookingWorkspace(undefined, undefined, true)) as { cpuRouting?: Record<string, { status: string; statusLabel: string; lines: Array<{ label: string }> }> };
    const view = workspace.cpuRouting?.[f.bookingId];
    assert.ok(view, "an RCoA booking carries a routing view");
    assert.equal(view.status, "routing_required");
    assert.equal(view.statusLabel, "Routing required");
    assert.deepEqual(view.lines.map((l) => l.label), ["In house", "CPU · Hospitality", "Routing required"]);
    await routingCollection().doc(stableDocumentId(`${P}rt_bagel_box`)).set({ menuItemId: `${P}rt_bagel_box`, workstreams: ["sandwiches"], version: 1 });
    const done = ((await bookingWorkspace(undefined, undefined, true)) as { cpuRouting?: Record<string, { statusLabel: string; lines: Array<{ label: string }> }> }).cpuRouting![f.bookingId];
    assert.equal(done.statusLabel, "CPU required");
    assert.deepEqual(done.lines.map((l) => l.label), ["In house", "CPU · Hospitality", "CPU · Sandwiches"]);
    await routingCollection().doc(stableDocumentId(`${P}rt_bagel_box`)).delete();
  } finally { await f.cleanup(); }
});
