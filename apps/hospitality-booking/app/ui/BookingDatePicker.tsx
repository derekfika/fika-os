"use client";
import { useEffect, useId, useState } from "react";
import { addBusinessDate, bookingDateIssue, ukBookingClock, type CutoffContext, type CutoffItem } from "@fika/server-shared/hospitality-effective-offering";
const styles = { calendar: "fika-booking-calendar", navigation: "fika-booking-calendar-navigation", days: "fika-booking-calendar-days" };

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
export function BookingDatePicker({ value, onChange, items, context = {}, now, field = "eventDate", unavailableReason }: { value: string; onChange: (date: string) => void; items: readonly CutoffItem[]; context?: CutoffContext; now: string; field?: string; unavailableReason?: string }) {
  const id = useId();
  const today = ukBookingClock(now).date;
  const [month, setMonth] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(value) && !bookingDateIssue([], value, now)?.code?.includes("INVALID") ? value.slice(0, 7) : today.slice(0, 7));
  const [explanation, setExplanation] = useState("");
  const policyKey = JSON.stringify(items) + JSON.stringify(context);
  useEffect(() => { setExplanation(""); }, [policyKey, now]);
  const selectedIssue = unavailableReason ? { message: unavailableReason } : value ? bookingDateIssue(items, value, now, context) : undefined;
  const first = `${month}-01`, offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const dates: string[] = [];
  for (let date = first; date.startsWith(month); date = addBusinessDate(date)) dates.push(date);
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));
  const move = (delta: number) => { const date = new Date(`${first}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); setMonth(date.toISOString().slice(0, 7)); setExplanation(""); };
  return <fieldset className={styles.calendar} data-booking-field={field} data-rcoa-field={field} tabIndex={-1} aria-describedby={`${id}-reason`}>
    <legend>Delivery date</legend>
    <div className={styles.navigation}><button type="button" aria-label="Previous month" onClick={() => move(-1)}>‹</button><strong aria-live="polite">{label}</strong><button type="button" aria-label="Next month" onClick={() => move(1)}>›</button></div>
    <div className={styles.days}>
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day} aria-hidden="true">{day}</span>)}
      {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
      {dates.map(date => {
        const issue = unavailableReason ? { message: unavailableReason } : bookingDateIssue(items, date, now, context), reason = issue?.message || `Available delivery date: ${date}`;
        return <button key={date} type="button" aria-label={`${date}. ${reason}`} title={reason} aria-describedby={`${id}-reason`} aria-disabled={!!issue} aria-pressed={date === value} onFocus={() => setExplanation(reason)} onMouseEnter={() => setExplanation(reason)} onClick={() => { setExplanation(reason); if (!issue) onChange(date); }}>{Number(date.slice(-2))}</button>;
      })}
    </div>
    <p>Selected: {value || "Choose a date"}</p>
    {selectedIssue && <p role="alert">Selected date conflict: {selectedIssue.message}</p>}
    <p id={`${id}-reason`} role="status">{explanation || "Focus or tap a date for availability and notice requirements."}</p>
  </fieldset>;
}
