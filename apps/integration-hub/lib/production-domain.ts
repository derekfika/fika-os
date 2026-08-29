import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { stableDocumentId } from "./canonical-editor";
import { CPU_PRODUCTION_LOCATION_ID } from "../../shared/production-location";
import { createDomainEvent } from "../../shared/domain-events";
import { stageDomainEvent } from "./domain-event-outbox";
import { stageFulfilmentEvent } from "./fulfilment-projection";
import { productionOrderRequiresFulfilment } from "../../shared/fulfilment-requirement";
import { hospitalityMenuProductionRouting } from "./connections-service";
import { adaptCpuProductionWorkstreams } from "../../shared/production-workstreams";
import { recordDeliveredInReadBudget } from "./delivered-in-read-budget";
import type { ExternalProductionMaterialisation } from "@fika/server-shared/external-production";
export type { ExternalProductionMaterialisation } from "@fika/server-shared/external-production";

export const PRODUCTION_SCHEMA_VERSION = "0.1.0";
export type ProductionStatus = "received" | "draft" | "needs_review" | "accepted" | "planning" | "planned" | "amended" | "menu_available" | "rejected" | "needs_clarification" | "scheduled" | "in_production" | "partially_complete" | "ready" | "complete" | "cancelled" | "blocked" | "failed" | "reconciliation_required";
export type ProductionException = { canonicalId: string; severity: "info" | "warning" | "blocking"; status: "open" | "resolved"; description: string; createdAt: string; createdBy: string; resolvedAt?: string; resolvedBy?: string; resolutionNotes?: string; audit: ProductionAuditEvent[] };
export type ProductionAuditEvent = { action: string; at: string; by: string; previousState?: string; newState?: string; reason?: string; correlationId?: string; causationId?: string; idempotencyKey?: string };
export type ProductionWorkstream = "sandwiches" | "hospitality" | "delivered_in" | "grab_and_go" | "unassigned";
export type ProductionLine = { canonicalId: string; sourceBookingLineId: string; sourceMenuItemId?: string; sourceOfferingId?: string; itemName: string; description?: string; customerQuantity: number; customerUnit: string; productionQuantity?: number; productionUnit?: string; actualQuantity?: number; shortfallQuantity?: number; substitution?: string; wasteQuantity?: number; conversionSnapshot?: { quantity: number; unit: string; rule: string }; choices?: unknown[]; servingGuidance?: string; productionInstructions?: string; dietaries: Record<string, unknown>; allergenEvidenceStatus?: "confirmed" | "unreviewed" | "missing" | "conflicting"; approvedAllergenSnapshot?: { allergens: Record<string, string>; mayContainNotes?: string; sourcePublicationDayId?: string; sourceVersion?: number; sourceContentHash?: string }; status: "pending" | "ready" | "complete" | "exception"; sortOrder: number; exceptions?: string[]; workstream?: ProductionWorkstream };
export type ProductionRequirement = { canonicalId: string; entityType: "Production Requirement"; schemaVersion: string; version: number; sourceBookingId: string; sourceBookingRevision: number; sourceQuoteRevisionId: string; productionLocationId?: string; requestedServiceDate: string; serviceWindow: { startTime: string; endTime?: string }; requiredBy: string; status: "draft" | "needs_review" | "accepted" | "cancelled"; sourceSnapshot: { booking: CanonicalBooking; quote: unknown }; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; audit: ProductionAuditEvent[] };
export type ProductionOrigin = "hospitality_booking" | "cpu_created" | "legacy_import" | "menu_planning" | "grab_and_go";
export type ProductionCategory = "delivered_in" | "fine_dining" | "hospitality" | "events" | "grab_and_go" | "other";
export type ProductionDestinationAddress = { identity: string; label: string; address: string; deliveryInstructions?: string; contact?: string };
export type ProductionOrder = { canonicalId: string; entityType: "Production Order"; schemaVersion: string; version: number; requirementIds: string[]; sourceBookingId: string; sourceQuoteRevisionId: string; sourceEntityId?: string; sourceVersion?: number; sourceContentHash?: string; sourcePublicationDayId?: string; productionLocationId?: string; productionCategory?: ProductionCategory; requiresDelivery?: boolean; destinationOplocId?: string; destinationLabel?: string; destinationAddress?: ProductionDestinationAddress; clientName?: string; serviceType?: string; serviceDate?: string; guestCount?: number; requiredBy: string; serviceWindow: { startTime: string; endTime?: string }; status: ProductionStatus; /** Local planning projection, kept separate from the governed Production lifecycle. */ workflowStatus?: ProductionStatus; priority: "normal" | "high" | "urgent"; lines: ProductionLine[]; exceptions: ProductionException[]; bookingDietaries?: Record<string, unknown>; bookingNotes?: string; operationalNotes?: string; amendmentNotice?: string; cancellationNotice?: string; cpuDismissedAt?: string; origin: ProductionOrigin; currentRevision: number; createdAt: string; createdBy: string; updatedAt?: string; acceptedAt?: string; startedAt?: string; completedAt?: string; supersededBy?: string; idempotencyKey: string; externalReferences: string[]; audit: ProductionAuditEvent[] };

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
  const routing = await hospitalityMenuProductionRouting();
  return db.runTransaction(async transaction => {
    const bookingSnapshot = await transaction.get(bookings().doc(bookingId));
    if (!bookingSnapshot.exists) throw conflict("Booking was not found.");
    const booking = bookingSnapshot.data() as CanonicalBooking;
    if (!['Quoted', 'Approved'].includes(booking.lifecycleStatus)) throw conflict("Generate a current quote before sending this Booking to CPU.");
    if (booking.deliveryChargeRequired === false) throw conflict("CPU delivery is not selected for this Booking, so no CPU production hand-off is required.");
    if (!booking.service.oplocId?.trim()) throw conflict("A delivery-requiring Hospitality Production Order needs a confirmed canonical destination OPLOC.");
    const quote = booking.quoteState?.revisions.find(item => item.id === booking.quoteState?.currentRevisionId);
    if (!quote || quote.stale || quote.id !== booking.quoteState?.currentRevisionId) throw conflict("A current Quote Revision is required.");
    if (quote.pdfStatus !== "saved" || !quote.driveFileId) throw conflict("The current quote PDF must be saved to Drive before sending this Booking to CPU.");
    const baseOrderRef = orders().doc(stableDocumentId(productionOrderV1Id(bookingId)));
    const baseOrderSnapshot = await transaction.get(baseOrderRef);
    const existingBase = baseOrderSnapshot.exists ? baseOrderSnapshot.data() as ProductionOrder : undefined;
    const now = new Date().toISOString();
    const markBookingSentToCpu = () => {
      const nextBooking: CanonicalBooking = {
        ...booking,
        version: booking.version + 1,
        lifecycleStatus: "Sent to CPU",
        updatedAt: now,
        updatedBy: actor.uid,
        statusHistory: [
          ...(booking.statusHistory || []),
          { status: "Sent to CPU", changedAt: now, changedBy: actor.uid, reason: "Production hand-off recorded." },
        ],
        audit: [
          ...(booking.audit || []),
          { action: "booking-sent-to-cpu", at: now, by: actor.uid, reason: "Production hand-off recorded." },
        ],
      };
      transaction.set(bookingSnapshot.ref, nextBooking);
    };
    const orderId = existingBase?.status === "amended"
      ? productionOrderV1Id(bookingId, booking.version)
      : productionOrderV1Id(bookingId);
    const orderRef = orders().doc(stableDocumentId(orderId));
    const existing = orderId === productionOrderV1Id(bookingId) ? baseOrderSnapshot : await transaction.get(orderRef);
    if (existing.exists && (existing.data() as ProductionOrder).status !== "amended") {
      markBookingSentToCpu();
      return { created: false, status: "already_exists" as const, requirement: undefined, order: existing.data() as ProductionOrder };
    }
    const requirementId = productionRequirementId(bookingId, quote.id);
    const requirement: ProductionRequirement = { canonicalId: requirementId, entityType: "Production Requirement", schemaVersion: PRODUCTION_SCHEMA_VERSION, version: 1, sourceBookingId: bookingId, sourceBookingRevision: booking.version, sourceQuoteRevisionId: quote.id, productionLocationId: booking.service.oplocId, requestedServiceDate: booking.service.eventDate, serviceWindow: { startTime: booking.service.startTime, ...(booking.service.endTime ? { endTime: booking.service.endTime } : {}) }, requiredBy: `${booking.service.eventDate}T${booking.service.startTime}`, status: "needs_review", sourceSnapshot: { booking: structuredClone(booking), quote: structuredClone(quote.snapshot) }, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, audit: [{ action: "production-requirement-created", at: now, by: actor.uid, newState: "needs_review", reason: "Created from Booking and current Quote Revision.", idempotencyKey }] };
    const exceptions: ProductionException[] = [];
    const lines: ProductionLine[] = booking.order.items.map((item, index) => {
      const configured = conversions[item.itemId];
      const explicitRule = explicitMnkConversions[item.itemId] || Object.entries(explicitMnkConversions).find(([key]) => item.itemId.endsWith(`:${key}`))?.[1];
      const conversion = configured ? { quantity: configured.quantity, unit: configured.unit, rule: "Explicit production conversion configuration." } : explicitRule ? { quantity: item.quantity * explicitRule.multiplier, unit: explicitRule.unit, rule: explicitRule.rule } : undefined;
      const assignments = [item.menuItemId, item.itemId].filter((value): value is string => Boolean(value)).flatMap(value => routing[value] || []);
      const workstream: ProductionWorkstream = adaptCpuProductionWorkstreams(assignments).workstreams[0] || "unassigned";
      const line: ProductionLine = { canonicalId: `production-line:${bookingId}:${index + 1}`, sourceBookingLineId: `${bookingId}:line:${index + 1}`, ...(item.menuItemId ? { sourceMenuItemId: item.menuItemId } : {}), itemName: item.itemName || item.itemId, ...(item.description ? { description: item.description } : {}), customerQuantity: item.quantity, customerUnit: item.servingInfo || "ordered unit", ...(conversion ? { productionQuantity: conversion.quantity, productionUnit: conversion.unit, conversionSnapshot: { ...conversion, rule: "Explicit configured production conversion." } } : {}), ...(item.choices ? { choices: structuredClone(item.choices) } : {}), ...(item.servingInfo ? { servingGuidance: item.servingInfo } : {}), ...(item.comments ? { productionInstructions: item.comments } : {}), dietaries: structuredClone(booking.dietaries), status: conversion ? "ready" : "exception", sortOrder: index, workstream };
      return { ...line, status: conversion ? "ready" : "pending" };
    });
    const amendmentNotice = existingBase?.status === "amended"
      ? `Booking amended: ${existingBase.guestCount ?? "?"} pax → ${booking.service.guestCount} pax; ${existingBase.lines.map(line => `${line.itemName} ${line.customerQuantity}`).join(", ")} → ${lines.map(line => `${line.itemName} ${line.customerQuantity}`).join(", ")}.`
      : undefined;
    const status: ProductionStatus = existingBase?.status === "amended" ? "needs_review" : exceptions.length ? "needs_review" : "draft";
    const order: ProductionOrder = { canonicalId: orderId, entityType: "Production Order", schemaVersion: PRODUCTION_SCHEMA_VERSION, version: 1, requirementIds: [requirementId], sourceBookingId: bookingId, sourceQuoteRevisionId: quote.id, productionLocationId: process.env.CPU_PRODUCTION_LOCATION_ID, requiresDelivery: true, destinationOplocId: booking.service.oplocId, destinationLabel: [booking.service.portalSiteLabel, booking.service.roomOrArea || booking.service.deliveryPoint].filter(Boolean).join(" · ") || booking.service.oplocId, clientName: booking.client.companyName, ...(booking.order.eventType ? { serviceType: booking.order.eventType } : {}), serviceDate: booking.service.eventDate, guestCount: booking.service.guestCount, requiredBy: requirement.requiredBy, serviceWindow: requirement.serviceWindow, status, priority: "normal", lines, exceptions, ...(existingBase?.status === "amended" ? { workflowStatus: "amended" as const } : {}), ...(amendmentNotice ? { amendmentNotice, operationalNotes: amendmentNotice } : {}), ...(Object.keys(booking.dietaries || {}).length ? { bookingDietaries: structuredClone(booking.dietaries) } : {}), ...(booking.notes ? { bookingNotes: booking.notes } : {}), origin: "hospitality_booking", currentRevision: 1, createdAt: now, createdBy: actor.uid, idempotencyKey, externalReferences: [], audit: [{ action: "production-order-created", at: now, by: actor.uid, newState: status, reason: amendmentNotice || "Internal Production Order created without external CPU or Calendar side effects.", idempotencyKey }] };
    const event = createDomainEvent({ eventType: "production.order.created", sourceAggregateId: order.canonicalId, sourceVersion: order.version, occurredAt: now, correlationId: idempotencyKey, payload: { canonicalId: order.canonicalId, version: order.version, status: order.status, sourceBookingId: order.sourceBookingId, serviceDate: order.serviceDate, productionLocationId: order.productionLocationId, destinationOplocId: order.destinationOplocId, destinationLabel: order.destinationLabel, lineIds: order.lines.map(line => line.canonicalId), productionOrder: order } });
    if (productionOrderRequiresFulfilment(order)) await stageFulfilmentEvent(transaction, event);
    if (existingBase?.status === "amended") transaction.set(baseOrderRef, { supersededBy: orderId }, { merge: true });
    transaction.create(requirements().doc(stableDocumentId(requirementId)), requirement);
    transaction.create(orderRef, order);
    markBookingSentToCpu();
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
    comments?: string;
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
      ...(line.productionInstructions || !source.comments
        ? {}
        : { productionInstructions: source.comments }),
    };
  });
  const hasLineDietaries = order.lines.every(line => Object.keys(line.dietaries || {}).length > 0);
  const cancellationReason = booking.dashboardWorkflow?.cancellation?.reason;
  const cancellationNotice = booking.lifecycleStatus === "Cancelled"
    ? order.cancellationNotice || `Booking cancelled${cancellationReason ? `: ${cancellationReason}` : "."}`
    : order.cancellationNotice;
  return {
    ...order,
    lines: linesWithSourceIdentity,
    ...(order.clientName ? {} : { clientName: booking.client?.companyName || booking.client?.name }),
    ...(order.destinationLabel ? {} : { destinationLabel: booking.service?.portalSiteLabel || booking.service?.roomOrArea || booking.service?.deliveryPoint }),
    ...(order.serviceDate ? {} : { serviceDate: booking.service?.eventDate }),
    ...(order.guestCount !== undefined ? {} : { guestCount: booking.service?.guestCount }),
    ...(order.serviceType ? {} : (booking.order?.eventType ? { serviceType: booking.order.eventType } : {})),
    ...(order.bookingDietaries ? {} : (Object.keys(booking.dietaries || {}).length ? { bookingDietaries: structuredClone(booking.dietaries) } : {})),
    ...(order.bookingNotes ? {} : (booking.notes ? { bookingNotes: booking.notes } : {})),
    ...(cancellationNotice ? { cancellationNotice } : {}),
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
    .filter(order => !order.supersededBy && order.status !== "amended")
    .sort((a, b) => (b.version - a.version) || b.createdAt.localeCompare(a.createdAt));
  const order = candidates[0];
  return order ? enrichOrder(withoutAutomaticQuantityBlockers(order)) : undefined;
}

export async function productionQueue(serviceDate: string) {
  const snapshot = await orders().where("serviceDate", "==", serviceDate).get();
  recordDeliveredInReadBudget({ stage: "discovery", canonicalOrderDocs: snapshot.size, serviceDate, knownId: false });
  return Promise.all(
    snapshot.docs
    .map(item => item.data() as ProductionOrder)
    .filter(order => !order.supersededBy && order.status !== "amended")
    // Test-only CPU internal records must never leak into the operational
    // queue when local integration tests share the emulator with the apps.
    .filter(order => !(process.env.NODE_ENV !== "production" && order.idempotencyKey.startsWith("cpu-internal-test:")))
    .filter(order => !(order.origin === "hospitality_booking" && order.requiresDelivery === false))
      .map(order => enrichOrder(withoutAutomaticQuantityBlockers(order))),
  );
}
export async function productionQueueForWeek(weekCommencing: string) {
  const start = new Date(`${weekCommencing}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 5);
  const snapshot = await orders()
    .where("serviceDate", ">=", weekCommencing)
    .where("serviceDate", "<", end.toISOString().slice(0, 10))
    .get();
  return Promise.all(
    snapshot.docs
      .map(item => item.data() as ProductionOrder)
      .filter(order => !order.supersededBy && order.status !== "amended")
      .filter(order => !(process.env.NODE_ENV !== "production" && order.idempotencyKey.startsWith("cpu-internal-test:")))
      .filter(order => !(order.origin === "hospitality_booking" && order.requiresDelivery === false))
      .sort((a, b) => a.requiredBy.localeCompare(b.requiredBy))
      .map(order => enrichOrder(withoutAutomaticQuantityBlockers(order))),
  );
}
export async function productionOrderDetail(canonicalId: string) { const snapshot = await orders().doc(stableDocumentId(canonicalId)).get(); recordDeliveredInReadBudget({ stage: "known_order_lookup", canonicalOrderDocs: snapshot.exists ? 1 : 0, knownId: true }); return snapshot.exists ? enrichOrder(withoutAutomaticQuantityBlockers(snapshot.data() as ProductionOrder)) : undefined; }

export type CpuCreatedProductionInput = { clientName: string; serviceDate: string; deliveryDateTime: string; requiredBy: string; serviceWindow: { startTime: string; endTime?: string }; productionLocationId?: string; productionCategory?: ProductionCategory; destinationOplocId?: string; requiresDelivery?: boolean; deliveryLocation: string; destinationAddress?: ProductionDestinationAddress; floorRoom?: string; contact?: string; serviceType: string; pax: number; lines: Array<{ itemName: string; customerQuantity: number; customerUnit: string; productionQuantity?: number; productionUnit?: string; dietary?: Record<string, unknown>; approvedAllergenSnapshot?: { allergens: Record<string, string>; mayContainNotes?: string }; notes?: string }>; priority?: "normal" | "high" | "urgent"; sourceReference?: string; sourceEntityId?: string; sourceVersion?: number; notes?: string };
export async function createCpuProductionOrder(actor: Actor, input: CpuCreatedProductionInput, idempotencyKey: string) {
  if (!idempotencyKey.trim()) throw conflict("An idempotency key is required.");
  if (input.requiresDelivery !== false && !input.destinationOplocId?.trim()) throw Object.assign(new Error("A CPU delivery Production Order requires a canonical destination OPLOC ID."), { status: 422 });
  return db.runTransaction(async transaction => {
    const canonicalId = input.sourceEntityId ? `production-order:v1:ad-hoc:${input.sourceEntityId}:v${input.sourceVersion || 1}` : `production-order:v1:cpu:${crypto.randomUUID()}`;
    const existingSnapshot = await transaction.get(orders().where("idempotencyKey", "==", idempotencyKey).limit(1)); if (!existingSnapshot.empty) return { created: false, status: "already_exists" as const, order: existingSnapshot.docs[0].data() as ProductionOrder };
    const ref = orders().doc(stableDocumentId(canonicalId));
    const now = new Date().toISOString(); const exceptions: ProductionException[] = []; const lines: ProductionLine[] = input.lines.map((line, index) => { const complete = typeof line.productionQuantity === "number" && Boolean(line.productionUnit); return { canonicalId: `${canonicalId}:line:${index + 1}`, sourceBookingLineId: input.sourceEntityId ? `${input.sourceEntityId}:line:${index + 1}` : `${canonicalId}:source:${index + 1}`, itemName: line.itemName, customerQuantity: line.customerQuantity, customerUnit: line.customerUnit, ...(complete ? { productionQuantity: line.productionQuantity, productionUnit: line.productionUnit, conversionSnapshot: { quantity: line.productionQuantity!, unit: line.productionUnit!, rule: "Explicit CPU entry." } } : {}), dietaries: line.dietary || {}, ...(line.approvedAllergenSnapshot ? { approvedAllergenSnapshot: line.approvedAllergenSnapshot, allergenEvidenceStatus: "confirmed" as const } : {}), status: complete ? "ready" as const : "pending" as const, sortOrder: index, ...(line.notes ? { productionInstructions: line.notes } : {}) }; });
    const order: ProductionOrder = { canonicalId, entityType: "Production Order", schemaVersion: PRODUCTION_SCHEMA_VERSION, version: 1, requirementIds: [], sourceBookingId: input.sourceReference || canonicalId, sourceQuoteRevisionId: "", ...(input.sourceEntityId ? { sourceEntityId: input.sourceEntityId, sourceVersion: input.sourceVersion || 1 } : {}), productionLocationId: input.productionLocationId || process.env.CPU_PRODUCTION_LOCATION_ID, ...(input.productionCategory ? { productionCategory: input.productionCategory } : {}), requiresDelivery: input.requiresDelivery !== false, ...(input.destinationOplocId ? { destinationOplocId: input.destinationOplocId } : {}), destinationLabel: input.deliveryLocation, ...(input.destinationAddress ? { destinationAddress: input.destinationAddress } : {}), clientName: input.clientName, serviceType: input.serviceType, serviceDate: input.serviceDate, guestCount: input.pax, requiredBy: input.requiredBy, serviceWindow: input.serviceWindow, status: exceptions.length ? "needs_review" : "draft", priority: input.priority || "normal", lines, exceptions, operationalNotes: `${input.clientName} · ${input.serviceType} · ${input.deliveryLocation}${input.floorRoom ? ` · ${input.floorRoom}` : ""}${input.contact ? ` · ${input.contact}` : ""}${input.notes ? ` · ${input.notes}` : ""}${input.destinationAddress ? ` · ${input.destinationAddress.address}` : ""}`, origin: "cpu_created", currentRevision: 1, createdAt: now, createdBy: actor.uid, idempotencyKey, externalReferences: [], audit: [{ action: "cpu-production-order-created", at: now, by: actor.uid, newState: exceptions.length ? "needs_review" : "draft", reason: "Created by authorised CPU user; no external side effects.", idempotencyKey }] };
    const event = createDomainEvent({ eventType: "production.order.created", sourceAggregateId: order.canonicalId, sourceVersion: order.version, occurredAt: now, correlationId: idempotencyKey, payload: { canonicalId: order.canonicalId, version: order.version, status: order.status, sourceBookingId: order.sourceBookingId, serviceDate: order.serviceDate, productionLocationId: order.productionLocationId, destinationOplocId: order.destinationOplocId, destinationLabel: order.destinationLabel, lineIds: order.lines.map(line => line.canonicalId), productionOrder: order } });
    if (productionOrderRequiresFulfilment(order)) await stageFulfilmentEvent(transaction, event);
    transaction.create(ref, order);
    stageDomainEvent(transaction, event);
    return { created: true, status: "created" as const, order };
  });
}

export function materialisedProductionId(input: Pick<ExternalProductionMaterialisation, "sourceDomain" | "sourceEntityId" | "destinationOplocId">) {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9:_-]+/g, "_");
  return `production-order:v1:${input.sourceDomain}:${safe(input.sourceEntityId)}:${safe(input.destinationOplocId)}`;
}

export function externalProductionStatus(input: Pick<ExternalProductionMaterialisation, "sourceDomain" | "status">): ProductionStatus {
  if (input.status === "cancelled" || input.status === "withdrawn") return "cancelled";
  if (input.sourceDomain === "grab-and-go") return "planned";
  return input.sourceDomain === "menu-planning" ? "menu_available" : "received";
}

/** Converts an upstream production-bound record into the one canonical CPU order. */
export async function materialiseExternalProductionOrder(actor: Actor, input: ExternalProductionMaterialisation) {
  if (!input.sourceEntityId.trim() || !input.destinationOplocId.trim()) throw conflict("A source entity and canonical destination are required.");
  return db.runTransaction(async transaction => {
    const canonicalId = materialisedProductionId(input);
    const ref = orders().doc(stableDocumentId(canonicalId));
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() as ProductionOrder : undefined;
    // Grab & Go is individually labelled at source, so it does not need the
    // normal CPU acceptance/allergen-review gate. It is ready to plan as soon
    // as the site submits the quantities. Menu publications retain their
    // separate publication state and hospitality work follows the usual flow.
    const status = externalProductionStatus(input);
    if (previous && previous.sourceVersion === input.sourceVersion && previous.sourceContentHash === input.sourceContentHash && previous.status === status) return { created: false, duplicate: true, order: previous };
    const now = new Date().toISOString();
    const order: ProductionOrder = {
      ...(previous || {}), canonicalId, entityType: "Production Order", schemaVersion: PRODUCTION_SCHEMA_VERSION,
      version: (previous?.version || 0) + 1, currentRevision: (previous?.currentRevision || 0) + 1,
      requirementIds: previous?.requirementIds || [], sourceBookingId: previous?.sourceBookingId || canonicalId, sourceQuoteRevisionId: previous?.sourceQuoteRevisionId || "",
      sourceEntityId: input.sourceEntityId, sourceVersion: input.sourceVersion, ...(input.sourceContentHash ? { sourceContentHash: input.sourceContentHash } : {}), ...(input.sourcePublicationDayId ? { sourcePublicationDayId: input.sourcePublicationDayId } : {}),
      productionLocationId: previous?.productionLocationId || CPU_PRODUCTION_LOCATION_ID,
      origin: input.sourceDomain === "grab-and-go" ? "grab_and_go" : "menu_planning", requiresDelivery: true, destinationOplocId: input.destinationOplocId, destinationLabel: input.destinationLabel || input.destinationOplocId,
      serviceType: input.sourceDomain === "grab-and-go" ? "Grab & Go" : "Delivered-In menu", serviceDate: input.serviceDate, requiredBy: input.requiredBy || `${input.serviceDate}T00:00`, serviceWindow: input.serviceWindow || { startTime: "00:00" },
      status, priority: previous?.priority || "normal", lines: input.lines.map((line, index) => ({ canonicalId: `${canonicalId}:line:${index + 1}`, sourceBookingLineId: line.sourceLineId, ...(line.canonicalItemId ? { sourceMenuItemId: line.canonicalItemId } : {}), itemName: line.itemName, customerQuantity: line.quantity, customerUnit: line.unit, productionQuantity: line.quantity, productionUnit: line.unit, conversionSnapshot: { quantity: line.quantity, unit: line.unit, rule: "Explicit upstream source quantity." }, dietaries: {}, ...(line.approvedAllergenSnapshot ? { approvedAllergenSnapshot: structuredClone(line.approvedAllergenSnapshot), allergenEvidenceStatus: "confirmed" as const } : { allergenEvidenceStatus: "unreviewed" as const }), status: status === "cancelled" ? "exception" as const : "ready" as const, sortOrder: index, workstream: line.workstream || (input.sourceDomain === "grab-and-go" ? "grab_and_go" : "delivered_in") })),
      exceptions: [], createdAt: previous?.createdAt || now, createdBy: previous?.createdBy || actor.uid, idempotencyKey: `materialise:${input.sourceDomain}:${input.sourceEntityId}:${input.destinationOplocId}`, externalReferences: previous?.externalReferences || [], audit: [...(previous?.audit || []), { action: previous ? "external-production-order-amended" : "external-production-order-created", at: now, by: actor.uid, previousState: previous?.status, newState: status, reason: `Materialised from ${input.sourceDomain}.` }],
    };
    const event = createDomainEvent({ eventType: status === "cancelled" ? "production.order.withdrawn" : previous ? "production.order.amended" : "production.order.created", sourceAggregateId: canonicalId, sourceVersion: order.version, occurredAt: now, correlationId: order.idempotencyKey, payload: { canonicalId, version: order.version, status, productionOrder: order } });
    await stageFulfilmentEvent(transaction, event);
    transaction.set(ref, order);
    stageDomainEvent(transaction, event);
    return { created: !previous, duplicate: false, order };
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
    if (productionOrderRequiresFulfilment(current)) await stageFulfilmentEvent(transaction, event);
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
    if (productionOrderRequiresFulfilment(current)) await stageFulfilmentEvent(transaction, event);
    transaction.set(ref, next);
    stageDomainEvent(transaction, event);
    return next;
  });
}

export async function acknowledgeProductionCancellation(actor: Actor, canonicalId: string, expectedVersion: number) {
  return db.runTransaction(async transaction => {
    const ref = orders().doc(stableDocumentId(canonicalId));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw conflict("Production Order was not found.");
    const current = snapshot.data() as ProductionOrder;
    if (current.version !== expectedVersion) throw conflict("Production Order changed elsewhere. Refresh and try again.");
    if (current.status !== "cancelled") throw conflict("Only a cancelled Production Order can be dismissed from the CPU view.");
    const now = new Date().toISOString();
    const next = { ...current, cpuDismissedAt: now, updatedAt: now, audit: [...current.audit, { action: "cpu-cancelled-order-dismissed", at: now, by: actor.uid, previousState: current.status, newState: current.status, reason: "CPU chef acknowledged the cancelled booking." }] };
    transaction.set(ref, next);
    return next;
  });
}

export async function reportProductionAllergenDiscrepancy(actor: Actor, canonicalId: string, expectedVersion: number, note: string) {
  if (!note.trim()) throw conflict("A discrepancy note is required.");
  return db.runTransaction(async transaction => {
    const ref = orders().doc(stableDocumentId(canonicalId));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw conflict("Production Order was not found.");
    const current = snapshot.data() as ProductionOrder;
    if (current.version !== expectedVersion) throw conflict("Production Order changed elsewhere. Refresh and try again.");
    const now = new Date().toISOString();
    const exception: ProductionException = { canonicalId: `${canonicalId}:allergen-discrepancy:${current.version + 1}`, severity: "blocking", status: "open", description: `Allergen discrepancy reported by CPU: ${note.trim()}`, createdAt: now, createdBy: actor.uid, audit: [{ action: "allergen-discrepancy-reported", at: now, by: actor.uid, reason: note.trim() }] };
    const next: ProductionOrder = { ...current, version: current.version + 1, currentRevision: current.currentRevision + 1, status: "needs_clarification", exceptions: [...current.exceptions, exception], audit: [...current.audit, { action: "allergen-discrepancy-reported", at: now, by: actor.uid, previousState: current.status, newState: "needs_clarification", reason: note.trim() }] };
    const event = createDomainEvent({ eventType: "production.order.amended", sourceAggregateId: next.canonicalId, sourceVersion: next.version, occurredAt: now, payload: { canonicalId: next.canonicalId, version: next.version, status: next.status, reason: note.trim(), productionOrder: next } });
    await stageFulfilmentEvent(transaction, event);
    transaction.set(ref, next);
    stageDomainEvent(transaction, event);
    return { order: next };
  });
}

function conflict(message: string) { return Object.assign(new Error(message), { status: 422 }); }
