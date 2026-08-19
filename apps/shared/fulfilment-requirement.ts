import crypto from "node:crypto";

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
type SourceProjection = { sourceDomain: FulfilmentSourceDomain; sourceEntityId: string; sourceVersion: number; sourceContentHash?: string; destinationOplocId: string; destinationLabelSnapshot: string; serviceDate: string; lines: SourceLine[]; status: FulfilmentRequirementStatus; context: SourceContext };

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value);
};

export function sourceContentHash(value: unknown) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }
function safePart(value: string) { return value.replace(/[^A-Za-z0-9:_-]+/g, "_"); }
export function fulfilmentRequirementIdentity(sourceDomain: FulfilmentSourceDomain, sourceEntityId: string, destinationOplocId: string) { return `fulfilment-requirement:${sourceDomain}:${safePart(sourceEntityId)}:${safePart(destinationOplocId)}`; }
function requireDestination(destinationOplocId: string | undefined, label: string) { if (!destinationOplocId?.trim()) throw Object.assign(new Error(`Cannot create a Fulfilment Requirement for ${label} without a canonical destination OPLOC ID.`), { status: 422 }); return destinationOplocId; }
function sourceStatus(status: string) { return ["cancelled", "withdrawn", "superseded", "rejected"].includes(status) ? "withdrawn" as const : "ready_for_planning" as const; }

export type ProductionOrderFulfilmentSource = {
  canonicalId: string;
  version: number;
  schemaVersion?: string;
  productionLocationId?: string;
  destinationOplocId?: string;
  destinationLabel?: string;
  serviceDate?: string;
  requiredBy: string;
  serviceWindow?: { startTime: string; endTime?: string };
  status: string;
  lines: Array<{ canonicalId: string; sourceMenuItemId?: string; sourceOfferingId?: string; itemName: string; customerQuantity: number; customerUnit: string; productionQuantity?: number; productionUnit?: string; sortOrder: number }>;
};

export function fulfilmentFromProductionOrder(order: ProductionOrderFulfilmentSource, by: string, at = new Date().toISOString(), previous?: FulfilmentRequirement) {
  const destinationOplocId = requireDestination(order.destinationOplocId, order.canonicalId);
  const source: SourceProjection = { sourceDomain: "cpu-production", sourceEntityId: order.canonicalId, sourceVersion: order.version, sourceContentHash: sourceContentHash(order), destinationOplocId, destinationLabelSnapshot: order.destinationLabel || destinationOplocId, serviceDate: order.serviceDate || order.requiredBy.slice(0, 10), lines: order.lines.map(line => ({ sourceLineId: line.canonicalId, canonicalItemId: line.sourceMenuItemId || line.sourceOfferingId, displayName: line.itemName, quantity: line.productionQuantity ?? line.customerQuantity, unit: line.productionUnit || line.customerUnit, sortOrder: line.sortOrder })), status: sourceStatus(order.status), context: { at, by, productionLocationId: order.productionLocationId, readyAt: order.requiredBy, requiredDeliveryWindow: order.serviceWindow } };
  return materialiseFulfilmentRequirement(source, previous);
}

export type PublishedMenuDayFulfilmentSource = { publicationDayId: string; sourceDayId: string; version: number; contentHash: string; date: string; status: "published" | "superseded" | "withdrawn"; entries: Array<{ sourceEntryId: string; canonicalDishId?: string; dishName: string; slot: string; allocations: Array<{ destinationId?: string; destinationLabel: string; quantity: number }> }> };

export function fulfilmentFromPublishedMenuDay(day: PublishedMenuDayFulfilmentSource, destinationOplocId: string, previous?: FulfilmentRequirement) {
  const allocations = day.entries.flatMap(entry => entry.allocations.filter(allocation => allocation.destinationId === destinationOplocId).map(allocation => ({ entry, allocation })));
  const firstLabel = allocations[0]?.allocation.destinationLabel || destinationOplocId;
  const source: SourceProjection = { sourceDomain: "menu-planning", sourceEntityId: day.sourceDayId, sourceVersion: day.version, sourceContentHash: day.contentHash, destinationOplocId: requireDestination(destinationOplocId, day.publicationDayId), destinationLabelSnapshot: firstLabel, serviceDate: day.date, lines: allocations.map(({ entry, allocation }, index) => ({ sourceLineId: entry.sourceEntryId, canonicalItemId: entry.canonicalDishId, displayName: entry.dishName, quantity: allocation.quantity, unit: "portion", sortOrder: index })), status: day.status === "withdrawn" ? "withdrawn" : "ready_for_planning", context: { by: "menu-planning-publication" } };
  return materialiseFulfilmentRequirement(source, previous);
}

export type GrabAndGoFulfilmentSource = { orderId: string; oplocId: string; deliveryDate: string; version: number; status: "submitted" | "cancelled"; lines: Array<{ productId: string; productName: string; quantity: number; sortOrder: number }> };

export function fulfilmentFromGrabAndGoOrder(order: GrabAndGoFulfilmentSource, by: string, at = new Date().toISOString(), previous?: FulfilmentRequirement) {
  const source: SourceProjection = { sourceDomain: "grab-and-go", sourceEntityId: order.orderId, sourceVersion: order.version, sourceContentHash: sourceContentHash(order), destinationOplocId: requireDestination(order.oplocId, order.orderId), destinationLabelSnapshot: order.oplocId, serviceDate: order.deliveryDate, lines: order.lines.map(line => ({ sourceLineId: `${order.orderId}:line:${line.productId}`, canonicalItemId: line.productId, displayName: line.productName, quantity: line.quantity, unit: "item", sortOrder: line.sortOrder })), status: order.status === "cancelled" ? "withdrawn" : "ready_for_planning", context: { at, by } };
  return materialiseFulfilmentRequirement(source, previous);
}

export function materialiseFulfilmentRequirement(source: SourceProjection, previous?: FulfilmentRequirement): FulfilmentRequirement {
  const at = source.context.at || new Date().toISOString();
  const identity = fulfilmentRequirementIdentity(source.sourceDomain, source.sourceEntityId, source.destinationOplocId);
  const idempotencyKey = `${source.sourceDomain}:${source.sourceEntityId}:${source.destinationOplocId}:v${source.sourceVersion}:${source.sourceContentHash || sourceContentHash(source.lines)}`;
  const unchanged = previous && previous.sourceVersion === source.sourceVersion && previous.sourceContentHash === source.sourceContentHash && previous.status === source.status && (Boolean(source.sourceContentHash) || stable(previous.lines) === stable(source.lines));
  if (unchanged) return previous;
  const version = previous ? previous.version + 1 : 1;
  const status = previous && source.status !== "withdrawn" ? "amended" as const : source.status;
  return { canonicalId: identity, entityType: "Fulfilment Requirement", schemaVersion: FULFILMENT_REQUIREMENT_SCHEMA_VERSION, version, sourceDomain: source.sourceDomain, sourceEntityId: source.sourceEntityId, sourceVersion: source.sourceVersion, ...(source.sourceContentHash ? { sourceContentHash: source.sourceContentHash } : {}), ...(source.context.productionLocationId ? { productionLocationId: source.context.productionLocationId } : {}), destinationOplocId: source.destinationOplocId, destinationLabelSnapshot: source.destinationLabelSnapshot, serviceDate: source.serviceDate, ...(source.context.readyAt ? { readyAt: source.context.readyAt } : {}), ...(source.context.requiredDeliveryWindow ? { requiredDeliveryWindow: source.context.requiredDeliveryWindow } : {}), lines: source.lines.map((line, index) => ({ canonicalId: `${identity}:line:${index + 1}`, sourceLineId: line.sourceLineId, ...(line.canonicalItemId ? { canonicalItemId: line.canonicalItemId } : {}), displayNameSnapshot: line.displayName, quantity: line.quantity, unit: line.unit, sortOrder: line.sortOrder })), status, createdAt: previous?.createdAt || at, createdBy: previous?.createdBy || source.context.by, updatedAt: at, updatedBy: source.context.by, audit: [...(previous?.audit || []), { action: previous ? (status === "withdrawn" ? "fulfilment-withdrawn" : "fulfilment-amended") : "fulfilment-requirement-created", at, by: source.context.by, sourceVersion: source.sourceVersion, idempotencyKey, ...(status === "withdrawn" ? { reason: "Upstream source was cancelled or withdrawn." } : {}) }], idempotencyKey };
}
