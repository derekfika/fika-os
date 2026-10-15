"use client";

import { useState } from "react";
import type { GrabAndGoOrder } from "../lib/grab-and-go";
import { STANDING_WEEKDAYS, standingLabel, type StandingOrder, type StandingWeekday } from "../lib/grab-and-go-standing";

const post = async (body: Record<string, unknown>) => {
  const response = await fetch("/api/delivered-in/grab-and-go/standing-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) { const detail = await response.json().catch(() => undefined); throw new Error(detail?.error?.message || "That standing-order change could not be saved."); }
};

function WeekdayPicker({ value, onChange }: { value: StandingWeekday[]; onChange: (next: StandingWeekday[]) => void }) {
  return <fieldset className="standing-weekdays"><legend>Repeat on:</legend>{STANDING_WEEKDAYS.map(day => <label key={day}><input type="checkbox" checked={value.includes(day)} onChange={event => onChange(STANDING_WEEKDAYS.filter(item => item === day ? event.target.checked : value.includes(item)))} /> {day}</label>)}</fieldset>;
}

/** Small, self-contained standing-order controls for one Grab & Go order. */
export default function StandingOrderControls({ oplocId, order, standing, onChanged }: { oplocId: string; order: GrabAndGoOrder; standing?: StandingOrder; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [weekdays, setWeekdays] = useState<StandingWeekday[]>(standing?.weekdays || [...STANDING_WEEKDAYS]); const [endDate, setEndDate] = useState(standing?.endDate || "");
  const run = async (body: Record<string, unknown>, done?: () => void) => { setBusy(true); setError(""); try { await post({ oplocId, ...body }); done?.(); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That standing-order change could not be saved."); } finally { setBusy(false); } };
  const form = (submitLabel: string, onSubmit: () => void) => <form className="standing-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <WeekdayPicker value={weekdays} onChange={setWeekdays} />
    <label className="standing-end">End date (optional — blank repeats until cancelled) <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
    <div className="standing-actions"><button className="primary-button" type="submit" disabled={busy || !weekdays.length}>{busy ? "Saving…" : submitLabel}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setOpen(false)}>Close</button></div>
  </form>;
  const message = error && <p className="grab-error" role="alert">{error}</p>;

  if (!standing) {
    if (order.status !== "submitted" || order.standingOrderId) return null;
    return <div className="standing-order"><button className="secondary-button" type="button" onClick={() => setOpen(value => !value)}>Make this a standing order</button>{open && form("Create standing order", () => void run({ action: "create", deliveryDate: order.deliveryDate, weekdays, endDate }, () => setOpen(false)))}{message}</div>;
  }
  const base = { standingOrderId: standing.standingOrderId, expectedVersion: standing.version };
  return <div className="standing-order"><span className="grab-copy-note standing-badge">{standingLabel(standing.weekdays)}{standing.status === "paused" ? " · Paused" : ""}{standing.endDate ? ` · until ${standing.endDate}` : ""}</span>
    <button className="secondary-button" type="button" onClick={() => setOpen(value => !value)}>Manage standing order</button>
    {open && <div className="standing-manage">
      {form("Save changes", () => void run({ action: "edit", ...base, weekdays, endDate }))}
      <div className="standing-actions">
        {standing.status === "active" && <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "pause", ...base })}>Pause</button>}
        {standing.status === "paused" && <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "resume", ...base })}>Resume</button>}
        {order.status === "submitted" && <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "update-from-order", deliveryDate: order.deliveryDate, ...base })}>Update standing order from this order</button>}
        <button className="secondary-button" disabled={busy} onClick={() => { if (window.confirm("Stop this standing order permanently? Existing orders are kept.")) void run({ action: "stop", ...base }, () => setOpen(false)); }}>Stop standing order</button>
      </div>
      <p className="basket-note">Amending an order changes that delivery only. Use “Update standing order from this order” to change future orders.</p>
    </div>}{message}</div>;
}
