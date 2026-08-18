import { db } from "../lib/firebase-admin";
import { localBookingFixtures } from "../lib/local-booking-fixtures";
import type { ProductionOrder } from "../lib/production-domain";
import { productionOrderV1Id } from "../lib/production-domain";
import { stableDocumentId } from "../lib/canonical-editor";

const productionStatus = (status: string): ProductionOrder["status"] => ({
  New: "received",
  Reviewed: "needs_review",
  Quoted: "needs_review",
  Approved: "accepted",
  Completed: "complete",
  Cancelled: "cancelled",
}[status] || "needs_review") as ProductionOrder["status"];

function productionOrderForBooking(booking: (typeof localBookingFixtures)[number]): ProductionOrder {
  const now = booking.updatedAt;
  const status = productionStatus(booking.lifecycleStatus);
  const lines = booking.order.items.map((item, index) => ({
    canonicalId: `production-line:${booking.canonicalId}:${index + 1}`,
    sourceBookingLineId: `${booking.canonicalId}:line:${index + 1}`,
    ...(item.menuItemId ? { sourceMenuItemId: item.menuItemId } : {}),
    itemName: item.itemName || item.itemId,
    ...(item.description ? { description: item.description } : {}),
    customerQuantity: item.quantity,
    customerUnit: item.servingInfo || "ordered unit",
    dietaries: structuredClone(booking.dietaries || {}),
    allergenEvidenceStatus: Object.keys(booking.dietaries || {}).length ? "confirmed" as const : "unreviewed" as const,
    status: status === "complete" ? "complete" as const : "ready" as const,
    sortOrder: index,
  }));
  const orderId = productionOrderV1Id(booking.canonicalId);
  return {
    canonicalId: orderId,
    entityType: "Production Order",
    schemaVersion: "0.1.0",
    version: 1,
    requirementIds: [],
    sourceBookingId: booking.canonicalId,
    sourceQuoteRevisionId: booking.quoteState?.currentRevisionId || "",
    productionLocationId: booking.service.oplocId,
    destinationLabel: booking.service.portalSiteLabel || booking.service.roomOrArea || booking.service.deliveryPoint,
    clientName: booking.client.companyName,
    serviceType: booking.order.eventType,
    serviceDate: booking.service.eventDate,
    guestCount: booking.service.guestCount,
    requiredBy: `${booking.service.eventDate}T${booking.service.startTime}`,
    serviceWindow: { startTime: booking.service.startTime, ...(booking.service.endTime ? { endTime: booking.service.endTime } : {}) },
    status,
    priority: "normal",
    lines,
    exceptions: [],
    origin: "hospitality_booking",
    currentRevision: 1,
    createdAt: now,
    createdBy: "local-fixture",
    idempotencyKey: `fixture:${booking.canonicalId}`,
    externalReferences: [booking.source.sourceBookingId],
    audit: [{ action: "local-fixture-production-created", at: now, by: "local-fixture", newState: status, reason: "Deterministic end-to-end test booking." }],
    ...(status === "complete" ? { completedAt: now } : {}),
  };
}

// Safe by construction: firebase-admin refuses non-loopback projects through
// lib/safety.ts. Only deterministic fixture IDs are written, so this can be
// repeated after a local emulator restart without creating duplicates.
const batch = db.batch();
for (const booking of localBookingFixtures) {
  batch.set(db.collection("fikaBookings").doc(booking.canonicalId), booking);
  const order = productionOrderForBooking(booking);
  batch.set(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(order.canonicalId)), order);
}
await batch.commit();
console.log(`Seeded ${localBookingFixtures.length} canonical test Bookings into the local emulator.`);
console.log(`Seeded ${localBookingFixtures.length} matching Production Orders with the same source Booking IDs.`);
console.log("All records use booking:fixture:* IDs and may be removed with the fixture reset command.");
