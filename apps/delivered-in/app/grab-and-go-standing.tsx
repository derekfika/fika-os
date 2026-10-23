"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DELIVERY_WEEKDAYS, productsForDeliveryDate, representativeDeliveryDate, type GrabAndGoProduct } from "../lib/grab-and-go";
import { STANDING_WEEKS, configuredSlotCount, slotKey, type OccurrenceState, type StandingLine, type StandingOrder, type StandingSlots, type StandingStatus, type StandingVersion } from "../lib/grab-and-go-standing";
import type { StandingMutationResult, StandingOverview, UpcomingDelivery } from "../lib/grab-and-go-standing-service";

type Props = { oplocId: string; catalogue: GrabAndGoProduct[]; cutoffHour: number; onChanged: () => void; refreshToken: number };
type Quantities = Record<string, Record<string, number>>;
type Confirm = { kind: "activate" | "pause" | "terminate" | "resume" | "cancel-upcoming"; invoker: HTMLElement | null };

const API = "/api/delivered-in/grab-and-go/standing-orders";
const STATUS_LABEL: Record<StandingStatus | "none", string> = { none: "Not set up", draft: "Draft", active: "Active", paused: "Paused", terminated: "Terminated" };
const STATUS_HELP: Record<StandingStatus | "none", string> = {
  none: "Set quantities for any Monday or Wednesday in the four-week rotation, save a draft, then activate it. Nothing is ordered until you activate.",
  draft: "This draft is not ordering anything yet. Activate it when the quantities are right.",
  active: "Orders are created automatically up to 14 days ahead and stay editable until the cut-off.",
  paused: "No new automatic orders are created. Existing orders stay in place unless you choose to cancel them.",
  terminated: "This standing order has ended. Start a new draft to set one up again; the history is kept.",
};
const OCCURRENCE_LABEL: Record<OccurrenceState, string> = {
  generate: "Will be created automatically", "in-sync": "Automatic order · up to date", sync: "Will update to the standing order", "manual-order": "Manual order · standing order not applied",
  cancelled: "Cancelled · not recreated", "unavailable-lines": "Needs attention", "slot-removed": "Will be withdrawn", "no-slot": "No standing quantity set", "not-active": "Standing order not active", "cutoff-passed": "Cut-off has passed",
};
const HANDOFF_LABEL: Record<string, string> = { delivered: "Sent to CPU", pending: "Pending · retrying automatically", "intervention-required": "Needs administrator review", "not-staged": "Not yet sent", "not-tracked": "Not tracked in this environment" };
const displayDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const displayTime = (value: string) => new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const total = (lines: Array<{ quantity: number }>) => lines.reduce((sum, line) => sum + line.quantity, 0);
const toQuantities = (slots: StandingSlots): Quantities => Object.fromEntries(Object.entries(slots).map(([key, lines]) => [key, Object.fromEntries(lines.map(line => [line.productId, line.quantity]))]));
const toSlots = (quantities: Quantities): StandingSlots => Object.fromEntries(Object.entries(quantities).map(([key, byProduct]) => [key, Object.entries(byProduct).filter(([, quantity]) => quantity > 0).map(([productId, quantity]): StandingLine => ({ productId, quantity }))]).filter(([, lines]) => (lines as StandingLine[]).length));
const sameQuantities = (a: Quantities, b: Quantities) => JSON.stringify(Object.entries(toSlots(a)).sort()) === JSON.stringify(Object.entries(toSlots(b)).sort());

async function request(method: "GET" | "POST", body?: unknown, oplocId?: string) {
  const response = await fetch(method === "GET" ? `${API}?oplocId=${encodeURIComponent(oplocId || "")}` : API, { method, cache: "no-store", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "The standing order could not be loaded."), { status: response.status });
  return payload;
}

export default function GrabAndGoStandingOrders({ oplocId, catalogue, cutoffHour, onChanged, refreshToken }: Props) {
  const [overview, setOverview] = useState<StandingOverview>(); const [quantities, setQuantities] = useState<Quantities>({}); const [saved, setSaved] = useState<Quantities>({});
  const [selected, setSelected] = useState<string>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [confirm, setConfirm] = useState<Confirm>();
  const [cancelUpcoming, setCancelUpcoming] = useState(false);
  const head = overview?.standingOrder || undefined; const status: StandingStatus | "none" = head?.status || "none"; const dirty = !sameQuantities(quantities, saved);

  const load = useCallback(async (keepEdits = false) => {
    try {
      const next = await request("GET", undefined, oplocId) as StandingOverview; setOverview(next); setError("");
      if (!keepEdits) { const loaded = toQuantities(next.standingOrder?.slots || {}); setQuantities(loaded); setSaved(loaded); }
    } catch (cause) { setError((cause as Error).message); }
  }, [oplocId]);
  useEffect(() => { void load(); }, [load, refreshToken]);

  const act = async (action: string, extra: Record<string, unknown> = {}, success = "") => {
    setBusy(true); setError(""); setNotice("");
    try {
      let version = head?.version;
      if (dirty && ["activate", "resume"].includes(action)) { // save the edits first so the activated version is exactly what is on screen
        const savedResult = await request("POST", { oplocId, action: "save", expectedVersion: version, slots: toSlots(quantities) }) as StandingMutationResult; version = savedResult.standingOrder.version;
      }
      const result = await request("POST", { oplocId, action, expectedVersion: version, ...extra, ...(action === "save" ? { slots: toSlots(quantities) } : {}) }) as StandingMutationResult;
      const reconcile = result.reconcile; const created = reconcile?.items.filter(item => item.outcome === "created").length || 0; const changed = reconcile?.items.filter(item => item.outcome === "amended" || item.outcome === "cancelled").length || 0;
      const exceptions = reconcile?.items.filter(item => ["unavailable-lines", "error", "template-changed"].includes(item.outcome)).length || 0;
      setNotice([success || "Saved.", created ? `${created} order${created === 1 ? "" : "s"} created.` : "", changed ? `${changed} automatic order${changed === 1 ? "" : "s"} updated.` : "", exceptions ? `${exceptions} delivery needs attention — see the list below.` : "", result.reconcileError ? "Orders will be reconciled on the next scheduled check." : ""].filter(Boolean).join(" "));
      await load(); onChanged();
    } catch (cause) { setError((cause as Error).message); if ((cause as { status?: number }).status === 409) await load(); } finally { setBusy(false); setConfirm(undefined); }
  };

  const slotProducts = useMemo(() => selected ? productsForDeliveryDate(catalogue, (() => { const [week, weekday] = selected.split(":"); return representativeDeliveryDate(Number(week), weekday as typeof DELIVERY_WEEKDAYS[number]); })()) : [], [catalogue, selected]);
  if (!overview) return <div className="empty-state" role={error ? "alert" : "status"}><p>{error || "Loading standing orders…"}</p></div>;
  const editable = status !== "terminated"; const configured = configuredSlotCount(toSlots(quantities));
  const setQuantity = (productId: string, quantity: number) => selected && setQuantities(current => ({ ...current, [selected]: { ...current[selected], [productId]: quantity } }));
  const open = (kind: Confirm["kind"]) => (event: React.MouseEvent<HTMLButtonElement>) => { setCancelUpcoming(false); setConfirm({ kind, invoker: event.currentTarget }); };

  return <div className="standing-panel">
    <section className="standing-status" aria-labelledby="standing-heading">
      <div><h2 id="standing-heading">Standing order</h2><p>{STATUS_HELP[status]}</p>{head && <p className="standing-meta">Version {head.version} · updated {displayTime(head.updatedAt)} by {head.updatedBy}</p>}</div>
      <span className={`standing-chip standing-chip-${status}`}><span aria-hidden="true">{status === "active" ? "●" : status === "paused" ? "Ⅱ" : status === "terminated" ? "■" : "○"}</span> {STATUS_LABEL[status]}</span>
    </section>
    {error && <p className="grab-error" role="alert">{error}</p>}{notice && <p className="grab-handoff-notice" role="status">{notice}</p>}
    <section className="standing-section" aria-labelledby="rotation-heading">
      <header><h3 id="rotation-heading">Quantities by rotation week</h3><p>Each Monday and Wednesday is set independently. A day with no quantity is never ordered.</p></header>
      <div className="standing-table-wrap" role="region" aria-label="Rotation quantities" tabIndex={0}>
        <table className="standing-table"><caption className="visually-hidden">Standing quantities for each Monday and Wednesday of the four-week rotation</caption>
          <thead><tr><th scope="col">Rotation week</th>{DELIVERY_WEEKDAYS.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
          <tbody>{STANDING_WEEKS.map(week => <tr key={week}><th scope="row">Week {week}</th>{DELIVERY_WEEKDAYS.map(day => { const key = slotKey(week, day); const count = total(Object.entries(quantities[key] || {}).map(([, quantity]) => ({ quantity }))); return <td key={day}>
            <button type="button" className={`standing-slot${selected === key ? " selected" : ""}`} aria-pressed={selected === key} disabled={!editable || busy} onClick={() => setSelected(selected === key ? undefined : key)} aria-label={`${count ? "Edit" : "Set"} Week ${week} ${day} standing quantities, ${count ? `${count} items` : "not set"}`}>
              <strong>{count ? `${count} items` : "Not set"}</strong><small>{count ? `${Object.values(quantities[key] || {}).filter(quantity => quantity > 0).length} products` : "No order"}</small></button></td>; })}</tr>)}</tbody></table>
      </div>
      {selected && <div className="standing-editor" role="group" aria-labelledby="editor-heading">
        <header><h4 id="editor-heading">Week {selected.split(":")[0]} · {selected.split(":")[1]}</h4><div><button type="button" className="secondary-button" disabled={busy} onClick={() => setQuantities(current => ({ ...current, [selected]: {} }))}>Clear this day</button><button type="button" className="secondary-button" onClick={() => setSelected(undefined)}>Done</button></div></header>
        {slotProducts.length === 0 ? <p className="grab-copy-note">The catalogue offers no products for this rotation day.</p> : <div className="grab-product-list">{slotProducts.map(product => { const quantity = quantities[selected]?.[product.productId] || 0; return <div className="grab-product-row" key={product.productId}><span className="product-mark" aria-hidden="true">✦</span><strong>{product.name}<small>{product.category === "grab_250ml" ? "250ml pot" : "750ml pot"}</small></strong><div className="grab-quantity"><button type="button" aria-label={`Decrease ${product.name}`} disabled={busy || !quantity} onClick={() => setQuantity(product.productId, Math.max(0, quantity - 1))}>−</button><output aria-label={`${quantity} ${product.name}`}>{quantity}</output><button type="button" aria-label={`Increase ${product.name}`} disabled={busy} onClick={() => setQuantity(product.productId, quantity + 1)}>+</button></div></div>; })}</div>}
      </div>}
      <footer className="standing-actions">
        {dirty && <span className="standing-unsaved" role="status">Unsaved changes</span>}
        {(status === "none" || status === "draft") && <><button type="button" className="secondary-button" disabled={busy || !dirty} onClick={() => void act("save", {}, "Draft saved.")}>Save draft</button><button type="button" className="primary-button" disabled={busy || configured === 0} onClick={open("activate")}>Activate…</button></>}
        {(status === "active" || status === "paused") && <button type="button" className="primary-button" disabled={busy || !dirty || configured === 0} onClick={() => void act("save", {}, "Amendment saved. Future automatic orders before cut-off were updated.")}>Save amendment</button>}
        {status === "active" && <button type="button" className="secondary-button" disabled={busy} onClick={open("pause")}>Pause…</button>}
        {status === "paused" && <><button type="button" className="secondary-button" disabled={busy} onClick={open("resume")}>Resume…</button><button type="button" className="secondary-button" disabled={busy} onClick={open("cancel-upcoming")}>Cancel upcoming automatic orders…</button></>}
        {(status === "draft" || status === "active" || status === "paused") && <button type="button" className="danger-button" disabled={busy} onClick={open("terminate")}>Terminate…</button>}
        {status === "terminated" && <button type="button" className="primary-button" disabled={busy || configured === 0} onClick={() => void act("save", {}, "A new draft was started from the previous quantities.")}>Start a new draft</button>}
      </footer>
    </section>
    <UpcomingTable upcoming={overview.upcoming} cutoffHour={cutoffHour} />
    <VersionHistory versions={overview.versions} />
    {confirm && <ConfirmDialog {...dialogFor(confirm.kind, { upcoming: overview.upcoming, configured, cancelUpcoming, setCancelUpcoming })} busy={busy} invoker={confirm.invoker} onCancel={() => setConfirm(undefined)}
      onConfirm={() => void (confirm.kind === "activate" ? act("activate", {}, "Standing order activated.") : confirm.kind === "resume" ? act("resume", {}, "Standing order resumed.") : confirm.kind === "pause" ? act("pause", { upcomingOrders: cancelUpcoming ? "cancel" : "keep" }, "Standing order paused.") : confirm.kind === "terminate" ? act("terminate", { upcomingOrders: cancelUpcoming ? "cancel" : "keep" }, "Standing order terminated.") : act("cancel-upcoming", {}, "Upcoming automatic orders were cancelled."))} />}
  </div>;
}

function dialogFor(kind: Confirm["kind"], context: { upcoming: UpcomingDelivery[]; configured: number; cancelUpcoming: boolean; setCancelUpcoming: (value: boolean) => void }) {
  const automatic = context.upcoming.filter(item => item.order?.control === "automatic" && item.order.status === "submitted" && item.order.editable); const openDates = context.upcoming.filter(item => !item.cutoffPassed && item.templateLines.length);
  const choice: ReactNode = <fieldset className="standing-choice"><legend>Upcoming automatic orders ({automatic.length})</legend>
    <label><input type="radio" name="upcoming" checked={!context.cancelUpcoming} onChange={() => context.setCancelUpcoming(false)} /> Keep them. They are still delivered unless you cancel them.</label>
    <label><input type="radio" name="upcoming" checked={context.cancelUpcoming} onChange={() => context.setCancelUpcoming(true)} /> Cancel them. CPU is told they are cancelled; they are not recreated.</label></fieldset>;
  if (kind === "activate") return { title: "Activate this standing order?", confirmLabel: "Activate standing order", body: <><p>Orders are created automatically for open Monday and Wednesday deliveries that have a quantity set, up to 14 days ahead, and each one is passed to CPU like any other order.</p><p>{openDates.length ? `Right now this creates or checks ${openDates.length} delivery${openDates.length === 1 ? "" : "ies"}: ${openDates.map(item => displayDate(item.deliveryDate)).join(", ")}.` : "No delivery is open for ordering at the moment."} Dates where you already placed an order are left untouched.</p></> };
  if (kind === "resume") return { title: "Resume this standing order?", confirmLabel: "Resume", body: <p>Automatic orders restart for open deliveries. Orders you cancelled are not recreated.</p> };
  if (kind === "pause") return { title: "Pause this standing order?", confirmLabel: "Pause standing order", body: <><p>No new automatic orders are created while it is paused. You can resume it later.</p>{choice}</> };
  if (kind === "cancel-upcoming") return { title: "Cancel upcoming automatic orders?", confirmLabel: "Cancel automatic orders", destructive: true, body: <><p>{automatic.length ? `${automatic.length} automatic order${automatic.length === 1 ? "" : "s"} before cut-off will be cancelled and CPU will be told: ${automatic.map(item => displayDate(item.deliveryDate)).join(", ")}.` : "There are no editable automatic orders to cancel."} Manual orders are not affected.</p></> };
  return { title: "Terminate this standing order?", confirmLabel: "Terminate standing order", destructive: true, body: <><p>Termination ends automatic ordering. Version history is kept, and you can start a new draft later.</p>{choice}</> };
}

function ConfirmDialog({ title, body, confirmLabel, destructive, busy, invoker, onConfirm, onCancel }: { title: string; body: ReactNode; confirmLabel: string; destructive?: boolean; busy: boolean; invoker: HTMLElement | null; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { if (dialog?.open) dialog.close(); invoker?.focus(); }; }, [invoker]);
  return <dialog ref={ref} className="standing-dialog" aria-labelledby="standing-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id="standing-dialog-title">{title}</h3>{body}
    <div className="standing-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel} autoFocus>Go back</button><button type="button" className={destructive ? "danger-button" : "primary-button"} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button></div>
  </dialog>;
}

function sourceLabel(item: UpcomingDelivery) {
  const order = item.order; if (!order) return "—";
  if (order.control === "automatic" && order.source) return `Standing order v${order.source.templateVersion}`;
  if (order.source) return `Manual (changed from standing order v${order.source.templateVersion})`;
  return "Manual order";
}
function UpcomingTable({ upcoming, cutoffHour }: { upcoming: UpcomingDelivery[]; cutoffHour: number }) {
  return <section className="standing-section" aria-labelledby="upcoming-heading">
    <header><h3 id="upcoming-heading">Upcoming deliveries</h3><p>The next 14 days. Orders close at {cutoffHour}:00 the day before delivery.</p></header>
    {upcoming.length === 0 ? <div className="empty-state"><p>No Monday or Wednesday deliveries in the next 14 days.</p></div> :
      <div className="standing-table-wrap" role="region" aria-label="Upcoming deliveries" tabIndex={0}><table className="standing-table standing-upcoming"><caption className="visually-hidden">Upcoming Grab and Go deliveries and their standing-order status</caption>
        <thead><tr><th scope="col">Delivery</th><th scope="col">Source</th><th scope="col">Order</th><th scope="col">Items</th><th scope="col">CPU update</th><th scope="col">Standing order</th></tr></thead>
        <tbody>{upcoming.map(item => <tr key={item.deliveryDate} className={item.exception ? "has-exception" : undefined}>
          <th scope="row">{displayDate(item.deliveryDate)}<small>Week {item.rotationWeek} · cut-off {displayTime(item.cutoff)}</small></th>
          <td>{sourceLabel(item)}</td>
          <td>{item.order ? <>{item.order.status === "cancelled" ? "Cancelled" : item.cutoffPassed ? "Submitted · locked" : "Submitted"} <small>v{item.order.version}</small></> : "No order"}</td>
          <td>{item.order && item.order.status === "submitted" ? total(item.order.lines) : item.templateLines.length && !item.order ? `${total(item.templateLines)} planned` : "—"}</td>
          <td>{item.order ? HANDOFF_LABEL[item.order.handoff] : "—"}</td>
          <td><span className={`standing-state standing-state-${item.state}`}>{OCCURRENCE_LABEL[item.state]}</span>{item.exception && <small className="standing-exception" role="note">⚠ {item.exception}</small>}</td></tr>)}</tbody></table></div>}
  </section>;
}
function VersionHistory({ versions }: { versions: StandingVersion[] }) {
  if (!versions.length) return null;
  return <details className="standing-section standing-history"><summary>Version history ({versions.length})</summary><ol>{versions.map(version => <li key={version.version}><strong>v{version.version} · {version.action.replace("-", " ")}</strong> <span>{displayTime(version.at)} · {version.actor}</span>{version.changedSlots.length > 0 && <small>Changed: {version.changedSlots.map(key => `Week ${key.replace(":", " ")}`).join(", ")}</small>}{version.note && <small>Note: {version.note}</small>}</li>)}</ol></details>;
}
export type { StandingOrder };
