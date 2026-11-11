import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export const RCOA_DASHBOARD_PAGE_SIZE = 400;
export const RCOA_DASHBOARD_MAX_BOOKINGS = 8_000;

export type RcoaDashboardBooking = {
  reference: string;
  eventType: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  guestCount: number | null;
  lifecycleStatus: string;
  amended: boolean;
  groupId?: string;
  groupSize?: number;
  groupSequence?: number;
  items: Array<{ name: string; quantity: number | null }>;
};

function fail(message: string, status = 503): never {
  throw Object.assign(new Error(message), { status });
}

export function resolveRcoaDashboardOploc(mappings: Array<Record<string, unknown>>) {
  const candidates = mappings.filter((mapping) =>
    String(mapping.sourceIdentifier || "").trim().toLocaleLowerCase("en-GB") === "rcoa" &&
    String(mapping.sourceEntityType || "") === "provider-location" &&
    String(mapping.mappingStatus || "") === "confirmed" &&
    String(mapping.targetCanonicalId || mapping.oplocId || "").trim(),
  );
  if (candidates.length !== 1) return fail("RCoA dashboard requires one confirmed canonical provider-location mapping.");
  const targetId = String(candidates[0].targetCanonicalId || "").trim();
  const oplocId = String(candidates[0].oplocId || "").trim();
  if (targetId && oplocId && targetId !== oplocId) return fail("RCoA dashboard provider-location mapping contains conflicting canonical identities.");
  const resolved = targetId || oplocId;
  if (!resolved) return fail("RCoA dashboard requires one confirmed canonical provider-location mapping.");
  return resolved;
}

function rcoaOplocId() {
  const snapshotPromise = db.collection("integrationHubSourceMappings").where("sourceIdentifier", "==", "rcoa").limit(501).get();
  return snapshotPromise.then((snapshot) => {
    recordDataAccess({ app: "integration-hub", operation: "hospitality.rcoa-dashboard.mapping", source: "FIRESTORE", dataset: "integrationHubSourceMappings", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
    if (snapshot.size > 500) return fail("RCoA dashboard site mapping is ambiguous.");
    return resolveRcoaDashboardOploc(snapshot.docs.map((document) => document.data()));
  });
}

export function projectRcoaDashboardBooking(booking: CanonicalBooking, expectedOploc: string): RcoaDashboardBooking {
  const service = booking.service;
  if (String(service?.portalSiteId || "") !== "rcoa" || String(service?.oplocId || "") !== expectedOploc) {
    return fail("RCoA dashboard data contains a record outside its verified site and OPLOC scope.");
  }
  const group = booking.bookingGroup;
  return {
    reference: String(booking.source?.sourceBookingId || booking.canonicalId || "").trim(),
    eventType: String(booking.order?.eventType || "Hospitality").trim(),
    eventDate: String(service?.eventDate || "").trim(),
    startTime: String(service?.startTime || "").trim(),
    endTime: String(service?.endTime || "").trim(),
    location: [service?.roomOrArea, service?.floorLevel, service?.deliveryPoint].map((value) => String(value || "").trim()).filter(Boolean).join(" · "),
    guestCount: Number.isFinite(service?.guestCount) ? service.guestCount : null,
    lifecycleStatus: String(booking.lifecycleStatus || "").trim(),
    amended: Array.isArray(booking.audit) && booking.audit.some((event) => /amend/i.test(String(event.action || ""))),
    ...(group?.id ? { groupId: String(group.id), groupSize: Number(group.size) || undefined, groupSequence: Number(group.sequence) || undefined } : {}),
    items: (Array.isArray(booking.order?.items) ? booking.order.items : []).map((item) => ({
      name: String(item.itemName || item.description || "Hospitality item").trim(),
      quantity: Number.isFinite(item.quantity) ? item.quantity : null,
    })),
  };
}

export async function collectBoundedCompletePages<T, C>(input: {
  readPage: (cursor: C | undefined) => Promise<{ items: T[]; nextCursor?: C; hasMore: boolean }>;
  cursorKey: (cursor: C) => string;
  pageSize?: number;
  maxItems?: number;
}) {
  const pageSize = input.pageSize ?? RCOA_DASHBOARD_PAGE_SIZE;
  const maxItems = input.maxItems ?? RCOA_DASHBOARD_MAX_BOOKINGS;
  const items: T[] = [];
  const cursors = new Set<string>();
  let cursor: C | undefined;
  for (let pageIndex = 0; pageIndex <= Math.ceil(maxItems / pageSize); pageIndex += 1) {
    const page = await input.readPage(cursor);
    if (page.items.length > pageSize) return fail("RCoA dashboard page exceeded its requested limit.");
    items.push(...page.items);
    if (items.length > maxItems || (items.length >= maxItems && page.hasMore)) return fail("RCoA dashboard may be incomplete beyond its retrieval limit.");
    if (!page.hasMore) return items;
    if (page.items.length !== pageSize || page.nextCursor === undefined) return fail("RCoA dashboard pagination could not prove a complete result.");
    const key = input.cursorKey(page.nextCursor);
    if (cursors.has(key)) return fail("RCoA dashboard pagination returned a repeated cursor.");
    cursors.add(key);
    cursor = page.nextCursor;
  }
  return fail("RCoA dashboard pagination could not prove a complete result.");
}

/** Narrow, read-only and complete within an explicit bound. Never returns client, price, note, audit, or attachment data. */
export async function rcoaDashboardBookings() {
  const expectedOploc = await rcoaOplocId();
  const collection = db.collection("fikaBookings");
  const rows = await collectBoundedCompletePages<QueryDocumentSnapshot, QueryDocumentSnapshot>({
    cursorKey: document => document.id,
    readPage: async cursor => {
    let query = collection.where("service.portalSiteId", "==", "rcoa").orderBy(FieldPath.documentId()).limit(RCOA_DASHBOARD_PAGE_SIZE + 1);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    recordDataAccess({ app: "integration-hub", operation: "hospitality.rcoa-dashboard.bookings", source: "FIRESTORE", dataset: "fikaBookings", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
    const page = snapshot.docs.slice(0, RCOA_DASHBOARD_PAGE_SIZE);
      return { items: page, nextCursor: page.at(-1), hasMore: snapshot.size > RCOA_DASHBOARD_PAGE_SIZE };
    },
  });
  return rows.map(document => projectRcoaDashboardBooking(document.data() as CanonicalBooking, expectedOploc));
}
