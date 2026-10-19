import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";
import { auth, db } from "../lib/firebase-admin";
import { createAuthIdentity, FirestoreAuthModRepository } from "../lib/authmod-core";
import { POST as cancelBooking } from "../app/api/hospitality-bookings/route";
import { POST as cancelGroup } from "../app/api/hospitality-booking-groups/cancel/route";
import { executeBookingWorkflow, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { groupCommercialState } from "../lib/hospitality-group-commercial";
import { bookingNotificationId, cancellationNotificationKind, type BookingNotificationRecord } from "../lib/booking-notifications";
import { bookingEmailStore } from "../lib/booking-email-firestore";
import { runBookingEmailWorker } from "../lib/booking-email-outbox";
import { stableDocumentId } from "../lib/canonical-editor";

const enabled = process.env.FIKA_UAT_INTEGRATION_EMULATOR_TEST === "true";
const oplocId = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const actor = { uid: "test:cancellation-notifications", name: "Isolated emulator test", role: "integration-admin" as const, synthetic: true };
const bookings = () => db.collection("fikaBookings");
const notifications = () => db.collection("fikaBookingNotifications");

async function fixture(count = 1, site = "rcoa") {
  assert.equal(process.env.FIKA_RUNTIME_MODE, "local");
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-fika-os");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
  const key = randomUUID(), now = new Date().toISOString(), groupId = `group:cancel-mail:${key}`;
  const children = Array.from({ length: count }, (_, index) => ({
    canonicalId: `booking:${site}:cancel-mail:${key}:${index}`, entityType: "Booking", schemaVersion: "0.1.0", version: 1, commercialVersion: 1,
    lifecycleStatus: "New", createdAt: now, updatedAt: now, createdBy: actor.uid, updatedBy: actor.uid,
    source: { provider: site === "rcoa" ? "rcoa-booking-platform" : "mnk-booking-platform", sourceBookingId: `MAIL-${key}-${index}`, submissionTimestamp: now, contractVersion: "test", originalPayload: { bookingId: `MAIL-${key}-${index}`, submittedAt: now, client: { name: "Test customer", companyName: "Test", email: "customer@example.test" }, event: { eventDate: "2026-11-19", startTime: index ? "13:00" : "09:00", guestCount: 10 }, order: { items: [], netTotal: 0 } } },
    ...(count > 1 ? { bookingGroup: { id: groupId, size: count, sequence: index + 1 } } : {}),
    client: { name: "Test customer", companyName: "Test", email: "customer@example.test" },
    service: { portalSiteId: site, oplocId, eventDate: "2026-11-19", startTime: index ? "13:00" : "09:00", guestCount: 10 },
    order: { items: [], netTotal: 0, vatTotal: 0, grossTotal: 0, currency: "GBP" },
    dietaries: {}, attachments: [], acknowledgements: {}, notes: "Preserved customer history", statusHistory: [], audit: [], quoteState: { revisions: [] },
  }) as CanonicalBooking);
  await Promise.all(children.map(child => bookings().doc(child.canonicalId).create(child)));
  return { children, groupId, async read() { return Promise.all(children.map(async child => (await bookings().doc(child.canonicalId).get()).data() as CanonicalBooking)); } };
}

const identities = new Map<string, string>();
async function asUser(role: "admin" | "viewer", run: () => Promise<void>) {
  const uid = identities.get(role) || `cancel-route:${randomUUID()}`, email = `${role}@local.fika`;
  if (!identities.has(role)) {
    await createAuthIdentity(new FirestoreAuthModRepository(), { actor: { type: "interactive", id: actor.uid, displayName: actor.name }, displayName: "Emulator route actor", email, externalProvider: "firebase", externalUid: uid, provenance: "migration" });
    identities.set(role, uid);
  }
  const verifier = mock.method(auth, "verifySessionCookie", async () => ({ uid, email, name: "Emulator route actor", aud: "demo-fika-os", auth_time: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), iss: "https://securetoken.google.com/demo-fika-os", sub: uid, firebase: { identities: { email: [email] }, sign_in_provider: "google.com" } }));
  try { await run(); } finally { verifier.mock.restore(); }
}
const request = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: "fika_os_session=isolated-test" }, body: JSON.stringify(body) });
const singleCommand = (booking: CanonicalBooking, notify?: boolean) => ({ canonicalId: booking.canonicalId, expectedVersion: booking.version, action: "cancel", reason: "Customer requested cancellation", ...(notify !== undefined ? { notify } : {}) });
const groupCommand = (f: Awaited<ReturnType<typeof fixture>>) => ({ bookingGroupId: f.groupId, expectedSourceHash: groupCommercialState(f.groupId, f.children).sourceHash, reason: "Customer cancelled all services" });
const queuedFor = (booking: CanonicalBooking) => notifications().where("bookingId", "==", booking.canonicalId).get();

test("cancellation email policy distinguishes launched customer events from internal work and other sites", () => {
  const booking = { service: { portalSiteId: "rcoa" } } as CanonicalBooking;
  assert.equal(cancellationNotificationKind(booking, "customer-cancellation"), "cancelled");
  assert.equal(cancellationNotificationKind(booking, "internal-reconciliation"), undefined);
  for (const site of ["mnk", "angel-court", "munich-re", "cfc", undefined]) assert.equal(cancellationNotificationKind({ ...booking, service: { portalSiteId: site } } as CanonicalBooking, "customer-cancellation"), undefined);
});

test("actual standalone POST queues RCoA cancellation with omitted/false notify; retries and workers deduplicate", { skip: !enabled }, async () => {
  await asUser("admin", async () => {
    for (const notify of [undefined, false]) {
      const f = await fixture(), booking = f.children[0], body = singleCommand(booking, notify);
      const [first, concurrent] = await Promise.all([cancelBooking(request("/api/hospitality-bookings", body)), cancelBooking(request("/api/hospitality-bookings", body))]);
      assert.equal(first.status, 200); assert.equal(concurrent.status, 200);
      const [saved] = await f.read();
      assert.equal(saved.lifecycleStatus, "Cancelled"); assert.equal(saved.version, 2);
      assert.equal(saved.dashboardWorkflow?.cancellation?.notificationOutcome, "queued");
      const rows = await queuedFor(saved); assert.equal(rows.size, 1);
      const message = rows.docs[0].data() as BookingNotificationRecord;
      assert.equal(message.kind, "cancelled"); assert.deepEqual(message.to, [booking.client.email]); assert.deepEqual(message.cc, []);
      assert.equal(message.oplocId, oplocId); assert.equal(message.bookingVersion, saved.version);
      const bytes = JSON.stringify(message);
      assert.equal((await cancelBooking(request("/api/hospitality-bookings", body))).status, 200);
      assert.equal(JSON.stringify((await rows.docs[0].ref.get()).data()), bytes);
      const audit = await db.collection("fikaBookingAudit").where("canonicalId", "==", booking.canonicalId).get();
      assert.equal(audit.docs.find(row => row.data().action === "workflow-cancel")?.data().cancellationEvent, "customer-cancellation");
      let sends = 0;
      const store = { ...bookingEmailStore, async candidates() { return [message.notificationId]; } };
      const deps = { sender: () => ({ from: "rcoa@fikacatering.com", replyTo: "rcoa@fikacatering.com", displayName: "RCoA Hospitality", authenticatedAccount: "rcoa@fikacatering.com", verifiedSendAs: true, enabled: ["cancelled" as const] }), token: async () => "mock-token", send: async () => { sends++; return "mock-receipt"; } };
      await Promise.all([runBookingEmailWorker(store, 25, deps), runBookingEmailWorker(store, 25, deps)]);
      await runBookingEmailWorker(store, 25, deps);
      assert.equal(sends, 1); assert.equal((await rows.docs[0].ref.get()).data()?.gmailMessageId, "mock-receipt");
    }
  });
});

test("actual grouped POST atomically queues one customer notice per service and repeated requests add none", { skip: !enabled }, async () => {
  await asUser("admin", async () => {
    const f = await fixture(2), body = groupCommand(f);
    const response = await cancelGroup(request("/api/hospitality-booking-groups/cancel", body)); assert.equal(response.status, 200);
    for (const saved of await f.read()) {
      assert.equal(saved.lifecycleStatus, "Cancelled"); assert.equal(saved.dashboardWorkflow?.cancellation?.notificationOutcome, "queued");
      const rows = await queuedFor(saved); assert.equal(rows.size, 1); assert.deepEqual(rows.docs[0].data().to, [saved.client.email]); assert.deepEqual(rows.docs[0].data().cc, []);
    }
    assert.equal((await cancelGroup(request("/api/hospitality-booking-groups/cancel", body))).status, 200);
    for (const saved of await f.read()) assert.equal((await queuedFor(saved)).size, 1);
  });
});

test("group notification failure rolls back all child cancellations and audit writes", { skip: !enabled }, async () => {
  await asUser("admin", async () => {
    const f = await fixture(2), duplicateId = bookingNotificationId(f.children[1], "cancelled", 2);
    await notifications().doc(duplicateId).create({ test: "existing immutable notification" });
    const response = await cancelGroup(request("/api/hospitality-booking-groups/cancel", groupCommand(f))); assert.ok(response.status >= 400);
    assert.deepEqual(await f.read(), f.children);
    assert.equal((await queuedFor(f.children[0])).size, 0);
    for (const child of f.children) assert.equal((await db.collection("fikaBookingAudit").where("canonicalId", "==", child.canonicalId).get()).size, 0);
  });
});

test("canonical.edit denial blocks both real POST routes before mutation or notification", { skip: !enabled }, async () => {
  await asUser("viewer", async () => {
    const f = await fixture(), g = await fixture(2);
    assert.equal((await cancelBooking(request("/api/hospitality-bookings", singleCommand(f.children[0])))).status, 403);
    assert.equal((await cancelGroup(request("/api/hospitality-booking-groups/cancel", groupCommand(g)))).status, 403);
    assert.deepEqual(await f.read(), f.children); assert.deepEqual(await g.read(), g.children);
    for (const child of [...f.children, ...g.children]) assert.equal((await queuedFor(child)).size, 0);
  });
});

test("internal cancellations and legacy cancelled retries never generate customer mail", { skip: !enabled }, async () => {
  const f = await fixture(), child = f.children[0];
  await executeBookingWorkflow(actor, child.canonicalId, 1, { action: "cancel", reason: "Internal reconciliation", notify: true });
  await asUser("admin", async () => {
    assert.equal((await cancelBooking(request("/api/hospitality-bookings", singleCommand(child)))).status, 200);
    assert.equal((await queuedFor(child)).size, 0);
    const g = await fixture(2);
    for (const b of g.children) await bookings().doc(b.canonicalId).update({ lifecycleStatus: "Cancelled" });
    assert.equal((await cancelGroup(request("/api/hospitality-booking-groups/cancel", groupCommand(g)))).status, 200);
    for (const b of g.children) assert.equal((await queuedFor(b)).size, 0);
  });
});

test("other-site cancellation cannot opt into customer mail with notify:true", { skip: !enabled }, async () => {
  await asUser("admin", async () => {
    for (const site of ["mnk", "angel-court", "munich-re", "cfc"]) {
      const f = await fixture(1, site);
      assert.equal((await cancelBooking(request("/api/hospitality-bookings", singleCommand(f.children[0], true)))).status, 200);
      assert.equal((await queuedFor(f.children[0])).size, 0);
    }
  });
});

test("customer cancellation notifies while advanced production and signed evidence remain pending CPU review", { skip: !enabled }, async () => {
  await asUser("admin", async () => {
    const f = await fixture(), child = f.children[0], orderId = `production:cancel-mail:${randomUUID()}`;
    const order = { canonicalId: orderId, sourceBookingId: child.canonicalId, status: "in_progress", workflowStatus: "in_progress", version: 3, currentAllergenRelease: { releaseId: "signed-release", matrixHash: "preserved" }, audit: [{ action: "signed", at: child.updatedAt, by: actor.uid }] };
    const ref = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)); await ref.create(order);
    const response = await cancelBooking(request("/api/hospitality-bookings", singleCommand(child))); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.projectionPropagation.status, "review_required");
    assert.equal(result.booking.dashboardWorkflow.cancellation.notificationOutcome, "queued");
    assert.deepEqual((await ref.get()).data(), order); assert.equal((await queuedFor(child)).size, 1);
    assert.equal((await db.collection("fikaHospitalityCancellationOutboxV1").where("sourceAggregateId", "==", child.canonicalId).get()).size, 0);
  });
});
