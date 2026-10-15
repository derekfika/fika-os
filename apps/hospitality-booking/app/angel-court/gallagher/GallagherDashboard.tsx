"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { GallagherBooking } from "@/lib/gallagher-dashboard";
import styles from "./GallagherDashboard.module.css";

type DashboardData = { bookings: GallagherBooking[]; counts: { legacyMatches: number; legacyEmailMatches: number; fikaMatches: number; dedupedTotal: number } };

const dataPath = "/angel-court/gallagher/data";
const sessionPath = "/angel-court/gallagher/session";
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const moneyFormat = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function londonToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function displayDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date not recorded";
  return dateFormat.format(new Date(`${value}T12:00:00Z`));
}

function itemSummary(items: GallagherBooking["items"]) {
  if (!items.length) return "Items not recorded";
  if (items.length <= 2) return items.map((item) => `${item.name}${item.quantity === null ? "" : ` x ${item.quantity}`}`).join(", ");
  return `${items.length} items`;
}

function BookingDetails({ booking, onClose }: { booking: GallagherBooking; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
  }, [onClose]);
  return <div className={styles.scrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="booking-detail-title" tabIndex={-1}>
      <div className={styles.drawerHead}>
        <div><p className={styles.eyebrow}>Booking details</p><h2 id="booking-detail-title">{booking.bookingReference || "Booking"}</h2></div>
        <button ref={closeRef} type="button" className={styles.closeButton} onClick={onClose} aria-label="Close booking details">Close</button>
      </div>
      <dl className={styles.detailGrid}>
        <div><dt>Date</dt><dd>{displayDate(booking.date)}</dd></div>
        <div><dt>Time</dt><dd>{booking.startTime || "Not recorded"}{booking.endTime ? ` – ${booking.endTime}` : ""}</dd></div>
        <div><dt>Room / location</dt><dd>{booking.location || "One Angel Court"}</dd></div>
        <div><dt>Guests</dt><dd>{booking.guestCount ?? "Not recorded"}</dd></div>
        <div><dt>Company</dt><dd>{booking.company || "Not recorded"}</dd></div>
        <div><dt>Requester</dt><dd>{booking.requesterName || "Not recorded"}{booking.requesterEmail ? <><br /><a href={`mailto:${booking.requesterEmail}`}>{booking.requesterEmail}</a></> : null}</dd></div>
        <div><dt>PO / invoice reference</dt><dd>{booking.poReference || "Not recorded"}</dd></div>
        <div><dt>Recorded price</dt><dd>{booking.totalPrice === null ? "Price unavailable" : moneyFormat.format(booking.totalPrice)}</dd></div>
        <div><dt>Status</dt><dd><Status status={booking.status} /></dd></div>
        {booking.canonicalBookingId ? <div><dt>FIKA OS booking ID</dt><dd className={styles.mono}>{booking.canonicalBookingId}</dd></div> : null}
        <div><dt>Source</dt><dd>{booking.source === "legacy" ? "Legacy booking" : "FIKA OS"}</dd></div>
        {booking.createdAt ? <div><dt>Created</dt><dd>{booking.createdAt}</dd></div> : null}
        {booking.updatedAt ? <div><dt>Last updated</dt><dd>{booking.updatedAt}</dd></div> : null}
      </dl>
      <div className={styles.itemsBlock}>
        <h3>Ordered items</h3>
        {booking.items.length ? <ul>{booking.items.map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><strong>{item.quantity === null ? "Qty not recorded" : `x ${item.quantity}`}</strong>{item.notes ? <small>{item.notes}</small> : null}</li>)}</ul> : <p>No items were recorded.</p>}
      </div>
      {booking.notes ? <div className={styles.notes}><h3>Notes</h3><p>{booking.notes}</p></div> : null}
      <p className={styles.detailFooter}>For changes to a future booking, please contact the on-site manager.</p>
    </section>
  </div>;
}

function Status({ status }: { status: GallagherBooking["status"] }) {
  const className = status === "Cancelled" ? styles.cancelled : status === "Completed" ? styles.completed : styles.upcoming;
  return <span className={`${styles.status} ${className}`}>{status}</span>;
}

function BookingTable({ bookings, onSelect }: { bookings: GallagherBooking[]; onSelect: (booking: GallagherBooking) => void }) {
  if (!bookings.length) return <div className={styles.empty}>No bookings in this view.</div>;
  return <>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Date</th><th>Time</th><th>Pax</th><th>Items</th><th>Price</th><th>Reference</th><th>Status</th></tr></thead>
        <tbody>{bookings.map((booking) => <tr key={`${booking.source}-${booking.sourceBookingId}`}>
          <td><button className={styles.rowLink} type="button" onClick={() => onSelect(booking)}>{displayDate(booking.date)}</button></td>
          <td>{booking.startTime || "—"}{booking.endTime ? ` – ${booking.endTime}` : ""}</td>
          <td>{booking.guestCount ?? "—"}</td>
          <td className={styles.itemsCell}>{itemSummary(booking.items)}</td>
          <td>{booking.totalPrice === null ? "Price unavailable" : moneyFormat.format(booking.totalPrice)}</td>
          <td>{booking.bookingReference || "—"}</td>
          <td><Status status={booking.status} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className={styles.cards}>{bookings.map((booking) => <button className={styles.bookingCard} type="button" key={`${booking.source}-${booking.sourceBookingId}`} onClick={() => onSelect(booking)}>
      <span className={styles.cardTop}><strong>{displayDate(booking.date)}</strong><Status status={booking.status} /></span>
      <span className={styles.cardMeta}>{booking.startTime || "Time not recorded"}{booking.endTime ? ` – ${booking.endTime}` : ""} · {booking.guestCount ?? "Pax not recorded"} pax</span>
      <span>{itemSummary(booking.items)}</span>
      <span className={styles.cardBottom}><span>{booking.bookingReference || "Reference not recorded"}</span><strong>{booking.totalPrice === null ? "Price unavailable" : moneyFormat.format(booking.totalPrice)}</strong></span>
    </button>)}</div>
  </>;
}

export default function GallagherDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<"upcoming" | "history">("upcoming");
  const [selected, setSelected] = useState<GallagherBooking | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");

  const loadBookings = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(dataPath, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) { setAuthenticated(false); setData(null); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Bookings could not be loaded.");
      setData(body as DashboardData);
      setAuthenticated(true);
    } catch (err) {
      setError((err as Error).message || "Bookings are temporarily unavailable.");
    } finally { setBusy(false); }
  }, []);
  const closeDetails = useCallback(() => setSelected(null), []);

  useEffect(() => { void loadBookings(); }, [loadBookings]);

  const visibleBookings = useMemo(() => {
    if (!data) return [];
    const today = londonToday();
    const upcoming = data.bookings.filter((booking) => booking.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    const history = data.bookings.filter((booking) => booking.date < today).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
    return view === "upcoming" ? upcoming : history;
  }, [data, view]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(sessionPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }), credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "PIN was not accepted.");
      setPin("");
      await loadBookings();
    } catch (err) { setError((err as Error).message || "PIN was not accepted."); }
    finally { setSubmitting(false); }
  }

  async function lock() {
    setSubmitting(true);
    try { await fetch(sessionPath, { method: "DELETE", credentials: "same-origin", cache: "no-store" }); }
    finally { setData(null); setAuthenticated(false); setSelected(null); setError(""); setSubmitting(false); }
  }

  if (!authenticated) return <main className={`${styles.page} ${styles.pinPage}`}>
    <header className={styles.header}>
      <img src="/brand/angel-court/angel-court-bank-logo.png" alt="One Angel Court" />
      <span>Hospitality bookings</span>
    </header>
    <section className={styles.pinCard} aria-labelledby="pin-title">
      <p className={styles.eyebrow}>One Angel Court</p>
      <h1 id="pin-title">Gallagher Bookings</h1>
      <p>Enter your PIN to view booking details.</p>
      <form onSubmit={unlock} className={styles.pinForm}>
        <label htmlFor="gallagher-pin">Dashboard PIN</label>
        <input id="gallagher-pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4,12}" minLength={4} maxLength={12} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))} required />
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button className={styles.primaryButton} type="submit" disabled={submitting || busy}>{submitting ? "Checking…" : "Open dashboard"}</button>
      </form>
      <p className={styles.helper}>This dashboard is view-only. Contact the on-site manager to change a future booking.</p>
    </section>
  </main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/brand/angel-court/angel-court-bank-logo.png" alt="One Angel Court" /><span>Hospitality bookings</span></div>
      <button type="button" className={styles.lockButton} onClick={lock} disabled={submitting}>Lock dashboard</button>
    </header>
    <section className={styles.content}>
      <div className={styles.titleRow}><div><p className={styles.eyebrow}>One Angel Court</p><h1>Gallagher Bookings</h1><p className={styles.subhead}>A read-only record of your hospitality bookings.</p></div>
        {data ? <div className={styles.totalCount}><strong>{data.counts.dedupedTotal}</strong><span>bookings</span></div> : null}
      </div>
      {error ? <div className={styles.errorPanel} role="alert">{error}<button type="button" onClick={() => void loadBookings()}>Try again</button></div> : null}
      <nav className={styles.tabs} aria-label="Booking views">
        <button type="button" aria-current={view === "upcoming" ? "page" : undefined} className={view === "upcoming" ? styles.activeTab : ""} onClick={() => setView("upcoming")}>Upcoming <span>{data?.bookings.filter((booking) => booking.date >= londonToday()).length ?? 0}</span></button>
        <button type="button" aria-current={view === "history" ? "page" : undefined} className={view === "history" ? styles.activeTab : ""} onClick={() => setView("history")}>History <span>{data?.bookings.filter((booking) => booking.date < londonToday()).length ?? 0}</span></button>
      </nav>
      <section className={styles.listPanel} aria-live="polite">
        <div className={styles.panelHead}><h2>{view === "upcoming" ? "Upcoming bookings" : "Booking history"}</h2><span>{busy ? "Refreshing…" : `${visibleBookings.length} shown`}</span></div>
        {busy && !data ? <div className={styles.empty}>Loading bookings…</div> : <BookingTable bookings={visibleBookings} onSelect={setSelected} />}
      </section>
      <p className={styles.readOnlyNote}>Need to make a change to a future booking? Please contact the on-site manager.</p>
    </section>
    {selected ? <BookingDetails booking={selected} onClose={closeDetails} /> : null}
  </main>;
}
