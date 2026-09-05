"use client";

import { useEffect, useRef, useState } from "react";
import type { CanonicalBooking } from "@/lib/hospitality-booking-service";

const statuses = ["New", "Reviewed", "Quoted", "Approved", "Completed", "Cancelled"] as const;
type BookingStatus = typeof statuses[number];

function BookingReasonModal({ booking, targetStatus, busy, error, onCancel, onConfirm }: { booking: CanonicalBooking; targetStatus: BookingStatus; busy: boolean; error: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  busyRef.current = busy;
  cancelRef.current = onCancel;

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    reasonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busyRef.current) cancelRef.current(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); opener.current?.focus(); };
  }, []);

  return <div className="detail-backdrop" role="presentation">
    <section className="detail-modal connection-dialog booking-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-reason-title" aria-describedby="booking-reason-description">
      <header><div><small>Canonical Booking workflow</small><h2 id="booking-reason-title">Change Booking status</h2></div></header>
      <div className="connection-dialog-body">
        <p id="booking-reason-description">{booking.client.companyName} · {booking.service.eventDate} · Booking {booking.source.sourceBookingId}</p>
        <p>Current status: <strong>{booking.lifecycleStatus}</strong> · New status: <strong>{targetStatus}</strong></p>
        <label>Reason <span>(required)</span><textarea ref={reasonRef} required aria-required="true" value={reason} onChange={event => setReason(event.target.value)} placeholder={`Explain why this Booking is moving to ${targetStatus}.`} /></label>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer className="modal-actions">
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className={targetStatus === "Cancelled" ? "danger" : "primary"} disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>{busy ? "Saving…" : `Confirm ${targetStatus}`}</button>
      </footer>
    </section>
  </div>;
}

export default function HospitalityBookings() {
  const [bookings, setBookings] = useState<CanonicalBooking[]>([]);
  const [selected, setSelected] = useState<CanonicalBooking | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ status: BookingStatus; opener: HTMLButtonElement | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const load = async () => { const response = await fetch("/api/hospitality-bookings", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw Error(body.error?.message || "Could not load canonical Bookings."); setBookings(body.bookings); setSelected(current => body.bookings.find((booking: CanonicalBooking) => booking.canonicalId === current?.canonicalId) || null); };
  useEffect(() => { void load().catch(cause => setError(cause.message)); }, []);
  const change = async (status: BookingStatus, reason: string) => { if (!selected) return; setSaving(true); setError(""); const response = await fetch("/api/hospitality-bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canonicalId: selected.canonicalId, expectedVersion: selected.version, status, reason }) }); const body = await response.json(); if (!response.ok) { setError(body.error?.message || "Booking action failed."); setSaving(false); return; } setSelected(body); setPending(null); setSaving(false); await load(); };
  return <section className="panel"><div className="page-heading"><small>Canonical operational workspace</small><h2>Hospitality Bookings</h2><p>MNK pilot Bookings are read from the Canon. The legacy dashboard and its Sheets workflow remain an untouched compatibility path.</p></div>{error && !pending && <p className="error">{error}</p>}<div className="booking-workspace"><div className="booking-list"><h3>Upcoming and recent</h3>{bookings.length ? bookings.map(booking => <button key={booking.canonicalId} className={selected?.canonicalId === booking.canonicalId ? "selected" : ""} onClick={() => setSelected(booking)}><b>{booking.client.companyName}</b><span>{booking.service.eventDate} · {booking.service.startTime} · {booking.service.portalSiteLabel || "Unresolved portal location"}</span><small>{booking.lifecycleStatus} · £{booking.order.grossTotal.toFixed(2)} · dietary: {Object.keys(booking.dietaries).length ? "recorded" : "none"}</small></button>) : <p className="empty">No canonical MNK Bookings have been ingested yet.</p>}</div><div className="booking-detail">{selected ? <><h3>{selected.client.companyName}</h3><p><b>Contact:</b> {selected.client.name} · {selected.client.email}</p><p><b>Service:</b> {selected.service.eventDate} {selected.service.startTime} · {selected.service.guestCount} guests</p><p><b>Source:</b> MNK portal booking {selected.source.sourceBookingId}</p><h4>Order snapshot</h4><ul>{selected.order.items.map(item => <li key={`${item.itemId}-${item.lineTotal}`}>{item.quantity} × {item.itemName || item.itemId} — £{item.lineTotal.toFixed(2)}</li>)}</ul><h4>Dietary and notes</h4><pre>{JSON.stringify({ dietaries: selected.dietaries, notes: selected.notes || "" }, null, 2)}</pre><h4>Authorised workflow</h4><div className="actions">{statuses.filter(status => status !== selected.lifecycleStatus).map(status => <button key={status} onClick={event => setPending({ status, opener: event.currentTarget })}>{status}</button>)}</div><details className="technical-details"><summary>Source and audit trail</summary><pre>{JSON.stringify({ source: selected.source, statusHistory: selected.statusHistory, audit: selected.audit }, null, 2)}</pre></details></> : <p className="empty">Select a canonical Booking to review its customer intent, commercial snapshot and audit trail.</p>}</div></div>{pending && selected && <BookingReasonModal booking={selected} targetStatus={pending.status} busy={saving} error={error} onCancel={() => { if (!saving) setPending(null); }} onConfirm={reason => void change(pending.status, reason)} />}</section>;
}
