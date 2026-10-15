import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { localRcoaMenuCatalogue } from "../lib/local-rcoa-menu";
import { buildRcoaClientRequest, buildRcoaGroupClientRequests } from "../lib/rcoa-booking-request-client";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import { buildRcoaGroupHubPayloads } from "../lib/rcoa-booking-group";
import {
  addRcoaMoment,
  applyRcoaDraft,
  composeRcoaDraft,
  createEmptyRcoaGroup,
  duplicateRcoaMoment,
  rcoaChildReference,
  removeRcoaMoment,
  setRcoaMultiple,
  validateRcoaGroup,
  type RcoaGroupDraft,
} from "../lib/rcoa-portal";
import type { PortalMenuItem } from "../lib/mnk-contract";

const menu: PortalMenuItem[] = localRcoaMenuCatalogue.items.filter((item) => item.lifecycleState === "active").map((item) => ({
  canonicalId: item.canonicalId, id: item.source.sourceItemId, name: item.name, description: item.description, category: item.category,
  unitPrice: item.pricing.unitPrice, vatRate: item.pricing.vatRate, dietaryInformation: item.dietaryInformation, allergenInformation: item.allergenInformation,
  minimumQuantity: item.orderingConstraints.minimumQuantity, minimumGuests: item.orderingConstraints.minimumGuests || undefined, noticeRequiredDays: item.orderingConstraints.noticeRequiredDays,
  serves: item.orderingConstraints.serves, suggestionType: item.orderingConstraints.suggestionType, suggestionLabel: item.orderingConstraints.suggestionLabel, suggestionUnit: item.orderingConstraints.suggestionUnit,
  optionGroups: item.optionGroups, servingInfo: item.pricing.servingInfo,
}));

const GROUP_ID = "RCOA-20261201090000-AB12";
const AT = "2026-12-01T09:00:00.000Z";

/** 09:00 tea/coffee (20, Room A) · 11:00 tea/coffee + pastries (25, Room A) · 13:00 lunch (35, Room B). */
function threeServices(): RcoaGroupDraft {
  let group = createEmptyRcoaGroup();
  group = { ...group, multiple: true, contact: { name: "Casey Guest", email: "Casey@Example.test", phone: "020 0000 0000", companyName: "The College", invoiceReference: "PO-4411" }, eventDate: "2026-12-10", specialInstructions: "Please set up from 08:30.", acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } };
  const set = (index: number, patch: (draft: ReturnType<typeof composeRcoaDraft>) => ReturnType<typeof composeRcoaDraft>) => { group = applyRcoaDraft(group, patch(composeRcoaDraft(group, index)), index); };
  set(0, (d) => ({ ...d, occasion: "breakfast", event: { ...d.event, startTime: "09:00", guestCount: 20, roomOrArea: "Room A" }, lines: [{ itemId: "specialty_tea_coffee", quantity: 20, choices: {} }] }));
  group = addRcoaMoment(group, "m2");
  set(1, (d) => ({ ...d, occasion: "meeting_hospitality", event: { ...d.event, startTime: "11:00", guestCount: 25, roomOrArea: "Room A" }, lines: [{ itemId: "specialty_tea_coffee", quantity: 25, choices: {} }, { itemId: "mini_pastries", quantity: 2, choices: {} }] }));
  group = addRcoaMoment(group, "m3");
  set(2, (d) => ({ ...d, occasion: "lunch", event: { ...d.event, startTime: "13:00", guestCount: 35, roomOrArea: "Room B" }, lines: [{ itemId: "deli_sandwich_lunch", quantity: 35, choices: {} }] }));
  return group;
}

const requestsFor = (group: RcoaGroupDraft) => buildRcoaGroupClientRequests(group, menu, { groupId: GROUP_ID, submittedAt: AT });
const submission = (group: RcoaGroupDraft) => ({ bookingGroup: { id: GROUP_ID, size: group.moments.length }, requests: requestsFor(group) });

test("1. one service behaves exactly like the current RCoA booking (same reference, same request, no group metadata)", () => {
  let group = threeServices();
  group = { ...group, multiple: false, moments: [group.moments[0]], activeIndex: 0 };
  const [only, ...rest] = requestsFor(group);
  assert.equal(rest.length, 0);
  assert.deepEqual(only, buildRcoaClientRequest(composeRcoaDraft(group), menu, { bookingId: GROUP_ID, submittedAt: AT }));
  assert.equal("bookingGroup" in only, false);
  const trusted = buildTrustedRcoaHubPayload(only);
  assert.equal(trusted.bookingId, GROUP_ID);
  assert.equal("bookingGroup" in trusted, false);
});

test("2. three services create exactly three trusted bookings, in order", () => {
  const { groupId, payloads } = buildRcoaGroupHubPayloads(submission(threeServices()));
  assert.equal(groupId, GROUP_ID);
  assert.equal(payloads.length, 3);
});

test("3. shared customer, company and PO are copied to every booking; overall notes plus a group note are added", () => {
  const { payloads } = buildRcoaGroupHubPayloads(submission(threeServices()));
  for (const payload of payloads) {
    assert.equal(payload.client.email, "casey@example.test");
    assert.equal(payload.client.companyName, "The College");
    assert.equal(payload.client.invoiceReference, "PO-4411");
    assert.equal(payload.event.eventDate, "2026-12-10");
    assert.match(payload.specialInstructions, /^Please set up from 08:30\./);
    assert.match(payload.specialInstructions, /RCoA multi-service request RCOA-20261201090000-AB12: service \d of 3\.$/);
    assert.equal(payload.siteId, "rcoa");
  }
});

test("4-6. guest counts, times and items/quantities are independent per service; nothing is inherited", () => {
  const { payloads } = buildRcoaGroupHubPayloads(submission(threeServices()));
  assert.deepEqual(payloads.map((p) => p.event.guestCount), [20, 25, 35]);
  assert.deepEqual(payloads.map((p) => p.event.startTime), ["09:00", "11:00", "13:00"]);
  assert.deepEqual(payloads.map((p) => p.event.roomOrArea), ["Room A", "Room A", "Room B"]);
  assert.deepEqual(payloads.map((p) => p.order.items.map((i) => `${i.itemId}x${i.quantity}`)), [["specialty_tea_coffeex20"], ["specialty_tea_coffeex25", "mini_pastriesx2"], ["deli_sandwich_lunchx35"]]);
  assert.deepEqual(payloads.map((p) => p.order.eventType), ["breakfast", "meeting_hospitality", "lunch"]);
  assert.equal(payloads[0].order.items.some((i) => i.itemId === "mini_pastries"), false, "the 09:00 service must not inherit the 11:00 pastries");
});

test("7. child identities are deterministic from the one group id and carry structured group metadata", () => {
  const first = buildRcoaGroupHubPayloads(submission(threeServices())).payloads;
  const again = buildRcoaGroupHubPayloads(submission(threeServices())).payloads;
  assert.deepEqual(first.map((p) => p.bookingId), [1, 2, 3].map((n) => rcoaChildReference(GROUP_ID, n)));
  assert.deepEqual(first.map((p) => p.bookingId), ["RCOA-20261201090000-AB12-01", "RCOA-20261201090000-AB12-02", "RCOA-20261201090000-AB12-03"]);
  assert.deepEqual(first.map((p) => p.bookingId), again.map((p) => p.bookingId));
  assert.deepEqual(first.map((p) => p.bookingGroup), [1, 2, 3].map((sequence) => ({ id: GROUP_ID, sequence, size: 3 })));
});

test("a tampered group is refused: wrong child reference, different date or different customer", () => {
  const good = submission(threeServices());
  assert.throws(() => buildRcoaGroupHubPayloads({ ...good, requests: [good.requests[0], { ...good.requests[1], bookingId: "RCOA-20261201090000-AB12-09" }, good.requests[2]] }), /unexpected reference|does not match/);
  assert.throws(() => buildRcoaGroupHubPayloads({ ...good, requests: [good.requests[0], { ...good.requests[1], event: { ...good.requests[1].event, eventDate: "2026-12-11" } }, good.requests[2]] }), /same date/);
  assert.throws(() => buildRcoaGroupHubPayloads({ ...good, requests: [good.requests[0], { ...good.requests[1], client: { ...good.requests[1].client, email: "other@example.test" } }, good.requests[2]] }), /Customer details must be the same/);
  assert.throws(() => buildRcoaGroupHubPayloads({ bookingGroup: { id: GROUP_ID, size: 3 }, requests: good.requests.slice(0, 2) }), /does not match/);
});

test("services can be added, duplicated (time cleared) and removed; there is always at least one; No needs a single service", () => {
  let group = threeServices();
  const duplicated = duplicateRcoaMoment(group, 1, "dup");
  assert.equal(duplicated.moments.length, 4);
  const copy = duplicated.moments[2];
  assert.equal(copy.event.startTime, "");
  assert.equal(copy.event.guestCount, 25);
  assert.equal(copy.event.roomOrArea, "Room A");
  assert.deepEqual(copy.lines, group.moments[1].lines);
  assert.notEqual(copy.lines, group.moments[1].lines, "the copy must not share mutable state with the original");
  assert.equal(duplicated.activeIndex, 2);
  group = removeRcoaMoment(removeRcoaMoment(group, 2), 1);
  assert.equal(group.moments.length, 1);
  assert.equal(removeRcoaMoment(group, 0).moments.length, 1, "the last service cannot be removed");
  assert.equal(setRcoaMultiple(threeServices(), false).multiple, true, "cannot answer No while extra services exist");
  assert.equal(setRcoaMultiple(group, false).multiple, false);
});

test("10. a validation failure in ONE service prevents creation from starting (client and server)", () => {
  const group = threeServices();
  assert.equal(validateRcoaGroup(group, menu), undefined);
  const broken = applyRcoaDraft(group, { ...composeRcoaDraft(group, 1), event: { ...composeRcoaDraft(group, 1).event, startTime: "" } }, 1);
  const failure = validateRcoaGroup(broken, menu);
  assert.equal(failure?.index, 1);
  assert.equal(failure?.step, 2);
  const bad = submission(group);
  bad.requests[1] = { ...bad.requests[1], order: { ...bad.requests[1].order, items: [{ itemId: "deli_sandwich_lunch", quantity: 1, choices: [] }] } } as never;
  assert.throws(() => buildRcoaGroupHubPayloads(bad), /Service 2:/);
});

// --- the real route handler against a stub Hub that is idempotent by booking reference, like the canonical Hub ------------------
type HubState = { bookings: Map<string, { canonicalBookingId: string; payload: Record<string, unknown> }>; calls: string[]; notifications: string[]; failOn: Set<string> };
function installHub(state: HubState) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : (input as { url?: string }).url);
    if (!url.endsWith("/api/bookings/mnk")) throw new Error(`unexpected Hub call ${url}`);
    const payload = JSON.parse(String(init?.body)) as { bookingId: string; bookingGroup?: unknown };
    state.calls.push(payload.bookingId);
    if (state.failOn.has(payload.bookingId)) return new Response(JSON.stringify({ error: { message: "Hub unavailable" } }), { status: 503 });
    const existing = state.bookings.get(payload.bookingId);
    if (existing) return Response.json({ canonicalBookingId: existing.canonicalBookingId, status: "New", created: false });
    const canonicalBookingId = `booking:rcoa:${payload.bookingId.toLowerCase()}`;
    state.bookings.set(payload.bookingId, { canonicalBookingId, payload: payload as Record<string, unknown> });
    state.notifications.push(`${canonicalBookingId}:submitted:1`);
    return Response.json({ canonicalBookingId, status: "New", created: true });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
const freshHub = (): HubState => ({ bookings: new Map(), calls: [], notifications: [], failOn: new Set() });
async function postGroup(body: unknown) {
  process.env.FIKA_RCOA_OPLOC_ID = "oploc:rcoa-test";
  process.env.FIKA_HUB_BASE_URL = "http://hub.test";
  process.env.MNK_CANON_BRIDGE_TOKEN = "test-token";
  const { POST } = await import("../app/api/bookings/rcoa/group/route");
  const response = await POST(new NextRequest("http://hospitality.test/api/bookings/rcoa/group", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() as { group?: { completed: number; size: number; bookings: Array<{ sequence: number; reference: string; created: boolean; startTime: string }> }; created?: number; error?: { message: string } } };
}

test("11. each child reaches the Hub as its own ordinary booking with its own service time and items", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const result = await postGroup(submission(threeServices()));
    assert.equal(result.status, 200);
    assert.equal(result.body.created, 3);
    assert.equal(result.body.group?.completed, 3);
    assert.deepEqual(result.body.group?.bookings.map((b) => b.startTime), ["09:00", "11:00", "13:00"]);
    const stored = [...hub.bookings.values()].map((entry) => entry.payload as { bookingId: string; event: { startTime: string; guestCount: number }; order: { items: Array<{ itemId: string }> }; bookingGroup: { sequence: number } });
    assert.equal(stored.length, 3);
    assert.deepEqual(stored.map((p) => [p.event.startTime, p.event.guestCount, p.order.items.map((i) => i.itemId).join("+"), p.bookingGroup.sequence]), [["09:00", 20, "specialty_tea_coffee", 1], ["11:00", 25, "specialty_tea_coffee+mini_pastries", 2], ["13:00", 35, "deli_sandwich_lunch", 3]]);
  } finally { restore(); }
});

test("8+12. replaying the whole group creates zero duplicates and no new notification obligations", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const body = submission(threeServices());
    assert.equal((await postGroup(body)).body.created, 3);
    const replay = await postGroup(body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.created, 0);
    assert.deepEqual(replay.body.group?.bookings.map((b) => b.created), [false, false, false]);
    assert.equal(hub.bookings.size, 3);
    assert.equal(hub.notifications.length, 3, "one submitted notification per booking, none from the replay");
  } finally { restore(); }
});

test("9. a partial completion then retry creates only the missing children, and group success is not claimed until all exist", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const body = submission(threeServices());
    hub.failOn.add(rcoaChildReference(GROUP_ID, 2));
    const partial = await postGroup(body);
    assert.notEqual(partial.status, 200);
    assert.equal(partial.body.group?.completed, 1);
    assert.equal(hub.bookings.size, 1, "child 3 is not attempted after child 2 failed");
    assert.match(partial.body.error?.message || "", /Service 2/);
    hub.failOn.clear();
    const retry = await postGroup(body);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.group?.bookings.map((b) => b.created), [false, true, true]);
    assert.equal(hub.bookings.size, 3);
    assert.equal(hub.notifications.length, 3);
  } finally { restore(); }
});

test("10b. an invalid service stops the group before ANY Hub call", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const body = submission(threeServices());
    body.requests[2] = { ...body.requests[2], event: { ...body.requests[2].event, floorLevel: "", roomOrArea: "", deliveryPoint: "" } };
    const result = await postGroup(body);
    assert.equal(result.status, 400);
    assert.match(result.body.error?.message || "", /Service 3/);
    assert.equal(hub.calls.length, 0);
  } finally { restore(); }
});

test("layout contract: services controls are 44px, wrap on tablet/phone, keyboard focusable and keep tokens", () => {
  const css = readFileSync(new URL("../app/ui/RcoaBookingPortal.module.css", import.meta.url), "utf8");
  for (const selector of [".servicesBar", ".serviceTab", ".serviceActions", ".multiQuestion", ".multiOption", ".removeConfirm"]) assert.ok(css.includes(selector), selector);
  assert.match(css, /\.serviceTab,\s*\.serviceTabActive \{[^}]*min-height: 44px/);
  assert.match(css, /\.multiOption \{[^}]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 760px\) \{\s*\.serviceTab,\s*\.serviceTabActive \{\s*flex: 1 1 100%/);
  assert.match(css, /\.serviceTabActive:focus-visible/);
  const tsx = readFileSync(new URL("../app/ui/RcoaBookingPortal.tsx", import.meta.url), "utf8");
  for (const label of ["Does this booking have multiple services?", "Add another service", "Duplicate service", "Remove service"]) assert.ok(tsx.includes(label), label);
  assert.ok(tsx.includes("group.multiple &&"), "service controls are only rendered when the customer answers Yes");
});
