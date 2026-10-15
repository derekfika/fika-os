"use client";

import { useState } from "react";
import type { GrabAndGoOrder, GrabAndGoProduct } from "../lib/grab-and-go";
import { STANDING_WEEKDAYS, openAttention, standingLabel, type StandingOrder, type StandingOrderLine, type StandingWeekday } from "../lib/grab-and-go-standing";

const post = async (body: Record<string, unknown>) => {
  const response = await fetch("/api/delivered-in/grab-and-go/standing-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) { const detail = await response.json().catch(() => undefined); throw new Error(detail?.error?.message || "That standing-order change could not be saved."); }
};
const longDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

function WeekdayPicker({ value, onChange }: { value: StandingWeekday[]; onChange: (next: StandingWeekday[]) => void }) {
  return <fieldset className="standing-weekdays"><legend>Repeat on:</legend>{STANDING_WEEKDAYS.map(day => <label key={day}><input type="checkbox" checked={value.includes(day)} onChange={event => onChange(STANDING_WEEKDAYS.filter(item => item === day ? event.target.checked : value.includes(item)))} /> {day}</label>)}</fieldset>;
}

function useRunner(oplocId: string, onChanged: () => Promise<void>) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async (body: Record<string, unknown>, done?: () => void) => { setBusy(true); setError(""); try { await post({ oplocId, ...body }); done?.(); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That standing-order change could not be saved."); } finally { setBusy(false); } };
  return { busy, error, run, message: error && <p className="grab-error" role="alert">{error}</p> };
}

/** Edit days, end date and items; pause/resume/stop; update from an order. Items flagged by an attention record are highlighted. */
function StandingOrderManager({ oplocId, standing, order, catalogue, onChanged, onClose }: { oplocId: string; standing: StandingOrder; order?: GrabAndGoOrder; catalogue: GrabAndGoProduct[]; onChanged: () => Promise<void>; onClose: () => void }) {
  const { busy, run, message } = useRunner(oplocId, onChanged);
  const names = new Map(catalogue.map(product => [product.productId, product.name]));
  const flagged = new Set(openAttention(standing).flatMap(entry => entry.productIds));
  const [weekdays, setWeekdays] = useState<StandingWeekday[]>(standing.weekdays); const [endDate, setEndDate] = useState(standing.endDate || "");
  const [lines, setLines] = useState<StandingOrderLine[]>(standing.lines);
  const base = { standingOrderId: standing.standingOrderId, expectedVersion: standing.version };
  return <div className="standing-manage">
    <form className="standing-form" onSubmit={event => { event.preventDefault(); void run({ action: "edit", ...base, weekdays, endDate, lines }); }}>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      <label className="standing-end">End date (optional — blank repeats until cancelled) <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
      <ul className="standing-lines" aria-label="Standing order items">{lines.map(line => <li key={line.productId} className={flagged.has(line.productId) ? "standing-line-flagged" : undefined}>
        <span>{names.get(line.productId) || line.productId}{flagged.has(line.productId) && <strong> — not available</strong>}</span>
        <input type="number" min={1} step={1} aria-label={`Quantity for ${names.get(line.productId) || line.productId}`} value={line.quantity} onChange={event => setLines(current => current.map(item => item.productId === line.productId ? { ...item, quantity: Math.floor(Number(event.target.value)) || 0 } : item))} />
        <button type="button" className="secondary-button" onClick={() => setLines(current => current.filter(item => item.productId !== line.productId))}>Remove</button></li>)}</ul>
      <div className="standing-actions"><button className="primary-button" type="submit" disabled={busy || !weekdays.length || !lines.length || lines.some(line => line.quantity < 1)}>{busy ? "Saving…" : "Save standing order"}</button><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Close</button></div>
    </form>
    <div className="standing-actions">
      {standing.status === "active" && <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "pause", ...base })}>Pause</button>}
      {standing.status === "paused" && <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "resume", ...base })}>Resume</button>}
      {order?.status === "submitted" && order.standingOrderId === standing.standingOrderId && <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "update-from-order", deliveryDate: order.deliveryDate, ...base })}>Update standing order from this order</button>}
      <button className="secondary-button" disabled={busy} onClick={() => { if (window.confirm("Stop this standing order permanently? Existing orders are kept.")) void run({ action: "stop", ...base }, onClose); }}>Stop standing order</button>
    </div>
    <p className="basket-note">Amending an order changes that delivery only. Saving here (or “Update standing order from this order”) changes future orders.</p>
    {(standing.attention || []).filter(entry => entry.state === "missed").slice(-3).map(entry => <p key={entry.occurrenceDate} className="basket-note">{longDate(entry.occurrenceDate)} was missed: {entry.productNames.join(", ")} unavailable.</p>)}
    {message}
  </div>;
}

/** Top-of-page alert for any standing order whose next occurrence could not be created. */
export function StandingOrderAttention({ oplocId, standingOrders, catalogue, onChanged }: { oplocId: string; standingOrders: StandingOrder[]; catalogue: GrabAndGoProduct[]; onChanged: () => Promise<void> }) {
  const [openId, setOpenId] = useState("");
  const flagged = standingOrders.filter(item => item.status !== "stopped" && openAttention(item).length);
  if (!flagged.length) return null;
  return <section className="standing-attention" role="alert" aria-label="Standing order needs attention">{flagged.map(standing => openAttention(standing).map(entry => <div key={`${standing.standingOrderId}:${entry.occurrenceDate}`} className="standing-attention-item">
    <h2>Standing order needs attention</h2>
    <p>{longDate(entry.occurrenceDate)} could not be created because {entry.productIds.length} {entry.productIds.length === 1 ? "item is" : "items are"} no longer available: {entry.productNames.join(", ")}.</p>
    <p className="basket-note">{standingLabel(standing.weekdays)}. Nothing has been ordered for that date. Update the items before the cut-off and it will be created automatically.</p>
    <button className="primary-button" type="button" onClick={() => setOpenId(current => current === standing.standingOrderId ? "" : standing.standingOrderId)}>Edit standing order</button>
    {openId === standing.standingOrderId && <StandingOrderManager oplocId={oplocId} standing={standing} catalogue={catalogue} onChanged={onChanged} onClose={() => setOpenId("")} />}
  </div>))}</section>;
}

/** Small, self-contained standing-order controls for one Grab & Go order. */
export default function StandingOrderControls({ oplocId, order, standing, catalogue, onChanged }: { oplocId: string; order: GrabAndGoOrder; standing?: StandingOrder; catalogue: GrabAndGoProduct[]; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const { busy, run, message } = useRunner(oplocId, onChanged);
  const [weekdays, setWeekdays] = useState<StandingWeekday[]>([...STANDING_WEEKDAYS]); const [endDate, setEndDate] = useState("");
  if (!standing) {
    if (order.status !== "submitted" || order.standingOrderId) return null;
    return <div className="standing-order"><button className="secondary-button" type="button" onClick={() => setOpen(value => !value)}>Make this a standing order</button>{open && <form className="standing-form" onSubmit={event => { event.preventDefault(); void run({ action: "create", deliveryDate: order.deliveryDate, weekdays, endDate }, () => setOpen(false)); }}>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      <label className="standing-end">End date (optional — blank repeats until cancelled) <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
      <div className="standing-actions"><button className="primary-button" type="submit" disabled={busy || !weekdays.length}>{busy ? "Saving…" : "Create standing order"}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setOpen(false)}>Close</button></div>
    </form>}{message}</div>;
  }
  return <div className="standing-order"><span className="grab-copy-note standing-badge">{standingLabel(standing.weekdays)}{standing.status === "paused" ? " · Paused" : ""}{standing.endDate ? ` · until ${standing.endDate}` : ""}</span>
    <button className="secondary-button" type="button" onClick={() => setOpen(value => !value)}>Manage standing order</button>
    {open && <StandingOrderManager oplocId={oplocId} standing={standing} order={order} catalogue={catalogue} onChanged={onChanged} onClose={() => setOpen(false)} />}</div>;
}
