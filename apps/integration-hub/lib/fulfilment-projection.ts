import type { Transaction } from "firebase-admin/firestore";
import type { DurableDomainEvent } from "@fika/contracts/domain-events";
import {
  fulfilmentFromGrabAndGoOrder,
  fulfilmentFromProductionOrder,
  type FulfilmentRequirement,
  type GrabAndGoFulfilmentSource,
  type ProductionOrderFulfilmentSource,
  fulfilmentRequirementContentEqual,
  productionOrderRequiresFulfilment,
} from "@fika/contracts/fulfilment-requirement";
import { db } from "./firebase-admin";
import { stableDocumentId } from "./canonical-editor";
import { reconcileFulfilmentRequirements, type ExpectedFulfilmentSource, type FulfilmentReconciliationIssue } from "@fika/contracts/fulfilment-reconciliation";

export const FULFILMENT_CONSUMER = "integration-hub.fulfilment-requirements";
const requirements = () => db.collection("fikaFulfilmentRequirementsV1");
const inbox = () => db.collection("fikaDomainEventInboxV1");

export type FulfilmentQuery = { serviceDate?: string; status?: FulfilmentRequirement["status"]; destinationOplocId?: string; productionLocationId?: string };
export type FulfilmentProjectionResult = { applied: boolean; duplicate: boolean; requirement?: FulfilmentRequirement; error?: string };

function asRequirement(value: unknown): FulfilmentRequirement | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<FulfilmentRequirement>;
  return candidate.entityType === "Fulfilment Requirement" && typeof candidate.canonicalId === "string" ? value as FulfilmentRequirement : undefined;
}

function requirementFromEvent(event: DurableDomainEvent): FulfilmentRequirement {
  const direct = asRequirement(event.payload);
  if (direct) return direct;
  const payload = event.payload as { productionOrder?: ProductionOrderFulfilmentSource };
  if (payload?.productionOrder) return fulfilmentFromProductionOrder(payload.productionOrder, "integration-hub", event.occurredAt);
  throw Object.assign(new Error(`Event ${event.eventId} does not contain a Fulfilment Requirement or Production Order snapshot.`), { status: 422 });
}

export function normaliseFulfilmentEvent(event: DurableDomainEvent): FulfilmentRequirement {
  return requirementFromEvent(event);
}

export function shouldApplyFulfilmentVersion(current: FulfilmentRequirement | undefined, incoming: FulfilmentRequirement) {
  return !current || incoming.sourceVersion > current.sourceVersion;
}

function isNonDeliveryProductionEvent(event: DurableDomainEvent) {
  const productionOrder = (event.payload as { productionOrder?: ProductionOrderFulfilmentSource })?.productionOrder;
  return Boolean(productionOrder && !productionOrderRequiresFulfilment(productionOrder));
}

export async function stageFulfilmentEvent(transaction: Transaction, event: DurableDomainEvent) {
  if (isNonDeliveryProductionEvent(event)) return { applied: false, duplicate: false, skipped: true } as const;
  const receiptRef = inbox().doc(`${FULFILMENT_CONSUMER}:${stableDocumentId(event.eventId)}`);
  const receipt = await transaction.get(receiptRef);
  if (receipt.exists) return { applied: false, duplicate: true } as const;
  let requirement: FulfilmentRequirement;
  try { requirement = requirementFromEvent(event); } catch (error) {
    transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome: "failed", error: error instanceof Error ? error.message : String(error) });
    return { applied: false, duplicate: false, error: error instanceof Error ? error.message : String(error) } as const;
  }
  const requirementRef = requirements().doc(stableDocumentId(requirement.canonicalId));
  const currentSnapshot = await transaction.get(requirementRef);
  const current = currentSnapshot.exists ? currentSnapshot.data() as FulfilmentRequirement : undefined;
  if (current && current.sourceVersion === requirement.sourceVersion) {
    const outcome = fulfilmentRequirementContentEqual(current, requirement) ? "noop" : "conflict";
    transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, requirementId: requirement.canonicalId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome, ...(outcome === "conflict" ? { error: "Same source version contained different Fulfilment content; reconciliation is required." } : {}) });
    return { applied: false, duplicate: false, requirement: current, ...(outcome === "conflict" ? { error: "Same source version contained different Fulfilment content; reconciliation is required." } : {}) } as const;
  }
  if (!shouldApplyFulfilmentVersion(current, requirement)) {
    transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, requirementId: requirement.canonicalId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome: "ignored_stale" });
    return { applied: false, duplicate: false, requirement: current } as const;
  }
  transaction.set(requirementRef, requirement);
  transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, requirementId: requirement.canonicalId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome: "processed" });
  return { applied: true, duplicate: false, requirement } as const;
}

export async function applyFulfilmentEvent(event: DurableDomainEvent): Promise<FulfilmentProjectionResult> {
  if (isNonDeliveryProductionEvent(event)) return { applied: false, duplicate: false };
  return db.runTransaction(async transaction => {
    const receiptRef = inbox().doc(`${FULFILMENT_CONSUMER}:${stableDocumentId(event.eventId)}`);
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) return { applied: false, duplicate: true };
    let requirement: FulfilmentRequirement;
    try { requirement = requirementFromEvent(event); } catch (error) {
      transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome: "failed", error: error instanceof Error ? error.message : String(error) });
      return { applied: false, duplicate: false, error: error instanceof Error ? error.message : String(error) };
    }
    const ref = requirements().doc(stableDocumentId(requirement.canonicalId));
    const currentSnapshot = await transaction.get(ref);
    const current = currentSnapshot.exists ? currentSnapshot.data() as FulfilmentRequirement : undefined;
    if (current && current.sourceVersion === requirement.sourceVersion) {
      const outcome = fulfilmentRequirementContentEqual(current, requirement) ? "noop" : "conflict";
      transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, requirementId: requirement.canonicalId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome, ...(outcome === "conflict" ? { error: "Same source version contained different Fulfilment content; reconciliation is required." } : {}) });
      return { applied: false, duplicate: false, requirement: current, ...(outcome === "conflict" ? { error: "Same source version contained different Fulfilment content; reconciliation is required." } : {}) };
    }
    if (!shouldApplyFulfilmentVersion(current, requirement)) {
      transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, requirementId: requirement.canonicalId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome: "ignored_stale" });
      return { applied: false, duplicate: false, requirement: current };
    }
    transaction.set(ref, requirement);
    transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, requirementId: requirement.canonicalId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome: "processed" });
    return { applied: true, duplicate: false, requirement };
  });
}

export async function listFulfilmentRequirements(query: FulfilmentQuery = {}) {
  const snapshot = await requirements().get();
  return snapshot.docs.map(item => item.data() as FulfilmentRequirement).filter(item =>
    (!query.serviceDate || item.serviceDate === query.serviceDate) &&
    (!query.status || item.status === query.status) &&
    (!query.destinationOplocId || item.destinationOplocId === query.destinationOplocId) &&
    (!query.productionLocationId || item.productionLocationId === query.productionLocationId),
  ).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.destinationOplocId.localeCompare(b.destinationOplocId) || a.canonicalId.localeCompare(b.canonicalId));
}

export async function listFulfilmentReceipts(limit = 500) {
  const snapshot = await inbox().limit(limit).get();
  return snapshot.docs.map(item => item.data());
}

export async function reconcileCentralFulfilment(expected: ExpectedFulfilmentSource[]): Promise<FulfilmentReconciliationIssue[]> {
  const [actual, receipts] = await Promise.all([listFulfilmentRequirements(), listFulfilmentReceipts()]);
  const issues = reconcileFulfilmentRequirements(expected, actual, []);
  for (const requirement of actual) {
    if (!requirement.destinationOplocId?.trim()) issues.push({ kind: "unresolved_destination", requirementId: requirement.canonicalId, sourceEntityId: requirement.sourceEntityId, detail: `Requirement ${requirement.canonicalId} has no canonical destination OPLOC.` });
  }
  for (const source of expected) {
    const requirementId = `fulfilment-requirement:${source.sourceDomain}:${source.sourceEntityId.replace(/[^A-Za-z0-9:_-]+/g, "_")}:${source.destinationOplocId.replace(/[^A-Za-z0-9:_-]+/g, "_")}`;
    const receipt = receipts.find(item => (item.requirementId === requirementId || item.sourceAggregateId === source.sourceEntityId) && Number(item.sourceVersion) >= source.sourceVersion);
    if (!receipt) issues.push({ kind: "receipt_behind", sourceEntityId: source.sourceEntityId, detail: `The Fulfilment consumer has not recorded a receipt for ${source.sourceEntityId} version ${source.sourceVersion}.` });
  }
  return issues;
}
