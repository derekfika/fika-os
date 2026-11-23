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
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(`${value}T12:00:00Z`));
}

function ukDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value));
}

export function rcoaInvoiceReportHtml(report: RcoaInvoiceReport) {
  const unresolved = report.bookings.filter(row => row.exVatPence === undefined);
  const rows = report.bookings.map(row => `<tr>
    <td class="date">${escapeHtml(ukDate(row.serviceDate))}${row.serviceTime ? `<br><span class="muted">${escapeHtml(row.serviceTime)}</span>` : ""}</td>
    <td class="title">${escapeHtml(row.meetingTitle)}</td>
    <td class="reference">${escapeHtml(row.bookingReference)}</td>
    <td class="client">${escapeHtml(row.client || "—")}</td>
    <td class="amount">${row.exVatPence === undefined ? "Requires review" : escapeHtml(formatGbpPence(row.exVatPence))}</td>
  </tr>`).join("");
  const coverage = report.financialCoverageComplete
    ? `<p class="verified">All ${report.bookingCount} included bookings have a verified current ex VAT amount.</p>`
    : `<section class="warning"><strong>Incomplete financial coverage</strong><p>${report.unresolvedCount} booking${report.unresolvedCount === 1 ? " has" : "s have"} no reliable current ex VAT amount. The displayed amount is a confirmed subtotal, not a verified grand total.</p></section>`;
  const exceptions = unresolved.length ? `<section class="exceptions"><h2>Financial review required</h2><ul>${unresolved.map(row => `<li><strong>${escapeHtml(row.bookingReference)}</strong> · ${escapeHtml(ukDate(row.serviceDate))} · ${escapeHtml(row.meetingTitle)} — ${escapeHtml(row.financialIssue || "Financial review required.")}</li>`).join("")}</ul></section>` : "";
  const exclusions = [
    report.excludedCancelledCount ? `${report.excludedCancelledCount} cancelled booking${report.excludedCancelledCount === 1 ? "" : "s"} excluded` : "",
    report.excludedUnconfirmedCount ? `${report.excludedUnconfirmedCount} unconfirmed or draft booking${report.excludedUnconfirmedCount === 1 ? "" : "s"} excluded` : "",
  ].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>RCoA Booking Invoice Summary</title><style>
    @page { size: A4 portrait; margin: 16mm 14mm 19mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); color: #596273; font: 9pt Arial, sans-serif; } }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1d2433; font: 10pt/1.4 Arial, Helvetica, sans-serif; }
    header { border-bottom: 3px solid #4f34c7; padding-bottom: 13px; margin-bottom: 17px; }
    .brand { color: #4f34c7; font-weight: 800; font-size: 17pt; letter-spacing: .03em; }
    h1 { margin: 7px 0 4px; color: #280f8c; font-size: 19pt; line-height: 1.15; }
    .meta { margin: 3px 0; color: #485165; }
    .summary { margin: 15px 0 8px; display: flex; gap: 24px; }
    .summary div { border: 1px solid #d9dce5; background: #f7f7fa; border-radius: 5px; padding: 9px 12px; min-width: 130px; }
    .summary span { display: block; color: #596273; font-size: 8.5pt; }
    .summary strong { display: block; color: #1d2433; font-size: 13pt; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
    thead { display: table-header-group; }
    th { text-align: left; background: #f0eef9; color: #280f8c; font-size: 8.5pt; padding: 8px 6px; border-bottom: 1px solid #c9c4df; }
    td { vertical-align: top; padding: 8px 6px; border-bottom: 1px solid #e2e4ea; overflow-wrap: anywhere; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th:nth-child(1), td.date { width: 15%; }
    th:nth-child(2), td.title { width: 28%; }
    th:nth-child(3), td.reference { width: 18%; }
    th:nth-child(4), td.client { width: 18%; }
    th:nth-child(5), td.amount { width: 21%; }
    td.amount, th:last-child { text-align: right; white-space: nowrap; }
    .muted { color: #596273; }
    .verified { margin: 11px 0; color: #245d31; font-weight: 700; }
    .warning { margin: 12px 0; border: 1px solid #b57200; border-left: 4px solid #a75c00; background: #fff7e8; padding: 10px 12px; break-inside: avoid; }
    .warning p { margin: 4px 0 0; }
    .total { display: flex; justify-content: flex-end; margin-top: 12px; break-inside: avoid; }
    .total div { min-width: 225px; border-top: 2px solid #280f8c; padding-top: 8px; text-align: right; }
    .total span { display: block; font-size: 8.5pt; color: #485165; }
    .total strong { display: block; color: #280f8c; font-size: 16pt; }
    .exclusions { margin-top: 12px; color: #596273; font-size: 8.5pt; }
    .exceptions { margin-top: 14px; border-top: 1px solid #d9dce5; padding-top: 8px; break-inside: avoid; }
    .exceptions h2 { margin: 0 0 5px; font-size: 11pt; color: #704700; }
    .exceptions ul { margin: 0; padding-left: 17px; }
    .exceptions li { padding: 2px 0; }
    .empty { margin: 18px 0; color: #596273; }
  </style></head><body>
    <header><div class="brand">FIKA OS</div><h1>RCoA — Booking Invoice Summary</h1>
      <p class="meta"><strong>Reporting Period:</strong> ${escapeHtml(ukDate(report.startDate))} to ${escapeHtml(ukDate(report.endDate))}</p>
      <p class="meta"><strong>Generated:</strong> ${escapeHtml(ukDateTime(report.generatedAt))} UK time</p>
    </header>
    <div class="summary"><div><span>Included bookings</span><strong>${report.bookingCount}</strong></div><div><span>Financial review required</span><strong>${report.unresolvedCount}</strong></div></div>
    ${coverage}
    ${report.bookings.length ? `<table><thead><tr><th>Service date</th><th>Meeting / event title</th><th>Booking reference</th><th>Booker / client</th><th>Total ex VAT</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">No confirmed RCoA bookings matched this reporting period.</p>`}
    <div class="total"><div><span>${report.financialCoverageComplete ? "Total ex VAT" : "Confirmed subtotal ex VAT"}</span><strong>${escapeHtml(formatGbpPence(report.confirmedExVatPence))}</strong></div></div>
    ${exclusions ? `<p class="exclusions">Excluded from financial totals: ${escapeHtml(exclusions)}. Only Approved, Sent to CPU and Completed bookings are reportable; the current quote must be saved.</p>` : ""}
    ${exceptions}
  </body></html>`;
}
