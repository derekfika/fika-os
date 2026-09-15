import { db } from "./firebase-admin";
import type { Transaction } from "firebase-admin/firestore";
import {
  claimEvent,
  eventIsDue,
  markEventDelivered,
  markEventFailed,
  outboxRecord,
  resetEventForReplay,
  type DurableDomainEvent,
} from "@fika/server-shared/durable-outbox";

export type CpuPropagationConsumer = "delivered-in" | "logistics";

export type CpuConsumerInvalidationInput = {
  eventId?: string;
  sourceEntityId: string;
  serviceDate: string;
  sourceVersion: number;
  changedAt: string;
  changeType: string;
  order?: { origin?: string; destinationOplocId?: string };
  logistics?: boolean;
  reviewManifest?: { sourceVersion?: string; contentHash?: string };
};

type CpuDeliveryPayload = {
  deliveryId: string;
  sourceEventId: string;
  consumer: CpuPropagationConsumer;
  route: string;
  body: Record<string, unknown>;
};

type CpuOutboxEvent = DurableDomainEvent<CpuDeliveryPayload>;
export type CpuPropagationOutboxEvent = CpuOutboxEvent;

export type CpuDurableDeliveryInput = {
  eventId: string;
  sourceAggregateId: string;
  sourceVersion: number;
  occurredAt: string;
  consumer: CpuPropagationConsumer;
  route: string;
  body: Record<string, unknown>;
};

export const CPU_PROPAGATION_OUTBOX_COLLECTION = "fikaCpuPropagationOutboxV1";
export const CPU_PROPAGATION_OUTBOX_PAGE_SIZE = 25;

const memoryOutbox = new Map<string, CpuOutboxEvent>();
const memoryEligible = new Map<string, string>();
const useMemoryOutbox = () => process.env.NODE_ENV === "test" || process.argv.includes("--test") || process.env.FIKA_CPU_PLAN_STORE === "memory";

function trackMemoryEligibility(event: CpuOutboxEvent) {
  memoryEligible.delete(event.eventId);
  if (event.delivery.status === "pending" || event.delivery.status === "failed") {
    memoryEligible.set(event.eventId, event.delivery.nextEligibleAt || event.delivery.nextAttemptAt || event.occurredAt);
  }
}

function deliveryId(eventId: string, consumer: CpuPropagationConsumer, scope: string) {
  return `${eventId}:${consumer}:${scope}`.replace(/[^A-Za-z0-9:_-]+/g, "_");
}

function bodyFor(input: CpuConsumerInvalidationInput, consumer: CpuPropagationConsumer, oplocId?: string) {
  const contentHash = input.reviewManifest?.contentHash;
  if (consumer === "delivered-in") {
    if (!oplocId) return undefined;
    return {
      sourceDomain: "cpu-production",
      sourceEntityId: input.sourceEntityId,
      eventId: input.eventId,
      eventType: input.changeType,
      serviceDate: input.serviceDate,
      oplocId,
      sourceVersion: input.reviewManifest?.sourceVersion || `cpu-change-${input.sourceVersion}`,
      ...(contentHash ? { contentHash } : {}),
    };
  }
  return {
    serviceDate: input.serviceDate,
    sourceDomain: "cpu-production",
    sourceEntityId: input.sourceEntityId,
    sourceVersion: input.sourceVersion,
    changedAt: input.changedAt,
    changeType: input.changeType === "changed" ? "status-changed" : input.changeType,
    ...(contentHash ? { sourceContentHash: contentHash } : {}),
  };
}

export function buildCpuPropagationEvents(input: CpuConsumerInvalidationInput): CpuOutboxEvent[] {
  const sourceEventId = input.eventId || `cpu-change:${input.sourceEntityId}:v${input.sourceVersion}`;
  const events: CpuOutboxEvent[] = [];
  if (input.order?.origin === "menu_planning" && input.order.destinationOplocId) {
    const scope = `${input.serviceDate}:${input.order.destinationOplocId}`;
    const id = deliveryId(sourceEventId, "delivered-in", scope);
    events.push({
      eventId: id,
      eventType: "cpu.consumer.invalidate",
      sourceAggregateId: input.sourceEntityId,
      sourceVersion: input.sourceVersion,
      occurredAt: input.changedAt,
      schemaVersion: "0.1.0",
      payload: { deliveryId: id, sourceEventId, consumer: "delivered-in", route: "/api/delivered-in/invalidate", body: { ...bodyFor(input, "delivered-in", input.order.destinationOplocId)!, eventId: sourceEventId } },
      delivery: { status: "pending", attempts: 0, nextAttemptAt: input.changedAt, nextEligibleAt: input.changedAt },
    });
  }
  if (input.logistics) {
    const scope = input.serviceDate;
    const id = deliveryId(sourceEventId, "logistics", scope);
    events.push({
      eventId: id,
      eventType: "cpu.consumer.invalidate",
      sourceAggregateId: input.sourceEntityId,
      sourceVersion: input.sourceVersion,
      occurredAt: input.changedAt,
      schemaVersion: "0.1.0",
      payload: { deliveryId: id, sourceEventId, consumer: "logistics", route: "/api/logistics/invalidate", body: bodyFor(input, "logistics")! },
      delivery: { status: "pending", attempts: 0, nextAttemptAt: input.changedAt, nextEligibleAt: input.changedAt },
    });
  }
  return events;
}

function refs(events: CpuOutboxEvent[]) { return events.map(event => db.collection(CPU_PROPAGATION_OUTBOX_COLLECTION).doc(event.eventId)); }

async function persistCpuEvents(events: CpuOutboxEvent[]) {
  if (useMemoryOutbox()) {
    for (const event of events) if (!memoryOutbox.has(event.eventId)) { memoryOutbox.set(event.eventId, event); trackMemoryEligibility(event); }
    return;
  }
  await db.runTransaction(async transaction => {
    const documents = await Promise.all(refs(events).map(ref => transaction.get(ref)));
    for (let index = 0; index < events.length; index += 1) {
      if (!documents[index].exists) transaction.create(refs(events)[index], outboxRecord(events[index]));
    }
  });
}

/** Stage delivery obligations in the same Firestore transaction as the CPU change. */
export async function stageCpuPropagation(transaction: Transaction, input: CpuConsumerInvalidationInput, extraDeliveries: CpuDurableDeliveryInput[] = []) {
  const events = buildCpuPropagationEvents(input);
  const extraEvents = extraDeliveries.map(cpuDeliveryEvent);
  const allEvents = [...events, ...extraEvents];
  const allRefs = refs(allEvents);
  const documents = await Promise.all(allRefs.map(ref => transaction.get(ref)));
  for (let index = 0; index < allEvents.length; index += 1) {
    if (!documents[index].exists) transaction.create(allRefs[index], outboxRecord(allEvents[index]));
  }
  return allEvents;
}

function cpuDeliveryEvent(input: CpuDurableDeliveryInput): CpuOutboxEvent {
  return {
    eventId: input.eventId,
    eventType: "cpu.consumer.release",
    sourceAggregateId: input.sourceAggregateId,
    sourceVersion: input.sourceVersion,
    occurredAt: input.occurredAt,
    schemaVersion: "0.1.0",
    payload: { deliveryId: input.eventId, sourceEventId: input.eventId, consumer: input.consumer, route: input.route, body: input.body },
    delivery: { status: "pending", attempts: 0, nextAttemptAt: input.occurredAt, nextEligibleAt: input.occurredAt },
  };
}

export async function enqueueCpuPropagation(input: CpuConsumerInvalidationInput) {
  const events = buildCpuPropagationEvents(input);
  if (!events.length) return events;
  await persistCpuEvents(events);
  return events;
}

export async function enqueueCpuDelivery(input: CpuDurableDeliveryInput) {
  const event = cpuDeliveryEvent(input);
  await persistCpuEvents([event]);
  return event;
}

export function resetCpuOutboxForTests() { memoryOutbox.clear(); memoryEligible.clear(); }
export function seedCpuOutboxForTests(events: CpuPropagationOutboxEvent[]) {
  resetCpuOutboxForTests();
  for (const event of events) { const copy = structuredClone(event); memoryOutbox.set(copy.eventId, copy); trackMemoryEligibility(copy); }
}
export function listCpuOutboxForTests() { return [...memoryOutbox.values()].map(event => structuredClone(event)); }

function routeBase(consumer: CpuPropagationConsumer) {
  const configured = consumer === "delivered-in" ? (process.env.FIKA_APP_DELIVERED_IN_URL || process.env.DELIVERED_IN_BASE_URL) : (process.env.FIKA_LOGISTICS_BASE_URL || process.env.LOGISTICS_BASE_URL);
  if (configured) return configured.replace(/\/$/, "");
  return consumer === "delivered-in" ? "http://localhost:3800" : "http://localhost:3900";
}

async function readOutbox(eventId: string) {
  if (useMemoryOutbox()) return memoryOutbox.get(eventId);
  const snapshot = await db.collection(CPU_PROPAGATION_OUTBOX_COLLECTION).doc(eventId).get();
  return snapshot.exists ? snapshot.data() as CpuOutboxEvent : undefined;
}

async function writeOutbox(event: CpuOutboxEvent, expectedClaimId?: string) {
  if (useMemoryOutbox()) {
    const current = memoryOutbox.get(event.eventId);
    if (!current || !expectedClaimId || current.delivery.claimId === expectedClaimId) { memoryOutbox.set(event.eventId, event); trackMemoryEligibility(event); }
    return;
  }
  await db.runTransaction(async transaction => {
    const ref = db.collection(CPU_PROPAGATION_OUTBOX_COLLECTION).doc(event.eventId);
    const current = await transaction.get(ref);
    if (!current.exists) return;
    const value = current.data() as CpuOutboxEvent;
    if (expectedClaimId && value.delivery.claimId !== expectedClaimId) return;
    transaction.set(ref, outboxRecord(event));
  });
}

export async function claimCpuPropagation(eventId: string, claimId: string, at = new Date()) {
  if (useMemoryOutbox()) {
    const current = memoryOutbox.get(eventId);
    if (!current || !eventIsDue(current, at)) return undefined;
    const claimed = claimEvent(current, claimId, at.toISOString());
    memoryOutbox.set(eventId, claimed);
    trackMemoryEligibility(claimed);
    return claimed;
  }
  return db.runTransaction(async transaction => {
    const ref = db.collection(CPU_PROPAGATION_OUTBOX_COLLECTION).doc(eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const current = snapshot.data() as CpuOutboxEvent;
    if (!eventIsDue(current, at)) return undefined;
    const claimed = claimEvent(current, claimId, at.toISOString());
    transaction.set(ref, outboxRecord(claimed));
    return claimed;
  });
}

export async function deliverCpuPropagation(eventId: string, at = new Date()) {
  const claimId = `cpu-outbox:${eventId}:${Date.now()}`;
  const claimed = await claimCpuPropagation(eventId, claimId, at);
  if (!claimed) return { eventId, status: "blocked" as const };
  const payload = claimed.payload;
  try {
    const response = await fetch(`${routeBase(payload.consumer)}${payload.route}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-fika-internal-token": process.env.FIKA_INTERNAL_API_TOKEN || "" , "x-fika-delivery-id": payload.deliveryId, "x-fika-source-event-id": payload.sourceEventId },
      body: JSON.stringify(payload.body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`${payload.consumer} returned HTTP ${response.status}.`);
    const delivered = markEventDelivered(claimed, new Date().toISOString());
    await writeOutbox(delivered, claimId);
    return { eventId, status: "delivered" as const, attempts: delivered.delivery.attempts + 1 };
  } catch (error) {
    const failed = markEventFailed(claimed, error, new Date().toISOString());
    await writeOutbox(failed, claimId);
    return { eventId, status: failed.delivery.status, attempts: failed.delivery.attempts, error: failed.delivery.lastError };
  }
}

export async function deliverCpuPropagations(events: CpuOutboxEvent[]) {
  return Promise.all(events.map(event => deliverCpuPropagation(event.eventId)));
}

export async function recoverCpuPropagation(limit = CPU_PROPAGATION_OUTBOX_PAGE_SIZE, at = new Date()) {
  const boundedLimit = Math.min(Math.max(1, limit), CPU_PROPAGATION_OUTBOX_PAGE_SIZE);
  if (useMemoryOutbox()) {
    const due = [...memoryEligible.entries()]
      .sort(([leftId, leftAt], [rightId, rightAt]) => leftAt.localeCompare(rightAt) || leftId.localeCompare(rightId))
      .filter(([, eligibleAt]) => new Date(eligibleAt) <= at)
      .slice(0, boundedLimit)
      .map(([eventId]) => memoryOutbox.get(eventId))
      .filter((event): event is CpuOutboxEvent => event !== undefined && eventIsDue(event, at));
    return deliverCpuPropagations(due);
  }
  const snapshot = await db.collection(CPU_PROPAGATION_OUTBOX_COLLECTION)
    .where("nextEligibleAt", "<=", at.toISOString())
    .orderBy("nextEligibleAt")
    .limit(boundedLimit)
    .get();
  return deliverCpuPropagations(snapshot.docs.map(document => document.data() as CpuOutboxEvent).filter(event => event.delivery.status === "pending" || event.delivery.status === "failed"));
}

export async function replayCpuPropagation(eventId: string, at = new Date()) {
  const current = await readOutbox(eventId);
  if (!current) return undefined;
  const replayed = resetEventForReplay(current, at.toISOString(), "operator replay");
  await writeOutbox(replayed);
  return replayed;
}
