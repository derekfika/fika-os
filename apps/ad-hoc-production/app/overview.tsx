"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AD_HOC_CATEGORIES, STATUS_LABELS, isArchived, isSent, type AdHocRequest, type AdHocStatus } from "../lib/ad-hoc-domain";
import { Dialog } from "./dialog";
import { useDateWindow } from "./frame";
import { Icon } from "./icons";

type Mode = "overview" | "requests" | "sent";
type Pending = { kind: "archive" | "cancel"; request: AdHocRequest } | null;
const STATUS_CLASS: Record<AdHocStatus, string> = { DRAFT: "draft", SENT_TO_CPU: "sent", NEEDS_UPDATE: "update", CANCELLED: "cancelled" };
const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const categoryLabel = (value: string) => AD_HOC_CATEGORIES.find(item => item.value === value)?.label || value;

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "That action could not be completed.");
  return body as { request?: AdHocRequest };
}

export function Overview({ mode }: { mode: Mode }) {
  const router = useRouter();
  const { from, days } = useDateWindow();
  const [requests, setRequests] = useState<AdHocRequest[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | AdHocStatus>(mode === "sent" ? "SENT_TO_CPU" : "all");
  const [destination, setDestination] = useState("all");
  const [tab, setTab] = useState<"open" | "archived">("open");
  const [menuId, setMenuId] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError(""); setRequests(null);
    try {
      const response = await fetch(`/api/requests?from=${from}&days=${days}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || "Requests could not be loaded.");
      setRequests(body.requests || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Requests could not be loaded."); }
  }, [from, days]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!menuId) return; const close = () => setMenuId(""); document.addEventListener("click", close); return () => document.removeEventListener("click", close); }, [menuId]);

  const open = useMemo(() => (requests || []).filter(item => !isArchived(item)), [requests]);
  const counts = useMemo(() => ({ DRAFT: open.filter(item => item.status === "DRAFT").length, SENT_TO_CPU: open.filter(item => item.status === "SENT_TO_CPU").length, NEEDS_UPDATE: open.filter(item => item.status === "NEEDS_UPDATE").length }), [open]);
  const destinations = useMemo(() => [...new Set((requests || []).map(item => item.destination.label).filter(Boolean))].sort(), [requests]);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (requests || []).filter(item => (tab === "archived") === isArchived(item)
      && (status === "all" || item.status === status)
      && (destination === "all" || item.destination.label === destination)
      && (!term || [item.eventName, item.reference, item.destination.label, item.destination.address].some(value => value.toLowerCase().includes(term))));
  }, [requests, tab, status, destination, search]);

  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That action could not be completed."); } finally { setBusy(false); } };
  const duplicate = (request: AdHocRequest) => run(async () => { const result = await post({ action: "duplicate", id: request.id }); if (result.request) router.push(`/orders/${encodeURIComponent(result.request.id)}`); });
  const confirmPending = () => pending && run(async () => {
    if (pending.kind === "archive") await post({ action: "archive", id: pending.request.id, expectedVersion: pending.request.version });
    else await post({ action: "cancel", id: pending.request.id, expectedVersion: pending.request.version, reason });
    setNotice(pending.kind === "archive" ? `${pending.request.reference} archived.` : `${pending.request.reference} cancelled and withdrawn from CPU and Logistics.`);
    setPending(null); setReason(""); await load();
  });

  return <div className="page">
    <div className="page-head">
      <div><h1>{mode === "sent" ? "Sent to CPU" : mode === "requests" ? "Requests" : "Ad-Hoc Production"}</h1><p className="lede">Create one-off food orders for CPU Hospitality and Logistics.</p></div>
      <Link href="/orders/new" className="btn primary large"><Icon name="plus" />New order</Link>
    </div>

    {mode === "overview" && <div className="stats">
      <section className="stat"><span className="stat-icon draft"><Icon name="doc" size={26} /></span><div><h2>Draft orders</h2><strong>{counts.DRAFT}</strong></div></section>
      <section className="stat"><span className="stat-icon sent"><Icon name="truck" size={26} /></span><div><h2>Sent to CPU</h2><strong>{counts.SENT_TO_CPU}</strong></div></section>
      <section className="stat"><span className="stat-icon update"><Icon name="alert" size={26} /></span><div><h2>Needs update</h2><strong>{counts.NEEDS_UPDATE}</strong></div></section>
      <aside className="note-card"><h2><Icon name="info" />Every order created here goes to CPU Hospitality and Logistics.</h2><p>Enter the event details, menu items and delivery information. Once sent, the order is received by CPU Hospitality for production and Logistics for delivery. Counts cover the selected date window.</p></aside>
    </div>}

    <div className="toolbar">
      <label className="search"><Icon name="search" /><span className="visually-hidden">Search orders</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search orders, event name or reference…" /></label>
      <label className="select-field"><span>Status</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option>{(Object.keys(STATUS_LABELS) as AdHocStatus[]).map(key => <option key={key} value={key}>{STATUS_LABELS[key]}</option>)}</select></label>
      <label className="select-field"><span>Destination</span><select value={destination} onChange={event => setDestination(event.target.value)}><option value="all">All destinations</option>{destinations.map(label => <option key={label} value={label}>{label}</option>)}</select></label>
      <div className="segmented" role="group" aria-label="Open or archived"><button type="button" aria-pressed={tab === "open"} className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>Open</button><button type="button" aria-pressed={tab === "archived"} className={tab === "archived" ? "on" : ""} onClick={() => setTab("archived")}>Archived</button></div>
    </div>

    <div aria-live="polite">{notice && <p className="banner ok" role="status">{notice}</p>}{error && <p className="banner error" role="alert">{error} <button type="button" className="link" onClick={() => void load()}>Try again</button></p>}</div>

    <div className="table" role="table" aria-label="Ad-hoc orders">
      <div className="thead" role="row"><span role="columnheader">Event name</span><span role="columnheader">Date</span><span role="columnheader">Ready time</span><span role="columnheader">Destination</span><span role="columnheader">Address type</span><span role="columnheader">Items</span><span role="columnheader">Status</span><span role="columnheader"><span className="visually-hidden">Actions</span></span></div>
      {requests === null && !error && <p className="empty" role="status">Loading orders…</p>}
      {requests !== null && rows.length === 0 && <div className="empty" role="status"><strong>{requests.length === 0 ? "No orders in this date range." : "No orders match these filters."}</strong><span>{requests.length === 0 ? "Create a new order or move the date window." : "Clear the search or filters to see more."}</span></div>}
      {rows.map(item => {
        const archived = isArchived(item);
        return <div className="trow" role="row" key={item.id}>
          <span role="cell" className="name"><Link href={`/orders/${encodeURIComponent(item.id)}`}><strong>{item.eventName || "Untitled order"}</strong></Link><small>{item.reference}</small></span>
          <span role="cell" className="cell-icon"><Icon name="calendar" size={18} />{longDate(item.serviceDate)}</span>
          <span role="cell" className="cell-icon"><Icon name="clock" size={18} />{item.requiredReadyTime}</span>
          <span role="cell" className="cell-icon dest"><Icon name="building" size={20} /><span><strong>{item.destination.label || "To be confirmed"}</strong><small>{categoryLabel(item.category)}</small></span></span>
          <span role="cell"><span className={`chip ${item.destination.mode === "oploc" ? "oploc" : "oneoff"}`}>{item.destination.mode === "oploc" ? "Existing OPLOC" : "One-off address"}</span></span>
          <span role="cell" className="cell-icon"><Icon name="fork" size={18} /><span><strong>{item.lines.length}</strong><small>{item.lines.length === 1 ? "item" : "items"}</small></span></span>
          <span role="cell"><span className={`chip ${STATUS_CLASS[item.status]}`}>{archived && item.status === "DRAFT" ? "Archived draft" : STATUS_LABELS[item.status]}</span></span>
          <span role="cell" className="menu-cell">
            <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={menuId === item.id} aria-label={`Actions for ${item.eventName || item.reference}`} onClick={event => { event.stopPropagation(); setMenuId(menuId === item.id ? "" : item.id); }}><Icon name="more" /></button>
            {menuId === item.id && <div className="menu" role="menu">
              <Link role="menuitem" href={`/orders/${encodeURIComponent(item.id)}`}>{archived ? "View" : "Open and edit"}</Link>
              <button type="button" role="menuitem" disabled={busy} onClick={() => void duplicate(item)}>Duplicate as new draft</button>
              {!archived && item.status === "DRAFT" && <button type="button" role="menuitem" className="danger" onClick={() => setPending({ kind: "archive", request: item })}>Archive draft</button>}
              {!archived && isSent(item) && <button type="button" role="menuitem" className="danger" onClick={() => setPending({ kind: "cancel", request: item })}>Cancel order</button>}
            </div>}
          </span>
        </div>;
      })}
    </div>

    <Dialog open={pending !== null} busy={busy} onClose={() => { setPending(null); setReason(""); }} title={pending?.kind === "cancel" ? `Cancel ${pending.request.reference}?` : `Archive ${pending?.request.reference ?? "draft"}?`}
      footer={<><button type="button" className="btn" disabled={busy} onClick={() => { setPending(null); setReason(""); }}>Keep order</button><button type="button" className="btn danger-solid" disabled={busy || (pending?.kind === "cancel" && !reason.trim())} onClick={() => void confirmPending()}>{busy ? "Working…" : pending?.kind === "cancel" ? "Cancel order" : "Archive draft"}</button></>}>
      {pending?.kind === "cancel"
        ? <><p>This withdraws “{pending.request.eventName}” from CPU Hospitality and cancels its delivery requirement in Logistics. The request is kept as history.</p><label className="field"><span>Reason for cancelling <b aria-hidden="true">*</b></span><textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={300} /></label></>
        : <p>“{pending?.request.eventName}” was never sent, so nothing changes in CPU or Logistics. It moves to Archived and can be duplicated later.</p>}
    </Dialog>
  </div>;
}
