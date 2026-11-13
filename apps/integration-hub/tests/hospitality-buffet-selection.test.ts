import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import {
  HOT_FORK_BUFFET_CHOICE_ID,
  HOT_FORK_BUFFET_SELECTION_CONTRACT,
  HOT_FORK_BUFFET_LEGACY_SELECTION_CONTRACT,
  HOT_FORK_BUFFET_MENU_VERSION,
  HOT_FORK_BUFFET_RULES_VERSION,
  HotForkBuffetChoiceSchema,
  assertHotForkBuffetAmendment,
  assertHotForkBuffetCustomerSubmission,
  hotForkBuffetMenu,
  validateBuffetDietaryCounts,
  validateHotForkBuffetDraft,
  type BuffetSelection,
} from "@fika/server-shared/hospitality-buffet-selection";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import { GET as menuGET } from "../app/api/hospitality-buffet-selection/route";
import { quoteOrderTableHtml } from "../../shared/hospitality-quote-document";
import type { MnkBookingPayload } from "../lib/hospitality-booking-service";
import type { CanonicalRecord } from "../lib/types";
import { db } from "../lib/firebase-admin";
import { createProductionFromApprovedBookingTransaction, productionOrderV1Id, productionRequirementId } from "../lib/production-domain";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";

const dishes = hotForkBuffetMenu.dishes;
const id = (category: string, index: number) => {
  const dish = dishes.filter(value => value.category === category)[index];
  assert.ok(dish);
  return dish.id;
};
const goldItem = "hospitality-menu-item:rcoa:hot_fork_buffet_gold";
const silverItem = "hospitality-menu-item:rcoa:hot_fork_buffet_silver";
const gold = (): BuffetSelection => ({
  contract: HOT_FORK_BUFFET_SELECTION_CONTRACT,
  menuVersion: HOT_FORK_BUFFET_MENU_VERSION,
  rulesVersion: HOT_FORK_BUFFET_RULES_VERSION,
  packageId: "gold",
  mains: [{ dishId: id("fish", 0), portions: 36 }, { dishId: id("vegan", 0), portions: 24 }],
  saladIds: [id("salad", 0), id("salad", 1), id("salad", 2)],
  dessertIds: [id("dessert", 0), id("dessert", 1)],
});
const clone = <T>(value: T): T => structuredClone(value);

test("Sam's versioned menu retains all 44 source dishes and unknown safety states", () => {
  assert.equal(hotForkBuffetMenu.contract, "fika.hot-fork-buffet-menu.v1");
  assert.deepEqual(Object.fromEntries(["meat", "fish", "vegetarian", "vegan", "salad", "dessert"].map(category => [category, dishes.filter(dish => dish.category === category).length])), { meat: 5, fish: 5, vegetarian: 5, vegan: 5, salad: 14, dessert: 10 });
  assert.equal(new Set(dishes.map(dish => dish.id)).size, 44);
  assert.ok(dishes.every(dish => dish.allergenStatus === "unrecorded" && dish.dietaryStatus === "unrecorded"));
  assert.match(dishes.find(dish => dish.selectionStatus === "review_required")?.name || "", /Feta Shakshuka/);
  assert.equal(hotForkBuffetMenu.readiness.customerSubmission, false);
  assert.equal(hotForkBuffetMenu.readiness.status, "rules_confirmed");
  assert.deepEqual(hotForkBuffetMenu.readiness.pendingRules, []);
  assert.equal(hotForkBuffetMenu.rulesVersion, HOT_FORK_BUFFET_RULES_VERSION);
  assert.equal(hotForkBuffetMenu.readiness.liveOrderingApprovalRequired, true);
});

test("menu provider remains private and requires the existing bridge token", async () => {
  const flag = process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
  const token = process.env.MNK_CANON_BRIDGE_TOKEN;
  process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = "true";
  process.env.MNK_CANON_BRIDGE_TOKEN = "buffet-test-bridge";
  try {
    const url = "http://test/api/hospitality-buffet-selection";
    const denied = await menuGET(new NextRequest(url));
    assert.equal(denied.status, 401);
    const response = await menuGET(new NextRequest(url, { headers: { "x-fika-mnk-bridge-token": "buffet-test-bridge" } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).menuVersion, HOT_FORK_BUFFET_MENU_VERSION);
  } finally {
    if (flag === undefined) delete process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED; else process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = flag;
    if (token === undefined) delete process.env.MNK_CANON_BRIDGE_TOKEN; else process.env.MNK_CANON_BRIDGE_TOKEN = token;
  }
});

test("confirmed main, salad and dessert draft rules validate exact source IDs and portions", () => {
  assert.equal(validateHotForkBuffetDraft(gold(), goldItem, 60).packageId, "gold");
  const silver: BuffetSelection = { ...gold(), packageId: "silver", mains: [{ dishId: id("fish", 1), portions: 24 }, { dishId: id("vegetarian", 0), portions: 36 }], dessertIds: [id("dessert", 2)] };
  assert.equal(validateHotForkBuffetDraft(silver, silverItem, 60).packageId, "silver");
  const wrongMain = clone(gold()); wrongMain.mains[0].dishId = id("vegan", 1);
  assert.throws(() => validateHotForkBuffetDraft(wrongMain, goldItem, 60), /meat or fish/);
  const underMin = clone(gold()); underMin.mains[0].portions = 11; underMin.mains[1].portions = 49;
  assert.throws(() => validateHotForkBuffetDraft(underMin, goldItem, 60), /at least 12/);
  const wrongTotal = clone(gold()); wrongTotal.mains[0].portions = 35;
  assert.throws(() => validateHotForkBuffetDraft(wrongTotal, goldItem, 60), /guest count/);
  const duplicateSalad = clone(gold()); duplicateSalad.saladIds[1] = duplicateSalad.saladIds[0];
  assert.throws(() => validateHotForkBuffetDraft(duplicateSalad, goldItem, 60), /three different salads/);
  const falseVegan = clone(gold()); falseVegan.mains[1].dishId = id("vegan", 4);
  assert.throws(() => validateHotForkBuffetDraft(falseVegan, goldItem, 60), /dietary review/);
  const odd = clone(gold()); odd.mains[0].portions = 37;
  assert.doesNotThrow(() => validateHotForkBuffetDraft(odd, goldItem, 61));
  assert.doesNotThrow(() => validateHotForkBuffetDraft({ ...odd, packageId: "silver", dessertIds: [id("dessert", 2)] }, silverItem, 61));
  const duplicateDessert = clone(gold()); duplicateDessert.dessertIds[1] = duplicateDessert.dessertIds[0];
  assert.throws(() => validateHotForkBuffetDraft(duplicateDessert, goldItem, 60), /different|exactly 2/);
  const minimum = clone(gold()); minimum.mains[0].portions = 12; minimum.mains[1].portions = 12;
  assert.doesNotThrow(() => validateHotForkBuffetDraft(minimum, goldItem, 24));
  assert.throws(() => validateHotForkBuffetDraft({ ...gold(), desserts: [{ dishId: id("dessert", 0), portions: 30 }] }, goldItem, 60), /malformed/);
  assert.throws(() => validateHotForkBuffetDraft({ ...gold(), rulesVersion: "old-rules" }, goldItem, 60), /older menu or rules version/);
  assert.doesNotThrow(() => validateBuffetDietaryCounts({ vegetarian: 24, dairyFree: 24 }, 60), "overlapping dietary categories do not add main portions");
  assert.throws(() => validateBuffetDietaryCounts({ vegetarian: 61 }, 60), /within the guest count/);
  assert.throws(() => assertHotForkBuffetCustomerSubmission(gold(), goldItem, 60), /awaiting live customer-ordering approval/);
  assert.equal(HotForkBuffetChoiceSchema.safeParse({ id: HOT_FORK_BUFFET_CHOICE_ID, value: { ...gold(), menuVersion: "historical-version" } }).success, true, "historical versions can pass through the replay adapter");
  assert.equal(HotForkBuffetChoiceSchema.safeParse({ id: HOT_FORK_BUFFET_CHOICE_ID, value: { ...gold(), dietaryRequirements: "duplicate free text" } }).success, false);
  const historical = { contract: HOT_FORK_BUFFET_LEGACY_SELECTION_CONTRACT, menuVersion: HOT_FORK_BUFFET_MENU_VERSION, packageId: "gold", mains: gold().mains, saladIds: gold().saladIds, desserts: gold().dessertIds.map(dishId => ({ dishId, portions: 30 })) };
  assert.equal(HotForkBuffetChoiceSchema.safeParse({ id: HOT_FORK_BUFFET_CHOICE_ID, value: historical }).success, true);
});

function bookingPayload(choices?: unknown[]): MnkBookingPayload {
  return {
    bookingId: "buffet-test-1", submittedAt: "2026-11-13T12:00:00.000Z", siteId: "rcoa",
    client: { name: "Test Customer", companyName: "Test Company", email: "test@example.test" },
    event: { eventDate: "2026-12-03", startTime: "12:00", guestCount: 60 },
    order: { items: [{ itemId: goldItem, itemName: "Untrusted name", unitPrice: 999, quantity: 60, lineTotal: 59940, ...(choices ? { choices } : {}) }], netTotal: 59940 },
  };
}

test("staging keeps menu-on-request ordering and rejects unapproved structured choices", () => {
  const previous = process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
  process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = "true";
  try {
    const legacyGold = trustedPublicOrder(bookingPayload(), [], "rcoa");
    assert.equal(legacyGold.items[0].unitPrice, 28);
    assert.equal(legacyGold.items[0].choices, undefined);
    const silverPayload = bookingPayload(); silverPayload.order.items[0].itemId = silverItem;
    assert.equal(trustedPublicOrder(silverPayload, [], "rcoa").items[0].unitPrice, 20);
    assert.throws(() => trustedPublicOrder(bookingPayload([{ id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() }]), [], "rcoa"), /awaiting live customer-ordering approval/);
    assert.throws(() => trustedPublicOrder(bookingPayload([{ id: HOT_FORK_BUFFET_CHOICE_ID, value: { ...gold(), mains: [] } }]), [], "rcoa"), /malformed/);
  } finally {
    if (previous === undefined) delete process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
    else process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = previous;
  }
});

test("menu-on-request amendments remain available without accepting a new selector choice", () => {
  const unchanged = { itemId: goldItem, previousItemExists: true, quantity: 60, previousQuantity: 60, guestCount: 60, previousGuestCount: 60 };
  assert.doesNotThrow(() => assertHotForkBuffetAmendment(unchanged));
  assert.doesNotThrow(() => assertHotForkBuffetAmendment({ ...unchanged, previousItemExists: false, previousQuantity: undefined }));
  assert.doesNotThrow(() => assertHotForkBuffetAmendment({ ...unchanged, quantity: 72 }));
  assert.doesNotThrow(() => assertHotForkBuffetAmendment({ ...unchanged, guestCount: 72 }));
  assert.doesNotThrow(() => assertHotForkBuffetAmendment({ ...unchanged, itemId: "standard-lunch", quantity: 72 }));
  assert.throws(() => assertHotForkBuffetAmendment({ ...unchanged, selection: { id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() } }), /awaiting live customer-ordering approval/);
});

test("amendment gate preserves a historical menu but requires approval for material changes", () => {
  const choice = { id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() } as const;
  const prior = { itemId: goldItem, previousItemExists: true, quantity: 60, previousQuantity: 60, guestCount: 60, previousGuestCount: 60, selection: choice, priorSelection: choice };
  assert.doesNotThrow(() => assertHotForkBuffetAmendment(prior));
  assert.throws(() => assertHotForkBuffetAmendment({ ...prior, selection: undefined }), /cannot be silently removed/);
  assert.throws(() => assertHotForkBuffetAmendment({ ...prior, quantity: 72 }), /quantity must equal the guest count/);
  const expanded = gold(); expanded.mains[1].portions = 36;
  assert.throws(() => assertHotForkBuffetAmendment({ ...prior, quantity: 72, guestCount: 72, selection: { id: HOT_FORK_BUFFET_CHOICE_ID, value: expanded } }), /awaiting live customer-ordering approval/);
});

test("production-disabled selector preserves the old RCoA menu-on-request price path", () => {
  const previous = process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
  process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = "false";
  try {
    const order = trustedPublicOrder(bookingPayload(), [], "rcoa");
    assert.equal(order.items[0].unitPrice, 28);
    assert.equal(order.items[0].lineTotal, 1680);
    assert.equal(order.netTotal, 1680);
  } finally {
    if (previous === undefined) delete process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
    else process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = previous;
  }
});

test("effective canonical catalogue price overrides the checked-in buffet brochure amount", () => {
  const previous = process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
  process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = "false";
  try {
    const record = { canonicalId: goldItem, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active", providerMappings: [{ provider: "rcoa-hospitality-brochure", sourceItemId: goldItem }], name: "Hot Fork Buffet Gold", category: "Buffet", unitPrice: 31 } } as unknown as CanonicalRecord;
    const order = trustedPublicOrder(bookingPayload(), [record], "rcoa");
    assert.equal(order.items[0].unitPrice, 31);
    assert.equal(order.netTotal, 1860);
  } finally {
    if (previous === undefined) delete process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
    else process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = previous;
  }
});

test("quote renders main quantities and chef-discretion dessert choices without stale catalogue copy", () => {
  const html = quoteOrderTableHtml([{ itemId: goldItem, name: "Hot Fork Buffet Gold", description: "Meat, fish, vegan, two sides and four salads.", quantity: 60, unitNet: { amount: 28 }, lineNet: { amount: 1680 }, choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() }] }], []);
  assert.match(html, /Selected mains: 36 ×/);
  assert.match(html, /Selected salads \(chef allocates portions\)/);
  assert.match(html, /Selected desserts \(50\/50 intent; chef allocates portions\)/);
  assert.doesNotMatch(html, /30 ×/);
  assert.match(html, /allergen and dietary information has not been verified/i);
  assert.doesNotMatch(html, /four salads/);
  assert.match(html, /£28\.00/);
  const pending = { ...gold(), packageId: "silver" as const, dessertIds: [id("dessert", 0)] };
  const pendingHtml = quoteOrderTableHtml([{ itemId: silverItem, name: "Hot Fork Buffet Silver", quantity: 60, lineNet: { amount: 1200 }, choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: pending }] }], []);
  assert.match(pendingHtml, /Selected dessert \(chef allocates portions\)/);
});

test("historical v1 quote retains its frozen dessert quantities", () => {
  const previous = gold();
  const historical = { contract: HOT_FORK_BUFFET_LEGACY_SELECTION_CONTRACT, menuVersion: previous.menuVersion, packageId: previous.packageId, mains: previous.mains, saladIds: previous.saladIds, desserts: previous.dessertIds.map(dishId => ({ dishId, portions: 30 })) };
  const html = quoteOrderTableHtml([{ itemId: goldItem, name: "Hot Fork Buffet Gold", quantity: 60, unitNet: { amount: 28 }, lineNet: { amount: 1680 }, choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: historical }] }], []);
  assert.match(html, /Selected desserts: 30 ×/);
});

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && ["127.0.0.1:8085", "127.0.0.1:8292"].includes(process.env.FIRESTORE_EMULATOR_HOST || "") && (process.env.FIKA_RUNTIME_MODE || "local") === "local";
test("emulator: explicit buffet handoff freezes choice, quote, dietaries and one event across replay", { skip: !emulatorEnabled }, async () => {
  const suffix = crypto.randomUUID();
  const bookingId = `booking:buffet-rules:${suffix}`;
  const quoteId = `quote:buffet-rules:${suffix}:r1`;
  const orderId = productionOrderV1Id(bookingId);
  const requirementId = productionRequirementId(bookingId, quoteId);
  const selected = { id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() };
  const actor = { uid: `buffet-test:${suffix}`, role: "integration-admin" } as Actor;
  const now = "2026-11-13T12:00:00.000Z";
  const bookingRef = db.collection("fikaBookings").doc(bookingId);
  const routingRef = db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(goldItem));
  const originalRouting = await routingRef.get();
  const booking = {
    canonicalId: bookingId, entityType: "Booking", schemaVersion: "0.1.0", version: 4, lifecycleStatus: "Quoted",
    createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
    source: { provider: "rcoa-booking-platform", sourceBookingId: suffix },
    client: { name: "Test Host", email: "host@example.test", companyName: "Test Client" },
    service: { eventDate: "2026-12-03", startTime: "12:00", guestCount: 60, portalSiteId: "rcoa", portalSiteLabel: "RCoA", oplocId: `oploc:buffet-test:${suffix}` },
    order: { eventType: "Hot Fork Buffet", items: [{ itemId: goldItem, menuItemId: goldItem, itemName: "Hot Fork Buffet Gold", quantity: 60, unitPrice: 31, lineTotal: 1860, choices: [selected] }], netTotal: 1860, vatTotal: 372, grossTotal: 2232 },
    dietaries: { vegetarian: 24, allergyDetails: "Test review note" }, acknowledgements: {}, notes: "", attachments: [], statusHistory: [], audit: [], deliveryChargeRequired: true,
    quoteState: { currentRevisionId: quoteId, revisions: [{ id: quoteId, revision: 1, createdAt: now, createdBy: actor.uid, commercialVersion: 1, snapshot: { order: { lines: [{ choices: [selected], unitNet: { amount: 31 } }] } }, stale: false, pdfStatus: "saved", driveFileId: `test-quote:${suffix}` }] },
  };
  try {
    await routingRef.set({ menuItemId: goldItem, workstreams: ["hospitality"] });
    await bookingRef.set(booking);
    const first = await createProductionFromApprovedBookingTransaction(actor, bookingId, `buffet-handoff:${bookingId}:v4`);
    assert.equal(first.created, true);
    assert.equal(first.order?.canonicalId, orderId);
    assert.deepEqual(first.order?.lines[0].choices, [selected]);
    assert.deepEqual(first.order?.bookingDietaries, booking.dietaries);
    assert.equal(first.order?.lines[0].productionQuantity, undefined);
    assert.equal(first.order?.lines[0].workstream, "hospitality");
    assert.equal(first.requirement?.sourceBookingRevision, 4);
    assert.deepEqual((first.requirement?.sourceSnapshot.quote as typeof booking.quoteState.revisions[0]["snapshot"]).order.lines[0].choices, [selected]);
    assert.equal(first.order?.audit.filter(entry => entry.action === "production-order-created").length, 1);
    await assert.rejects(createProductionFromApprovedBookingTransaction(actor, bookingId, `buffet-handoff:${bookingId}:v4`), /current quote/);
    const [orders, requirements, events, notifications] = await Promise.all([
      db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", bookingId).get(),
      db.collection("fikaProductionRequirements").where("sourceBookingId", "==", bookingId).get(),
      db.collection("fikaDomainEventsV1").where("sourceAggregateId", "==", orderId).get(),
      db.collection("fikaBookingNotifications").where("bookingId", "==", bookingId).get(),
    ]);
    assert.equal(orders.size, 1);
    assert.equal(requirements.size, 1);
    assert.equal(events.size, 1);
    assert.equal(notifications.docs.filter(doc => String(doc.get("kind")) === "buffet-handoff").length, 1);
    assert.equal((await bookingRef.get()).data()?.audit.filter((entry: { action: string }) => entry.action === "booking-sent-to-cpu").length, 1);
  } finally {
    const [notifications, fulfilment, inbox] = await Promise.all([
      db.collection("fikaBookingNotifications").where("bookingId", "==", bookingId).get(),
      db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get(),
      db.collection("fikaDomainEventInboxV1").where("sourceAggregateId", "==", orderId).get(),
    ]);
    const batch = db.batch();
    for (const ref of [bookingRef, db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)), db.collection("fikaProductionRequirements").doc(stableDocumentId(requirementId)), db.collection("fikaDomainEventsV1").doc(`production.order.created:${orderId}:v1`), ...notifications.docs.map(doc => doc.ref), ...fulfilment.docs.map(doc => doc.ref), ...inbox.docs.map(doc => doc.ref)]) batch.delete(ref);
    await batch.commit();
    if (originalRouting.exists) await routingRef.set(originalRouting.data()!); else await routingRef.delete();
  }
});
