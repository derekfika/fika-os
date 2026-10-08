import { randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { claimEvent, eventIsDue, markEventDelivered, markEventFailed, outboxRecord, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import type { ExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import type { GrabAndGoOrder } from "./grab-and-go";
import { db } from "./firebase-admin";
import { forwardProductionMaterialisation } from "./production-client";

export const GRAB_HANDOFF_COLLECTION = "fikaDeliveredInGrabAndGoHandoffV1";
type HandoffEvent = DurableDomainEvent<ExternalProductionMaterialisation> & { actorId: string };
const events = () => db.collection(GRAB_HANDOFF_COLLECTION);
export const grabHandoffId = (order: Pick<GrabAndGoOrder, "orderId" | "version">) => `production.materialise:${order.orderId}:v${order.version}`;
const eventRef = (id: string) => events().doc(stableDocumentId(id));
function storedEvent(event: HandoffEvent) {
  const record: ReturnType<typeof outboxRecord<HandoffEvent["payload"]>> & { actorId?: string } = outboxRecord(event);
  if (event.delivery.status === "delivered" || event.delivery.status === "dead-letter") delete (record as Partial<typeof record>).nextEligibleAt;
  return record;
}

/** The owned source history and this immutable payload are committed together. */
export function grabHandoffEvent(order: GrabAndGoOrder): HandoffEvent {
  return {
    eventId: grabHandoffId(order), eventType: "production.materialise", sourceAggregateId: order.orderId,
    sourceVersion: order.version, occurredAt: order.updatedAt, correlationId: order.orderId,
    actorId: order.updatedBy, schemaVersion: "0.1.0",
    payload: { sourceDomain: "grab-and-go", sourceEntityId: order.orderId, sourceVersion: order.version,
      destinationOplocId: order.oplocId, destinationLabel: order.oplocId, serviceDate: order.deliveryDate,
      requiredBy: `${order.deliveryDate}T08:00`, status: order.status,
      lines: order.lines.map(line => ({ sourceLineId: `${order.orderId}:line:${line.productId}`, canonicalItemId: line.productId,
        itemName: line.productName, quantity: line.quantity, unit: "item", workstream: "grab_and_go" })) },
    delivery: { status: "pending", attempts: 0, nextEligibleAt: order.updatedAt },
  };
}

export async function stageGrabHandoff(transaction: Transaction, order: GrabAndGoOrder) {
  const event = grabHandoffEvent(order), ref = eventRef(event.eventId);
  const existing = await transaction.get(ref);
  if (existing.exists) throw Object.assign(new Error("This source version already has a production handoff."), { status: 409 });
  transaction.create(ref, storedEvent(event));
}

/** Explicit bounded recovery also supports historical source records without an outbox. */
export async function ensureGrabHandoff(oplocId: string, deliveryDate: string, expectedVersion: number) {
  return db.runTransaction(async transaction => {
    const source = await transaction.get(db.collection("fikaDeliveredInGrabAndGoOrdersV1").doc(stableDocumentId(`grab-and-go:${oplocId}:${deliveryDate}`)));
    if (!source.exists) throw Object.assign(new Error("Grab & Go order not found."), { status: 404 });
    const order = source.data() as GrabAndGoOrder;
    if (order.version !== expectedVersion) throw Object.assign(new Error("The order changed. Refresh before retrying its handoff."), { status: 409 });
    const event = grabHandoffEvent(order), ref = eventRef(event.eventId), existing = await transaction.get(ref);
    if (!existing.exists) transaction.create(ref, storedEvent(event));
    return order;
  });
}

export async function deliverGrabHandoff(eventId: string, at = new Date()) {
  const ref = eventRef(eventId), claimId = `delivered-in:${randomUUID()}`;
  const claim = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const current = snapshot.data() as HandoffEvent;
    if (!eventIsDue(current, at)) return { event: current, claimed: false };
    const next = { ...claimEvent(current, claimId, at.toISOString()), actorId: current.actorId };
    transaction.set(ref, storedEvent(next));
    return { event: next, claimed: true };
  });
  if (!claim?.claimed) return claim?.event.delivery.status === "delivered" ? "delivered" as const : claim?.event.delivery.status === "dead-letter" ? "intervention-required" as const : "pending" as const;
  let next: HandoffEvent;
  try {
    // Pending CPU delivery remains retryable using exactly the same source version.
    await forwardProductionMaterialisation(claim.event.payload);
    next = { ...markEventDelivered(claim.event, new Date().toISOString()), actorId: claim.event.actorId };
  } catch (error) { next = { ...markEventFailed(claim.event, error, new Date().toISOString()), actorId: claim.event.actorId }; }
  const settled = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), current = snapshot.data() as HandoffEvent | undefined;
    if (!current || current.delivery.claimId !== claimId) return current;
    transaction.set(ref, storedEvent(next)); return next;
  });
  return settled?.delivery.status === "delivered" ? "delivered" as const : settled?.delivery.status === "dead-letter" ? "intervention-required" as const : "pending" as const;
}

export async function recoverGrabHandoffs(limit = 25, at = new Date()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw Object.assign(new Error("Recovery limit must be 1–25."), { status: 422 });
  const snapshot = await events()
    .where("outboxStatus", "in", ["pending", "failed"])
    .where("nextEligibleAt", "<=", at.toISOString())
    .orderBy("nextEligibleAt")
    .limit(limit)
    .get();
  const due = snapshot.docs.map(doc => doc.data() as HandoffEvent).filter(event => eventIsDue(event, at));
  const results = await Promise.all(due.map(event => deliverGrabHandoff(event.eventId, at)));
  return { attempted: due.length, delivered: results.filter(result => result === "delivered").length, pending: results.filter(result => result === "pending").length, interventionRequired: results.filter(result => result === "intervention-required").length };
}
