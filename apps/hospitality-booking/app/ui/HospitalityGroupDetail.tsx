import type { HospitalityBookingGroup } from "../../../shared/hospitality-group-quotes";
import styles from "./HospitalityGroupDetail.module.css";

const money = (n: number) => `£${n.toFixed(2)}`;
const label = (s: string) => s.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
export function HospitalityGroupDetail({ group, busy, onQuote, onService }: { group: HospitalityBookingGroup; busy: boolean; onQuote(): void; onService(id: string): void }) {
  const ready = group.quote?.status === "complete" && !group.quote.stale;
  const statesEligible = group.services.every(s => ["New", "Reviewed", "Quoted", "Completed"].includes(s.lifecycleStatus));
  const eligible = group.quote?.status !== "integrity_failed" && statesEligible;
  return <section className={styles.group} aria-label="All Day Hospitality booking">
    <header><p className="eyebrow">All Day Hospitality · {group.status}</p><h2>{group.client.companyName}</h2><p>{group.client.name} · {group.client.email}{group.client.phone ? ` · ${group.client.phone}` : ""}</p>
      {group.eventName && <h3>{group.eventName}</h3>}
      <p>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${group.eventDate}T12:00:00Z`))} · {group.services.length} services · {group.firstTime}–{group.lastTime}</p>
      {group.client.invoiceReference && <p>PO / reference: {group.client.invoiceReference}</p>}<p>Request reference: {group.reference}</p>
      <strong className={styles.total}>{money(group.totals.gross)}</strong>
    </header>
    <div className={styles.actions}>
      {ready && group.quote?.driveUrl ? <a href={group.quote.driveUrl} target="_blank" rel="noopener noreferrer">Open group quote</a> : <button type="button" className="primary" disabled={busy || !eligible} aria-busy={busy} onClick={onQuote}>{busy ? "Preparing group quote…" : group.quote?.status === "failed" || group.quote?.status === "artifact_pending" ? "Retry group quote" : group.quote ? "Generate updated group quote" : "Generate group quote"}</button>}
    </div>
    <p className={styles.help}>Group editing and cancellation are not available. Open a service below for its production actions.</p>
    {!statesEligible && !ready && <p role="status">Some services are not in a state that allows a new quote. Review their operational status.</p>}
    {group.quote?.status === "artifact_pending" && <p role="status">Quote preparation is in progress. Refresh to check the result, or retry to resume after an interruption.</p>}
    {group.quote?.error && <p role="alert">{group.quote.error}</p>}
    {group.quote?.stale && group.quote.status === "complete" && <p role="status">The previous quote is retained for history. Generate an updated group quote for the current services.</p>}
    <h3>All day schedule</h3>
    <p>CPU production: {group.routing.cpuServices} of {group.services.length} services require CPU{group.routing.warnings ? ` · ${group.routing.warnings} routing warnings` : ""}</p>
    {group.services.map(service => <details key={service.bookingId} className={styles.service}>
      <summary><strong>{service.time} — {label(service.serviceType)}</strong><span>{service.guests} guests · {service.location}</span><strong>{money(service.totals.gross)}</strong><span>{service.routing?.statusLabel || "Routing requires review"} · {service.lifecycleStatus}</span></summary>
      <ul>{service.lines.map((line, i) => <li key={i}><span>{line.quantity} × {line.name}{line.description ? ` — ${line.description}` : ""}<small className={styles.help}>{service.routing?.lines.find(r => r.index === i)?.label}</small></span><span>{money(line.net)}</span></li>)}</ul>
      {service.charges.map((charge, i) => <p key={i}>{charge.label}: {money(charge.net)}{charge.detail ? ` · ${charge.detail}` : ""}</p>)}
      <p>Net subtotal: {money(service.totals.net)} · VAT: {money(service.totals.vat)}</p>
      <p className={styles.help}>Service reference: {service.sourceReference}</p>
      <button type="button" disabled={busy} onClick={() => onService(service.bookingId)}>Open {service.time} service operations</button>
    </details>)}
    <dl className={styles.totals}><div><dt>Items subtotal</dt><dd>{money(group.totals.itemsNet)}</dd></div><div><dt>Additional charges</dt><dd>{money(group.totals.chargesNet)}</dd></div><div><dt>Total net</dt><dd>{money(group.totals.net)}</dd></div><div><dt>VAT as recorded</dt><dd>{money(group.totals.vat)}</dd></div><div><dt>Grand total</dt><dd>{money(group.totals.gross)}</dd></div></dl>
  </section>;
}
