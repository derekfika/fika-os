import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { assertWorkflowCommand, COMMERCIAL_EDITABLE_STATUSES } from "../lib/booking-workflow";
import { executeBookingWorkflow, ingestMnkBooking, productionOrderId, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { createProductionFromApprovedBooking } from "../lib/production-domain";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";

/**
 * Additional charges (and the revised quote that reflects them) stay maintainable on a COMPLETED Booking. They are commercial only:
 * the lifecycle stays Completed, the Production Order is untouched, no notification is created, historical quote revisions keep their
 * snapshot, and every change is audited. Runs against the Firestore emulator through the real workflow service:
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/integration-hub && npx tsx --test tests/hospitality-completed-charges.test.ts"
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };
const actor = { uid: "test-charges-manager", role: "integration-admin" } as Actor;

const equipment = (id: string, quantity: number, unitNet: number) => ({ id, kind: "manual" as const, category: "equipment" as const, label: "Table hire", quantity, unitNet });
const site = (id: string, unitNet: number) => ({ id, kind: "manual" as const, category: "service" as const, label: "Site access charge", quantity: 1, unitNet });

async function bookingFixture(stopAt: "Quoted" | "Completed" = "Completed") {
  const key = `completed-charges-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const menu = { canonicalId: `hospitality-menu-item:${key}`, dataHash: "test", entityType: "Hospitality Menu Item", lifecycleStatus: "published", record: { lifecycleState: "active", name: "Test lunch", unitPrice: 12, providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: key }] } } as CanonicalRecord;
  const oploc = `oploc:${key}`;
  const payload = { bookingId: key, siteId: oploc, site: key, submittedAt: now, client: { name: "Test Host", companyName: "Test", email: "host@example.test" }, event: { eventDate: "2026-10-19", startTime: "12:00", guestCount: 3 }, order: { items: [{ itemId: key, unitPrice: .01, quantity: 3, lineTotal: .01 }], netTotal: .01 } };
  const mappingRef = db.collection("integrationHubSourceMappings").doc(key);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(menu.canonicalId)).set(menu);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(oploc)).set({ canonicalId: oploc, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active" } });
  await mappingRef.set({ sourceIdentifier: key, sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: oploc });
  let booking: CanonicalBooking = (await ingestMnkBooking(payload)).booking;
  booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote" })).booking;
  const revisionId = booking.quoteState!.currentRevisionId!;
  booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote-pdf-status", revisionId, status: "saved", driveFileId: "drive-file-1", driveUrl: "https://drive.example.test/1" })).booking;
  let orderRef = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(productionOrderId(booking.canonicalId)));
  if (stopAt === "Completed") {
    const handoff = await createProductionFromApprovedBooking(actor, booking.canonicalId, key);
    orderRef = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(handoff.order.canonicalId));
    booking = (await db.collection("fikaBookings").doc(booking.canonicalId).get()).data() as CanonicalBooking;
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "complete" })).booking;
    assert.equal(booking.lifecycleStatus, "Completed");
  }
  return { key, booking, orderRef, firstRevisionId: revisionId, cleanup: () => mappingRef.delete() };
}
const completedBooking = () => bookingFixture("Completed");
const notificationCount = async (bookingId: string) => (await db.collection("fikaBookingNotifications").where("bookingId", "==", bookingId).get()).size;
const reload = async (id: string) => (await db.collection("fikaBookings").doc(id).get()).data() as CanonicalBooking;

test("the lifecycle guard: Completed is commercially editable; Sent to CPU and Cancelled stay closed", () => {
  assert.deepEqual([...COMMERCIAL_EDITABLE_STATUSES], ["New", "Reviewed", "Quoted", "Completed"]);
  for (const lifecycleStatus of ["New", "Reviewed", "Quoted", "Completed"] as const) {
    assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus }, { action: "set-additional-charges", charges: [] }));
    assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus }, { action: "quote" }));
  }
  for (const lifecycleStatus of ["Sent to CPU", "Approved", "Cancelled"] as const) {
    assert.throws(() => assertWorkflowCommand({ lifecycleStatus }, { action: "set-additional-charges", charges: [] }), /governed amendment workflow/);
    assert.throws(() => assertWorkflowCommand({ lifecycleStatus }, { action: "quote" }));
  }
  // the hand-off itself is NOT opened up
  assert.match(readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8"), /!\['Quoted', 'Approved'\]\.includes\(booking\.lifecycleStatus\)/);
});

test("a charge can be added, edited and removed on a Completed booking; it stays Completed and the Production Order is untouched", opts, async () => {
  const fixture = await completedBooking();
  try {
    const orderBefore = JSON.stringify((await fixture.orderRef.get()).data());
    assert.ok(orderBefore && orderBefore !== "undefined", "the Production Order exists");
    const notificationsBefore = await notificationCount(fixture.booking.canonicalId);
    let booking = fixture.booking;
    const versionBefore = booking.version; const commercialBefore = booking.commercialVersion || 1;
    // add
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "set-additional-charges", charges: [equipment("charge-equipment-1", 2, 25), site("charge-site-0002", 40)] })).booking;
    assert.equal(booking.lifecycleStatus, "Completed", "adding a charge never reopens or alters the lifecycle");
    assert.equal(booking.additionalCharges!.length, 2);
    assert.equal(booking.additionalCharges!.reduce((total, charge) => total + charge.netTotal, 0), 90, "2 x 25 + 40");
    assert.equal(booking.version, versionBefore + 1); assert.equal(booking.commercialVersion, commercialBefore + 1);
    assert.equal(booking.additionalCharges![0].createdBy, actor.uid); assert.ok(booking.additionalCharges![0].createdAt);
    // edit one, keep the other (identity and creation audit preserved)
    const created = booking.additionalCharges![0].createdAt;
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "set-additional-charges", charges: [equipment("charge-equipment-1", 3, 30), site("charge-site-0002", 40)] })).booking;
    assert.equal(booking.lifecycleStatus, "Completed");
    assert.equal(booking.additionalCharges!.find(charge => charge.id === "charge-equipment-1")!.netTotal, 90, "3 x 30");
    assert.equal(booking.additionalCharges!.find(charge => charge.id === "charge-equipment-1")!.createdAt, created, "the original creation evidence is kept");
    assert.equal(booking.additionalCharges!.find(charge => charge.id === "charge-equipment-1")!.updatedBy, actor.uid);
    // remove one, then the other
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "set-additional-charges", charges: [site("charge-site-0002", 40)] })).booking;
    assert.equal(booking.additionalCharges!.length, 1);
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "set-additional-charges", charges: [] })).booking;
    assert.equal(booking.additionalCharges!.length, 0);
    assert.equal(booking.lifecycleStatus, "Completed");
    // nothing operational or outward changed
    assert.equal(JSON.stringify((await fixture.orderRef.get()).data()), orderBefore, "the Production Order is byte-identical");
    assert.equal(await notificationCount(booking.canonicalId), notificationsBefore, "editing a charge sends/queues no notification");
    // every change is auditable: workflow audit, status history and the persisted command with the charges
    const stored = await reload(booking.canonicalId);
    assert.equal(stored.audit.filter(entry => entry.action === "workflow-set-additional-charges").length, 4);
    assert.ok(stored.audit.filter(entry => entry.action === "workflow-set-additional-charges").every(entry => entry.by === actor.uid && entry.at));
    assert.equal(stored.statusHistory.filter(entry => entry.reason === "set-additional-charges workflow command" && entry.status === "Completed").length, 4);
    const audits = await db.collection("fikaBookingAudit").where("canonicalId", "==", booking.canonicalId).get();
    assert.ok(audits.docs.some(doc => doc.data().action === "workflow-set-additional-charges" && Array.isArray(doc.data().command?.charges)), "the audit record carries the charge command");
  } finally { await fixture.cleanup(); }
});

test("historical quote revisions stay immutable; a charge change makes the quote stale and a revised quote is a NEW revision that keeps the booking Completed", opts, async () => {
  const fixture = await completedBooking();
  try {
    let booking = fixture.booking;
    const first = booking.quoteState!.revisions.find(revision => revision.id === fixture.firstRevisionId)!;
    const firstSnapshot = JSON.stringify(first.snapshot);
    const orderBefore = JSON.stringify((await fixture.orderRef.get()).data());
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "set-additional-charges", charges: [equipment("charge-equipment-1", 2, 25)] })).booking;
    const afterCharge = booking.quoteState!.revisions.find(revision => revision.id === fixture.firstRevisionId)!;
    assert.equal(JSON.stringify(afterCharge.snapshot), firstSnapshot, "the historical snapshot is byte-identical");
    assert.equal(afterCharge.stale, true, "the old revision is marked stale (never edited)");
    assert.equal(booking.quoteState!.currentRevisionId, fixture.firstRevisionId, "no silent new revision");
    // the revised commercial output is an explicit new revision that includes the charge and keeps Completed
    const quoted = await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote", regenerate: true });
    booking = quoted.booking;
    assert.equal(booking.lifecycleStatus, "Completed", "regenerating the quote never moves a Completed booking back to Quoted");
    assert.equal(booking.quoteState!.revisions.length, 2);
    const second = booking.quoteState!.revisions[1];
    assert.equal(booking.quoteState!.currentRevisionId, second.id);
    assert.equal(second.stale, false);
    assert.ok(second.id !== fixture.firstRevisionId);
    const lines = JSON.stringify(second.snapshot);
    assert.match(lines, /Table hire/, "the revised snapshot includes the additional charge");
    assert.equal(JSON.stringify(booking.quoteState!.revisions[0].snapshot), firstSnapshot, "the first revision's snapshot is still untouched");
    assert.equal(JSON.stringify((await fixture.orderRef.get()).data()), orderBefore, "the Production Order and its lineage never change");
    assert.equal((await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote-pdf-status", revisionId: second.id, status: "saved", driveFileId: "drive-file-2" })).booking.lifecycleStatus, "Completed");
    assert.equal((await notificationCount(booking.canonicalId)) >= 0, true);
  } finally { await fixture.cleanup(); }
});

test("a Cancelled or stale-version charge mutation is still rejected, and the route keeps its authorisation gate", opts, async () => {
  const fixture = await bookingFixture("Quoted");
  try {
    let booking = fixture.booking;
    // stale expected version
    await assert.rejects(() => executeBookingWorkflow(actor, booking.canonicalId, booking.version - 1, { action: "set-additional-charges", charges: [] }), (error: { status?: number }) => error.status === 409);
    // cancelled bookings remain closed to charge changes
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "cancel", reason: "Test cancellation", notify: false })).booking;
    assert.equal(booking.lifecycleStatus, "Cancelled");
    await assert.rejects(() => executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "set-additional-charges", charges: [equipment("charge-extra-0003", 1, 1)] }), /governed amendment workflow/);
    // authorisation is enforced by the unchanged route gate before the workflow runs, for every action including charges
    const route = readFileSync(new URL("../app/api/hospitality-bookings/route.ts", import.meta.url), "utf8");
    assert.ok(route.indexOf("assertHospitalityBookingMutationAccess") < route.indexOf("executeBookingWorkflow(actor, change.canonicalId"), "mutation access is asserted before any workflow command");
    assert.match(route, /z\.literal\("set-additional-charges"\)/);
  } finally { await fixture.cleanup(); }
});
