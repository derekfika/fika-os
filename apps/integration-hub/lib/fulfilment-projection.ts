import type { Query, Transaction } from "firebase-admin/firestore";
import type { DurableDomainEvent } from "../../shared/domain-events";
import {
  fulfilmentFromGrabAndGoOrder,
  fulfilmentFromProductionOrder,
  type FulfilmentRequirement,
  type GrabAndGoFulfilmentSource,
  type ProductionOrderFulfilmentSource,
  fulfilmentRequirementContentEqual,
  productionOrderRequiresFulfilment,
  withdrawFulfilmentRequirement,
} from "../../shared/fulfilment-requirement";
import { CPU_SITE_OPLOC_ID } from "../../shared/production-location";
import { db } from "./firebase-admin";
import { stableDocumentId } from "./canonical-editor";
import { reconcileFulfilmentRequirements, type ExpectedFulfilmentSource, type FulfilmentReconciliationIssue } from "../../shared/fulfilment-reconciliation";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { stageLogisticsProjectionEvent } from "./logistics-projection-outbox";
import type { ProductionOrder } from "./production-domain";

export const FULFILMENT_CONSUMER = "integration-hub.fulfilment-requirements";
const requirements = () => db.collection("fikaFulfilmentRequirementsV1");
const inbox = () => db.collection("fikaDomainEventInboxV1");
const productionOrders = () => db.collection("fikaProductionOrdersV1");
const PRODUCTION_FULFILMENT_READ_LIMIT = 500;

export type FulfilmentQuery = { serviceDate?: string; serviceDateFrom?: string; serviceDateToExclusive?: string; status?: FulfilmentRequirement["status"]; destinationOplocId?: string; productionLocationId?: string };
export type FulfilmentProjectionResult = { applied: boolean; duplicate: boolean; requirement?: FulfilmentRequirement; error?: string };
const FULFILMENT_READ_LIMIT = 500;

export type ProductionFulfilmentReconciliationResult = {
  serviceDate: string;
  productionOrders: number;
  fikaXExcluded: number;
  expectedFulfilmentRequirements: number;
  actualProductionFulfilmentRequirements: number;
  missingRequirements: string[];
  staleRequirements: string[];
  unexpectedRequirements: string[];
  terminalProductionOrders: string[];
  missingDestinationProductionOrders: string[];
  created: number;
  updated: number;
  withdrawn: number;
  unchanged: number;
  withdrawnRequirements: number;
};

function productionSource(order: ProductionOrder): ProductionOrderFulfilmentSource {
  return {
    ...order,
    sourceEntityId: order.origin === "grab_and_go" ? order.sourceEntityId || order.canonicalId : order.canonicalId,
  };
}

function terminalProductionOrder(order: ProductionOrder) {
  return Boolean(order.supersededBy) || ["cancelled", "withdrawn", "superseded", "rejected"].includes(order.status);
}

/**
 * Repairs the upstream Production Order -> Fulfilment projection for one
 * bounded service date. It never writes to Logistics directly: every actual
 * requirement mutation stages the existing durable Logistics outbox event.
 */
export async function reconcileProductionFulfilmentForServiceDate(serviceDate: string, limit = PRODUCTION_FULFILMENT_READ_LIMIT): Promise<ProductionFulfilmentReconciliationResult> {
  const boundedLimit = Math.min(Math.max(limit, 1), PRODUCTION_FULFILMENT_READ_LIMIT);
  const [productionSnapshot, actual] = await Promise.all([
    productionOrders().where("serviceDate", "==", serviceDate).limit(boundedLimit + 1).get(),
    listFulfilmentRequirements({ serviceDate }),
  ]);
  if (productionSnapshot.size > boundedLimit) throw Object.assign(new Error("Production Order scope exceeds the bounded reconciliation limit; narrow the service date."), { status: 503, code: "PRODUCTION_ORDER_READ_LIMIT" });
  recordDataAccess({ app: "integration-hub", operation: "production.fulfilment.reconciliation", source: "FIRESTORE", dataset: "fikaProductionOrdersV1", documents: productionSnapshot.size, estimatedBillableReads: productionSnapshot.size, firestoreReadKind: "query" });
  const orders = productionSnapshot.docs.map(document => document.data() as ProductionOrder);
  const actualById = new Map(actual.map(requirement => [requirement.canonicalId, requirement]));
  const activeActual = actual.filter(requirement => (requirement.sourceDomain === "cpu-production" || requirement.sourceDomain === "grab-and-go") && requirement.status !== "withdrawn");
  const activeBySourceEntity = new Map<string, FulfilmentRequirement>();
  for (const requirement of activeActual) {
    const previous = activeBySourceEntity.get(requirement.sourceEntityId);
    if (!previous || requirement.version > previous.version) activeBySourceEntity.set(requirement.sourceEntityId, requirement);
  }
  const missingDestinationProductionOrders: string[] = [];
  const terminalProductionOrders: string[] = [];
  const expected = new Map<string, { order: ProductionOrder; source: ProductionOrderFulfilmentSource; requirement: FulfilmentRequirement }>();
  const localProductionOrders = new Set<string>();
  const currentProductionOrders = orders.filter(order => {
    if (order.destinationOplocId === CPU_SITE_OPLOC_ID) { localProductionOrders.add(order.canonicalId); return false; }
    if (!order.destinationOplocId) { missingDestinationProductionOrders.push(order.canonicalId); return false; }
    if (terminalProductionOrder(order)) { terminalProductionOrders.push(order.canonicalId); return false; }
    return true;
  });
  const now = new Date().toISOString();
  for (const order of currentProductionOrders) {
    const source = productionSource(order);
    const identity = fulfilmentFromProductionOrder(source, "integration-hub-reconciliation", now).canonicalId;
    // A destination/service-date change changes the requirement identity. Carry
    // the prior source requirement into the new identity so the replacement is
    // an explicit amendment, then withdraw the old requirement below.
    const previous = actualById.get(identity) || activeBySourceEntity.get(source.sourceEntityId || source.canonicalId);
    const requirement = fulfilmentFromProductionOrder(source, "integration-hub-reconciliation", now, previous);
    expected.set(requirement.canonicalId, { order, source, requirement });
  }

  const expectedIds = new Set(expected.keys());
  const missingRequirements = [...expected.keys()].filter(id => {
    const current = actualById.get(id);
    return !current || current.status === "withdrawn";
  });
  const staleRequirements = [...expected.values()].filter(item => {
    const current = actualById.get(item.requirement.canonicalId);
    return Boolean(current && current !== item.requirement);
  }).map(item => item.requirement.canonicalId);
  const unexpectedRequirements = activeActual.map(item => item.canonicalId).filter(id => !expectedIds.has(id));
  let created = 0;
  let updated = 0;
  let withdrawn = 0;
  let unchanged = 0;

  const mutate = async (input: { order?: ProductionOrder; source?: ProductionOrderFulfilmentSource; requirementId: string; withdrawalReason?: string }) => db.runTransaction(async transaction => {
    const ref = requirements().doc(stableDocumentId(input.requirementId));
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() as FulfilmentRequirement : undefined;
    const changedAt = new Date().toISOString();
    if (input.withdrawalReason) {
      if (!previous || previous.status === "withdrawn") return "unchanged" as const;
      const next = withdrawFulfilmentRequirement(previous, "integration-hub-reconciliation", input.withdrawalReason, changedAt);
      transaction.set(ref, next);
      stageLogisticsProjectionEvent(transaction, next, previous);
      return "withdrawn" as const;
    }
    if (!input.source) throw new Error("A Production Order source is required for an active Fulfilment mutation.");
    const next = fulfilmentFromProductionOrder(input.source, "integration-hub-reconciliation", changedAt, previous);
    if (previous && next === previous) return "unchanged" as const;
    transaction.set(ref, next);
    stageLogisticsProjectionEvent(transaction, next, previous);
    return previous ? "updated" as const : "created" as const;
  });

  for (const item of expected.values()) {
    const action = await mutate({ order: item.order, source: item.source, requirementId: item.requirement.canonicalId });
    if (action === "created") created++;
    else if (action === "updated") updated++;
    else unchanged++;
  }
  for (const order of orders.filter(item => item.destinationOplocId === CPU_SITE_OPLOC_ID || terminalProductionOrder(item))) {
    const source = order.destinationOplocId ? productionSource(order) : undefined;
    const requirementId = source ? fulfilmentFromProductionOrder(source, "integration-hub-reconciliation", now).canonicalId : undefined;
    if (!requirementId) continue;
    const action = await mutate({ requirementId, withdrawalReason: order.destinationOplocId === CPU_SITE_OPLOC_ID ? "Production is fulfilled locally at FIKA Xchange and is not a Logistics delivery." : "The source Production Order is terminal or superseded." });
    if (action === "withdrawn") withdrawn++;
    else unchanged++;
  }
  const knownCurrentSourceIds = new Set(currentProductionOrders.map(order => order.canonicalId));
  for (const requirement of activeActual.filter(item => !expectedIds.has(item.canonicalId) && knownCurrentSourceIds.has(item.sourceEntityId))) {
    const action = await mutate({ requirementId: requirement.canonicalId, withdrawalReason: "The current Production Order fulfilment projection replaced this stale destination or service-date requirement." });
    if (action === "withdrawn") withdrawn++;
    else unchanged++;
  }
  const withdrawnRequirements = actual.filter(requirement => (requirement.sourceDomain === "cpu-production" || requirement.sourceDomain === "grab-and-go") && requirement.status === "withdrawn").length + withdrawn;
  return {
    serviceDate,
    productionOrders: orders.length,
    fikaXExcluded: localProductionOrders.size,
    expectedFulfilmentRequirements: expected.size,
    actualProductionFulfilmentRequirements: activeActual.length,
    missingRequirements,
    staleRequirements,
    unexpectedRequirements,
    terminalProductionOrders,
    missingDestinationProductionOrders,
    created,
    updated,
    withdrawn,
    unchanged,
    withdrawnRequirements,
  };
}

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
  stageLogisticsProjectionEvent(transaction, requirement, current);
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
    stageLogisticsProjectionEvent(transaction, requirement, current);
    transaction.create(receiptRef, { consumerName: FULFILMENT_CONSUMER, eventId: event.eventId, sourceAggregateId: event.sourceAggregateId, requirementId: requirement.canonicalId, sourceVersion: event.sourceVersion, processedAt: new Date().toISOString(), outcome: "processed" });
    return { applied: true, duplicate: false, requirement };
  });
}

/**
 * Normal consumers must provide at least one indexed scope. The only caller
 * allowed to inspect the complete projection is the explicit admin
 * reconciliation path below; keeping that escape hatch named makes accidental
 * full-collection reads on Logistics/dashboard paths hard to introduce.
 */
export async function listFulfilmentRequirements(query: FulfilmentQuery = {}, options: { allowUnbounded?: boolean } = {}) {
  const bounded = Boolean(query.serviceDate || query.serviceDateFrom || query.serviceDateToExclusive || query.status || query.destinationOplocId || query.productionLocationId);
  if (!bounded && !options.allowUnbounded) throw Object.assign(new Error("A service date, status or OPLOC scope is required for a Fulfilment Requirement read."), { status: 400, code: "FULFILMENT_QUERY_SCOPE_REQUIRED" });
  let scoped: Query = requirements();
  if (query.serviceDate) scoped = scoped.where("serviceDate", "==", query.serviceDate);
  if (query.serviceDateFrom) scoped = scoped.where("serviceDate", ">=", query.serviceDateFrom);
  if (query.serviceDateToExclusive) scoped = scoped.where("serviceDate", "<", query.serviceDateToExclusive);
  if (query.status) scoped = scoped.where("status", "==", query.status);
  if (query.destinationOplocId) scoped = scoped.where("destinationOplocId", "==", query.destinationOplocId);
  if (query.productionLocationId) scoped = scoped.where("productionLocationId", "==", query.productionLocationId);
  if (bounded) scoped = scoped.limit(FULFILMENT_READ_LIMIT + 1);
  const snapshot = await scoped.get();
  if (bounded && snapshot.size > FULFILMENT_READ_LIMIT) throw Object.assign(new Error("Fulfilment Requirement scope exceeds the bounded read limit; narrow the service date or OPLOC."), { status: 503, code: "FULFILMENT_READ_LIMIT" });
  recordDataAccess({ app: "integration-hub", operation: bounded ? "fulfilment.requirements.bounded" : "fulfilment.requirements.reconciliation", source: "FIRESTORE", dataset: "fikaFulfilmentRequirementsV1", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
  return snapshot.docs.map(item => item.data() as FulfilmentRequirement).filter(item =>
    (!query.serviceDate || item.serviceDate === query.serviceDate) &&
    (!query.serviceDateFrom || item.serviceDate >= query.serviceDateFrom) &&
    (!query.serviceDateToExclusive || item.serviceDate < query.serviceDateToExclusive) &&
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
  const [actual, receipts] = await Promise.all([listFulfilmentRequirements({}, { allowUnbounded: true }), listFulfilmentReceipts()]);
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
