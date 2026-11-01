import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { NextRequest } from "next/server";
import { effectiveServiceLayout, type ServiceLayoutPackage } from "@fika/server-shared/hospitality-service-layout";
import type { CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import { portalMenuFromCatalogue } from "../lib/hospitality-portal-catalogue";
import { rcoaVisibilityFromCatalogue } from "../lib/rcoa-service-visibility";
import { createEmptyRcoaDraft, filterRcoaMenu, rcoaAllowedCategories, rcoaEventTypes, validateRcoaStep } from "../lib/rcoa-portal";
import { buildRcoaClientRequest } from "../lib/rcoa-booking-request-client";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import { buildRcoaGroupHubPayloads } from "../lib/rcoa-booking-group";
import { seedVisibility } from "./support/rcoa-service-visibility";

const OPLOC = seedVisibility.oplocId;
const layout = effectiveServiceLayout({ version: "fixture-visibility-1", sites: { [OPLOC]: { breakfast: { categories: ["Drinks"] }, dining: { categories: ["Wine", "Dining"] }, bespoke: { categories: [], hidden: true } } } });
function packageFor(serviceLayout: ServiceLayoutPackage | undefined = layout): CataloguePackage {
  return { schemaVersion: 2, contract: "fika.hospitality-catalogue-package.v2", oplocs: [{ id: OPLOC, label: "RCoA" }], exceptions: [], ...(serviceLayout ? { serviceLayout } : {}),
    items: [{ id: "hospitality-menu-item:coffee", name: "Coffee", category: "Drinks" }, { id: "hospitality-menu-item:wine", name: "Wine", category: "Wine" }, { id: "hospitality-menu-item:restricted-wine", name: "Restricted wine", category: "Wine", allowedOplocIds: ["oploc:another-site"] }].map(item => ({ ...item, defaultPrices: [{ from: "2026-01-01", amount: 5, vatRate: 0.2 }], defaultMinimumQuantity: 2, defaultMinimumGuests: 3, dietaryInformation: [], allergenInformation: [] })) };
}
const pkg = packageFor();
const menu = portalMenuFromCatalogue(pkg, OPLOC, "2030-12-02");
const visibility = rcoaVisibilityFromCatalogue(pkg, OPLOC);
const requestFor = (itemId = "hospitality-menu-item:wine", eventType = "dining", bookingId = "RCOA-VISIBILITY-ABCDEFG") => ({
  bookingId, submittedAt: "2026-10-31T20:00:00.000Z", client: { name: "Fixture", email: "fixture@example.invalid", phone: "1", companyName: "Fixture" },
  event: { eventDate: "2030-12-02", startTime: "12:00", guestCount: 3, floorLevel: "1", roomOrArea: "Fixture room" }, order: { eventType, items: [{ itemId, quantity: 2 }] },
  dietaries: { hasDietaries: false, vegetarian: 0, vegan: 0, glutenFree: 0, coeliac: 0, dairyFree: 0, halal: 0, otherCount: 0, allergyDetails: "", severeAllergyAcknowledged: false, freeText: "" },
  acknowledgements: { quoteSubjectToConfirmation: true as const, noticePolicyAccepted: true as const, dietaryResponsibilityAccepted: true as const },
});

test("published seed preserves each existing occasion, while missing/unknown settings offer nothing", () => {
  for (const event of rcoaEventTypes) assert.deepEqual(seedVisibility.layout.company[event.id]?.categories, [...event.categories]);
  assert.deepEqual(rcoaAllowedCategories("breakfast", menu, undefined), []);
  assert.deepEqual(filterRcoaMenu(menu, "unknown", "all", "", visibility), []);
  const draft = { ...createEmptyRcoaDraft(), occasion: "breakfast" as const };
  assert.match(validateRcoaStep(0, draft, menu, undefined).occasion, /could not be verified/);
});

test("site override offers Wine at Dining but not Breakfast, without granting item site permission", () => {
  assert.deepEqual(rcoaAllowedCategories("breakfast", menu, visibility), ["Drinks"]);
  assert.deepEqual(filterRcoaMenu(menu, "breakfast", "all", "", visibility).map(item => item.name), ["Coffee"]);
  assert.deepEqual(filterRcoaMenu(menu, "dining", "all", "", visibility).map(item => item.name), ["Wine"]);
  assert.ok(!menu.some(item => item.id.endsWith("restricted-wine")));
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor("hospitality-menu-item:restricted-wine"), menu, visibility), /no longer available/);
  assert.throws(() => buildTrustedRcoaHubPayload(requestFor(undefined, "breakfast"), menu, visibility), /not available for this occasion/);
  assert.equal(buildTrustedRcoaHubPayload(requestFor(), menu, visibility).order.items[0].unitPrice, 5);
  const quantity = requestFor(); quantity.order.items[0].quantity = 1;
  assert.throws(() => buildTrustedRcoaHubPayload(quantity, menu, visibility), /minimum quantity/);
  const guests = requestFor(); guests.event.guestCount = 2;
  assert.throws(() => buildTrustedRcoaHubPayload(guests, menu, visibility), /at least 3 guests/);
});

test("hidden service, missing layout and malformed rules fail closed, including empty bespoke requests", () => {
  assert.throws(() => rcoaVisibilityFromCatalogue({ ...pkg, serviceLayout: undefined }, OPLOC), /could not be verified/);
  for (const invalid of [{ ...layout, version: "" }, { ...layout, company: {} }, { ...layout, sites: { [OPLOC]: { breakfast: { categories: "Wine" } } } }]) {
    assert.throws(() => rcoaVisibilityFromCatalogue({ ...pkg, serviceLayout: invalid as ServiceLayoutPackage }, OPLOC), /could not be verified/);
  }
  assert.throws(() => rcoaVisibilityFromCatalogue(pkg, "oploc:unknown"), /could not be verified/);
  const request = requestFor(undefined, "bespoke"); request.order.items = [];
  assert.throws(() => buildTrustedRcoaHubPayload(request, menu, visibility), /no longer offered/);
});

test("request construction retains a missing selected id and browser review rejects a configured-away line", () => {
  const draft = { ...createEmptyRcoaDraft(), occasion: "breakfast" as const, lines: [{ itemId: "hospitality-menu-item:wine", quantity: 2, choices: {} }, { itemId: "removed-id", quantity: 2, choices: {} }] };
  assert.deepEqual(buildRcoaClientRequest(draft, menu, { bookingId: "RCOA-VISIBILITY-ABCDEFG", submittedAt: "2026-10-31T20:00:00Z" }).order.items.map(item => item.itemId), ["hospitality-menu-item:wine", "removed-id"]);
  assert.match(validateRcoaStep(3, { ...draft, lines: draft.lines.slice(0, 1) }, menu, visibility).items, /no longer offered/);
  assert.equal(draft.lines.length, 2);
});

const group = (secondOccasion = "dining") => {
  const id = "RCOA-VISIBILITY-ABCDEFG";
  return { bookingGroup: { id, size: 2 }, requests: [requestFor(undefined, "breakfast", `${id}-01`), requestFor(undefined, secondOccasion, `${id}-02`)].map((request, index) => ({ ...request, bookingGroup: { id, size: 2, sequence: index + 1 } })) };
};
test("All Day validates every missing row independently and a historical sibling never grants a category to a new row", () => {
  assert.throws(() => buildRcoaGroupHubPayloads(group(), menu, visibility), /Service 1/);
  const prior = new Set([group().requests[0].bookingId]);
  assert.equal(buildRcoaGroupHubPayloads(group(), menu, visibility, prior).payloads.length, 2);
  assert.throws(() => buildRcoaGroupHubPayloads(group("breakfast"), menu, visibility, prior), /Service 2/);
});

process.env.FIKA_HUB_BASE_URL = "http://visibility-hub.test";
process.env.MNK_CANON_BRIDGE_TOKEN = "isolated-fixture";
process.env.FIKA_RCOA_OPLOC_ID = OPLOC;
const { POST: singlePost } = await import("../app/api/bookings/rcoa/route");
const { POST: groupPost } = await import("../app/api/bookings/rcoa/group/route");
const post = (body: unknown) => new NextRequest("http://hospitality.test/api/bookings/rcoa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function withPublishedPackage(run: (calls: Array<{ body: Record<string, unknown>; existingOnly: boolean }>, existing: Set<string>) => Promise<void>, supplied = pkg, unavailable = false) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(supplied))), hash = createHash("sha256").update(bytes).digest("hex");
  const calls: Array<{ body: Record<string, unknown>; existingOnly: boolean }> = [], existing = new Set<string>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/hospitality-catalogue/public-package")) { if (unavailable) throw new Error("offline"); return Response.json({ dataset: "hospitality-booking/catalogue", packageVersion: 1, schemaVersion: 2, contractVersion: supplied.contract, objectName: `catalogue/${hash}.json.gz`, compression: "gzip", contentHash: hash, compressedSize: bytes.length, generatedAt: "2026-10-31T20:00:00Z" }); }
    if (url.endsWith(`/public-package/${hash}`)) return new Response(new Uint8Array(bytes));
    const body = JSON.parse(String(init?.body || "{}"));
    if (url.endsWith("/api/bookings/mnk/existing")) return Response.json({ existingBookingIds: body.bookingIds.filter((id: string) => existing.has(id)) });
    assert.ok(url.endsWith("/api/bookings/mnk"), "only isolated booking bridge calls are possible");
    const existingOnly = new Headers(init?.headers).get("x-fika-rcoa-existing-only") === "true";
    calls.push({ body, existingOnly });
    if (existingOnly && !existing.has(body.bookingId)) return Response.json({ error: { message: "missing" } }, { status: 409 });
    return Response.json({ canonicalBookingId: `booking:rcoa:${body.bookingId}`, status: "New", created: !existing.has(body.bookingId) });
  }) as typeof fetch;
  try { await run(calls, existing); } finally { globalThis.fetch = original; }
}

test("actual standard and group server routes reject disallowed new categories before any booking write", async () => {
  await withPublishedPackage(async calls => {
    assert.equal((await singlePost(post(requestFor(undefined, "breakfast")))).status, 400);
    assert.equal((await groupPost(post(group()))).status, 400);
    assert.deepEqual(calls, []);
  });
});
test("missing/unverified package cannot authorize new bookings", async () => {
  await withPublishedPackage(async calls => { assert.equal((await singlePost(post(requestFor()))).status, 503); assert.deepEqual(calls, []); }, { ...pkg, serviceLayout: undefined });
  await withPublishedPackage(async calls => { assert.equal((await singlePost(post(requestFor()))).status, 503); assert.deepEqual(calls, []); }, pkg, true);
});
test("existing standard/partial All Day replay is explicitly no-create, while every missing child uses current visibility", async () => {
  await withPublishedPackage(async (calls, existing) => {
    existing.add(requestFor().bookingId);
    assert.equal((await singlePost(post(requestFor(undefined, "breakfast")))).status, 200);
    assert.equal(calls[0].existingOnly, true);
    calls.length = 0; existing.add(group().requests[0].bookingId);
    assert.equal((await groupPost(post(group()))).status, 200);
    assert.deepEqual(calls.map(call => call.existingOnly), [true, false]);
    calls.length = 0;
    assert.equal((await groupPost(post(group("breakfast")))).status, 400);
    assert.deepEqual(calls, []);
  });
});
