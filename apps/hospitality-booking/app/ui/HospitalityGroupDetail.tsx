"use client";
import { useEffect, useRef, useState } from "react";
import { GroupAmendmentEditor } from "./GroupAmendmentEditor";
import type { ReactNode } from "react";
import type { HospitalityBookingGroup } from "../../../shared/hospitality-group-quotes";
import { groupRequestedItems } from "../../lib/booking-presentation";
import { RequestedItemsList } from "./RequestedItemsList";
import { CancellationStatusPanel } from "./CancellationStatusPanel";
import { cancellationView, groupCancellationView, propagationOutcome, type PropagationOutcome } from "../../lib/cancellation-status";
import styles from "./HospitalityGroupDetail.module.css";

const money = (n: number) => `£${n.toFixed(2)}`;
export function HospitalityGroupDetail({ group, busy, onQuote, production, site, oplocId, onAmended, onBusyChange }: { group: HospitalityBookingGroup; busy: boolean; onQuote(): void; production: ReactNode; site: string; oplocId: string; onAmended(): Promise<void>; onBusyChange(busy: boolean): void }) {
  const editButton = useRef<HTMLButtonElement>(null);
  const closeEditor = () => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); };
  const [editing, setEditing] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const cancelLock = useRef(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelOutcome, setCancelOutcome] = useState<PropagationOutcome>();
  const cancellation = groupCancellationView(group.services.map(s => ({ lifecycleStatus: s.lifecycleStatus, cancellation: s.cancellation })));
  const anyCancelled = cancellation.cancelled > 0;
  const closeCancel = () => { setCancelOpen(false); requestAnimationFrame(() => cancelButton.current?.focus()); };
  useEffect(() => {
    if (!cancelOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !cancelLock.current) { event.preventDefault(); setCancelOpen(false); requestAnimationFrame(() => cancelButton.current?.focus()); } };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [cancelOpen]);
  /** First cancellation and retry are the same Hub command: the Hub treats an already-cancelled group as an idempotent downstream recovery. */
  const runCancel = async (reason: string, retry: boolean) => {
    if (cancelLock.current) return;
    cancelLock.current = true; setCancelBusy(true); onBusyChange(true); setCancelError("");
    try {
      const response = await fetch("/api/booking-groups/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingGroupId: group.id, expectedSourceHash: group.sourceHash, reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The cancellation could not be completed.");
      setCancelOutcome(propagationOutcome(body.projectionPropagation));
      if (!retry) { setCancelOpen(false); setCancelReason(""); }
      await onAmended();
    } catch (cause) { setCancelError(cause instanceof Error ? cause.message : "The cancellation could not be confirmed. Refresh the booking before retrying."); }
    finally { cancelLock.current = false; setCancelBusy(false); onBusyChange(false); }
  };
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
      <button ref={editButton} type="button" disabled={busy || anyCancelled || editing} onClick={() => setEditing(true)}>Amend booking</button>
      {!anyCancelled && <button ref={cancelButton} type="button" className={styles.danger} disabled={busy || editing} onClick={() => { setCancelError(""); setCancelOpen(true); }}>Cancel booking</button>}
      {ready && group.quote?.driveUrl ? <a href={group.quote.driveUrl} target="_blank" rel="noopener noreferrer">Open group quote</a> : <button type="button" className="primary" disabled={busy || editing || !eligible} aria-busy={busy} onClick={onQuote}>{busy ? "Preparing group quote…" : group.quote?.status === "failed" || group.quote?.status === "artifact_pending" ? "Retry group quote" : group.quote ? "Generate updated group quote" : "Generate group quote"}</button>}
    </div>
    {editing && <GroupAmendmentEditor key={group.id} group={group} site={site} oplocId={oplocId} onBusyChange={onBusyChange} onCancel={closeEditor} onSaved={async () => { await onAmended(); closeEditor(); }} />}
    {anyCancelled && <>
      <CancellationStatusPanel view={cancellation} retry={cancelOutcome} busy={cancelBusy} error={cancelError} onRetry={() => void runCancel("Retry cancellation downstream recovery", true)} />
      <ul className={styles.cancelServices} aria-label="Cancellation status by service">{group.services.map(s => <li key={s.bookingId}><span>{s.time} · {s.serviceType.replaceAll("_", " ")}</span><strong>{cancellationView({ lifecycleStatus: s.lifecycleStatus, cancellation: s.cancellation }).headline.replace(/^Cancelled — /, "")}</strong></li>)}</ul>
    </>}
    {cancelOpen && <div className="modal-backdrop" role="presentation"><form className="modal hospitality-action-modal" role="dialog" aria-modal="true" aria-labelledby="group-cancel-title" onSubmit={event => { event.preventDefault(); void runCancel(cancelReason.trim(), false); }}>
      <p className="eyebrow">Governed workflow command</p>
      <h2 id="group-cancel-title">Cancel {group.services.length} services?</h2>
      <p>This cancels the whole All Day Hospitality booking for {group.client.companyName} on {group.eventDate}. Production work is withdrawn from CPU and Logistics where it is safe to do so; anything CPU has already advanced is flagged for manual review instead.</p>
      <p>Where the Hub has customer cancellation email enabled for this site, one email is queued automatically for each cancelled service.</p>
      <label>Cancellation reason<textarea autoFocus required minLength={3} maxLength={1000} value={cancelReason} disabled={cancelBusy} onChange={event => setCancelReason(event.target.value)} /></label>
      {cancelError && <p role="alert" className={styles.error}>{cancelError}</p>}
      <footer><button type="button" onClick={closeCancel} disabled={cancelBusy}>Keep booking</button><button type="submit" className={styles.dangerSolid} disabled={cancelBusy || cancelReason.trim().length < 3} aria-busy={cancelBusy}>{cancelBusy ? "Cancelling…" : `Cancel ${group.services.length} services`}</button></footer>
    </form></div>}
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
