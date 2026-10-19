import type { ReactNode } from "react";
import { requiresCpuSummary, servicesToSend, type ServiceProductionRow, type ServiceResult } from "../../lib/cpu-production-plan";
import styles from "./BookingProductionPanel.module.css";

const STATE_TEXT: Record<ServiceProductionRow["state"], string> = {
  sent: "Sent to CPU",
  pending: "Ready to send",
  awaiting_quote: "Awaiting saved quote",
  unresolved: "Routing review required",
  no_cpu: "No CPU production",
};

/**
 * One booking-level Production panel with ONE primary Send to CPU action. Grouped bookings and single-service bookings share it: the
 * child-service hand-offs are orchestrated behind the button and reported as compact per-service results.
 */
export function BookingProductionPanel({ rows, results, busy, sending, onSend, renderDocuments }: {
  rows: readonly ServiceProductionRow[];
  results: Readonly<Record<string, ServiceResult | undefined>>;
  /** Disables sending while any booking operation runs. */
  busy: boolean;
  /** True only while a CPU send is actually in flight; other operations must not claim to be sending to CPU. */
  sending?: boolean;
  onSend(): void;
  /** Allergen matrix / menu controls for a CPU-producing service (grouped bookings). Never called for No CPU services. */
  renderDocuments?: (row: ServiceProductionRow) => ReactNode;
}) {
  const cpuRows = rows.filter(row => row.requirement === "cpu");
  const unresolvedRows = rows.filter(row => row.requirement === "unresolved");
  const inHouse = rows.filter(row => row.requirement === "no_cpu").length;
  const pending = servicesToSend(rows).length;
  const failed = rows.filter(row => results[row.bookingId]?.status === "failed" && row.state !== "sent");
  const allSent = cpuRows.length > 0 && cpuRows.every(row => row.state === "sent") && !unresolvedRows.length;
  const awaitingQuote = !pending && cpuRows.some(row => row.state === "awaiting_quote");
  const locked = !cpuRows.length && !unresolvedRows.length;
  const label = allSent ? "Sent to CPU" : "Send to CPU";
  const help = locked
    ? rows.length > 1 ? "No service in this booking needs CPU production." : "The site will produce this booking internally."
    : awaitingQuote ? "Available after the quote PDF is saved to Drive."
    : !pending && unresolvedRows.length ? "Classify the unresolved items in Integration Hub before sending."
    : "";
  return <section className={styles.panel} aria-labelledby="booking-production-title">
    <p className={styles.eyebrow}>Production</p>
    <h3 id="booking-production-title">CPU production, allergens and menus</h3>
    <p className={styles.summary}>{locked ? (rows.length > 1 ? "0 of " + rows.length + " services require CPU production" : "No CPU production required") : requiresCpuSummary(rows)}</p>
    <button type="button" className={styles.send} disabled={busy || !pending} aria-busy={sending ? true : undefined} onClick={onSend}>{sending ? "Sending to CPU…" : label}</button>
    {help && <p className={styles.help}>{help}</p>}
    {inHouse > 0 && cpuRows.length + unresolvedRows.length > 0 && <p className={styles.help}>{inHouse} {inHouse === 1 ? "service is" : "services are"} produced in house and {inHouse === 1 ? "is" : "are"} not sent to CPU.</p>}
    {unresolvedRows.length > 0 && <p className={styles.alert} role="status">Routing needs review for {unresolvedRows.map(row => row.label).join(", ")}. {unresolvedRows.length === 1 ? "It" : "They"} will not be sent until every item is classified; unresolved routing is never treated as No CPU.</p>}
    {failed.length > 0 && <p className={styles.alert} role="alert">{failed.length === 1 ? "One service" : `${failed.length} services`} could not be sent. Services already sent are unaffected; Send to CPU retries only the remaining ones.</p>}
    {(cpuRows.length > 1 || cpuRows.some(row => results[row.bookingId]) || unresolvedRows.length > 0 || renderDocuments) && <ul className={styles.results} aria-label="Per-service production status">
      {[...cpuRows, ...unresolvedRows].sort((a, b) => a.label.localeCompare(b.label)).map(row => {
        const result = results[row.bookingId];
        const failedNow = result?.status === "failed" && row.state !== "sent";
        const text = failedNow ? "Failed" : STATE_TEXT[row.state];
        const tone = failedNow ? styles.failed : row.state === "sent" ? styles.sent : row.state === "unresolved" ? styles.unresolved : styles.waiting;
        return <li key={row.bookingId} className={styles.row}>
          <div className={styles.rowHead}><span>{row.label}</span><span className={`${styles.status} ${tone}`}>{text}</span></div>
          {result?.message && <p className={styles.help}>{result.message}</p>}
          {row.requirement === "cpu" && renderDocuments?.(row)}
        </li>;
      })}
    </ul>}
  </section>;
}
