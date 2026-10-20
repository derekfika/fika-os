"use client";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { addBusinessDate, bookingDateIssue, ukBookingClock, type CutoffContext, type CutoffItem } from "@fika/server-shared/hospitality-effective-offering";

/** Local clock only: no network polling. Re-evaluate at minute boundaries (including noon) and on tab return. */
export function useBookingClock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date().toISOString()); timer = setTimeout(tick, 60000 - Date.now() % 60000 + 5); };
    const visible = () => { if (!document.hidden) setNow(new Date().toISOString()); };
    tick(); document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return now;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Obvious restrictions (past dates, weekends) are shown by styling and announced to assistive tech, not written out. */
const OBVIOUS = new Set(["PAST_DELIVERY_DATE", "DELIVERY_WEEKEND"]);
/** Policy messages carry ISO dates; customers see "Fri 23 Oct". Presentation only: the policy text itself is untouched. */
const shortUkDate = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
export const friendlyDates = (text: string) => text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => shortUkDate(date));
/** Concise tooltip wording per restriction; empty when the reason is obvious from the calendar itself (past dates). */
export function tooltipFor(issue?: { message: string; code?: string; earliestDate?: string }) {
  if (!issue || issue.code === "PAST_DELIVERY_DATE") return "";
  if (issue.code === "DELIVERY_WEEKEND") return "No weekend deliveries";
  if (issue.code === "BOOKING_NOTICE" && issue.earliestDate) return `Too soon \u2014 first available ${shortUkDate(issue.earliestDate)}`;
  return friendlyDates(issue.message);
}
const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const shift = (date: string, days: number) => { const next = utc(date); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); };
const shiftMonth = (date: string, months: number) => { const next = utc(`${date.slice(0, 7)}-01`); next.setUTCMonth(next.getUTCMonth() + months); const first = next.toISOString().slice(0, 7); const last = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate(); return `${first}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, "0")}`; };
/** Readable UK date for a YYYY-MM-DD business date, e.g. "Friday, 23 October 2026". */
export const ukLongBookingDate = (date: string) => ISO.test(date) ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(utc(date)) : "";

/**
 * Date field with a compact calendar popover (modal bottom sheet on narrow screens). All availability rules come from the
 * governed booking policy (bookingDateIssue); this component only presents them.
 */
export function BookingDatePicker({ value, onChange, items, context = {}, now, field = "eventDate", unavailableReason }: { value: string; onChange: (date: string) => void; items: readonly CutoffItem[]; context?: CutoffContext; now: string; field?: string; unavailableReason?: string }) {
  const id = useId();
  const today = ukBookingClock(now).date;
  const valid = ISO.test(value);
  const [open, setOpen] = useState(false);
  const [focusDate, setFocusDate] = useState(valid ? value : today);
  const [hover, setHover] = useState<string | null>(null);
  const [gridFocused, setGridFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ up: false, end: false });
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const cell = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  /** Narrow screens use a bottom sheet rendered in <body>: an animated ancestor would otherwise become the containing block of a fixed element. */
  const [sheet, setSheet] = useState(false);
  const month = focusDate.slice(0, 7), first = `${month}-01`, offset = (utc(first).getUTCDay() + 6) % 7;
  const issueFor = useCallback((date: string) => unavailableReason ? { message: unavailableReason, code: undefined as string | undefined } : bookingDateIssue(items, date, now, context), [unavailableReason, items, now, context]);
  const selectedIssue = value && valid ? issueFor(value) : undefined;
  const dates: string[] = [];
  for (let date = first; date.startsWith(month); date = addBusinessDate(date)) dates.push(date);
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(first));

  const close = useCallback((restore: boolean) => { setOpen(false); setHover(null); setGridFocused(false); setDismissed(null); if (restore) requestAnimationFrame(() => trigger.current?.focus()); }, []);
  const openCalendar = () => {
    const narrow = window.matchMedia("(max-width: 640px)").matches, rect = trigger.current?.getBoundingClientRect();
    // Open upward / right-aligned only when the popover would otherwise leave the viewport.
    if (rect) setPlacement({ up: !narrow && innerHeight - rect.bottom < 300 && rect.top > innerHeight - rect.bottom, end: !narrow && rect.left + 292 > innerWidth - 12 });
    setSheet(narrow); setFocusDate(valid ? value : today); setDismissed(null); setOpen(true);
  };
  // Focus the day the user is on whenever the popover opens or the roving day changes.
  useEffect(() => { if (open) cell.current?.focus(); }, [open, focusDate]);
  // Close when a pointer leaves the field and its popover.
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => { const target = event.target as Node; if (root.current && !root.current.contains(target) && !sheetRef.current?.contains(target)) setOpen(false); };
    document.addEventListener("pointerdown", away); return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  // Modal bottom sheet: keep the page behind it from scrolling.
  useEffect(() => { if (!(open && sheet)) return; const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, [open, sheet]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    // Escape dismisses a visible tooltip first; a second Escape closes the calendar.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (tipText && tipDate) { setDismissed(tipDate); return; } close(true); return; }
    if (event.key === "Tab") {
      // Keep keyboard focus inside the dialog until it is closed (Close / Escape / selection).
      const stops = Array.from(popover.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])') || []);
      if (stops.length) { const at = stops.indexOf(document.activeElement as HTMLElement); event.preventDefault(); stops[event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at === stops.length - 1 ? 0 : at + 1)].focus(); }
      return;
    }
    let next: string | undefined;
    if (event.key in step) next = shift(focusDate, step[event.key]);
    else if (event.key === "Home") next = shift(focusDate, -((utc(focusDate).getUTCDay() + 6) % 7));
    else if (event.key === "End") next = shift(focusDate, 6 - ((utc(focusDate).getUTCDay() + 6) % 7));
    else if (event.key === "PageUp") next = shiftMonth(focusDate, event.shiftKey ? -12 : -1);
    else if (event.key === "PageDown") next = shiftMonth(focusDate, event.shiftKey ? 12 : 1);
    if (next) { event.preventDefault(); setFocusDate(next); setHover(null); setDismissed(null); }
  };
  const choose = (date: string) => { const issue = issueFor(date); if (issue) { setFocusDate(date); setDismissed(null); return; } onChange(date); close(true); };
  const moveMonth = (delta: number) => { setFocusDate(shiftMonth(focusDate, delta)); setDismissed(null); };
  // Tooltip: the hovered unavailable date, else the keyboard-focused / tapped one. Never describes an available or selected date.
  const tipDate = hover ?? (gridFocused ? focusDate : null);
  const tipText = tipDate && tipDate !== dismissed ? tooltipFor(issueFor(tipDate)) : "";
  useEffect(() => {
    if (!tipText || !tipDate) { setTipPos(null); return; }
    const button = grid.current?.querySelector<HTMLElement>(`[data-date="${tipDate}"]`);
    if (button) setTipPos({ left: Math.min(Math.max(button.offsetLeft + button.offsetWidth / 2, 120), (grid.current?.clientWidth || 280) - 120), top: button.offsetTop, below: button.offsetTop < 40 });
  }, [tipText, tipDate, open]);

  const calendar = <>
    <div className="fika-date-backdrop" aria-hidden="true" onClick={() => close(true)} />
    <div ref={popover} className="fika-date-popover" data-up={placement.up || undefined} data-end={placement.end || undefined} role="dialog" aria-modal={sheet || undefined} aria-label="Choose delivery date" onKeyDown={onKey}>
      <div className="fika-date-nav"><button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button><strong aria-live="polite">{monthLabel}</strong><button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button></div>
      <div ref={grid} className="fika-date-grid" role="group" aria-label={monthLabel}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day} aria-hidden="true">{day}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} aria-hidden="true" />)}
        {dates.map(date => {
          const issue = issueFor(date), focused = date === focusDate;
          return <button key={date} ref={focused ? cell : undefined} type="button" tabIndex={focused ? 0 : -1} className="fika-date-day" data-state={date === value ? "selected" : issue ? "unavailable" : "available"} data-today={date === today ? "true" : undefined} data-date={date} aria-label={`${ukLongBookingDate(date)}. ${issue ? tooltipFor(issue) || "Unavailable" : "Available"}`} aria-disabled={!!issue} aria-current={date === value ? "date" : undefined} aria-pressed={date === value} onFocus={() => { setGridFocused(true); setHover(null); }} onBlur={() => setGridFocused(false)} onMouseEnter={() => setHover(date)} onMouseLeave={() => setHover(null)} onClick={() => { setHover(null); choose(date); }}>{Number(date.slice(-2))}</button>;
        })}
      </div>
      {tipText && tipPos && <div className="fika-date-tip" aria-hidden="true" data-below={tipPos.below || undefined} style={{ left: tipPos.left, top: tipPos.below ? tipPos.top + 38 : tipPos.top - 4 }}>{tipText}</div>}
      <span className="fika-sr-only" role="status" aria-live="polite">{tipText}</span>
      <div className="fika-date-footer"><button type="button" className="fika-date-close" onClick={() => close(true)}>Close</button></div>
    </div>
  </>;

  return <div ref={root} className="fika-date-field" data-booking-field={field} data-rcoa-field={field} tabIndex={-1} onBlur={event => { const next = event.relatedTarget as Node | null; if (open && next && !event.currentTarget.contains(next) && !sheetRef.current?.contains(next)) setOpen(false); }}>
    <span className="fika-form-label" id={`${id}-label`}>Delivery date</span>
    <button ref={trigger} type="button" className="fika-date-trigger" aria-haspopup="dialog" aria-expanded={open} aria-labelledby={`${id}-label ${id}-value`} aria-describedby={selectedIssue ? `${id}-conflict` : undefined} aria-invalid={selectedIssue ? true : undefined} onClick={() => open ? close(false) : openCalendar()}>
      <span id={`${id}-value`} className={valid ? "" : "fika-date-placeholder"}>{valid ? ukLongBookingDate(value) : "Choose a date"}</span>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
    </button>
    {selectedIssue && <p id={`${id}-conflict`} role="alert" className="fika-date-conflict">{friendlyDates(selectedIssue.message)}</p>}
    {open && (sheet ? createPortal(<div ref={sheetRef} className="fika-date-sheet">{calendar}</div>, document.body) : calendar)}
  </div>;
}
