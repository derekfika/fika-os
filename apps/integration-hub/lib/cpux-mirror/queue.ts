import { randomUUID } from "node:crypto";
import { FieldPath, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { claimEvent, eventIsDue, markEventDelivered, markEventFailed, outboxRecord, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { db } from "../firebase-admin";
import type { ProductionOrder } from "../production-domain";
import type { CanonicalBooking } from "../hospitality-booking-service";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { domainEventId } from "../../../shared/domain-events";
import { backfillDates, digest, londonServiceDate, mirrorEventId, mirrorRecipients } from "../../../shared/cpux-calendar/contract";
import { mirrorEnabled, mirrorPreviewEnabled, mirrorProductionRuntime, MirrorTokenError, openMirrorClient, type MirrorObservation } from "../../../shared/cpux-calendar/google";
import { hospitalityCalendarSiteEnabled, resolveHospitalityCalendarTarget } from "../hospitality-calendar-integration";
import { hasRecordedHospitalityHandoff, hospitalityMirrorSource, HospitalityMirrorSourceError } from "./source";
import { resolveMirrorOplocs } from "./oplocs";
import { hospitalityCatchUpWriteIntent } from "./approval";
import { dueHospitalityMirrorQuery, hospitalityMirrorOutboxStatus } from "./outbox-query";
import { notifyCpuProjection } from "../cpu-projection-client";
import { deliverHospitalityCancellation, hospitalityCancellationEventId } from "../hospitality-cancellation-outbox";

const queue = () => db.collection("fikaCpuXHospitalityMirrorOutboxV1");
type ProjectionChange = "created" | "amended" | "withdrawn";
type Intent = {
  bookingId: string;
  orderId: string;
  cpuProjection?: { changeType: ProjectionChange; idempotencyKey: string; useCancellationOutbox?: boolean };
  orderEvidence?: string;
};
type Event = DurableDomainEvent<Intent> & {
  cpuConfirmedAt?: string;
  calendarDisposition?: MirrorObservation["disposition"] | "superseded";
};
type MirrorProgress = { eventId: string; status: string; errorCode?: string; calendarDisposition?: Event["calendarDisposition"] };

function record(event: Event) {
  return { ...outboxRecord(event), outboxStatus: hospitalityMirrorOutboxStatus(event.delivery.status, Boolean(event.payload.cpuProjection)) };
}

export function hospitalityMirrorRequired(order: ProductionOrder, at: string, env = process.env) {
  const today = londonServiceDate(new Date(at));
  return mirrorProductionRuntime(env) && order.origin === "hospitality_booking" && Boolean(order.sourceBookingId && order.canonicalId &&
    hospitalityCalendarSiteEnabled(order.destinationOplocId, env) && today && order.serviceDate && order.serviceDate >= today);
}
export function hospitalityProductionEventId(orderId: string, version: number, changeType: ProjectionChange, useCancellationOutbox = true) {
  const eventType = changeType === "withdrawn" && useCancellationOutbox ? "production.order.cancelled" : `production.order.${changeType}`;
  return domainEventId(eventType, orderId, version);
}

export async function triggerHospitalityMirrorEvent(eventId: string, replay = replayHospitalityMirrorEvent): Promise<MirrorProgress> {
  try {
    const result = await replay(eventId);
    if (["missing", "blocked", "approval_required"].includes(result.status))
      console.error(JSON.stringify({ severity: "ERROR", event: "cpux.calendar.hospitality.unavailable", eventId, status: result.status }));
    return result;
  } catch {
    console.error(JSON.stringify({ severity: "ERROR", event: "cpux.calendar.hospitality.immediate_delivery_deferred", eventId }));
    return { eventId, status: "pending", errorCode: "MIRROR_WORKER_UNAVAILABLE" };
  }
}

export async function hospitalityMirrorAfterCpu(order: ProductionOrder, changeType: ProjectionChange, confirmed: boolean, useCancellationOutbox = true): Promise<MirrorProgress> {
  const eventId = hospitalityProductionEventId(order.canonicalId, order.version, changeType, useCancellationOutbox);
  if (!hospitalityMirrorRequired(order, order.updatedAt || order.createdAt) ||
    (changeType === "amended" && !useCancellationOutbox && !["amended", "rejected"].includes(order.status)))
    return { eventId, status: "not_required" };
  if (!confirmed) return { eventId, status: "pending", errorCode: "MIRROR_CPU_UNCONFIRMED" };
  return triggerHospitalityMirrorEvent(eventId);
}

function orderCalendarEvidence(order: ProductionOrder) {
  return digest(JSON.stringify([
    order.sourceBookingId, order.sourceQuoteRevisionId, order.destinationOplocId, order.serviceDate,
    ["amended", "rejected", "cancelled"].includes(order.status),
    order.lines.map(line => [line.canonicalId, line.sourceBookingLineId, line.itemName, line.workstream, line.customerQuantity, line.customerUnit]),
  ]));
}

export function stageHospitalityMirrorIntent(transaction: Transaction, event: DurableDomainEvent, env = process.env) {
  const changeType = event.eventType === "production.order.created" ? "created"
    : event.eventType === "production.order.amended" ? "amended"
      : ["production.order.withdrawn", "production.order.cancelled"].includes(event.eventType) ? "withdrawn" : undefined;
  const order = (event.payload as { productionOrder?: ProductionOrder }).productionOrder;
  if (!changeType || !order || !hospitalityMirrorRequired(order, event.occurredAt, env)) return;
  // Routine CPU status, allergen or kitchen edits do not publish customer invitations.
  if (changeType === "amended" && !event.causationId && !["amended", "rejected"].includes(order.status)) return;
  const idempotencyKey = event.causationId || `cpu-projection:${order.canonicalId}:v${order.version}`;
  const useCancellationOutbox = event.eventType === "production.order.cancelled";
  const obligation: Event = {
    ...event, eventType: "cpux.calendar.hospitality",
    payload: { bookingId: order.sourceBookingId, orderId: order.canonicalId, orderEvidence: orderCalendarEvidence(order),
      cpuProjection: { changeType, idempotencyKey, ...(useCancellationOutbox ? { useCancellationOutbox } : {}) } },
    delivery: { status: "pending", attempts: 0 },
  };
  // All callers stage this with a new authoritative order/version. Creation preserves an existing delivery on replay.
  transaction.create(queue().doc(event.eventId), record(obligation));
}

type PrepareLive = {
  beforeCalendar: (order: ProductionOrder | undefined) => Promise<Awaited<ReturnType<typeof resolveMirrorOplocs>>[number]>;
  phase: (code: string) => void;
};

async function prepare(booking: CanonicalBooking, readOnly = false, live?: PrepareLive) {
  const orders = await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", booking.canonicalId).limit(26).get();
  if (orders.size > 25) throw new Error("The booking has too many Production Order revisions to verify automatically.");
  const terminal = new Set(["amended", "cancelled", "rejected"]);
  const currentOrders = orders.docs.map(row => row.data() as ProductionOrder).filter(order => order.origin === "hospitality_booking" && !order.supersededBy);
  const active = currentOrders.filter(order => !terminal.has(order.status));
  if (active.length > 1 || (!active.length && currentOrders.length > 1)) throw new Error("The booking has ambiguous current Production Orders.");
  const order = active[0] || currentOrders[0];
  const verifiedSite = await live?.beforeCalendar(order);
  live?.phase("MIRROR_SOURCE_UNREADY");
  const model = hospitalityMirrorSource(booking, order, readOnly);
  if (!model) return;
  const currentQuote = booking.quoteState?.revisions.find(quote => quote.id === booking.quoteState?.currentRevisionId);
  live?.phase("MIRROR_OPLOC_UNVERIFIED");
  const site = verifiedSite || (await resolveMirrorOplocs([model.site]))[0];
  if (!hospitalityCalendarSiteEnabled(site.canonicalId)) throw new Error("Hospitality Calendar delivery is disabled for this site.");
  live?.phase("MIRROR_CALENDAR_BINDING_FAILED");
  const target = resolveHospitalityCalendarTarget(site.canonicalId);
  const key = mirrorEventId("hospitality", booking.canonicalId);
  const binding = db.collection("fikaCpuXMirrorBindingsV1").doc(key);
  const prior = await binding.get();
  const api = await openMirrorClient(target, process.env, fetch, readOnly);
  const verifiedBinding = await api.verifyCalendarBinding();
  if (prior.exists && (prior.get("calendarId") !== target.calendarId || prior.get("organizerMailbox") !== target.subject || prior.get("accessRole") !== verifiedBinding.accessRole))
    throw new Error("Calendar organiser binding changed or lacks historical verification; operator review is required.");
  live?.phase("MIRROR_CALENDAR_IDENTITY_FAILED");
  const inspected = await api.inspectEvent(model.source);
  if (live && inspected.identityStatus !== "unique") throw new Error("Calendar identity conflict.");
  if (live && inspected.currentEvent && !prior.exists) throw new Error("A verified Calendar binding is missing.");
  const plan = inspected.observation;
  if (!prior.exists && !readOnly && !model.source.withdrawn && plan.disposition !== "create")
    throw new Error("An existing mirror event lacks a persisted verified Calendar binding; operator review is required.");
  live?.phase("MIRROR_QUOTE_ACCESS_FAILED");
  const pdfAccess = readOnly && model.fileId ? await api.inspectPdfAccess(model.fileId) : undefined;
  const document = model.fileId && (!pdfAccess || pdfAccess.readableByAll)
    ? await api.verifiedPdf(model.fileId, "Approved Hospitality quote.pdf") : undefined;
  const cpuLines = order?.lines.filter(line => ["sandwiches", "hospitality", "delivered_in"].includes(line.workstream || "")) || [];
  return {
    withdrawn: model.source.withdrawn,
    inspectionState: { identityStatus: inspected.identityStatus, currentEvent: inspected.currentEvent, conflictingEvents: inspected.conflictingEvents },
    preview: {
      ...plan, identity: booking.canonicalId, revision: model.source.revision, referenceHash: digest(model.source.sourceReference),
      calendarId: target.calendarId, organizerMailbox: target.subject, calendarAccessRole: verifiedBinding.accessRole,
      bindingStatus: prior.exists ? "verified" : "missing", attendees: mirrorRecipients(target), fileId: document?.fileId || null,
      ...(readOnly ? { quoteRevision: currentQuote ? { id: currentQuote.id, revision: currentQuote.revision,
        commercialVersion: currentQuote.commercialVersion, stale: currentQuote.stale, pdfStatus: currentQuote.pdfStatus || null,
        driveFileId: currentQuote.driveFileId || null } : null,
        quoteAccess: !model.fileId ? { status: "missing" as const } : { status: pdfAccess?.readableByAll ? "verified" as const : "blocked" as const, ...pdfAccess } } : {}),
      ...(document ? { quote: { fileId: document.fileId, title: document.title, url: document.url, attachmentUrl: document.attachmentUrl, accessVerified: true } } : {}),
      ...(readOnly ? { identityStatus: inspected.identityStatus, currentEvent: inspected.currentEvent || null,
        conflictingEvents: inspected.conflictingEvents || [], attendeeCopies: await api.inspectAttendeeCopies(model.source) } : {}),
      service: { date: booking.service.eventDate, time: booking.service.startTime, guestCount: booking.service.guestCount, oplocId: site.canonicalId, site: booking.service.portalSiteLabel || order?.destinationLabel || site.canonicalId },
      handoff: { status: booking.lifecycleStatus, currentOrderId: order?.canonicalId || null, currentOrderVersion: order?.version ?? null, currentOrderStatus: order?.status || null,
        missingProductionQuantity: cpuLines.filter(line => typeof line.productionQuantity !== "number" || !Number.isFinite(line.productionQuantity) || line.productionQuantity <= 0).length,
        missingProductionUnit: cpuLines.filter(line => !line.productionUnit?.trim()).length,
        cpuLines: cpuLines.map(line => ({ canonicalId: line.canonicalId || null, itemName: line.itemName || null, workstream: line.workstream || null,
          productionQuantity: line.productionQuantity ?? null, productionUnit: line.productionUnit || null, customerQuantity: line.customerQuantity ?? null, customerUnit: line.customerUnit || null })) },
    },
    apply: async () => {
      const verifySourceVersion = async () => {
        live?.phase("MIRROR_VERSION_FENCE");
        const refs = [db.collection("fikaBookings").doc(booking.canonicalId)];
        if (order) refs.push(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(order.canonicalId)));
        const [current, latest] = await db.getAll(...refs);
        if (current.get("canonicalId") !== booking.canonicalId || current.get("version") !== booking.version)
          throw new Error("The booking changed after Calendar preparation.");
        if (order && (latest?.get("canonicalId") !== order.canonicalId || latest.get("version") !== order.version || latest.get("supersededBy")))
          throw new Error("The Production Order changed after Calendar preparation.");
        live?.phase("MIRROR_CALENDAR_WRITE_FAILED");
      };
      if (plan.disposition === "skip" || plan.disposition === "unchanged") {
        if (live) await verifySourceVersion();
        return plan;
      }
      live?.phase("MIRROR_CALENDAR_BINDING_FAILED");
      await db.runTransaction(async tx => {
        const current = await tx.get(binding);
        if (current.exists && (current.get("calendarId") !== target.calendarId || current.get("organizerMailbox") !== target.subject || current.get("accessRole") !== verifiedBinding.accessRole)) throw new Error("The Calendar organiser binding changed during delivery.");
        if (!current.exists) tx.create(binding, { calendarId: target.calendarId, organizerMailbox: target.subject, accessRole: verifiedBinding.accessRole, eventId: key, stream: "hospitality" });
      });
      live?.phase("MIRROR_CALENDAR_WRITE_FAILED");
      return api.publish(model.source, model.details, document, verifySourceVersion);
    },
  };
}

export async function replayHospitalityMirror(limit: number) {
  if (!mirrorEnabled()) throw new Error("Calendar mirror delivery is disabled.");
  const candidates = await dueHospitalityMirrorQuery(queue(), new Date().toISOString(), limit).get();
  const results: MirrorProgress[] = [];
  for (const { ref, id } of candidates.docs) {
    results.push(await deliverHospitalityMirrorEvent(ref, id));
  }
  return results;
}

/** Immediately process the exact obligation after the calling command confirms CPU projection. */
export async function replayHospitalityMirrorEvent(eventId: string): Promise<MirrorProgress> {
  return deliverHospitalityMirrorEvent(queue().doc(eventId), eventId, true);
}

function progress(event: Event): MirrorProgress {
  return {
    eventId: event.eventId,
    status: event.delivery.status,
    ...(event.delivery.lastError && event.delivery.status !== "delivered" ? { errorCode: event.delivery.lastError } : {}),
    ...(event.calendarDisposition ? { calendarDisposition: event.calendarDisposition } : {}),
  };
}

class SupersededMirrorIntent extends Error {}

async function deliverHospitalityMirrorEvent(ref: DocumentReference, eventId: string, cpuConfirmed = false): Promise<MirrorProgress> {
  const claimId = randomUUID();
  const claim = await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data() as Event | undefined;
    if (!row) return { result: { eventId, status: "missing" } };
    if (!row.payload.cpuProjection) return { result: { ...progress(row), status: "approval_required" } };
    if (!eventIsDue(row)) return { result: progress(row) };
    if (!mirrorEnabled()) return { result: { eventId, status: "blocked", errorCode: "MIRROR_WRITES_DISABLED" } };
    const at = new Date().toISOString();
    const ready = cpuConfirmed ? { ...row, cpuConfirmedAt: row.cpuConfirmedAt || at } : row;
    const next = { ...ready, delivery: claimEvent(ready, claimId, at, 180_000).delivery };
    tx.set(ref, record(next));
    return { claimed: next };
  });
  if (!claim.claimed) return claim.result!;
  const claimed = claim.claimed;
  let next: Event;
  let errorCode = "MIRROR_SOURCE_UNREADY";
  try {
    const row = await db.collection("fikaBookings").doc(claimed.payload.bookingId).get();
    const booking = row.data() as CanonicalBooking | undefined;
    if (!booking || booking.canonicalId !== claimed.payload.bookingId || !hasRecordedHospitalityHandoff(booking))
      throw new Error("The source booking handoff is unavailable.");
    const pending = await prepare(booking, false, {
      phase: code => { errorCode = code; },
      beforeCalendar: async order => {
        errorCode = "MIRROR_VERSION_FENCE";
        const { orderId, bookingId, cpuProjection } = claimed.payload;
        if (order?.canonicalId !== orderId) {
          const original = (await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)).get()).data() as ProductionOrder | undefined;
          if (original?.canonicalId === orderId && original.sourceBookingId === bookingId && order?.canonicalId && original.supersededBy === order.canonicalId)
            throw new SupersededMirrorIntent();
          throw new Error("The current Production Order does not match the Calendar obligation.");
        }
        if (order.version !== claimed.sourceVersion) {
          const newer = await db.getAll(...[
            hospitalityProductionEventId(orderId, order.version, "amended"),
            hospitalityProductionEventId(orderId, order.version, "withdrawn"),
            hospitalityProductionEventId(orderId, order.version, "withdrawn", false),
          ].map(id => queue().doc(id)));
          if (order.version > claimed.sourceVersion && newer.some(row => row.get("payload.cpuProjection") && row.get("payload.bookingId") === bookingId))
            throw new SupersededMirrorIntent();
          if (order.version < claimed.sourceVersion || !claimed.cpuConfirmedAt || orderCalendarEvidence(order) !== claimed.payload.orderEvidence)
            throw new Error("The newer Production Order version has no matching confirmed Calendar authority.");
        }
        if (order.origin !== "hospitality_booking" || order.sourceBookingId !== bookingId || claimed.sourceAggregateId !== orderId)
          throw new Error("The Production Order has different source authority.");
        errorCode = "MIRROR_OPLOC_UNVERIFIED";
        const [bookingSite, orderSite] = await resolveMirrorOplocs([booking.service.oplocId || "", order.destinationOplocId || ""]);
        if (bookingSite.canonicalId !== orderSite.canonicalId || !hospitalityCalendarSiteEnabled(orderSite.canonicalId))
          throw new Error("The booking and order are outside the approved Calendar scope.");
        if (claimed.cpuConfirmedAt) return bookingSite;
        errorCode = "MIRROR_CPU_UNCONFIRMED";
        if (!cpuProjection) throw new Error("Missing live CPU projection evidence.");
        if (cpuProjection.useCancellationOutbox) {
          const delivery = await deliverHospitalityCancellation(hospitalityCancellationEventId(orderId, order.version));
          if (delivery?.delivery.status !== "delivered") throw new Error("CPU withdrawal is still pending.");
        } else {
          const delivery = await notifyCpuProjection(order, cpuProjection.changeType, cpuProjection.idempotencyKey);
          if (delivery.applied !== true) throw new Error("CPU projection was not confirmed.");
        }
        claimed.cpuConfirmedAt = new Date().toISOString();
        return bookingSite;
      },
    });
    if (!pending) throw new Error("The booking has no verifiable Calendar source.");
    const result = await pending.apply();
    next = { ...markEventDelivered(claimed, new Date().toISOString()), calendarDisposition: result.disposition };
  } catch (error) {
    if (error instanceof SupersededMirrorIntent) {
      next = { ...markEventDelivered(claimed, new Date().toISOString()), calendarDisposition: "superseded" };
    } else {
      if (error instanceof MirrorTokenError) errorCode = "MIRROR_DWD_FAILED";
      if (error instanceof HospitalityMirrorSourceError) errorCode = error.code;
      next = markEventFailed(claimed, errorCode, new Date().toISOString());
      console.error(JSON.stringify({ severity: "ERROR", event: "cpux.calendar.hospitality.delivery_failed", eventId, status: next.delivery.status, attempts: next.delivery.attempts, errorCode }));
    }
  }
  const stored = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Event | undefined;
    if (current?.delivery.claimId !== claimId) return current;
    tx.set(ref, record(next));
    return next;
  });
  return stored ? progress(stored) : { eventId, status: "missing" };
}

export type CatchUpCursor = { serviceDate: string; bookingId: string };
export async function hospitalityCatchUp(from: string, through: string, approveHash?: string, after?: CatchUpCursor) {
  const dates = backfillDates(from, through);
  if (!(approveHash ? mirrorEnabled() : mirrorPreviewEnabled())) throw new Error("Calendar mirror delivery is disabled.");
  const first = dates[0], last = dates.at(-1)!;
  const query = db.collection("fikaBookings").where("service.eventDate", ">=", first).where("service.eventDate", "<=", last)
    .orderBy("service.eventDate").orderBy(FieldPath.documentId());
  if (after && (after.serviceDate < first || after.serviceDate > last)) throw new Error("Catch-up cursor is outside the reviewed service date range.");
  const rows = await (after ? query.startAfter(after.serviceDate, after.bookingId) : query).limit(11).get();
  const batch = rows.docs.slice(0, 10);
  const nextCursor = rows.size > batch.length ? { serviceDate: batch.at(-1)!.get("service.eventDate") as string, bookingId: batch.at(-1)!.id } : null;
  const previewPlans: Array<NonNullable<Awaited<ReturnType<typeof prepare>>>> = [];
  const plans: Array<NonNullable<Awaited<ReturnType<typeof prepare>>>> = [];
  const skipped: Array<{ identity: string; eventId: string; serviceDate: string; oplocId: string | null; lifecycleStatus: string; outbox: Array<Record<string, unknown>>; reason: string; diagnostics?: Record<string, unknown> }> = [];
  const bookingIds = batch.map(row => row.id);
  const outboxByBooking = new Map<string, Array<Record<string, unknown>>>();
  for (let offset = 0; offset < bookingIds.length; offset += 30) {
    const snapshot = await queue().where("payload.bookingId", "in", bookingIds.slice(offset, offset + 30)).limit(300).get();
    for (const row of snapshot.docs) {
      const event = row.data() as Event;
      const bookingId = event.payload?.bookingId;
      if (!bookingId) continue;
      const delivery = event.delivery;
      const error = delivery.lastError;
      const safeErrorCode = error && /^[A-Z0-9_]{3,80}$/.test(error) ? error : error ? "ERROR_REDACTED" : undefined;
      const entries = outboxByBooking.get(bookingId) || [];
      entries.push({ eventId: event.eventId, eventType: event.eventType, orderId: event.payload.orderId, occurredAt: event.occurredAt,
        status: delivery.status, attempts: delivery.attempts, lastAttemptAt: delivery.lastAttemptAt || null, deliveredAt: delivery.deliveredAt || null,
        nextEligibleAt: delivery.nextEligibleAt || delivery.nextAttemptAt || null, leaseExpiresAt: delivery.leaseExpiresAt || null, ...(safeErrorCode ? { errorCode: safeErrorCode } : {}) });
      outboxByBooking.set(bookingId, entries);
    }
  }
  for (const row of batch) {
    const booking = row.data() as CanonicalBooking;
    if (!hasRecordedHospitalityHandoff(booking)) {
      skipped.push({ identity: booking.canonicalId, eventId: mirrorEventId("hospitality", booking.canonicalId), serviceDate: booking.service.eventDate, oplocId: booking.service.oplocId || null, lifecycleStatus: booking.lifecycleStatus,
        outbox: outboxByBooking.get(row.id) || [], reason: "ineligible or awaiting successful CPU handoff" });
      continue;
    }
    try {
      const plan = await prepare(booking, true);
      if (plan && plan.inspectionState.identityStatus === "unique" &&
        (plan.preview.fileId || plan.withdrawn && ["cancel", "unchanged", "skip"].includes(plan.preview.disposition))) {
        previewPlans.push(plan);
        if (approveHash) {
          const writable = await prepare(booking, false);
          if (!writable || digest(hospitalityCatchUpWriteIntent(plan.preview)) !== digest(hospitalityCatchUpWriteIntent(writable.preview)) ||
            digest(plan.inspectionState) !== digest(writable.inspectionState))
            throw new Error("Catch-up source or write intent changed during approval verification.");
          plans.push(writable);
        } else plans.push(plan);
      }
      else if (plan && plan.preview.quoteAccess?.status === "missing") skipped.push({ identity: booking.canonicalId, eventId: plan.preview.eventId, serviceDate: booking.service.eventDate, oplocId: booking.service.oplocId || null, lifecycleStatus: booking.lifecycleStatus,
        outbox: outboxByBooking.get(row.id) || [], reason: "The current approved quote PDF is missing or does not match the CPU handoff.", diagnostics: plan.preview });
      else if (plan && plan.preview.quoteAccess?.status === "blocked") skipped.push({ identity: booking.canonicalId, eventId: mirrorEventId("hospitality", booking.canonicalId), serviceDate: booking.service.eventDate, oplocId: booking.service.oplocId || null, lifecycleStatus: booking.lifecycleStatus,
        outbox: outboxByBooking.get(row.id) || [], reason: "current approved quote access is blocked for one or more intended principals", diagnostics: plan.preview });
      else skipped.push({ identity: booking.canonicalId, eventId: mirrorEventId("hospitality", booking.canonicalId), serviceDate: booking.service.eventDate, oplocId: booking.service.oplocId || null, lifecycleStatus: booking.lifecycleStatus,
        outbox: outboxByBooking.get(row.id) || [], reason: "no eligible CPU production lines or current approved quote PDF" });
    } catch (error) {
      skipped.push({ identity: booking.canonicalId, eventId: mirrorEventId("hospitality", booking.canonicalId), serviceDate: booking.service.eventDate, oplocId: booking.service.oplocId || null, lifecycleStatus: booking.lifecycleStatus,
        outbox: outboxByBooking.get(row.id) || [], reason: error instanceof Error ? error.message : "source or mapping unavailable" });
    }
  }
  const events = previewPlans.map(plan => ({ ...plan.preview, outbox: outboxByBooking.get(plan.preview.identity) || [] })).sort((a, b) => a.eventId.localeCompare(b.eventId));
  const planHash = digest({ from, through, after: after || null, nextCursor, events: events.map(event => Object.fromEntries(Object.entries(event).filter(([key]) => key !== "disposition"))), skipped });
  if (!approveHash) return { dryRun: true, scanned: batch.length, events, skipped, nextCursor, planHash };
  if (approveHash !== planHash || approveHash !== process.env.FIKA_CPUX_HOSPITALITY_CATCH_UP_APPROVAL_HASH)
    throw new Error("The current catch-up batch has no matching scoped approval.");
  const results = [];
  for (const plan of plans) {
    try {
      const result = await plan.apply();
      await db.collection("fikaCpuXMirrorCatchUpV1").doc(planHash).collection("events").doc(result.eventId).set({ ...result, sourceRevision: plan.preview.revision, at: new Date().toISOString() });
      results.push(result);
    } catch {
      results.push({ eventId: plan.preview.eventId, disposition: "failed" });
    }
  }
  return { dryRun: false, scanned: batch.length, results, skipped, nextCursor, planHash };
}
