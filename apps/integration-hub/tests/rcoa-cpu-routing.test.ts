import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { executeBookingWorkflow, ingestMnkBooking, createProductionOrder, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { createProductionFromApprovedBooking } from "../lib/production-domain";
import { classifyRcoaLine, planRcoaCpuHandoff, rcoaRoutingKeys } from "../lib/rcoa-cpu-routing";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

/**
 * Per-item RCoA CPU routing: Hospitality keeps the complete booking; only lines explicitly routed to Sandwiches/Hospitality reach CPU.
 * Pure rules always run; the hand-off tests run through the real service against the Firestore emulator:
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/integration-hub && npx tsx --test tests/rcoa-cpu-routing.test.ts"
 */
const P = "hospitality-menu-item:rcoa:";
const line = (itemId: string, itemName = itemId) => ({ itemId, itemName });
// explicit saved decisions (document exists => decided; [] => In house)
const routing = {
  [`${P}specialty_tea_coffee`]: [],
  [`${P}mini_pastries`]: ["hospitality"],
  [`${P}deli_sandwich_lunch`]: ["sandwiches"],
  [`${P}exotic_fruit_box`]: ["hospitality"],
  [`${P}delivered_only`]: ["delivered_in"],
} as Record<string, string[]>;

test("1/6. all items In house -> no CPU order is planned (not an error)", () => {
  assert.deepEqual(planRcoaCpuHandoff([line("specialty_tea_coffee", "Specialty Tea & Coffee")], routing), { status: "no_cpu_production_required", inHouse: [{ index: 0 }] });
});

test("2. Tea & Coffee (In house) + Mini Pastries (Hospitality) -> CPU gets the pastries only", () => {
  const plan = planRcoaCpuHandoff([line("specialty_tea_coffee"), line("mini_pastries")], routing);
  assert.deepEqual(plan, { status: "produce", lines: [{ index: 1, classification: "hospitality" }], inHouse: [{ index: 0 }] });
});

test("3/4. Sandwiches and Hospitality-only bookings route to their workstreams", () => {
  assert.deepEqual(planRcoaCpuHandoff([line("deli_sandwich_lunch")], routing), { status: "produce", lines: [{ index: 0, classification: "sandwiches" }], inHouse: [] });
  assert.deepEqual(planRcoaCpuHandoff([line("exotic_fruit_box")], routing), { status: "produce", lines: [{ index: 0, classification: "hospitality" }], inHouse: [] });
});

test("5. mixed Sandwiches + Hospitality + In house keeps only the first two, with their own workstreams", () => {
  const plan = planRcoaCpuHandoff([line("exotic_fruit_box"), line("specialty_tea_coffee"), line("deli_sandwich_lunch")], routing);
  assert.deepEqual(plan, { status: "produce", lines: [{ index: 0, classification: "hospitality" }, { index: 2, classification: "sandwiches" }], inHouse: [{ index: 1 }] });
});

test("7. an unmapped item fails closed and names the exact item(s); nothing is guessed, defaulted or dropped", () => {
  const plan = planRcoaCpuHandoff([line("mini_pastries"), line("bagel_box", "Bagel Box"), line("delivered_only", "Odd item")], routing);
  assert.equal(plan.status, "routing_required");
  assert.deepEqual(plan.status === "routing_required" && plan.unmapped.map((item) => [item.index, item.itemName]), [[1, "Bagel Box"], [2, "Odd item"]]);
  // legacy transitional defaults (e.g. cookie_box -> hospitality) are NOT a decision for RCoA
  assert.equal(classifyRcoaLine(line("cookie_box"), {}), undefined);
  assert.equal(classifyRcoaLine(line("mini_pastries"), { [`${P}mini_pastries`]: ["not-a-workstream"] }), undefined);
});

test("8. an empty booking never produces an empty Production Order", () => {
  assert.deepEqual(planRcoaCpuHandoff([], routing), { status: "no_cpu_production_required", inHouse: [] });
});

test("routing keys: canonical menu item id first, then the RCoA canonical id derived from the stable source item id", () => {
  assert.deepEqual(rcoaRoutingKeys({ itemId: "mini_pastries", menuItemId: `${P}mini_pastries` }), [`${P}mini_pastries`]);
  assert.deepEqual(rcoaRoutingKeys({ itemId: "mini_pastries" }), [`${P}mini_pastries`]);
});

test("9. only RCoA bookings are filtered: non-RCoA hand-off keeps its existing behaviour; Hub UI and handoff use the one routing collection", () => {
  const domain = readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  assert.match(domain, /booking\.source\?\.provider === RCOA_PROVIDER/);
  assert.match(domain, /adaptCpuProductionWorkstreams\(assignments\)\.workstreams\[0\] \|\| "unassigned"/, "non-RCoA fallback unchanged");
  const service = readFileSync(new URL("../lib/connections-service.ts", import.meta.url), "utf8");
  assert.equal((service.match(/db\.collection\("integrationHubHospitalityMenuProductionRouting"\)/g) || []).length, 1, "a single routing store");
  assert.match(readFileSync(new URL("../scripts/promote-local-portal-menu-items.ts", import.meta.url), "utf8"), /localRcoaMenuCatalogue/);
});

// ---- real hand-off against the emulator ----
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };
const actor = { uid: "test-rcoa-routing", role: "integration-admin" } as Actor;
const routingCollection = () => db.collection("integrationHubHospitalityMenuProductionRouting");
const ordersFor = async (bookingId: string) => (await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", bookingId).get()).docs.map((doc) => doc.data());

async function rcoaFixture(items: Array<{ itemId: string; itemName: string; quantity: number }>, decisions: Record<string, string[]>) {
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

test("hand-off: Tea & Coffee (In house) + Mini Pastries (Hospitality) -> Production Order with the pastries only; booking keeps both", opts, async () => {
  const f = await rcoaFixture([{ itemId: "specialty_tea_coffee", itemName: "Specialty Tea & Coffee", quantity: 1 }, { itemId: "mini_pastries", itemName: "Mini Pastries", quantity: 20 }], { [`${P}specialty_tea_coffee`]: [], [`${P}mini_pastries`]: ["hospitality"] });
  try {
    const result = await createProductionFromApprovedBooking(actor, f.bookingId, `rcoa-${f.bookingId}`);
    assert.equal(result.created, true);
    assert.deepEqual(result.order!.lines.map((l) => [l.itemName, l.workstream]), [["Mini Pastries", "hospitality"]]);
    assert.equal(result.order!.lines[0].sourceBookingLineId, `${f.bookingId}:line:2`, "traceable to the original booking line");
    const booking = (await db.collection("fikaBookings").doc(f.bookingId).get()).data() as CanonicalBooking;
    assert.deepEqual(booking.order.items.map((i) => i.itemId), ["specialty_tea_coffee", "mini_pastries"], "Hospitality retains the complete booking");
  } finally { await f.cleanup(); }
});

test("hand-off: sandwich lunch keeps the governed three-pieces-per-person conversion and the sandwiches workstream", opts, async () => {
  const f = await rcoaFixture([{ itemId: "deli_sandwich_lunch", itemName: "Deli Style Sandwich Lunch", quantity: 10 }], { [`${P}deli_sandwich_lunch`]: ["sandwiches"] });
  try {
    const order = (await createProductionFromApprovedBooking(actor, f.bookingId, `rcoa-${f.bookingId}`)).order!;
    assert.equal(order.lines[0].workstream, "sandwiches");
    assert.equal(order.lines[0].productionQuantity, 30);
    assert.equal(order.lines[0].productionUnit, "piece");
  } finally { await f.cleanup(); }
});

test("hand-off: all items In house -> explicit 'no CPU production required', no Production Order, booking not marked Sent to CPU", opts, async () => {
  const f = await rcoaFixture([{ itemId: "specialty_tea_coffee", itemName: "Specialty Tea & Coffee", quantity: 1 }], { [`${P}specialty_tea_coffee`]: [] });
  try {
    const outcome = await createProductionOrder(actor, f.bookingId, f.version);
    assert.equal(outcome.status, "no_cpu_production_required");
    assert.equal(outcome.created, false);
    assert.equal((await ordersFor(f.bookingId)).length, 0);
    assert.notEqual(((await db.collection("fikaBookings").doc(f.bookingId).get()).data() as CanonicalBooking).lifecycleStatus, "Sent to CPU");
  } finally { await f.cleanup(); }
});

test("hand-off: an unmapped item fails closed (Routing required), names the item and creates no partial Production Order", opts, async () => {
  const f = await rcoaFixture([{ itemId: "mini_pastries", itemName: "Mini Pastries", quantity: 20 }, { itemId: "bagel_box", itemName: "Bagel Box", quantity: 5 }], { [`${P}mini_pastries`]: ["hospitality"] });
  try {
    await assert.rejects(() => createProductionFromApprovedBooking(actor, f.bookingId, `rcoa-${f.bookingId}`), (error: Error & { code?: string }) => error.code === "ROUTING_REQUIRED" && /Routing required/.test(error.message) && /Bagel Box/.test(error.message) && !/Mini Pastries/.test(error.message));
    assert.equal((await ordersFor(f.bookingId)).length, 0);
  } finally { await f.cleanup(); }
});
