/**
 * Munich RE public Hub submission, persistence, replay, cancellation and CPU routing plan against an isolated Firestore emulator.
 * Run with: FIKA_MUNICH_RE_EMULATOR_TEST=true npx firebase emulators:exec --only firestore --project demo-fika-os "npx tsx --test tests/munich-re-booking.emulator.test.ts"
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as submitBooking } from "../app/api/bookings/mnk/route";
import { db } from "../lib/firebase-admin";
import { canonicalBookingId, transitionBooking } from "../lib/hospitality-booking-service";
import { planHospitalityCpuRouting } from "../lib/hospitality-cpu-routing";
import { stableDocumentId } from "../lib/canonical-editor";
import type { CanonicalRecord } from "../lib/types";

const enabled = process.env.FIKA_MUNICH_RE_EMULATOR_TEST === "true" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "");
const canonical = () => db.collection("integrationHubCanonical");

test("Munich RE: minimum 5, location persistence, idempotent replay, cancellation and CPU routing outcome", { skip: !enabled }, async () => {
  const key = randomUUID().replace(/-/g, "");
  const previousToken = process.env.MNK_CANON_BRIDGE_TOKEN;
  process.env.MNK_CANON_BRIDGE_TOKEN = `test-${key}`;
  const itemId = `hospitality-menu-item:mr-e2e:${key}`;
  const oplocId = `oploc:mr-e2e:${key}`;
  const stamp = "2026-01-01T00:00:00.000Z";
  const records: CanonicalRecord[] = [
    { canonicalId: itemId, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", name: "Deli Style Sandwich Lunch", category: "Lunch", unitPrice: 9, minimumQuantity: 8, defaultMinimumQuantity: 8, providerMappings: [{ provider: "munich-re-generic-brochure", sourceItemId: `mr-deli-${key}` }], dietaryInformation: [], allergenInformation: [] } },
    { canonicalId: `hospitality-menu-offering:mr-e2e:${key}`, entityType: "Hospitality Menu Offering", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard" } },
    { canonicalId: `hospitality-menu-price:mr-e2e:${key}`, entityType: "Hospitality Menu Price", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", hospitalityMenuItemId: itemId, amount: 9, vatRate: 0.2, effectiveFrom: "2025-01-01" } },
    { canonicalId: oplocId, entityType: "OPLOC", lifecycleStatus: "published", publicationStatus: "published", dataHash: "test", record: { lifecycleState: "active", approvedName: "Munich RE" } },
  ] as CanonicalRecord[];
  const mappingRef = db.collection("integrationHubSourceMappings").doc(`mr-e2e-${key}`);
  const saved: string[] = [];
  const call = async (label: string, quantity: number, location: Record<string, string>, extraLines: unknown[] = []) => {
    const bookingId = `MR-E2E-${key}-${label}`;
    const payload = {
      bookingId, submittedAt: stamp, site: "Munich RE", siteId: "munich-re",
      client: { name: "UAT Host", email: "uat@example.test", companyName: "Munich Re" },
      event: { eventDate: "2027-02-02", startTime: "12:00", guestCount: 10, ...location },
      order: { items: [{ itemId: `mr-deli-${key}`, itemName: "Deli Style Sandwich Lunch", quantity, unitPrice: 0.01, lineTotal: 0.01 }, ...extraLines], netTotal: 0.01 },
    };
    const request = () => new NextRequest("http://hub.test/api/bookings/mnk", { method: "POST", headers: { "content-type": "application/json", "x-fika-mnk-bridge-token": `test-${key}` }, body: JSON.stringify(payload) });
    const response = await submitBooking(request());
    const body = await response.json() as { canonicalBookingId?: string };
    if (response.ok) saved.push(String(body.canonicalBookingId));
    return { status: response.status, body, id: canonicalBookingId(bookingId, "munich-re"), replay: () => submitBooking(request()) };
  };

  try {
    for (const record of records) await canonical().doc(stableDocumentId(record.canonicalId)).set(record);
    await mappingRef.set({ sourceIdentifier: "munich-re", sourceEntityType: "provider-location", mappingStatus: "confirmed", oplocId });

    const low = await call("four", 4, { roomOrArea: "Acacia" });
    assert.equal(low.status, 422, "4 of a standard-8 item is rejected for Munich RE");
    assert.match(JSON.stringify(low.body), /at least 5/, "rejected for the Munich RE minimum, not for another reason");
    assert.equal((await db.collection("fikaBookings").doc(low.id).get()).exists, false, "a rejected submission writes no Booking");

    const room = await call("room", 5, { roomOrArea: "Flex" }, [{ itemId: "mr-light-table-lunch", itemName: "Light Table Lunch", quantity: 1, unitPrice: 0.01, lineTotal: 0.01 }]);
    assert.equal(room.status, 200, JSON.stringify(room.body));
    const stored = (await db.collection("fikaBookings").doc(room.id).get()).data() as any;
    assert.equal(stored.service.portalSiteId, "munich-re");
    assert.equal(stored.service.oplocId, oplocId);
    assert.equal(stored.service.roomOrArea, "Flex");
    assert.equal(stored.order.items[0].quantity, 5);
    assert.equal(stored.order.items[0].unitPrice, 9, "price is the governed £9, not the browser's");
    assert.equal(stored.order.items[0].menuItemId, itemId, "mapped to the canonical company item");
    assert.equal(stored.order.items[1].unitPrice, 150, "the Munich RE form item is priced by the server catalogue");

    const collection = await call("collection", 5, { deliveryPoint: "Collection from Level 5 Cafe" });
    assert.equal(collection.status, 200);
    const storedCollection = (await db.collection("fikaBookings").doc(collection.id).get()).data() as any;
    assert.equal(storedCollection.service.deliveryPoint, "Collection from Level 5 Cafe");
    assert.equal(storedCollection.service.roomOrArea, undefined);

    const replay = await room.replay();
    assert.equal(replay.status, 200);
    assert.equal((await db.collection("fikaBookings").where("source.sourceBookingId", "==", `MR-E2E-${key}-room`).get()).size, 1, "a replay never duplicates the Booking");

    // CPU routing plan: the canonical item routes through its governed record; the unmapped Munich RE form item needs a routing decision.
    const plan = planHospitalityCpuRouting(stored.order.items, "munich-re", { [itemId]: ["sandwiches"] });
    assert.equal(plan.lines[0].state, "cpu_sandwiches");
    assert.equal(plan.lines[1].state, "routing_required");
    assert.equal(plan.status, "routing_required", "hand-off is blocked until the form item has a governed routing decision");

    const cancelled = await transitionBooking({ uid: "test", name: "Test", role: "admin", synthetic: true } as never, room.id, stored.version, "Cancelled", "Customer cancelled");
    assert.equal(cancelled.lifecycleStatus, "Cancelled");
    assert.equal(cancelled.service.roomOrArea, "Flex", "cancellation retains the original location evidence");
  } finally {
    for (const bookingId of saved) {
      await db.collection("fikaBookings").doc(bookingId).delete();
      for (const audit of (await db.collection("fikaBookingAudit").where("canonicalId", "==", bookingId).limit(10).get()).docs) await audit.ref.delete();
      await db.collection("fikaBookingAudit").doc(`${bookingId.replace(/[^A-Za-z0-9_-]/g, "_")}:1`).delete();
      for (const n of (await db.collection("fikaBookingNotifications").where("bookingId", "==", bookingId).limit(10).get()).docs) await n.ref.delete();
    }
    await mappingRef.delete();
    for (const record of records) await canonical().doc(stableDocumentId(record.canonicalId)).delete();
    if (previousToken === undefined) delete process.env.MNK_CANON_BRIDGE_TOKEN; else process.env.MNK_CANON_BRIDGE_TOKEN = previousToken;
  }
});
