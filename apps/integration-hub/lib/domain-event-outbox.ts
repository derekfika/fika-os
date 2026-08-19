import type { Transaction } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import type { DurableDomainEvent } from "../../shared/domain-events";

const events = () => db.collection("fikaDomainEventsV1");

/**
 * The Integration Hub owns this durable handoff store for Firestore-backed
 * domains. The event ID is the write idempotency key, so retries overwrite the
 * same event document rather than creating duplicate deliveries.
 */
export function stageDomainEvent(transaction: Transaction, event: DurableDomainEvent) {
  transaction.set(events().doc(event.eventId), event);
}

export async function listDomainEvents(limit = 500) {
  const snapshot = await events().orderBy("occurredAt", "asc").limit(limit).get();
  return snapshot.docs.map(document => document.data() as DurableDomainEvent);
}
