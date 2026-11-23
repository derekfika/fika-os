import { createHash } from "node:crypto";
import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { resolveRcoaDashboardOploc } from "./rcoa-dashboard-bookings";
import type { CanonicalBooking } from "./hospitality-booking-service";
import { evaluateAuthority } from "./authmod-core/evaluator";
import { resolveHospitalityBookingAdmin } from "./hospitality-booking-authorization";
import type { AuthModRepository, AuthPrincipal } from "./authmod-core";
import { HOSPITALITY_INVOICE_REPORT } from "./authmod-core/model";

export const RCOA_INVOICE_REPORT_PAGE_SIZE = 400;
export const RCOA_INVOICE_ELIGIBLE_STATUSES = ["Approved", "Sent to CPU", "Completed"] as const;
const eligibleStatuses = new Set<string>(RCOA_INVOICE_ELIGIBLE_STATUSES);
const ukDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});

export type RcoaInvoiceReportRow = {
  canonicalId: string;
  serviceDate: string;
  serviceTime: string;
  meetingTitle: string;
  bookingReference: string;
  client: string;
  lifecycleStatus: string;
  exVatPence?: number;
  financialIssue?: string;
};

export type RcoaInvoiceReport = {
  startDate: string;
  endDate: string;
  generatedAt: string;
  bookings: RcoaInvoiceReportRow[];
  bookingCount: number;
  confirmedExVatPence: number;
  unresolvedCount: number;
  financialCoverageComplete: boolean;
  excludedCancelledCount: number;
  excludedUnconfirmedCount: number;
  dataDigest: string;
};

export async function requireRcoaInvoiceReportAuthority(repository: AuthModRepository, principal: AuthPrincipal, canonicalOplocId: string) {
  const decision = await evaluateAuthority(repository, {
    principal,
    appId: "hospitality-booking",
    resource: HOSPITALITY_INVOICE_REPORT,
    action: "Manage",
    scope: { kind: "oploc", ids: [canonicalOplocId] },
  });
  if (decision.allowed) return { kind: "report-grant" as const, decision };
  // Existing Hospitality Admin is a separate, explicit company-wide authority.
  const administrator = await resolveHospitalityBookingAdmin(repository, principal, canonicalOplocId);
  if (administrator) return { kind: "hospitality-admin" as const, administrator };
  throw Object.assign(new Error("An effective Hospitality Invoice Report authority for RCoA or company-wide Hospitality Admin authority is required."), { status: 403, code: "AUTHMOD_RCOA_INVOICE_REPORT_DENIED", decision });
}

function fail(message: string, status = 503): never {
  throw Object.assign(new Error(message), { status });
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** RCoA service dates are UK business dates. Date-only values stay date-only; zoned timestamps are converted to Europe/London. */
export function rcoaServiceBusinessDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const input = value.trim();
  if (isCalendarDate(input)) return input;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(input)) return undefined;
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return undefined;
  return ukDate.format(new Date(timestamp));
}

function exactPence(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const source = String(value);
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(source);
  if (!match) return undefined;
  const pence = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  return pence <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(pence) : undefined;
}

function eventTitle(booking: CanonicalBooking) {
  const noteTitle = String(booking.notes || "").match(/^\s*Event:\s*(.+?)\s*$/im)?.[1]?.trim();
  if (noteTitle) return noteTitle;
  const eventType = String(booking.order?.eventType || "Hospitality").trim();
  return eventType.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function clientLabel(booking: CanonicalBooking) {
  // The report needs an accounts-facing organisation label, not personal contact details.
  return String(booking.client?.companyName || booking.client?.clientCompany || "").trim();
}

function resolveCurrentExVatPence(booking: CanonicalBooking): { value?: number; issue?: string } {
  if (!["Approved", "Sent to CPU", "Completed"].includes(booking.lifecycleStatus)) {
    return { issue: "The booking is not in a confirmed or fulfilled state." };
  }
  const revisions = booking.quoteState?.revisions;
  const revision = revisions?.find(item => item.id === booking.quoteState?.currentRevisionId);
  if (!revision) return { issue: "No current quotation revision is recorded." };
  if (revision.stale !== false || revision.commercialVersion !== (booking.commercialVersion || 1)) {
    return { issue: "The current quotation does not match the booking's commercial version." };
  }
  if (revision.pdfStatus !== "saved" || !revision.driveFileId) {
    return { issue: "The current quotation document is not recorded as saved." };
  }
  const snapshot = revision.snapshot as {
    totals?: { net?: { amount?: unknown; currency?: unknown }; vat?: { amount?: unknown; currency?: unknown }; gross?: { amount?: unknown; currency?: unknown } };
  } | undefined;
  const net = snapshot?.totals?.net;
  const vat = snapshot?.totals?.vat;
  const gross = snapshot?.totals?.gross;
  if (!net || !vat || !gross || net.currency !== "GBP" || vat.currency !== "GBP" || gross.currency !== "GBP" || booking.order?.currency !== "GBP") {
    return { issue: "The current quotation has no complete GBP financial snapshot." };
  }
  const netPence = exactPence(net.amount);
  const vatPence = exactPence(vat.amount);
  const grossPence = exactPence(gross.amount);
  const storedNetPence = exactPence(booking.order?.netTotal);
  const storedVatPence = exactPence(booking.order?.vatTotal);
  const storedGrossPence = exactPence(booking.order?.grossTotal);
  if ([netPence, vatPence, grossPence, storedNetPence, storedVatPence, storedGrossPence].some(value => value === undefined) ||
      netPence! + vatPence! !== grossPence! || storedNetPence !== netPence || storedVatPence !== vatPence || storedGrossPence !== grossPence) {
    return { issue: "The current quotation conflicts with the booking's stored financial totals." };
  }
  return { value: netPence };
}

export function buildRcoaInvoiceReport(input: {
  bookings: CanonicalBooking[];
  oplocId: string;
  oplocRedirects?: Record<string, string>;
  startDate: string;
  endDate: string;
  generatedAt?: string;
}): RcoaInvoiceReport {
  if (!isCalendarDate(input.startDate) || !isCalendarDate(input.endDate) || input.endDate < input.startDate) {
    throw Object.assign(new Error("Choose a valid reporting range with an end date on or after the start date."), { status: 422 });
  }
  const rows: RcoaInvoiceReportRow[] = [];
  let excludedCancelledCount = 0;
  let excludedUnconfirmedCount = 0;
  for (const booking of input.bookings) {
    let canonicalOplocId = String(booking.service?.oplocId || "").trim();
    const visited = new Set<string>();
    while (canonicalOplocId && input.oplocRedirects && Object.hasOwn(input.oplocRedirects, canonicalOplocId)) {
      if (visited.has(canonicalOplocId) || visited.size >= 10) return fail("RCoA invoice reporting encountered an invalid OPLOC alias chain.");
      visited.add(canonicalOplocId);
      canonicalOplocId = input.oplocRedirects[canonicalOplocId];
    }
    if (booking.service?.portalSiteId !== "rcoa" || canonicalOplocId !== input.oplocId) {
      return fail("RCoA invoice reporting encountered a booking outside the verified site scope.");
    }
    const serviceDate = rcoaServiceBusinessDate(booking.service?.eventDate);
    if (!serviceDate) return fail("An RCoA booking has an invalid service date; the report cannot prove complete date coverage.");
    if (serviceDate < input.startDate || serviceDate > input.endDate) continue;
    if (booking.lifecycleStatus === "Cancelled") { excludedCancelledCount += 1; continue; }
    if (!eligibleStatuses.has(booking.lifecycleStatus)) { excludedUnconfirmedCount += 1; continue; }
    const financial = resolveCurrentExVatPence(booking);
    rows.push({
      canonicalId: booking.canonicalId,
      serviceDate,
      serviceTime: String(booking.service.startTime || "").trim(),
      meetingTitle: eventTitle(booking),
      bookingReference: String(booking.source?.sourceBookingId || booking.canonicalId).trim(),
      client: clientLabel(booking),
      lifecycleStatus: booking.lifecycleStatus,
      ...(financial.value !== undefined ? { exVatPence: financial.value } : { financialIssue: financial.issue || "Financial review is required." }),
    });
  }
  rows.sort((left, right) => left.serviceDate.localeCompare(right.serviceDate) || left.serviceTime.localeCompare(right.serviceTime) || left.bookingReference.localeCompare(right.bookingReference) || left.canonicalId.localeCompare(right.canonicalId));
  const total = rows.reduce((sum, row) => sum + (row.exVatPence || 0), 0);
  if (!Number.isSafeInteger(total)) return fail("The report total exceeds the safe currency calculation range.");
  const generatedAt = input.generatedAt || new Date().toISOString();
  const digestPayload = { startDate: input.startDate, endDate: input.endDate, bookings: rows, bookingCount: rows.length, confirmedExVatPence: total, excludedCancelledCount, excludedUnconfirmedCount };
  return {
    ...digestPayload,
    generatedAt,
    unresolvedCount: rows.filter(row => row.exVatPence === undefined).length,
    financialCoverageComplete: rows.every(row => row.exVatPence !== undefined),
    dataDigest: createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex"),
  };
}

export async function resolveRcoaInvoiceSourceOploc() {
  const snapshot = await db.collection("integrationHubSourceMappings").where("sourceIdentifier", "==", "rcoa").limit(501).get();
  recordDataAccess({ app: "integration-hub", operation: "hospitality.rcoa-invoice-report.mapping", source: "FIRESTORE", dataset: "integrationHubSourceMappings", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
  if (snapshot.size > 500) return fail("RCoA invoice reporting site mapping is ambiguous.");
  return resolveRcoaDashboardOploc(snapshot.docs.map(document => document.data()));
}

async function readRcoaBookings() {
  const collection = db.collection("fikaBookings");
  const items: CanonicalBooking[] = [];
  const cursors = new Set<string>();
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    let query = collection.where("service.portalSiteId", "==", "rcoa").orderBy(FieldPath.documentId()).limit(RCOA_INVOICE_REPORT_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    recordDataAccess({ app: "integration-hub", operation: "hospitality.rcoa-invoice-report.bookings", source: "FIRESTORE", dataset: "fikaBookings", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
    const page = snapshot.docs;
    items.push(...page.map(document => document.data() as CanonicalBooking));
    if (snapshot.size < RCOA_INVOICE_REPORT_PAGE_SIZE) return items;
    const next = page.at(-1);
    if (!next || cursors.has(next.id)) return fail("RCoA invoice report pagination could not prove a complete result.");
    cursors.add(next.id);
    cursor = next;
  }
}

export async function rcoaInvoiceReport(input: { startDate: string; endDate: string; oplocId?: string; oplocRedirects?: Record<string, string> }) {
  const oplocId = input.oplocId || await resolveRcoaInvoiceSourceOploc();
  const bookings = await readRcoaBookings();
  return buildRcoaInvoiceReport({ bookings, oplocId, oplocRedirects: input.oplocRedirects, startDate: input.startDate, endDate: input.endDate });
}
