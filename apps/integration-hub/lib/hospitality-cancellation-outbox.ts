import type { Transaction } from "firebase-admin/firestore";
import { claimEvent, eventIsDue, markEventDelivered, markEventFailed, outboxRecord, resetEventForReplay, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { stableDocumentId } from "./canonical-editor";
import { db } from "./firebase-admin";
import type { ProductionOrder } from "./production-domain";
import { notifyCpuProjection } from "./cpu-projection-client";

const COLLECTION = "fikaHospitalityCancellationOutboxV1";
export type HospitalityCancellationEvent = DurableDomainEvent<{ bookingId: string; order: ProductionOrder; idempotencyKey: string }>;
const collection = () => db.collection(COLLECTION);
export const hospitalityCancellationEventId = (orderId: string, orderVersion: number) => stableDocumentId(`hospitality-cancel:${orderId}:v${orderVersion}`);

export function stageHospitalityCancellation(transaction: Transaction, bookingId: string, order: ProductionOrder, occurredAt: string) {
  const idempotencyKey = `hospitality-withdrawal:${order.canonicalId}:v${order.version}`;
  const event: HospitalityCancellationEvent = {
    eventId: hospitalityCancellationEventId(order.canonicalId, order.version),
    eventType: "hospitality.production.withdrawal",
    sourceAggregateId: bookingId,
    sourceVersion: order.version,
    occurredAt,
    correlationId: bookingId,
    causationId: idempotencyKey,
    schemaVersion: "fika.hospitality-cancellation.v1",
    payload: { bookingId, order, idempotencyKey },
    delivery: { status: "pending", attempts: 0 },
  };
  transaction.set(collection().doc(event.eventId), outboxRecord(event), { merge: false });
  return event.eventId;
}

export async function ensureHospitalityCancellationEvent(bookingId: string, order: ProductionOrder) {
  const id = hospitalityCancellationEventId(order.canonicalId, order.version);
  const idempotencyKey = `hospitality-withdrawal:${order.canonicalId}:v${order.version}`;
  return db.runTransaction(async transaction => {
    const ref = collection().doc(id);
    const snapshot = await transaction.get(ref);
    const bookingSnapshot = await transaction.get(db.collection("fikaBookings").doc(bookingId));
    const bookingVersion = Number(bookingSnapshot.data()?.version || 0);
    const legacyIdempotencyKey = bookingVersion ? `hospitality-projection:${bookingId}:cancelled:v${bookingVersion}` : undefined;
    const receiptKeys = [idempotencyKey, ...(legacyIdempotencyKey && legacyIdempotencyKey !== idempotencyKey ? [legacyIdempotencyKey] : [])];
    const receipts = await Promise.all(receiptKeys.map(key => transaction.get(db.collection("fikaCpuProductionChangeReceiptsV1").doc(key.replace(/[^A-Za-z0-9:_-]+/g, "_")))));
    const deliveredReceipt = receipts.map((receipt, index) => ({ receipt, key: receiptKeys[index] })).find(({ receipt, key }) => {
      const cpuEvent = receipt.data()?.event as { entityId?: string; changeType?: string; idempotencyKey?: string } | undefined;
      return receipt.exists && cpuEvent?.entityId === order.canonicalId && cpuEvent?.changeType === "withdrawn" && cpuEvent?.idempotencyKey === key;
    });
    if (snapshot.exists) {
      const existing = snapshot.data() as HospitalityCancellationEvent;
      if (deliveredReceipt && existing.delivery.status !== "delivered" && (deliveredReceipt.key === existing.payload.idempotencyKey || deliveredReceipt.key === legacyIdempotencyKey)) {
        const delivered = markEventDelivered(existing, deliveredReceipt.receipt.data()?.event?.changedAt || order.updatedAt || order.createdAt);
        transaction.set(ref, outboxRecord(delivered));
        return delivered;
      }
      return existing;
    }
    const deliveryKey = deliveredReceipt?.key || idempotencyKey;
    const alreadyDelivered = Boolean(deliveredReceipt);
    const event: HospitalityCancellationEvent = {
      eventId: id, eventType: "hospitality.production.withdrawal", sourceAggregateId: bookingId,
      sourceVersion: order.version, occurredAt: order.updatedAt || order.createdAt, correlationId: bookingId,
      causationId: deliveryKey,
      schemaVersion: "fika.hospitality-cancellation.v1", payload: { bookingId, order, idempotencyKey: deliveryKey },
      delivery: { status: alreadyDelivered ? "delivered" : "pending", attempts: 0, ...(alreadyDelivered ? { deliveredAt: order.updatedAt || order.createdAt } : {}) },
    };
    transaction.create(ref, outboxRecord(event));
    return event;
  });
}

async function claim(id: string) {
  return db.runTransaction(async transaction => {
    const ref = collection().doc(id); const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const event = snapshot.data() as HospitalityCancellationEvent;
    // The cancellation command is an explicit operator retry; bypass backoff
    // while still respecting an active delivery lease.
    if (event.delivery.status === "delivered") return { event, claimed: false };
    const at = new Date().toISOString();
    const retryable = event.delivery.status === "dead-letter" ? resetEventForReplay(event, at, "Authorised retry through Hospitality cancellation.") : { ...event, delivery: { ...event.delivery, nextAttemptAt: undefined, nextEligibleAt: undefined } };
    if (!eventIsDue(retryable)) return { event, claimed: false };
    const next = claimEvent(retryable, `hub-hospitality-cancel:${Date.now()}`, at);
    transaction.set(ref, outboxRecord(next)); return { event: next, claimed: true };
  });
}

export async function deliverHospitalityCancellation(eventId: string) {
  const claimed = await claim(eventId);
  if (!claimed?.claimed) return claimed?.event;
  const event = claimed.event;
  try {
    await notifyCpuProjection(event.payload.order, "withdrawn", event.payload.idempotencyKey);
    const delivered = markEventDelivered(event, new Date().toISOString());
    await collection().doc(eventId).set(outboxRecord(delivered)); return delivered;
  } catch (error) {
    const failed = markEventFailed(event, error, new Date().toISOString());
    await collection().doc(eventId).set(outboxRecord(failed)); return failed;
  }
}

export async function cancellationDeliveryStatus(eventIds: string[]) {
  if (!eventIds.length) return "delivered" as const;
  const snapshots = await db.getAll(...eventIds.map(id => collection().doc(id)));
  const events = snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as HospitalityCancellationEvent);
  if (events.length !== eventIds.length || events.some(event => event.delivery.status !== "delivered")) return "pending" as const;
  return "delivered" as const;
}
