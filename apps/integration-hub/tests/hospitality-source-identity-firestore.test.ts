import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../fixtures/mnk-legacy-menu-import.candidates.json";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { portalBookingIdentity, calendarBookingIdentity } from "../lib/hospitality-booking-identity";
import { buildHospitalityPortalBooking, executeBookingWorkflow, ingestCalendarBooking, ingestHospitalityPortalBooking, type CanonicalBooking, type MnkBookingPayload } from "../lib/hospitality-booking-service";
import { bookingNotificationRecord } from "../lib/booking-notifications";
import { createProductionFromApprovedBooking, productionOrderV1Id } from "../lib/production-domain";
import type { CanonicalRecord } from "../lib/types";

// Opt-in: never write to staging or the usual local/CPU reuse UAT emulator.
test("portal provenance transition against an isolated disposable Firestore emulator", { skip: process.env.FIKA_HOSPITALITY_IDENTITY_TEST_EMULATOR !== "true" }, async t => {
  assert.equal(process.env.FIKA_RUNTIME_MODE, "local");
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-fika-os");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18985");
  assert.equal((await db.collection("fikaBookings").limit(1).get()).empty, true, "Use a fresh disposable emulator database for this regression.");
  const targets = { mnk: fixture.configuration.oplocId, "angel-court": "oploc:identity-test-angel", cfc: "oploc:identity-test-cfc", "munich-re": "oploc:identity-test-munich", rcoa: "oploc:identity-test-rcoa" };
  const menuProviders = { "angel-court": "angel-court-hospitality-brochure", cfc: "cfc-hospitality-brochure", "munich-re": "munich-re-generic-brochure", rcoa: "rcoa-hospitality-brochure" };
  const records = [...fixture.items, ...fixture.offerings, ...fixture.prices].map(record => ({ canonicalId: record.canonicalId, entityType: record.entityType, record, dataHash: "fixture", lifecycleStatus: "published", publicationStatus: "published" })) as CanonicalRecord[];
  for (const [site, provider] of Object.entries(menuProviders)) records.push({ canonicalId: `hospitality-menu-item:identity-test:${site}`, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { name: "Test Item", lifecycleState: "active", unitPrice: 12, providerMappings: [{ provider, sourceItemId: "identity-test-item" }] } });
  const seed = db.batch();
  for (const record of records) seed.set(db.collection("integrationHubCanonical").doc(stableDocumentId(record.canonicalId)), record);
  for (const [site, oplocId] of Object.entries(targets)) {
    seed.set(db.collection("integrationHubCanonical").doc(stableDocumentId(oplocId)), { canonicalId: oplocId, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", record: { lifecycleState: "active" } });
    seed.set(db.collection("integrationHubSourceMappings").doc(`identity-test-${site}`), { sourceProvider: site === "rcoa" ? "rcoa-booking-platform" : "hospitality-booking-platform", sourceEntityType: "provider-location", sourceIdentifier: site, mappingStatus: "confirmed", oplocId });
  }
  await seed.commit();
  const coffee = fixture.items.find(item => item.name === "Bloom Filter Coffee")!;
  const payloadFor = (site: keyof typeof targets, ref = `identity-test-${site}`): MnkBookingPayload => ({
    bookingId: ref, siteId: site, site: site === "angel-court" ? "One Angel Court" : site,
    submittedAt: "2026-10-14T12:00:00Z", client: { name: "Isolated Test", companyName: "Test", email: "host@example.test" },
    event: { eventDate: "2026-11-03", startTime: "12:00", guestCount: 10 },
    order: { items: [{ itemId: site === "mnk" ? coffee.canonicalId : "identity-test-item", quantity: 10, unitPrice: .01, lineTotal: .01 }], netTotal: .01 },
  });
  let angel: CanonicalBooking | undefined;
  for (const site of Object.keys(targets) as Array<keyof typeof targets>) {
    await t.test(`${site}: concurrent submission/replay persists one Booking, audit and submitted obligation`, async () => {
      const payload = payloadFor(site);
      const results = await Promise.all([1, 2].map(() => ingestHospitalityPortalBooking(payload, site === "rcoa" ? targets.rcoa : undefined)));
      assert.equal(results.filter(result => result.created).length, 1);
      const booking = results[0].booking;
      assert.equal(booking.canonicalId, portalBookingIdentity(payload.bookingId, site).canonicalId);
      assert.equal(booking.source.provider, site === "rcoa" ? "rcoa-booking-platform" : "hospitality-booking-platform");
      assert.equal(booking.service.oplocId, targets[site]);
      assert.equal(booking.service.portalSiteId, site);
      assert.equal(booking.service.portalSiteLabel, payload.site);
      assert.ok(booking.order.items[0].menuItemId);
      assert.equal((await db.collection("fikaBookings").where("source.sourceBookingId", "==", payload.bookingId).get()).size, 1);
      assert.equal((await db.collection("fikaBookingAudit").where("canonicalId", "==", booking.canonicalId).get()).size, 1);
      assert.equal((await db.collection("fikaBookingNotifications").where("bookingId", "==", booking.canonicalId).get()).size, 1);
      if (site === "angel-court") angel = booking;
    });
  }

  await t.test("historical MNK-era retry needs no new mapping and preserves the entire stored Booking/outbox", async () => {
    const payload = payloadFor("angel-court", "ANGEL-ONE");
    const legacy = buildHospitalityPortalBooking(payload, records).booking;
    legacy.source.provider = "mnk-booking-platform";
    delete legacy.source.identity;
    legacy.service.oplocId = targets["angel-court"];
    const notification = bookingNotificationRecord(legacy, "submitted", 1, legacy.createdAt);
    await db.collection("fikaBookings").doc(legacy.canonicalId).set(legacy);
    await db.collection("fikaBookingNotifications").doc(notification.notificationId).set(notification);
    await db.collection("integrationHubSourceMappings").doc("identity-test-angel-court").delete();
    try {
      const before = (await db.collection("fikaBookings").doc(legacy.canonicalId).get()).data();
      const retries = await Promise.all([1, 2].map(() => ingestHospitalityPortalBooking(payload)));
      assert.ok(retries.every(result => !result.created));
      assert.equal(retries[0].booking.canonicalId, "booking:mnk:69a1b189cf46d80637fbe8663f2c23b3");
      assert.deepEqual((await db.collection("fikaBookings").doc(legacy.canonicalId).get()).data(), before);
      assert.equal((await db.collection("fikaBookings").where("source.sourceBookingId", "==", payload.bookingId).get()).size, 1);
      assert.deepEqual((await db.collection("fikaBookingNotifications").doc(notification.notificationId).get()).data(), notification);
      await assert.rejects(ingestHospitalityPortalBooking({ ...payloadFor("cfc"), bookingId: payload.bookingId }), /different booking identity or portal site/);
    } finally {
      await db.collection("integrationHubSourceMappings").doc("identity-test-angel-court").set({ sourceProvider: "hospitality-booking-platform", sourceEntityType: "provider-location", sourceIdentifier: "angel-court", mappingStatus: "confirmed", oplocId: targets["angel-court"] });
    }
  });

  await t.test("unmapped and incorrect-provider destinations write no Booking, audit or notification", async () => {
    const payload = payloadFor("cfc", "identity-test-unmapped");
    const ref = db.collection("integrationHubSourceMappings").doc("identity-test-cfc");
    const saved = (await ref.get()).data()!;
    for (const replacement of [{ ...saved, sourceProvider: "mnk-booking-platform" }, { ...saved, oplocId: "oploc:missing" }, { ...saved, mappingStatus: "historical" }]) {
      await ref.set(replacement);
      await assert.rejects(ingestHospitalityPortalBooking(payload), /no confirmed canonical destination OPLOC/);
    }
    assert.equal((await db.collection("fikaBookings").doc(portalBookingIdentity(payload.bookingId, "cfc").canonicalId).get()).exists, false);
    assert.equal((await db.collection("fikaBookingNotifications").where("bookingId", "==", portalBookingIdentity(payload.bookingId, "cfc").canonicalId).get()).size, 0);
    assert.equal((await db.collection("fikaBookingAudit").where("canonicalId", "==", portalBookingIdentity(payload.bookingId, "cfc").canonicalId).get()).size, 0);
    await ref.set(saved);
  });

  await t.test("Calendar adapter persists the unchanged namespace/provider and accepts its legacy mapping independently", async () => {
    const payload = payloadFor("cfc", "calendar:cpux@fikacatering.com:event-1");
    const ref = db.collection("integrationHubSourceMappings").doc("identity-test-cfc");
    const saved = (await ref.get()).data()!;
    await ref.set({ ...saved, sourceProvider: "rota", sourceEntityType: "site-label" });
    try {
      const first = await ingestCalendarBooking(payload);
      assert.equal(first.booking.canonicalId, "booking:mnk:519aacb4ed35af3e271d9ff66f9fceaa");
      assert.equal(first.booking.canonicalId, calendarBookingIdentity(payload.bookingId, "cfc").canonicalId);
      assert.equal(first.booking.source.provider, "mnk-booking-platform");
      assert.equal((await ingestCalendarBooking(payload)).created, false);
      await assert.rejects(ingestHospitalityPortalBooking(payload), /different booking identity/);
    } finally { await ref.set(saved); }
  });

  await t.test("review, quote and downstream handoff retain Booking/Quote/Production identities and replay obligations", async () => {
    assert.ok(angel);
    const actor = { uid: "identity-regression", name: "Isolated Test", role: "integration-admin" as const, synthetic: true as const };
    let booking = (await executeBookingWorkflow(actor, angel.canonicalId, angel.version, { action: "review", checks: { commercialIntent: true, serviceTiming: true, deliveryContext: true, dietaryRequirements: true } })).booking;
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote" })).booking;
    const quoteId = `quote:${angel.canonicalId}:r1`;
    assert.equal(booking.quoteState?.currentRevisionId, quoteId);
    booking = (await executeBookingWorkflow(actor, booking.canonicalId, booking.version, { action: "quote-pdf-status", revisionId: quoteId, status: "saved", driveFileId: "isolated-fixture-no-drive-write" })).booking;
    const order = (await createProductionFromApprovedBooking(actor, booking.canonicalId, "identity-handoff" )).order;
    assert.equal(order.canonicalId, productionOrderV1Id(angel.canonicalId));
    assert.equal(order.sourceBookingId, angel.canonicalId);
    assert.equal(order.sourceQuoteRevisionId, quoteId);
    assert.equal(order.destinationOplocId, targets["angel-court"]);
    const replay = await ingestHospitalityPortalBooking(payloadFor("angel-court"));
    assert.equal(replay.created, false);
    assert.equal(replay.booking.canonicalId, angel.canonicalId);
    assert.equal(replay.booking.quoteState?.currentRevisionId, quoteId);
    assert.equal((await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", angel.canonicalId).get()).size, 1);
    const notifications = await db.collection("fikaBookingNotifications").where("bookingId", "==", angel.canonicalId).get();
    assert.equal(notifications.docs.filter(doc => doc.data().kind === "submitted").length, 1);
    assert.equal(notifications.docs.filter(doc => doc.data().kind === "confirmed").length, 1);
  });
});
