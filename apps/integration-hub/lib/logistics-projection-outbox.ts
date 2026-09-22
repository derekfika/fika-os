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
import { notifyLogisticsProjection } from "./logistics-projection-client";

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
  const events = await Promise.all(requirements.map(async requirement => {
    await ensureLogisticsProjectionEvent(requirement);
    return deliverLogisticsProjectionForRequirement(requirement);
  }));
  return {
    serviceDate,
    inspected: requirements.length,
    truncated,
    delivered: events.filter(event => event?.delivery.status === "delivered").length,
    pending: events.filter(event => event?.delivery.status === "pending" || event?.delivery.status === "failed").length,
    events,
  };
}

export async function getLogisticsProjectionOutboxEvent(eventId: string) {
  const snapshot = await outbox().doc(eventId).get();
  return snapshot.exists ? snapshot.data() as LogisticsProjectionOutboxEvent : undefined;
}

export async function deliverLogisticsProjection(eventId: string) {
  const claim = await db.runTransaction(async transaction => {
    const ref = outbox().doc(eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const current = snapshot.data() as LogisticsProjectionOutboxEvent;
    if (current.delivery.status === "delivered" || !eventIsDue(current)) return current;
    const claimed = claimEvent(current, `integration-hub-logistics:${Date.now()}`, new Date().toISOString());
    transaction.set(ref, outboxRecord(claimed));
    return claimed;
  });
  if (!claim || claim.delivery.status === "delivered") return claim;

  try {
    await notifyLogisticsProjection(claim.payload);
    const delivered = markEventDelivered(claim, new Date().toISOString());
    await outbox().doc(eventId).set(outboxRecord(delivered));
    return delivered;
  } catch (error) {
    const failed = markEventFailed(claim, error, new Date().toISOString());
    await outbox().doc(eventId).set(outboxRecord(failed));
    return failed;
  }
}

export async function replayLogisticsProjectionOutbox(limit = 25) {
  const snapshot = await outbox()
    .where("outboxStatus", "in", ["pending", "failed"])
    .limit(Math.min(Math.max(limit, 1), 50))
    .get();
  const events = await Promise.all(snapshot.docs.map(document => deliverLogisticsProjection(document.id)));
  return {
    attempted: events.length,
    delivered: events.filter(event => event?.delivery.status === "delivered").length,
    failed: events.filter(event => event?.delivery.status === "failed" || event?.delivery.status === "dead-letter").length,
    events,
  };
}
