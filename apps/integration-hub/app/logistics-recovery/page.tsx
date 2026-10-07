"use client";

import { useRef, useState } from "react";
import "../../../../shared/fika/tokens.css";
import styles from "./recovery.module.css";

type Event = { eventId: string; sourceAggregateId: string; sourceVersion: number; serviceDate: string; delivery: { status: string; attempts: number; deadLetteredAt?: string; lastError?: string } };
export default function LogisticsRecoveryPage() {
  const [eventId, setEventId] = useState("");
  const [event, setEvent] = useState<Event>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const commandId = useRef<string | undefined>(undefined);
  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || "Logistics recovery is unavailable.");
    return body;
  }
  async function review() {
    if (busy) return;
    setBusy(true); setError(""); setEvent(undefined); setMessage(""); commandId.current = undefined;
    try { const body = await request(`/api/logistics-outbox/replay?eventId=${encodeURIComponent(eventId.trim())}`); setEvent(body.event); setReason(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review this update."); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (busy || !event || event.delivery.status !== "dead-letter" || reason.trim().length < 5) return;
    setBusy(true); setError(""); setMessage("");
    commandId.current ||= crypto.randomUUID();
    try {
      const body = await request("/api/logistics-outbox/replay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: event.eventId, commandId: commandId.current, reason, expectedAttempts: event.delivery.attempts, expectedDeadLetteredAt: event.delivery.deadLetteredAt }) });
      setEvent(body.event);
      setMessage(body.event.delivery.status === "delivered" ? "Logistics update delivered." : "Retry recorded. Delivery is still pending; review its status before continuing.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not retry this update."); }
    finally { setBusy(false); }
  }
  return <main className={styles.workspace}>
    <a href="/">← Integration Hub</a><header><p>FIKA OS · Logistics recovery</p><h1>Review a blocked update</h1><p>Enter the exact event reference and review its recorded failure before retrying. Integration Administrator authority is required.</p></header>
    <form onSubmit={e => { e.preventDefault(); void review(); }} className={styles.card}>
      <label>Event reference<input value={eventId} onChange={e => setEventId(e.target.value)} maxLength={2000} required disabled={busy} /></label>
      <button type="submit" disabled={busy || !eventId.trim()}>{busy ? "Working…" : "Review update"}</button>
    </form>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {event && <section className={styles.card} aria-label="Logistics update review">
      <h2>{event.delivery.status === "dead-letter" ? "Needs intervention" : event.delivery.status === "delivered" ? "Delivered" : "Delivery pending"}</h2>
      <dl><dt>Event</dt><dd>{event.eventId}</dd><dt>Source</dt><dd>{event.sourceAggregateId} · version {event.sourceVersion}</dd><dt>Service date</dt><dd>{event.serviceDate}</dd><dt>Attempts</dt><dd>{event.delivery.attempts}</dd></dl>
      {event.delivery.lastError && <p className={styles.error}>Recorded failure: {event.delivery.lastError}</p>}
      {event.delivery.status === "dead-letter" && <><label>Recovery reason<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={500} disabled={busy} /></label><p>Retry this one Logistics update after resolving its failure. The original source and delivery history remain recorded.</p><button type="button" onClick={() => void retry()} disabled={busy || reason.trim().length < 5}>{busy ? "Retrying…" : "Retry this event"}</button></>}
    </section>}
  </main>;
}
