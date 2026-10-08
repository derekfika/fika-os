import assert from "node:assert/strict";
import test from "node:test";
import { DURABLE_OUTBOX_MAX_ATTEMPTS, markEventDeadLetter, markEventDelivered, markEventFailed, outboxRecord, resetEventForReplay, type DurableDomainEvent } from "../src/durable-outbox";

const event = (): DurableDomainEvent => ({
  eventId: "production.materialise:week:day:v1",
  eventType: "production.materialise",
  sourceAggregateId: "week:day:published:oploc:1",
  sourceVersion: 1,
  occurredAt: "2026-08-24T10:00:00.000Z",
  schemaVersion: "0.1.0",
  payload: { publicationId: "menu-publication:week" },
  delivery: { status: "pending", attempts: 0, nextAttemptAt: "2026-08-24T10:00:00.000Z", nextEligibleAt: "2026-08-24T10:00:00.000Z" },
});

test("shared durable outbox keeps retries retryable through nine failures", () => {
  let current = event();
  for (let attempt = 1; attempt < DURABLE_OUTBOX_MAX_ATTEMPTS; attempt += 1) {
    current = markEventFailed(current, `failure-${attempt}`, "2026-08-24T10:00:00.000Z");
    assert.equal(current.delivery.status, "failed");
    assert.equal(current.delivery.attempts, attempt);
    assert.equal(current.delivery.nextAttemptAt, "2026-08-24T10:00:30.000Z");
  }
});

test("shared durable outbox dead-letters on the tenth failure and replay preserves lineage", () => {
  let current = event();
  for (let attempt = 0; attempt < DURABLE_OUTBOX_MAX_ATTEMPTS; attempt += 1) current = markEventFailed(current, "downstream unavailable", "2026-08-24T10:00:00.000Z");
  assert.equal(current.delivery.status, "dead-letter");
  assert.equal(current.delivery.attempts, DURABLE_OUTBOX_MAX_ATTEMPTS);
  assert.equal(current.delivery.leaseOwner, undefined);
  assert.equal(current.delivery.lastError, "downstream unavailable");
  const replayed = resetEventForReplay(current, "2026-08-24T11:00:00.000Z", "operator replay");
  assert.equal(replayed.eventId, current.eventId);
  assert.equal(replayed.sourceAggregateId, current.sourceAggregateId);
  assert.equal(replayed.delivery.status, "pending");
  assert.equal(replayed.delivery.nextEligibleAt, "2026-08-24T11:00:00.000Z");
});

test("outbox serialization keeps eligibility only on retryable records", () => {
  const pending = outboxRecord(event());
  assert.equal(pending.nextEligibleAt, event().occurredAt);
  const delivered = outboxRecord(markEventDelivered(event(), "2026-08-24T10:01:00.000Z"));
  const deadLetter = outboxRecord(markEventDeadLetter(event(), "terminal", "2026-08-24T10:01:00.000Z"));
  assert.equal(delivered.outboxStatus, "delivered");
  assert.equal("nextEligibleAt" in delivered, false);
  assert.equal(deadLetter.outboxStatus, "dead-letter");
  assert.equal("nextEligibleAt" in deadLetter, false);
  assert.equal(delivered.occurredAt, event().occurredAt, "immutable occurrence history is preserved");
});
