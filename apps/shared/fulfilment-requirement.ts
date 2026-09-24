import crypto from "node:crypto";
import { CPU_SITE_OPLOC_ID } from "./production-location";
import { fulfilmentWorkstream, type FulfilmentWorkstream } from "./fulfilment-workstream";

export const FULFILMENT_REQUIREMENT_SCHEMA_VERSION = "0.1.0";
export type FulfilmentSourceDomain = "cpu-production" | "menu-planning" | "grab-and-go";
export type FulfilmentRequirementStatus = "pending" | "ready_for_planning" | "amended" | "withdrawn";
export type FulfilmentAuditEvent = { action: string; at: string; by: string; sourceVersion: number; idempotencyKey: string; reason?: string };
export type FulfilmentRequirementLine = {
  canonicalId: string;
  sourceLineId: string;
  canonicalItemId?: string;
  displayNameSnapshot: string;
  quantity: number;
  unit: string;
  sortOrder: number;
};
export type FulfilmentRequirement = {
  canonicalId: string;
  entityType: "Fulfilment Requirement";
  schemaVersion: string;
  version: number;
  sourceDomain: FulfilmentSourceDomain;
  sourceEntityId: string;
  sourceVersion: number;
  sourceContentHash?: string;
  /** Explicit upstream classification; optional for pre-classification records. */
  workstream?: FulfilmentWorkstream;
  productionLocationId?: string;
  destinationOplocId: string;
  destinationLabelSnapshot: string;
  serviceDate: string;
  readyAt?: string;
  requiredDeliveryWindow?: { startTime: string; endTime?: string };
  lines: FulfilmentRequirementLine[];
  status: FulfilmentRequirementStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  audit: FulfilmentAuditEvent[];
  idempotencyKey: string;
};

type SourceContext = { at?: string; by: string; productionLocationId?: string; readyAt?: string; requiredDeliveryWindow?: { startTime: string; endTime?: string } };
type SourceLine = { sourceLineId: string; canonicalItemId?: string; displayName: string; quantity: number; unit: string; sortOrder: number };
type SourceProjection = { sourceDomain: FulfilmentSourceDomain; sourceEntityId: string; sourceVersion: number; sourceContentHash?: string; legacySourceContentHash?: string; destinationOplocId: string; destinationLabelSnapshot: string; serviceDate: string; lines: SourceLine[]; status: FulfilmentRequirementStatus; workstream: FulfilmentWorkstream; context: SourceContext };

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value);
};

export function sourceContentHash(value: unknown) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }
function safePart(value: string) { return value.replace(/[^A-Za-z0-9:_-]+/g, "_"); }
export function fulfilmentRequirementIdentity(sourceDomain: FulfilmentSourceDomain, sourceEntityId: string, destinationOplocId: string) { return `fulfilment-requirement:${sourceDomain}:${safePart(sourceEntityId)}:${safePart(destinationOplocId)}`; }
function requireDestination(destinationOplocId: string | undefined, label: string) { if (!destinationOplocId?.trim()) throw Object.assign(new Error(`Cannot create a Fulfilment Requirement for ${label} without a canonical destination OPLOC ID.`), { status: 422 }); return destinationOplocId; }

function productionLineFulfilmentProjection(line: ProductionOrderFulfilmentSource["lines"][number]) {
  return {
    sourceLineId: line.canonicalId,
    canonicalItemId: line.sourceMenuItemId || line.sourceOfferingId,
    displayName: line.itemName,
    quantity: line.productionQuantity ?? line.customerQuantity,
    unit: line.productionUnit || line.customerUnit,
    sortOrder: line.sortOrder,
  };
}

/**
 * Hash only the canonical delivery instruction. Production Orders also carry
 * CPU-local review, audit, allergen and timestamp state; none of that is a
 * Logistics amendment. sourceVersion remains the source revision separately,
 * so a revision with no delivery change can be reconciled without attention.
 */
export function productionOrderFulfilmentContentHash(order: ProductionOrderFulfilmentSource) {
  const sourceDomain = order.origin === "grab_and_go" ? "grab-and-go" : "cpu-production";
  return sourceContentHash({
    sourceDomain,
    sourceEntityId: order.sourceEntityId || order.canonicalId,
    canonicalId: order.canonicalId,
    productionLocationId: order.productionLocationId,
    destinationOplocId: order.destinationOplocId,
    serviceDate: order.serviceDate || order.requiredBy.slice(0, 10),
    requiredBy: order.requiredBy,
    requiredDeliveryWindow: order.serviceWindow,
    status: productionStatusToFulfilmentStatus(order.status, order.supersededBy),
    lines: order.lines.map(productionLineFulfilmentProjection),
  });
}

function sourceDeliveryProjection(source: SourceProjection) {
  return {
    sourceDomain: source.sourceDomain,
    sourceEntityId: source.sourceEntityId,
    productionLocationId: source.context.productionLocationId,
    destinationOplocId: source.destinationOplocId,
    serviceDate: source.serviceDate,
    readyAt: source.context.readyAt,
    requiredDeliveryWindow: source.context.requiredDeliveryWindow,
    lines: source.lines,
  };
}

function requirementDeliveryProjection(requirement: FulfilmentRequirement) {
  return {
    sourceDomain: requirement.sourceDomain,
    sourceEntityId: requirement.sourceEntityId,
    productionLocationId: requirement.productionLocationId,
    destinationOplocId: requirement.destinationOplocId,
    serviceDate: requirement.serviceDate,
    readyAt: requirement.readyAt,
    requiredDeliveryWindow: requirement.requiredDeliveryWindow,
    lines: requirement.lines.map(line => ({
      sourceLineId: line.sourceLineId,
      canonicalItemId: line.canonicalItemId,
      displayName: line.displayNameSnapshot,
      quantity: line.quantity,
      unit: line.unit,
      sortOrder: line.sortOrder,
    })),
  };
}

/** True when the delivery instruction itself is unchanged, ignoring source revision/hash metadata. */
export function fulfilmentDeliveryContentEqual(left: FulfilmentRequirement, right: FulfilmentRequirement) {
  return stable(requirementDeliveryProjection(left)) === stable(requirementDeliveryProjection(right));
}

function sourceDeliveryContentEqual(source: SourceProjection, previous: FulfilmentRequirement) {
  return stable(sourceDeliveryProjection(source)) === stable(requirementDeliveryProjection(previous));
}

function isLegacyReconciliationAmendment(previous: FulfilmentRequirement, source: SourceProjection) {
  const lastAudit = previous.audit[previous.audit.length - 1];
  return previous.status === "amended" &&
    previous.sourceVersion === source.sourceVersion &&
    Boolean(source.legacySourceContentHash && previous.sourceContentHash === source.legacySourceContentHash) &&
    lastAudit?.action === "fulfilment-amended" &&
    lastAudit.by === "integration-hub-reconciliation";
}

export function productionStatusToFulfilmentStatus(status: string, supersededBy?: string): FulfilmentRequirementStatus {
  if (supersededBy || ["cancelled", "withdrawn", "superseded", "rejected"].includes(status)) return "withdrawn";
  if (["accepted", "planning", "planned", "scheduled", "in_production", "partially_complete", "ready", "complete", "menu_available"].includes(status)) return "ready_for_planning";
  if (["amended", "blocked", "needs_clarification", "reconciliation_required", "failed"].includes(status)) return "amended";
  return "pending";
}

/** Delivery-domain applicability is governed by canonical destination, not a mutable flag. */
export function productionOrderRequiresFulfilment(order: { destinationOplocId?: string; requiresDelivery?: boolean }) {
  // A missing destination remains applicable so creation/reconciliation records
  // an explicit unresolved-destination failure instead of silently dropping it.
  return order.destinationOplocId !== CPU_SITE_OPLOC_ID;
}

export function withdrawFulfilmentRequirement(previous: FulfilmentRequirement, by: string, reason: string, at = new Date().toISOString()) {
  if (previous.status === "withdrawn") return previous;
  const idempotencyKey = `${previous.idempotencyKey}:withdrawn:v${previous.version + 1}`;
  return {
    ...previous,
    version: previous.version + 1,
    status: "withdrawn" as const,
    updatedAt: at,
    updatedBy: by,
    idempotencyKey,
    audit: [...previous.audit, { action: "fulfilment-withdrawn", at, by, sourceVersion: previous.sourceVersion, idempotencyKey, reason }],
  };
}

export function materialiseFulfilmentStatus(previous: FulfilmentRequirement | undefined, sourceStatus: FulfilmentRequirementStatus, deliveryContentChanged = true, resetLegacyReconciliationAmendment = false): FulfilmentRequirementStatus {
  if (sourceStatus === "withdrawn") return "withdrawn";
  if (!previous) return sourceStatus;
  if (sourceStatus === "pending") return "pending";
  if (sourceStatus === "ready_for_planning") {
    if (previous.status === "pending" || previous.status === "withdrawn") return "ready_for_planning";
    if (resetLegacyReconciliationAmendment) return "ready_for_planning";
    return deliveryContentChanged ? "amended" : previous.status;
  }
  return previous.status === "pending" || previous.status === "withdrawn" ? "pending" : "amended";
}

export function fulfilmentRequirementContentEqual(left: FulfilmentRequirement, right: FulfilmentRequirement) {
  return left.sourceVersion === right.sourceVersion && left.sourceContentHash === right.sourceContentHash && left.idempotencyKey === right.idempotencyKey;
}

export type ProductionOrderFulfilmentSource = {
  canonicalId: string;
  version: number;
  sourceEntityId?: string;
  sourceVersion?: number;
  origin?: "hospitality_booking" | "cpu_created" | "legacy_import" | "menu_planning" | "grab_and_go";
  schemaVersion?: string;
  productionLocationId?: string;
  requiresDelivery?: boolean;
  destinationOplocId?: string;
  destinationLabel?: string;
  serviceDate?: string;
  requiredBy: string;
  serviceWindow?: { startTime: string; endTime?: string };
  productionCategory?: string;
  status: string;
  supersededBy?: string;
  lines: Array<{ canonicalId: string; sourceMenuItemId?: string; sourceOfferingId?: string; itemName: string; customerQuantity: number; customerUnit: string; productionQuantity?: number; productionUnit?: string; sortOrder: number }>;
};

export function fulfilmentFromProductionOrder(order: ProductionOrderFulfilmentSource, by: string, at = new Date().toISOString(), previous?: FulfilmentRequirement) {
  const destinationOplocId = requireDestination(order.destinationOplocId, order.canonicalId);
  const isGrabAndGo = order.origin === "grab_and_go";
  const source: SourceProjection = { sourceDomain: isGrabAndGo ? "grab-and-go" : "cpu-production", sourceEntityId: isGrabAndGo ? (order.sourceEntityId || order.canonicalId) : order.canonicalId, sourceVersion: isGrabAndGo ? (order.sourceVersion || order.version) : order.version, sourceContentHash: isGrabAndGo ? sourceContentHash(order) : productionOrderFulfilmentContentHash(order), ...(isGrabAndGo ? {} : { legacySourceContentHash: sourceContentHash(order) }), destinationOplocId, destinationLabelSnapshot: order.destinationLabel || destinationOplocId, serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), lines: order.lines.map(line => ({ sourceLineId: line.canonicalId, canonicalItemId: line.sourceMenuItemId || line.sourceOfferingId, displayName: line.itemName, quantity: line.productionQuantity ?? line.customerQuantity, unit: line.productionUnit || line.customerUnit, sortOrder: line.sortOrder })), status: isGrabAndGo ? (order.status === "cancelled" || order.status === "withdrawn" ? "withdrawn" : "ready_for_planning") : productionStatusToFulfilmentStatus(order.status, order.supersededBy), workstream: fulfilmentWorkstream({ sourceDomain: isGrabAndGo ? "grab-and-go" : "cpu-production", origin: order.origin, productionCategory: order.productionCategory }), context: { at, by, productionLocationId: isGrabAndGo ? undefined : order.productionLocationId, readyAt: isGrabAndGo ? undefined : order.requiredBy, requiredDeliveryWindow: isGrabAndGo ? undefined : order.serviceWindow } };
  return materialiseFulfilmentRequirement(source, previous);
}

export type PublishedMenuDayFulfilmentSource = { publicationDayId: string; sourceDayId: string; version: number; contentHash: string; date: string; status: "published" | "superseded" | "withdrawn"; entries: Array<{ sourceEntryId: string; canonicalDishId?: string; dishName: string; slot: string; allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }> }> };

export function fulfilmentFromPublishedMenuDay(day: PublishedMenuDayFulfilmentSource, destinationOplocId: string, previous?: FulfilmentRequirement) {
  const allocations = day.entries.flatMap(entry => entry.allocations.filter(allocation => allocation.destinationId === destinationOplocId).map(allocation => ({ entry, allocation })));
  const firstLabel = allocations[0]?.allocation.destinationLabel || destinationOplocId;
  const source: SourceProjection = { sourceDomain: "menu-planning", sourceEntityId: day.sourceDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, destinationOplocId: requireDestination(destinationOplocId, day.publicationDayId), destinationLabelSnapshot: firstLabel, serviceDate: day.date, lines: allocations.map(({ entry, allocation }, index) => ({ sourceLineId: entry.sourceEntryId, canonicalItemId: entry.canonicalDishId, displayName: entry.dishName, quantity: allocation.quantity, unit: "portion", sortOrder: index })), status: day.status === "withdrawn" ? "withdrawn" : "ready_for_planning", workstream: "Delivered-In", context: { by: "menu-planning-publication" } };
  return materialiseFulfilmentRequirement(source, previous);
}

export type GrabAndGoFulfilmentSource = { orderId: string; oplocId: string; deliveryDate: string; version: number; status: "submitted" | "cancelled"; lines: Array<{ productId: string; productName: string; quantity: number; sortOrder: number }> };

export function fulfilmentFromGrabAndGoOrder(order: GrabAndGoFulfilmentSource, by: string, at = new Date().toISOString(), previous?: FulfilmentRequirement) {
  const source: SourceProjection = { sourceDomain: "grab-and-go", sourceEntityId: order.orderId, sourceVersion: order.version, sourceContentHash: sourceContentHash(order), destinationOplocId: requireDestination(order.oplocId, order.orderId), destinationLabelSnapshot: order.oplocId, serviceDate: order.deliveryDate, lines: order.lines.map(line => ({ sourceLineId: `${order.orderId}:line:${line.productId}`, canonicalItemId: line.productId, displayName: line.productName, quantity: line.quantity, unit: "item", sortOrder: line.sortOrder })), status: order.status === "cancelled" ? "withdrawn" : "ready_for_planning", workstream: "Grab & Go", context: { at, by } };
  return materialiseFulfilmentRequirement(source, previous);
}

export function materialiseFulfilmentRequirement(source: SourceProjection, previous?: FulfilmentRequirement): FulfilmentRequirement {
  const at = source.context.at || new Date().toISOString();
  const identity = fulfilmentRequirementIdentity(source.sourceDomain, source.sourceEntityId, source.destinationOplocId);
  const idempotencyKey = `${source.sourceDomain}:${source.sourceEntityId}:${source.destinationOplocId}:v${source.sourceVersion}:${source.sourceContentHash || sourceContentHash(source.lines)}`;
  const deliveryContentChanged = previous ? !sourceDeliveryContentEqual(source, previous) : false;
  const resetLegacyReconciliationAmendment = Boolean(previous && isLegacyReconciliationAmendment(previous, source));
  const status = materialiseFulfilmentStatus(previous, source.status, deliveryContentChanged, resetLegacyReconciliationAmendment);
  const materialisationEqual = previous && previous.sourceVersion === source.sourceVersion && previous.sourceContentHash === source.sourceContentHash && previous.status === status && (previous.workstream || fulfilmentWorkstream({ sourceDomain: previous.sourceDomain })) === source.workstream && stable({ destinationLabelSnapshot: previous.destinationLabelSnapshot, delivery: requirementDeliveryProjection(previous) }) === stable({ destinationLabelSnapshot: source.destinationLabelSnapshot, delivery: sourceDeliveryProjection(source) });
  if (previous && materialisationEqual) return previous;
  const version = previous ? previous.version + 1 : 1;
  const deliveryChanged = Boolean(previous && deliveryContentChanged);
  const auditAction = !previous ? "fulfilment-requirement-created" : status === "withdrawn" ? "fulfilment-withdrawn" : deliveryChanged || (status === "amended" && previous.status !== "amended") ? "fulfilment-amended" : "fulfilment-reconciled";
  return { canonicalId: identity, entityType: "Fulfilment Requirement", schemaVersion: FULFILMENT_REQUIREMENT_SCHEMA_VERSION, version, sourceDomain: source.sourceDomain, sourceEntityId: source.sourceEntityId, sourceVersion: source.sourceVersion, workstream: source.workstream, ...(source.sourceContentHash ? { sourceContentHash: source.sourceContentHash } : {}), ...(source.context.productionLocationId ? { productionLocationId: source.context.productionLocationId } : {}), destinationOplocId: source.destinationOplocId, destinationLabelSnapshot: source.destinationLabelSnapshot, serviceDate: source.serviceDate, ...(source.context.readyAt ? { readyAt: source.context.readyAt } : {}), ...(source.context.requiredDeliveryWindow ? { requiredDeliveryWindow: source.context.requiredDeliveryWindow } : {}), lines: source.lines.map((line, index) => ({ canonicalId: `${identity}:line:${index + 1}`, sourceLineId: line.sourceLineId, ...(line.canonicalItemId ? { canonicalItemId: line.canonicalItemId } : {}), displayNameSnapshot: line.displayName, quantity: line.quantity, unit: line.unit, sortOrder: line.sortOrder })), status, createdAt: previous?.createdAt || at, createdBy: previous?.createdBy || source.context.by, updatedAt: at, updatedBy: source.context.by, audit: [...(previous?.audit || []), { action: auditAction, at, by: source.context.by, sourceVersion: source.sourceVersion, idempotencyKey, ...(status === "withdrawn" ? { reason: "Upstream source was cancelled or withdrawn." } : auditAction === "fulfilment-reconciled" ? { reason: "Canonical fulfilment projection reconciled without changing delivery instructions." } : {}) }], idempotencyKey };
}
