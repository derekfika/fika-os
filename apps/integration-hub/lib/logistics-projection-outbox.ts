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
import { fulfilmentDeliveryContentEqual, type FulfilmentRequirement, type ProductionOrderFulfilmentSource } from "../../shared/fulfilment-requirement";
import {
  logisticsProjectionEventId,
  type LogisticsProjectionInvalidation,
} from "../../shared/logistics-projection";
import { db } from "./firebase-admin";
import { stableDocumentId } from "./canonical-editor";
import { notifyLogisticsProjection, notifyLogisticsProjectionBatch } from "./logistics-projection-client";

export type LogisticsProjectionOutboxEvent = DurableDomainEvent<LogisticsProjectionInvalidation>;

const outbox = () => db.collection("fikaLogisticsProjectionOutboxV1");

/**
 * Requirement revision that distinguishes a later transition at an unchanged
 * sourceVersion (withdrawal, status change, same-version amendment). Undefined
 * for the first revision of a source version, which keeps the original
 * sourceVersion-only identity. Derived from the requirement's own audit
 * history, so it needs no previous state and is stable across retries.
 */
export function logisticsProjectionRequirementRevision(requirement: FulfilmentRequirement) {
  const revisionsAtSourceVersion = requirement.audit.filter(entry => entry.sourceVersion === requirement.sourceVersion).length;
  return revisionsAtSourceVersion > 1 ? requirement.version : undefined;
}

function eventIdForRequirement(requirement: FulfilmentRequirement) {
  return logisticsProjectionEventId({
    serviceDate: requirement.serviceDate,
    sourceDomain: requirement.sourceDomain,
    sourceEntityId: requirement.sourceEntityId,
    sourceVersion: requirement.sourceVersion,
    destinationOplocId: requirement.destinationOplocId,
    requirementRevision: logisticsProjectionRequirementRevision(requirement),
  });
}

function eventForRequirement(requirement: FulfilmentRequirement, previous?: FulfilmentRequirement, identity: "transition" | "source-version" = "transition"): LogisticsProjectionOutboxEvent {
  const change = logisticsProjectionChangeForRequirement(requirement, previous);
  return {
    eventId: identity === "transition" ? eventIdForRequirement(requirement) : logisticsProjectionEventId({ ...change, destinationOplocId: requirement.destinationOplocId }),
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
        : !fulfilmentDeliveryContentEqual(previous, requirement)
          ? "amended"
          : "status-changed"
      : "created",
  };
}

export function stageLogisticsProjectionEvent(
  transaction: Transaction,
  requirement: FulfilmentRequirement,
  previous?: FulfilmentRequirement,
) {
  const event = eventForRequirement(requirement, previous);
  const ref = outbox().doc(event.eventId);
  // A later transition at an unchanged sourceVersion owns a distinct identity
  // and must never replace an existing durable record: create fails closed.
  if (logisticsProjectionRequirementRevision(requirement) !== undefined) transaction.create(ref, outboxRecord(event));
  else transaction.set(ref, outboxRecord(event));
  return event.eventId;
}

/**
 * Creates the deterministic invalidation for a legacy requirement that was
 * committed before the coupled outbox write existed. This is deliberately
 * bounded and idempotent; normal mutations use stageLogisticsProjectionEvent.
 */
export async function ensureLogisticsProjectionEvent(requirement: FulfilmentRequirement) {
  // Legacy repair only fills a missing sourceVersion-level event; it never
  // fabricates a transition identity for already-revised requirements.
  const event = eventForRequirement(requirement, undefined, "source-version");
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
  const delivered = await deliverLogisticsProjection(eventIdForRequirement(requirement));
  if (delivered || logisticsProjectionRequirementRevision(requirement) === undefined) return delivered;
  // Requirements revised before transition identities existed only have the
  // sourceVersion-level event; keep that handoff reachable.
  return deliverLogisticsProjection(eventForRequirement(requirement, undefined, "source-version").eventId);
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

/** Reviewed recovery of one exact dead letter, with immutable atomic evidence. */
export async function resetLogisticsProjectionDeadLetter(input: {
  eventId: string; commandId: string; expectedAttempts: number; expectedDeadLetteredAt: string;
  reason: string; actorId: string;
}) {
  const auditId = stableDocumentId(`${input.eventId}:${input.commandId}`);
  return db.runTransaction(async transaction => {
    const ref = outbox().doc(input.eventId);
    const auditRef = db.collection("fikaLogisticsProjectionReplayAuditV1").doc(auditId);
    const [snapshot, auditSnapshot] = await Promise.all([transaction.get(ref), transaction.get(auditRef)]);
    if (!snapshot.exists) throw Object.assign(new Error("Logistics update not found."), { status: 404 });
    const current = snapshot.data() as LogisticsProjectionOutboxEvent;
    if (auditSnapshot.exists) {
      const prior = auditSnapshot.data() as { actorId: string; eventId: string; reason: string; expectedAttempts: number; expectedDeadLetteredAt: string };
      if (prior.actorId !== input.actorId || prior.eventId !== input.eventId || prior.reason !== input.reason || prior.expectedAttempts !== input.expectedAttempts || prior.expectedDeadLetteredAt !== input.expectedDeadLetteredAt)
        throw Object.assign(new Error("This recovery reference was already used for a different command."), { status: 409 });
      return { event: current, auditId, changed: false };
    }
    if (current.delivery.status !== "dead-letter" || current.delivery.attempts !== input.expectedAttempts || current.delivery.deadLetteredAt !== input.expectedDeadLetteredAt)
      throw Object.assign(new Error("This Logistics update changed. Review its current failure before retrying."), { status: 409 });
    const at = new Date().toISOString();
    const next = resetEventForReplay(current, at, input.reason);
    transaction.create(auditRef, {
      id: auditId, action: "logistics-projection-dead-letter-replayed", at, actorId: input.actorId,
      reason: input.reason, commandId: input.commandId, eventId: current.eventId,
      expectedAttempts: input.expectedAttempts, expectedDeadLetteredAt: input.expectedDeadLetteredAt,
      sourceAggregateId: current.sourceAggregateId, sourceVersion: current.sourceVersion,
      beforeDelivery: current.delivery, afterDelivery: next.delivery,
    });
    transaction.set(ref, outboxRecord(next));
    return { event: next, auditId, changed: true };
  });
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
