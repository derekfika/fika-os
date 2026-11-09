import { randomUUID } from "node:crypto";
import { FieldPath, type Transaction } from "firebase-admin/firestore";
import { claimEvent, eventIsDue, markEventDelivered, markEventFailed, outboxRecord, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { db } from "../firebase-admin";
import type { ProductionOrder } from "../production-domain";
import type { CanonicalBooking } from "../hospitality-booking-service";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { backfillDates, digest, londonServiceDate, mirrorEventId, mirrorRecipients } from "../../../shared/cpux-calendar/contract";
import { mirrorEnabled, mirrorPreviewEnabled, openMirrorClient } from "../../../shared/cpux-calendar/google";
import { hospitalityCalendarSiteEnabled, resolveHospitalityCalendarTarget } from "../hospitality-calendar-integration";
import { hasCurrentHospitalityHandoff, hospitalityMirrorSource } from "./source";
import { resolveMirrorOplocs } from "./oplocs";

const queue = () => db.collection("fikaCpuXHospitalityMirrorOutboxV1");
type Intent = { bookingId: string; orderId: string };
type Event = DurableDomainEvent<Intent>;
export function stageHospitalityMirrorIntent(transaction: Transaction, event: DurableDomainEvent) {
  if (!mirrorEnabled() || !["production.order.created", "production.order.amended", "production.order.withdrawn", "production.order.cancelled"].includes(event.eventType)) return;
  const order = (event.payload as { productionOrder?: ProductionOrder }).productionOrder;
  if (order?.origin !== "hospitality_booking" || !order.sourceBookingId || !order.canonicalId) return;
  if (!hospitalityCalendarSiteEnabled(order.destinationOplocId)) return;
  const today = londonServiceDate(new Date(event.occurredAt));
  if (!today || !order.serviceDate || order.serviceDate < today) return;
  const obligation: Event = {
    ...event, eventType: "cpux.calendar.hospitality", payload: { bookingId: order.sourceBookingId, orderId: order.canonicalId },
    delivery: { status: "pending", attempts: 0 },
  };
  transaction.set(queue().doc(event.eventId), outboxRecord(obligation));
}

async function prepare(booking: CanonicalBooking, readOnly = false) {
  const orders = await db.collection("fikaProductionOrdersV1").where("sourceBookingId", "==", booking.canonicalId).limit(26).get();
  if (orders.size > 25) throw new Error("The booking has too many Production Order revisions to verify automatically.");
  const terminal = new Set(["amended", "cancelled", "rejected"]);
  const currentOrders = orders.docs.map(row => row.data() as ProductionOrder).filter(order => order.origin === "hospitality_booking" && !order.supersededBy);
  const active = currentOrders.filter(order => !terminal.has(order.status));
  if (active.length > 1 || (!active.length && currentOrders.length > 1)) throw new Error("The booking has ambiguous current Production Orders.");
  const order = active[0] || currentOrders[0];
  const model = hospitalityMirrorSource(booking, order);
  if (!model) return;
  const [site] = await resolveMirrorOplocs([model.site]);
  if (!hospitalityCalendarSiteEnabled(site.canonicalId)) throw new Error("Hospitality Calendar delivery is disabled for this site.");
  const target = resolveHospitalityCalendarTarget(site.canonicalId);
  const key = mirrorEventId("hospitality", booking.canonicalId);
  const binding = db.collection("fikaCpuXMirrorBindingsV1").doc(key);
  const prior = await binding.get();
  const api = await openMirrorClient(target, process.env, fetch, readOnly);
  const verifiedBinding = await api.verifyCalendarBinding();
  if (prior.exists && (prior.get("calendarId") !== target.calendarId || prior.get("organizerMailbox") !== target.subject || prior.get("accessRole") !== verifiedBinding.accessRole))
    throw new Error("Calendar organiser binding changed or lacks historical verification; operator review is required.");
  const plan = await api.inspect(model.source);
  if (!prior.exists && !model.source.withdrawn && plan.disposition !== "create")
    throw new Error("An existing mirror event lacks a persisted verified Calendar binding; operator review is required.");
  const document = model.fileId ? await api.verifiedPdf(model.fileId, "Approved Hospitality quote.pdf") : undefined;
  return {
    preview: { ...plan, identity: booking.canonicalId, revision: model.source.revision, referenceHash: digest(model.source.sourceReference), calendarId: target.calendarId, organizerMailbox: target.subject, calendarAccessRole: verifiedBinding.accessRole, attendees: mirrorRecipients(target), fileId: document?.fileId || null },
    apply: async () => {
      if (plan.disposition === "skip" || plan.disposition === "unchanged") return plan;
      await db.runTransaction(async tx => {
        const current = await tx.get(binding);
        if (current.exists && (current.get("calendarId") !== target.calendarId || current.get("organizerMailbox") !== target.subject || current.get("accessRole") !== verifiedBinding.accessRole)) throw new Error("The Calendar organiser binding changed during delivery.");
        if (!current.exists) tx.create(binding, { calendarId: target.calendarId, organizerMailbox: target.subject, accessRole: verifiedBinding.accessRole, eventId: key, stream: "hospitality" });
      });
      const current = (await db.collection("fikaBookings").doc(booking.canonicalId).get()).data() as CanonicalBooking | undefined;
      if (!current || current.version !== booking.version) throw new Error("The booking changed after Calendar preparation.");
      if (order) {
        const latest = await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(order.canonicalId)).get();
        if (!latest.exists || latest.get("version") !== order.version || latest.get("supersededBy"))
          throw new Error("The Production Order changed after Calendar preparation.");
      }
      return api.publish(model.source, model.details, document);
    },
  };
}

export async function replayHospitalityMirror(limit: number) {
  if (!mirrorEnabled()) throw new Error("Calendar mirror delivery is disabled.");
  const candidates = await queue().where("nextEligibleAt", "<=", new Date().toISOString()).orderBy("nextEligibleAt").limit(limit).get();
  const results: Array<{ eventId: string; status: string }> = [];
  for (const { ref, id } of candidates.docs) {
    const claimId = randomUUID();
    const claimed = await db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data() as Event | undefined;
      if (!row || !eventIsDue(row)) return;
      const next = claimEvent(row, claimId, new Date().toISOString(), 180_000);
      tx.set(ref, outboxRecord(next));
      return next;
    });
    if (!claimed) continue;
    let next: Event;
    try {
      const row = await db.collection("fikaBookings").doc(claimed.payload.bookingId).get();
      if (!row.exists) throw new Error("The source booking is unavailable.");
      const pending = await prepare(row.data() as CanonicalBooking);
      if (pending) await pending.apply();
      next = markEventDelivered(claimed, new Date().toISOString());
    } catch {
      // Provider errors can contain booking data. Keep only an operational failure code.
      next = markEventFailed(claimed, "CPUX_HOSPITALITY_MIRROR_FAILED", new Date().toISOString());
    }
    await db.runTransaction(async tx => {
      if ((await tx.get(ref)).get("delivery.claimId") === claimId) tx.set(ref, outboxRecord(next));
    });
    results.push({ eventId: id, status: next.delivery.status });
  }
  return results;
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
  const plans: Array<NonNullable<Awaited<ReturnType<typeof prepare>>>> = [];
  const skipped: Array<{ identity: string; reason: string }> = [];
  for (const row of batch) {
    const booking = row.data() as CanonicalBooking;
    if (!hasCurrentHospitalityHandoff(booking)) continue;
    try {
      const plan = await prepare(booking, !approveHash);
      if (plan && plan.preview.fileId) plans.push(plan);
      else skipped.push({ identity: booking.canonicalId, reason: "no eligible CPU production lines" });
    } catch (error) {
      skipped.push({ identity: booking.canonicalId, reason: error instanceof Error ? error.message : "source or mapping unavailable" });
    }
  }
  const events = plans.map(plan => plan.preview).sort((a, b) => a.eventId.localeCompare(b.eventId));
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
