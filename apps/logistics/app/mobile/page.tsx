"use client";

import { useEffect, useMemo, useState } from "react";
import type { FulfilmentRequirement } from "../../../shared/fulfilment-requirement";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "../../lib/types";
import { operationalDate } from "../../lib/date";
import { movementsForStop, selectMobileRuns } from "../../lib/planning";
import { announceDriverChange, driverIssueTypes, showDispatchChecklist, stopCounts, stopIsCollection } from "../../lib/mobile-driver";

type Data = { requirements: FulfilmentRequirement[]; runs: DeliveryRun[]; stops: DeliveryStop[]; movements: MovementRequest[]; oplocs: { id: string; label: string; address?: string }[]; serviceDate: string };
type View = "deliveries" | "collections" | "messages" | "more";
type DriverMessage = { id: string; title: string; body: string; meta: string };
type UndoAction = { run: DeliveryRun; stop: DeliveryStop; label: string };

export default function Mobile() {
  const [driver, setDriver] = useState("Franco");
  const [data, setData] = useState<Data>();
  const [view, setView] = useState<View>("deliveries");
  const [selectedStop, setSelectedStop] = useState<DeliveryStop>();
  const [issueStop, setIssueStop] = useState<DeliveryStop>();
  const [issueText, setIssueText] = useState("");
  const [issueType, setIssueType] = useState("Cannot access building");
  const [error, setError] = useState("");
  const [undoAction, setUndoAction] = useState<UndoAction>();
  const [retryDispatchRun, setRetryDispatchRun] = useState<DeliveryRun>();
  const [selectedDate, setSelectedDate] = useState(operationalDate());
  const [messages, setMessages] = useState<DriverMessage[]>([
    { id: "planner-update", title: "Planner update", body: "Your route is ready for today. Drive safe, Franco.", meta: "08:32 · Dispatch" },
    { id: "site-notice", title: "Site notice", body: "Bridgepoint reception is using the side entrance today.", meta: "Yesterday · Operations" },
  ]);
  const date = selectedDate;
  const availableDates = useMemo(() => dateOptions(), []);

  const load = async () => { try { const response = await fetch(`/api/logistics?serviceDate=${date}`, { cache: "no-store" }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || "Logistics is temporarily unavailable."); setData(body); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Logistics is temporarily unavailable."); } };
  useEffect(() => { void load(); }, [selectedDate]);

  const runs = useMemo(() => selectMobileRuns(data?.runs || [], driver, date), [data?.runs, driver, date]);
  const stops = useMemo(() => runs
    .flatMap((run) => run.orderedStopIds.map((id) => data?.stops.find((stop) => stop.canonicalId === id)).filter(Boolean) as DeliveryStop[])
    .sort((a, b) => mobileStopMinutes(a) - mobileStopMinutes(b) || a.sequence - b.sequence), [runs, data?.stops]);
  const deliveries = stops.filter((stop) => !stopIsCollection(stop));
  const collections = stops.filter((stop) => stopIsCollection(stop));
  const deliveryCounts = stopCounts(deliveries);
  const collectionCounts = stopCounts(collections);
  const completed = stopCounts(stops).completed;
  const attention = stops.filter((stop) => stop.status === "issue" || (stop.issues || []).some((issue) => issue.status === "open")).length;
  const visibleStops = view === "collections" ? collections : deliveries;
  const visibleRemaining = visibleStops.filter((stop) => stop.status !== "completed");
  const visibleCompleted = visibleStops.filter((stop) => stop.status === "completed");
  const nextStop = visibleRemaining[0];

  async function execute(action: string, stop: DeliveryStop, extra: Record<string, unknown> = {}) {
    const run = runs.find((item) => item.canonicalId === stop.runId); if (!run) return;
    const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, by: driver, runId: run.canonicalId, expectedRunVersion: run.version, stopId: stop.canonicalId, expectedStopVersion: stop.version, ...extra }) });
    const body = await response.json().catch(() => null); if (!response.ok) { setError(body?.error || "The operation could not be completed."); return; }
    setError(""); setSelectedStop(undefined); setIssueStop(undefined); setIssueText(""); announceDriverChange(date); await load();
    if (action === "complete-stop" && body?.run && body?.stop) {
      const label = stop.movementType === "collection" ? "Collection marked collected" : "Delivery marked delivered";
      setUndoAction({ run: body.run, stop: body.stop, label });
      window.setTimeout(() => setUndoAction((current) => current?.stop.canonicalId === body.stop.canonicalId ? undefined : current), 5000);
    }
  }
  async function dispatchRun(run: DeliveryRun) {
    const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dispatch-run", by: driver, runId: run.canonicalId, expectedRunVersion: run.version }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setRetryDispatchRun(run); setError(body?.error || "The vehicle could not be dispatched."); return; }
    setRetryDispatchRun(undefined); setError("");
    announceDriverChange(date); await load();
  }
  async function undoCompletion() {
    if (!undoAction) return;
    const current = undoAction;
    const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo-completion", by: driver, runId: current.run.canonicalId, expectedRunVersion: current.run.version, stopId: current.stop.canonicalId, expectedStopVersion: current.stop.version }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error || "The completion could not be undone. Refresh and try again."); return; }
    setUndoAction(undefined); setError(""); announceDriverChange(date); await load();
  }
  async function confirmReturned(run: DeliveryRun) {
    const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm-returned-to-cpu", by: driver, runId: run.canonicalId, expectedRunVersion: run.version }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error || "The return could not be confirmed. Refresh and try again."); return; }
    setError(""); announceDriverChange(date); await load();
  }
  const reportIssue = () => { if (issueStop) void execute("report-issue", issueStop, { issueCategory: issueType, issueDescription: issueText.trim() ? `${issueType}: ${issueText.trim()}` : issueType }); };

  return <main className="driver-app">
    <header className="driver-hero"><div className="driver-topline"><a href="/" aria-label="Back to planner">← Planner</a><span className="driver-bell" aria-label="Notifications">♧<i /></span></div><p className="driver-eyebrow">FIKA OS · DRIVER</p><div className="driver-title-row"><h1>{view === "collections" ? "Collections" : view === "deliveries" ? "Deliveries" : view === "messages" ? "Messages" : "More"}</h1><span className="driver-live">● LIVE</span></div><div className="driver-filters"><label><span>▣</span><select aria-label="Service date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{availableDates.map((option) => <option key={option} value={option}>{formatDate(option)}</option>)}</select></label><label><span>♙</span><select aria-label="Driver" value={driver} onChange={(event) => setDriver(event.target.value)}><option>Franco</option><option>Dee</option></select></label></div></header>
    {error && <div className="driver-alert" role="alert">{error}<button onClick={() => retryDispatchRun ? void dispatchRun(retryDispatchRun) : void load()}>{retryDispatchRun ? "Retry dispatch" : "Retry"}</button></div>}
    {!data ? <section className="driver-empty">Loading your day…</section> : view === "messages" ? <Messages messages={messages} onDismiss={(id) => setMessages((current) => current.filter((message) => message.id !== id))} onClear={() => setMessages([])} /> : view === "more" ? <More driver={driver} runs={runs} /> : <>
      {runs.filter((run) => showDispatchChecklist(run.status)).map((run) => { const runStops = stops.filter((stop) => stop.runId === run.canonicalId && !stopIsCollection(stop)); const loaded = runStops.filter((stop) => stop.loaded).length; return <section className="driver-departure" key={run.canonicalId}><div><p className="driver-section-kicker">LOAD CHECK</p><strong>{run.vehicleLabel || "Your vehicle"} · {loaded} of {runStops.length} deliveries loaded</strong><span>Tap each delivery below to confirm it is on the vehicle before leaving.</span></div><button disabled={!runStops.length || loaded !== runStops.length} onClick={() => void dispatchRun(run)}>{loaded === runStops.length ? "Dispatch vehicle" : "Load all deliveries"}</button></section>; })}
      {runs.filter((run) => run.returnToCpuPending).map((run) => <section className="driver-departure return-stage" key={`return-${run.canonicalId}`}><div><p className="driver-section-kicker">ALL STOPS COMPLETE</p><strong>Return to CPU</strong><span>All deliveries and collections are complete. Return the vehicle to CPU to finish the run.</span></div><div className="return-actions"><button onClick={() => window.open("http://localhost:3400", "_blank")}>Navigate to CPU</button><button onClick={() => void confirmReturned(run)}>Confirm returned to CPU</button></div></section>)}
      <section className="driver-summary" aria-label="Daily summary"><Metric icon="↘" value={deliveryCounts.total} label="Total deliveries" tone="purple" /><Metric icon="✓" value={completed} label="Completed stops" tone="mint" /><Metric icon="↗" value={collectionCounts.total} label="Total collections" tone="blue" /><Metric icon="!" value={attention} label="Attention" tone="rose" /></section>
      <div className="driver-progress"><span>Today’s progress</span><strong>{completed} of {stops.length} total stops completed</strong><div><i style={{ width: `${stops.length ? (completed / stops.length) * 100 : 0}%` }} /></div></div>
      <nav className="task-switcher" aria-label="Task type"><button className={view === "deliveries" ? "active" : ""} onClick={() => setView("deliveries")}>Deliveries <b>{deliveryCounts.remaining} remaining</b></button><button className={view === "collections" ? "active" : ""} onClick={() => setView("collections")}>Collections <b>{collectionCounts.remaining} remaining</b></button></nav>
      <section className="driver-list"><div className="list-heading"><div><p className="driver-section-kicker">{view === "collections" ? "RETURN LOAD" : "DELIVERY ROUTE"}</p><h2>{view === "collections" ? "Collection stops" : "Your stops"}</h2></div><span>{visibleStops.length} total · {visibleRemaining.length} remaining · {visibleCompleted.length} completed</span></div>{nextStop && <div className="next-banner"><span>Next up</span><strong>{stopLabel(nextStop, data)}</strong><b>{timeFor(nextStop)}</b></div>}{visibleRemaining.length > 0 && <section className="stop-group" aria-label="Next stops"><p className="driver-section-kicker">NEXT</p>{visibleRemaining.map((stop, index) => <StopRow key={stop.canonicalId} stop={stop} data={data} index={index} onOpen={() => setSelectedStop(stop)} />)}</section>}{visibleCompleted.length > 0 && <section className="stop-group completed-group" aria-label="Completed stops"><p className="driver-section-kicker">COMPLETED</p>{visibleCompleted.map((stop, index) => <StopRow key={stop.canonicalId} stop={stop} data={data} index={index} onOpen={() => setSelectedStop(stop)} />)}</section>}{!visibleStops.length && <div className="driver-empty compact">No {view} assigned for this day.</div>}</section>
    </>}
    <nav className="driver-bottom-nav" aria-label="Primary"><NavItem active={view === "deliveries"} icon="▦" label="Deliveries" onClick={() => setView("deliveries")} /><NavItem active={view === "collections"} icon="⌁" label="Collections" onClick={() => setView("collections")} /><NavItem active={view === "messages"} icon="□" label="Messages" onClick={() => setView("messages")} badge={messages.length ? String(messages.length) : undefined} /><NavItem active={view === "more"} icon="☰" label="More" onClick={() => setView("more")} /></nav>
    {undoAction && <div className="driver-undo-toast" role="status"><span>{undoAction.label}</span><button onClick={() => void undoCompletion()}>Undo</button></div>}{selectedStop && data && <StopDetail stop={selectedStop} data={data} onClose={() => setSelectedStop(undefined)} onAction={execute} onIssue={() => { setIssueStop(selectedStop); setSelectedStop(undefined); }} />}{issueStop && <IssueSheet stop={issueStop} type={issueType} setType={setIssueType} text={issueText} setText={setIssueText} onClose={() => setIssueStop(undefined)} onSubmit={reportIssue} />}
  </main>;
}

function Metric({ icon, value, label, tone }: { icon: string; value: number; label: string; tone: string }) { return <div className={`driver-metric ${tone}`}><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>; }
function NavItem({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: string; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}{badge && <i>{badge}</i>}</span><small>{label}</small></button>; }
function StopRow({ stop, data, index, onOpen }: { stop: DeliveryStop; data: Data; index: number; onOpen: () => void }) { const issue = stop.status === "issue" || (stop.issues || []).some((item) => item.status === "open"); return <button className={`stop-row-card ${stop.status} ${issue ? "attention" : ""}`} onClick={onOpen}><span className="stop-number">{stop.status === "completed" ? "✓" : index + 1}</span><span className="stop-row-main"><span className="stop-row-meta"><b>{stop.status === "completed" ? "COMPLETED" : stop.status === "arrived" ? "CURRENT" : issue ? "ATTENTION" : index === 0 ? "UP NEXT" : "PLANNED"}</b>{stop.loaded && <em className="loaded-tag">LOADED</em>}{stop.notes && <em>✎</em>}</span><strong>{stopLabel(stop, data)}</strong><small>{stop.movementType === "collection" ? "Collection" : "Delivery"} · {timeFor(stop)}{itemSummary(stop) ? ` · ${itemSummary(stop)}` : ""}</small></span><span className="stop-row-arrow">›</span></button>; }
function StopDetail({ stop, data, onClose, onAction, onIssue }: { stop: DeliveryStop; data: Data; onClose: () => void; onAction: (action: string, stop: DeliveryStop, extra?: Record<string, unknown>) => void; onIssue: () => void }) { const movement = movementsForStop(stop, data.movements)[0]; const oploc = data.oplocs.find((item) => item.id === stop.locationOplocId); const address = oploc?.address || oploc?.label || stop.locationLabelSnapshot; const collection = stop.movementType === "collection" || stop.linkedOperation === "collection"; const completed = stop.status === "completed"; return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="stop-detail-sheet" role="dialog" aria-modal="true" aria-label="Stop details"><button className="sheet-close" onClick={onClose}>×</button><div className="detail-type"><span>{collection ? "COLLECTION" : "DELIVERY"}</span><b>{completed ? "COMPLETED" : stop.loaded ? "LOADED" : statusLabel(stop.status)}</b></div><h2>{stopLabel(stop, data)}</h2><p className="detail-address">⌖ {address}</p><div className="detail-time"><span>{collection ? "Collection time" : "Delivery time"}</span><strong>{timeFor(stop)}</strong></div><div className="detail-block"><h3>Load summary</h3><p>{movement?.items.map((item) => `${item.quantity} ${item.unit || "items"} · ${item.description}`).join(" · ") || itemSummary(stop) || "Operational load details attached"}</p></div>{stop.notes && <div className="detail-note">✎ {stop.notes}</div>}{(stop.issues || []).filter((issue) => issue.status === "open").map((issue) => <div className="detail-issue" key={issue.id}>⚠ {issue.description}</div>)}<div className="detail-actions"><button className="navigate-action" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, "_blank")}>Navigate</button>{completed ? <button onClick={() => onAction("undo-completion", stop)}>{collection ? "Undo collection" : "Undo completion"}</button> : <button onClick={() => onAction("complete-stop", stop, { confirmDirect: true })}>{collection ? "Mark collected" : "Mark delivered"}</button>}<button className="issue-action" onClick={onIssue}>Report issue</button>{!collection && <button className="load-action" onClick={() => onAction("mark-stop-loaded", stop, { loaded: !stop.loaded })}>{stop.loaded ? "Remove loaded mark" : "Mark as loaded"}</button>}{collection && !completed && <PostponeCollectionControl onPostpone={(targetServiceDate) => onAction("defer-collection", stop, { targetServiceDate })} />}</div></section></div>; }
function PostponeCollectionControl({ onPostpone }: { onPostpone: (targetServiceDate: string) => void }) { const [targetDate, setTargetDate] = useState(addDays(operationalDate(), 1)); return <div className="postpone-collection"><label>Postpone collection<select value={targetDate} onChange={(event) => setTargetDate(event.target.value)}>{Array.from({ length: 14 }, (_, index) => addDays(operationalDate(), index + 1)).map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</select></label><button onClick={() => onPostpone(targetDate)}>Postpone collection</button></div>; }
function IssueSheet({ stop, type, setType, text, setText, onClose, onSubmit }: { stop: DeliveryStop; type: string; setType: (value: string) => void; text: string; setText: (value: string) => void; onClose: () => void; onSubmit: () => void }) { return <div className="sheet-backdrop" role="presentation"><section className="stop-detail-sheet issue-sheet" role="dialog" aria-modal="true" aria-label="Report an issue"><button className="sheet-close" onClick={onClose}>×</button><p className="driver-section-kicker">REPORT EXCEPTION</p><h2>What needs attention?</h2><p className="issue-stop-name">{stop.locationLabelSnapshot}</p><label>Issue type<select value={type} onChange={(event) => setType(event.target.value)}>{driverIssueTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Notes <span className="optional-label">(optional)</span><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a short note for the planner…" rows={4} /></label><button className="submit-issue" onClick={onSubmit}>Submit issue</button></section></div>; }
function Messages({ messages, onDismiss, onClear }: { messages: DriverMessage[]; onDismiss: (id: string) => void; onClear: () => void }) { return <section className="secondary-screen"><div className="messages-heading"><div><p className="driver-section-kicker">INBOX</p><h2>Messages</h2></div>{messages.length > 0 && <button className="clear-messages" onClick={onClear}>Clear all</button>}</div>{messages.length ? messages.map((message) => <article className="message-card" key={message.id}><span>●</span><div><strong>{message.title}</strong><p>{message.body}</p><small>{message.meta}</small></div><button className="dismiss-message" aria-label={`Dismiss ${message.title}`} onClick={() => onDismiss(message.id)}>×</button></article>) : <div className="driver-empty compact">You’re all caught up. No new messages.</div>}</section>; }
function More({ driver, runs }: { driver: string; runs: DeliveryRun[] }) { return <section className="secondary-screen"><p className="driver-section-kicker">ACCOUNT</p><h2>More</h2><div className="more-card"><span>♙</span><div><small>Signed in as</small><strong>{driver}</strong></div></div><div className="more-card"><span>▣</span><div><small>Assigned vehicles</small><strong>{runs.map((run) => run.vehicleLabel || "Van").join(" · ") || "No vehicle assigned"}</strong></div></div><a className="planner-return" href="/">Open planner workspace →</a></section>; }
function formatDate(date: string) { return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`)); }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10); }
function dateOptions() { const start = new Date(`${operationalDate()}T12:00:00`); return Array.from({ length: 8 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date.toISOString().slice(0, 10); }); }
function timeFor(stop: DeliveryStop) { const planned = stop.plannedWindow; if (planned) return `${planned.startTime}${planned.endTime ? ` – ${planned.endTime}` : ""}`; if (stop.plannedArrivalTime) return stop.plannedArrivalTime; const required = stop.window; return required ? `${required.startTime}${required.endTime ? ` – ${required.endTime}` : ""}` : stop.requiredTime || "Time to confirm"; }
function mobileStopMinutes(stop: DeliveryStop) { const value = stop.plannedWindow?.startTime || stop.plannedArrivalTime || stop.window?.startTime || stop.requiredTime; if (!value) return Number.MAX_SAFE_INTEGER; const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
function itemSummary(stop: DeliveryStop) { return stop.requirementRefs.length ? `${stop.requirementRefs.length} load${stop.requirementRefs.length === 1 ? "" : "s"}` : ""; }
function stopLabel(stop: DeliveryStop, data: Data) { return data.oplocs.find((item) => item.id === stop.locationOplocId)?.label || (stop.locationLabelSnapshot.startsWith("oploc:") ? "Operational location" : stop.locationLabelSnapshot); }
function statusLabel(status: DeliveryStop["status"]) { return status === "completed" ? "Complete" : status === "arrived" ? "Current" : status === "issue" ? "Attention" : "Planned"; }
