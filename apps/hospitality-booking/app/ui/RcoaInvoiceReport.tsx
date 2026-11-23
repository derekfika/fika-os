"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FileText, RefreshCw } from "lucide-react";
import type { RcoaInvoiceReport as Report } from "@/lib/rcoa-invoice-report-contract";
import { hospitalityWorkspacePath } from "@/lib/hospitality-workspace";
import { formatGbpPence } from "@/lib/rcoa-invoice-report-pdf";
import styles from "./RcoaInvoiceReport.module.css";

function ukToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json();
    return body.error?.message || "The report could not be loaded. Try again.";
  } catch {
    return `The report could not be loaded (HTTP ${response.status}).`;
  }
}

export default function RcoaInvoiceReport({ oploc }: { oploc: string }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState<Report>();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const today = ukToday();
    setStartDate(`${today.slice(0, 8)}01`);
    setEndDate(today);
  }, []);

  const returnPath = useMemo(() => oploc ? hospitalityWorkspacePath(oploc, "operations") : "/workspace", [oploc]);
  const complete = report?.financialCoverageComplete === true;

  const generate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setReport(undefined);
    if (!startDate || !endDate || endDate < startDate) {
      setError("Choose a valid date range. The end date must be on or after the start date.");
      return;
    }
    setLoading(true);
    try {
      const query = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`/api/rcoa-invoice-report?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setReport(await response.json() as Report);
    } catch (cause) {
      setError((cause as Error).message || "The report could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    if (!report) return;
    setDownloading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/rcoa-invoice-report/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: report.startDate, endDate: report.endDate, dataDigest: report.dataDigest, generatedAt: report.generatedAt }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const blob = await response.blob();
      if (!blob.size || blob.type !== "application/pdf") throw new Error("The PDF could not be verified. Generate the report again and retry.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `RCoA_Invoice_Summary_${report.startDate}_to_${report.endDate}.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("PDF downloaded.");
    } catch (cause) {
      setError((cause as Error).message || "The report PDF could not be generated.");
    } finally {
      setDownloading(false);
    }
  };

  const generatedLabel = report ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(report.generatedAt)) : "";

  return (
    <main className={`fika-ui ${styles.page}`} data-surface="fika-internal-operational">
      <div className={styles.shell}>
        <a className={styles.back} href={returnPath}><ArrowLeft size={17} aria-hidden="true" /> Back to RCoA dashboard</a>
        <header className={styles.header}>
          <p className={styles.eyebrow}>FIKA OS · RCoA Hospitality</p>
          <h1>Invoice Reports</h1>
          <p>Prepare a concise summary of confirmed bookings by service date. Amounts come from the current saved quotation for each booking.</p>
        </header>

        <section className={styles.controls} aria-labelledby="range-title">
          <h2 id="range-title">Reporting period</h2>
          <form onSubmit={event => void generate(event)}>
            <label>Start date<input type="date" required value={startDate} onChange={event => { setStartDate(event.target.value); setReport(undefined); setNotice(""); }} /></label>
            <label>End date<input type="date" required value={endDate} min={startDate || undefined} onChange={event => { setEndDate(event.target.value); setReport(undefined); setNotice(""); }} /></label>
            <button className={styles.primary} type="submit" disabled={loading || !startDate || !endDate}>
              {loading ? <><RefreshCw size={16} className={styles.spin} aria-hidden="true" /> Generating…</> : <><FileText size={16} aria-hidden="true" /> Generate Report</>}
            </button>
          </form>
          <p className={styles.help}>Both dates are included. Service dates use the UK calendar day. Cancelled and unconfirmed bookings are excluded.</p>
        </section>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.success} role="status">{notice}</p>}
        {loading && <p className={styles.loading} role="status" aria-live="polite">Loading confirmed RCoA bookings and current quotation values…</p>}

        {report && <section className={styles.results} aria-labelledby="result-title" aria-live="polite">
          <div className={styles.resultsHeader}>
            <div><p className={styles.eyebrow}>RCoA · {report.startDate} to {report.endDate}</p><h2 id="result-title">Booking invoice summary</h2><p className={styles.generated}>Generated {generatedLabel} UK time</p></div>
            <button className={styles.secondary} type="button" onClick={() => void download()} disabled={downloading}>
              {downloading ? <><RefreshCw size={16} className={styles.spin} aria-hidden="true" /> Preparing PDF…</> : <><Download size={16} aria-hidden="true" /> Download PDF</>}
            </button>
          </div>

          <div className={styles.metrics}>
            <article><span>Included bookings</span><strong>{report.bookingCount}</strong></article>
            <article><span>{complete ? "Total ex VAT" : "Confirmed subtotal ex VAT"}</span><strong>{formatGbpPence(report.confirmedExVatPence)}</strong></article>
            <article><span>Financial review required</span><strong>{report.unresolvedCount}</strong></article>
          </div>

          {!complete && <div className={styles.warning} role="alert"><strong>Incomplete financial coverage</strong><p>This amount is a confirmed subtotal, not a verified grand total. Resolve the quotation issues below and generate the report again.</p></div>}
          {report.excludedCancelledCount > 0 || report.excludedUnconfirmedCount > 0 ? <p className={styles.excluded}>
            Excluded from totals: {report.excludedCancelledCount} cancelled and {report.excludedUnconfirmedCount} unconfirmed or draft booking{report.excludedCancelledCount + report.excludedUnconfirmedCount === 1 ? "" : "s"}. Only Approved, Sent to CPU and Completed bookings with a current saved quote are included.
          </p> : <p className={styles.excluded}>Only Approved, Sent to CPU and Completed bookings with a current saved quote are included. No reportable bookings were excluded for cancellation or unconfirmed status.</p>}

          {report.bookingCount === 0 ? <div className={styles.empty}><h3>No matching bookings</h3><p>There are no confirmed RCoA bookings for this reporting period.</p></div> : <div className={styles.tableWrap}>
            <table>
              <caption className={styles.visuallyHidden}>Confirmed RCoA bookings and current ex VAT quotation amounts</caption>
              <thead><tr><th scope="col">Service date</th><th scope="col">Meeting / event title</th><th scope="col">Booking reference</th><th scope="col">Booker / client</th><th scope="col">Total ex VAT</th></tr></thead>
              <tbody>{report.bookings.map(row => <tr key={row.canonicalId}>
                <td>{row.serviceDate}{row.serviceTime && <span className={styles.time}>{row.serviceTime}</span>}</td>
                <td className={styles.title}>{row.meetingTitle}</td>
                <td>{row.bookingReference}</td>
                <td>{row.client || "—"}</td>
                <td className={styles.amount}>{row.exVatPence === undefined ? <span className={styles.review}>Requires review</span> : formatGbpPence(row.exVatPence)}</td>
              </tr>)}</tbody>
            </table>
          </div>}

          {report.unresolvedCount > 0 && <section className={styles.exceptions} aria-labelledby="exceptions-title">
            <h3 id="exceptions-title">Financial review required</h3>
            <p>These bookings are included in the booking count but their unknown amounts are excluded from the subtotal.</p>
            <ul>{report.bookings.filter(row => row.exVatPence === undefined).map(row => <li key={row.canonicalId}><strong>{row.bookingReference}</strong> · {row.serviceDate} · {row.meetingTitle}<span>{row.financialIssue || "Financial review required."}</span></li>)}</ul>
          </section>}
        </section>}

        <footer className={styles.policy}>
          <strong>Report rules</strong>
          <p>Service date means the booked UK service day. Approved, Sent to CPU and Completed records are included, even when the service is in the past; New, Reviewed, Quoted and Cancelled records are excluded. Each All Day service is reported once under its own booking reference. No catalogue prices or unsaved quote drafts are used.</p>
        </footer>
      </div>
    </main>
  );
}
