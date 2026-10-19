import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { amendHospitalityBookingGroup, cancelHospitalityBookingGroup, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { groupCommercialState } from "../lib/hospitality-group-commercial";
import { describeServiceChanges, groupEventKey, groupNotificationId, groupNotificationRecord, groupSubmittedNotification, renderGroupBookingEmail } from "../lib/booking-group-notifications";
import { GROUP_CONFIRMATION_EFFECTIVE_FROM, confirmationEventKey, evaluateGroupConfirmation, queueGroupConfirmation, type GroupConfirmationContext } from "../lib/booking-group-confirmation";
import { priceBasis } from "../lib/booking-email-template";
import { notificationIsCurrent } from "../lib/booking-email-delivery";
import { buildBookingEmail } from "../lib/booking-notifications";

const enabled = process.env.FIKA_UAT_INTEGRATION_EMULATOR_TEST === "true";
const actor = { uid: "test:group-email", name: "Isolated emulator fixture", role: "integration-admin" as const, synthetic: true };
const bookings = () => db.collection("fikaBookings");
const notifications = () => db.collection("fikaBookingNotifications");

function makeChildren(key = randomUUID(), site = "rcoa", item = `hospitality-menu-item:canonical:${key}`, inHouse = `${item}:in-house`) {
  const id = `RCOA-20261201090000-${key.slice(0, 4).toUpperCase()}`;
  const now = "2026-10-20T09:00:00.000Z";
  const children = ["09:00", "11:00", "13:00"].map((time, index) => ({ canonicalId: `booking:rcoa:${key}:${index}`, entityType: "Booking", version: 1, schemaVersion: "0.1.0", createdAt: now, updatedAt: now, createdBy: actor.uid, updatedBy: actor.uid, lifecycleStatus: "New", commercialVersion: 1,
    source: { provider: "rcoa-booking-platform", sourceBookingId: `${id}-0${index + 1}`, submissionTimestamp: now, originalPayload: {} }, bookingGroup: { id, size: 3, sequence: index + 1 }, client: { name: "Derek", companyName: "FIKA Test", email: "derek@example.test" },
    service: { oplocId: `oploc:${key}`, portalSiteId: site, portalSiteLabel: "RCoA Hospitality", eventDate: "2026-12-01", startTime: time, guestCount: 10 + index, roomOrArea: "Lecture Hall" },
    order: { eventType: index === 1 ? "lunch" : "breakfast", items: [{ itemId: index === 2 ? inHouse : item, itemName: `Item ${index + 1}`, unitPrice: 2, quantity: 10, lineTotal: 20 }], netTotal: 20, vatTotal: 0, grossTotal: 20, currency: "GBP" }, dietaries: {}, notes: "Event: Annual meeting", acknowledgements: {}, attachments: [], statusHistory: [], audit: [], quoteState: { revisions: [] }, deliveryChargeRequired: true,
  }) as unknown as CanonicalBooking);
  return { id, key, item, inHouse, children };
}
const clone = (b: CanonicalBooking, patch: Partial<CanonicalBooking>) => ({ ...structuredClone(b), ...patch }) as CanonicalBooking;

test("submitted: ONE email, every service chronologically, one estimated total, no confirmation claim", () => {
  const { children } = makeChildren();
  const email = renderGroupBookingEmail({ kind: "submitted", children: [...children].reverse() });
  assert.match(email.subject, /Booking request received/);
  const html = email.html;
  assert.ok(html.indexOf("09:00") < html.indexOf("11:00") && html.indexOf("11:00") < html.indexOf("13:00"));
  for (const text of ["Annual meeting", "Item 1", "Item 2", "Item 3", "3 services", "Requested"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/Estimated total/g) || []).length, 1);
  assert.doesNotMatch(html, /services? (is|are) confirmed|>Confirmed</);
  assert.match(email.text, /Nothing is confirmed until you hear from us/);
});

test("confirmed: only claims confirmation for active services and shows cancelled ones as cancelled", () => {
  const { children } = makeChildren();
  const all = renderGroupBookingEmail({ kind: "confirmed", children });
  assert.match(all.html, /All 3 services/); assert.equal((all.html.match(/<span[^>]*>Confirmed<\/span>/g) || []).length, 3);
  const mixed = renderGroupBookingEmail({ kind: "confirmed", children: [children[0], clone(children[1], { lifecycleStatus: "Cancelled" }), children[2]] });
  assert.match(mixed.html, /The 2 active services/); assert.match(mixed.html, />Cancelled</); assert.equal((mixed.html.match(/<span[^>]*>Confirmed<\/span>/g) || []).length, 2);
});

test("amended: lists exactly what changed on the affected service and the updated group", () => {
  const { children } = makeChildren();
  const next = clone(children[1], { service: { ...children[1].service, guestCount: 14, startTime: "11:30" }, order: { ...children[1].order, items: [{ ...children[1].order.items[0], quantity: 12, lineTotal: 24 }, { itemId: "x:new", itemName: "Fruit", unitPrice: 1, quantity: 5, lineTotal: 5 }] } });
  const changes = describeServiceChanges(children[1], next);
  assert.deepEqual(changes, ["Time: 11:00 → 11:30", "Guests: 11 → 14", "Quantity: Item 2 10 → 12", "Added: 5 × Fruit"]);
  const email = renderGroupBookingEmail({ kind: "amended", children: [children[0], next, children[2]], affected: [next.canonicalId], previous: { [next.canonicalId]: children[1] } });
  assert.match(email.subject, /Booking updated/); assert.match(email.html, /1 of 3 services was updated/);
  assert.equal((email.html.match(/What changed/g) || []).length, 1); assert.match(email.html, />Updated</); assert.match(email.html, />Unchanged</);
});

test("full cancellation: one email, all services, no prices; partial cancellation names cancelled and remaining services", () => {
  const { children } = makeChildren();
  const cancelledAll = children.map(c => clone(c, { lifecycleStatus: "Cancelled" }));
  const full = renderGroupBookingEmail({ kind: "cancelled", children: cancelledAll, affected: cancelledAll.map(c => c.canonicalId) });
  assert.match(full.subject, /Booking cancelled/); assert.match(full.html, /including all 3 services/); assert.doesNotMatch(full.html, /Total|£/);
  const partial = renderGroupBookingEmail({ kind: "cancelled", children: [clone(children[0], { lifecycleStatus: "Cancelled" }), children[1], children[2]], affected: [children[0].canonicalId] });
  assert.match(partial.subject, /partly cancelled/); assert.match(partial.html, /1 of 3 services has been cancelled/); assert.match(partial.html, />Cancelled</); assert.equal((partial.html.match(/>Remains active</g) || []).length, 2);
});

test("group notification identity is deterministic per event, anchored to an affected service, and RCoA mail has no internal CC", () => {
  const { children, id } = makeChildren();
  const input = { kind: "amended" as const, children, affected: [children[1].canonicalId], previous: { [children[1].canonicalId]: children[1] }, anchor: children[1], eventKey: groupEventKey([id, [[children[1].canonicalId, 2]]]), createdAt: "2026-10-20T10:00:00.000Z" };
  const a = groupNotificationRecord(input), b = groupNotificationRecord(input);
  assert.equal(a.notificationId, b.notificationId); assert.equal(a.notificationId, groupNotificationId(id, "amended", input.eventKey));
  assert.notEqual(a.notificationId, groupNotificationRecord({ ...input, eventKey: groupEventKey([id, [[children[1].canonicalId, 3]]]) }).notificationId);
  assert.equal(a.bookingId, children[1].canonicalId); assert.equal(a.bookingGroupId, id); assert.equal(a.groupBookingIds?.length, 3);
  assert.deepEqual(a.to, ["derek@example.test"]); assert.deepEqual(a.cc, []); assert.equal(a.templateKey, "rcoa.group-amended.v1");
  assert.equal(a.delivery?.status, "pending"); assert.equal(a.oplocId, children[1].service.oplocId);
  assert.equal(notificationIsCurrent(a, children[1]), true);
  assert.equal(notificationIsCurrent(a, clone(children[1], { version: 2 })), false);
});

test("submitted is created only with the last service of a group; singles and incomplete groups are untouched", () => {
  const { children } = makeChildren();
  assert.equal(groupSubmittedNotification(children[0], []), undefined);
  assert.equal(groupSubmittedNotification(children[1], [children[0]]), undefined);
  const last = groupSubmittedNotification(children[2], [children[0], children[1]]);
  assert.ok(last); assert.equal(last!.kind, "submitted"); assert.equal(last!.bookingId, children[0].canonicalId); assert.equal(last!.groupBookingIds?.length, 3);
  assert.equal(groupSubmittedNotification(children[2], [children[1], children[0], children[2]])?.notificationId, last!.notificationId, "replay is idempotent");
  const single = { ...children[0], bookingGroup: undefined } as CanonicalBooking;
  assert.equal(groupSubmittedNotification(single, []), undefined);
  assert.equal(buildBookingEmail("submitted", single).kind, "submitted", "single-service emails keep their existing builder");
});

async function seed(f: ReturnType<typeof makeChildren>) {
  for (const [menuItemId, workstreams] of [[f.item, ["hospitality"]], [f.inHouse, []]] as Array<[string, string[]]>) await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(menuItemId)).set({ menuItemId, workstreams });
  for (const child of f.children) await bookings().doc(child.canonicalId).set(child);
  const read = async () => Promise.all(f.children.map(async b => (await bookings().doc(b.canonicalId).get()).data() as CanonicalBooking));
  const mails = async () => (await notifications().where("bookingGroupId", "==", f.id).get()).docs.map(d => d.data());
  return { read, mails };
}

test("amendment creates exactly one group email; an unchanged save and a rejected stale save create none", { skip: !enabled }, async () => {
  const f = makeChildren(); const { read, mails } = await seed(f); const before = await read();
  const command = (rows: CanonicalBooking[], guests?: number) => ({ bookingGroupId: f.id, expectedSourceHash: groupCommercialState(f.id, rows).sourceHash, reason: "Guests changed", services: rows.map(b => ({ bookingId: b.canonicalId, expectedVersion: b.version, patch: { client: structuredClone(b.client), service: { eventDate: b.service.eventDate, startTime: b.service.startTime, guestCount: b === rows[1] && guests ? guests : b.service.guestCount, roomOrArea: b.service.roomOrArea }, order: { eventType: b.order.eventType, items: b.order.items.map(({ lineTotal: _, ...line }) => line) }, notes: b.notes, dietaries: structuredClone(b.dietaries), deliveryChargeRequired: true } })) });
  await amendHospitalityBookingGroup(actor, command(before), async () => {});
  assert.equal((await mails()).length, 0, "an unchanged save sends nothing");
  await amendHospitalityBookingGroup(actor, command(before, 20), async () => {});
  const rows = await mails();
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, "amended"); assert.equal(rows[0].bookingId, before[1].canonicalId);
  assert.match(String(rows[0].html), /Guests: 11 → 20/); assert.equal((rows[0].groupBookingIds as string[]).length, 3);
  await assert.rejects(amendHospitalityBookingGroup(actor, command(before, 25), async () => {}), /changed elsewhere/);
  assert.equal((await mails()).length, 1, "a rejected save queues nothing");
});

test("full group cancellation queues ONE customer email; retry, internal reconciliation and non-RCoA queue none", { skip: !enabled }, async () => {
  const f = makeChildren(); const { read, mails } = await seed(f); const before = await read();
  const input = { bookingGroupId: f.id, expectedSourceHash: groupCommercialState(f.id, before).sourceHash, reason: "Customer request" };
  await cancelHospitalityBookingGroup(actor, input, async () => {}, "customer-cancellation");
  let rows = await mails();
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, "cancelled"); assert.equal((rows[0].groupBookingIds as string[]).length, 3); assert.match(String(rows[0].html), /including all 3 services/);
  assert.ok((await read()).every(c => c.lifecycleStatus === "Cancelled" && c.dashboardWorkflow?.cancellation?.notificationOutcome === "queued"));
  await cancelHospitalityBookingGroup(actor, input, async () => {}, "customer-cancellation");
  assert.equal((await mails()).length, 1, "retry creates no second email");
  const internal = makeChildren(); const i = await seed(internal);
  await cancelHospitalityBookingGroup(actor, { bookingGroupId: internal.id, expectedSourceHash: groupCommercialState(internal.id, await i.read()).sourceHash, reason: "Reconcile" }, async () => {}, "internal-reconciliation");
  assert.equal((await i.mails()).length, 0);
  const other = makeChildren(randomUUID(), "mnk"); const o = await seed(other);
  await cancelHospitalityBookingGroup(actor, { bookingGroupId: other.id, expectedSourceHash: groupCommercialState(other.id, await o.read()).sourceHash, reason: "Other site" }, async () => {}, "customer-cancellation");
  assert.equal((await o.mails()).length, 0);
});

test("partial cancellation (one service cancelled earlier) names it and the remaining services", { skip: !enabled }, async () => {
  const f = makeChildren(); f.children[0] = clone(f.children[0], { lifecycleStatus: "Cancelled" }); const { read, mails } = await seed(f);
  await cancelHospitalityBookingGroup(actor, { bookingGroupId: f.id, expectedSourceHash: groupCommercialState(f.id, await read()).sourceHash, reason: "Rest of booking" }, async () => {}, "customer-cancellation");
  const rows = await mails();
  assert.equal(rows.length, 1); assert.match(String(rows[0].html), /2 of 3 services have been cancelled|including all 3 services/);
});

test("confirmation waits until every CPU service is handed off, is queued once, and never resends historical groups", { skip: !enabled }, async () => {
  const f = makeChildren();
  const sent = (child: CanonicalBooking, at: string) => clone(child, { lifecycleStatus: "Sent to CPU", version: 2, statusHistory: [{ status: "Sent to CPU", changedAt: at, changedBy: actor.uid, reason: "Production hand-off recorded." }], audit: [{ action: "booking-sent-to-cpu", at, by: actor.uid, reason: "Production hand-off recorded." }] });
  const at = "2026-10-20T10:00:00.000Z";
  f.children[0] = sent(f.children[0], at); f.children[1] = clone(f.children[1], { lifecycleStatus: "Quoted" }); f.children[2] = clone(f.children[2], { lifecycleStatus: "Quoted" });
  const { read, mails } = await seed(f);
  assert.equal(await queueGroupConfirmation(f.id), "waiting", "one CPU service is not yet handed off");
  assert.equal((await mails()).length, 0);
  await bookings().doc(f.children[1].canonicalId).set(sent(f.children[1], "2026-10-20T10:05:00.000Z"));
  assert.equal(await queueGroupConfirmation(f.id), "queued");
  assert.equal(await queueGroupConfirmation(f.id), "exists");
  const rows = await mails();
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, "confirmed"); assert.equal(rows[0].bookingId, f.children[1].canonicalId);
  assert.match(String(rows[0].html), /All 3 services/, "the in-house service is confirmed with the group");
  assert.equal(notificationIsCurrent(rows[0] as never, (await read())[1]), true);
  const old = makeChildren(); old.children[0] = sent(old.children[0], "2026-10-19T08:00:00.000Z"); old.children[1] = sent(old.children[1], "2026-10-19T08:05:00.000Z"); old.children[2] = clone(old.children[2], { lifecycleStatus: "Quoted" });
  const o = await seed(old);
  assert.ok("2026-10-19T08:05:00.000Z" < GROUP_CONFIRMATION_EFFECTIVE_FROM);
  assert.equal(await queueGroupConfirmation(old.id), "historical"); assert.equal((await o.mails()).length, 0);
});

const handedOff = (child: CanonicalBooking, at: string) => clone(child, { lifecycleStatus: "Sent to CPU", version: 2, statusHistory: [{ status: "Sent to CPU", changedAt: at, changedBy: "t", reason: "r" }] });
const context = (children: CanonicalBooking[], inHouse: string[] = [], existing: string[] = []): GroupConfirmationContext => ({ bookingGroupId: children[0].bookingGroup!.id, children, inHouse: new Set(inHouse), existing: new Set(existing) });
const AT = "2026-10-20T10:00:00.000Z";

test("confirmation decision: waits for every CPU service, counts explicit in-house services, ignores cancelled ones", () => {
  const { children } = makeChildren();
  const ctx = context(children, [children[2].canonicalId]);
  assert.equal(evaluateGroupConfirmation(ctx).outcome, "waiting");
  assert.equal(evaluateGroupConfirmation(ctx, handedOff(children[0], AT)).outcome, "waiting", "one of two CPU services handed off");
  const both = context([handedOff(children[0], AT), children[1], children[2]], [children[2].canonicalId]);
  const done = evaluateGroupConfirmation(both, handedOff(children[1], "2026-10-20T10:05:00.000Z"));
  assert.equal(done.outcome, "queued"); assert.equal(done.notification!.bookingId, children[1].canonicalId); assert.equal(done.notification!.createdAt, "2026-10-20T10:05:00.000Z");
  assert.equal(evaluateGroupConfirmation(context(children, [children[1].canonicalId, children[2].canonicalId]), handedOff(children[0], AT)).outcome, "queued", "mixed in-house and CPU");
  const cancelled = context([children[0], clone(children[1], { lifecycleStatus: "Cancelled" }), children[2]], [children[2].canonicalId]);
  assert.equal(evaluateGroupConfirmation(cancelled, handedOff(children[0], AT)).outcome, "queued", "a cancelled service never blocks or appears confirmed");
  assert.equal(evaluateGroupConfirmation(context(children, children.map(c => c.canonicalId))).outcome, "not_applicable", "all in house: no CPU hand-off, so no confirmation");
});

test("confirmation decision: historical hand-offs are excluded and existing confirmations are never recreated", () => {
  const { children } = makeChildren();
  const old = "2026-10-19T08:00:00.000Z"; assert.ok(old < GROUP_CONFIRMATION_EFFECTIVE_FROM);
  const ctx = context([handedOff(children[0], old), children[1], children[2]], [children[2].canonicalId]);
  assert.equal(evaluateGroupConfirmation(ctx, handedOff(children[1], old)).outcome, "historical");
  const fresh = context([handedOff(children[0], AT), children[1], children[2]], [children[2].canonicalId]);
  const key = confirmationEventKey(children[0].bookingGroup!.id, children);
  const queued = evaluateGroupConfirmation(fresh, handedOff(children[1], AT));
  assert.equal(evaluateGroupConfirmation({ ...fresh, existing: new Set([queued.notification!.notificationId]) }, handedOff(children[1], AT)).outcome, "exists");
  assert.ok(queued.notification!.notificationId.endsWith(key));
});

test("confirmation identity follows commercial state: stable across hand-offs, new only after a commercial amendment", () => {
  const { children, id } = makeChildren();
  const base = confirmationEventKey(id, children);
  assert.equal(confirmationEventKey(id, children.map(c => handedOff(c, AT))), base, "hand-off state does not change the key");
  assert.equal(confirmationEventKey(id, children.map(c => clone(c, { notes: "changed" }))), base, "a non-commercial amendment does not create a second confirmation");
  assert.notEqual(confirmationEventKey(id, [children[0], clone(children[1], { commercialVersion: 2 }), children[2]]), base, "a commercial amendment is a new confirmation event");
});

test("price labels: serving text describes the UNIT price; the amount column is the line total", () => {
  assert.equal(priceBasis("Per person", 9), "£9.00 per person");
  assert.equal(priceBasis("Feeds 10", 75), "£75.00 · Feeds 10");
  assert.equal(priceBasis("", 9), ""); assert.equal(priceBasis("Per person", undefined), "Per person");
  const { children, id } = makeChildren();
  const lunch = clone(children[0], { order: { ...children[0].order, items: [{ itemId: "i:lunch", itemName: "Deli Style Sandwich Lunch", unitPrice: 9, quantity: 20, lineTotal: 180, servingInfo: "Per person" }, { itemId: "i:box", itemName: "Cheese Box", unitPrice: 75, quantity: 2, lineTotal: 150, servingInfo: "Feeds 10" }], netTotal: 330, vatTotal: 0, grossTotal: 330 } });
  const group = renderGroupBookingEmail({ kind: "confirmed", children: [lunch, children[1], children[2]] });
  assert.match(group.html, /Line total/); assert.match(group.html, /£9\.00 per person/); assert.match(group.html, /£180\.00/); assert.match(group.html, /£75\.00 · Feeds 10/);
  assert.doesNotMatch(group.html, />Per person</, "the bare serving text is never shown next to the line total");
  assert.match(group.text, /20 x Deli Style Sandwich Lunch \(£180\.00\)/);
  assert.equal((group.html.match(/Total</g) || []).length >= 1, true); assert.equal((group.html.match(/>Total</g) || []).length, 1, "one group total");
  const single = buildBookingEmail("confirmed", lunch);
  assert.match(single.html, /Line total/); assert.match(single.html, /£9\.00 per person/); assert.doesNotMatch(single.html, />Per person</);
  assert.match(single.html, /£330\.00/, "single-service subtotal and total unchanged");
  void id;
});

test("additional charges appear as labelled lines and reconcile into the group totals", () => {
  const { children } = makeChildren();
  const charged = clone(children[0], { additionalCharges: [{ id: "charge_12345678", kind: "manual", category: "equipment", label: "AV hire", quantity: 2, unitNet: 15, netTotal: 30, createdAt: "t", createdBy: "t" }] as never });
  const email = renderGroupBookingEmail({ kind: "confirmed", children: [charged, children[1], children[2]] });
  assert.match(email.html, /AV hire/); assert.match(email.html, /£30\.00/); assert.match(email.html, /Additional charges/);
  assert.match(email.html, /Total<\/td><td[^>]*>£90\.00/);
});
