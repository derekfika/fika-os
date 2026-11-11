import { Firestore } from "@google-cloud/firestore";
import { renderPdfToBuffer } from "@fika/server-shared/pdf-renderer";
import { backfillDates, digest, isDriveId, mirrorRecipients } from "../../../shared/cpux-calendar/contract";
import { configuredMirrorTarget, mirrorEnabled, mirrorPreviewEnabled, openMirrorClient } from "../../../shared/cpux-calendar/google";
import type { DurableDomainEvent } from "../fika-contracts";
import { listMenuPublicationsForDateRange } from "../menu-publication";
import { deliveredInMirrorSource, deliveredInOplocIds, weekForServiceDate, type MirrorOploc } from "./source";
import { menuPlanningHubBaseUrl } from "../hub-url";

let firestore: Firestore | undefined;
const db = () => firestore ||= new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID });
const nextWeek = (week: string) => new Date(Date.parse(week + "T00:00:00Z") + 7 * 86_400_000).toISOString().slice(0, 10);

async function loadPublications(from: string, through: string) {
  const publications = await listMenuPublicationsForDateRange(weekForServiceDate(from), nextWeek(weekForServiceDate(through)));
  if (publications.length >= 16) throw new Error("Publication inventory is incomplete; use a smaller date range.");
  return publications;
}
async function prepare(date: string, publications: Awaited<ReturnType<typeof loadPublications>>, readOnly = false) {
  const ids = deliveredInOplocIds(date, publications);
  const oplocs = new Map<string, MirrorOploc>();
  if (ids.length) {
    const token = process.env.FIKA_INTERNAL_API_TOKEN;
    if (!token || ids.length > 64) throw new Error("A bounded authorised OPLOC lookup is required.");
    const response = await fetch(menuPlanningHubBaseUrl() + "/api/internal/cpux-mirror/oplocs", {
      method: "POST", headers: { "content-type": "application/json", "x-fika-internal-token": token },
      body: JSON.stringify({ ids }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("OPLOC authority is unavailable.");
    const body = await response.json() as { oplocs?: MirrorOploc[] };
    for (const record of body.oplocs || []) {
      if (!ids.includes(record.sourceId) || oplocs.has(record.sourceId) || !record.canonicalId?.startsWith("oploc:") || !record.label?.trim())
        throw new Error("OPLOC authority returned ambiguous destination evidence.");
      oplocs.set(record.sourceId, record);
    }
    if (oplocs.size !== ids.length) throw new Error("OPLOC authority returned incomplete destination evidence.");
  }
  const model = deliveredInMirrorSource(date, publications, oplocs);
  if (!model) return;
  const target = configuredMirrorTarget("delivered-in", undefined);
  const api = await openMirrorClient(target, process.env, fetch, readOnly);
  const inspected = readOnly ? await api.inspectEvent(model.source) : undefined;
  const observation = inspected?.observation || await api.inspect(model.source);
  const revision = digest(model.source.sourceReference);
  const folderId = process.env.FIKA_CPUX_DELIVERED_IN_RUN_SHEET_FOLDER_ID;
  if (model.runSheetHtml) {
    if (!isDriveId(folderId)) throw new Error("An approved run sheet folder is required.");
    await api.verifyRunSheetFolder(folderId);
  }
  const binding = db().collection("fikaCpuXMirrorBindingsV1").doc(observation.eventId);
  const prior = await binding.get();
  if (prior.exists && prior.get("calendarId") !== target.calendarId) throw new Error("Calendar organiser changed; operator review is required.");
  const reservation = db().collection("fikaCpuXRunSheetReservationsV1").doc(revision);
  const reserved = await reservation.get();
  const pdfId: unknown = reserved.get("fileId");
  if (model.runSheetHtml && observation.disposition === "unchanged") {
    if (!isDriveId(pdfId) || reserved.get("folderId") !== folderId) throw new Error("The current run sheet reservation is missing or ambiguous.");
    await api.verifiedPdf(pdfId, model.title);
  }
  return {
    preview: { ...observation, serviceDate: date, sourceRevision: model.source.revision, revision, calendarId: target.calendarId,
      attendees: mirrorRecipients(target), folderId: folderId || null, folderAccessVerified: Boolean(model.runSheetHtml && folderId),
      fileId: isDriveId(pdfId) ? pdfId : null, runSheet: model.runSheetHtml ? "current-published-revision" : "not-required",
      ...(readOnly ? { identityStatus: inspected?.identityStatus, currentEvent: inspected?.currentEvent || null,
        conflictingEvents: inspected?.conflictingEvents || [], attendeeCopies: await api.inspectAttendeeCopies(model.source) } : {}) },
    apply: async () => {
      if (observation.disposition === "skip" || observation.disposition === "unchanged") return observation;
      // A recorded reservation, not a title/search, is the document idempotency key.
      const proposed = !model.runSheetHtml ? null : isDriveId(pdfId) ? pdfId : await api.allocatePdfId();
      const fileId = await db().runTransaction(async tx => {
        const currentBinding = await tx.get(binding);
        const currentReservation = proposed ? await tx.get(reservation) : null;
        if (currentBinding.exists && currentBinding.get("calendarId") !== target.calendarId) throw new Error("Calendar organiser changed during delivery.");
        if (!currentBinding.exists) tx.create(binding, { calendarId: target.calendarId, eventId: observation.eventId, stream: "delivered-in" });
        if (!proposed) return;
        if (currentReservation?.exists) {
          const reserved: unknown = currentReservation.get("fileId");
          if (!isDriveId(reserved) || currentReservation.get("folderId") !== folderId) throw new Error("The existing run sheet reservation requires review.");
          return reserved;
        }
        tx.create(reservation, { fileId: proposed, folderId, revision, serviceDate: date });
        return proposed;
      });
      const document = fileId && model.runSheetHtml && folderId
        ? await api.storeRunSheet(fileId, folderId, revision, model.title, () => renderPdfToBuffer(model.runSheetHtml!))
        : undefined;
      const current = deliveredInMirrorSource(date, await loadPublications(date, date), oplocs);
      if (!current || current.source.sourceReference !== model.source.sourceReference || current.source.revision !== model.source.revision)
        throw new Error("The published day changed after Calendar preparation.");
      return api.publish(model.source, model.details, document);
    },
  };
}

export async function deliverDeliveredInMirror(event: DurableDomainEvent) {
  if (!mirrorEnabled()) throw new Error("Delivered-In Calendar mirror delivery is disabled.");
  const { serviceDate } = event.payload as { serviceDate?: string };
  if (!serviceDate) throw new Error("The publication Calendar obligation has no service date.");
  const plan = await prepare(serviceDate, await loadPublications(serviceDate, serviceDate));
  if (!plan) throw new Error("No authoritative publication state was found for the obligation.");
  await plan.apply();
}

export async function deliveredInCatchUp(from: string, through: string, approveHash?: string) {
  const dates = backfillDates(from, through);
  if (!(approveHash ? mirrorEnabled() : mirrorPreviewEnabled())) throw new Error("Delivered-In Calendar mirror delivery is disabled.");
  const publications = await loadPublications(from, through);
  const outboxSnapshot = await db().collection("fikaMenuPlanningOutbox").where("payload.serviceDate", ">=", dates[0])
    .where("payload.serviceDate", "<=", dates.at(-1)!).limit(200).get();
  if (outboxSnapshot.size >= 200) throw new Error("Calendar outbox inventory is incomplete; use a smaller date range.");
  const outboxByDate = new Map<string, Array<Record<string, unknown>>>();
  for (const row of outboxSnapshot.docs) {
    const event = row.data() as DurableDomainEvent & { payload?: { serviceDate?: string } };
    const serviceDate = event.payload?.serviceDate;
    if (!serviceDate) continue;
    const error = event.delivery.lastError;
    const errorCode = error && /^[A-Z0-9_]{3,80}$/.test(error) ? error : error ? "ERROR_REDACTED" : undefined;
    const records = outboxByDate.get(serviceDate) || [];
    records.push({ eventId: event.eventId, eventType: event.eventType, sourceAggregateId: event.sourceAggregateId,
      sourceVersion: event.sourceVersion, status: event.delivery.status, attempts: event.delivery.attempts,
      lastAttemptAt: event.delivery.lastAttemptAt || null, deliveredAt: event.delivery.deliveredAt || null,
      nextEligibleAt: event.delivery.nextEligibleAt || event.delivery.nextAttemptAt || null, leaseExpiresAt: event.delivery.leaseExpiresAt || null,
      ...(errorCode ? { errorCode } : {}) });
    outboxByDate.set(serviceDate, records);
  }
  const plans: Array<NonNullable<Awaited<ReturnType<typeof prepare>>>> = [];
  const skipped: Array<{ serviceDate: string; reason: string }> = [];
  for (const date of dates) {
    try {
      const plan = await prepare(date, publications, !approveHash);
      if (plan && (plan.preview.runSheet !== "not-required" || ["cancel", "unchanged", "skip"].includes(plan.preview.disposition)))
        plans.push(plan);
      else skipped.push({ serviceDate: date, reason: "no current published demand" });
    } catch (error) {
      skipped.push({ serviceDate: date, reason: error instanceof Error ? error.message : "publication or mapping unavailable" });
    }
  }
  const events = plans.map(plan => ({ ...plan.preview, outbox: outboxByDate.get(plan.preview.serviceDate) || [] }));
  const planHash = digest({ from, through, events: events.map(({ disposition: _disposition, fileId: _reservedFileId, ...event }) => event), skipped });
  if (!approveHash) return { dryRun: true, scanned: dates.length, events, skipped, planHash };
  if (approveHash !== planHash || approveHash !== process.env.FIKA_CPUX_DELIVERED_IN_CATCH_UP_APPROVAL_HASH)
    throw new Error("The current catch-up batch has no matching scoped approval.");
  const results = [];
  for (const plan of plans) {
    try {
      const result = await plan.apply();
      await db().collection("fikaCpuXMirrorCatchUpV1").doc(planHash).collection("events").doc(result.eventId).set({ ...result, sourceRevision: plan.preview.sourceRevision, at: new Date().toISOString() });
      results.push(result);
    }
    catch { results.push({ eventId: plan.preview.eventId, disposition: "failed" }); }
  }
  return { dryRun: false, scanned: dates.length, results, skipped, planHash };
}
