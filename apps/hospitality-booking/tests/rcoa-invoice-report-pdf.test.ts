import assert from "node:assert/strict";
import test from "node:test";
import { formatGbpPence, rcoaInvoiceReportHtml } from "../lib/rcoa-invoice-report-pdf";
import type { RcoaInvoiceReport } from "../lib/rcoa-invoice-report-contract";
import { QUOTE_FONT_FACE_CSS, quoteMastheadHtml, resolveQuoteBranding } from "../../shared/hospitality-quote-document";
import { FIKA_LOGO_DATA_URI, SITE_LOGO_DATA_URIS } from "../../shared/hospitality-quote-brand-assets.generated";

const report: RcoaInvoiceReport = {
  startDate: "2026-11-01", endDate: "2026-11-30", generatedAt: "2026-11-23T12:00:00.000Z",
  bookings: [{
    canonicalId: "booking:1", serviceDate: "2026-11-03", serviceTime: "09:30",
    meetingTitle: "Board meeting <script>alert(1)</script>", bookingReference: "RCOA-123",
    client: "RCoA & Partners", lifecycleStatus: "Completed", exVatPence: 12010,
  }, {
    canonicalId: "booking:2", serviceDate: "2026-11-11", serviceTime: "",
    bookingReference: "RCOA-124", client: "RCoA", lifecycleStatus: "Approved", meetingTitle: "Meeting title not recorded", financialIssue: "The saved quote is stale.",
  }],
  bookingCount: 2, confirmedExVatPence: 12010, unresolvedCount: 1, financialCoverageComplete: false,
  excludedCancelledCount: 1, excludedUnconfirmedCount: 2, dataDigest: "a".repeat(64),
};

test("GBP formatter prints exact pence and grouped whole pounds", () => {
  assert.equal(formatGbpPence(0), "£0.00");
  assert.equal(formatGbpPence(12010), "£120.10");
  assert.equal(formatGbpPence(123456789), "£1,234,567.89");
  assert.throws(() => formatGbpPence(-1), /Invalid report amount/);
});

test("PDF HTML escapes booking content and labels an incomplete subtotal", () => {
  const html = rcoaInvoiceReportHtml(report);
  assert.match(html, /Board meeting &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /Confirmed subtotal ex VAT/);
  assert.match(html, /1 booking has no reliable current ex VAT amount/);
  assert.match(html, /RCoA &amp; Partners/);
  assert.match(html, /Meeting title not recorded/);
  assert.match(html, /Requires review/);
  assert.match(html, /Confirmed subtotal ex VAT/);
  assert.match(html, /Incomplete financial coverage/);
  assert.match(html, /Excluded from this report: 1 cancelled · 2 unconfirmed or draft bookings/);
  assert.match(html, /Includes confirmed bookings with current saved quotations/);
  assert.match(html, /counter\(pages\)/);
  assert.match(html, /table-header-group/);
  assert.match(html, /page-break-inside: avoid/);
  assert.doesNotMatch(html, /contact@example\.test|Sensitive contact/);
  assert.doesNotMatch(html, /All 2 included bookings have a verified/);
  assert.doesNotMatch(html, /financial review required<\/span><strong>/);
});

test("PDF uses the canonical quote masthead, logos, fonts, title hierarchy and clean complete total", () => {
  const complete = rcoaInvoiceReportHtml({ ...report, bookings: [report.bookings[0]], bookingCount: 1, unresolvedCount: 0, financialCoverageComplete: true, excludedCancelledCount: 0, excludedUnconfirmedCount: 0 });
  assert.ok(complete.includes(quoteMastheadHtml(resolveQuoteBranding({ portalSiteId: "rcoa", portalSiteLabel: "RCoA" }))));
  assert.ok(complete.includes(FIKA_LOGO_DATA_URI));
  assert.ok(complete.includes(SITE_LOGO_DATA_URIS.rcoa));
  assert.ok(complete.includes(QUOTE_FONT_FACE_CSS));
  assert.match(complete, /Booking Invoice Summary/);
  assert.match(complete, /font: 900 23pt\/1 Vim, Gilroy/);
  assert.match(complete, /Reporting period/);
  assert.match(complete, /Generated 23 Nov 2026, 12:00 UK time/);
  assert.match(complete, /<th>Total ex VAT<\/th>/);
  assert.match(complete, /class="amount"[^]*?£120\.10/);
  assert.match(complete, /Total ex VAT/);
  assert.match(complete, /1 booking/);
  assert.doesNotMatch(complete, /verified current ex VAT amount|Financial review required<\/strong>/);
});

test("PDF wraps long values and renders a missing title as stored without inventing an event type", () => {
  const long = rcoaInvoiceReportHtml({
    ...report,
    bookings: [{ ...report.bookings[0], meetingTitle: "An exceptionally long governance meeting title ".repeat(8), bookingReference: "RCOA-" + "20261123120000-AB12-".repeat(6) }],
    bookingCount: 1, unresolvedCount: 0, financialCoverageComplete: true,
  });
  assert.match(long, /An exceptionally long governance meeting title/);
  assert.match(long, /20261123120000-AB12/);
  assert.match(long, /overflow-wrap: anywhere/);
  assert.doesNotMatch(long, /Event Catering|All Day Hospitality/);
  const missing = rcoaInvoiceReportHtml({
    ...report,
    bookings: [{ ...report.bookings[0], meetingTitle: "Meeting title not recorded" }],
    bookingCount: 1, unresolvedCount: 0, financialCoverageComplete: true,
  });
  assert.match(missing, /Meeting title not recorded/);
  assert.doesNotMatch(missing, /Event Catering|All Day Hospitality/);
});

test("PDF renders an empty period clearly without verification or eligibility clutter", () => {
  const empty = rcoaInvoiceReportHtml({ ...report, bookings: [], bookingCount: 0, confirmedExVatPence: 0, unresolvedCount: 0, financialCoverageComplete: true, excludedCancelledCount: 0, excludedUnconfirmedCount: 0 });
  assert.match(empty, /There are no confirmed RCoA bookings for this reporting period/);
  assert.match(empty, /£0\.00/);
  assert.match(empty, /0 bookings/);
  assert.doesNotMatch(empty, /All 0 included bookings have a verified|Excluded from this report|Includes confirmed bookings/);
});
