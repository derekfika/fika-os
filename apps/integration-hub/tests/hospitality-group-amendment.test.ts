import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { amendHospitalityBookingGroup, setHospitalityGroupServiceCharges, bookingWorkspace, executeBookingWorkflow, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { groupCommercialState } from "../lib/hospitality-group-commercial";
import { generateHospitalityGroupQuote } from "../lib/hospitality-group-quote-workflow";
import { firestoreGroupQuoteStore } from "../lib/hospitality-group-quote-store";
import { createProductionFromApprovedBooking } from "../lib/production-domain";
import { groupAmendmentCommand, groupChargesCommand, validLondonServiceTime, type GroupAmendmentCommand } from "../lib/hospitality-group-amendment";
import { planServiceProduction } from "../../hospitality-booking/lib/cpu-production-plan";
import type { CanonicalBooking as ClientBooking, ProductionOrder as ClientOrder } from "../../hospitality-booking/lib/canonical-types";

const enabled = process.env.FIKA_UAT_INTEGRATION_EMULATOR_TEST === "true";
const actor = { uid: "test:group-amendment", name: "Isolated emulator fixture", role: "integration-admin" as const, synthetic: true };
const bookings = () => db.collection("fikaBookings");
async function fixture() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-fika-os");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8905");
  const key = randomUUID(), id = `group:${key}`, item = `hospitality-menu-item:canonical:${key}`, other = `${item}:other`, inHouse = `${item}:in-house`;
  for (const [menuItemId, workstreams] of [[item, ["hospitality"]], [other, ["sandwiches"]], [inHouse, []]] as Array<[string, string[]]>) await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(menuItemId)).set({ menuItemId, workstreams });
  const now = new Date().toISOString();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const children = ["09:00", "13:00", "15:00"].map((time, index) => ({ canonicalId: `booking:rcoa:${key}:${index}`, entityType: "Booking", version: 1, schemaVersion: "0.1.0", createdAt: now, updatedAt: now, createdBy: actor.uid, updatedBy: actor.uid, lifecycleStatus: "New", commercialVersion: 1,
    source: { provider: "rcoa-booking-platform", sourceBookingId: `${key}:${index}`, submissionTimestamp: now, originalPayload: {} }, bookingGroup: { id, size: 3, sequence: index + 1 }, client: { name: "Fixture", companyName: "Test", email: "fixture@example.test" },
    service: { oplocId: `oploc:${key}`, portalSiteId: "rcoa", eventDate: date, startTime: time, guestCount: 10, roomOrArea: "Test room" },
    order: { eventType: "meeting_hospitality", items: [{ itemId: index === 2 ? inHouse : item, itemName: "Fixture menu item", unitPrice: 2, quantity: 10, lineTotal: 20 }], netTotal: 20, vatTotal: 0, grossTotal: 20, currency: "GBP" }, dietaries: { vegan: 1, nuts: "UNRECORDED" }, notes: "Fixture notes", acknowledgements: {}, attachments: [], statusHistory: [], audit: [], quoteState: { revisions: [] }, deliveryChargeRequired: true,
  }) as unknown as CanonicalBooking);
  for (const child of children) await bookings().doc(child.canonicalId).set(child);
  const read = async () => Promise.all(children.map(async b => (await bookings().doc(b.canonicalId).get()).data() as CanonicalBooking));
  const command = (rows: CanonicalBooking[]): GroupAmendmentCommand => ({ bookingGroupId: id, expectedSourceHash: groupCommercialState(id, rows).sourceHash, reason: "UAT amendment", services: rows.map(b => ({ bookingId: b.canonicalId, expectedVersion: b.version, patch: { client: structuredClone(b.client), service: { eventDate: b.service.eventDate, startTime: b.service.startTime, guestCount: b.service.guestCount, roomOrArea: b.service.roomOrArea }, order: { eventType: b.order.eventType, items: b.order.items.map(({ lineTotal: _, ...line }) => line) }, notes: b.notes, dietaries: structuredClone(b.dietaries), deliveryChargeRequired: true } })) });
  const quote = async (version: number) => generateHospitalityGroupQuote({ bookingGroupId: id, expectedVersion: version, expectedSourceHash: groupCommercialState(id, await read()).sourceHash }, { actorId: actor.uid, authorize: async () => {}, target: async b => ({ oplocId: b.service.oplocId!, folderId: "test-folder" }), store: firestoreGroupQuoteStore, artifact: { reserve: async () => `test-file-${randomUUID()}`, ensure: async q => ({ fileId: q.artifact.fileId!, driveUrl: "https://example.test/fixture.pdf" }) } });
  return { children, read, command, quote, id, item, other, inHouse };
}
test("group service date validation handles invalid dates, London DST gap and end-before-start", () => {
  assert.equal(validLondonServiceTime("2026-03-29", "01:30"), false);
  assert.equal(validLondonServiceTime("2026-10-25", "01:30"), true);
  assert.equal(validLondonServiceTime("2026-02-30", "12:00"), false);
  assert.equal(validLondonServiceTime("2026-07-20", "12:00"), true);
  const patch = { client: { name: "Fixture", email: "fixture@example.test", companyName: "Test" }, service: { eventDate: "2026-07-20", startTime: "12:00", endTime: "11:00", guestCount: 10 }, order: { items: [{ itemId: "item:one", quantity: 1, unitPrice: 2 }] } };
  const command = { bookingGroupId: "group:test", expectedSourceHash: "a".repeat(64), reason: "Time correction", services: [{ bookingId: "booking:test", expectedVersion: 1, patch }] };
  assert.equal(groupAmendmentCommand.safeParse(command).success, false);
  patch.service.endTime = "13:00";
  assert.equal(groupAmendmentCommand.safeParse(command).success, true);
  patch.order.items.push({ ...patch.order.items[0] });
  assert.equal(groupAmendmentCommand.safeParse(command).success, false);
});
test("an unchanged group save preserves every version and quote without new audit or handoff work", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0); const before = await f.read();
  const command = f.command(before);
  command.services.forEach(s => { s.patch.service.endTime = ""; s.patch.service.floorLevel = ""; s.patch.service.deliveryPoint = ""; s.patch.service.onsiteContactName = ""; s.patch.service.onsiteContactPhone = ""; });
  const result = await amendHospitalityBookingGroup(actor, command, async () => {});
  assert.deepEqual(await f.read(), before);
  assert.equal(result.projectionPropagation.results.length, 0);
});
test("two concurrent group amendments cannot interleave or leave half of either request committed", { skip: !enabled }, async () => {
  const f = await fixture(), before = await f.read();
  const left = f.command(before), right = f.command(before);
  left.services[0].patch.notes = "Left amendment"; left.services[1].patch.notes = "Left amendment";
  right.services[0].patch.service.startTime = "10:00"; right.services[1].patch.service.startTime = "14:00";
  const results = await Promise.allSettled([amendHospitalityBookingGroup(actor, left, async () => {}), amendHospitalityBookingGroup(actor, right, async () => {})]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const after = await f.read();
  const leftWon = after[0].notes === "Left amendment";
  assert.equal(after[1].notes === "Left amendment", leftWon);
  assert.equal(after[0].service.startTime === "10:00", !leftWon);
  assert.equal(after[1].service.startTime === "14:00", !leftWon);
  assert.deepEqual(after[2], before[2]);
});
test("atomic group amendment updates quantities/time/items/dietaries/notes and preserves unchanged identities and No CPU routing", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0);
  const before = await f.read(), command = f.command(before);
  command.services[0].patch.order.items[0].quantity = 12;
  command.services[0].patch.order.items.push({ itemId: f.other, itemName: "Added item", quantity: 2, unitPrice: 3 });
  command.services[0].patch.dietaries = { vegan: 3, nuts: "UNRECORDED", additionalNotes: "No sesame" };
  command.services[0].patch.notes = "Amended operational notes";
  command.services[1].patch.service.startTime = "14:00";
  const saved = await amendHospitalityBookingGroup(actor, command, async () => {});
  const after = await f.read();
  assert.equal(saved.bookings.length, 3); assert.deepEqual(after.map(b => b.canonicalId), before.map(b => b.canonicalId));
  assert.deepEqual(after[2], before[2]); assert.equal(after[0].order.items[0].quantity, 12);
  assert.equal(after[0].order.items.length, 2); assert.equal(after[0].dietaries.vegan, 3); assert.equal(after[0].dietaries.nuts, "UNRECORDED");
  assert.equal(after[1].service.startTime, "14:00"); assert.equal(after[0].notes, "Amended operational notes");
  assert.ok(after[0].quoteState?.revisions.every(q => q.stale));
  const workspace = await bookingWorkspace();
  assert.equal(workspace.cpuRouting![after[0].canonicalId].status, "cpu_required");
  assert.equal(workspace.cpuRouting![after[2].canonicalId].status, "no_cpu_production");
  const second = f.command(after); second.services[0].patch.order.items = [{ itemId: f.inHouse, itemName: "Site-produced", quantity: 12, unitPrice: 2 }];
  await amendHospitalityBookingGroup(actor, second, async () => {});
  assert.equal((await bookingWorkspace()).cpuRouting![after[0].canonicalId].status, "no_cpu_production");
});
test("stale versions, unresolved routing, authorization failure, missing membership and inconsistent group dates roll back every service", { skip: !enabled }, async () => {
  const f = await fixture(), before = await f.read();
  const stale = f.command(before); stale.services[1].expectedVersion = 99; stale.services[0].patch.notes = "must roll back";
  await assert.rejects(amendHospitalityBookingGroup(actor, stale, async () => {}), /changed elsewhere/);
  const unresolved = f.command(before); unresolved.services[0].patch.notes = "must roll back"; unresolved.services[1].patch.order.items[0].itemId = "hospitality-menu-item:canonical:unresolved";
  await assert.rejects(amendHospitalityBookingGroup(actor, unresolved, async () => {}), /routing/);
  await assert.rejects(amendHospitalityBookingGroup(actor, f.command(before), async () => { throw Error("not authorized"); }), /not authorized/);
  const missing = f.command(before); missing.services.pop(); await assert.rejects(amendHospitalityBookingGroup(actor, missing, async () => {}), /exactly the current/);
  const duplicate = f.command(before); duplicate.services[1].bookingId = duplicate.services[0].bookingId; await assert.rejects(amendHospitalityBookingGroup(actor, duplicate, async () => {}), /exactly the current/);
  const dates = f.command(before); dates.services[0].patch.service.eventDate = "2026-12-01"; await assert.rejects(amendHospitalityBookingGroup(actor, dates, async () => {}), /shared details conflict/);
  assert.deepEqual(await f.read(), before);
  assert.equal((await db.collection("fikaBookingAudit").where("bookingGroupId", "==", f.id).get()).size, 0);
  await bookings().doc(before[0].canonicalId).update({ lifecycleStatus: "Cancelled" });
  const cancelled = await f.read();
  await assert.rejects(amendHospitalityBookingGroup(actor, f.command(cancelled), async () => {}), /Cancelled services/);
});
test("after-CPU amendment retires only changed work, preserves immutable quote history, and replacement handoff/retries cannot duplicate orders", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0);
  const source = await f.read();
  const original = [];
  for (const child of source.slice(0, 2)) {
    const result = await createProductionFromApprovedBooking(actor, child.canonicalId, `test:${child.canonicalId}`);
    original.push(result.order!);
    await executeBookingWorkflow(actor, child.canonicalId, (await bookings().doc(child.canonicalId).get()).data()!.version, { action: "complete" });
  }
  const before = await f.read(), command = f.command(before); command.services[0].patch.order.items[0].quantity = 15;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async input => { assert.match(String(input), /^http:\/\/(localhost|127\.0\.0\.1)/); return Response.json({ applied: true }); };
  try { await amendHospitalityBookingGroup(actor, command, async () => {}); } finally { globalThis.fetch = savedFetch; }
  const after = await f.read();
  assert.equal(after[0].lifecycleStatus, "Reviewed"); assert.deepEqual(after[1], before[1]);
  assert.equal((await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(original[0].canonicalId)).get()).data()!.status, "amended");
  assert.notEqual((await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(original[1].canonicalId)).get()).data()!.status, "amended");
  await assert.rejects(amendHospitalityBookingGroup(actor, command, async () => {}), /changed elsewhere/);
  const oldGroupQuote = (await db.collection("fikaHospitalityGroupQuotes").where("bookingGroupId", "==", f.id).get()).docs[0].data();
  assert.equal(oldGroupQuote.snapshots[0].order.lines[0].quantity, 10);
  await f.quote(1);
  const refreshed = await f.read();
  const replacement = await createProductionFromApprovedBooking(actor, refreshed[0].canonicalId, "replacement-idempotent");
  await assert.rejects(createProductionFromApprovedBooking(actor, refreshed[0].canonicalId, "replacement-idempotent"), /current quote/);
  assert.notEqual(replacement.order!.canonicalId, original[0].canonicalId);
  assert.equal((await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", refreshed[0].canonicalId).get()).size, 2);
  const workspace = await bookingWorkspace();
  const unchanged = workspace.bookingGroups.find(g => g.id === f.id)!.services.find(s => s.bookingId === refreshed[1].canonicalId)!;
  assert.equal(unchanged.production!.orderId, original[1].canonicalId); assert.equal(unchanged.production!.quoteCurrent, true);
  assert.equal(planServiceProduction(refreshed[1] as unknown as ClientBooking, workspace.productionOrders[refreshed[1].canonicalId] as ClientOrder, "Lunch").state, "sent");
  // A shared date change must retire multiple active CPU handoffs in one transaction.
  const dateChange = f.command(await f.read());
  const later = new Date(`${dateChange.services[0].patch.service.eventDate}T12:00:00Z`); later.setUTCDate(later.getUTCDate() + 1);
  dateChange.services.forEach(service => service.patch.service.eventDate = later.toISOString().slice(0, 10));
  globalThis.fetch = async input => { assert.match(String(input), /^http:\/\/(localhost|127\.0\.0\.1)/); return Response.json({ applied: true }); };
  try { await amendHospitalityBookingGroup(actor, dateChange, async () => {}); } finally { globalThis.fetch = savedFetch; }
  for (const id of [replacement.order!.canonicalId, original[1].canonicalId]) assert.equal((await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(id)).get()).data()!.status, "amended");
  assert.ok((await f.read()).every(child => child.service.eventDate === later.toISOString().slice(0, 10) && child.lifecycleStatus === "Reviewed"));
});

test("group charges command accepts only stable-ID manual/labour lines and no client totals", () => {
  const base = { bookingGroupId: "group:test", bookingId: "booking:test", expectedVersion: 1, expectedSourceHash: "a".repeat(64) };
  const line = { id: "charge_12345678", kind: "manual", category: "equipment", label: "Hire", quantity: 2, unitNet: 10 };
  assert.equal(groupChargesCommand.safeParse({ ...base, charges: [line] }).success, true);
  assert.equal(groupChargesCommand.safeParse({ ...base, charges: [] }).success, true);
  assert.equal(groupChargesCommand.safeParse({ ...base, charges: [{ ...line, netTotal: 1 }] }).success, false);
  assert.equal(groupChargesCommand.safeParse({ ...base, charges: [{ ...line, id: "x" }] }).success, false);
  assert.equal(groupChargesCommand.safeParse({ ...base, charges: [line], extra: true }).success, false);
});
test("group charges change only the targeted service, reprice the group, stale its quote, replay safely and reload", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0); const before = await f.read();
  const charges = [{ id: `charge_${randomUUID()}`, kind: "manual" as const, category: "equipment" as const, label: "AV hire", quantity: 2, unitNet: 15.5 }];
  const command = { bookingGroupId: f.id, bookingId: before[1].canonicalId, expectedVersion: before[1].version, expectedSourceHash: groupCommercialState(f.id, before).sourceHash, charges };
  const saved = await setHospitalityGroupServiceCharges(actor, command, async () => {});
  assert.equal(saved.changed, true);
  const after = await f.read();
  assert.deepEqual(after[0], before[0]); assert.deepEqual(after[2], before[2]);
  assert.equal(after[1].version, before[1].version + 1); assert.equal(after[1].commercialVersion, (before[1].commercialVersion || 1) + 1);
  assert.equal(after[1].additionalCharges?.[0].netTotal, 31);
  assert.ok(after[1].quoteState?.revisions.every(q => q.stale));
  const state = groupCommercialState(f.id, after);
  assert.equal(state.totals.chargesNet, 31); assert.notEqual(state.sourceHash, command.expectedSourceHash);
  assert.equal((await db.collection("fikaBookingAudit").doc(`${after[1].canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:${after[1].version}`).get()).data()?.action, "workflow-set-additional-charges");
  // A stale retry is rejected; re-sending the saved lines against the new version/hash is a no-op.
  await assert.rejects(setHospitalityGroupServiceCharges(actor, command, async () => {}), /changed elsewhere/);
  const replay = await setHospitalityGroupServiceCharges(actor, { ...command, expectedVersion: after[1].version, expectedSourceHash: state.sourceHash }, async () => {});
  assert.equal(replay.changed, false); assert.deepEqual(await f.read(), after);
  const removed = await setHospitalityGroupServiceCharges(actor, { ...command, expectedVersion: after[1].version, expectedSourceHash: state.sourceHash, charges: [] }, async () => {});
  assert.equal(removed.changed, true); assert.equal(groupCommercialState(f.id, await f.read()).totals.chargesNet, 0);
});
