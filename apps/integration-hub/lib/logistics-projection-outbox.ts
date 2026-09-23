import type { Transaction } from "firebase-admin/firestore";
import {
  claimEvent,
  eventIsDue,
  markEventDelivered,
  markEventFailed,
  outboxRecord,
  type DurableDomainEvent,
} from "@fika/server-shared/durable-outbox";
import type { FulfilmentRequirement, ProductionOrderFulfilmentSource } from "../../shared/fulfilment-requirement";
import {
  logisticsProjectionEventId,
  type LogisticsProjectionInvalidation,
} from "../../shared/logistics-projection";
import { db } from "./firebase-admin";
import { notifyLogisticsProjection, notifyLogisticsProjectionBatch } from "./logistics-projection-client";

export type LogisticsProjectionOutboxEvent = DurableDomainEvent<LogisticsProjectionInvalidation>;

const outbox = () => db.collection("fikaLogisticsProjectionOutboxV1");

function eventForRequirement(requirement: FulfilmentRequirement, previous?: FulfilmentRequirement): LogisticsProjectionOutboxEvent {
  const change = logisticsProjectionChangeForRequirement(requirement, previous);
  return {
    eventId: logisticsProjectionEventId({ ...change, destinationOplocId: requirement.destinationOplocId }),
    eventType: "fulfilment.requirement.logistics-invalidation",
    sourceAggregateId: requirement.canonicalId,
    sourceVersion: requirement.sourceVersion,
    occurredAt: change.changedAt,
    schemaVersion: "fika.logistics-projection-invalidation.v1",
    payload: change,
    delivery: { status: "pending", attempts: 0 },
  };
}

export function logisticsProjectionChangeForRequirement(
  requirement: FulfilmentRequirement,
  previous?: FulfilmentRequirement,
): LogisticsProjectionInvalidation {
  return {
    serviceDate: requirement.serviceDate,
    sourceDomain: requirement.sourceDomain,
    sourceEntityId: requirement.sourceEntityId,
    sourceVersion: requirement.sourceVersion,
    ...(requirement.sourceContentHash ? { sourceContentHash: requirement.sourceContentHash } : {}),
    changedAt: requirement.updatedAt,
    changeType: previous
      ? requirement.status === "withdrawn"
        ? "withdrawn"
        : "amended"
      : "created",
  };
}

export function stageLogisticsProjectionEvent(
  transaction: Transaction,
  requirement: FulfilmentRequirement,
  previous?: FulfilmentRequirement,
) {
  const event = eventForRequirement(requirement, previous);
  transaction.set(outbox().doc(event.eventId), outboxRecord(event));
  return event.eventId;
}

/**
 * Creates the deterministic invalidation for a legacy requirement that was
 * committed before the coupled outbox write existed. This is deliberately
 * bounded and idempotent; normal mutations use stageLogisticsProjectionEvent.
 */
export async function ensureLogisticsProjectionEvent(requirement: FulfilmentRequirement) {
  const event = eventForRequirement(requirement);
  return db.runTransaction(async transaction => {
    const ref = outbox().doc(event.eventId);
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return snapshot.data() as LogisticsProjectionOutboxEvent;
    transaction.create(ref, outboxRecord(event));
    return event;
  });
}

export function logisticsProjectionEventIdForProductionOrder(order: ProductionOrderFulfilmentSource) {
  if (order.requiresDelivery === false || !order.serviceDate || !order.destinationOplocId) return undefined;
  const sourceDomain = order.origin === "grab_and_go" ? "grab-and-go" : "cpu-production";
  const sourceEntityId = sourceDomain === "grab-and-go" ? order.sourceEntityId || order.canonicalId : order.canonicalId;
  return logisticsProjectionEventId({
    serviceDate: order.serviceDate,
    sourceDomain,
    sourceEntityId,
    sourceVersion: sourceDomain === "grab-and-go" ? order.sourceVersion || order.version : order.version,
    destinationOplocId: order.destinationOplocId,
  });
}

export async function deliverLogisticsProjectionForProductionOrder(order: ProductionOrderFulfilmentSource) {
  const eventId = logisticsProjectionEventIdForProductionOrder(order);
  return eventId ? deliverLogisticsProjection(eventId) : undefined;
}

export async function deliverLogisticsProjectionForRequirement(requirement: FulfilmentRequirement) {
  return deliverLogisticsProjection(logisticsProjectionEventId({
    serviceDate: requirement.serviceDate,
    sourceDomain: requirement.sourceDomain,
    sourceEntityId: requirement.sourceEntityId,
    sourceVersion: requirement.sourceVersion,
    destinationOplocId: requirement.destinationOplocId,
  }));
}

export async function repairLogisticsProjectionForServiceDate(serviceDate: string, limit = 50) {
  const boundedLimit = Math.min(Math.max(limit, 1), 50);
  const snapshot = await db.collection("fikaFulfilmentRequirementsV1")
    .where("serviceDate", "==", serviceDate)
    .limit(boundedLimit + 1)
    .get();
  const truncated = snapshot.size > boundedLimit;
  const requirements = snapshot.docs.slice(0, boundedLimit).map(document => document.data() as FulfilmentRequirement);
  const eventIds = await Promise.all(requirements.map(async requirement => {
    const event = await ensureLogisticsProjectionEvent(requirement);
    return event.eventId;
  }));
  const events = await deliverLogisticsProjectionBatch(eventIds);
  const responseEvents = events.map(event => event ? outboxRecord(event) : event);
  return {
    serviceDate,
    inspected: requirements.length,
    truncated,
    delivered: events.filter(event => event?.delivery.status === "delivered").length,
    pending: events.filter(event => event?.delivery.status === "pending" || event?.delivery.status === "failed").length,
    events: responseEvents,
  };
}

export async function getLogisticsProjectionOutboxEvent(eventId: string) {
  const snapshot = await outbox().doc(eventId).get();
  return snapshot.exists ? snapshot.data() as LogisticsProjectionOutboxEvent : undefined;
}

export async function deliverLogisticsProjection(eventId: string) {
  const claim = await claimLogisticsProjection(eventId);
  if (!claim || !claim.claimed) return claim?.event ? outboxRecord(claim.event) : undefined;

  try {
    await notifyLogisticsProjection(claim.event.payload);
    const delivered = markEventDelivered(claim.event, new Date().toISOString());
    await outbox().doc(eventId).set(outboxRecord(delivered));
    return outboxRecord(delivered);
  } catch (error) {
    const failed = markEventFailed(claim.event, error, new Date().toISOString());
    await outbox().doc(eventId).set(outboxRecord(failed));
    return outboxRecord(failed);
  }
}

async function claimLogisticsProjection(eventId: string) {
  return db.runTransaction(async transaction => {
    const ref = outbox().doc(eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const current = snapshot.data() as LogisticsProjectionOutboxEvent;
    if (current.delivery.status === "delivered" || !eventIsDue(current)) return { event: current, claimed: false };
    const claimed = claimEvent(current, `integration-hub-logistics:${Date.now()}`, new Date().toISOString());
    transaction.set(ref, outboxRecord(claimed));
    return { event: claimed, claimed: true };
  });
}

/** Deliver a bounded batch with one network call so one service-date repair can reconcile once. */
export async function deliverLogisticsProjectionBatch(eventIds: string[]) {
  const claims = await Promise.all(eventIds.map(eventId => claimLogisticsProjection(eventId)));
  const ready = claims.filter((claim): claim is { event: LogisticsProjectionOutboxEvent; claimed: true } => Boolean(claim?.claimed));
  if (!ready.length) return claims.flatMap(claim => claim?.event ? [outboxRecord(claim.event)] : []);

  try {
    await notifyLogisticsProjectionBatch(ready.map(claim => claim.event.payload));
    const delivered = ready.map(claim => markEventDelivered(claim.event, new Date().toISOString()));
    await Promise.all(delivered.map(event => outbox().doc(event.eventId).set(outboxRecord(event))));
    const deliveredById = new Map(delivered.map(event => [event.eventId, event]));
    return claims.flatMap(claim => claim?.event ? [outboxRecord(deliveredById.get(claim.event.eventId) || claim.event)] : []);
  } catch (error) {
    const failed = ready.map(claim => markEventFailed(claim.event, error, new Date().toISOString()));
    await Promise.all(failed.map(event => outbox().doc(event.eventId).set(outboxRecord(event))));
    const failedById = new Map(failed.map(event => [event.eventId, event]));
    return claims.flatMap(claim => claim?.event ? [outboxRecord(failedById.get(claim.event.eventId) || claim.event)] : []);
  }
}

export async function replayLogisticsProjectionOutbox(limit = 25) {
  const snapshot = await outbox()
    .where("outboxStatus", "in", ["pending", "failed"])
    .limit(Math.min(Math.max(limit, 1), 50))
    .get();
  const events = await deliverLogisticsProjectionBatch(snapshot.docs.map(document => document.id));
  return {
    attempted: events.length,
    delivered: events.filter(event => event?.delivery.status === "delivered").length,
    failed: events.filter(event => event?.delivery.status === "failed" || event?.delivery.status === "dead-letter").length,
    events,
  };
}
