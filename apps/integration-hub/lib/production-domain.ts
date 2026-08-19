import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { stableDocumentId } from "./canonical-editor";
import { createDomainEvent } from "../../shared/domain-events";
import { stageDomainEvent } from "./domain-event-outbox";
import { stageFulfilmentEvent } from "./fulfilment-projection";

export const PRODUCTION_SCHEMA_VERSION = "0.1.0";
export type ProductionStatus = "received" | "draft" | "needs_review" | "accepted" | "planning" | "planned" | "amended" | "menu_available" | "rejected" | "needs_clarification" | "scheduled" | "in_production" | "partially_complete" | "ready" | "complete" | "cancelled" | "blocked" | "failed" | "reconciliation_required";
export type ProductionException = { canonicalId: string; severity: "info" | "warning" | "blocking"; status: "open" | "resolved"; description: string; createdAt: string; createdBy: string; resolvedAt?: string; resolvedBy?: string; resolutionNotes?: string; audit: ProductionAuditEvent[] };
export type ProductionAuditEvent = { action: string; at: string; by: string; previousState?: string; newState?: string; reason?: string; correlationId?: string; causationId?: string; idempotencyKey?: string };
export type ProductionLine = { canonicalId: string; sourceBookingLineId: string; sourceMenuItemId?: string; sourceOfferingId?: string; itemName: string; description?: string; customerQuantity: number; customerUnit: string; productionQuantity?: number; productionUnit?: string; actualQuantity?: number; shortfallQuantity?: number; substitution?: string; wasteQuantity?: number; conversionSnapshot?: { quantity: number; unit: string; rule: string }; choices?: unknown[]; servingGuidance?: string; productionInstructions?: string; dietaries: Record<string, unknown>; allergenEvidenceStatus?: "confirmed" | "unreviewed" | "missing" | "conflicting"; status: "pending" | "ready" | "complete" | "exception"; sortOrder: number; exceptions?: string[] };
export type ProductionRequirement = { canonicalId: string; entityType: "Production Requirement"; schemaVersion: string; version: number; sourceBookingId: string; sourceBookingRevision: number; sourceQuoteRevisionId: string; productionLocationId?: string; requestedServiceDate: string; serviceWindow: { startTime: string; endTime?: string }; requiredBy: string; status: "draft" | "needs_review" | "accepted" | "cancelled"; sourceSnapshot: { booking: CanonicalBooking; quote: unknown }; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; audit: ProductionAuditEvent[] };
export type ProductionOrigin = "hospitality_booking" | "cpu_created" | "legacy_import";
export type ProductionOrder = { canonicalId: string; entityType: "Production Order"; schemaVersion: string; version: number; requirementIds: string[]; sourceBookingId: string; sourceQuoteRevisionId: string; productionLocationId?: string; destinationOplocId?: string; destinationLabel?: string; clientName?: string; serviceType?: string; serviceDate?: string; guestCount?: number; requiredBy: string; serviceWindow: { startTime: string; endTime?: string }; status: ProductionStatus; /** Local planning projection, kept separate from the governed Production lifecycle. */ workflowStatus?: ProductionStatus; priority: "normal" | "high" | "urgent"; lines: ProductionLine[]; exceptions: ProductionException[]; operationalNotes?: string; origin: ProductionOrigin; currentRevision: number; createdAt: string; createdBy: string; acceptedAt?: string; startedAt?: string; completedAt?: string; supersededBy?: string; idempotencyKey: string; externalReferences: string[]; audit: ProductionAuditEvent[] };

const requirements = () => db.collection("fikaProductionRequirements");
const orders = () => db.collection("fikaProductionOrdersV1");
const bookings = () => db.collection("fikaBookings");

function isPreparationConversionException(exception: ProductionException) {
  return exception.description.startsWith("No explicit production conversion is configured") || exception.description.startsWith("Production quantity is still required");
}

function withoutAutomaticQuantityBlockers(order: ProductionOrder): ProductionOrder {
  const exceptions = order.exceptions.filter(exception => !isPreparationConversionException(exception));
  const lines = order.lines.map(line => line.status === "exception" && line.productionQuantity === undefined ? { ...line, status: "pending" as const } : line);
  const status = order.status === "needs_review" && exceptions.length === 0 ? "draft" as const : order.status;
  return { ...order, lines, exceptions, status };
}

/** Explicit, reviewed production rules. These are configuration, not inference from names. */
const explicitMnkConversions: Record<string, { multiplier: number; unit: string; rule: string }> = {
  deli_sandwich_lunch: { multiplier: 3, unit: "piece", rule: "MNK catalogue serving rule: three pieces per person." },
};

export function productionRequirementId(bookingId: string, quoteRevisionId: string) { return `production-requirement:${bookingId}:${quoteRevisionId}`; }
export function productionOrderV1Id(bookingId: string, bookingVersion?: number) { return `production-order:v1:${bookingId}${bookingVersion && bookingVersion > 1 ? `:r${bookingVersion}` : ""}`; }

export async function createProductionFromApprovedBooking(actor: Actor, bookingId: string, idempotencyKey: string, conversions: Record<string, { quantity: number; unit: string }> = {}) {
  if (!idempotencyKey.trim()) throw conflict("An idempotency key is required for production hand-off.");
  return db.runTransaction(async transaction => {
    const bookingSnapshot = await transaction.get(bookings().doc(bookingId));
    if (!bookingSnapshot.exists) throw conflict("Booking was not found.");
    const booking = bookingSnapshot.data() as CanonicalBooking;
    if (booking.lifecycleStatus !== "Approved") throw conflict("Only an approved Booking can create production work.");
    const quote = booking.quoteState?.revisions.find(item => item.id === booking.quoteState?.currentRevisionId);
    if (!quote || quote.stale || quote.id !== booking.quoteState?.currentRevisionId) throw conflict("A current approved Quote Revision is required.");
    const baseOrderRef = orders().doc(stableDocumentId(productionOrderV1Id(bookingId)));
    const baseOrderSnapshot = await transaction.get(baseOrderRef);
    const existingBase = baseOrderSnapshot.exists ? baseOrderSnapshot.data() as ProductionOrder : undefined;
    const orderId = existingBase?.status === "amended"
      ? productionOrderV1Id(bookingId, booking.version)
      : productionOrderV1Id(bookingId);
    const orderRef = orders().doc(stableDocumentId(orderId));
    const existing = orderId === productionOrderV1Id(bookingId) ? baseOrderSnapshot : await transaction.get(orderRef);
    if (existing.exists && (existing.data() as ProductionOrder).status !== "amended") return { created: false, status: "already_exists" as const, requirement: undefined, order: existing.data() as ProductionOrder };
    const now = new Date().toISOString();
    const requirementId = productionRequirementId(bookingId, quote.id);
    const requirement: ProductionRequirement = { canonicalId: requirementId, entityType: "Production Requirement", schemaVersion: PRODUCTION_SCHEMA_VERSION, version: 1, sourceBookingId: bookingId, sourceBookingRevision: booking.version, sourceQuoteRevisionId: quote.id, productionLocationId: booking.service.oplocId, requestedServiceDate: booking.service.eventDate, serviceWindow: { startTime: booking.service.startTime, ...(booking.service.endTime ? { endTime: booking.service.endTime } : {}) }, requiredBy: `${booking.service.eventDate}T${booking.service.startTime}`, status: "needs_review", sourceSnapshot: { booking: structuredClone(booking), quote: structuredClone(quote.snapshot) }, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, audit: [{ action: "production-requirement-created", at: now, by: actor.uid, newState: "needs_review", reason: "Created from approved Booking and current Quote Revision.", idempotencyKey }] };
    const exceptions: ProductionException[] = [];
    const lines: ProductionLine[] = booking.order.items.map((item, index) => {
      const configured = conversions[item.itemId];
      const explicitRule = explicitMnkConversions[item.itemId] || Object.entries(explicitMnkConversions).find(([key]) => item.itemId.endsWith(`:${key}`))?.[1];
      const conversion = configured ? { quantity: configured.quantity, unit: configured.unit, rule: "Explicit production conversion configuration." } : explicitRule ? { quantity: item.quantity * explicitRule.multiplier, unit: explicitRule.unit, rule: explicitRule.rule } : undefined;
      const line: ProductionLine = { canonicalId: `production-line:${bookingId}:${index + 1}`, sourceBookingLineId: `${bookingId}:line:${index + 1}`, ...(item.menuItemId ? { sourceMenuItemId: item.menuItemId } : {}), itemName: item.itemName || item.itemId, ...(item.description ? { description: item.description } : {}), customerQuantity: item.quantity, customerUnit: item.servingInfo || "ordered unit", ...(conversion ? { productionQuantity: conversion.quantity, productionUnit: conversion.unit, conversionSnapshot: { ...conversion, rule: "Explicit configured production conversion." } } : {}), ...(item.choices ? { choices: structuredClone(item.choices) } : {}), ...(item.servingInfo ? { servingGuidance: item.servingInfo } : {}), dietaries: structuredClone(booking.dietaries), status: conversion ? "ready" : "exception", sortOrder: index };
      return { ...line, status: conversion ? "ready" : "pending" };
    });
    const status: ProductionStatus = exceptions.length ? "needs_review" : "draft";
    const order: ProductionOrder = { canonicalId: orderId, entityType: "Production Order", schemaVersion: PRODUCTION_SCHEMA_VERSION, version: 1, requirementIds: [requirementId], sourceBookingId: bookingId, sourceQuoteRevisionId: quote.id, productionLocationId: process.env.CPU_PRODUCTION_LOCATION_ID, ...(booking.service.oplocId ? { destinationOplocId: booking.service.oplocId } : {}), destinationLabel: booking.service.portalSiteLabel || booking.service.roomOrArea || booking.service.deliveryPoint, clientName: booking.client.companyName, ...(booking.order.eventType ? { serviceType: booking.order.eventType } : {}), serviceDate: booking.service.eventDate, guestCount: booking.service.guestCount, requiredBy: requirement.requiredBy, serviceWindow: requirement.serviceWindow, status, priority: "normal", lines, exceptions, origin: "hospitality_booking", currentRevision: 1, createdAt: now, createdBy: actor.uid, idempotencyKey, externalReferences: [], audit: [{ action: "production-order-created", at: now, by: actor.uid, newState: status, reason: existingBase?.status === "amended" ? "Replacement Production Order created for the amended Booking and current Quote Revision." : "Internal Production Order created without external CPU or Calendar side effects.", idempotencyKey }] };
    const event = createDomainEvent({ eventType: "production.order.created", sourceAggregateId: order.canonicalId, sourceVersion: order.version, occurredAt: now, correlationId: idempotencyKey, payload: { canonicalId: order.canonicalId, version: order.version, status: order.status, sourceBookingId: order.sourceBookingId, serviceDate: order.serviceDate, productionLocationId: order.productionLocationId, destinationOplocId: order.destinationOplocId, destinationLabel: order.destinationLabel, lineIds: order.lines.map(line => line.canonicalId), productionOrder: order } });
    await stageFulfilmentEvent(transaction, event);
    if (existingBase?.status === "amended") transaction.set(baseOrderRef, { supersededBy: orderId }, { merge: true });
    transaction.create(requirements().doc(stableDocumentId(requirementId)), requirement);
    transaction.create(orderRef, order);
    stageDomainEvent(transaction, event);
    return { created: true, status: "created" as const, requirement, order };
  });
}

/**
 * Older hand-offs were written before the CPU projection included the human
 * client and destination labels. Enrich those read models from their source
 * Booking without rewriting the immutable Production Order. This also keeps
 * future dashboard providers consistent: every Booking contributes the same
 * client and service-location projection.
 */
async function enrichOrder(order: ProductionOrder): Promise<ProductionOrder> {
  if (!order.sourceBookingId.startsWith("booking:")) return order;
  const snapshot = await bookings().doc(order.sourceBookingId).get();
  if (!snapshot.exists) return order;
  const booking = snapshot.data() as CanonicalBooking;
  // Older hand-offs did not persist the canonical Menu Item reference on
  // each Production Line. Recover it from the immutable Booking line at the
  // same source position so dashboard routing can be applied without
  // changing the stored order or guessing from display names.
  const bookingItems = (booking.order?.items || []) as Array<{
    menuItemId?: string;
    itemId?: string;
  }>;
  const linesWithSourceIdentity = order.lines.map((line, index) => {
    const match = line.sourceBookingLineId.match(/:line:(\d+)$/);
    const sourceIndex = match ? Number(match[1]) - 1 : index;
    const source = bookingItems[sourceIndex];
    if (!source) return line;
    return {
      ...line,
      ...(line.sourceMenuItemId || !source.menuItemId
        ? {}
        : { sourceMenuItemId: source.menuItemId }),
      ...(line.sourceOfferingId || !source.itemId
        ? {}
        : { sourceOfferingId: source.itemId }),
    };
  });
  const hasLineDietaries = order.lines.every(line => Object.keys(line.dietaries || {}).length > 0);
  return {
    ...order,
    lines: linesWithSourceIdentity,
    ...(order.clientName ? {} : { clientName: booking.client?.companyName || booking.client?.name }),
    ...(order.destinationLabel ? {} : { destinationLabel: booking.service?.portalSiteLabel || booking.service?.roomOrArea || booking.service?.deliveryPoint }),
    ...(order.serviceDate ? {} : { serviceDate: booking.service?.eventDate }),
    ...(order.guestCount !== undefined ? {} : { guestCount: booking.service?.guestCount }),
    ...(order.serviceType ? {} : (booking.order?.eventType ? { serviceType: booking.order.eventType } : {})),
    // Older hand-offs did not copy booking-level dietary evidence to their
    // lines. Enrich only missing line evidence; never overwrite a chef's
    // existing line-level review state.
    ...(hasLineDietaries ? {} : { lines: linesWithSourceIdentity.map(line => Object.keys(line.dietaries || {}).length ? line : { ...line, dietaries: structuredClone(booking.dietaries || {}) }) }),
  };
}

export async function latestProductionOrderForBooking(bookingId: string) {
  const snapshot = await orders().where("sourceBookingId", "==", bookingId).get();
  const candidates = snapshot.docs
    .map(item => item.data() as ProductionOrder)
    .filter(order => !order.supersededBy)
    .sort((a, b) => (b.version - a.version) || b.createdAt.localeCompare(a.createdAt));
  const order = candidates[0];
  return order ? enrichOrder(withoutAutomaticQuantityBlockers(order)) : undefined;
}

export async function productionQueue() {
  const snapshot = await orders().orderBy("requiredBy", "asc").get();
  return Promise.all(
    snapshot.docs
      .map(item => item.data() as ProductionOrder)
      .filter(order => !order.supersededBy)
      .map(order => enrichOrder(withoutAutomaticQuantityBlockers(order))),
  );
}
export async function productionOrderDetail(canonicalId: string) { const snapshot = await orders().doc(stableDocumentId(canonicalId)).get(); return snapshot.exists ? enrichOrder(withoutAutomaticQuantityBlockers(snapshot.data() as ProductionOrder)) : undefined; }

export type CpuCreatedProductionInput = { clientName: string; serviceDate: string; deliveryDateTime: string; requiredBy: string; serviceWindow: { startTime: string; endTime?: string }; productionLocationId?: string; destinationOplocId?: string; deliveryLocation: string; floorRoom?: string; contact?: string; serviceType: string; pax: number; lines: Array<{ itemName: string; customerQuantity: number; customerUnit: string; productionQuantity?: number; productionUnit?: string; dietary?: Record<string, unknown>; notes?: string }>; priority?: "normal" | "high" | "urgent"; sourceReference?: string; notes?: string };
export async function createCpuProductionOrder(actor: Actor, input: CpuCreatedProductionInput, idempotencyKey: string) {
  if (!idempotencyKey.trim()) throw conflict("An idempotency key is required.");
  return db.runTransaction(async transaction => {
    const canonicalId = `production-order:v1:cpu:${crypto.randomUUID()}`;
    const ref = orders().doc(stableDocumentId(idempotencyKey)); const existing = await transaction.get(ref); if (existing.exists) return { created: false, status: "already_exists" as const, order: existing.data() as ProductionOrder };
    const now = new Date().toISOString(); const exceptions: ProductionException[] = []; const lines: ProductionLine[] = input.lines.map((line, index) => { const complete = typeof line.productionQuantity === "number" && Boolean(line.productionUnit); return { canonicalId: `${canonicalId}:line:${index + 1}`, sourceBookingLineId: `${canonicalId}:source:${index + 1}`, itemName: line.itemName, customerQuantity: line.customerQuantity, customerUnit: line.customerUnit, ...(complete ? { productionQuantity: line.productionQuantity, productionUnit: line.productionUnit, conversionSnapshot: { quantity: line.productionQuantity!, unit: line.productionUnit!, rule: "Explicit CPU entry." } } : {}), dietaries: line.dietary || {}, status: complete ? "ready" as const : "pending" as const, sortOrder: index, ...(line.notes ? { productionInstructions: line.notes } : {}) }; });
    const order: ProductionOrder = { canonicalId, entityType: "Production Order", schemaVersion: PRODUCTION_SCHEMA_VERSION, version: 1, requirementIds: [], sourceBookingId: input.sourceReference || canonicalId, sourceQuoteRevisionId: "", productionLocationId: input.productionLocationId, ...(input.destinationOplocId ? { destinationOplocId: input.destinationOplocId } : {}), destinationLabel: input.deliveryLocation, clientName: input.clientName, serviceType: input.serviceType, serviceDate: input.serviceDate, guestCount: input.pax, requiredBy: input.requiredBy, serviceWindow: input.serviceWindow, status: exceptions.length ? "needs_review" : "draft", priority: input.priority || "normal", lines, exceptions, operationalNotes: `${input.clientName} · ${input.serviceType} · ${input.deliveryLocation}${input.floorRoom ? ` · ${input.floorRoom}` : ""}${input.contact ? ` · ${input.contact}` : ""}${input.notes ? ` · ${input.notes}` : ""}`, origin: "cpu_created", currentRevision: 1, createdAt: now, createdBy: actor.uid, idempotencyKey, externalReferences: [], audit: [{ action: "cpu-production-order-created", at: now, by: actor.uid, newState: exceptions.length ? "needs_review" : "draft", reason: "Created by authorised CPU user; no external side effects.", idempotencyKey }] };
    const event = createDomainEvent({ eventType: "production.order.created", sourceAggregateId: order.canonicalId, sourceVersion: order.version, occurredAt: now, correlationId: idempotencyKey, payload: { canonicalId: order.canonicalId, version: order.version, status: order.status, sourceBookingId: order.sourceBookingId, serviceDate: order.serviceDate, productionLocationId: order.productionLocationId, destinationOplocId: order.destinationOplocId, destinationLabel: order.destinationLabel, lineIds: order.lines.map(line => line.canonicalId), productionOrder: order } });
    await stageFulfilmentEvent(transaction, event);
    transaction.create(ref, order);
    stageDomainEvent(transaction, event);
    return { created: true, status: "created" as const, order };
  });
}

export async function transitionProductionOrder(actor: Actor, canonicalId: string, expectedVersion: number, status: ProductionStatus, reason: string) {
  const allowed: Record<ProductionStatus, ProductionStatus[]> = { received: ["accepted", "rejected", "needs_clarification", "cancelled"], draft: ["needs_review", "cancelled"], needs_review: ["accepted", "rejected", "needs_clarification", "blocked", "cancelled"], accepted: ["planning", "scheduled", "in_production", "cancelled", "blocked"], planning: ["planned", "amended", "cancelled"], planned: ["menu_available", "amended", "cancelled"], amended: ["planning", "cancelled"], menu_available: [], rejected: [], needs_clarification: ["accepted", "rejected", "cancelled"], scheduled: ["in_production", "cancelled", "blocked"], in_production: ["partially_complete", "ready", "complete", "cancelled", "failed", "reconciliation_required"], partially_complete: ["in_production", "ready", "complete", "failed", "reconciliation_required"], ready: ["complete", "in_production", "reconciliation_required"], complete: [], cancelled: [], blocked: ["needs_review", "cancelled"], failed: ["needs_review", "reconciliation_required"], reconciliation_required: ["needs_review", "cancelled"] };
  return db.runTransaction(async transaction => {
    const ref = orders().doc(stableDocumentId(canonicalId));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw conflict("Production Order was not found.");
    const current = snapshot.data() as ProductionOrder;
    if (current.version !== expectedVersion) throw conflict("Production Order changed elsewhere. Refresh and try again.");
    if (!allowed[current.status].includes(status)) throw conflict(`Cannot move Production Order from ${current.status} to ${status}.`);
    if (status === "complete") {
      const incomplete = current.lines.find(line => line.actualQuantity === undefined || line.actualQuantity < 0 || (line.shortfallQuantity && line.shortfallQuantity > 0 && !line.productionInstructions?.trim()) || (line.substitution !== undefined && !line.substitution.trim()) || line.allergenEvidenceStatus === "missing" || line.allergenEvidenceStatus === "conflicting");
      if (incomplete) throw conflict(`Cannot complete production until ${incomplete.itemName} has actual quantity, shortfall/substitution notes and resolved allergen evidence.`);
      if (current.exceptions.some(exception => exception.status === "open" && exception.severity === "blocking")) throw conflict("Resolve blocking production exceptions before completing this order.");
    }
    const now = new Date().toISOString();
    const next = { ...current, version: current.version + 1, status, updatedAt: now, ...(status === "accepted" ? { acceptedAt: now } : {}), ...(status === "in_production" ? { startedAt: now } : {}), ...(status === "complete" ? { completedAt: now } : {}), audit: [...current.audit, { action: "production-status-changed", at: now, by: actor.uid, previousState: current.status, newState: status, reason }] };
    const event = createDomainEvent({ eventType: status === "cancelled" ? "production.order.withdrawn" : "production.order.amended", sourceAggregateId: next.canonicalId, sourceVersion: next.version, occurredAt: now, payload: { canonicalId: next.canonicalId, version: next.version, status: next.status, reason, sourceBookingId: next.sourceBookingId, serviceDate: next.serviceDate, productionLocationId: next.productionLocationId, destinationOplocId: next.destinationOplocId, destinationLabel: next.destinationLabel, lineIds: next.lines.map(line => line.canonicalId), productionOrder: next } });
    await stageFulfilmentEvent(transaction, event);
    transaction.set(ref, next);
    stageDomainEvent(transaction, event);
    return next;
  });
}

export async function updateProductionLines(actor: Actor, canonicalId: string, expectedVersion: number, lines: Array<{ canonicalId: string; productionQuantity?: number; productionUnit?: string; actualQuantity?: number; shortfallQuantity?: number; substitution?: string; wasteQuantity?: number; productionInstructions?: string; dietaries: Record<string, unknown>; allergenEvidenceStatus?: ProductionLine["allergenEvidenceStatus"] }>) {
  return db.runTransaction(async transaction => {
    const ref = orders().doc(stableDocumentId(canonicalId));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw conflict("Production Order was not found.");
    const current = snapshot.data() as ProductionOrder;
    if (current.version !== expectedVersion) throw conflict("Production Order changed elsewhere. Refresh and try again.");
    const now = new Date().toISOString();
    const updates = new Map(lines.map(line => [line.canonicalId, line]));
    const nextLines = current.lines.map(line => {
      const update = updates.get(line.canonicalId);
      if (!update) return line;
      const complete = typeof update.productionQuantity === "number" && update.productionQuantity > 0 && Boolean(update.productionUnit?.trim());
      return { ...line, ...(complete ? { productionQuantity: update.productionQuantity, productionUnit: update.productionUnit, conversionSnapshot: { quantity: update.productionQuantity, unit: update.productionUnit!, rule: "Explicit CPU production entry." } } : {}), ...(update.actualQuantity !== undefined ? { actualQuantity: update.actualQuantity } : {}), ...(update.shortfallQuantity !== undefined ? { shortfallQuantity: update.shortfallQuantity } : {}), ...(update.substitution?.trim() ? { substitution: update.substitution.trim() } : {}), ...(update.wasteQuantity !== undefined ? { wasteQuantity: update.wasteQuantity } : {}), ...(update.productionInstructions?.trim() ? { productionInstructions: update.productionInstructions.trim() } : {}), ...(update.allergenEvidenceStatus ? { allergenEvidenceStatus: update.allergenEvidenceStatus } : {}), dietaries: structuredClone(update.dietaries), status: complete ? "ready" as const : "pending" as const };
    });
    const exceptions = current.exceptions.filter(exception => !exception.description.startsWith("No explicit production conversion is configured"));
    const status: ProductionStatus = exceptions.some(exception => exception.status === "open") ? "needs_review" : current.status === "needs_review" ? "accepted" : current.status;
    const next = { ...current, version: current.version + 1, currentRevision: current.currentRevision + 1, lines: nextLines, exceptions, status, audit: [...current.audit, { action: "production-lines-updated", at: now, by: actor.uid, previousState: current.status, newState: status, reason: "Liana production quantities and allergen evidence updated." }] };
    const event = createDomainEvent({ eventType: "production.order.amended", sourceAggregateId: next.canonicalId, sourceVersion: next.version, occurredAt: now, payload: { canonicalId: next.canonicalId, version: next.version, status: next.status, sourceBookingId: next.sourceBookingId, serviceDate: next.serviceDate, productionLocationId: next.productionLocationId, destinationOplocId: next.destinationOplocId, destinationLabel: next.destinationLabel, lineIds: next.lines.map(line => line.canonicalId), productionOrder: next } });
    await stageFulfilmentEvent(transaction, event);
    transaction.set(ref, next);
    stageDomainEvent(transaction, event);
    return next;
  });
}

function conflict(message: string) { return Object.assign(new Error(message), { status: 422 }); }
