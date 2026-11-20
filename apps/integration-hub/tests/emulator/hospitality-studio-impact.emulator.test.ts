import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { readStudioBookingImpact } from "../../lib/hospitality-studio-impact/store";

test("emulator: impact reads canonical future bookings, follows item lineage and leaves records untouched", async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const suffix = randomUUID();
  const app = initializeApp({ projectId: "demo-fika-os" }, suffix);
  const db = getFirestore(app);
  const day = "2091-09-17";
  const target = "hospitality-menu-item:impact-current:" + suffix;
  const previous = "hospitality-menu-item:impact-former:" + suffix;
  const site = "oploc:studio-impact-test";
  const booked = db.collection("fikaBookings").doc("studio-impact-approved-" + suffix);
  const cancelled = db.collection("fikaBookings").doc("studio-impact-cancelled-" + suffix);
  const alias = db.collection("integrationHubHospitalityMenuItemMerges").doc(stableDocumentId(previous));
  const canonical = db.collection("integrationHubCanonical").doc(stableDocumentId(target));
  const source = {
    entityType: "Booking", canonicalId: booked.id, lifecycleStatus: "Approved",
    service: { eventDate: day, oplocId: site }, order: { items: [{ menuItemId: previous }] },
    client: { name: "Private fixture contact" }, kitchenNotes: "Private fixture note",
  };
  try {
    const batch = db.batch();
    batch.create(booked, source);
    batch.create(cancelled, { ...source, canonicalId: cancelled.id, lifecycleStatus: "Cancelled" });
    batch.create(alias, { sourceMenuItemId: previous, survivorMenuItemId: target });
    batch.create(canonical, { canonicalId: target, entityType: "Hospitality Menu Item", record: { name: "Verified bowls" } });
    await batch.commit();
    const result = await readStudioBookingImpact(db, {
      firstEventDate: day, lastEventDate: day, catalogueItemIds: [target], scope: "catalogue-item",
    }, async () => new Map([[site, "Governed site"]]));
    assert.deepEqual(result, {
      scope: "catalogue-item", coverage: "complete", reasons: [],
      bookings: [{ id: booked.id, eventDate: day, site: "Governed site", selectionIds: [target], selections: ["Verified bowls"] }],
    });
    assert.deepEqual((await booked.get()).data(), source);
  } finally {
    const cleanup = db.batch();
    for (const record of [booked, cancelled, alias, canonical]) cleanup.delete(record);
    await cleanup.commit();
    await deleteApp(app);
  }
});
