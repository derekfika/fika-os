import assert from "node:assert/strict";
import test from "node:test";
import { formatGbpPence, rcoaInvoiceReportHtml } from "../lib/rcoa-invoice-report-pdf";
import type { RcoaInvoiceReport } from "../lib/rcoa-invoice-report-contract";

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
  assert.match(html, /1 cancelled booking excluded/);
  assert.match(html, /2 unconfirmed or draft bookings excluded/);
  assert.match(html, /counter\(pages\)/);
  assert.match(html, /table-header-group/);
  assert.match(html, /page-break-inside: avoid/);
  assert.doesNotMatch(html, /contact@example\.test|Sensitive contact/);
});

test("PDF HTML reports verified totals and renders an empty period clearly", () => {
  const complete = rcoaInvoiceReportHtml({ ...report, bookings: [report.bookings[0]], bookingCount: 1, unresolvedCount: 0, financialCoverageComplete: true, excludedCancelledCount: 0, excludedUnconfirmedCount: 0 });
  assert.match(complete, /Total ex VAT/);
  assert.match(complete, /All 1 included bookings have a verified current ex VAT amount/);
  const empty = rcoaInvoiceReportHtml({ ...report, bookings: [], bookingCount: 0, confirmedExVatPence: 0, unresolvedCount: 0, financialCoverageComplete: true, excludedCancelledCount: 0, excludedUnconfirmedCount: 0 });
  assert.match(empty, /No confirmed RCoA bookings matched this reporting period/);
  assert.match(empty, /£0\.00/);
});
