export const DOMAIN_EVENT_SCHEMA_VERSION = "0.1.0";
export type DomainEventDelivery = { status: "pending" | "delivered" | "failed"; attempts: number; nextAttemptAt?: string; lastAttemptAt?: string; deliveredAt?: string; lastError?: string; claimId?: string; claimedAt?: string };
export type DurableDomainEvent<T = unknown> = {
  eventId: string;
  eventType: string;
  sourceAggregateId: string;
  sourceVersion: number;
  occurredAt: string;
  correlationId?: string;
  causationId?: string;
  schemaVersion: string;
  payload: T;
  delivery: DomainEventDelivery;
};

export function domainEventId(eventType: string, sourceAggregateId: string, sourceVersion: number) { return `${eventType}:${sourceAggregateId}:v${sourceVersion}`; }
export function createDomainEvent<T>(input: { eventType: string; sourceAggregateId: string; sourceVersion: number; occurredAt: string; correlationId?: string; causationId?: string; payload: T }): DurableDomainEvent<T> {
  return { ...input, eventId: domainEventId(input.eventType, input.sourceAggregateId, input.sourceVersion), schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION, delivery: { status: "pending", attempts: 0 } };
}

const CLAIM_LEASE_MS = 60_000;
export function eventIsDue(event: DurableDomainEvent, at = new Date()) { const claimActive = event.delivery.claimedAt && at.getTime() - new Date(event.delivery.claimedAt).getTime() < CLAIM_LEASE_MS; return event.delivery.status !== "delivered" && !claimActive && (!event.delivery.nextAttemptAt || new Date(event.delivery.nextAttemptAt).getTime() <= at.getTime()); }
export function claimEvent<T>(event: DurableDomainEvent<T>, claimId: string, at: string): DurableDomainEvent<T> { return { ...event, delivery: { ...event.delivery, claimId, claimedAt: at } }; }
export function markEventDelivered<T>(event: DurableDomainEvent<T>, at: string): DurableDomainEvent<T> { return { ...event, delivery: { ...event.delivery, status: "delivered", deliveredAt: at, lastAttemptAt: at, lastError: undefined, claimId: undefined, claimedAt: undefined } }; }
export function markEventFailed<T>(event: DurableDomainEvent<T>, error: unknown, at: string, retryAfterMs = 30_000): DurableDomainEvent<T> { return { ...event, delivery: { ...event.delivery, status: "failed", attempts: event.delivery.attempts + 1, lastAttemptAt: at, nextAttemptAt: new Date(new Date(at).getTime() + retryAfterMs).toISOString(), lastError: error instanceof Error ? error.message : String(error), claimId: undefined, claimedAt: undefined } }; }

export async function replayDueEvents<T>(events: DurableDomainEvent<T>[], consumer: (event: DurableDomainEvent<T>) => Promise<void> | void, at = new Date()) {
  const next = [...events].sort((a, b) => a.sourceAggregateId.localeCompare(b.sourceAggregateId) || a.sourceVersion - b.sourceVersion || a.eventId.localeCompare(b.eventId));
  const highestAppliedVersion = new Map<string, number>();
  for (const event of next) {
    if (event.delivery.status === "delivered") highestAppliedVersion.set(event.sourceAggregateId, Math.max(highestAppliedVersion.get(event.sourceAggregateId) || 0, event.sourceVersion));
  }
  let delivered = 0;
  for (let index = 0; index < next.length; index += 1) {
    const event = next[index];
    if (!eventIsDue(event, at)) continue;
    if ((highestAppliedVersion.get(event.sourceAggregateId) || 0) >= event.sourceVersion) {
      next[index] = markEventDelivered(event, at.toISOString());
      continue;
    }
    try { await consumer(event); next[index] = markEventDelivered(event, at.toISOString()); delivered += 1; }
    catch (error) { next[index] = markEventFailed(event, error, at.toISOString()); }
    if (next[index].delivery.status === "delivered") highestAppliedVersion.set(event.sourceAggregateId, event.sourceVersion);
  }
  return { events: next, delivered, failed: next.filter(event => event.delivery.status === "failed").length };
}
