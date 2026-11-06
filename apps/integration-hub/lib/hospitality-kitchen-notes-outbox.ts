import type { Transaction } from "firebase-admin/firestore";
import { claimEvent, eventIsDue, markEventDelivered, markEventFailed, outboxRecord, resetEventForReplay, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { stableDocumentId } from "./canonical-editor";
import { db } from "./firebase-admin";
import type { ProductionOrder } from "./production-domain";
import { notifyCpuProjection } from "./cpu-projection-client";

const collection = () => db.collection("fikaHospitalityKitchenNotesOutboxV1");
export type KitchenNotesPropagationEvent = DurableDomainEvent<{ bookingId: string; sourceVersion: number; order: ProductionOrder; idempotencyKey: string }>;
export const kitchenNotesEventId = (bookingId: string, sourceVersion: number) => stableDocumentId(`hospitality-kitchen-notes:${bookingId}:v${sourceVersion}`);

export function stageKitchenNotesPropagation(transaction: Transaction, bookingId: string, sourceVersion: number, order: ProductionOrder, occurredAt: string) {
  const idempotencyKey = `booking-kitchen-notes:${bookingId}:v${sourceVersion}`;
  const event: KitchenNotesPropagationEvent = {
    eventId: kitchenNotesEventId(bookingId, sourceVersion), eventType: "hospitality.booking.kitchen-notes.updated",
    sourceAggregateId: bookingId, sourceVersion, occurredAt, correlationId: bookingId,
    causationId: idempotencyKey, schemaVersion: "fika.hospitality-kitchen-notes.v1",
    payload: { bookingId, sourceVersion, order, idempotencyKey }, delivery: { status: "pending", attempts: 0 },
  };
  const ref = collection().doc(event.eventId);
  transaction.create(ref, outboxRecord(event));
  return event.eventId;
}

async function claim(id: string) {
  return db.runTransaction(async transaction => {
    const ref = collection().doc(id); const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const event = snapshot.data() as KitchenNotesPropagationEvent;
    if (event.delivery.status === "delivered") return { event, claimed: false };
    const at = new Date().toISOString();
    const retryable = event.delivery.status === "dead-letter" || event.delivery.status === "failed" ? resetEventForReplay(event, at, "Explicit retry from the Hospitality kitchen-notes editor.") : event;
    if (!eventIsDue(retryable)) return { event, claimed: false };
    const next = claimEvent(retryable, `hub-kitchen-notes:${Date.now()}`, at);
    transaction.set(ref, outboxRecord(next)); return { event: next, claimed: true };
  });
}

export async function deliverKitchenNotesPropagation(eventId: string) {
  const claimed = await claim(eventId);
  if (!claimed?.claimed) return claimed?.event;
  try {
    if (!claimed.event.payload.order.serviceDate) throw new Error("The current Production Order has no service date for CPU notes propagation.");
    await notifyCpuProjection(claimed.event.payload.order, "kitchen-notes-updated", claimed.event.payload.idempotencyKey);
    const delivered = markEventDelivered(claimed.event, new Date().toISOString());
    await collection().doc(eventId).set(outboxRecord(delivered)); return delivered;
  } catch (error) {
    const failed = markEventFailed(claimed.event, error, new Date().toISOString());
    await collection().doc(eventId).set(outboxRecord(failed)); return failed;
  }
}

export async function kitchenNotesDeliveryStatus(eventId: string) {
  const snapshot = await collection().doc(eventId).get();
  return snapshot.exists ? (snapshot.data() as KitchenNotesPropagationEvent).delivery.status : "missing";
}
