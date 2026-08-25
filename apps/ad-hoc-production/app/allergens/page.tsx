"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CANONICAL_ALLERGEN_COLUMNS, toggleOperationalAllergen, type CanonicalAllergenKey } from "../../../shared/allergen-contract";
import type { AdHocLine, AdHocRequest } from "../../lib/ad-hoc-domain";

const displayDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

function AllergenCheckerContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("requestId");
  const [request, setRequest] = useState<AdHocRequest | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!id) return;
    void fetch(`/api/requests?id=${encodeURIComponent(id)}`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || "Could not load request");
      setRequest(body.request);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [id]);

  const update = (lineId: string, key: string, value: unknown) => setRequest((current) => current ? {
    ...current, lines: current.lines.map((line) => line.id === lineId ? { ...line, [key]: value } : line),
  } : current);

  const save = async () => {
    if (!request) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update", id: request.id, expectedVersion: request.version, lines: request.lines }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || "Could not save allergen review");
      setRequest(body);
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  const sendToCpu = async () => {
    if (!request) return;
    setSending(true); setError("");
    try {
      const response = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "handoff", id: request.id, expectedVersion: request.version }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || "Could not send request to CPU");
      setRequest(body.request); setSaved(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSending(false); }
  };

  if (!id) return <main className="checker-page"><p>Open an ad-hoc request first, then choose Open allergen checker.</p></main>;
  if (!request) return <main className="checker-page"><p>{error || "Loading request…"}</p></main>;

  return <main className="checker-page">
    <header className="checker-header">
      <div>
        <a href="/">← Back to Ad-Hoc Production</a>
        <p className="eyebrow">FIKA OS · ALLERGEN CHECKER</p>
        <h1>{request.title || "Untitled request"}</h1>
        <div className="checker-meta">
          <span><b>Client</b>{request.clientName || "No client"}</span>
          <span><b>Date</b>{request.serviceDate ? displayDate(request.serviceDate) : "TBC"}</span>
          <span><b>Service</b>{request.requiredReadyTime || "TBC"}</span>
          <span><b>Pax</b>{request.pax || 0}</span>
          <span><b>Priority</b>{request.priority || "Normal"}</span>
          <span><b>Destination</b>{request.destination.label || "TBC"}</span>
        </div>
      </div>
      <div className="checker-actions"><button className="primary" onClick={() => void save()} disabled={saving || sending}>{saving ? "Saving…" : "Save allergen review"}</button>{saved && request.status !== "SENT_TO_CPU" && <button className="send-cpu" onClick={() => void sendToCpu()} disabled={sending}>{sending ? "Sending…" : "Send to CPU"}</button>}{request.status === "SENT_TO_CPU" && <span className="sent-badge">Sent to CPU</span>}</div>
    </header>
    {error && <div className="error">{error}</div>}
    <section className="checker-card">
      <div className="checker-intro"><div><h2>Menu & allergen declaration</h2><p>Every cell must be explicitly reviewed. Unrecorded is never treated as clear.</p></div><span>{request.lines.length} production lines</span></div>
      <div className="checker-legend" aria-label="Allergen matrix legend"><span><i className="cpu-allergen-state cpu-allergen-state--contains" />Contains</span><span><i className="cpu-allergen-state cpu-allergen-state--may_contain">MC</i>May contain</span><span><i className="cpu-allergen-state cpu-allergen-state--clear" />No declaration</span><span><i className="cpu-allergen-state cpu-allergen-state--none" />Not recorded</span><em>Click a cell to cycle its review value.</em></div>
      <div className="checker-table-wrap"><table className="checker-table"><thead><tr><th>Menu item</th><th>Qty</th><th>Unit</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th key={key} title={label}>{label}</th>)}<th>May contain notes</th><th>Production notes</th></tr></thead><tbody>{request.lines.map((line: AdHocLine) => <tr key={line.id}><th>{line.title || "Unnamed item"}</th><td>{line.quantity}</td><td>{line.unit}</td>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => { const state = line.allergens[key] || "none"; return <td key={key}><button type="button" aria-label={`${line.title || "Menu item"}, ${label}: ${state}`} className={`cpu-allergen-state cpu-allergen-state--${state}`} onClick={() => update(line.id, "allergens", toggleOperationalAllergen(line.allergens, key as CanonicalAllergenKey))}>{state === "may_contain" ? "MC" : ""}</button></td>; })}<td><input value={line.mayContainNotes || ""} onChange={(event) => update(line.id, "mayContainNotes", event.target.value)} /></td><td><input value={line.productionNotes || ""} onChange={(event) => update(line.id, "productionNotes", event.target.value)} /></td></tr>)}</tbody></table></div>
    </section>
  </main>;
}

export default function AllergenChecker() {
  return <Suspense fallback={<main className="checker-page"><p>Loading allergen checker…</p></main>}><AllergenCheckerContent /></Suspense>;
}
