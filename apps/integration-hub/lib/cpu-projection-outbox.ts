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
import { db } from "./firebase-admin";
import {
  cpuProjectionChangeTypeForOrder,
  cpuProjectionHandoffFor,
  postCpuProjectionHandoff,
  type CpuProjectionChangeType,
  type CpuProjectionHandoff,
} from "./cpu-projection-client";
import type { ProductionOrder } from "./production-domain";

/**
 * Durable Hub -> CPU projection handoff.
 *
 * Every canonical Production Order version that the CPU projection must learn about owns ONE outbox record, keyed by the
 * canonical order identity + canonical version (`cpu-projection:<canonicalId>:v<version>`). The record is staged in the same
 * transaction as the order write wherever the Hub writes the order itself, so a committed canonical change can never exist
 * without its pending obligation. Delivery retries (existing durable-outbox conventions: 30 s retry, lease, dead-letter after
 * 10 attempts) until the CPU acknowledges; the scheduled outbox tick drains whatever an in-request attempt did not deliver.
 *
 * A handoff that is not acknowledged is reported as `pending`, never as delivered.
 */

type OrderLike = Pick<ProductionOrder, "canonicalId" | "version" | "serviceDate" | "updatedAt" | "createdAt" | "status">;
export type CpuProjectionOutboxEvent = DurableDomainEvent<CpuProjectionHandoff>;
export const CPU_PROJECTION_OUTBOX_EVENT_TYPE = "production.order.cpu-projection-handoff";
const outbox = () => db.collection("fikaCpuProjectionOutboxV1");

export function cpuProjectionOutboxEvent(order: OrderLike, changeType: CpuProjectionChangeType = cpuProjectionChangeTypeForOrder(order)): CpuProjectionOutboxEvent | undefined {
  const handoff = cpuProjectionHandoffFor(order, changeType);
  if (!handoff) return undefined; // an order with no service date has no CPU day/week to refresh
  return {
    eventId: handoff.idempotencyKey,
    eventType: CPU_PROJECTION_OUTBOX_EVENT_TYPE,
    sourceAggregateId: order.canonicalId,
    sourceVersion: order.version,
    occurredAt: handoff.changedAt,
    schemaVersion: "fika.cpu-projection-handoff.v1",
    payload: handoff,
    delivery: { status: "pending", attempts: 0 },
  };
}

/** Stage the obligation in the order's own transaction (writes only - safe after the transaction's reads). */
export function stageCpuProjectionEvent(transaction: Transaction, order: OrderLike, changeType?: CpuProjectionChangeType) {
  const event = cpuProjectionOutboxEvent(order, changeType);
  if (!event) return undefined;
  transaction.set(outbox().doc(event.eventId), outboxRecord(event));
  return event.eventId;
}

/**
 * Idempotent get-or-create for writers that do not own the order's transaction, and for replays of an already-materialised
 * canonical version (heals a handoff that predates the durable outbox). Never resets an existing record's delivery state.
 */
export async function ensureCpuProjectionEvent(order: OrderLike, changeType?: CpuProjectionChangeType) {
  const event = cpuProjectionOutboxEvent(order, changeType);
  if (!event) return undefined;
  return db.runTransaction(async transaction => {
    const ref = outbox().doc(event.eventId);
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return snapshot.data() as CpuProjectionOutboxEvent;
    transaction.create(ref, outboxRecord(event));
    return event;
  });
}

async function claim(eventId: string, at = new Date()) {
  return db.runTransaction(async transaction => {
    const ref = outbox().doc(eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const current = snapshot.data() as CpuProjectionOutboxEvent;
    if (current.delivery.status === "delivered" || !eventIsDue(current, at)) return { event: current, claimed: false as const };
    const claimed = claimEvent(current, `integration-hub-cpu-projection:${Date.now()}`, at.toISOString());
    transaction.set(ref, outboxRecord(claimed));
    return { event: claimed, claimed: true as const };
  });
}

/** One delivery attempt. Success requires the CPU's explicit acknowledgement; anything else records a failed attempt. */
export async function deliverCpuProjection(eventId: string, post: (handoff: CpuProjectionHandoff) => Promise<unknown> = postCpuProjectionHandoff) {
  const claimed = await claim(eventId);
  if (!claimed) return undefined;
  if (!claimed.claimed) return outboxRecord(claimed.event);
  try {
    await post(claimed.event.payload);
    const delivered = markEventDelivered(claimed.event, new Date().toISOString());
    await outbox().doc(eventId).set(outboxRecord(delivered));
    return outboxRecord(delivered);
  } catch (error) {
    const failed = markEventFailed(claimed.event, error, new Date().toISOString());
    await outbox().doc(eventId).set(outboxRecord(failed));
    return outboxRecord(failed);
  }
}

export type CpuHandoffResult = {
  /** `delivered` only after the CPU acknowledged; `pending` while the durable obligation is retrying or dead-lettered. */
  state: "delivered" | "pending" | "skipped";
  eventId?: string;
  deliveryStatus?: CpuProjectionOutboxEvent["delivery"]["status"];
  attempts?: number;
  lastError?: string;
};

export function cpuHandoffResult(event: { eventId: string; delivery: CpuProjectionOutboxEvent["delivery"] } | undefined): CpuHandoffResult {
  if (!event) return { state: "skipped" };
  const { status, attempts, lastError } = event.delivery;
  return { state: status === "delivered" ? "delivered" : "pending", eventId: event.eventId, deliveryStatus: status, attempts, ...(status === "delivered" || !lastError ? {} : { lastError }) };
}

/** Ensure the obligation exists for this canonical order version and make one delivery attempt now. */
export async function deliverCpuProjectionForOrder(order: OrderLike, changeType?: CpuProjectionChangeType, post?: (handoff: CpuProjectionHandoff) => Promise<unknown>): Promise<CpuHandoffResult> {
  const event = await ensureCpuProjectionEvent(order, changeType);
  if (!event) return { state: "skipped" };
  try { return cpuHandoffResult(await deliverCpuProjection(event.eventId, post) || event); }
  catch (error) { return { state: "pending", eventId: event.eventId, lastError: error instanceof Error ? error.message : "CPU projection handoff failed." }; }
}

/** Scheduled drain: bounded batch of pending/failed handoffs that are due. */
export async function replayCpuProjectionOutbox(limit = 25, post?: (handoff: CpuProjectionHandoff) => Promise<unknown>) {
  const snapshot = await outbox().where("outboxStatus", "in", ["pending", "failed"]).limit(Math.min(Math.max(limit, 1), 50)).get();
  const events: CpuProjectionOutboxEvent[] = [];
  for (const document of snapshot.docs) {
    const event = await deliverCpuProjection(document.id, post);
    if (event) events.push(event as CpuProjectionOutboxEvent);
  }
  return {
    attempted: events.length,
    delivered: events.filter(event => event.delivery.status === "delivered").length,
    failed: events.filter(event => event.delivery.status === "failed" || event.delivery.status === "dead-letter").length,
    events: events.map(event => ({ eventId: event.eventId, status: event.delivery.status, attempts: event.delivery.attempts, ...(event.delivery.lastError ? { lastError: event.delivery.lastError } : {}) })),
  };
}

/** Visibility for operators: how many handoffs are outstanding and how old the oldest is. */
export async function summariseCpuProjectionOutbox() {
  const read = async (status: string) => (await outbox().where("outboxStatus", "==", status).limit(200).get()).docs.map(document => document.data() as CpuProjectionOutboxEvent);
  const [pending, failed, deadLetter] = await Promise.all([read("pending"), read("failed"), read("dead-letter")]);
  const outstanding = [...pending, ...failed, ...deadLetter].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return {
    pending: pending.length, failed: failed.length, deadLetter: deadLetter.length,
    ...(outstanding[0] ? { oldestOutstandingAt: outstanding[0].occurredAt, oldestOutstandingEventId: outstanding[0].eventId } : {}),
    outstanding: outstanding.slice(0, 20).map(event => ({ eventId: event.eventId, status: event.delivery.status, attempts: event.delivery.attempts, ...(event.delivery.lastError ? { lastError: event.delivery.lastError } : {}) })),
  };
}

/** Reviewed recovery of one dead-lettered handoff, with immutable audit evidence. */
export async function resetCpuProjectionDeadLetter(input: { eventId: string; reason: string; actorId: string }) {
  const at = new Date().toISOString();
  return db.runTransaction(async transaction => {
    const ref = outbox().doc(input.eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw Object.assign(new Error("CPU projection handoff not found."), { status: 404 });
    const current = snapshot.data() as CpuProjectionOutboxEvent;
    if (current.delivery.status !== "dead-letter") throw Object.assign(new Error("Only a dead-lettered CPU projection handoff can be reset."), { status: 409 });
    const next = resetEventForReplay(current, at, input.reason);
    transaction.create(db.collection("fikaCpuProjectionReplayAuditV1").doc(`${Date.now()}-${input.eventId.length}-${Math.abs(hash(input.eventId + input.reason))}`), { action: "cpu-projection-dead-letter-replayed", at, actorId: input.actorId, reason: input.reason, eventId: input.eventId, beforeDelivery: current.delivery, afterDelivery: next.delivery });
    transaction.set(ref, outboxRecord(next));
    return next;
  });
}

function hash(value: string) { let h = 0; for (let index = 0; index < value.length; index += 1) h = (h * 31 + value.charCodeAt(index)) | 0; return h; }
