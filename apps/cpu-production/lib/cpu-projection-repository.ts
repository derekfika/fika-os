import { db } from "./firebase-admin";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import type { ProductionPlan } from "../app/lib/production-plan";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { canonicalJson, sha256 } from "@fika/server-shared/read-package";
import { stageCpuPropagation, type CpuConsumerInvalidationInput, type CpuDurableDeliveryInput } from "./cpu-durable-outbox";
export const cpuPlans = () => db.collection("fikaCpuProductionPlansV1");
export const cpuChanges = () => db.collection("fikaCpuProductionChangesV1");
export const cpuCursor = () => db.collection("fikaCpuProductionChangeCursorV1");
export const cpuProjections = () => db.collection("fikaCpuProductionDayProjectionsV1");
export const cpuProjectionPackageHeads = () => db.collection("fikaCpuProjectionPackageHeadsV1");
export const cpuChangeReceipts = () => db.collection("fikaCpuProductionChangeReceiptsV1");
export async function loadPlansForOrders(orderIds: string[]) {
  const wanted = [...new Set(orderIds)];
  if (!wanted.length) return [] as ProductionPlan[];
  const snapshots = await Promise.all(wanted.map(orderId => cpuPlans().doc(orderId).get()));
  recordDataAccess({ app: "cpu-production", operation: "production-plans.by-order-ids", source: "FIRESTORE", dataset: "fikaProductionPlans", documents: snapshots.filter(snapshot => snapshot.exists).length, estimatedBillableReads: snapshots.length, firestoreReadKind: "document" });
  return snapshots.flatMap(snapshot => snapshot.exists ? [snapshot.data() as ProductionPlan] : []);
}
export type CpuChangeWithPropagation = {
  propagation?: CpuConsumerInvalidationInput;
  deliveries?: CpuDurableDeliveryInput[];
  idempotencyKey?: string;
};

export async function appendCpuChangeInTransaction<T extends CpuChangeWithPropagation & Record<string, unknown>>(transaction: Transaction, input: T) {
  const { propagation, deliveries, ...eventInput } = input;
  const idempotencyKey = typeof eventInput.idempotencyKey === "string" ? eventInput.idempotencyKey : undefined;
  const receiptRef = idempotencyKey ? cpuChangeReceipts().doc(idempotencyKey.replace(/[^A-Za-z0-9:_-]+/g, "_")) : undefined;
  const receipt = receiptRef ? await transaction.get(receiptRef) : undefined;
  if (receiptRef) recordDataAccess({ app: "cpu-production", operation: "change-receipt.transaction-read", source: "FIRESTORE", documents: receipt?.exists ? 1 : 0, firestoreReadKind: "transaction" });
  if (receipt?.exists) {
    const existing = receipt.data()?.event as Omit<T, "propagation"> & { sequence: number };
    if (propagation) await stageCpuPropagation(transaction, { ...propagation, eventId: propagation.eventId || `cpu-change:${propagation.sourceEntityId}:v${existing.sequence}`, sourceVersion: existing.sequence }, deliveries);
    return existing;
  }
  const cursorRef = cpuCursor().doc("global");
  const current = await transaction.get(cursorRef);
  recordDataAccess({ app: "cpu-production", operation: "change-cursor.transaction-read", source: "FIRESTORE", documents: current.exists ? 1 : 0, firestoreReadKind: "transaction" });
  const sequence = Number(current.data()?.sequence || 0) + 1;
  const event = { ...eventInput, sequence } as Omit<T, "propagation"> & { sequence: number };
  if (propagation) await stageCpuPropagation(transaction, { ...propagation, eventId: propagation.eventId || `cpu-change:${propagation.sourceEntityId}:v${sequence}`, sourceVersion: sequence }, deliveries);
  transaction.set(cursorRef, { sequence });
  transaction.create(cpuChanges().doc(String(sequence).padStart(20, "0")), event);
  if (receiptRef) transaction.create(receiptRef, { idempotencyKey, event });
  return event;
}

type ProjectionRecord = {
  lastChangeSequence?: unknown;
  projectionContentHash?: unknown;
  revision?: unknown;
  rebuiltAt?: unknown;
  generatedAt?: unknown;
  [key: string]: unknown;
};

export type MonotonicProjectionWrite<T extends ProjectionRecord> = {
  status: "created" | "advanced" | "idempotent" | "superseded";
  projection: T;
};

function withoutProjectionMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutProjectionMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !["revision", "rebuiltAt", "generatedAt", "projectionContentHash"].includes(key))
    .map(([key, item]) => [key, withoutProjectionMetadata(item)]));
}

export function cpuProjectionContentHash(projection: ProjectionRecord) {
  return sha256(canonicalJson(withoutProjectionMetadata(projection)));
}

export function compareMonotonicProjectionWrite(current: ProjectionRecord | undefined, incoming: ProjectionRecord) {
  if (!current) return { status: "created" as const };
  const currentSequence = Number(current.lastChangeSequence || 0);
  const incomingSequence = Number(incoming.lastChangeSequence || 0);
  if (incomingSequence < currentSequence) return { status: "superseded" as const };
  if (incomingSequence > currentSequence) return { status: "advanced" as const };
  const currentHash = typeof current.projectionContentHash === "string" ? current.projectionContentHash : cpuProjectionContentHash(current);
  const incomingHash = typeof incoming.projectionContentHash === "string" ? incoming.projectionContentHash : cpuProjectionContentHash(incoming);
  if (currentHash !== incomingHash) {
    const error = Object.assign(new Error(`CPU projection sequence ${incomingSequence} has conflicting content.`), { code: "CPU_PROJECTION_SEQUENCE_CONFLICT", status: 409 });
    throw error;
  }
  return { status: "idempotent" as const };
}

/**
 * Compare-and-write a derived projection against the authoritative CPU change
 * sequence.  The transaction is the ordering authority; process-local
 * rebuild coalescing is only an optimisation and is not part of correctness.
 */
export async function writeCpuProjectionMonotonically<T extends ProjectionRecord>(ref: DocumentReference, incoming: T): Promise<MonotonicProjectionWrite<T>> {
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    recordDataAccess({ app: "cpu-production", operation: "projection.monotonic-head-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
    const current = snapshot.exists ? snapshot.data() as ProjectionRecord : undefined;
    const decision = compareMonotonicProjectionWrite(current, incoming);
    if (decision.status === "superseded" || decision.status === "idempotent") return { status: decision.status, projection: current as T };
    const projection = {
      ...incoming,
      projectionContentHash: typeof incoming.projectionContentHash === "string" ? incoming.projectionContentHash : cpuProjectionContentHash(incoming),
      revision: Number(current?.revision || 0) + 1,
    } as T;
    transaction.set(ref, projection);
    recordDataAccess({ app: "cpu-production", operation: "projection.monotonic-write", source: "FIRESTORE", documents: 1, estimatedFirestoreWrites: 1 });
    return { status: decision.status, projection };
  });
}

export async function appendCpuChange<T extends CpuChangeWithPropagation & Record<string, unknown>>(input: T) {
  return db.runTransaction(async transaction => appendCpuChangeInTransaction(transaction, input));
}
