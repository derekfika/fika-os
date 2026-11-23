import {
  QUOTE_STYLESHEET_CSS,
  quoteMastheadHtml,
  resolveQuoteBranding,
} from "../../shared/hospitality-quote-document";
import type { RcoaInvoiceReport } from "@/lib/rcoa-invoice-report-contract";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]!));

export function formatGbpPence(pence: number) {
  if (!Number.isSafeInteger(pence) || pence < 0) throw new Error("Invalid report amount.");
  const whole = BigInt(Math.floor(pence / 100));
  const grouped = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(whole);
  return `£${grouped}.${String(pence % 100).padStart(2, "0")}`;
}

function ukDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(`${value}T12:00:00Z`));
}

function ukDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value));
}

export function rcoaInvoiceReportHtml(report: RcoaInvoiceReport) {
  const unresolved = report.bookings.filter(row => row.exVatPence === undefined);
  const rows = report.bookings.map(row => `<tr>
    <td class="date">${escapeHtml(ukDate(row.serviceDate))}${row.serviceTime ? `<span class="time">${escapeHtml(row.serviceTime)}</span>` : ""}</td>
    <td class="title">${escapeHtml(row.meetingTitle)}</td>
    <td class="reference">${escapeHtml(row.bookingReference)}</td>
    <td class="client">${escapeHtml(row.client || "—")}</td>
    <td class="amount">${row.exVatPence === undefined ? `<span class="review">Requires review</span>` : escapeHtml(formatGbpPence(row.exVatPence))}</td>
  </tr>`).join("");

  const warning = report.financialCoverageComplete ? "" : `<section class="warning" role="note" aria-label="Incomplete financial coverage">
    <strong>Incomplete financial coverage</strong>
    <p>${report.unresolvedCount} booking${report.unresolvedCount === 1 ? " has" : "s have"} no reliable current ex VAT amount. The amount below is a confirmed subtotal, not a final total.</p>
  </section>`;
  const exceptions = unresolved.length ? `<section class="exceptions">
    <h2>Financial review required</h2>
    <ul>${unresolved.map(row => `<li><strong>${escapeHtml(row.bookingReference)}</strong><span>${escapeHtml(ukDate(row.serviceDate))}${row.meetingTitle && row.meetingTitle !== "Meeting title not recorded" ? ` · ${escapeHtml(row.meetingTitle)}` : ""}</span><p>${escapeHtml(row.financialIssue || "Financial review is required before this booking can be included in the total.")}</p></li>`).join("")}</ul>
  </section>` : "";
  const exclusions = [
    report.excludedCancelledCount ? `${report.excludedCancelledCount} cancelled` : "",
    report.excludedUnconfirmedCount ? `${report.excludedUnconfirmedCount} unconfirmed or draft` : "",
  ].filter(Boolean).join(" · ");
  const eligibilityNote = report.bookings.length || exclusions ? `<p class="eligibility">Includes confirmed bookings with current saved quotations.</p>` : "";
  const branding = resolveQuoteBranding({ portalSiteId: "rcoa", portalSiteLabel: "RCoA" });
  const generated = `${ukDateTime(report.generatedAt)} UK time`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>RCoA Booking Invoice Summary</title><style>
    ${QUOTE_STYLESHEET_CSS}
    @page { size: A4 portrait; margin: 0 0 18mm;
      @bottom-left { content: "FIKA Catering · Hospitality, elevated."; width: 100%; margin: 0 16mm; border-top: 1px solid #ded8ed; padding-top: 7px; color: #8a819d; font: 8pt Gilroy, sans-serif; }
      @bottom-center { content: "Generated ${escapeHtml(generated)}"; width: 30%; padding-top: 7px; text-align: center; color: #8a819d; font: 8pt Gilroy, sans-serif; }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); width: 20%; margin-right: 16mm; padding-top: 7px; text-align: right; color: #8a819d; font: 8pt Gilroy, sans-serif; }
    }
    @page:first { margin-top: 0; }
    html, body { background: #fff; }
    body { color: #24163b; font-size: 10.5pt; }
    .page { width: 210mm; min-height: 0; margin: 0 auto; padding: 0 16mm; }
    .report-heading { display: grid; grid-template-columns: 1fr; gap: 12px; margin: 0 0 21px; }
    .report-heading h1 { margin: 0; color: #280f8c; font: 900 23pt/1 Vim, Gilroy, sans-serif; letter-spacing: -.7px; }
    .report-kicker { margin: 0 0 7px; color: #4f34c7; font-size: 7.5pt; font-weight: 900; letter-spacing: 1.35px; text-transform: uppercase; }
    .period { padding: 12px 15px; border: 1px solid #ded8ed; border-radius: 12px; background: #faf9fd; }
    .period .meta-row { align-items: baseline; }
    .period .meta-row + .meta-row { margin-top: 6px; }
    .period .meta-row span:last-child { color: #24163b; font-size: 9.5pt; }
    .report-table { width: 100%; margin-top: 20px; border-collapse: collapse; table-layout: fixed; font-size: 9pt; line-height: 1.35; }
    .report-table col.date { width: 15%; }
    .report-table col.title { width: 27%; }
    .report-table col.reference { width: 19%; }
    .report-table col.client { width: 21%; }
    .report-table col.amount { width: 18%; }
    .report-table thead { display: table-header-group; }
    .report-table th { padding: 9px 7px; border-bottom: 2px solid #4f34c7; color: #4f34c7; text-align: left; }
    .report-table th:first-child, .report-table td:first-child { padding-left: 0; }
    .report-table th:last-child, .report-table td:last-child { padding-right: 0; }
    .report-table td { padding: 10px 7px; border-bottom: 1px solid #e7e2f0; vertical-align: top; color: #24163b; }
    .report-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
    .report-table .date, .report-table .reference, .report-table .title, .report-table .client { overflow-wrap: anywhere; }
    .report-table .time { display: block; margin-top: 2px; color: #665d73; font-size: 8.5pt; }
    .report-table th:last-child, .report-table td.amount { text-align: right; }
    .report-table td.amount { white-space: nowrap; font-weight: 900; }
    .review { color: #704800; font-weight: 700; white-space: normal; }
    .empty { margin: 22px 0 18px; color: #665d73; }
    .total { display: flex; justify-content: space-between; align-items: end; gap: 18px; margin: 19px 0 0; break-inside: avoid; page-break-inside: avoid; }
    .count { padding-bottom: 3px; color: #665d73; font-size: 9pt; }
    .total-value { min-width: 245px; border-top: 3px solid #4f34c7; padding-top: 9px; text-align: right; }
    .total-value span { display: block; color: #665d73; font-size: 8.5pt; }
    .total-value strong { display: block; color: #280f8c; font-size: 17pt; line-height: 1.1; }
    .eligibility { margin: 9px 0 0; color: #8a819d; font-size: 8pt; text-align: right; }
    .warning { margin: 17px 0 0; padding: 11px 14px; border-left: 4px solid #a75c00; border-radius: 0 10px 10px 0; background: #fff7e8; color: #704800; break-inside: avoid; }
    .warning strong { display: block; margin-bottom: 3px; }
    .warning p { margin: 0; font-size: 9pt; }
    .exclusions { margin: 9px 0 0; color: #8a819d; font-size: 8pt; }
    .exceptions { margin-top: 19px; padding-top: 10px; border-top: 1px solid #ded8ed; break-inside: avoid; }
    .exceptions h2 { margin: 0 0 8px; color: #704800; font: 13pt Vim, Gilroy, sans-serif; }
    .exceptions ul { margin: 0; padding: 0; list-style: none; }
    .exceptions li { padding: 7px 0; border-bottom: 1px solid #eeeaf5; break-inside: avoid; }
    .exceptions li strong { margin-right: 9px; }
    .exceptions li span { color: #665d73; }
    .exceptions li p { margin: 3px 0 0; color: #665d73; font-size: 9pt; }
  </style></head><body><main class="page">
    ${quoteMastheadHtml(branding)}
    <section class="report-heading">
      <div><p class="report-kicker">Royal College of Anaesthetists</p><h1>Booking Invoice Summary</h1></div>
      <div class="period"><div class="meta-row"><span class="meta-label">Reporting period</span><span>${escapeHtml(ukDate(report.startDate))} to ${escapeHtml(ukDate(report.endDate))}</span></div></div>
    </section>
    ${report.bookings.length ? `<table class="report-table"><colgroup><col class="date"><col class="title"><col class="reference"><col class="client"><col class="amount"></colgroup><thead><tr><th>Service date</th><th>Meeting / event title</th><th>Booking reference</th><th>Client</th><th>Total ex VAT</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">There are no confirmed RCoA bookings for this reporting period.</p>`}
    ${warning}
    <section class="total"><span class="count">${report.bookingCount} booking${report.bookingCount === 1 ? "" : "s"}</span><div class="total-value"><span>${report.financialCoverageComplete ? "Total ex VAT" : "Confirmed subtotal ex VAT"}</span><strong>${escapeHtml(formatGbpPence(report.confirmedExVatPence))}</strong></div></section>
    ${eligibilityNote}
    ${exclusions ? `<p class="exclusions">Excluded from this report: ${escapeHtml(exclusions)} bookings.</p>` : ""}
    ${exceptions}
  </main></body></html>`;
}
