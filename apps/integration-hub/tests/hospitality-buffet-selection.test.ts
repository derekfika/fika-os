import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  HOT_FORK_BUFFET_CHOICE_ID,
  HOT_FORK_BUFFET_SELECTION_CONTRACT,
  HOT_FORK_BUFFET_MENU_VERSION,
  HotForkBuffetChoiceSchema,
  assertHotForkBuffetAmendment,
  assertHotForkBuffetCustomerSubmission,
  hotForkBuffetMenu,
  hotForkBuffetSelectionDetails,
  validateHotForkBuffetDraft,
  type BuffetSelection,
} from "@fika/server-shared/hospitality-buffet-selection";
import { trustedPublicOrder } from "../lib/hospitality-price-trust";
import { GET as menuGET } from "../app/api/hospitality-buffet-selection/route";
import { quoteOrderTableHtml } from "../../shared/hospitality-quote-document";
import type { MnkBookingPayload } from "../lib/hospitality-booking-service";
import type { CanonicalRecord } from "../lib/types";

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
  packageId: "gold",
  mains: [{ dishId: id("fish", 0), portions: 36 }, { dishId: id("vegan", 0), portions: 24 }],
  saladIds: [id("salad", 0), id("salad", 1), id("salad", 2)],
  desserts: [{ dishId: id("dessert", 0), portions: 30 }, { dishId: id("dessert", 1), portions: 30 }],
});
const clone = <T>(value: T): T => structuredClone(value);

test("Sam's versioned menu retains all 44 source dishes and unknown safety states", () => {
  assert.equal(hotForkBuffetMenu.contract, "fika.hot-fork-buffet-menu.v1");
  assert.deepEqual(Object.fromEntries(["meat", "fish", "vegetarian", "vegan", "salad", "dessert"].map(category => [category, dishes.filter(dish => dish.category === category).length])), { meat: 5, fish: 5, vegetarian: 5, vegan: 5, salad: 14, dessert: 10 });
  assert.equal(new Set(dishes.map(dish => dish.id)).size, 44);
  assert.ok(dishes.every(dish => dish.allergenStatus === "unrecorded" && dish.dietaryStatus === "unrecorded"));
  assert.match(dishes.find(dish => dish.selectionStatus === "review_required")?.name || "", /Feta Shakshuka/);
  assert.equal(hotForkBuffetMenu.readiness.customerSubmission, false);
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
  const silver: BuffetSelection = { ...gold(), packageId: "silver", mains: [{ dishId: id("fish", 1), portions: 24 }, { dishId: id("vegetarian", 0), portions: 36 }], desserts: [{ dishId: id("dessert", 2), portions: null }] };
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
  assert.throws(() => validateHotForkBuffetDraft(odd, goldItem, 61), /odd guest count/);
  const wrongDessert = clone(gold()); wrongDessert.desserts[0].portions = 29;
  assert.throws(() => validateHotForkBuffetDraft(wrongDessert, goldItem, 60), /split equally/);
  assert.throws(() => assertHotForkBuffetCustomerSubmission(gold(), goldItem, 60), /awaiting package rule approval/);
  assert.equal(HotForkBuffetChoiceSchema.safeParse({ id: HOT_FORK_BUFFET_CHOICE_ID, value: { ...gold(), menuVersion: "historical-version" } }).success, true, "historical versions can pass through the replay adapter");
  assert.equal(HotForkBuffetChoiceSchema.safeParse({ id: HOT_FORK_BUFFET_CHOICE_ID, value: { ...gold(), dietaryRequirements: "duplicate free text" } }).success, false);
});

test("planner demand detail resolves source names without allocating salad or pending dessert portions", () => {
  const details = hotForkBuffetSelectionDetails(gold());
  assert.equal(details?.mains[0].name, dishes.find(dish => dish.id === gold().mains[0].dishId)?.name);
  assert.equal(details?.mains[0].portions, 36);
  assert.equal(details?.salads[0].portionStatus, "manual-confirmation-required");
  const pending = { ...gold(), packageId: "silver" as const, desserts: [{ dishId: id("dessert", 0), portions: null }] };
  assert.equal(hotForkBuffetSelectionDetails(pending)?.desserts[0].portions, null);
  assert.equal(hotForkBuffetSelectionDetails({ ...gold(), menuVersion: "historical-version" })?.menuStatus, "historical-menu-unavailable");
});

function bookingPayload(choices?: unknown[]): MnkBookingPayload {
  return {
    bookingId: "buffet-test-1", submittedAt: "2026-11-13T12:00:00.000Z", siteId: "rcoa",
    client: { name: "Test Customer", companyName: "Test Company", email: "test@example.test" },
    event: { eventDate: "2026-12-03", startTime: "12:00", guestCount: 60 },
    order: { items: [{ itemId: goldItem, itemName: "Untrusted name", unitPrice: 999, quantity: 60, lineTotal: 59940, ...(choices ? { choices } : {}) }], netTotal: 59940 },
  };
}

test("selector-enabled Hub blocks missing and unapproved menu choices before a booking write", () => {
  const previous = process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
  process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = "true";
  try {
    assert.throws(() => trustedPublicOrder(bookingPayload(), [], "rcoa"), /Choose Menu is required/);
    assert.throws(() => trustedPublicOrder(bookingPayload([{ id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() }]), [], "rcoa"), /awaiting package rule approval/);
  } finally {
    if (previous === undefined) delete process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED;
    else process.env.FIKA_HOT_FORK_BUFFET_SELECTOR_ENABLED = previous;
  }
});

test("amendment gate rejects new or increased buffet lines without a menu", () => {
  const unchanged = { itemId: goldItem, previousItemExists: true, quantity: 60, previousQuantity: 60, guestCount: 60, previousGuestCount: 60, selectorEnabled: true };
  assert.doesNotThrow(() => assertHotForkBuffetAmendment(unchanged));
  assert.throws(() => assertHotForkBuffetAmendment({ ...unchanged, previousItemExists: false, previousQuantity: undefined }), /Choose a Hot Fork Buffet menu/);
  assert.throws(() => assertHotForkBuffetAmendment({ ...unchanged, quantity: 72 }), /Choose a Hot Fork Buffet menu/);
  assert.throws(() => assertHotForkBuffetAmendment({ ...unchanged, guestCount: 72 }), /Choose a Hot Fork Buffet menu/);
  assert.doesNotThrow(() => assertHotForkBuffetAmendment({ ...unchanged, itemId: "standard-lunch", quantity: 72 }));
  assert.doesNotThrow(() => assertHotForkBuffetAmendment({ ...unchanged, selectorEnabled: false, quantity: 72 }));
});

test("amendment gate preserves a historical menu but requires approval for material changes", () => {
  const choice = { id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() } as const;
  const prior = { itemId: goldItem, previousItemExists: true, quantity: 60, previousQuantity: 60, guestCount: 60, previousGuestCount: 60, selectorEnabled: true, selection: choice, priorSelection: choice };
  assert.doesNotThrow(() => assertHotForkBuffetAmendment(prior));
  assert.throws(() => assertHotForkBuffetAmendment({ ...prior, selection: undefined }), /cannot be silently removed/);
  assert.throws(() => assertHotForkBuffetAmendment({ ...prior, quantity: 72 }), /quantity must equal the guest count/);
  const expanded = gold(); expanded.mains[1].portions = 36; expanded.desserts.forEach(dessert => { dessert.portions = 36; });
  assert.throws(() => assertHotForkBuffetAmendment({ ...prior, quantity: 72, guestCount: 72, selection: { id: HOT_FORK_BUFFET_CHOICE_ID, value: expanded } }), /awaiting package rule approval/);
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

test("quote renders frozen dish quantities and omits superseded four-salad catalogue copy", () => {
  const html = quoteOrderTableHtml([{ itemId: goldItem, name: "Hot Fork Buffet Gold", description: "Meat, fish, vegan, two sides and four salads.", quantity: 60, unitNet: { amount: 28 }, lineNet: { amount: 1680 }, choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: gold() }] }], []);
  assert.match(html, /Selected mains: 36 ×/);
  assert.match(html, /Selected salads \(portions to confirm\)/);
  assert.match(html, /Selected desserts: 30 ×/);
  assert.match(html, /allergen and dietary information has not been verified/i);
  assert.doesNotMatch(html, /four salads/);
  assert.match(html, /£28\.00/);
  const pending = { ...gold(), packageId: "silver" as const, desserts: [{ dishId: id("dessert", 0), portions: null }] };
  const pendingHtml = quoteOrderTableHtml([{ itemId: silverItem, name: "Hot Fork Buffet Silver", quantity: 60, lineNet: { amount: 1200 }, choices: [{ id: HOT_FORK_BUFFET_CHOICE_ID, value: pending }] }], []);
  assert.match(pendingHtml, /Selected desserts: .*\(portions to confirm\)/);
});
