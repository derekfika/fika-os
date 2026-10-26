"use client";
import { useEffect, useRef, useState } from "react";
import { GroupAmendmentEditor } from "./GroupAmendmentEditor";
import { AdditionalChargesModal } from "./AdditionalChargesModal";
import type { ReactNode } from "react";
import type { BookingAdditionalChargeInput, CanonicalBooking } from "@/lib/canonical-types";
import type { HospitalityBookingGroup, HospitalityGroupService } from "../../../shared/hospitality-group-quotes";
import { groupRequestedItems } from "../../lib/booking-presentation";
import { groupLocationView } from "../../lib/booking-location";
import { groupServiceStatusLabel } from "../../lib/cpu-production-plan";
import { RequestedItemsList } from "./RequestedItemsList";
import { CancellationStatusPanel } from "./CancellationStatusPanel";
import { cancellationView, groupCancellationView, propagationOutcome, type PropagationOutcome } from "../../lib/cancellation-status";
import styles from "./HospitalityGroupDetail.module.css";

const money = (n: number) => `£${n.toFixed(2)}`;
/** UK long date for a YYYY-MM-DD business date (same formatter the header already used). */
const ukLongDate = (value: string) => { const date = new Date(`${value}T12:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date); };
/** Same gate as a standalone booking's "Manage charges" (COMMERCIAL_EDITABLE_STATUSES in the Hub). */
const CHARGE_EDITABLE = ["New", "Reviewed", "Quoted", "Completed"];
const chipTone = (status: string) => ["Sent to CPU", "Completed", "Approved"].includes(status) ? styles.chipSuccess : status === "Cancelled" ? styles.chipDanger : status === "Quoted" ? styles.chipInfo : styles.chipWarning;
/** Positional anchors: canonical IDs are never written into the DOM. Only one group is shown at a time. */
const serviceAnchor = (group: HospitalityBookingGroup, service: HospitalityGroupService) => `group-service-${group.services.indexOf(service) + 1}`;
const serviceLabel = (service: HospitalityGroupService) => `${service.time}${service.endTime ? `–${service.endTime}` : ""} · ${service.serviceType.replaceAll("_", " ")}`;
type ChargeTarget = { service: HospitalityGroupService; booking: CanonicalBooking; sourceHash: string };

export function HospitalityGroupDetail({ group, busy, onQuote, production, site, oplocId, onAmended, onBusyChange }: { group: HospitalityBookingGroup; busy: boolean; onQuote(): void; production: ReactNode; site: string; oplocId: string; onAmended(): Promise<void>; onBusyChange(busy: boolean): void }) {
  const editButton = useRef<HTMLButtonElement>(null);
  const closeEditor = () => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); };
  const [editing, setEditing] = useState(false);
  const [chargeTarget, setChargeTarget] = useState<ChargeTarget>();
  const [chargeLoading, setChargeLoading] = useState<string>();
  const [chargeError, setChargeError] = useState("");
  const [chargeStatus, setChargeStatus] = useState("");
  const lock = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const cancelDialog = useRef<HTMLFormElement>(null);
  const cancelLock = useRef(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelOutcome, setCancelOutcome] = useState<PropagationOutcome>();
  const cancellation = groupCancellationView(group.services.map(s => ({ lifecycleStatus: s.lifecycleStatus, cancellation: s.cancellation })));
  const anyCancelled = cancellation.cancelled > 0;
  const cancelWasOpen = useRef(false);
  const closeCancel = () => setCancelOpen(false);
  // The trigger is disabled while the dialog is open, so focus can only return after the re-render that re-enables it.
  useEffect(() => { if (cancelWasOpen.current && !cancelOpen) cancelButton.current?.focus(); cancelWasOpen.current = cancelOpen; }, [cancelOpen]);
  useEffect(() => {
    if (!cancelOpen) return;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = cancelDialog.current;
    dialog?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !cancelLock.current) { event.preventDefault(); setCancelOpen(false); }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])')];
      if (!controls.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (prior?.isConnected) prior.focus(); };
  }, [cancelOpen]);
  /** First cancellation and retry are the same Hub command: the Hub treats an already-cancelled group as an idempotent downstream recovery. */
  const runCancel = async (reason: string, retry: boolean) => {
    if (cancelLock.current || lock.current || chargeTarget) return;
    lock.current = true; cancelLock.current = true; setCancelBusy(true); onBusyChange(true); setCancelError("");
    try {
      const response = await fetch("/api/booking-groups/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingGroupId: group.id, expectedSourceHash: group.sourceHash, reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The cancellation could not be completed.");
      setCancelOutcome(propagationOutcome(body.projectionPropagation));
      if (!retry) { setCancelOpen(false); setCancelReason(""); }
      await onAmended();
    } catch (cause) { setCancelError(cause instanceof Error ? cause.message : "The cancellation could not be confirmed. Refresh the booking before retrying."); }
    finally { lock.current = false; cancelLock.current = false; setCancelBusy(false); onBusyChange(false); }
  };
  const ready = group.quote?.status === "complete" && !group.quote.stale;
  const statesEligible = group.services.every(s => ["New", "Reviewed", "Quoted", "Completed", "Sent to CPU"].includes(s.lifecycleStatus));
  const eligible = !(group.quote?.status === "integrity_failed" && !group.quote.stale) && statesEligible;
  const quoteLabel = ready ? "Quote current" : group.quote?.stale && group.quote.status === "complete" ? "Quote out of date" : group.quote?.status === "artifact_pending" ? "Quote in progress" : group.quote?.status === "failed" ? "Quote failed" : "Not quoted";
  const quoteTone = ready ? styles.chipSuccess : group.quote ? styles.chipWarning : styles.chipNeutral;

  /** Always load the service's current charges and version from the Hub so a stale list can never be saved over newer work. */
  const openCharges = async (service: HospitalityGroupService) => {
    if (lock.current || cancelOpen || chargeTarget) return;
    lock.current = true; setChargeLoading(service.bookingId); setChargeError(""); setChargeStatus("Loading current charges…"); onBusyChange(true);
    try {
      const response = await fetch(`/api/booking-groups/amend?bookingGroupId=${encodeURIComponent(group.id)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The current booking could not be loaded.");
      const booking = (body.bookings as CanonicalBooking[] | undefined)?.find(b => b.canonicalId === service.bookingId);
      if (!booking || !body.sourceHash) throw new Error("This service could not be loaded. Refresh and try again.");
      setChargeTarget({ service, booking, sourceHash: body.sourceHash });
    } catch (cause) { setChargeError(cause instanceof Error ? cause.message : "The current booking could not be loaded."); }
    finally { lock.current = false; setChargeLoading(undefined); setChargeStatus(""); onBusyChange(false); }
  };
  const saveCharges = async (charges: BookingAdditionalChargeInput[]) => {
    if (!chargeTarget || lock.current) return;
    lock.current = true; setChargeStatus("Saving charges…"); onBusyChange(true);
    try {
      const response = await fetch("/api/booking-groups/charges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingGroupId: group.id, bookingId: chargeTarget.booking.canonicalId, expectedVersion: chargeTarget.booking.version, expectedSourceHash: chargeTarget.sourceHash, charges }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Could not save the additional charges.");
      await onAmended();
      setChargeTarget(undefined);
    } finally { lock.current = false; setChargeStatus(""); onBusyChange(false); }
  };

  return <section className={styles.group} data-group-editing={editing ? "true" : undefined} aria-label="All Day Hospitality booking">
    <header className={styles.header}>
      <div className={styles.headline}>
        <p className="eyebrow">All Day Hospitality</p>
        <h2>{group.client.companyName}</h2>
        {group.eventName && <h3 className={styles.eventName}>{group.eventName}</h3>}
        <p className={styles.meta}>{ukLongDate(group.eventDate)} · {group.services.length} services · {group.firstTime}–{group.lastTime}</p>
        <p className={styles.meta}>{group.client.name} · {group.client.email}{group.client.phone ? ` · ${group.client.phone}` : ""}</p>
        {group.client.invoiceReference && <p className={styles.meta}>PO / reference: {group.client.invoiceReference}</p>}
        <p className={styles.meta}>Request reference: {group.reference}</p>
      </div>
      <div className={styles.summary}>
        <div className={styles.chips}><span className={`${styles.chip} ${styles.chipNeutral}`}>Booking status: {group.status}</span><span className={`${styles.chip} ${quoteTone}`}>{quoteLabel}</span></div>
        <span className={styles.totalLabel}>Grand total (inc. VAT)</span>
        <strong className={styles.total}>{money(group.totals.gross)}</strong>
      </div>
    </header>
    <GroupLocation services={group.services} />
    <div className={styles.actions}>
      <button ref={editButton} type="button" disabled={busy || anyCancelled || editing || cancelOpen || Boolean(chargeTarget)} onClick={() => setEditing(true)}>Amend booking</button>
      {!anyCancelled && <button ref={cancelButton} type="button" className={styles.danger} disabled={busy || editing || cancelOpen || Boolean(chargeTarget)} onClick={() => { setCancelError(""); setCancelOpen(true); }}>Cancel booking</button>}
      {ready && group.quote?.driveUrl ? <a href={group.quote.driveUrl} target="_blank" rel="noopener noreferrer">Open group quote</a> : <button type="button" className="primary" disabled={busy || editing || cancelOpen || Boolean(chargeTarget) || !eligible} aria-busy={busy} onClick={onQuote}>{busy ? "Preparing group quote…" : group.quote?.status === "failed" || group.quote?.status === "artifact_pending" ? "Retry group quote" : group.quote ? "Generate updated group quote" : "Generate group quote"}</button>}
    </div>
    {editing && <GroupAmendmentEditor key={group.id} group={group} site={site} oplocId={oplocId} onBusyChange={onBusyChange} onCancel={closeEditor} onSaved={async () => { await onAmended(); closeEditor(); }} />}
    {cancelError && !cancelOpen && !anyCancelled && <p role="alert" className={styles.error}>{cancelError} The booking may already be cancelled. Refresh before retrying.</p>}
    {anyCancelled && <>
      <CancellationStatusPanel view={cancellation} retry={cancelOutcome} busy={cancelBusy} error={cancelError} onRetry={() => void runCancel("Retry cancellation downstream recovery", true)} />
      <ul className={styles.cancelServices} aria-label="Cancellation status by service">{group.services.map(s => <li key={s.bookingId}><span>{s.time} · {s.serviceType.replaceAll("_", " ")}</span><strong>{cancellationView({ lifecycleStatus: s.lifecycleStatus, cancellation: s.cancellation }).headline.replace(/^Cancelled — /, "")}</strong></li>)}</ul>
    </>}
    {cancelOpen && <div className="modal-backdrop" role="presentation"><form ref={cancelDialog} className="modal hospitality-action-modal" role="dialog" aria-modal="true" aria-labelledby="group-cancel-title" onSubmit={event => { event.preventDefault(); void runCancel(cancelReason.trim(), false); }}>
      <p className="eyebrow">Governed workflow command</p>
      <h2 id="group-cancel-title">Cancel {group.services.length} services?</h2>
      <p>This cancels the whole All Day Hospitality booking for {group.client.companyName} on {ukLongDate(group.eventDate)}. Production work is withdrawn from CPU and Logistics where it is safe to do so; anything CPU has already advanced is flagged for manual review instead.</p>
      <p>Where the Hub has customer cancellation email enabled for this site, one consolidated cancellation email is queued for the whole group, covering the services cancelled here and naming any that remain active. A queued email is not a confirmation that it was delivered.</p>
      <label>Cancellation reason<textarea autoFocus required minLength={3} maxLength={1000} value={cancelReason} disabled={cancelBusy} onChange={event => setCancelReason(event.target.value)} /></label>
      {cancelError && <p role="alert" className={styles.error}>{cancelError}</p>}
      <footer><button type="button" onClick={closeCancel} disabled={cancelBusy}>Keep booking</button><button type="submit" className={styles.dangerSolid} disabled={cancelBusy || cancelReason.trim().length < 3} aria-busy={cancelBusy}>{cancelBusy ? "Cancelling…" : `Cancel ${group.services.length} services`}</button></footer>
    </form></div>}
    {!statesEligible && !ready && <p role="status" className={styles.notice}>Some services are not in a state that allows a new quote. Review their operational status.</p>}
    {group.quote?.status === "artifact_pending" && <p role="status" className={styles.notice}>Quote preparation is in progress. Refresh to check the result, or retry to resume after an interruption.</p>}
    {group.quote?.error && <p role="alert" className={styles.error}>{group.quote.error}</p>}
    {group.quote?.stale && group.quote.status === "complete" && <p role="status" className={styles.notice}>The previous quote is retained for history. Generate an updated group quote for the current services.</p>}
    {!editing && <section className={styles.servicesNav} aria-labelledby="group-services-heading">
      <h3 id="group-services-heading">Services in this booking</h3>
      <div className={styles.tableWrap}><table className={styles.serviceTable}>
        <thead><tr><th scope="col">Service</th><th scope="col">Location</th><th scope="col" className={styles.num}>Guests</th><th scope="col">Status</th><th scope="col" className={styles.num}>Net</th></tr></thead>
        <tbody>{group.services.map(service => <tr key={service.bookingId}>
          <th scope="row"><a href={`#${serviceAnchor(group, service)}`}>{serviceLabel(service)}</a></th>
          <td data-label="Location">{service.location}</td>
          <td data-label="Guests" className={styles.num}>{service.guests}</td>
          <td data-label="Status"><span className={`${styles.chip} ${chipTone(service.lifecycleStatus)}`}>{groupServiceStatusLabel(service)}</span></td>
          <td data-label="Net" className={styles.num}>{money(service.totals.net)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
    {!editing && <section className={styles.requested} aria-labelledby="group-requested-heading">
      <p className="eyebrow">Commercial snapshot</p>
      <h3 id="group-requested-heading">What was requested</h3>
      <RequestedItemsList rows={groupRequestedItems(group)} />
    </section>}
    {!editing && <section className={styles.charges} aria-labelledby="group-charges-heading">
      <h3 id="group-charges-heading">Additional charges by service</h3>
      <p className={styles.help}>Charges are saved to one service at a time using the same rules as a single booking. Other services are not changed, and the group quote must be regenerated afterwards.</p>
      <p role="status" aria-live="polite" className={styles.help}>{chargeStatus}</p>
      {chargeError && <p role="alert" className={styles.error}>{chargeError}</p>}
      {group.services.map(service => {
        const editable = CHARGE_EDITABLE.includes(service.lifecycleStatus);
        return <article key={service.bookingId} id={serviceAnchor(group, service)} className={styles.chargeService} aria-label={`Additional charges for ${serviceLabel(service)}`}>
          <div className={styles.chargeHead}>
            <div><strong>{serviceLabel(service)}</strong><span className={styles.chargeNet}>{service.charges.length ? `${money(service.totals.chargesNet)} net` : "No additional charges"}</span></div>
            <button type="button" disabled={busy || !editable || Boolean(chargeLoading) || cancelOpen || Boolean(chargeTarget)} aria-busy={chargeLoading === service.bookingId} aria-label={`Manage charges for ${serviceLabel(service)}`} onClick={() => void openCharges(service)}>{chargeLoading === service.bookingId ? "Loading…" : "Manage charges"}</button>
          </div>
          {service.charges.length > 0 && <ul className={styles.chargeList}>{service.charges.map((charge, i) => <li key={`${service.bookingId}:${i}`}><span>{charge.label}{charge.detail && <small>{charge.detail}</small>}</span><strong>{money(charge.net)}</strong></li>)}</ul>}
          {!editable && <p className={styles.help}>Charges can be changed on new, reviewed, quoted and completed services. Otherwise amend the booking.</p>}
        </article>;
      })}
    </section>}
    {chargeTarget && <AdditionalChargesModal booking={chargeTarget.booking} context={`Service ${serviceLabel(chargeTarget.service)}`} busy={busy} onCancel={() => setChargeTarget(undefined)} onSave={saveCharges} />}
    {!editing && production}
    {!editing && <dl className={styles.totals}><div><dt>Items subtotal</dt><dd>{money(group.totals.itemsNet)}</dd></div><div><dt>Additional charges</dt><dd>{money(group.totals.chargesNet)}</dd></div><div><dt>Total net</dt><dd>{money(group.totals.net)}</dd></div><div><dt>VAT as recorded</dt><dd>{money(group.totals.vat)}</dd></div><div className={styles.grand}><dt>Grand total</dt><dd>{money(group.totals.gross)}</dd></div></dl>}
  </section>;
}

/** Floor and room for the whole All Day booking: one shared summary when every service matches, otherwise each service's own floor and room. */
function GroupLocation({ services }: { services: HospitalityGroupService[] }) {
  const { shared, first, rows: locations } = groupLocationView(services);
  if (shared) {
    return <section className={styles.location} aria-labelledby="group-location-heading">
      <h3 id="group-location-heading">Delivery location</h3>
      <dl className={styles.locationGrid}>
        <div><dt>Floor level</dt><dd>{first.floorLevel ?? <span className={styles.locationMissing}>Not recorded</span>}</dd></div>
        <div><dt>Room or area</dt><dd>{first.roomOrArea ?? <span className={styles.locationMissing}>Not recorded</span>}</dd></div>
        {first.deliveryPoint && <div><dt>Delivery point</dt><dd>{first.deliveryPoint}</dd></div>}
      </dl>
      {(!first.floorLevel || !first.roomOrArea) && <p className={styles.locationNote}>Floor or room is missing on this historical booking. Confirm it with the customer before service.</p>}
    </section>;
  }
  return <section className={styles.location} aria-labelledby="group-location-heading">
    <h3 id="group-location-heading">Delivery location</h3>
    <p className={styles.locationNote}>Locations vary by service. Check the floor and room for each service below.</p>
    <ul className={styles.locationRows}>
      {services.map((service, index) => {
        const location = locations[index];
        return <li key={service.bookingId} className={styles.locationRow}>
          <strong>{serviceLabel(service)}</strong>
          <dl className={styles.locationGrid}>
            <div><dt>Floor level</dt><dd>{location.floorLevel ?? <span className={styles.locationMissing}>Not recorded</span>}</dd></div>
            <div><dt>Room or area</dt><dd>{location.roomOrArea ?? <span className={styles.locationMissing}>Not recorded</span>}</dd></div>
            {location.deliveryPoint && <div><dt>Delivery point</dt><dd>{location.deliveryPoint}</dd></div>}
          </dl>
        </li>;
      })}
    </ul>
  </section>;
}
