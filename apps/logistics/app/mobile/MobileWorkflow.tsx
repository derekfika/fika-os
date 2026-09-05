"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FulfilmentRequirement } from "../../../shared/fulfilment-requirement";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "../../lib/types";
import { operationalDate } from "../../lib/date";
import { movementsForStop, selectMobileRuns } from "../../lib/planning";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import { announceDriverChange, driverIssueTypes, showDispatchChecklist, stopCounts, stopIsCollection } from "../../lib/mobile-driver";
import { responseErrorDetails, LogisticsResponseError } from "../../lib/client-errors";
import { withDataTrace } from "@fika/server-shared/data-source-meter-client";
import { readCachedProjection, writeCachedProjection } from "../../lib/logistics-cache";

type Data = { requirements: FulfilmentRequirement[]; runs: DeliveryRun[]; stops: DeliveryStop[]; movements: MovementRequest[]; oplocs: { id: string; label: string; address?: string }[]; serviceDate: string; projection?: Parameters<typeof projectionToDashboardData>[0] };
type View = "deliveries" | "collections" | "messages" | "more";
type DriverMessage = { id: string; title: string; body: string; meta: string };
type UndoAction = { run: DeliveryRun; stop: DeliveryStop; label: string };

export default function MobileWorkflow({ fixedVan }: { fixedVan?: "Van 1" | "Van 2" } = {}) {
  const [driverId, setDriverId] = useState("");
  const [data, setData] = useState<Data>();
  const [view, setView] = useState<View>("deliveries");
  const [selectedStop, setSelectedStop] = useState<DeliveryStop>();
  const [issueStop, setIssueStop] = useState<DeliveryStop>();
  const [issueText, setIssueText] = useState("");
  const [issueType, setIssueType] = useState("Cannot access building");
  const [error, setError] = useState("");
  const [undoAction, setUndoAction] = useState<UndoAction>();
  const [retryDispatchRun, setRetryDispatchRun] = useState<DeliveryRun>();
  const [pendingAction, setPendingAction] = useState<string>();
  const stopTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [selectedDate, setSelectedDate] = useState(operationalDate());
  const [messages, setMessages] = useState<DriverMessage[]>([
    { id: "planner-update", title: "Planner update", body: "Your route is ready for today. Drive safe.", meta: "08:32 · Dispatch" },
    { id: "site-notice", title: "Site notice", body: "Bridgepoint reception is using the side entrance today.", meta: "Yesterday · Operations" },
  ]);
  const date = selectedDate;
  const availableDates = useMemo(() => dateOptions(), []);

  const load = async () => withDataTrace({ app: "logistics", action: fixedVan ? "logistics.mobile.van.load" : "logistics.mobile.day.load", path: typeof window === "undefined" ? "/mobile" : window.location.pathname }, async () => { const vehicle = fixedVan || "organisation"; try { const vehicleQuery = fixedVan ? `&vehicle=${encodeURIComponent(fixedVan.toLowerCase().replace(" ", ""))}` : ""; const headResponse = await fetch(`/api/logistics?syncHead=1&serviceDate=${date}${vehicleQuery}`, { cache: "no-store" }); const head = await headResponse.json().catch(() => null); if (!headResponse.ok) throw new LogisticsResponseError(responseErrorDetails(head, headResponse.status, "Logistics sync state could not be checked.")); const cacheScope = headResponse.headers.get("x-logistics-cache-scope") || ""; const cached = cacheScope ? await readCachedProjection(cacheScope, date, vehicle) : undefined; if (cached && cached.lastChangeSequence === Number(head.sequence) && cached.state !== "STALE" && cached.state !== "PARTIAL") { setData({ ...projectionToDashboardData(cached), projection: cached }); setError(""); return; } const response = await fetch(`/api/logistics?projection=1&serviceDate=${date}${vehicleQuery}`, { cache: "no-store" }); const body = await response.json().catch(() => null); if (!response.ok) throw new LogisticsResponseError(responseErrorDetails(body, response.status, "Logistics is temporarily unavailable.")); if (!body?.projection) { if (body?.projectionState === "VALID_EMPTY" || body?.state === "EMPTY") { const empty = { serviceDate: date, revision: 0, lastChangeSequence: Number(head.sequence || 0), state: "VALID_EMPTY" as const, planningQueue: [], deliveryLoads: [], runs: [], exceptions: [], summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: new Date().toISOString() }; setData({ ...projectionToDashboardData(empty), projection: empty }); setError(""); return; } throw new Error("Logistics projection is unavailable."); } const projection = body.projection as Parameters<typeof projectionToDashboardData>[0]; if (cacheScope) await writeCachedProjection(cacheScope, projection, vehicle); setData({ ...projectionToDashboardData(projection), projection }); setError(body.projectionState === "STALE" ? "Showing a stale Logistics projection; reconciliation is required." : ""); } catch (cause) { setError(cause instanceof LogisticsResponseError ? `${cause.message}${cause.details.requestId ? ` Reference: ${cause.details.requestId}` : ""}` : cause instanceof Error ? cause.message : "Logistics is temporarily unavailable."); } });
  useEffect(() => { void load(); }, [selectedDate]);
  useEffect(() => { if (!driverId) setDriverId(data?.runs.find((run) => run.driverId)?.driverId || ""); }, [data?.runs, driverId]);

  const driverOptions = useMemo(() => Array.from(new Map((data?.runs || []).filter((run) => run.driverId && run.driverLabel && run.driverId.toLowerCase() !== run.driverLabel.toLowerCase()).map((run) => [run.driverId, run.driverLabel])).entries()), [data?.runs]);
  const fixedRuns = useMemo(() => fixedVan ? (data?.runs || []).filter((run) => run.vehicleLabel === fixedVan) : data?.runs || [], [data?.runs, fixedVan]);
  const driver = fixedVan || driverOptions.find(([id]) => id === driverId)?.[1] || "Unassigned driver";
  const runs = useMemo(() => fixedVan ? selectMobileRuns(fixedRuns, fixedRuns[0]?.driverId || fixedRuns[0]?.driverLabel || "", date) : selectMobileRuns(fixedRuns, driverId, date), [fixedRuns, fixedVan, driverId, date]);
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

  const returnFocusToStop = () => window.requestAnimationFrame(() => stopTriggerRef.current?.focus());
  const closeStopSheet = () => { setSelectedStop(undefined); returnFocusToStop(); };
  const closeIssueSheet = () => { setIssueStop(undefined); returnFocusToStop(); };

  async function execute(action: string, stop: DeliveryStop, extra: Record<string, unknown> = {}) {
    if (pendingAction) return;
    const run = runs.find((item) => item.canonicalId === stop.runId); if (!run) return;
    setPendingAction(action);
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, runId: run.canonicalId, expectedRunVersion: run.version, stopId: stop.canonicalId, expectedStopVersion: stop.version, ...extra }) });
      const body = await response.json().catch(() => null); if (!response.ok) { const details = responseErrorDetails(body, response.status, "The operation could not be completed."); setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`); return; }
      setError(""); setSelectedStop(undefined); setIssueStop(undefined); setIssueText(""); returnFocusToStop(); announceDriverChange(date); await load();
      if (action === "complete-stop" && body?.run && body?.stop) {
        const label = stop.movementType === "collection" ? "Collection marked collected" : "Delivery marked delivered";
        setUndoAction({ run: body.run, stop: body.stop, label });
        window.setTimeout(() => setUndoAction((current) => current?.stop.canonicalId === body.stop.canonicalId ? undefined : current), 5000);
      }
    } finally {
      setPendingAction(undefined);
    }
  }
  async function dispatchRun(run: DeliveryRun) {
    if (pendingAction) return;
    setPendingAction("dispatch-run");
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dispatch-run", runId: run.canonicalId, expectedRunVersion: run.version }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setRetryDispatchRun(run); const details = responseErrorDetails(body, response.status, "The vehicle could not be dispatched."); setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`); return; }
      setRetryDispatchRun(undefined); setError("");
      announceDriverChange(date); await load();
    } finally {
      setPendingAction(undefined);
    }
  }
  async function undoCompletion() {
    if (!undoAction) return;
    if (pendingAction) return;
    const current = undoAction;
    setPendingAction("undo-completion");
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo-completion", runId: current.run.canonicalId, expectedRunVersion: current.run.version, stopId: current.stop.canonicalId, expectedStopVersion: current.stop.version }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { const details = responseErrorDetails(body, response.status, "The completion could not be undone. Refresh and try again."); setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`); return; }
      setUndoAction(undefined); setError(""); announceDriverChange(date); await load();
    } finally {
      setPendingAction(undefined);
    }
  }
  async function confirmReturned(run: DeliveryRun) {
    if (pendingAction) return;
    setPendingAction("confirm-returned-to-cpu");
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm-returned-to-cpu", runId: run.canonicalId, expectedRunVersion: run.version }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { const details = responseErrorDetails(body, response.status, "The return could not be confirmed. Refresh and try again."); setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`); return; }
      setError(""); announceDriverChange(date); await load();
    } finally {
      setPendingAction(undefined);
    }
  }
  const reportIssue = () => { if (issueStop) void execute("report-issue", issueStop, { issueCategory: issueType, issueDescription: issueText.trim() ? `${issueType}: ${issueText.trim()}` : issueType }); };

  return <main className="driver-app">
    <header className="driver-hero"><div className="driver-topline"><a href="/" aria-label="Back to planner">← Planner</a><span className="driver-bell" aria-label="Notifications">♧<i /></span></div><p className="driver-eyebrow">FIKA OS · DRIVER</p><div className="driver-title-row"><h1>{view === "collections" ? "Collections" : view === "deliveries" ? "Deliveries" : view === "messages" ? "Messages" : "More"}</h1><span className="driver-live">● LIVE</span></div><div className="driver-filters"><label><span>▣</span><select aria-label="Service date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{availableDates.map((option) => <option key={option} value={option}>{formatDate(option)}</option>)}</select></label>{!fixedVan && <label><span>♙</span><select aria-label="Driver" value={driverId} onChange={(event) => setDriverId(event.target.value)}><option value="">Unassigned driver</option>{driverOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}</div></header>
    {pendingAction && <div className="driver-operation" role="status" aria-live="polite">{operationLabel(pendingAction)} Keep this page open.</div>}{error && <div className="driver-alert" role="alert">{error}<button disabled={Boolean(pendingAction)} onClick={() => retryDispatchRun ? void dispatchRun(retryDispatchRun) : void load()}>{retryDispatchRun ? "Retry dispatch" : "Retry"}</button></div>}
    {!data ? <section className="driver-empty">Loading your day…</section> : view === "messages" ? <Messages messages={messages} onDismiss={(id) => setMessages((current) => current.filter((message) => message.id !== id))} onClear={() => setMessages([])} /> : view === "more" ? <More driver={driver} runs={runs} /> : <>
      {runs.filter((run) => showDispatchChecklist(run.status)).map((run) => { const runStops = stops.filter((stop) => stop.runId === run.canonicalId && !stopIsCollection(stop)); const loaded = runStops.filter((stop) => stop.loaded).length; return <section className="driver-departure" key={run.canonicalId}><div><p className="driver-section-kicker">LOAD CHECK</p><strong>{run.vehicleLabel || "Your vehicle"} · {loaded} of {runStops.length} deliveries loaded</strong><span>Tap each delivery below to confirm it is on the vehicle before leaving.</span></div><button className="primary-action" disabled={Boolean(pendingAction) || !runStops.length || loaded !== runStops.length} onClick={() => void dispatchRun(run)}>{pendingAction === "dispatch-run" ? "Dispatching…" : loaded === runStops.length ? "Dispatch vehicle" : "Load all deliveries"}</button></section>; })}
      {runs.filter((run) => run.returnToCpuPending).map((run) => <section className="driver-departure return-stage" key={`return-${run.canonicalId}`}><div><p className="driver-section-kicker">ALL STOPS COMPLETE</p><strong>Return to CPU</strong><span>All deliveries and collections are complete. Return the vehicle to CPU to finish the run.</span></div><div className="return-actions"><button className="secondary-action" onClick={() => window.open(process.env.NEXT_PUBLIC_FIKA_CPU_URL || "/", "_blank")}>Navigate to CPU</button><button className="primary-action" disabled={Boolean(pendingAction)} onClick={() => void confirmReturned(run)}>{pendingAction === "confirm-returned-to-cpu" ? "Confirming…" : "Confirm returned to CPU"}</button></div></section>)}
      <section className="driver-summary" aria-label="Daily summary"><Metric icon="↘" value={deliveryCounts.total} label="Total deliveries" tone="purple" /><Metric icon="✓" value={completed} label="Completed stops" tone="mint" /><Metric icon="↗" value={collectionCounts.total} label="Total collections" tone="blue" /><Metric icon="!" value={attention} label="Attention" tone="rose" /></section>
      <div className="driver-progress"><span>Today’s progress</span><strong>{completed} of {stops.length} total stops completed</strong><div><i style={{ width: `${stops.length ? (completed / stops.length) * 100 : 0}%` }} /></div></div>
      <nav className="task-switcher" aria-label="Task type"><button className={view === "deliveries" ? "active" : ""} onClick={() => setView("deliveries")}>Deliveries <b>{deliveryCounts.remaining} remaining</b></button><button className={view === "collections" ? "active" : ""} onClick={() => setView("collections")}>Collections <b>{collectionCounts.remaining} remaining</b></button></nav>
      <section className="driver-list"><div className="list-heading"><div><p className="driver-section-kicker">{view === "collections" ? "RETURN LOAD" : "DELIVERY ROUTE"}</p><h2>{view === "collections" ? "Collection stops" : "Your stops"}</h2></div><span>{visibleStops.length} total · {visibleRemaining.length} remaining · {visibleCompleted.length} completed</span></div>{nextStop && <div className="next-banner"><span>Next up</span><strong>{stopLabel(nextStop, data)}</strong><b>{timeFor(nextStop)}</b></div>}{visibleRemaining.length > 0 && <section className="stop-group" aria-label="Next stops"><p className="driver-section-kicker">NEXT</p>{visibleRemaining.map((stop, index) => <StopRow key={stop.canonicalId} stop={stop} data={data} index={index} onOpen={(trigger) => { stopTriggerRef.current = trigger; setSelectedStop(stop); }} />)}</section>}{visibleCompleted.length > 0 && <section className="stop-group completed-group" aria-label="Completed stops"><p className="driver-section-kicker">COMPLETED</p>{visibleCompleted.map((stop, index) => <StopRow key={stop.canonicalId} stop={stop} data={data} index={index} onOpen={(trigger) => { stopTriggerRef.current = trigger; setSelectedStop(stop); }} />)}</section>}{!visibleStops.length && <div className="driver-empty compact">No {view} assigned for this day.</div>}</section>
    </>}
    <nav className="driver-bottom-nav" aria-label="Primary"><NavItem active={view === "deliveries"} icon="▦" label="Deliveries" onClick={() => setView("deliveries")} /><NavItem active={view === "collections"} icon="⌁" label="Collections" onClick={() => setView("collections")} /><NavItem active={view === "messages"} icon="□" label="Messages" onClick={() => setView("messages")} badge={messages.length ? String(messages.length) : undefined} /><NavItem active={view === "more"} icon="☰" label="More" onClick={() => setView("more")} /></nav>
    {undoAction && <div className="driver-undo-toast" role="status"><span>{undoAction.label}</span><button disabled={Boolean(pendingAction)} onClick={() => void undoCompletion()}>{pendingAction === "undo-completion" ? "Undoing…" : "Undo"}</button></div>}{selectedStop && data && <StopDetail stop={selectedStop} data={data} busy={Boolean(pendingAction)} onClose={closeStopSheet} onAction={execute} onIssue={() => { if (!pendingAction) { setIssueStop(selectedStop); setSelectedStop(undefined); } }} />}{issueStop && <IssueSheet stop={issueStop} type={issueType} setType={setIssueType} text={issueText} setText={setIssueText} busy={Boolean(pendingAction)} onClose={closeIssueSheet} onSubmit={reportIssue} />}
  </main>;
}

function Metric({ icon, value, label, tone }: { icon: string; value: number; label: string; tone: string }) { return <div className={`driver-metric ${tone}`}><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>; }
function NavItem({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: string; onClick: () => void }) { return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} aria-label={label} onClick={onClick}><span aria-hidden="true">{icon}{badge && <i>{badge}</i>}</span><small>{label}</small></button>; }
function StopRow({ stop, data, index, onOpen }: { stop: DeliveryStop; data: Data; index: number; onOpen: (trigger: HTMLButtonElement) => void }) { const issue = stop.status === "issue" || (stop.issues || []).some((item) => item.status === "open"); return <button className={`stop-row-card ${stop.status} ${issue ? "attention" : ""}`} aria-label={`Open details for ${stopLabel(stop, data)}`} onClick={(event) => onOpen(event.currentTarget)}><span className="stop-number" aria-hidden="true">{stop.status === "completed" ? "✓" : index + 1}</span><span className="stop-row-main"><span className="stop-row-meta"><b>{stop.status === "completed" ? "COMPLETED" : stop.status === "arrived" ? "CURRENT" : issue ? "ATTENTION" : index === 0 ? "UP NEXT" : "PLANNED"}</b>{stop.loaded && stop.status !== "completed" && <em className="loaded-tag">LOADED</em>}{stop.notes && <em aria-label="Has note">✎</em>}</span><strong>{stopLabel(stop, data)}</strong><small>{stop.movementType === "collection" ? "Collection" : "Delivery"} · {timeFor(stop)}{itemSummary(stop) ? ` · ${itemSummary(stop)}` : ""}</small></span><span className="stop-row-arrow" aria-hidden="true">›</span></button>; }
function StopDetail({ stop, data, busy, onClose, onAction, onIssue }: { stop: DeliveryStop; data: Data; busy: boolean; onClose: () => void; onAction: (action: string, stop: DeliveryStop, extra?: Record<string, unknown>) => void; onIssue: () => void }) {
  const movement = movementsForStop(stop, data.movements)[0];
  const oploc = data.oplocs.find((item) => item.id === stop.locationOplocId);
  const address = oploc?.address || oploc?.label || stop.locationLabelSnapshot;
  const collection = stop.movementType === "collection" || stop.linkedOperation === "collection";
  const completed = stop.status === "completed";
  const subloads = loadSubloads(stop, data, movement);
  const toggleSubload = (subload: (typeof subloads)[number]) => {
    const delivered = stop.status === "completed" || (subload.kind === "requirement" && Boolean(stop.deliveredRequirementIds?.includes(subload.id)));
    if (delivered) return;
    const loaded = stop.loaded === true || (subload.kind === "requirement" && Boolean(stop.loadedRequirementIds?.includes(subload.id)));
    const action = loaded ? "mark-subload-delivered" : "mark-subload-loaded";
    onAction(subload.kind === "requirement" ? action : "mark-stop-loaded", stop, subload.kind === "requirement" ? { requirementId: subload.id, loaded: true } : { loaded: true });
  };
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className="stop-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="stop-detail-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); } }}><button ref={closeRef} className="sheet-close" aria-label="Close stop details" onClick={onClose}>×</button><div className="detail-type"><span>{collection ? "COLLECTION" : "DELIVERY"}</span></div><h2 id="stop-detail-title">{stopLabel(stop, data)}</h2><p className="detail-address">⌖ {address}</p><div className="detail-time"><span>{collection ? "Collection time" : "Delivery time"}</span><strong>{timeFor(stop)}</strong></div><div className="detail-block"><h3>{collection ? "Collection items" : "Load checklist"}</h3><p className="detail-help">Tap each subload to progress it from loaded to delivered.</p>{subloads.length ? <ul className="detail-subloads">{subloads.map((subload) => { const delivered = stop.status === "completed" || (subload.kind === "requirement" && Boolean(stop.deliveredRequirementIds?.includes(subload.id))); const loaded = stop.loaded === true || (subload.kind === "requirement" && Boolean(stop.loadedRequirementIds?.includes(subload.id))); const label = delivered ? "Delivered" : loaded ? "Tap to mark delivered" : "Tap to mark loaded"; return <li key={subload.id}><button type="button" disabled={busy} className={`subload-card ${delivered ? "is-delivered" : loaded ? "is-loaded" : ""}`} aria-label={`${subload.category}: ${label}`} aria-pressed={delivered} onClick={() => toggleSubload(subload)}><span className="subload-check" aria-hidden="true">{delivered ? "✓" : loaded ? "•" : ""}</span><span><b>{subload.category}</b><small>{subload.description}</small><em>{label}</em></span><strong>{subload.quantity} {subload.unit}</strong></button></li>; })}</ul> : <p>Operational load details attached</p>}</div>{stop.notes && <div className="detail-note">✎ {stop.notes}</div>}{(stop.issues || []).filter((issue) => issue.status === "open").map((issue) => <div className="detail-issue" key={issue.id}>⚠ {issue.description}</div>)}<div className="detail-actions"><button className="secondary-action navigate-action" disabled={busy} onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, "_blank")}>Navigate</button>{completed ? <button className="secondary-action" disabled={busy} onClick={() => onAction("undo-completion", stop)}>{busy ? "Saving…" : collection ? "Undo collection" : "Undo completion"}</button> : <button className="primary-action" disabled={busy} onClick={() => onAction("complete-stop", stop, { confirmDirect: true })}>{busy ? "Saving…" : collection ? "Mark received" : "Mark delivered"}</button>}<button className="danger-action issue-action" disabled={busy} onClick={onIssue}>Report issue</button>{collection && !completed && <PostponeCollectionControl disabled={busy} onPostpone={(targetServiceDate) => onAction("defer-collection", stop, { targetServiceDate })} />}</div></section></div>;
}
function PostponeCollectionControl({ disabled, onPostpone }: { disabled: boolean; onPostpone: (targetServiceDate: string) => void }) { const [targetDate, setTargetDate] = useState(addDays(operationalDate(), 1)); return <div className="postpone-collection"><label>Postpone collection<select disabled={disabled} value={targetDate} onChange={(event) => setTargetDate(event.target.value)}>{Array.from({ length: 14 }, (_, index) => addDays(operationalDate(), index + 1)).map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</select></label><button className="secondary-action" disabled={disabled} onClick={() => onPostpone(targetDate)}>Postpone collection</button></div>; }
function IssueSheet({ stop, type, setType, text, setText, busy, onClose, onSubmit }: { stop: DeliveryStop; type: string; setType: (value: string) => void; text: string; setText: (value: string) => void; busy: boolean; onClose: () => void; onSubmit: () => void }) { const closeRef = useRef<HTMLButtonElement>(null); useEffect(() => { closeRef.current?.focus(); }, []); return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className="stop-detail-sheet issue-sheet" role="dialog" aria-modal="true" aria-labelledby="issue-sheet-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); } }}><button ref={closeRef} className="sheet-close" aria-label="Close report issue" onClick={onClose}>×</button><p className="driver-section-kicker">REPORT EXCEPTION</p><h2 id="issue-sheet-title">What needs attention?</h2><p className="issue-stop-name">{stop.locationLabelSnapshot}</p><label>Issue type<select disabled={busy} value={type} onChange={(event) => setType(event.target.value)}>{driverIssueTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Notes <span className="optional-label">(optional)</span><textarea disabled={busy} value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a short note for the planner…" rows={4} /></label><button className="danger-action submit-issue" disabled={busy} onClick={onSubmit}>{busy ? "Submitting…" : "Submit issue"}</button></section></div>; }
function Messages({ messages, onDismiss, onClear }: { messages: DriverMessage[]; onDismiss: (id: string) => void; onClear: () => void }) { return <section className="secondary-screen"><div className="messages-heading"><div><p className="driver-section-kicker">INBOX</p><h2>Messages</h2></div>{messages.length > 0 && <button className="clear-messages" onClick={onClear}>Clear all</button>}</div>{messages.length ? messages.map((message) => <article className="message-card" key={message.id}><span>●</span><div><strong>{message.title}</strong><p>{message.body}</p><small>{message.meta}</small></div><button className="dismiss-message" aria-label={`Dismiss ${message.title}`} onClick={() => onDismiss(message.id)}>×</button></article>) : <div className="driver-empty compact">You’re all caught up. No new messages.</div>}</section>; }
function More({ driver, runs }: { driver: string; runs: DeliveryRun[] }) { return <section className="secondary-screen"><p className="driver-section-kicker">ACCOUNT</p><h2>More</h2><div className="more-card"><span>♙</span><div><small>Signed in as</small><strong>{driver}</strong></div></div><div className="more-card"><span>▣</span><div><small>Assigned vehicles</small><strong>{runs.map((run) => run.vehicleLabel || "Van").join(" · ") || "No vehicle assigned"}</strong></div></div><a className="planner-return" href="/">Open planner workspace →</a></section>; }
function formatDate(date: string) { return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`)); }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10); }
function dateOptions() { const start = new Date(`${operationalDate()}T12:00:00`); return Array.from({ length: 8 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date.toISOString().slice(0, 10); }); }
function timeFor(stop: DeliveryStop) { const planned = stop.plannedWindow; if (planned) return `${planned.startTime}${planned.endTime ? ` – ${planned.endTime}` : ""}`; if (stop.plannedArrivalTime) return stop.plannedArrivalTime; const required = stop.window; return required ? `${required.startTime}${required.endTime ? ` – ${required.endTime}` : ""}` : stop.requiredTime || "Time to confirm"; }
function mobileStopMinutes(stop: DeliveryStop) { const value = stop.plannedWindow?.startTime || stop.plannedArrivalTime || stop.window?.startTime || stop.requiredTime; if (!value) return Number.MAX_SAFE_INTEGER; const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
function loadSubloads(stop: DeliveryStop, data: Data, movement?: MovementRequest) {
  const rows = stop.requirementRefs.flatMap((ref) => {
    const requirement = data.requirements.find((item) => item.canonicalId === ref.requirementId);
    if (requirement) {
      const quantity = requirement.lines.reduce((total, line) => total + (Number(line.quantity) || 0), 0);
      const units = new Set(requirement.lines.map((line) => line.unit).filter(Boolean));
      return quantity ? [{ id: ref.requirementId, kind: "requirement" as const, category: sourceCategory(requirement.sourceDomain), description: requirement.lines.length === 1 ? requirement.lines[0].displayNameSnapshot : `${requirement.lines.length} items`, quantity, unit: units.size === 1 ? [...units][0] : "pieces" }] : [];
    }
    const job = data.projection?.deliveryLoads.flatMap((load) => load.jobs).find((item) => item.id === ref.requirementId);
    return job?.totalUnits ? [{ id: ref.requirementId, kind: "requirement" as const, category: sourceCategory(job.sourceType), description: job.contents.length === 1 ? job.contents[0].description : `${job.contents.length} items`, quantity: job.totalUnits, unit: "pieces" }] : [];
  });
  if (rows.length) return rows;
  return movement?.items.map((item, index) => ({ id: `${movement.canonicalId}:${index}`, kind: "movement" as const, category: "Movement", description: item.description, quantity: item.quantity, unit: item.unit || "pieces" })) || [];
}
function sourceCategory(source: string) { return source === "grab-and-go" ? "Grab & Go" : source === "cpu-production" ? "CPU production" : source === "menu-planning" ? "Menu planning" : "Operational load"; }
function itemSummary(stop: DeliveryStop) { return stop.requirementRefs.length ? `${stop.requirementRefs.length} load${stop.requirementRefs.length === 1 ? "" : "s"}` : ""; }
function stopLabel(stop: DeliveryStop, data: Data) { return data.oplocs.find((item) => item.id === stop.locationOplocId)?.label || (stop.locationLabelSnapshot.startsWith("oploc:") ? "Operational location" : stop.locationLabelSnapshot); }
function statusLabel(status: DeliveryStop["status"]) { return status === "completed" ? "Complete" : status === "arrived" ? "Current" : status === "issue" ? "Attention" : "Planned"; }
function operationLabel(action: string) { return action === "dispatch-run" ? "Dispatching vehicle…" : action === "confirm-returned-to-cpu" ? "Confirming return…" : action === "report-issue" ? "Submitting issue…" : action === "undo-completion" ? "Undoing completion…" : action === "defer-collection" ? "Postponing collection…" : "Saving update…"; }
