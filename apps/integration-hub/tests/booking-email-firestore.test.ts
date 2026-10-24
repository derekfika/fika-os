import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { db } from "../lib/firebase-admin";
import { bookingEmailStore, replayBookingEmail } from "../lib/booking-email-firestore";
import { runBookingEmailWorker } from "../lib/booking-email-outbox";
import { bookingNotificationRecord } from "../lib/booking-notifications";
import { bookingWorkspace, buildMnkCanonicalBooking, executeBookingWorkflow, ingestMnkBooking, type CanonicalBooking } from "../lib/hospitality-booking-service";
import { createProductionFromApprovedBooking } from "../lib/production-domain";
import { stableDocumentId } from "../lib/canonical-editor";
import type { Actor } from "../lib/auth";
import type { CanonicalRecord } from "../lib/types";
import { GmailSendFailure, type BookingSender } from "../lib/booking-email-delivery";
import { createRcoaEmailTestFixture, RCOA_EMAIL_TEST_NOTIFICATION_IDS, RCOA_EMAIL_TEST_RECIPIENT } from "../lib/booking-email-test-fixture";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os"
  && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292";

test("emulator: canonical transitions atomically queue distinct lifecycle obligations; retries preserve earlier payloads", { skip: !emulatorEnabled }, async () => {
  assert.equal(process.env.FIKA_RUNTIME_MODE || "local", "local");
  const key = `email-test-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const londonDate = (offsetDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
  // Hospitality deliveries are weekday-only: roll a weekend candidate forward so the fixture is valid on any day the suite runs.
  const weekdayOffset = (offsetDays: number) => { const weekday = new Date(`${londonDate(offsetDays)}T12:00:00Z`).getUTCDay(); return offsetDays + (weekday === 6 ? 2 : weekday === 0 ? 1 : 0); };
  const eventDate = londonDate(weekdayOffset(14));
  const menu = { canonicalId: `hospitality-menu-item:${key}`, dataHash: "test", entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active", name: "Test lunch", unitPrice: 12, providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: key }] } } as CanonicalRecord;
  const offeringId = `hospitality-menu-offering:${key}`;
  const oploc = `oploc:mnk-email-test:${key}`;
  const offering = { canonicalId: offeringId, dataHash: "test", entityType: "Hospitality Menu Offering", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active", hospitalityMenuItemId: menu.canonicalId, oplocId: oploc, offeringMode: "standard" } } as CanonicalRecord;
  const price = { canonicalId: `hospitality-menu-price:${key}`, dataHash: "test", entityType: "Hospitality Menu Price", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active", hospitalityMenuOfferingId: offeringId, amount: 12, vatRate: 0, effectiveFrom: "2020-01-01" } } as CanonicalRecord;
  const payload = { bookingId: key, siteId: "mnk", site: "MNK", submittedAt: now, client: { name: "Test Host", companyName: "Test", email: "host@example.test" }, event: { eventDate, startTime: "12:00", guestCount: 3 }, order: { items: [{ itemId: key, unitPrice: .01, quantity: 3, lineTotal: .01 }], netTotal: .01 } };
  const mappingRef = db.collection("integrationHubSourceMappings").doc(key);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(menu.canonicalId)).set(menu);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(offeringId)).set(offering);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(price.canonicalId)).set(price);
  await db.collection("integrationHubCanonical").doc(stableDocumentId(oploc)).set({ canonicalId: oploc, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active" } });
  const actor = { uid: "test-multi-site-manager", role: "integration-admin" } as Actor;
  await mappingRef.set({ sourceIdentifier: "mnk", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId: oploc });
  const ingested = await ingestMnkBooking(payload);
  let booking: CanonicalBooking = ingested.booking;
  assert.equal(ingested.created, true);
  assert.equal(booking.order.netTotal, 36);
  assert.equal((await ingestMnkBooking(payload)).created, false);
  assert.equal((await db.collection("fikaBookingNotifications").where("bookingId", "==", booking.canonicalId).limit(10).get()).size, 1);
  const submitted = bookingNotificationRecord(booking, "submitted", booking.version, now);
  assert.equal((await db.collection("fikaBookingNotifications").doc(submitted.notificationId).get()).exists, true);
  const bytes = JSON.stringify((await db.collection("fikaBookingNotifications").doc(submitted.notificationId).get()).data());
  const quoted = { ...booking, lifecycleStatus: "Quoted", quoteState: { currentRevisionId: `quote:${key}`, revisions: [{ id: `quote:${key}`, revision: 1, createdAt: now, createdBy: actor.uid, commercialVersion: 1, snapshot: {}, documentReference: "mock", stale: false, pdfStatus: "saved", driveFileId: "mock-drive" }] } };
  await db.collection("fikaBookings").doc(booking.canonicalId).set(quoted);
  const handoff = await createProductionFromApprovedBooking(actor, booking.canonicalId, key);
  booking = (await db.collection("fikaBookings").doc(booking.canonicalId).get()).data() as CanonicalBooking;
  const confirmation = await db.collection("fikaBookingNotifications").doc(bookingNotificationRecord(booking, "confirmed", booking.version, booking.updatedAt).notificationId).get();
  assert.equal(confirmation.exists, true); assert.equal(confirmation.data()?.bookingVersion, booking.version);
  assert.equal(confirmation.data()?.oplocId, oploc);
  assert.equal(confirmation.data()?.outboxStatus, "pending");
  const amend = await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "amend", reason: "Test update", patch: { client: booking.client, service: { ...payload.event }, order: { ...booking.order, items: booking.order.items }, deliveryChargeRequired: true } });
  booking = amend.booking;
  assert.equal((await db.collection("fikaBookingNotifications").doc(bookingNotificationRecord(booking, "amended", booking.version, booking.updatedAt).notificationId).get()).exists, true);
  const cancel = await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "cancel", reason: "Test cancellation", notify: true });
  booking = cancel.booking;
  assert.equal(booking.dashboardWorkflow?.cancellation?.downstreamPropagation, "delivered");
  assert.equal((await db.collection("fikaBookingNotifications").doc(bookingNotificationRecord(booking, "cancelled", booking.version, booking.updatedAt).notificationId).get()).exists, false);
  assert.ok((await bookingWorkspace()).bookings.some(row => row.canonicalId === booking.canonicalId && row.lifecycleStatus === "Cancelled"));
  assert.ok((await db.collection("fikaBookingAudit").where("canonicalId", "==", booking.canonicalId).get()).docs.some(row => row.data().action === "workflow-cancel"));
  const duplicateCancellation = await executeBookingWorkflow(actor, booking.canonicalId, booking.version - 1, { action: "cancel", reason: "Exact retry", notify: true });
  assert.equal(duplicateCancellation.idempotent, true);
  assert.equal(duplicateCancellation.booking.version, booking.version);
  assert.equal(JSON.stringify((await db.collection("fikaBookingNotifications").doc(submitted.notificationId).get()).data()), bytes);
  assert.equal((await db.collection("fikaBookingNotifications").where("bookingId", "==", booking.canonicalId).limit(10).get()).size, 3);
  assert.equal(await bookingEmailStore.arm(confirmation.id, "wrong-claim", now), false);
  assert.ok(handoff.order!.canonicalId);
  await Promise.all([
    mappingRef.delete(),
    db.collection("integrationHubCanonical").doc(stableDocumentId(menu.canonicalId)).delete(),
    db.collection("integrationHubCanonical").doc(stableDocumentId(offeringId)).delete(),
    db.collection("integrationHubCanonical").doc(stableDocumentId(price.canonicalId)).delete(),
    db.collection("integrationHubCanonical").doc(stableDocumentId(oploc)).delete(),
  ]);
});

test("emulator: Firestore worker CAS prevents duplicate sends, suppresses source races, and audits manual dead-letter recovery", { skip: !emulatorEnabled }, async () => {
  assert.equal(process.env.FIKA_RUNTIME_MODE || "local", "local");
  const key = `email-worker-${crypto.randomUUID()}`;
  const booking = { canonicalId: `booking:${key}`, version: 4, commercialVersion: 2, lifecycleStatus: "Sent to CPU", service: { oplocId: `oploc:${key}`, portalSiteId: "mnk", eventDate: "2026-10-19", startTime: "12:00" }, source: { sourceBookingId: key }, client: { name: "Host", email: "host@example.test" }, order: { items: [], netTotal: 12, vatTotal: 0, grossTotal: 12 }, updatedAt: "2026-10-01T00:00:00Z" } as unknown as CanonicalBooking;
  const source = db.collection("fikaBookings").doc(booking.canonicalId);
  await source.set(booking);
  const message = bookingNotificationRecord(booking, "confirmed", 4, booking.updatedAt);
  const ref = db.collection("fikaBookingNotifications").doc(message.notificationId);
  await ref.create(message);
  // Scope candidate lookup to this fixture while exercising the actual CAS transaction adapter.
  const store = { ...bookingEmailStore, async candidates() { return [ref.id]; } };
  const sender: BookingSender = { from: "mnk@example.test", replyTo: "mnk@example.test", displayName: "MNK Catering", authenticatedAccount: "sender@example.test", verifiedSendAs: true, enabled: ["confirmed"] };
  let sends = 0;
  const deps = { sender: () => sender, token: async () => "mock", send: async () => { sends++; return "receipt"; } };
  await Promise.all([runBookingEmailWorker(store, 25, deps), runBookingEmailWorker(store, 25, deps)]);
  await runBookingEmailWorker(store, 25, deps);
  assert.equal(sends, 1); assert.equal((await ref.get()).data()?.gmailMessageId, "receipt");
  assert.equal((await ref.get()).data()?.senderEvidence?.from, sender.from);
  assert.equal((await ref.get()).data()?.senderEvidence?.authenticatedAccount, sender.authenticatedAccount);
  assert.equal((await ref.get()).data()?.nextEligibleAt, undefined);
  const saved = JSON.stringify((await ref.get()).data());
  await assert.rejects(replayBookingEmail(ref.id, "Test rejected replay", "Delivered receipt verified"));
  assert.equal(JSON.stringify((await ref.get()).data()), saved);
  const amended = bookingNotificationRecord({ ...booking, version: 5 }, "amended", 5, booking.updatedAt);
  const amendedRef = db.collection("fikaBookingNotifications").doc(amended.notificationId);
  await source.set({ ...booking, version: 5 }); await amendedRef.create(amended);
  const raceStore = { ...bookingEmailStore, async candidates() { return [amendedRef.id]; } };
  await runBookingEmailWorker(raceStore, 25, { ...deps, token: async () => { await source.update({ version: 6 }); return "mock"; } });
  assert.equal(sends, 1); assert.equal((await amendedRef.get()).data()?.outboxStatus, "dead-letter");
  await source.update({ version: 5 });
  await replayBookingEmail(amendedRef.id, "Pre-send source race verified", "Attempt log has no send barrier");
  await runBookingEmailWorker(raceStore, 25, { ...deps, send: async () => { sends++; throw new GmailSendFailure(false, false, "Unknown Gmail acceptance"); } });
  assert.equal((await amendedRef.get()).data()?.outboxStatus, "dead-letter");
  await runBookingEmailWorker(raceStore, 25, deps); assert.equal(sends, 2);
  assert.equal((await amendedRef.collection("recovery").get()).size, 1);
});

test("emulator: fixed synthetic RCoA test notification uses the durable worker once without creating a booking", { skip: !emulatorEnabled }, async () => {
  assert.equal(process.env.FIKA_RUNTIME_MODE || "local", "local");
  const id = RCOA_EMAIL_TEST_NOTIFICATION_IDS.submitted;
  const ref = db.collection("fikaBookingNotifications").doc(id);
  const envKeys = ["FIKA_RUNTIME_MODE", "FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED", "FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS", "FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT", "FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS"] as const;
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const sender: BookingSender = { from: "rcoa@fikacatering.com", replyTo: "rcoa@fikacatering.com", displayName: "RCoA Hospitality", authenticatedAccount: "rcoa@fikacatering.com", verifiedSendAs: true, enabled: ["submitted"] };
  let sends = 0;
  try {
    await ref.delete();
    process.env.FIKA_RUNTIME_MODE = "production";
    process.env.FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED = "true";
    process.env.FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS = Object.values(RCOA_EMAIL_TEST_NOTIFICATION_IDS).join(",");
    process.env.FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT = RCOA_EMAIL_TEST_RECIPIENT;
    process.env.FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
    await ref.create(createRcoaEmailTestFixture("submitted"));
    assert.equal((await db.collection("fikaBookings").doc("rcoa-email-delivery-test-booking").get()).exists, false);
    const deps = { sender: () => sender, token: async () => "mock", send: async () => { sends++; return "synthetic-test-receipt"; } };
    const [first, second] = await Promise.all([runBookingEmailWorker(bookingEmailStore, 25, deps), runBookingEmailWorker(bookingEmailStore, 25, deps)]);
    await runBookingEmailWorker(bookingEmailStore, 25, deps);
    const saved = (await ref.get()).data();
    assert.equal(sends, 1);
    assert.equal(first.attempted + second.attempted, 1);
    assert.equal(saved?.outboxStatus, "delivered");
    assert.equal(saved?.gmailMessageId, "synthetic-test-receipt");
  } finally {
    const attempts = await ref.collection("attempts").get();
    const batch = db.batch();
    attempts.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(ref);
    await batch.commit();
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
