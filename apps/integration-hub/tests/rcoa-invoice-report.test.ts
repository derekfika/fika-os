import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";
import { buildRcoaInvoiceReport, rcoaServiceBusinessDate } from "../lib/rcoa-invoice-report";
import { MemoryAuthModRepository, V1_APPLICATIONS, assignSite, createAuthIdentity, grantAuthority, grantStandardApplicationAccess, HOSPITALITY_BOOKING_ADMIN, HOSPITALITY_INVOICE_REPORT } from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";
import { requireRcoaInvoiceReportAuthority } from "../lib/rcoa-invoice-report";

const actor: AuthPrincipal = { type: "interactive", id: "actor:admin", displayName: "AUTHMOD Operator", email: "operator@example.test" };
function booking(id: string, overrides: Partial<CanonicalBooking> = {}): CanonicalBooking {
  const net = 120.1, vat = 24.02, gross = 144.12;
  return {
    canonicalId: id, entityType: "Booking", schemaVersion: "fika.hospitality.booking.v1", version: 3,
    lifecycleStatus: "Completed", createdAt: "2024-01-01T00:00:00.000Z", createdBy: "fixture", updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "fixture",
    source: { provider: "rcoa", sourceBookingId: `RCOA-${id}`, submissionTimestamp: "2024-01-01T00:00:00.000Z", contractVersion: "1", originalPayload: {} },
    client: { name: "Sensitive contact", email: "contact@example.test", companyName: "RCoA" },
    service: { eventDate: "2026-11-01", startTime: "09:30", endTime: "10:30", guestCount: 10, portalSiteId: "rcoa", oplocId: "oploc:rcoa" },
    order: { eventType: "event_catering", items: [], netTotal: net, vatTotal: vat, grossTotal: gross, currency: "GBP" },
    dietaries: {}, acknowledgements: {}, attachments: [], statusHistory: [], audit: [], commercialVersion: 1,
    quoteState: { currentRevisionId: `quote:${id}:r1`, revisions: [{ id: `quote:${id}:r1`, revision: 1, createdAt: "2026-10-01T00:00:00.000Z", createdBy: "fixture", documentReference: `quote-${id}.pdf`, commercialVersion: 1, stale: false, pdfStatus: "saved", driveFileId: "file:fixture", snapshot: { totals: { net: { amount: net, currency: "GBP" }, vat: { amount: vat, currency: "GBP" }, gross: { amount: gross, currency: "GBP" } } } }] },
    notes: "Event: Annual meeting",
    ...overrides,
  } as CanonicalBooking;
}

test("RCoA service dates use UK business days for zoned timestamps, including DST boundaries", () => {
  assert.equal(rcoaServiceBusinessDate("2026-03-29"), "2026-03-29");
  assert.equal(rcoaServiceBusinessDate("2026-03-29T23:30:00.000Z"), "2026-03-30", "BST midnight belongs to the next UK service date");
  assert.equal(rcoaServiceBusinessDate("2026-10-25T00:30:00.000Z"), "2026-10-25", "the repeated GMT hour retains its UK calendar day");
  assert.equal(rcoaServiceBusinessDate("2026-10-25T01:30:00.000Z"), "2026-10-25");
  assert.equal(rcoaServiceBusinessDate("2026-02-30"), undefined);
  assert.equal(rcoaServiceBusinessDate("2026-03-29T10:00:00"), undefined, "an unzoned timestamp is ambiguous");
});

test("report date boundaries are inclusive and use service date rather than creation date", () => {
  const result = buildRcoaInvoiceReport({
    oplocId: "oploc:rcoa", startDate: "2026-11-01", endDate: "2026-11-30",
    bookings: [booking("start", { service: { ...booking("start").service, eventDate: "2026-11-01" }, createdAt: "2026-10-01T00:00:00Z" }),
      booking("end", { service: { ...booking("end").service, eventDate: "2026-11-30" }, createdAt: "2027-01-01T00:00:00Z" }),
      booking("before", { service: { ...booking("before").service, eventDate: "2026-10-31" } }),
      booking("after", { service: { ...booking("after").service, eventDate: "2026-12-01" } })],
    generatedAt: "2026-12-01T00:00:00.000Z",
  });
  assert.deepEqual(result.bookings.map(row => row.bookingReference), ["RCOA-start", "RCOA-end"]);
  assert.equal(result.bookingCount, 2);
});

test("confirmed states include past, future and grouped child services once under their own references", () => {
  const first = booking("service-a", { service: { ...booking("service-a").service, eventDate: "2026-02-01", startTime: "09:00" }, bookingGroup: { id: "group:day", sequence: 1, size: 2 } });
  const second = booking("service-b", { service: { ...booking("service-b").service, eventDate: "2026-02-01", startTime: "12:00" }, bookingGroup: { id: "group:day", sequence: 2, size: 2 } });
  const statuses = ["Approved", "Sent to CPU", "Completed"].map((lifecycleStatus, i) => booking(`confirmed-${i}`, { lifecycleStatus: lifecycleStatus as CanonicalBooking["lifecycleStatus"] }));
  const result = buildRcoaInvoiceReport({ oplocId: "oploc:rcoa", startDate: "2026-01-01", endDate: "2026-12-31", bookings: [second, ...statuses, first] });
  assert.equal(result.bookingCount, 5);
  assert.deepEqual(result.bookings.slice(0, 2).map(row => row.bookingReference), ["RCOA-service-a", "RCOA-service-b"]);
  assert.deepEqual(result.bookings.slice(0, 2).map(row => row.exVatPence), [12010, 12010]);
});

test("cancelled, draft and quoted bookings are excluded without affecting confirmed amounts", () => {
  const result = buildRcoaInvoiceReport({ oplocId: "oploc:rcoa", startDate: "2026-11-01", endDate: "2026-11-30", bookings: [
    booking("cancelled", { lifecycleStatus: "Cancelled" }),
    booking("new", { lifecycleStatus: "New" }),
    booking("reviewed", { lifecycleStatus: "Reviewed" }),
    booking("quoted", { lifecycleStatus: "Quoted" }),
    booking("approved", { lifecycleStatus: "Approved" }),
  ] });
  assert.equal(result.bookingCount, 1);
  assert.equal(result.excludedCancelledCount, 1);
  assert.equal(result.excludedUnconfirmedCount, 3);
});

test("exact pence, legitimate zero, and current approved quote snapshots drive totals", () => {
  const a = booking("a", { order: { ...booking("a").order, netTotal: 0.1, vatTotal: 0.02, grossTotal: 0.12 }, quoteState: { currentRevisionId: "qa", revisions: [{ ...booking("a").quoteState!.revisions[0], id: "qa", snapshot: { totals: { net: { amount: 0.1, currency: "GBP" }, vat: { amount: 0.02, currency: "GBP" }, gross: { amount: 0.12, currency: "GBP" } } } }] } });
  const b = booking("b", { order: { ...booking("b").order, netTotal: 0.2, vatTotal: 0.04, grossTotal: 0.24 }, quoteState: { currentRevisionId: "qb", revisions: [{ ...booking("b").quoteState!.revisions[0], id: "qb", snapshot: { totals: { net: { amount: 0.2, currency: "GBP" }, vat: { amount: 0.04, currency: "GBP" }, gross: { amount: 0.24, currency: "GBP" } } } }] } });
  const zero = booking("zero", { order: { ...booking("zero").order, netTotal: 0, vatTotal: 0, grossTotal: 0 }, quoteState: { currentRevisionId: "qz", revisions: [{ ...booking("zero").quoteState!.revisions[0], id: "qz", snapshot: { totals: { net: { amount: 0, currency: "GBP" }, vat: { amount: 0, currency: "GBP" }, gross: { amount: 0, currency: "GBP" } } } }] } });
  const result = buildRcoaInvoiceReport({ oplocId: "oploc:rcoa", startDate: "2026-11-01", endDate: "2026-11-30", bookings: [b, zero, a] });
  assert.equal(result.confirmedExVatPence, 30);
  assert.equal(result.bookings.find(row => row.bookingReference === "RCOA-zero")?.exVatPence, 0);
  assert.equal(result.financialCoverageComplete, true);
});

test("missing, stale, unsaved, non-GBP and conflicting quote metadata are review exceptions", () => {
  const good = booking("good");
  const stale = booking("stale", { quoteState: { ...booking("stale").quoteState!, revisions: [{ ...booking("stale").quoteState!.revisions[0], stale: true }] } });
  const unsaved = booking("unsaved", { quoteState: { ...booking("unsaved").quoteState!, revisions: [{ ...booking("unsaved").quoteState!.revisions[0], pdfStatus: "pending", driveFileId: undefined }] } });
  const wrongVat = booking("vat", { quoteState: { currentRevisionId: "quote:vat:r1", revisions: [{ ...booking("vat").quoteState!.revisions[0], snapshot: { totals: { net: { amount: 120.1, currency: "GBP" }, vat: { amount: 0, currency: "GBP" }, gross: { amount: 144.12, currency: "GBP" } } } }] } });
  const wrongCurrency = booking("currency", { quoteState: { currentRevisionId: "quote:currency:r1", revisions: [{ ...booking("currency").quoteState!.revisions[0], snapshot: { totals: { net: { amount: 120.1, currency: "USD" }, vat: { amount: 24.02, currency: "USD" }, gross: { amount: 144.12, currency: "USD" } } } }] } });
  const missing = booking("missing", { quoteState: { revisions: [] } });
  const result = buildRcoaInvoiceReport({ oplocId: "oploc:rcoa", startDate: "2026-11-01", endDate: "2026-11-30", bookings: [good, stale, unsaved, wrongVat, wrongCurrency, missing] });
  assert.equal(result.unresolvedCount, 5);
  assert.equal(result.confirmedExVatPence, 12010);
  assert.equal(result.financialCoverageComplete, false);
  assert.ok(result.bookings.filter(row => row.exVatPence === undefined).every(row => row.financialIssue));
});

test("a malformed service date or an out-of-scope record fails closed, and bad ranges are rejected", () => {
  assert.throws(() => buildRcoaInvoiceReport({ oplocId: "oploc:rcoa", startDate: "2026-12-01", endDate: "2026-11-01", bookings: [] }), /valid reporting range/);
  assert.throws(() => buildRcoaInvoiceReport({ oplocId: "oploc:rcoa", startDate: "2026-01-01", endDate: "2026-12-31", bookings: [booking("invalid", { service: { ...booking("invalid").service, eventDate: "unknown" } })] }), /invalid service date/);
  assert.throws(() => buildRcoaInvoiceReport({ oplocId: "oploc:rcoa", startDate: "2026-01-01", endDate: "2026-12-31", bookings: [booking("other", { service: { ...booking("other").service, portalSiteId: "angel-court", oplocId: "oploc:munich" } })] }), /outside the verified site scope/);
});

test("digest is stable for the same report rows and excludes only generation time", () => {
  const inputs = { oplocId: "oploc:rcoa", startDate: "2026-11-01", endDate: "2026-11-30", bookings: [booking("stable")] };
  const first = buildRcoaInvoiceReport({ ...inputs, generatedAt: "2026-11-23T10:00:00Z" });
  const second = buildRcoaInvoiceReport({ ...inputs, generatedAt: "2026-11-23T11:00:00Z" });
  assert.equal(first.dataDigest, second.dataDigest);
});

test("invoice report requires explicit site-scoped report authority or existing Hospitality Admin", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:rcoa", label: "RCoA", active: true }, { id: "oploc:other", label: "Other", active: true }] });
  const person = await createAuthIdentity(repository, { actor, displayName: "Manager", email: "manager@example.test", externalProvider: "firebase", externalUid: "uid:manager", provenance: "migration" });
  const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await assignSite(repository, { identityId: person.id, oplocId: "oploc:rcoa", actor, reason: "RCoA site access." });
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor, reason: "Hospitality access." });
  await assert.rejects(() => requireRcoaInvoiceReportAuthority(repository, principal, "oploc:rcoa"), /Invoice Report authority/);
  await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor, appId: "hospitality-booking", resource: HOSPITALITY_INVOICE_REPORT, action: "Manage", scope: { kind: "oploc", ids: ["oploc:rcoa"] }, reason: "Approved RCoA invoice reporting." });
  assert.equal((await requireRcoaInvoiceReportAuthority(repository, principal, "oploc:rcoa")).kind, "report-grant");
  await assert.rejects(() => requireRcoaInvoiceReportAuthority(repository, principal, "oploc:other"), /Invoice Report authority/);
  await assert.rejects(() => grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor, appId: "hospitality-booking", resource: HOSPITALITY_INVOICE_REPORT, action: "Manage", scope: { kind: "organisation", ids: [] }, reason: "Invalid broad authority." }), /one explicit OPLOC/);
});

test("existing explicit company Hospitality Admin may run the RCoA report without a new site grant", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:rcoa", label: "RCoA", active: true }] });
  const person = await createAuthIdentity(repository, { actor, displayName: "Admin", email: "admin@example.test", externalProvider: "firebase", externalUid: "uid:admin", provenance: "migration" });
  const principal: AuthPrincipal = { type: "interactive", id: person.id, displayName: person.displayName };
  await grantStandardApplicationAccess(repository, { identityId: person.id, appId: "hospitality-booking", actor, reason: "Hospitality access." });
  await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor, appId: "hospitality-booking", resource: HOSPITALITY_BOOKING_ADMIN, action: "Manage", scope: { kind: "organisation", ids: [] }, reason: "Existing Hospitality Admin authority." });
  assert.equal((await requireRcoaInvoiceReportAuthority(repository, principal, "oploc:rcoa")).kind, "hospitality-admin");
});
