export type DurableDeliveryStatus = "pending" | "delivered" | "failed" | "dead-letter";

export type DurableEventDelivery = {
  status: DurableDeliveryStatus;
  attempts: number;
  nextAttemptAt?: string;
  nextEligibleAt?: string;
  lastAttemptAt?: string;
  deliveredAt?: string;
  lastError?: string;
  claimId?: string;
  leaseOwner?: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  deadLetteredAt?: string;
};

export type DurableDomainEvent<T = unknown> = {
  eventId: string;
  eventType: string;
  sourceAggregateId: string;
  sourceVersion: number;
  occurredAt: string;
  correlationId?: string;
  causationId?: string;
  predecessorEventId?: string;
  schemaVersion: string;
  payload: T;
  delivery: DurableEventDelivery;
};

export const DURABLE_OUTBOX_RETRY_DELAY_MS = 30_000;
export const DURABLE_OUTBOX_LEASE_MS = 60_000;
export const DURABLE_OUTBOX_MAX_ATTEMPTS = 10;

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function eventIsDue(event: DurableDomainEvent, at = new Date()) {
  const delivery = event.delivery;
  if (delivery.status !== "pending" && delivery.status !== "failed") return false;
  const dueAt = delivery.nextEligibleAt || delivery.nextAttemptAt;
  if (dueAt && new Date(dueAt) > at) return false;
  const legacyLeaseActive = delivery.claimedAt && !delivery.leaseExpiresAt && at.getTime() - new Date(delivery.claimedAt).getTime() < DURABLE_OUTBOX_LEASE_MS;
  return !legacyLeaseActive && (!delivery.leaseExpiresAt || new Date(delivery.leaseExpiresAt) <= at);
}

export function claimEvent<T>(event: DurableDomainEvent<T>, claimId: string, at: string, leaseMs = DURABLE_OUTBOX_LEASE_MS) {
  const leaseExpiresAt = new Date(Date.parse(at) + leaseMs).toISOString();
  return { ...event, delivery: { ...event.delivery, claimId, leaseOwner: claimId, claimedAt: at, leaseExpiresAt, nextEligibleAt: leaseExpiresAt } };
}

export function markEventDelivered<T>(event: DurableDomainEvent<T>, at: string) {
  return { ...event, delivery: { ...event.delivery, status: "delivered" as const, deliveredAt: at, lastAttemptAt: at, claimId: undefined, leaseOwner: undefined, claimedAt: undefined, leaseExpiresAt: undefined, nextEligibleAt: undefined } };
}

export function markEventDeadLetter<T>(event: DurableDomainEvent<T>, reason: unknown, at: string) {
  return { ...event, delivery: { ...event.delivery, status: "dead-letter" as const, deadLetteredAt: at, lastAttemptAt: at, lastError: errorMessage(reason), claimId: undefined, leaseOwner: undefined, claimedAt: undefined, leaseExpiresAt: undefined, nextEligibleAt: undefined } };
}

export function markEventFailed<T>(event: DurableDomainEvent<T>, error: unknown, at: string) {
  const attempts = event.delivery.attempts + 1;
  if (attempts >= DURABLE_OUTBOX_MAX_ATTEMPTS) return markEventDeadLetter({ ...event, delivery: { ...event.delivery, attempts } }, error, at);
  const nextAttemptAt = new Date(Date.parse(at) + DURABLE_OUTBOX_RETRY_DELAY_MS).toISOString();
  return { ...event, delivery: { ...event.delivery, status: "failed" as const, attempts, lastAttemptAt: at, nextAttemptAt, nextEligibleAt: nextAttemptAt, lastError: errorMessage(error), claimId: undefined, leaseOwner: undefined, claimedAt: undefined, leaseExpiresAt: undefined } };
}

/** Deliberate operator replay. Identity and payload lineage remain unchanged. */
export function resetEventForReplay<T>(event: DurableDomainEvent<T>, at: string, reason = "manual replay") {
  return { ...event, delivery: { ...event.delivery, status: "pending" as const, attempts: 0, nextAttemptAt: at, nextEligibleAt: at, lastAttemptAt: undefined, deliveredAt: undefined, lastError: reason, claimId: undefined, leaseOwner: undefined, claimedAt: undefined, leaseExpiresAt: undefined, deadLetteredAt: undefined } };
}

export function outboxRecord<T>(event: DurableDomainEvent<T>) {
  return { ...event, outboxStatus: event.delivery.status, nextEligibleAt: event.delivery.nextEligibleAt || event.delivery.nextAttemptAt || event.occurredAt, aggregateSequence: event.sourceVersion, ...(event.predecessorEventId ? { predecessorEventId: event.predecessorEventId } : {}) };
}
