/**
 * Public Angel Court submission boundary against an isolated Firestore emulator.
 * Run with: FIKA_HOSPITALITY_INGEST_EMULATOR_TEST=true npx firebase emulators:exec --only firestore --project demo-fika-os "npx tsx --test tests/angel-court-booking-ingestion.emulator.test.ts"
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as submitBooking } from "../app/api/bookings/mnk/route";
import { db } from "../lib/firebase-admin";
import { canonicalBookingId } from "../lib/hospitality-booking-service";
import { stableDocumentId } from "../lib/canonical-editor";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_HOSPITALITY_INGEST_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const stamp = "2026-01-01T00:00:00.000Z";
const canonical = () => db.collection("integrationHubCanonical");

test("Angel Court public Hub submission enforces governed minimums before writing bookings", { skip: !enabled }, async () => {
  const key = randomUUID().replace(/-/g, "");
  const previousToken = process.env.MNK_CANON_BRIDGE_TOKEN;
  process.env.MNK_CANON_BRIDGE_TOKEN = `test-${key}`;
  const itemId = `hospitality-menu-item:angel-ingest:${key}`;
  const offeringId = `hospitality-menu-offering:angel-ingest:${key}`;
  const priceId = `hospitality-menu-price:angel-ingest:${key}`;
  const oplocId = `oploc:angel-ingest:${key}`;
  const records: CanonicalRecord[] = [
    { canonicalId: itemId, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", name: "Angel Court lunch box", category: "Food", unitPrice: 12, minimumQuantity: 1, defaultMinimumQuantity: 4, defaultMinimumGuests: 2, defaultNoticeRequiredDays: 14, providerMappings: [{ provider: "angel-court-hospitality-brochure", sourceItemId: `angel-item-${key}` }], dietaryInformation: [], allergenInformation: [] } },
    { canonicalId: offeringId, entityType: "Hospitality Menu Offering", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard" } },
    { canonicalId: priceId, entityType: "Hospitality Menu Price", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", hospitalityMenuItemId: itemId, amount: 12, vatRate: 0.2, effectiveFrom: "2025-01-01" } },
    { canonicalId: oplocId, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", approvedName: "Angel Court" } },
  ];
  const mappingRef = db.collection("integrationHubSourceMappings").doc(`angel-ingest-${key}`);
  const savedBookingIds: string[] = [];
  const call = async (label: string, quantity: number, overrides: Record<string, unknown> = {}) => {
    const bookingId = `ANGEL-INGEST-${key}-${label}`;
    const payload = {
      bookingId,
      submittedAt: stamp,
      site: "Angel Court",
      siteId: "angel-court",
      client: { name: "UAT Host", email: "uat@example.test", companyName: "Ordinary customer", ...(overrides.client as object || {}) },
      event: { eventDate: "2027-02-02", startTime: "12:00", guestCount: 10, ...(overrides.event as object || {}) },
      order: { items: [{ itemId: `angel-item-${key}`, itemName: "Angel Court lunch box", quantity, unitPrice: 0.01, lineTotal: 0.01, minimumQuantity: 1 }], netTotal: 0.01 },
    };
    const response = await submitBooking(new NextRequest("http://hub.test/api/bookings/mnk", {
      method: "POST",
      headers: { "content-type": "application/json", "x-fika-mnk-bridge-token": `test-${key}` },
      body: JSON.stringify(payload),
    }));
    const body = await response.json() as { canonicalBookingId?: string; error?: { message?: string } };
    if (response.ok) savedBookingIds.push(String(body.canonicalBookingId));
    else assert.equal((await db.collection("fikaBookings").doc(canonicalBookingId(bookingId, "angel-court")).get()).exists, false, "rejected submissions must not write a Booking");
    return { status: response.status, body };
  };

  try {
    for (const record of records) await canonical().doc(stableDocumentId(record.canonicalId)).set(record);
    await mappingRef.set({ sourceIdentifier: "angel-court", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId });

    assert.notEqual((await call("default-too-low", 1)).status, 200, "A: Item default 4 rejects quantity 1 despite legacy minimum 1");
    assert.equal((await call("default-accepted", 4)).status, 200, "B: Item default 4 accepts quantity 4");

    await canonical().doc(stableDocumentId(offeringId)).update({ "record.minimumQuantity": 6 });
    assert.notEqual((await call("override-too-low", 4)).status, 200, "C: Offering override 6 rejects quantity 4");
    assert.equal((await call("override-accepted", 6)).status, 200, "D: Offering override 6 accepts quantity 6");

    await canonical().doc(stableDocumentId(offeringId)).update({ "record.minimumQuantity": 8 });
    assert.equal((await call("gallagher-capped", 5, { client: { companyName: "Gallagher", invoiceReference: "PO-123" } })).status, 200, "E: Gallagher cap is applied after the effective minimum 8 is resolved");
    assert.notEqual((await call("ordinary-full-minimum", 5)).status, 200, "F: ordinary customers retain effective minimum 8");
    assert.notEqual((await call("gallagher-guest-minimum", 5, { client: { companyName: "Gallagher", invoiceReference: "PO-123" }, event: { guestCount: 4 } })).status, 200, "G: Gallagher requires five guests");
    assert.notEqual((await call("gallagher-reference-required", 5, { client: { companyName: "Gallagher" } })).status, 200, "H: Gallagher requires an Invoice / PO reference");

    assert.equal((await call("notice-is-hard", 8, { event: { eventDate: "2026-10-19" } })).status, 422, "ten-day and stricter governed notices are hard restrictions");
  } finally {
    for (const bookingId of savedBookingIds) {
      const auditId = `${bookingId.replace(/[^A-Za-z0-9_-]/g, "_")}:1`;
      await db.collection("fikaBookings").doc(bookingId).delete();
      await db.collection("fikaBookingAudit").doc(auditId).delete();
      const notifications = await db.collection("fikaBookingNotifications").where("bookingId", "==", bookingId).limit(10).get();
      for (const notification of notifications.docs) await notification.ref.delete();
    }
    await mappingRef.delete();
    for (const record of records) await canonical().doc(stableDocumentId(record.canonicalId)).delete();
    if (previousToken === undefined) delete process.env.MNK_CANON_BRIDGE_TOKEN;
    else process.env.MNK_CANON_BRIDGE_TOKEN = previousToken;
  }
});
