"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GallagherBooking } from "@/lib/gallagher-dashboard";
import {
  defaultSort,
  emptyFilters,
  filterBookings,
  filtersActive,
  formatBusinessDate,
  formatTimeRange,
  invalidDateRange,
  londonToday,
  sortBookings,
  splitByView,
  summariseItems,
  summarise,
} from "@/lib/gallagher-view";
import type { DateSort, LedgerFilters, LedgerView, StatusFilter } from "@/lib/gallagher-view";
import styles from "./GallagherDashboard.module.css";

type DashboardData = {
  bookings: GallagherBooking[];
  counts: { legacyMatches: number; legacyEmailMatches: number; fikaMatches: number; dedupedTotal: number };
};
type Phase = "checking" | "locked" | "ready";

const dataPath = "/angel-court/gallagher/data";
const sessionPath = "/angel-court/gallagher/session";
const logoPath = "/brand/angel-court/angel-court-bank-logo.png";
const pageSize = 25;
const staleAfterMs = 10 * 60_000;
const moneyFormat = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

const formatPrice = (value: number | null) => (value === null ? "Price unavailable" : moneyFormat.format(value));
const bookingKey = (booking: GallagherBooking) => `${booking.source}-${booking.sourceBookingId}`;

function Icon({ name }: { name: "lock" | "refresh" | "search" | "check" | "clock" | "cross" | "close" | "chevron" | "calendar" | "alert" }) {
  const paths: Record<string, string> = {
    lock: "M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
    refresh: "M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4",
    search: "m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
    check: "m5 12.5 4.5 4.5L19 7.5",
    clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    cross: "m6 6 12 12M18 6 6 18",
    close: "m6 6 12 12M18 6 6 18",
    chevron: "m9 6 6 6-6 6",
    calendar: "M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    alert: "M12 8v5m0 3.5v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z",
  };
  return <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

function Brand() {
  return <div className={styles.brand}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={logoPath} alt="One Angel Court" />
    <span>Hospitality bookings</span>
  </div>;
}

function StatusBadge({ status }: { status: GallagherBooking["status"] }) {
  const tone = status === "Cancelled" ? styles.cancelled : status === "Completed" ? styles.completed : styles.upcoming;
  return <span className={`${styles.status} ${tone}`}><Icon name={status === "Cancelled" ? "cross" : status === "Completed" ? "check" : "clock"} />{status}</span>;
}

function SummaryTiles({ data, today }: { data: DashboardData; today: string }) {
  const summary = useMemo(() => summarise(data.bookings, today), [data, today]);
  return <dl className={styles.summary} aria-label="Booking summary">
    <div className={`${styles.tile} ${styles.tileNext}`}>
      <dt>Next booking</dt>
      {summary.next
        ? <dd><strong>{formatBusinessDate(summary.next.date)}</strong><span>{formatTimeRange(summary.next)}{summary.next.guestCount !== null ? ` · ${summary.next.guestCount} guests` : ""}</span></dd>
        : <dd><strong>None scheduled</strong><span>Nothing upcoming right now</span></dd>}
    </div>
    <div className={styles.tile}><dt>Upcoming</dt><dd><strong>{summary.upcoming}</strong><span>not cancelled</span></dd></div>
    <div className={styles.tile}><dt>Completed</dt><dd><strong>{summary.completed}</strong><span>in history</span></dd></div>
    <div className={styles.tile}><dt>Cancelled</dt><dd><strong>{summary.cancelled}</strong><span>not proceeding</span></dd></div>
  </dl>;
}

function BookingDetails({ booking, onClose }: { booking: GallagherBooking; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  const hasItems = booking.items.length > 0;
  return <div className={styles.scrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="booking-detail-title" tabIndex={-1}>
      <header className={styles.drawerHead}>
        <div>
          <p className={styles.eyebrow}>Booking {booking.bookingReference || "reference not recorded"}</p>
          <h2 id="booking-detail-title">{formatBusinessDate(booking.date, "long")}</h2>
          <div className={styles.drawerMeta}><StatusBadge status={booking.status} /><span>{formatTimeRange(booking)}</span></div>
        </div>
        <button ref={closeRef} type="button" className={styles.iconButton} onClick={onClose} aria-label="Close booking details"><Icon name="close" /></button>
      </header>

      <div className={styles.drawerBody}>
        {booking.status === "Cancelled" ? <p className={styles.cancelNote} role="note"><Icon name="alert" />This booking has been cancelled.</p> : null}
        <section aria-labelledby="detail-service">
          <h3 id="detail-service">Service</h3>
          <dl className={styles.detailGrid}>
            <div><dt>Date</dt><dd>{formatBusinessDate(booking.date, "long")}</dd></div>
            <div><dt>Time</dt><dd>{formatTimeRange(booking)}</dd></div>
            <div><dt>Room / location</dt><dd>{booking.location || "One Angel Court"}</dd></div>
            <div><dt>Guests</dt><dd>{booking.guestCount ?? "Not recorded"}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="detail-contact">
          <h3 id="detail-contact">Requested by</h3>
          <dl className={styles.detailGrid}>
            <div><dt>Company</dt><dd>{booking.company || "Not recorded"}</dd></div>
            <div><dt>Contact</dt><dd>{booking.requesterName || "Not recorded"}{booking.requesterEmail ? <><br /><a href={`mailto:${booking.requesterEmail}`}>{booking.requesterEmail}</a></> : null}</dd></div>
            <div><dt>PO / invoice reference</dt><dd>{booking.poReference || "Not recorded"}</dd></div>
            <div><dt>Booking reference</dt><dd className={styles.mono}>{booking.bookingReference || "Not recorded"}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="detail-items">
          <h3 id="detail-items">Ordered items</h3>
          {hasItems
            ? <ul className={styles.itemList}>{booking.items.map((item, index) => <li key={`${item.name}-${index}`}>
                <span>{item.name}</span>
                <strong>{item.quantity === null ? "Qty not recorded" : `× ${item.quantity}`}</strong>
                {item.notes ? <small>{item.notes}</small> : null}
              </li>)}</ul>
            : <p className={styles.muted}>No items were recorded for this booking.</p>}
        </section>
        <section aria-labelledby="detail-price" className={styles.priceBox}>
          <h3 id="detail-price">Recorded price</h3>
          <p className={styles.price}>{formatPrice(booking.totalPrice)}</p>
          <p className={styles.muted}>The total recorded for this booking, including management fee and VAT where applicable. Shown as stored; it is not recalculated.</p>
        </section>
        {booking.notes ? <section aria-labelledby="detail-notes"><h3 id="detail-notes">Notes</h3><p className={styles.notes}>{booking.notes}</p></section> : null}
        {booking.createdAt || booking.updatedAt
          ? <p className={styles.timestamps}>{booking.createdAt ? `Created ${booking.createdAt}` : ""}{booking.createdAt && booking.updatedAt ? " · " : ""}{booking.updatedAt ? `Last updated ${booking.updatedAt}` : ""}</p>
          : null}
      </div>
      <footer className={styles.drawerFoot}>
        <p>This dashboard is view-only. To change or cancel a future booking, please contact the on-site manager.</p>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>Close</button>
      </footer>
    </section>
  </div>;
}

function BookingList({ bookings, onSelect, sort, onToggleSort }: { bookings: GallagherBooking[]; onSelect: (booking: GallagherBooking) => void; sort: DateSort; onToggleSort: () => void }) {
  return <>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>Bookings. Use the View button to open full booking details.</caption>
        <thead><tr>
          <th scope="col" aria-sort={sort === "asc" ? "ascending" : "descending"}>
            <button type="button" className={styles.sortButton} onClick={onToggleSort}>Date <span aria-hidden="true">{sort === "asc" ? "↑" : "↓"}</span><span className={styles.srOnly}>, sorted {sort === "asc" ? "oldest first" : "newest first"}. Activate to reverse.</span></button>
          </th>
          <th scope="col">Time</th>
          <th scope="col" className={styles.num}>Guests</th>
          <th scope="col">Items</th>
          <th scope="col">Location</th>
          <th scope="col" className={styles.num}>Price</th>
          <th scope="col">Reference</th>
          <th scope="col">Status</th>
          <th scope="col"><span className={styles.srOnly}>Details</span></th>
        </tr></thead>
        <tbody>{bookings.map((booking) => <tr key={bookingKey(booking)} className={booking.status === "Cancelled" ? styles.rowCancelled : undefined}>
          <th scope="row" className={styles.dateCell}>{formatBusinessDate(booking.date)}</th>
          <td className={styles.timeCell}>{booking.startTime ? formatTimeRange(booking) : "—"}</td>
          <td className={styles.num}>{booking.guestCount ?? "—"}</td>
          <td className={styles.itemsCell} title={booking.items.map((item) => item.name).join(", ") || undefined}>{summariseItems(booking.items)}</td>
          <td className={styles.locationCell}>{booking.location || "—"}</td>
          <td className={styles.num}>{formatPrice(booking.totalPrice)}</td>
          <td className={styles.mono}>{booking.bookingReference || "—"}</td>
          <td><StatusBadge status={booking.status} /></td>
          <td><button type="button" className={styles.viewButton} onClick={() => onSelect(booking)} aria-label={`View details for ${formatBusinessDate(booking.date)}, reference ${booking.bookingReference || "not recorded"}`}>View <Icon name="chevron" /></button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <ul className={styles.cards}>{bookings.map((booking) => <li key={bookingKey(booking)}>
      <button className={`${styles.bookingCard} ${booking.status === "Cancelled" ? styles.rowCancelled : ""}`} type="button" onClick={() => onSelect(booking)} aria-label={`View details for ${formatBusinessDate(booking.date)}, ${booking.status}`}>
        <span className={styles.cardTop}><strong>{formatBusinessDate(booking.date)}</strong><StatusBadge status={booking.status} /></span>
        <span className={styles.cardMeta}>{formatTimeRange(booking)} · {booking.guestCount === null ? "Guests not recorded" : `${booking.guestCount} guests`}</span>
        <span className={styles.cardItems}>{summariseItems(booking.items)}</span>
        <span className={styles.cardBottom}><span className={styles.mono}>{booking.bookingReference || "No reference"}</span><strong>{formatPrice(booking.totalPrice)}</strong></span>
      </button>
    </li>)}</ul>
  </>;
}

function LoadingState() {
  return <div className={styles.skeletons} role="status" aria-live="polite"><span className={styles.srOnly}>Loading your bookings…</span>
    {[0, 1, 2, 3, 4].map((row) => <div key={row} className={styles.skeletonRow} aria-hidden="true"><i /><i /><i /><i /></div>)}
  </div>;
}

export default function GallagherDashboard() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<LedgerView>("upcoming");
  const [filters, setFilters] = useState<LedgerFilters>(emptyFilters);
  const [sortByView, setSortByView] = useState<Record<LedgerView, DateSort>>({ upcoming: defaultSort("upcoming"), history: defaultSort("history") });
  const [visible, setVisible] = useState(pageSize);
  const [selected, setSelected] = useState<GallagherBooking | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [today, setToday] = useState(() => londonToday());
  const idBase = useId();
  const tabRefs = useRef<Record<LedgerView, HTMLButtonElement | null>>({ upcoming: null, history: null });

  const loadBookings = useCallback(async (reason: "initial" | "refresh" = "initial") => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(dataPath, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        setData(null);
        setSelected(null);
        setPhase("locked");
        if (reason === "refresh") setNotice("Your session has ended for security. Please enter your PIN again.");
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { error?: string }).error || "Bookings could not be loaded.");
      setData(body as DashboardData);
      setToday(londonToday());
      setLoadedAt(Date.now());
      setPhase("ready");
    } catch (err) {
      setLoadError((err as Error).message || "Bookings are temporarily unavailable.");
      setPhase((current) => (current === "checking" ? "ready" : current));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadBookings("initial"); }, [loadBookings]);

  // Re-validate quietly when a long-idle tab returns, so an expired session is noticed without polling.
  useEffect(() => {
    if (phase !== "ready") return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt > staleAfterMs) void loadBookings("refresh");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [phase, loadedAt, loadBookings]);

  const split = useMemo(() => splitByView(data?.bookings ?? [], today), [data, today]);
  const inView = view === "upcoming" ? split.upcoming : split.history;
  const sort = sortByView[view];
  const rangeInvalid = invalidDateRange(filters);
  const results = useMemo(() => sortBookings(filterBookings(inView, filters), sort), [inView, filters, sort]);
  const shown = results.slice(0, visible);
  const closeDetails = useCallback(() => setSelected(null), []);

  const updateFilters = (patch: Partial<LedgerFilters>) => { setFilters((current) => ({ ...current, ...patch })); setVisible(pageSize); };
  const switchView = (next: LedgerView) => { setView(next); setVisible(pageSize); };
  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const order: LedgerView[] = ["upcoming", "history"];
    const index = order.indexOf(view);
    let target: LedgerView | null = null;
    if (event.key === "ArrowRight") target = order[(index + 1) % order.length];
    else if (event.key === "ArrowLeft") target = order[(index + order.length - 1) % order.length];
    else if (event.key === "Home") target = order[0];
    else if (event.key === "End") target = order[order.length - 1];
    if (!target) return;
    event.preventDefault();
    switchView(target);
    tabRefs.current[target]?.focus();
  };

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setPinError("");
    try {
      const response = await fetch(sessionPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }), credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { error?: string }).error || "That PIN was not accepted.");
      setPin("");
      setNotice("");
      await loadBookings("initial");
    } catch (err) { setPinError((err as Error).message || "That PIN was not accepted."); }
    finally { setSubmitting(false); }
  }

  async function lock() {
    setSubmitting(true);
    try { await fetch(sessionPath, { method: "DELETE", credentials: "same-origin", cache: "no-store" }); }
    finally {
      setData(null); setSelected(null); setLoadError(""); setFilters(emptyFilters); setView("upcoming"); setVisible(pageSize);
      setNotice("You have been signed out of the dashboard.");
      setPhase("locked");
      setSubmitting(false);
    }
  }

  if (phase === "checking") return <main className={styles.page} aria-busy="true">
    <header className={styles.header}><Brand /></header>
    <div className={styles.centred}><LoadingState /></div>
  </main>;

  if (phase === "locked") return <main className={`${styles.page} ${styles.pinPage}`}>
    <header className={styles.header}><Brand /></header>
    <section className={styles.pinCard} aria-labelledby="pin-title">
      <span className={styles.lockBadge}><Icon name="lock" /></span>
      <p className={styles.eyebrow}>One Angel Court</p>
      <h1 id="pin-title">Gallagher bookings</h1>
      <p className={styles.lead}>Enter your PIN to view your hospitality bookings.</p>
      {notice ? <p className={styles.noticePanel} role="status">{notice}</p> : null}
      <form onSubmit={unlock} className={styles.pinForm} noValidate>
        <label htmlFor="gallagher-pin">Dashboard PIN</label>
        <input id="gallagher-pin" name="pin" type="password" inputMode="numeric" autoComplete="off" autoFocus pattern="[0-9]{4,12}" minLength={4} maxLength={12} value={pin} aria-invalid={pinError ? true : undefined} aria-describedby={pinError ? "gallagher-pin-error" : "gallagher-pin-help"} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))} required />
        <p id="gallagher-pin-help" className={styles.helper}>Numbers only.</p>
        {pinError ? <p id="gallagher-pin-error" className={styles.error} role="alert">{pinError}</p> : null}
        <button className={styles.primaryButton} type="submit" disabled={submitting || pin.length < 4}>{submitting ? "Checking…" : "Open dashboard"}</button>
      </form>
      <p className={styles.helper}>This dashboard is view-only. Contact the on-site manager to change a future booking.</p>
    </section>
  </main>;

  const tabId = (name: LedgerView) => `${idBase}-tab-${name}`;
  const panelId = `${idBase}-panel`;
  const hasData = Boolean(data);
  const nothingAtAll = hasData && data!.bookings.length === 0;

  return <main className={styles.page}>
    <header className={styles.header}>
      <Brand />
      <div className={styles.headerActions}>
        <button type="button" className={styles.secondaryButton} onClick={() => void loadBookings("refresh")} disabled={loading || submitting}><Icon name="refresh" />{loading ? "Refreshing…" : "Refresh"}</button>
        <button type="button" className={styles.secondaryButton} onClick={lock} disabled={submitting}><Icon name="lock" />Lock</button>
      </div>
    </header>

    <div className={styles.content}>
      <section className={styles.hero} aria-labelledby="dashboard-title">
        <div>
          <p className={styles.eyebrow}>One Angel Court</p>
          <h1 id="dashboard-title">Gallagher bookings</h1>
          <p className={styles.lead}>A read-only record of your hospitality bookings, upcoming and past.</p>
        </div>
        {hasData ? <SummaryTiles data={data!} today={today} /> : null}
      </section>

      {loadError ? <div className={styles.errorPanel} role="alert">
        <Icon name="alert" />
        <div><strong>{hasData ? "We couldn’t refresh your bookings." : "We couldn’t load your bookings."}</strong><p>{loadError}{hasData ? " The list below may be out of date." : ""}</p></div>
        <button type="button" className={styles.secondaryButton} onClick={() => void loadBookings("refresh")} disabled={loading}>{loading ? "Trying…" : "Try again"}</button>
      </div> : null}

      {!hasData && !loadError ? <LoadingState /> : null}

      {hasData ? <>
        <div className={styles.tabs} role="tablist" aria-label="Booking views">
          {(["upcoming", "history"] as const).map((name) => <button
            key={name} ref={(node) => { tabRefs.current[name] = node; }} id={tabId(name)} type="button" role="tab"
            aria-selected={view === name} aria-controls={panelId} tabIndex={view === name ? 0 : -1}
            className={view === name ? styles.activeTab : undefined} onClick={() => switchView(name)} onKeyDown={onTabKey}
          >{name === "upcoming" ? "Upcoming" : "History"}<span>{(name === "upcoming" ? split.upcoming : split.history).length}</span></button>)}
        </div>

        <section className={styles.panel} role="tabpanel" id={panelId} aria-labelledby={tabId(view)}>
          <form className={styles.toolbar} role="search" aria-label="Filter bookings" onSubmit={(event) => event.preventDefault()}>
            <div className={`${styles.field} ${styles.searchField}`}>
              <label htmlFor={`${idBase}-q`}>Search</label>
              <div className={styles.searchBox}><Icon name="search" /><input id={`${idBase}-q`} type="search" value={filters.query} placeholder="Reference, item, room, contact…" onChange={(event) => updateFilters({ query: event.target.value })} autoComplete="off" /></div>
            </div>
            <div className={styles.field}><label htmlFor={`${idBase}-from`}>From</label><input id={`${idBase}-from`} type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => updateFilters({ from: event.target.value })} /></div>
            <div className={styles.field}><label htmlFor={`${idBase}-to`}>To</label><input id={`${idBase}-to`} type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => updateFilters({ to: event.target.value })} /></div>
            <div className={styles.field}><label htmlFor={`${idBase}-status`}>Status</label>
              <select id={`${idBase}-status`} value={filters.status} onChange={(event) => updateFilters({ status: event.target.value as StatusFilter })}>
                <option value="all">All statuses</option><option value="Upcoming">Upcoming</option><option value="Completed">Completed</option><option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <button type="button" className={styles.textButton} onClick={() => { setFilters(emptyFilters); setVisible(pageSize); }} disabled={!filtersActive(filters)}>Clear filters</button>
          </form>
          {rangeInvalid ? <p className={styles.error} role="alert">The “To” date is before the “From” date. Adjust the range to see bookings.</p> : null}

          <div className={styles.panelHead}>
            <h2>{view === "upcoming" ? "Upcoming bookings" : "Booking history"}</h2>
            <p aria-live="polite" role="status">{loading ? "Refreshing…" : `Showing ${Math.min(shown.length, results.length)} of ${results.length}${filtersActive(filters) ? ` (filtered from ${inView.length})` : ""}`}</p>
          </div>

          {shown.length ? <BookingList bookings={shown} onSelect={setSelected} sort={sort} onToggleSort={() => setSortByView((current) => ({ ...current, [view]: current[view] === "asc" ? "desc" : "asc" }))} /> : <div className={styles.empty}>
            <span className={styles.emptyIcon}><Icon name="calendar" /></span>
            {nothingAtAll
              ? <><strong>No bookings found yet</strong><p>Bookings made for Gallagher at One Angel Court will appear here.</p></>
              : filtersActive(filters) && inView.length
                ? <><strong>No bookings match your filters</strong><p>Try a different search term or widen the date range.</p><button type="button" className={styles.secondaryButton} onClick={() => { setFilters(emptyFilters); setVisible(pageSize); }}>Clear filters</button></>
                : view === "upcoming"
                  ? <><strong>No upcoming bookings</strong><p>There is nothing scheduled right now. Past bookings are in the History tab.</p><button type="button" className={styles.secondaryButton} onClick={() => switchView("history")}>View history</button></>
                  : <><strong>No past bookings</strong><p>Completed bookings will be listed here.</p></>}
          </div>}

          {results.length > shown.length ? <div className={styles.more}><button type="button" className={styles.secondaryButton} onClick={() => setVisible((count) => count + pageSize)}>Show {Math.min(pageSize, results.length - shown.length)} more</button></div> : null}
        </section>
      </> : null}

      <p className={styles.readOnlyNote}>This dashboard is view-only. To change or cancel a future booking, please contact the on-site manager.</p>
    </div>
    {selected ? <BookingDetails booking={selected} onClose={closeDetails} /> : null}
  </main>;
}
