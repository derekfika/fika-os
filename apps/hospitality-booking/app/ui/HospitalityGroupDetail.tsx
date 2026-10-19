"use client";
import { useRef, useState } from "react";
import { GroupAmendmentEditor } from "./GroupAmendmentEditor";
import { AdditionalChargesModal } from "./AdditionalChargesModal";
import type { ReactNode } from "react";
import type { BookingAdditionalChargeInput, CanonicalBooking } from "@/lib/canonical-types";
import type { HospitalityBookingGroup, HospitalityGroupService } from "../../../shared/hospitality-group-quotes";
import { groupRequestedItems } from "../../lib/booking-presentation";
import { RequestedItemsList } from "./RequestedItemsList";
import styles from "./HospitalityGroupDetail.module.css";

const money = (n: number) => `£${n.toFixed(2)}`;
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
  const lock = useRef(false);
  const ready = group.quote?.status === "complete" && !group.quote.stale;
  const statesEligible = group.services.every(s => ["New", "Reviewed", "Quoted", "Completed", "Sent to CPU"].includes(s.lifecycleStatus));
  const eligible = !(group.quote?.status === "integrity_failed" && !group.quote.stale) && statesEligible;
  const quoteLabel = ready ? "Quote current" : group.quote?.stale && group.quote.status === "complete" ? "Quote out of date" : group.quote?.status === "artifact_pending" ? "Quote in progress" : group.quote?.status === "failed" ? "Quote failed" : "Not quoted";
  const quoteTone = ready ? styles.chipSuccess : group.quote ? styles.chipWarning : styles.chipNeutral;

  /** Always load the service's current charges and version from the Hub so a stale list can never be saved over newer work. */
  const openCharges = async (service: HospitalityGroupService) => {
    if (lock.current) return;
    lock.current = true; setChargeLoading(service.bookingId); setChargeError(""); onBusyChange(true);
    try {
      const response = await fetch(`/api/booking-groups/amend?bookingGroupId=${encodeURIComponent(group.id)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The current booking could not be loaded.");
      const booking = (body.bookings as CanonicalBooking[] | undefined)?.find(b => b.canonicalId === service.bookingId);
      if (!booking || !body.sourceHash) throw new Error("This service could not be loaded. Refresh and try again.");
      setChargeTarget({ service, booking, sourceHash: body.sourceHash });
    } catch (cause) { setChargeError(cause instanceof Error ? cause.message : "The current booking could not be loaded."); }
    finally { lock.current = false; setChargeLoading(undefined); onBusyChange(false); }
  };
  const saveCharges = async (charges: BookingAdditionalChargeInput[]) => {
    if (!chargeTarget || lock.current) return;
    lock.current = true; onBusyChange(true);
    try {
      const response = await fetch("/api/booking-groups/charges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingGroupId: group.id, bookingId: chargeTarget.booking.canonicalId, expectedVersion: chargeTarget.booking.version, expectedSourceHash: chargeTarget.sourceHash, charges }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Could not save the additional charges.");
      await onAmended();
      setChargeTarget(undefined);
    } finally { lock.current = false; onBusyChange(false); }
  };

  return <section className={styles.group} data-group-editing={editing ? "true" : undefined} aria-label="All Day Hospitality booking">
    <header className={styles.header}>
      <div className={styles.headline}>
        <p className="eyebrow">All Day Hospitality</p>
        <h2>{group.client.companyName}</h2>
        {group.eventName && <h3 className={styles.eventName}>{group.eventName}</h3>}
        <p className={styles.meta}>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${group.eventDate}T12:00:00Z`))} · {group.services.length} services · {group.firstTime}–{group.lastTime}</p>
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
    <div className={styles.actions}>
      <button ref={editButton} type="button" disabled={busy || group.services.some(s => s.lifecycleStatus === "Cancelled") || editing} onClick={() => setEditing(true)}>Amend booking</button>
      {ready && group.quote?.driveUrl ? <a href={group.quote.driveUrl} target="_blank" rel="noopener noreferrer">Open group quote</a> : <button type="button" className="primary" disabled={busy || editing || !eligible} aria-busy={busy} onClick={onQuote}>{busy ? "Preparing group quote…" : group.quote?.status === "failed" || group.quote?.status === "artifact_pending" ? "Retry group quote" : group.quote ? "Generate updated group quote" : "Generate group quote"}</button>}
    </div>
    {editing && <GroupAmendmentEditor key={group.id} group={group} site={site} oplocId={oplocId} onBusyChange={onBusyChange} onCancel={closeEditor} onSaved={async () => { await onAmended(); closeEditor(); }} />}
    <p className={styles.help}>Group cancellation is not yet available.</p>
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
          <td data-label="Status"><span className={`${styles.chip} ${chipTone(service.lifecycleStatus)}`}>{service.lifecycleStatus}</span></td>
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
      {chargeError && <p role="alert" className={styles.error}>{chargeError}</p>}
      {group.services.map(service => {
        const editable = CHARGE_EDITABLE.includes(service.lifecycleStatus);
        return <article key={service.bookingId} id={serviceAnchor(group, service)} className={styles.chargeService} aria-label={`Additional charges for ${serviceLabel(service)}`}>
          <div className={styles.chargeHead}>
            <div><strong>{serviceLabel(service)}</strong><span className={styles.chargeNet}>{service.charges.length ? `${money(service.totals.chargesNet)} net` : "No additional charges"}</span></div>
            <button type="button" disabled={busy || !editable || Boolean(chargeLoading)} aria-busy={chargeLoading === service.bookingId} aria-label={`Manage charges for ${serviceLabel(service)}`} onClick={() => void openCharges(service)}>{chargeLoading === service.bookingId ? "Loading…" : "Manage charges"}</button>
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
