import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createServer } from "node:http";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { amendHospitalityBookingGroup, setHospitalityGroupServiceCharges, bookingWorkspace, cancelHospitalityBookingGroup, executeBookingWorkflow, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { groupCommercialState, projectBookingGroup } from "../lib/hospitality-group-commercial";
import { generateHospitalityGroupQuote } from "../lib/hospitality-group-quote-workflow";
import { firestoreGroupQuoteStore } from "../lib/hospitality-group-quote-store";
import { createProductionFromApprovedBooking } from "../lib/production-domain";
import { hospitalityCancellationEventId } from "../lib/hospitality-cancellation-outbox";
import { bookingNotificationId } from "../lib/booking-notifications";
import { groupAmendmentCommand, groupChargesCommand, validLondonServiceTime, type GroupAmendmentCommand } from "../lib/hospitality-group-amendment";
import { planServiceProduction } from "../../hospitality-booking/lib/cpu-production-plan";
import type { CanonicalBooking as ClientBooking, ProductionOrder as ClientOrder } from "../../hospitality-booking/lib/canonical-types";

const enabled = process.env.FIKA_UAT_INTEGRATION_EMULATOR_TEST === "true";
const actor = { uid: "test:group-amendment", name: "Isolated emulator fixture", role: "integration-admin" as const, synthetic: true };
const bookings = () => db.collection("fikaBookings");
async function cpuFixture(failEntityId?: string) {
  const requests: Array<{ entityId: string; idempotencyKey: string }> = [];
  let failures = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    if (body.entityId === failEntityId && failures < 2) { failures += 1; response.statusCode = 503; response.end("unavailable"); return; }
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ applied: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  process.env.CPU_PRODUCTION_BASE_URL = `http://127.0.0.1:${address.port}`;
  const logistics = createServer(async (request, response) => { for await (const _chunk of request) {} response.end(JSON.stringify({ applied: true })); });
  await new Promise<void>(resolve => logistics.listen(0, "127.0.0.1", resolve));
  const logisticsAddress = logistics.address(); assert.ok(logisticsAddress && typeof logisticsAddress !== "string");
  process.env.FIKA_LOGISTICS_BASE_URL = `http://127.0.0.1:${logisticsAddress.port}`;
  return { requests, close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await new Promise<void>((resolve, reject) => logistics.close(error => error ? reject(error) : resolve())); } };
}
async function fixture() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-fika-os");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
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
test("group cancellation preserves services and audit, is idempotent, and flags late CPU work for review", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0);
  const activeOrders = await Promise.all(f.children.slice(0, 2).map(child => createProductionFromApprovedBooking(actor, child.canonicalId, `test:${f.id}:${child.canonicalId}`)));
  const before = await f.read();
  const command = { bookingGroupId: f.id, expectedSourceHash: groupCommercialState(f.id, before).sourceHash, reason: "Fixture cancellation" };
  const cpu = await cpuFixture(activeOrders[1].order!.canonicalId);
  const cancelled = await cancelHospitalityBookingGroup(actor, command, async () => {}, "customer-cancellation");
  assert.ok(cancelled.bookings.every(booking => booking.lifecycleStatus === "Cancelled"));
  // One consolidated customer email per group cancellation event (not one per service).
  assert.ok(cancelled.bookings.every(booking => booking.dashboardWorkflow?.cancellation?.notificationOutcome === "queued"));
  // The two CPU hand-offs above legitimately queued ONE consolidated confirmation; cancellation must add exactly one more notice.
  const groupMail = await db.collection("fikaBookingNotifications").where("bookingGroupId", "==", f.id).get();
  const cancelNotices = groupMail.docs.filter(document => document.data().kind === "cancelled");
  assert.ok(groupMail.docs.filter(document => document.data().kind === "confirmed").length <= 1, "at most one group confirmation");
  assert.equal(cancelNotices.length, 1, "customer mail commits once for the whole group even while a CPU withdrawal fails");
  assert.equal((cancelNotices[0].data().groupBookingIds as string[]).length, cancelled.bookings.length);
  assert.equal(cancelNotices[0].data().delivery.status, "pending", "the durable outbox row is committed, not yet sent");
  const notices = [{ ref: cancelNotices[0].ref, bytes: JSON.stringify(cancelNotices[0].data()) }];
  assert.ok(cancelled.bookings.every(booking => booking.audit.some(event => event.action === "workflow-cancel")));
  assert.equal(cancelled.projectionPropagation.status, "pending", "one failed CPU child leaves the grouped withdrawal pending");
  assert.ok(projectBookingGroup(f.id, cancelled.bookings).services.every(service => service.cancellation?.downstreamPropagation === "pending"));
  for (const created of activeOrders) {
    const orderId = stableDocumentId(created.order!.canonicalId);
    assert.equal((await db.collection("fikaProductionOrdersV1").doc(orderId).get()).data()!.status, "cancelled");
    const requirements = await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", created.order!.canonicalId).get();
    assert.ok(requirements.size > 0);
    assert.ok(requirements.docs.every(requirement => requirement.data().status === "withdrawn"));
    assert.ok((await db.collection("fikaLogisticsProjectionOutboxV1").where("payload.sourceEntityId", "==", created.order!.canonicalId).get()).docs.some(event => event.data().payload?.changeType === "withdrawn"));
  }
  try {
    for (const booking of cancelled.bookings) await bookings().doc(booking.canonicalId).update({ "dashboardWorkflow.cancellation.downstreamPropagation": FieldValue.delete() });
    await db.collection("fikaHospitalityCancellationOutboxV1").doc(hospitalityCancellationEventId(activeOrders[1].order!.canonicalId, activeOrders[1].order!.version + 1)).delete();
    const deliveredKey = `hospitality-withdrawal:${activeOrders[0].order!.canonicalId}:v${activeOrders[0].order!.version + 1}`;
    await db.collection("fikaHospitalityCancellationOutboxV1").doc(hospitalityCancellationEventId(activeOrders[0].order!.canonicalId, activeOrders[0].order!.version + 1)).delete();
    await db.collection("fikaCpuProductionChangeReceiptsV1").doc(deliveredKey).set({ idempotencyKey: deliveredKey, event: { entityId: activeOrders[0].order!.canonicalId, changeType: "withdrawn", idempotencyKey: deliveredKey } });
    const recovered = await cancelHospitalityBookingGroup(actor, command, async () => {});
    assert.equal(recovered.projectionPropagation.status, "delivered", "retry should repair the missing legacy obligation and finish the failed child without replaying the delivered child");
    const finalRetry = await cancelHospitalityBookingGroup(actor, command, async () => {});
    assert.equal(finalRetry.projectionPropagation.status, "delivered");
    const repeated = await cancelHospitalityBookingGroup(actor, command, async () => {});
    assert.equal(repeated.projectionPropagation.status, "delivered");
    assert.equal(new Set(cpu.requests.map(item => item.idempotencyKey)).size, activeOrders.length);
    assert.ok(cpu.requests.filter(item => item.entityId === activeOrders[0].order!.canonicalId).length === 1, "already delivered child must not be sent again");
    assert.ok(cpu.requests.filter(item => item.entityId === activeOrders[1].order!.canonicalId).length === 3, "failed child retries reuse one stable idempotency key");
    for (const notice of notices) assert.equal(JSON.stringify((await notice.ref.get()).data()), notice.bytes, "withdrawal recovery preserves the original customer notice");
  } finally { await cpu.close(); }
  const replay = await cancelHospitalityBookingGroup(actor, command, async () => {});
  assert.equal(replay.idempotent, true);

  const late = await fixture(); await late.quote(0);
  const order = await createProductionFromApprovedBooking(actor, late.children[0].canonicalId, `test:${late.id}:late`);
  await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(order.order!.canonicalId)).update({ status: "in_progress" });
  const lateRows = await late.read();
  const lateResult = await cancelHospitalityBookingGroup(actor, { bookingGroupId: late.id, expectedSourceHash: groupCommercialState(late.id, lateRows).sourceHash, reason: "Late fixture cancellation" }, async () => {});
  assert.equal(lateResult.projectionPropagation.status, "review_required");
  assert.ok(lateResult.bookings.every(booking => booking.lifecycleStatus === "Cancelled"));
  assert.equal((await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(order.order!.canonicalId)).get()).data()!.status, "in_progress");
  const repeatedLate = await cancelHospitalityBookingGroup(actor, { bookingGroupId: late.id, expectedSourceHash: "unused-after-cancellation", reason: "Repeat late cancellation" }, async () => {});
  assert.equal(repeatedLate.projectionPropagation.status, "review_required");
});
test("standalone cancellation retries a durable CPU withdrawal after the Hub commit", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0);
  const booking = f.children[0]; delete booking.bookingGroup;
  await bookings().doc(booking.canonicalId).set(booking);
  const standaloneQuote = await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote", regenerate: true });
  const quoteRevisionId = standaloneQuote.booking.quoteState!.currentRevisionId!;
  const pdfSaved = await executeBookingWorkflow(actor, booking.canonicalId, standaloneQuote.booking.version, { action: "quote-pdf-status", revisionId: quoteRevisionId, status: "saved", driveFileId: "fixture-pdf", driveUrl: "https://example.test/fixture.pdf" });
  const production = await createProductionFromApprovedBooking(actor, booking.canonicalId, `standalone:${f.id}`);
  const before = (await bookings().doc(booking.canonicalId).get()).data() as CanonicalBooking;
  const command = { action: "cancel" as const, reason: "Standalone retry fixture", removeCalendar: false, cancelProduction: true, notify: false };
  const cpu = await cpuFixture(production.order!.canonicalId);
  try {
    const cancelled = await executeBookingWorkflow(actor, booking.canonicalId, before.version, command, "customer-cancellation");
    const notice = db.collection("fikaBookingNotifications").doc(bookingNotificationId(cancelled.booking, "cancelled", cancelled.booking.version));
    assert.equal((await notice.get()).exists, true);
    const noticeBytes = JSON.stringify((await notice.get()).data());
    assert.equal(cancelled.booking.lifecycleStatus, "Cancelled");
    assert.equal(cancelled.projectionPropagation.status, "pending", "CPU failure leaves the committed cancellation pending");
    await bookings().doc(booking.canonicalId).update({ "dashboardWorkflow.cancellation.downstreamPropagation": FieldValue.delete() });
    await db.collection("fikaHospitalityCancellationOutboxV1").doc(hospitalityCancellationEventId(production.order!.canonicalId, production.order!.version + 1)).delete();
    const retry = await executeBookingWorkflow(actor, booking.canonicalId, before.version, command);
    assert.equal(retry.idempotent, true);
    assert.equal(retry.projectionPropagation.status, "delivered");
    const duplicate = await executeBookingWorkflow(actor, booking.canonicalId, before.version, command);
    assert.equal(duplicate.projectionPropagation.status, "delivered");
    assert.equal(cpu.requests.length, 3, "two failed transport attempts plus one successful retry");
    assert.equal(new Set(cpu.requests.map(item => item.idempotencyKey)).size, 1);
    assert.equal(JSON.stringify((await notice.get()).data()), noticeBytes, "CPU recovery must not recreate or alter customer mail");
    assert.equal(cpu.requests[0].entityId, production.order!.canonicalId);
    const persisted = (await bookings().doc(booking.canonicalId).get()).data() as CanonicalBooking;
    assert.equal(persisted.version, before.version + 1, "retries must not cancel the booking again");
    assert.ok(persisted.audit.some(event => event.action === "workflow-cancel"));
  } finally { await cpu.close(); }
});
test("standalone amendment preserves the existing CPU retirement handoff rather than using cancellation recovery", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0);
  const booking = f.children[0]; delete booking.bookingGroup;
  await bookings().doc(booking.canonicalId).set(booking);
  const quoted = await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote", regenerate: true });
  const revisionId = quoted.booking.quoteState!.currentRevisionId!;
  await executeBookingWorkflow(actor, booking.canonicalId, quoted.booking.version, { action: "quote-pdf-status", revisionId, status: "saved", driveFileId: "amend-fixture-pdf", driveUrl: "https://example.test/amend.pdf" });
  const production = await createProductionFromApprovedBooking(actor, booking.canonicalId, `amend-notification:${f.id}`);
  const before = (await bookings().doc(booking.canonicalId).get()).data() as CanonicalBooking;
  const cpu = await cpuFixture();
  try {
    const patch = { client: before.client, service: { eventDate: before.service.eventDate, startTime: before.service.startTime, guestCount: before.service.guestCount, roomOrArea: before.service.roomOrArea }, order: { eventType: before.order.eventType, items: before.order.items.map(({ lineTotal: _lineTotal, ...item }) => item) }, notes: "Customer amendment after CPU handoff", dietaries: before.dietaries, deliveryChargeRequired: true };
    const result = await executeBookingWorkflow(actor, booking.canonicalId, before.version, { action: "amend", reason: "Customer updated the booking", patch });
    assert.equal(result.projectionPropagation.status, "delivered");
    assert.equal(cpu.requests.length, 1, "the retired CPU order must receive the existing amendment withdrawal event");
    assert.equal(cpu.requests[0].entityId, production.order!.canonicalId);
    assert.match(cpu.requests[0].idempotencyKey, /amended/);
    assert.equal((await db.collection("fikaHospitalityCancellationOutboxV1").where("sourceAggregateId", "==", booking.canonicalId).get()).size, 0);
    const notice = db.collection("fikaBookingNotifications").doc(bookingNotificationId(result.booking, "amended", result.booking.version));
    assert.equal((await notice.get()).exists, true, "existing amended customer notice remains queued");
  } finally { await cpu.close(); }
});

test("group retry preserves mixed delivered, pending and CPU-review child outcomes", { skip: !enabled }, async () => {
  const f = await fixture();
  const rows = await f.read();
  const states = ["delivered", "pending", "review_required"] as const;
  await Promise.all(rows.map((booking, index) => bookings().doc(booking.canonicalId).set({
    ...booking,
    lifecycleStatus: "Cancelled",
    dashboardWorkflow: { cancellation: { reason: "Legacy cancellation", productionOutcome: index === 0 ? "no_active_production_order" : index === 2 ? "review_required" : "cancel_requested", downstreamPropagation: states[index] } },
  })));
  await bookings().doc(rows[1].canonicalId).update({ "dashboardWorkflow.cancellation.downstreamPropagation": FieldValue.delete() });
  const result = await cancelHospitalityBookingGroup(actor, { bookingGroupId: f.id, expectedSourceHash: "legacy", reason: "Retry legacy group" }, async () => {});
  assert.equal(result.projectionPropagation.status, "review_required");
  assert.equal(result.bookings.find(booking => booking.canonicalId === rows[0].canonicalId)?.dashboardWorkflow?.cancellation?.downstreamPropagation, "delivered");
  assert.equal(result.bookings.find(booking => booking.canonicalId === rows[1].canonicalId)?.dashboardWorkflow?.cancellation?.downstreamPropagation, "pending");
  assert.equal(result.bookings.find(booking => booking.canonicalId === rows[2].canonicalId)?.dashboardWorkflow?.cancellation?.downstreamPropagation, "review_required");
});
test("legacy cancelled booking with unavailable CPU and Logistics stays pending", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0);
  const created = await createProductionFromApprovedBooking(actor, f.children[0].canonicalId, `legacy-unavailable:${f.id}`);
  const order = created.order!;
  await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(order.canonicalId)).update({ status: "cancelled", workflowStatus: "cancelled", version: order.version + 1, cancellationNotice: "Prior cancellation", updatedAt: new Date().toISOString() });
  const child = f.children[0];
  await Promise.all(f.children.map((booking, index) => bookings().doc(booking.canonicalId).update({ lifecycleStatus: "Cancelled", dashboardWorkflow: { cancellation: { reason: "Legacy cancellation", productionOutcome: index === 0 ? "cancel_requested" : "no_active_production_order" } } })));
  process.env.CPU_PRODUCTION_BASE_URL = "http://127.0.0.1:1";
  process.env.FIKA_LOGISTICS_BASE_URL = "http://127.0.0.1:1";
  const result = await cancelHospitalityBookingGroup(actor, { bookingGroupId: f.id, expectedSourceHash: "legacy", reason: "Retry unavailable legacy group" }, async () => {});
  assert.equal(result.projectionPropagation.status, "pending");
  assert.ok(result.bookings.some(booking => booking.canonicalId === child.canonicalId && booking.dashboardWorkflow?.cancellation?.downstreamPropagation === "pending"));
  const eventId = hospitalityCancellationEventId(order.canonicalId, order.version + 1);
  assert.equal((await db.collection("fikaHospitalityCancellationOutboxV1").doc(eventId).get()).exists, true, "missing durable obligation is repaired before reporting pending");
});
test("legacy reconciliation withdraws newer Draft orders despite older delivered order receipts", { skip: !enabled }, async () => {
  async function seedMixed(grouped: boolean, activeStatus: "draft" | "in_progress") {
    const f = await fixture(); await f.quote(0);
    const child = f.children[0];
    if (!grouped) { delete child.bookingGroup; await bookings().doc(child.canonicalId).set(child); await executeBookingWorkflow(actor, child.canonicalId, child.version, { action: "quote", regenerate: true });
      const refreshed = (await bookings().doc(child.canonicalId).get()).data() as CanonicalBooking;
      const revisionId = refreshed.quoteState!.currentRevisionId!;
      await executeBookingWorkflow(actor, child.canonicalId, refreshed.version, { action: "quote-pdf-status", revisionId, status: "saved", driveFileId: "legacy-fixture-pdf", driveUrl: "https://example.test/legacy.pdf" });
    }
    const created = await createProductionFromApprovedBooking(actor, child.canonicalId, `mixed-orders:${f.id}`);
    const current = created.order!;
    const currentRef = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(current.canonicalId));
    await currentRef.update({ status: activeStatus, workflowStatus: activeStatus, requiresDelivery: activeStatus === "draft" ? current.requiresDelivery : false });
    const historical = { ...current, canonicalId: `${current.canonicalId}:historical`, version: 7, status: "cancelled", workflowStatus: "cancelled", requiresDelivery: false, cancellationNotice: "Historical withdrawn order" };
    await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(historical.canonicalId)).set(historical);
    const historicalKey = `hospitality-withdrawal:${historical.canonicalId}:v${historical.version}`;
    await db.collection("fikaCpuProductionChangeReceiptsV1").doc(historicalKey).set({ idempotencyKey: historicalKey, event: { entityId: historical.canonicalId, changeType: "withdrawn", idempotencyKey: historicalKey } });
    const rows = grouped ? f.children : [child];
    await Promise.all(rows.map((booking, index) => bookings().doc(booking.canonicalId).update({ lifecycleStatus: "Cancelled", dashboardWorkflow: { cancellation: { reason: "Historical mixed-order cancellation", productionOutcome: index === 0 ? "cancel_requested" : "no_active_production_order" } }, audit: [...booking.audit, { action: "workflow-cancel", at: new Date().toISOString(), by: actor.uid, reason: "Historical fixture" }] })));
    return { f, child, current, historical, rows };
  }

  const standalone = await seedMixed(false, "draft");
  const cpu = await cpuFixture(standalone.current.canonicalId);
  try {
    const command = { action: "cancel" as const, reason: "Retry standalone historical cancellation", removeCalendar: false, cancelProduction: true, notify: false };
    const first = await executeBookingWorkflow(actor, standalone.child.canonicalId, 1, command);
    assert.equal(first.projectionPropagation.status, "pending", "active Draft withdrawal cannot complete while CPU is unavailable");
    const activeAfter = (await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(standalone.current.canonicalId)).get()).data()!;
    assert.equal(activeAfter.status, "cancelled");
    assert.equal((await db.collection("fikaHospitalityCancellationOutboxV1").doc(hospitalityCancellationEventId(standalone.current.canonicalId, Number(activeAfter.version))).get()).exists, true);
    const retried = await executeBookingWorkflow(actor, standalone.child.canonicalId, 1, command);
    assert.equal(retried.projectionPropagation.status, "delivered");
    await executeBookingWorkflow(actor, standalone.child.canonicalId, 1, command);
    assert.equal(cpu.requests.filter(event => event.entityId === standalone.historical.canonicalId).length, 0, "prior historical CPU receipt must suppress duplicate delivery");
    assert.equal(cpu.requests.filter(event => event.entityId === standalone.current.canonicalId).length, 3, "active order retries reuse the durable obligation and stable idempotency key");
  } finally { await cpu.close(); }

  const grouped = await seedMixed(true, "draft");
  const groupCpu = await cpuFixture();
  try {
    const rows = await grouped.f.read();
    const command = { bookingGroupId: grouped.f.id, expectedSourceHash: groupCommercialState(grouped.f.id, rows).sourceHash, reason: "Retry grouped historical cancellation" };
    const result = await cancelHospitalityBookingGroup(actor, command, async () => {});
    assert.equal(result.projectionPropagation.status, "delivered");
    const groupCurrent = (await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(grouped.current.canonicalId)).get()).data()!;
    assert.equal(groupCurrent.status, "cancelled");
    assert.equal((await db.collection("fikaHospitalityCancellationOutboxV1").doc(hospitalityCancellationEventId(grouped.current.canonicalId, Number(groupCurrent.version))).get()).data()!.delivery.status, "delivered");
    assert.equal(groupCpu.requests.filter(event => event.entityId === grouped.historical.canonicalId).length, 0);
    const repeated = await cancelHospitalityBookingGroup(actor, command, async () => {});
    assert.equal(repeated.projectionPropagation.status, "delivered");
    assert.equal(groupCpu.requests.filter(event => event.entityId === grouped.current.canonicalId).length, 1);
  } finally { await groupCpu.close(); }

  const advanced = await seedMixed(true, "in_progress");
  process.env.CPU_PRODUCTION_BASE_URL = "http://127.0.0.1:1";
  const advancedRows = await advanced.f.read();
  const advancedCommand = { bookingGroupId: advanced.f.id, expectedSourceHash: groupCommercialState(advanced.f.id, advancedRows).sourceHash, reason: "Advanced legacy cancellation" };
  const review = await cancelHospitalityBookingGroup(actor, advancedCommand, async () => {});
  assert.equal(review.projectionPropagation.status, "review_required");
  assert.equal((await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(advanced.current.canonicalId)).get()).data()!.status, "in_progress");
  assert.equal((await db.collection("fikaHospitalityCancellationOutboxV1").doc(hospitalityCancellationEventId(advanced.current.canonicalId, advanced.current.version)).get()).exists, false, "advanced active order must not receive an automatic withdrawal obligation");
  assert.equal((await cancelHospitalityBookingGroup(actor, advancedCommand, async () => {})).projectionPropagation.status, "review_required");
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
  const baselineTotals = groupCommercialState(f.id, before).totals;
  const quote = before[1].quoteState!.revisions.find(revision => revision.id === before[1].quoteState!.currentRevisionId)!;
  const vatRate = (quote.snapshot as { totals: { vatRate: number } }).totals.vatRate;
  const cents = (value: number) => Math.round(value * 100);
  assert.equal(cents(state.totals.net - baselineTotals.net), 3100);
  assert.equal(cents(state.totals.vat - baselineTotals.vat), cents(31 * vatRate));
  assert.equal(cents(state.totals.gross - baselineTotals.gross), 3100 + cents(31 * vatRate));
  assert.equal((await db.collection("fikaBookingAudit").doc(`${after[1].canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:${after[1].version}`).get()).data()?.action, "workflow-set-additional-charges");
  // A stale retry is rejected; re-sending the saved lines against the new version/hash is a no-op.
  await assert.rejects(setHospitalityGroupServiceCharges(actor, command, async () => {}), /changed elsewhere/);
  const replay = await setHospitalityGroupServiceCharges(actor, { ...command, expectedVersion: after[1].version, expectedSourceHash: state.sourceHash }, async () => {});
  assert.equal(replay.changed, false); assert.deepEqual(await f.read(), after);
  const removed = await setHospitalityGroupServiceCharges(actor, { ...command, expectedVersion: after[1].version, expectedSourceHash: state.sourceHash, charges: [] }, async () => {});
  assert.equal(removed.changed, true); assert.equal(groupCommercialState(f.id, await f.read()).totals.chargesNet, 0);
});

test("wave integration: a charge save invalidates stale cancellation and cancelled services reject charge changes", { skip: !enabled }, async () => {
  const f = await fixture(); await f.quote(0); const before = await f.read();
  const beforeHash = groupCommercialState(f.id, before).sourceHash;
  const charge = { id: `charge_${randomUUID()}`, kind: "manual" as const, category: "equipment" as const, label: "Group integration charge", quantity: 2, unitNet: 15.5 };
  await setHospitalityGroupServiceCharges(actor, { bookingGroupId: f.id, bookingId: before[1].canonicalId, expectedVersion: before[1].version, expectedSourceHash: beforeHash, charges: [charge] }, async () => {});
  const charged = await f.read();
  await assert.rejects(cancelHospitalityBookingGroup(actor, { bookingGroupId: f.id, expectedSourceHash: beforeHash, reason: "Stale cancellation" }, async () => {}, "customer-cancellation"), /changed elsewhere/);
  assert.deepEqual(await f.read(), charged);
  for (const child of charged) assert.equal((await db.collection("fikaBookingNotifications").doc(bookingNotificationId(child, "cancelled", child.version + 1)).get()).exists, false);
  const cancelled = await cancelHospitalityBookingGroup(actor, { bookingGroupId: f.id, expectedSourceHash: groupCommercialState(f.id, charged).sourceHash, reason: "Current customer cancellation" }, async () => {}, "customer-cancellation");
  assert.ok(cancelled.bookings.every(child => child.lifecycleStatus === "Cancelled" && child.dashboardWorkflow?.cancellation?.notificationOutcome === "queued"));
  const saved = await f.read();
  assert.deepEqual(saved[1].additionalCharges, charged[1].additionalCharges, "cancellation preserves approved commercial history");
  await assert.rejects(setHospitalityGroupServiceCharges(actor, { bookingGroupId: f.id, bookingId: saved[1].canonicalId, expectedVersion: saved[1].version, expectedSourceHash: groupCommercialState(f.id, saved).sourceHash, charges: [] }, async () => {}), /cancelled|additional charges/i);
  assert.deepEqual(await f.read(), saved);
});
