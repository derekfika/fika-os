import { createHash } from "node:crypto";
import { FieldPath, type DocumentSnapshot } from "firebase-admin/firestore";
import { eventIsDue, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { db } from "../firebase-admin";
import type { CanonicalBooking } from "../hospitality-booking-service";
import type { ProductionOrder } from "../production-domain";
import { RCOA_HOSPITALITY_OPLOC_ID } from "../booking-email-site-identities";
import { mirrorEnabled } from "../../../shared/cpux-calendar/google";
import { inspectMirrorOplocs } from "./oplocs";
import { dueHospitalityMirrorQuery } from "./outbox-query";

export const HOSPITALITY_MIRROR_SCHEDULER_BATCH_LIMIT = 3;
const OUTBOX_COLLECTION = "fikaCpuXHospitalityMirrorOutboxV1";
const DELIVERY_STATES = new Set(["pending", "failed", "delivered", "dead-letter"]);
const safeId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("/");
const safeTimestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const objectValue = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

type OutboxCursor = { documentId: string; asOf: string };

export type OutboxInventoryInput = { after?: OutboxCursor; limit: number };

export function classifyHospitalityMirrorOutboxRecord(documentId: string, rawValue: unknown, asOf: string, schedulerRank?: number) {
  const raw = objectValue(rawValue);
  const delivery = objectValue(raw?.delivery);
  const payload = objectValue(raw?.payload);
  const status = typeof delivery?.status === "string" ? delivery.status : null;
  const attempts = typeof delivery?.attempts === "number" && Number.isInteger(delivery.attempts) && delivery.attempts >= 0 ? delivery.attempts : null;
  const topLevelNextEligibleAt = raw?.nextEligibleAt;
  const queryTimeValid = safeTimestamp(topLevelNextEligibleAt);
  const workerQueryDue = queryTimeValid && (topLevelNextEligibleAt as string) <= asOf;
  let leaseState: "none" | "active" | "expired" | "legacy-active" | "invalid" = "none";
  if (delivery?.leaseExpiresAt !== undefined) {
    leaseState = safeTimestamp(delivery.leaseExpiresAt)
      ? (Date.parse(delivery.leaseExpiresAt as string) > Date.parse(asOf) ? "active" : "expired")
      : "invalid";
  } else if (delivery?.claimedAt !== undefined) {
    leaseState = safeTimestamp(delivery.claimedAt)
      ? (Date.parse(asOf) - Date.parse(delivery.claimedAt as string) < 60_000 ? "legacy-active" : "expired")
      : "invalid";
  }

  const eventShapeValid = Boolean(raw && typeof raw.eventId === "string" && typeof raw.eventType === "string" &&
    safeId(payload?.bookingId) && safeId(payload?.orderId) && DELIVERY_STATES.has(status || "") && attempts !== null);
  let eventIsDueAtSnapshot = false;
  if (raw && delivery && DELIVERY_STATES.has(status || "") && attempts !== null) {
    try { eventIsDueAtSnapshot = eventIsDue(raw as unknown as DurableDomainEvent, new Date(asOf)); }
    catch { eventIsDueAtSnapshot = false; }
  }
  const anomalies: string[] = [];
  if (!raw) anomalies.push("record-not-object");
  if (typeof raw?.eventId !== "string" || !raw.eventId) anomalies.push("event-id-missing");
  else if (raw.eventId !== documentId) anomalies.push("document-id-event-id-mismatch");
  if (typeof raw?.eventType !== "string" || !raw.eventType) anomalies.push("event-type-missing");
  if (!safeId(payload?.bookingId)) anomalies.push("booking-id-missing-or-invalid");
  if (!safeId(payload?.orderId)) anomalies.push("order-id-missing-or-invalid");
  if (!DELIVERY_STATES.has(status || "")) anomalies.push("delivery-status-invalid");
  if (raw?.outboxStatus !== undefined && raw.outboxStatus !== status) anomalies.push("delivery-outbox-status-mismatch");
  if (attempts === null) anomalies.push("attempt-count-invalid");
  if (topLevelNextEligibleAt !== undefined && !queryTimeValid) anomalies.push("next-eligible-time-invalid");
  if (delivery?.leaseExpiresAt !== undefined && leaseState === "invalid") anomalies.push("lease-expiry-invalid");
  if (delivery?.claimedAt !== undefined && leaseState === "invalid") anomalies.push("claim-time-invalid");

  const error = typeof delivery?.lastError === "string" ? delivery.lastError : "";
  const errorCode = error ? (/^[A-Z0-9_]{3,80}$/.test(error) ? error : "ERROR_REDACTED") : null;
  return {
    documentId,
    eventId: typeof raw?.eventId === "string" ? raw.eventId : null,
    eventType: typeof raw?.eventType === "string" ? raw.eventType : null,
    sourceAggregateId: typeof raw?.sourceAggregateId === "string" ? raw.sourceAggregateId : null,
    sourceVersion: typeof raw?.sourceVersion === "number" ? raw.sourceVersion : null,
    occurredAt: safeTimestamp(raw?.occurredAt) ? raw!.occurredAt : null,
    bookingId: safeId(payload?.bookingId) ? payload!.bookingId as string : null,
    orderId: safeId(payload?.orderId) ? payload!.orderId as string : null,
    persistedStatus: status,
    outboxStatus: typeof raw?.outboxStatus === "string" ? raw.outboxStatus : null,
    statusConsistent: raw?.outboxStatus === undefined || raw.outboxStatus === status,
    attempts,
    nextEligibleAt: safeTimestamp(topLevelNextEligibleAt) ? topLevelNextEligibleAt : null,
    nestedNextEligibleAt: safeTimestamp(delivery?.nextEligibleAt) ? delivery!.nextEligibleAt : null,
    nextAttemptAt: safeTimestamp(delivery?.nextAttemptAt) ? delivery!.nextAttemptAt : null,
    lastAttemptAt: safeTimestamp(delivery?.lastAttemptAt) ? delivery!.lastAttemptAt : null,
    deliveredAt: safeTimestamp(delivery?.deliveredAt) ? delivery!.deliveredAt : null,
    deadLetteredAt: safeTimestamp(delivery?.deadLetteredAt) ? delivery!.deadLetteredAt : null,
    errorCode,
    leaseState,
    workerQueryDue,
    eventIsDueAtSnapshot,
    workerEligibleAtSnapshot: workerQueryDue && eventIsDueAtSnapshot,
    schedulerQueryRank: schedulerRank ?? null,
    wouldBeClaimedIfUnchanged: schedulerRank !== undefined && eventIsDueAtSnapshot,
    operationalClass: leaseState === "active" || leaseState === "legacy-active"
      ? "leased"
      : status === "delivered" || status === "dead-letter"
        ? status
        : status === "failed"
          ? (workerQueryDue && eventIsDueAtSnapshot ? "retry-eligible" : "failed-waiting")
          : status === "pending"
            ? (workerQueryDue && eventIsDueAtSnapshot ? "pending-eligible" : "pending-waiting")
            : "malformed-or-unknown",
    recordShape: eventShapeValid ? "valid" : "malformed",
    anomalies,
  };
}

function sourceRows(document: DocumentSnapshot[], asOf: string, schedulerRanks: Map<string, number>) {
  if (!document.length) return Promise.resolve([]);
  const bookingIds = [...new Set(document.map(row => {
    const payload = objectValue(row.get("payload"));
    return safeId(payload?.bookingId) ? payload.bookingId : null;
  }).filter((value): value is string => Boolean(value)))];
  const orderIds = [...new Set(document.map(row => {
    const payload = objectValue(row.get("payload"));
    return safeId(payload?.orderId) ? payload.orderId : null;
  }).filter((value): value is string => Boolean(value)))];
  const bookingRefs = bookingIds.map(id => db.collection("fikaBookings").doc(id));
  const orderRefs = orderIds.map(id => db.collection("fikaProductionOrdersV1").doc(stableDocumentId(id)));
  return Promise.all([
    bookingRefs.length ? db.getAll(...bookingRefs) : Promise.resolve([]),
    orderRefs.length ? db.getAll(...orderRefs) : Promise.resolve([]),
  ]).then(async ([bookingSnapshots, orderSnapshots]) => {
    const bookings = new Map(bookingSnapshots.map(row => [row.id, row.exists ? row.data() as CanonicalBooking : undefined]));
    const orders = new Map<string, ProductionOrder | undefined>();
    orderIds.forEach((id, index) => { const row = orderSnapshots[index]; orders.set(id, row?.exists ? row.data() as ProductionOrder : undefined); });
    const rawOplocIds = [...new Set([
      ...[...bookings.values()].map(booking => booking?.service?.oplocId),
      ...[...orders.values()].map(order => order?.destinationOplocId),
    ].filter((id): id is string => typeof id === "string" && id.length > 0))];
    const inspections = await inspectMirrorOplocs(rawOplocIds);
    const oplocMap = new Map(inspections.map(row => [row.sourceId, row.status === "verified" ? row.canonicalId : null]));
    const make = (row: DocumentSnapshot) => {
      const raw = row.data();
      const entry = classifyHospitalityMirrorOutboxRecord(row.id, raw, asOf, schedulerRanks.get(row.id));
      const bookingId = entry.bookingId;
      const orderId = entry.orderId;
      const booking = bookingId ? bookings.get(bookingId) : undefined;
      const order = orderId ? orders.get(orderId) : undefined;
      const bookingExists = Boolean(booking);
      const orderExists = Boolean(order);
      const rawBookingOplocId = booking?.service?.oplocId || null;
      const rawOrderOplocId = order?.destinationOplocId || null;
      const bookingCanonicalOplocId = rawBookingOplocId ? oplocMap.get(rawBookingOplocId) || null : null;
      const orderCanonicalOplocId = rawOrderOplocId ? oplocMap.get(rawOrderOplocId) || null : null;
      const bookingIdMatches = bookingExists && booking!.canonicalId === bookingId;
      const orderIdMatches = orderExists && order!.canonicalId === orderId;
      const anomalies = [...entry.anomalies];
      if (bookingId && !bookingExists) anomalies.push("canonical-booking-orphaned");
      if (bookingExists && !bookingIdMatches) anomalies.push("booking-canonical-id-mismatch");
      if (orderId && !orderExists) anomalies.push("production-order-orphaned");
      if (orderExists && !orderIdMatches) anomalies.push("order-canonical-id-mismatch");
      if (orderExists && bookingId && order!.sourceBookingId !== bookingId) anomalies.push("order-source-booking-mismatch");
      if (orderExists && typeof raw?.sourceAggregateId === "string" && order!.canonicalId !== raw.sourceAggregateId) anomalies.push("source-aggregate-order-mismatch");
      if (orderExists && typeof raw?.sourceVersion === "number" && order!.version !== raw.sourceVersion) anomalies.push("source-version-order-mismatch");
      if (bookingExists && rawBookingOplocId && !bookingCanonicalOplocId) anomalies.push("booking-oploc-unresolved");
      if (orderExists && rawOrderOplocId && !orderCanonicalOplocId) anomalies.push("order-oploc-unresolved");
      const oplocMatches = bookingCanonicalOplocId && orderCanonicalOplocId ? bookingCanonicalOplocId === orderCanonicalOplocId : null;
      if (oplocMatches === false) anomalies.push("booking-order-oploc-mismatch");
      const isRcoa = bookingCanonicalOplocId ? bookingCanonicalOplocId === RCOA_HOSPITALITY_OPLOC_ID : null;
      return {
        ...entry,
        anomalies: [...new Set(anomalies)],
        booking: bookingExists ? {
          status: bookingIdMatches ? "joined" : "identity-mismatch",
          canonicalId: booking!.canonicalId || null,
          serviceDate: booking!.service?.eventDate || null,
          lifecycleStatus: booking!.lifecycleStatus || null,
          rawOplocId: rawBookingOplocId,
          canonicalOplocId: bookingCanonicalOplocId,
          oplocVerification: rawBookingOplocId ? (bookingCanonicalOplocId ? "verified" : "unresolved") : "missing",
          isRcoa,
        } : { status: bookingId ? "orphaned" : "missing-identity", isRcoa: null },
        productionOrder: orderExists ? {
          status: orderIdMatches ? "joined" : "identity-mismatch",
          canonicalId: order!.canonicalId || null,
          version: typeof order!.version === "number" ? order!.version : null,
          orderStatus: order!.status || null,
          origin: order!.origin || null,
          sourceBookingId: order!.sourceBookingId || null,
          sourceBookingMatches: Boolean(bookingId && order!.sourceBookingId === bookingId),
          rawOplocId: rawOrderOplocId,
          canonicalOplocId: orderCanonicalOplocId,
          oplocVerification: rawOrderOplocId ? (orderCanonicalOplocId ? "verified" : "unresolved") : "missing",
          oplocMatchesBooking: oplocMatches,
        } : { status: orderId ? "orphaned" : "missing-identity", oplocMatchesBooking: null },
      };
    };
    return document.map(make);
  });
}

/** A deliberately bounded, read-only inventory. Each page contains every document, including malformed and orphaned rows. */
export async function readHospitalityMirrorOutboxInventory(input: OutboxInventoryInput, now = new Date()) {
  const asOf = input.after?.asOf || now.toISOString();
  const base = db.collection(OUTBOX_COLLECTION).orderBy(FieldPath.documentId());
  const pageQuery = input.after ? base.startAfter(input.after.documentId) : base;
  const [pageSnapshot, schedulerSnapshot] = await Promise.all([
    pageQuery.limit(input.limit + 1).get(),
    dueHospitalityMirrorQuery(db.collection(OUTBOX_COLLECTION), asOf, HOSPITALITY_MIRROR_SCHEDULER_BATCH_LIMIT).get(),
  ]);
  const pageRows = pageSnapshot.docs.slice(0, input.limit);
  const nextCursor: OutboxCursor | null = pageSnapshot.docs.length > input.limit && pageRows.length
    ? { documentId: pageRows.at(-1)!.id, asOf }
    : null;
  const schedulerRanks = new Map(schedulerSnapshot.docs.map((row, index) => [row.id, index + 1]));
  const deliveryEnabled = mirrorEnabled();
  const allRows = [...new Map([...pageRows, ...schedulerSnapshot.docs].map(row => [row.id, row])).values()];
  const mapped = await sourceRows(allRows, asOf, schedulerRanks);
  const byId = new Map(mapped.map(row => [row.documentId, row]));
  const records = pageRows.map(row => byId.get(row.id)!);
  const schedulerCandidates = schedulerSnapshot.docs.map(row => byId.get(row.id)!);
  const fingerprint = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  const stateCounts: Record<string, number> = {};
  for (const row of records) {
    const state = row.recordShape === "malformed" ? "malformed" : row.persistedStatus || "missing-status";
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  }
  return {
    readOnly: true as const,
    collection: OUTBOX_COLLECTION,
    asOf,
    page: { scanned: records.length, stateCounts, fingerprint, records },
    nextCursor,
    scheduler: {
      deliveryEnabled,
      wouldRunIfSchedulerResumed: deliveryEnabled && schedulerCandidates.length > 0,
      batchLimit: HOSPITALITY_MIRROR_SCHEDULER_BATCH_LIMIT,
      query: "nextEligibleAt <= asOf ordered by nextEligibleAt, then eventIsDue rechecked before claim",
      candidates: schedulerCandidates.map(row => ({
        ...row,
        schedulerWillAttemptIfResumed: deliveryEnabled && row.wouldBeClaimedIfUnchanged,
      })),
    },
  };
}
