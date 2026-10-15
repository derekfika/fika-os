import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { localRcoaMenuCatalogue } from "../lib/local-rcoa-menu";
import { buildAllDayClientRequests, buildRcoaClientRequest } from "../lib/rcoa-booking-request-client";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import { buildRcoaGroupHubPayloads } from "../lib/rcoa-booking-group";
import {
  addAllDayService, applyAllDayDefaults, applyServiceItems, changeAllDayServiceCategory, composeServiceDraft, composeSharedView, createEmptyAllDay,
  duplicateAllDayService, RCOA_ALL_DAY, removeAllDayService, sortedAllDayServices, summarizeAllDay, updateAllDayService, validateAllDay, type AllDayDraft,
} from "../lib/rcoa-all-day";
import { createEmptyRcoaDraft, filterRcoaMenu, rcoaAllowedCategories, rcoaChildReference, rcoaEventTypes } from "../lib/rcoa-portal";
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

/** Event entered once; then 09:00 tea/coffee (40, Lecture Hall) · 13:00 lunch (35, Dining Room) · 17:00 drinks (60, Reception). */
function threeServiceDay(): AllDayDraft {
  let day = createEmptyAllDay();
  day = { ...day, contact: { name: "Casey Guest", email: "Casey@Example.test", phone: "020 0000 0000", companyName: "The College", invoiceReference: "PO-4411" }, eventName: "Annual Lecture", eventDate: "2026-12-10", defaultGuests: 50, defaultLocation: "Lecture Hall", floorLevel: "2", specialInstructions: "Set up from 08:30.", acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } };
  day = applyAllDayDefaults(day);
  const first = day.services[0].id;
  day = updateAllDayService(day, first, { category: "breakfast", startTime: "09:00", guestCount: 40, lines: [{ itemId: "specialty_tea_coffee", quantity: 40, choices: {} }] });
  day = addAllDayService(day, "s2");
  day = updateAllDayService(day, "s2", { category: "lunch", startTime: "13:00", guestCount: 35, location: "Dining Room", lines: [{ itemId: "deli_sandwich_lunch", quantity: 35, choices: {} }] });
  day = addAllDayService(day, "s3");
  day = updateAllDayService(day, "s3", { category: "meeting_hospitality", startTime: "17:00", guestCount: 60, location: "Reception", lines: [{ itemId: "canned_drinks", quantity: 60, choices: {} }] });
  return day;
}
const submissionFor = (day: AllDayDraft) => buildAllDayClientRequests(day, menu, { groupId: GROUP_ID, submittedAt: AT });

test("1+2. the existing offerings are unchanged and All Day Hospitality is a first-class offering on the first page", () => {
  assert.deepEqual(rcoaEventTypes.map((event) => event.id), ["breakfast", "lunch", "afternoon", "meeting_hospitality", "finger_food", "event_catering", "dining", "bespoke"]);
  assert.equal(rcoaEventTypes.some((event) => (event.id as string) === RCOA_ALL_DAY.id), false, "All Day Hospitality must not leak into the single-offering occasion list");
  assert.equal(RCOA_ALL_DAY.label, "All Day Hospitality");
  const portal = readFileSync(new URL("../app/ui/RcoaBookingPortal.tsx", import.meta.url), "utf8");
  const occasionSection = portal.slice(portal.indexOf('{view === "occasion" && ('), portal.indexOf('{(view === "contact"'));
  assert.ok(occasionSection.includes("RCOA_ALL_DAY.label"), "the first page offers All Day Hospitality alongside the others");
  // the standard flow still submits one ordinary booking through the original request builder and endpoint
  assert.ok(portal.includes("buildRcoaClientRequest(draft, menu"));
  assert.ok(portal.includes('"/api/bookings/rcoa"'));
  const standard = createEmptyRcoaDraft();
  const request = buildRcoaClientRequest({ ...standard, occasion: "breakfast", contact: { name: "A", email: "a@example.test", phone: "1", companyName: "C", invoiceReference: "" }, event: { ...standard.event, eventDate: "2026-12-10", startTime: "09:00", guestCount: 10, roomOrArea: "R" }, lines: [{ itemId: "specialty_tea_coffee", quantity: 10, choices: {} }], acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } }, menu, { bookingId: GROUP_ID, submittedAt: AT });
  assert.equal("bookingGroup" in request, false);
  assert.equal("bookingGroup" in buildTrustedRcoaHubPayload(request), false);
});

test("20. the old 'Does this booking have multiple services?' experience no longer exists", () => {
  const portal = readFileSync(new URL("../app/ui/RcoaBookingPortal.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/ui/RcoaBookingPortal.module.css", import.meta.url), "utf8");
  for (const phrase of ["multiple services", "Add another service", "Duplicate service", "Remove service", "servicesBar", "multiQuestion", "setRcoaMultiple", "group.multiple"]) {
    assert.equal(portal.includes(phrase), false, `portal still contains: ${phrase}`);
    assert.equal(css.includes(phrase), false, `css still contains: ${phrase}`);
  }
  const lib = readFileSync(new URL("../lib/rcoa-portal.ts", import.meta.url), "utf8");
  for (const dead of ["RcoaMoment", "RcoaGroupDraft", "setRcoaMultiple", "addRcoaMoment", "validateRcoaGroup"]) assert.equal(lib.includes(dead), false, dead);
});

test("3-7. event details are entered once; rows have independent times, guest counts and locations", () => {
  const day = threeServiceDay();
  const { requests } = submissionFor(day);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.client.email, "Casey@Example.test");
    assert.equal(request.client.companyName, "The College");
    assert.equal(request.client.invoiceReference, "PO-4411");
    assert.equal(request.event.eventDate, "2026-12-10");
    assert.equal(request.event.floorLevel, "2");
  }
  assert.deepEqual(requests.map((r) => r.event.startTime), ["09:00", "13:00", "17:00"]);
  assert.deepEqual(requests.map((r) => r.event.guestCount), [40, 35, 60]);
  assert.deepEqual(requests.map((r) => r.event.roomOrArea), ["Lecture Hall", "Dining Room", "Reception"]);
});

test("event-level guest count and location pre-populate NEW rows and fill blanks; a row can override and is never overwritten", () => {
  let day = createEmptyAllDay();
  day = { ...day, defaultGuests: 50, defaultLocation: "Lecture Hall" };
  day = applyAllDayDefaults(day);
  assert.deepEqual([day.services[0].guestCount, day.services[0].location], [50, "Lecture Hall"]);
  day = updateAllDayService(day, day.services[0].id, { guestCount: 35, location: "Dining Room" });
  day = applyAllDayDefaults({ ...day, defaultGuests: 99, defaultLocation: "Elsewhere" });
  assert.deepEqual([day.services[0].guestCount, day.services[0].location], [35, "Dining Room"]);
  const added = addAllDayService(day);
  assert.deepEqual([added.services[1].guestCount, added.services[1].location], [99, "Elsewhere"]);
});

test("8. Add items uses the existing category-specific catalogue: the row is an ordinary draft for its service type", () => {
  const day = threeServiceDay();
  const lunch = composeServiceDraft(day, "s2");
  assert.equal(lunch.occasion, "lunch");
  assert.equal(lunch.event.guestCount, 35);
  const allowed = rcoaAllowedCategories("lunch", menu);
  assert.deepEqual(allowed, rcoaAllowedCategories(lunch.occasion, menu));
  const shown = filterRcoaMenu(menu, lunch.occasion, "all", "");
  assert.ok(shown.length > 0 && shown.every((item) => (allowed as readonly string[]).includes(item.category)));
  assert.equal(shown.some((item) => item.id === "specialty_tea_coffee"), false, "a lunch row does not show the tea/coffee catalogue");
});

test("9+10. items chosen on a row return to that row only; nothing bleeds into other rows", () => {
  const day = threeServiceDay();
  const view = composeServiceDraft(day, "s2");
  const updated = applyServiceItems(day, "s2", { ...view, lines: [...view.lines, { itemId: "salad_protein_lunch_platter", quantity: 8, choices: {} }] });
  assert.deepEqual(updated.services.find((s) => s.id === "s2")!.lines.map((l) => l.itemId), ["deli_sandwich_lunch", "salad_protein_lunch_platter"]);
  assert.deepEqual(updated.services[0].lines, day.services[0].lines);
  assert.deepEqual(updated.services.find((s) => s.id === "s3")!.lines, day.services.find((s) => s.id === "s3")!.lines);
  const { requests } = submissionFor(updated);
  assert.deepEqual(requests.map((r) => r.order.items.map((i) => i.itemId)), [["specialty_tea_coffee"], ["deli_sandwich_lunch", "salad_protein_lunch_platter"], ["canned_drinks"]]);
});

test("changing a row's service type keeps only items valid for the new type", () => {
  const day = threeServiceDay();
  const { draft, removed } = changeAllDayServiceCategory(day, "s2", "breakfast", menu);
  assert.equal(removed, 1);
  assert.deepEqual(draft.services.find((s) => s.id === "s2")!.lines, []);
});

test("11. duplicate copies service type, guests, location and items (deep) and clears the time", () => {
  const day = threeServiceDay();
  const duplicated = duplicateAllDayService(updateAllDayService(day, "s2", { notes: "Vegetarian first" }), "s2", "dup");
  assert.equal(duplicated.services.length, 4);
  const copy = duplicated.services[2];
  assert.equal(copy.id, "dup");
  assert.deepEqual([copy.category, copy.guestCount, copy.location, copy.startTime, copy.notes], ["lunch", 35, "Dining Room", "", ""]);
  assert.deepEqual(copy.lines, day.services[1].lines);
  assert.notEqual(copy.lines, day.services[1].lines);
  copy.lines[0].quantity = 99;
  assert.equal(duplicated.services[1].lines[0].quantity, 35, "editing the copy must not change the original");
});

test("12. removing a service does not corrupt the others; there is always at least one", () => {
  const day = threeServiceDay();
  const removed = removeAllDayService(day, "s2");
  assert.deepEqual(removed.services.map((s) => s.id), [day.services[0].id, "s3"]);
  assert.deepEqual(removed.services[1], day.services[2]);
  const single = removeAllDayService(removed, "s3");
  assert.equal(single.services.length, 1);
  assert.equal(removeAllDayService(single, single.services[0].id).services.length, 1);
});

test("summary: count, time span and guest range", () => {
  assert.deepEqual(summarizeAllDay(threeServiceDay()), { count: 3, first: "09:00", last: "17:00", minGuests: 35, maxGuests: 60 });
});

test("validation covers the event, EVERY row and the shared dietaries before anything is created", () => {
  const day = threeServiceDay();
  assert.equal(validateAllDay(day, menu), undefined);
  assert.equal(validateAllDay({ ...day, eventDate: "" }, menu)?.step, 1);
  const noTime = validateAllDay(updateAllDayService(day, "s3", { startTime: "" }), menu);
  assert.deepEqual([noTime?.step, noTime?.serviceId], [2, "s3"]);
  const noItems = validateAllDay(updateAllDayService(day, "s2", { lines: [] }), menu);
  assert.deepEqual([noItems?.step, noItems?.serviceId], [2, "s2"]);
  assert.ok(noItems && Object.keys(noItems.errors).some((key) => key.startsWith("items:")));
  const tooMany = validateAllDay({ ...day, dietaries: { ...day.dietaries, vegetarian: 40 } }, menu);
  assert.equal(tooMany?.step, 3, "dietary counts must fit the smallest service (35)");
  assert.equal(validateAllDay({ ...day, acknowledgements: { ...day.acknowledgements, noticePolicyAccepted: false } }, menu)?.step, 4);
});

test("15. child identities are deterministic from the one group id and carry structured group metadata, in time order", () => {
  const a = submissionFor(threeServiceDay());
  const b = submissionFor(threeServiceDay());
  assert.deepEqual(a.requests.map((r) => r.bookingId), [1, 2, 3].map((n) => rcoaChildReference(GROUP_ID, n)));
  assert.deepEqual(a.requests.map((r) => r.bookingId), b.requests.map((r) => r.bookingId));
  assert.deepEqual(a.requests.map((r) => r.bookingGroup), [1, 2, 3].map((sequence) => ({ id: GROUP_ID, sequence, size: 3 })));
  assert.deepEqual(a.bookingGroup, { id: GROUP_ID, size: 3 });
  // rows entered out of order are still submitted and numbered chronologically
  const shuffled: AllDayDraft = { ...threeServiceDay(), services: [...threeServiceDay().services].reverse() };
  assert.deepEqual(sortedAllDayServices(shuffled).map((s) => s.startTime), ["09:00", "13:00", "17:00"]);
  assert.deepEqual(submissionFor(shuffled).requests.map((r) => r.event.startTime), ["09:00", "13:00", "17:00"]);
});

test("event name and notes are carried: general notes plus the service's own note; shared dietaries on every child", () => {
  const day = updateAllDayService({ ...threeServiceDay(), dietaries: { ...createEmptyRcoaDraft().dietaries, vegan: 5, hasDietaries: true } }, "s2", { notes: "Serve at the long table" });
  const { payloads } = buildRcoaGroupHubPayloads(submissionFor(day));
  assert.match(payloads[0].specialInstructions, /^Event: Annual Lecture\n\nSet up from 08:30\.\n\nAll Day Hospitality request RCOA-20261201090000-AB12: service 1 of 3\.$/);
  assert.match(payloads[1].specialInstructions, /Service note: Serve at the long table/);
  assert.doesNotMatch(payloads[0].specialInstructions, /long table/, "a service note belongs to its own booking only");
  assert.deepEqual(payloads.map((p) => (p.dietaries as { vegan: number }).vegan), [5, 5, 5]);
  assert.deepEqual(payloads.map((p) => p.order.eventType), ["breakfast", "lunch", "meeting_hospitality"]);
});

test("a single service is still one linked booking (group of one) through the same path", () => {
  const day = removeAllDayService(removeAllDayService(threeServiceDay(), "s2"), "s3");
  const { requests, bookingGroup } = submissionFor(day);
  assert.equal(requests.length, 1);
  assert.deepEqual(bookingGroup, { id: GROUP_ID, size: 1 });
  assert.equal(buildRcoaGroupHubPayloads({ bookingGroup, requests }).payloads[0].bookingId, rcoaChildReference(GROUP_ID, 1));
});

test("a tampered request is refused: wrong child reference, different date or different customer", () => {
  const good = submissionFor(threeServiceDay());
  assert.throws(() => buildRcoaGroupHubPayloads({ ...good, requests: [good.requests[0], { ...good.requests[1], bookingId: "RCOA-20261201090000-AB12-09" }, good.requests[2]] }), /unexpected reference|does not match/);
  assert.throws(() => buildRcoaGroupHubPayloads({ ...good, requests: [good.requests[0], { ...good.requests[1], event: { ...good.requests[1].event, eventDate: "2026-12-11" } }, good.requests[2]] }), /same date/);
  assert.throws(() => buildRcoaGroupHubPayloads({ ...good, requests: [good.requests[0], { ...good.requests[1], client: { ...good.requests[1].client, email: "other@example.test" } }, good.requests[2]] }), /Customer details must be the same/);
});

// --- the real route handler against a stub Hub that is idempotent by booking reference, like the canonical Hub ------------------
type HubState = { bookings: Map<string, { canonicalBookingId: string; payload: Record<string, unknown> }>; calls: string[]; notifications: string[]; failOn: Set<string> };
function installHub(state: HubState) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : (input as { url?: string }).url);
    if (!url.endsWith("/api/bookings/mnk")) throw new Error(`unexpected Hub call ${url}`);
    const payload = JSON.parse(String(init?.body)) as { bookingId: string };
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
  return { status: response.status, body: await response.json() as { group?: { completed: number; bookings: Array<{ created: boolean; startTime: string }> }; created?: number; error?: { message: string } } };
}

test("14+19. three service rows create exactly three canonical bookings, each with its own service time, guests and items", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const result = await postGroup(submissionFor(threeServiceDay()));
    assert.equal(result.status, 200);
    assert.equal(result.body.created, 3);
    assert.deepEqual(result.body.group?.bookings.map((b) => b.startTime), ["09:00", "13:00", "17:00"]);
    const stored = [...hub.bookings.values()].map((entry) => entry.payload as { event: { startTime: string; guestCount: number; roomOrArea: string }; order: { items: Array<{ itemId: string }> }; bookingGroup: { sequence: number } });
    assert.equal(stored.length, 3);
    assert.deepEqual(stored.map((p) => [p.event.startTime, p.event.guestCount, p.event.roomOrArea, p.order.items.map((i) => i.itemId).join("+"), p.bookingGroup.sequence]), [["09:00", 40, "Lecture Hall", "specialty_tea_coffee", 1], ["13:00", 35, "Dining Room", "deli_sandwich_lunch", 2], ["17:00", 60, "Reception", "canned_drinks", 3]]);
  } finally { restore(); }
});

test("16+18. replaying the whole request creates zero duplicates and no new notification obligations", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const body = submissionFor(threeServiceDay());
    assert.equal((await postGroup(body)).body.created, 3);
    const replay = await postGroup(body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.created, 0);
    assert.deepEqual(replay.body.group?.bookings.map((b) => b.created), [false, false, false]);
    assert.equal(hub.bookings.size, 3);
    assert.equal(hub.notifications.length, 3, "one submitted notification per booking, none from the replay");
  } finally { restore(); }
});

test("17. a partial completion then retry creates only the missing children; success is not claimed until all exist", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const body = submissionFor(threeServiceDay());
    hub.failOn.add(rcoaChildReference(GROUP_ID, 2));
    const partial = await postGroup(body);
    assert.notEqual(partial.status, 200);
    assert.equal(partial.body.group?.completed, 1);
    assert.equal(hub.bookings.size, 1);
    assert.match(partial.body.error?.message || "", /Service 2/);
    hub.failOn.clear();
    const retry = await postGroup(body);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.group?.bookings.map((b) => b.created), [false, true, true]);
    assert.equal(hub.bookings.size, 3);
    assert.equal(hub.notifications.length, 3);
  } finally { restore(); }
});

test("an invalid service row stops the whole request before ANY Hub call", async () => {
  const hub = freshHub(); const restore = installHub(hub);
  try {
    const body = submissionFor(threeServiceDay());
    body.requests[2] = { ...body.requests[2], event: { ...body.requests[2].event, floorLevel: "", roomOrArea: "", deliveryPoint: "" } };
    const result = await postGroup(body);
    assert.equal(result.status, 400);
    assert.match(result.body.error?.message || "", /Service 3/);
    assert.equal(hub.calls.length, 0);
  } finally { restore(); }
});

test("13. responsive contract: itinerary cards, one structured field row on desktop/tablet, stacked touch-friendly fields on narrow screens", () => {
  const css = readFileSync(new URL("../app/ui/RcoaBookingPortal.module.css", import.meta.url), "utf8");
  assert.match(css, /\.serviceFields \{[^}]*grid-template-columns: 116px/);
  assert.match(css, /\.dayCell input,\s*\.dayCell select \{[^}]*min-height: 44px/);
  assert.match(css, /\.textAction \{[^}]*min-height: 44px/);
  assert.match(css, /\.dayBoard \{\s*container-type: inline-size/);
  const narrow = css.slice(css.indexOf("@container (max-width: 480px)"));
  assert.match(narrow, /grid-template-columns: 1fr 1fr/);
  assert.match(css, /\.dayCell input:focus-visible/);
  assert.match(css, /\.textAction:focus-visible/);
  const portal = readFileSync(new URL("../app/ui/RcoaBookingPortal.tsx", import.meta.url), "utf8");
  for (const label of ["Build your day", "+ Add service", "Edit items", "Add items", "Duplicate", "Remove", "+ Add note", "No items selected yet", "Add each service in the order it will happen."]) assert.ok(portal.includes(label), label);
});

test("the shared event view feeds the existing contact, dietaries and notes screens", () => {
  const view = composeSharedView(threeServiceDay());
  assert.equal(view.occasion, "");
  assert.equal(view.contact.companyName, "The College");
  assert.equal(view.event.guestCount, 50);
  assert.equal(view.event.roomOrArea, "Lecture Hall");
});
