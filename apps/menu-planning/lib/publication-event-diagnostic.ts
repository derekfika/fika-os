import type { DurableDomainEvent } from "./fika-contracts";

/** The publication binding prevents an event ID from being used to read another publication's outbox row. */
export function isPublicationEventForPublication(event: DurableDomainEvent, publicationId: string) {
  const payload = event.payload;
  return Boolean(payload && typeof payload === "object" && "publicationId" in payload && payload.publicationId === publicationId);
}

/** Exposes persisted delivery evidence while withholding transient worker lease identifiers. */
export function publicationEventDiagnostic(event: DurableDomainEvent) {
  const { delivery, ...record } = event;
  return {
    ...record,
    delivery: {
      status: delivery.status,
      attempts: delivery.attempts,
      ...(delivery.nextAttemptAt ? { nextAttemptAt: delivery.nextAttemptAt } : {}),
      ...(delivery.nextEligibleAt ? { nextEligibleAt: delivery.nextEligibleAt } : {}),
      ...(delivery.lastAttemptAt ? { lastAttemptAt: delivery.lastAttemptAt } : {}),
      ...(delivery.deliveredAt ? { deliveredAt: delivery.deliveredAt } : {}),
      ...(delivery.deadLetteredAt ? { deadLetteredAt: delivery.deadLetteredAt } : {}),
      ...(delivery.lastError ? { lastError: delivery.lastError } : {}),
    },
  };
}
