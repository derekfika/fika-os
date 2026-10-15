import { useRef, useState } from "react";
import { GroupAmendmentEditor } from "./GroupAmendmentEditor";
import type { ReactNode } from "react";
import type { HospitalityBookingGroup } from "../../../shared/hospitality-group-quotes";
import { groupRequestedItems } from "../../lib/booking-presentation";
import { RequestedItemsList } from "./RequestedItemsList";
import styles from "./HospitalityGroupDetail.module.css";

const money = (n: number) => `£${n.toFixed(2)}`;
export function HospitalityGroupDetail({ group, busy, onQuote, production, site, oplocId, onAmended, onBusyChange }: { group: HospitalityBookingGroup; busy: boolean; onQuote(): void; production: ReactNode; site: string; oplocId: string; onAmended(): Promise<void>; onBusyChange(busy: boolean): void }) {
  const editButton = useRef<HTMLButtonElement>(null);
  const closeEditor = () => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); };
  const [editing, setEditing] = useState(false);
  const ready = group.quote?.status === "complete" && !group.quote.stale;
  const statesEligible = group.services.every(s => ["New", "Reviewed", "Quoted", "Completed", "Sent to CPU"].includes(s.lifecycleStatus));
  const eligible = !(group.quote?.status === "integrity_failed" && !group.quote.stale) && statesEligible;
  return <section className={styles.group} data-group-editing={editing ? "true" : undefined} aria-label="All Day Hospitality booking">
    <header><p className="eyebrow">All Day Hospitality · {group.status}</p><h2>{group.client.companyName}</h2><p>{group.client.name} · {group.client.email}{group.client.phone ? ` · ${group.client.phone}` : ""}</p>
      {group.eventName && <h3>{group.eventName}</h3>}
      <p>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${group.eventDate}T12:00:00Z`))} · {group.services.length} services · {group.firstTime}–{group.lastTime}</p>
      {group.client.invoiceReference && <p>PO / reference: {group.client.invoiceReference}</p>}<p>Request reference: {group.reference}</p>
      <strong className={styles.total}>{money(group.totals.gross)}</strong>
    </header>
    <div className={styles.actions}>
      <button ref={editButton} type="button" disabled={busy || group.services.some(s => s.lifecycleStatus === "Cancelled") || editing} onClick={() => setEditing(true)}>Amend booking</button>
      {ready && group.quote?.driveUrl ? <a href={group.quote.driveUrl} target="_blank" rel="noopener noreferrer">Open group quote</a> : <button type="button" className="primary" disabled={busy || editing || !eligible} aria-busy={busy} onClick={onQuote}>{busy ? "Preparing group quote…" : group.quote?.status === "failed" || group.quote?.status === "artifact_pending" ? "Retry group quote" : group.quote ? "Generate updated group quote" : "Generate group quote"}</button>}
    </div>
    {editing && <GroupAmendmentEditor key={group.id} group={group} site={site} oplocId={oplocId} onBusyChange={onBusyChange} onCancel={closeEditor} onSaved={async () => { await onAmended(); closeEditor(); }} />}
    <p className={styles.help}>Group cancellation is not yet available.</p>
    {!statesEligible && !ready && <p role="status">Some services are not in a state that allows a new quote. Review their operational status.</p>}
    {group.quote?.status === "artifact_pending" && <p role="status">Quote preparation is in progress. Refresh to check the result, or retry to resume after an interruption.</p>}
    {group.quote?.error && <p role="alert">{group.quote.error}</p>}
    {group.quote?.stale && group.quote.status === "complete" && <p role="status">The previous quote is retained for history. Generate an updated group quote for the current services.</p>}
    {!editing && <section className={styles.requested} aria-labelledby="group-requested-heading">
      <p className="eyebrow">Commercial snapshot</p>
      <h3 id="group-requested-heading">What was requested</h3>
      <RequestedItemsList rows={groupRequestedItems(group)} />
      {group.services.flatMap(service => service.charges.map((charge, i) => <p key={`${service.bookingId}:${i}`} className={styles.charge}>{service.time} — {charge.label}: {money(charge.net)}{charge.detail ? ` · ${charge.detail}` : ""}</p>))}
    </section>}
    {!editing && production}
    {!editing && <dl className={styles.totals}><div><dt>Items subtotal</dt><dd>{money(group.totals.itemsNet)}</dd></div><div><dt>Additional charges</dt><dd>{money(group.totals.chargesNet)}</dd></div><div><dt>Total net</dt><dd>{money(group.totals.net)}</dd></div><div><dt>VAT as recorded</dt><dd>{money(group.totals.vat)}</dd></div><div><dt>Grand total</dt><dd>{money(group.totals.gross)}</dd></div></dl>}
  </section>;
}
