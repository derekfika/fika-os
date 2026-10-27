"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FulfilmentRequirement } from "../../../shared/fulfilment-requirement";
import { fulfilmentWorkstream } from "../../../shared/fulfilment-workstream";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "../../lib/types";
import { isOperationalDate, mobileServiceDate, operationalDate } from "../../lib/date";
import { movementsForStop, selectMobileVehicleRuns } from "../../lib/planning";
import { VehicleAuthorityProvider, useVehicleAuthority } from "../vehicle-authority";
import { logisticsVehicleLabel, type LogisticsVehicleId } from "../../../shared/logistics-authority";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import { announceDriverChange, driverIssueTypes, showDispatchChecklist, stopIsCollection } from "../../lib/mobile-driver";
import { RunOverview, visitStatusText } from "./run-overview";
import { RunLoadCheck } from "./run-load-check";
import { dispatchBlockers, hasScheduledTime } from "./dispatch-readiness";
import styles from "./stop-detail.module.css";
import shell from "./driver-shell.module.css";
import { groupRunVisits, hasOpenIssue } from "./run-overview-model";
import { responseErrorDetails, LogisticsResponseError } from "../../lib/client-errors";
import { withDataTrace } from "@fika/server-shared/data-source-meter-client";
import { readCachedProjection, writeCachedProjection } from "../../lib/logistics-cache";
import { fetchProjectionWithRecovery } from "../../lib/projection-fetch";
import { ScopedRequestCoordinator, scopedRequestKey, type ScopedRequestContext } from "../../lib/scoped-request-coordinator";

type Data = { requirements: FulfilmentRequirement[]; runs: DeliveryRun[]; stops: DeliveryStop[]; movements: MovementRequest[]; oplocs: { id: string; label: string; address?: string }[]; serviceDate: string; projection?: Parameters<typeof projectionToDashboardData>[0] };
type View = "run" | "messages" | "more";
type DriverMessage = { id: string; title: string; body: string; meta: string };
type UndoAction = { run: DeliveryRun; stop: DeliveryStop; label: string };

async function loadMobileProjection(date: string, vehicleQuery: string, headers: HeadersInit) {
  const recovered = await fetchProjectionWithRecovery({ serviceDate: date, vehicleQuery, headers });
  const { response } = recovered;
  const body = recovered.body as Record<string, unknown> | null;
  if (!response.ok) throw new LogisticsResponseError(responseErrorDetails(body, response.status, "Logistics is temporarily unavailable."));
  return body;
}

export default function MobileWorkflow({ fixedVan }: { fixedVan?: "Van 1" | "Van 2" } = {}) {
  return <VehicleAuthorityProvider mobilePinSession={Boolean(fixedVan)}><MobileWorkflowContents fixedVan={fixedVan} /></VehicleAuthorityProvider>;
}
function MobileWorkflowContents({ fixedVan }: { fixedVan?: "Van 1" | "Van 2" }) {
  const mobileHeaders: Record<string, string> = fixedVan ? { "x-fika-logistics-mobile-request": "1" } : {};
  const authority = useVehicleAuthority();
  const [selectedVehicle, setSelectedVehicle] = useState<LogisticsVehicleId | "">(fixedVan === "Van 1" ? "van1" : fixedVan === "Van 2" ? "van2" : "");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [data, setData] = useState<Data>();
  const [view, setView] = useState<View>("run");
  const [selectedStop, setSelectedStop] = useState<DeliveryStop>();
  const [issueStop, setIssueStop] = useState<DeliveryStop>();
  const [issueText, setIssueText] = useState("");
  const [issueType, setIssueType] = useState("Cannot access building");
  const [error, setError] = useState("");
  const [syncUnavailable, setSyncUnavailable] = useState(false);
  const [projectionNeedsMaterialisation, setProjectionNeedsMaterialisation] = useState(false);
  const [undoAction, setUndoAction] = useState<UndoAction>();
  const [retryDispatchRun, setRetryDispatchRun] = useState<DeliveryRun>();
  const [pendingAction, setPendingAction] = useState<string>();
  const stopTriggerRef = useRef<HTMLButtonElement | null>(null);
  const requests = useRef(new ScopedRequestCoordinator()).current;
  const activeContext = useRef<ScopedRequestContext | undefined>(undefined);
  const projectionSequence = useRef<number | undefined>(undefined);
  const syncCheckInFlight = useRef(new Map<string, Promise<void>>());
  // Resolve the UK operational date after hydration so SSR and the browser
  // cannot disagree around midnight or on a DST boundary.
  const [selectedDate, setSelectedDate] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<DriverMessage[]>([]);
  const date = selectedDate;
  const visibleData = data?.serviceDate === selectedDate ? data : undefined;
  const availableDates = useMemo(() => selectedDate ? dateOptions(selectedDate) : [], [selectedDate]);

  const selectDate = (next: string) => {
    if (!isOperationalDate(next) || next === selectedDate) return;
    const url = new URL(window.location.href);
    url.searchParams.set("serviceDate", next);
    url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
    activeContext.current = requests.activate(next);
    projectionSequence.current = undefined;
    setSelectedDate(next);
    setData(undefined);
    setSelectedStop(undefined);
    setIssueStop(undefined);
    setIssueText("");
    setIssueType("Cannot access building");
    setUndoAction(undefined);
    setRetryDispatchRun(undefined);
    setPendingAction(undefined);
    setError("");
    setSyncUnavailable(false);
    setProjectionNeedsMaterialisation(false);
    setSelectedRunId("");
    stopTriggerRef.current = null;
  };

  const loadInContext = async (context: ScopedRequestContext, materialiseMissing = true) => {
    const serviceDate = context.scope;
    const current = () => requests.isCurrent(context);
    const commit = (apply: () => void) => requests.commit(context, apply);
    if (!serviceDate) return;
    return withDataTrace({ app: "logistics", action: fixedVan ? "logistics.mobile.van.load" : "logistics.mobile.day.load", path: typeof window === "undefined" ? "/mobile" : window.location.pathname }, async () => {
      const vehicle = fixedVan || "organisation";
      const vehicleQuery = fixedVan ? `&vehicle=${encodeURIComponent(fixedVan.toLowerCase().replace(" ", ""))}` : "";
      try {
        const headResponse = await fetch(`/api/logistics?syncHead=1&serviceDate=${serviceDate}${vehicleQuery}`, { cache: "no-store", headers: mobileHeaders });
        const head = await headResponse.json().catch(() => null);
        const cacheScope = headResponse.headers.get("x-logistics-cache-scope") || "";
        let cached = cacheScope ? await readCachedProjection(cacheScope, serviceDate, vehicle) : undefined;
        if (cached?.serviceDate !== serviceDate) cached = undefined;
        if (!current()) return;
        if (!headResponse.ok) {
          if (cached) {
            commit(() => {
              projectionSequence.current = cached.lastChangeSequence;
              setData({ ...projectionToDashboardData(cached), projection: { ...cached, state: "STALE" } });
            });
          }
          commit(() => setSyncUnavailable(true));
          throw new LogisticsResponseError(responseErrorDetails(head, headResponse.status, "Logistics sync state could not be checked."));
        }
        if (cached && cached.lastChangeSequence === Number(head.sequence) && cached.state !== "STALE" && cached.state !== "PARTIAL") {
          commit(() => {
            projectionSequence.current = cached.lastChangeSequence;
            setData({ ...projectionToDashboardData(cached), projection: cached });
            setError("");
            setSyncUnavailable(false);
            setProjectionNeedsMaterialisation(false);
          });
          return;
        }
        const body = await loadMobileProjection(serviceDate, vehicleQuery, mobileHeaders);
        if (!current()) return;
        if (!body?.projection) {
          if (body?.projectionState === "VALID_EMPTY" || body?.state === "EMPTY") {
            const empty = { serviceDate, revision: 0, lastChangeSequence: Number(head.sequence || 0), state: "VALID_EMPTY" as const, planningQueue: [], deliveryLoads: [], runs: [], exceptions: [], summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: new Date().toISOString() };
            commit(() => {
              projectionSequence.current = empty.lastChangeSequence;
              setData({ ...projectionToDashboardData(empty), projection: empty });
              setError("");
              setSyncUnavailable(false);
              setProjectionNeedsMaterialisation(false);
            });
            return;
          }
          throw new Error("Logistics projection is unavailable.");
        }
        const projection = body.projection as Parameters<typeof projectionToDashboardData>[0];
        if (projection.serviceDate !== serviceDate) throw new Error("Logistics returned a projection for a different service date.");
        if (cacheScope) await writeCachedProjection(cacheScope, projection, vehicle);
        commit(() => {
          projectionSequence.current = projection.lastChangeSequence;
          setData({ ...projectionToDashboardData(projection), projection });
          setError(body.projectionState === "STALE" ? "Showing a stale Logistics projection; reconciliation is required." : "");
          setSyncUnavailable(body.projectionState === "STALE");
          setProjectionNeedsMaterialisation(false);
        });
      } catch (cause) {
        if (!current()) return;
        const details = cause instanceof LogisticsResponseError ? cause.details : undefined;
        commit(() => {
          setProjectionNeedsMaterialisation(details?.code === "LOGISTICS_PROJECTION_NOT_MATERIALIZED");
          setSyncUnavailable(true);
          setError(cause instanceof LogisticsResponseError ? `${cause.message}${cause.details.requestId ? ` Reference: ${cause.details.requestId}` : ""}` : cause instanceof Error ? cause.message : "Logistics is temporarily unavailable.");
        });
      }
    });
  };
  const loadForContext = (context: ScopedRequestContext | undefined, materialiseMissing = true) => context ? requests.run(context, () => loadInContext(context, materialiseMissing)) : Promise.resolve();
  const load = (materialiseMissing = true) => loadForContext(activeContext.current, materialiseMissing);
  const checkForUpdates = async () => {
    const context = activeContext.current;
    if (!context || document.visibilityState !== "visible") return;
    const key = scopedRequestKey(context);
    const existing = syncCheckInFlight.current.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const vehicleQuery = fixedVan ? `&vehicle=${encodeURIComponent(fixedVan.toLowerCase().replace(" ", ""))}` : "";
      try {
        const response = await fetch(`/api/logistics?syncHead=1&serviceDate=${context.scope}${vehicleQuery}`, { cache: "no-store", headers: mobileHeaders });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new LogisticsResponseError(responseErrorDetails(body, response.status, "Logistics sync state could not be checked."));
        if (!requests.isCurrent(context)) return;
        if (projectionSequence.current === undefined || projectionSequence.current !== Number(body?.sequence || 0)) await loadForContext(context);
        else requests.commit(context, () => setSyncUnavailable(false));
      } catch (cause) {
        if (!requests.isCurrent(context)) return;
        const details = cause instanceof LogisticsResponseError ? cause.details : undefined;
        requests.commit(context, () => {
          setSyncUnavailable(true);
          setError(cause instanceof LogisticsResponseError ? `${cause.message}${details?.requestId ? ` Reference: ${details.requestId}` : ""}` : "Logistics sync state could not be checked.");
        });
      }
    })().finally(() => { if (syncCheckInFlight.current.get(key) === pending) syncCheckInFlight.current.delete(key); });
    syncCheckInFlight.current.set(key, pending);
    return pending;
  };
  useEffect(() => { const nextDate = mobileServiceDate(new URLSearchParams(window.location.search).get("serviceDate")); activeContext.current = requests.activate(nextDate); setSelectedDate(nextDate); setHydrated(true); }, []);
  useEffect(() => { if (selectedDate) void load(); }, [selectedDate]);
  useEffect(() => {
    if (!selectedDate) return;
    const liveChannel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("fika-logistics-live");
    const onLiveChange = (event: MessageEvent<{ serviceDate?: string }>) => { if (!event.data?.serviceDate || event.data.serviceDate === selectedDate) void checkForUpdates(); };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void checkForUpdates(); };
    liveChannel?.addEventListener("message", onLiveChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void checkForUpdates(); }, 30_000);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibilityChange); liveChannel?.removeEventListener("message", onLiveChange); liveChannel?.close(); };
  }, [selectedDate, fixedVan]);
  useEffect(() => {
    if (fixedVan || authority.loading || !authority.vehicles.length) return;
    if (!selectedVehicle || !authority.vehicles.includes(selectedVehicle)) {
      const requested = new URLSearchParams(window.location.search).get("vehicle");
      setSelectedVehicle(authority.vehicles.find(id => id === requested) || authority.vehicles[0]);
    }
  }, [fixedVan, authority.loading, authority.vehicles, selectedVehicle]);
  const vehicleRuns = useMemo(() => authority.vehicles.includes(selectedVehicle as LogisticsVehicleId) ? selectMobileVehicleRuns(visibleData?.runs || [], selectedVehicle, date) : [], [visibleData?.runs, selectedVehicle, date, authority.vehicles]);
  useEffect(() => {
    if (authority.loading || !visibleData) return;
    if (vehicleRuns.some(run => run.canonicalId === selectedRunId)) return;
    const requested = new URLSearchParams(window.location.search).get("run");
    setSelectedRunId(vehicleRuns.find(run => run.canonicalId === requested)?.canonicalId || vehicleRuns[0]?.canonicalId || "");
  }, [vehicleRuns, selectedRunId, authority.loading, visibleData]);
  useEffect(() => {
    if (!selectedDate) return;
    const url = new URL(window.location.href);
    url.searchParams.set("serviceDate", selectedDate);
    if (selectedVehicle && authority.vehicles.includes(selectedVehicle)) url.searchParams.set("vehicle", selectedVehicle);
    if (selectedRunId && vehicleRuns.some(run => run.canonicalId === selectedRunId)) url.searchParams.set("run", selectedRunId);
    else if (visibleData && !authority.loading) url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
  }, [selectedDate, selectedVehicle, selectedRunId, vehicleRuns, visibleData, authority.loading, authority.vehicles]);
  const driver = selectedVehicle ? logisticsVehicleLabel(selectedVehicle) : "Select vehicle";
  const runs = useMemo(() => vehicleRuns.filter(run => run.canonicalId === selectedRunId), [vehicleRuns, selectedRunId]);
  const stops = useMemo(() => runs
    // The dispatcher's saved visiting order (Run.orderedStopIds, already time-ordered for work not yet ordered) is what the driver follows.
    .flatMap((run) => run.orderedStopIds.map((id) => visibleData?.stops.find((stop) => stop.canonicalId === id)).filter(Boolean) as DeliveryStop[]), [runs, visibleData?.stops]);
  const visits = useMemo(() => groupRunVisits(stops), [stops]);
  const selectedVisit = visits.find((visit) => selectedStop && visit.stops.some((lane) => lane.canonicalId === selectedStop.canonicalId));
  // Physical visit numbering: lane stops that share a visit id are ONE visit and show the same number in both tabs.
  const freshness = !visibleData ? "UNAVAILABLE" : syncUnavailable || visibleData.projection?.state === "STALE" || visibleData.projection?.state === "PARTIAL" ? "STALE" : visibleData.projection?.state === "VALID_EMPTY" ? "NO WORK" : "CURRENT";

  const returnFocusToStop = () => window.requestAnimationFrame(() => stopTriggerRef.current?.focus());
  const closeStopSheet = () => { setSelectedStop(undefined); returnFocusToStop(); };
  const closeIssueSheet = () => { setIssueStop(undefined); returnFocusToStop(); };

  async function execute(action: string, stop: DeliveryStop, extra: Record<string, unknown> = {}) {
    const context = activeContext.current;
    if (!context) return;
    if (pendingAction) return;
    const serviceDate = context.scope;
    stop = visibleData?.stops.find(item => item.canonicalId === stop.canonicalId) || stop;
    const run = runs.find((item) => item.canonicalId === stop.runId); if (!run) return;
    requests.commit(context, () => setPendingAction(action));
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json", ...mobileHeaders }, body: JSON.stringify({ action, runId: run.canonicalId, expectedRunVersion: run.version, stopId: stop.canonicalId, expectedStopVersion: stop.version, loadIds: stop.canonicalLoadIds, expectedJobVersions: stop.canonicalJobVersions, expectedLoadVersions: { ...Object.assign({}, ...(visibleData?.projection?.deliveryLoads || []).map(load => load.loadVersions || {})), ...stop.canonicalLoadVersions }, ...extra }) });
      const body = await response.json().catch(() => null); if (!response.ok) { const details = responseErrorDetails(body, response.status, "The operation could not be completed."); requests.commit(context, () => setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`)); return; }
      requests.commit(context, () => { setError(""); setSelectedStop(undefined); setIssueStop(undefined); setIssueText(""); returnFocusToStop(); }); announceDriverChange(serviceDate); await loadForContext(context);
      if (action === "complete-stop" && body?.run && body?.stop) {
        const label = stop.movementType === "collection" ? "Collection marked collected" : "Delivery marked delivered";
        requests.commit(context, () => setUndoAction({ run: body.run, stop: body.stop, label }));
        window.setTimeout(() => requests.commit(context, () => setUndoAction((current) => current?.stop.canonicalId === body.stop.canonicalId ? undefined : current)), 5000);
      }
    } catch (cause) {
      requests.commit(context, () => setError(cause instanceof Error ? cause.message : "The operation could not be completed. Check the connection and retry."));
    } finally {
      requests.commit(context, () => setPendingAction(undefined));
    }
  }
  async function dispatchRun(run: DeliveryRun) {
    const context = activeContext.current;
    if (!context) return;
    const serviceDate = context.scope;
    if (pendingAction) return;
    requests.commit(context, () => setPendingAction("dispatch-run"));
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json", ...mobileHeaders }, body: JSON.stringify({ action: "dispatch-run", runId: run.canonicalId, expectedRunVersion: run.version }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { const details = responseErrorDetails(body, response.status, "The vehicle could not be dispatched."); requests.commit(context, () => { setRetryDispatchRun(run); setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`); }); return; }
      requests.commit(context, () => { setRetryDispatchRun(undefined); setError(""); });
      announceDriverChange(serviceDate); await loadForContext(context);
    } catch (cause) {
      requests.commit(context, () => {
        setRetryDispatchRun(run);
        setError(cause instanceof Error ? cause.message : "The vehicle could not be dispatched. Check the connection and retry.");
      });
    } finally {
      requests.commit(context, () => setPendingAction(undefined));
    }
  }
  async function undoCompletion() {
    const context = activeContext.current;
    if (!context) return;
    const serviceDate = context.scope;
    if (!undoAction) return;
    if (pendingAction) return;
    const current = undoAction;
    requests.commit(context, () => setPendingAction("undo-completion"));
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json", ...mobileHeaders }, body: JSON.stringify({ action: "undo-completion", runId: current.run.canonicalId, expectedRunVersion: current.run.version, stopId: current.stop.canonicalId, expectedStopVersion: current.stop.version, loadIds: current.stop.canonicalLoadIds, expectedJobVersions: current.stop.canonicalJobVersions, expectedLoadVersions: current.stop.canonicalLoadVersions }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { const details = responseErrorDetails(body, response.status, "The completion could not be undone. Refresh and try again."); requests.commit(context, () => setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`)); return; }
      requests.commit(context, () => { setUndoAction(undefined); setError(""); }); announceDriverChange(serviceDate); await loadForContext(context);
    } catch (cause) {
      requests.commit(context, () => setError(cause instanceof Error ? cause.message : "The completion could not be undone. Check the connection and retry."));
    } finally {
      requests.commit(context, () => setPendingAction(undefined));
    }
  }
  async function confirmReturned(run: DeliveryRun) {
    const context = activeContext.current;
    if (!context) return;
    const serviceDate = context.scope;
    if (pendingAction) return;
    requests.commit(context, () => setPendingAction("confirm-returned-to-cpu"));
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json", ...mobileHeaders }, body: JSON.stringify({ action: "confirm-returned-to-cpu", runId: run.canonicalId, expectedRunVersion: run.version }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { const details = responseErrorDetails(body, response.status, "The return could not be confirmed. Refresh and try again."); requests.commit(context, () => setError(`${details.message}${details.requestId ? ` Reference: ${details.requestId}` : ""}`)); return; }
      requests.commit(context, () => setError("")); announceDriverChange(serviceDate); await loadForContext(context);
    } catch (cause) {
      requests.commit(context, () => setError(cause instanceof Error ? cause.message : "The return could not be confirmed. Check the connection and retry."));
    } finally {
      requests.commit(context, () => setPendingAction(undefined));
    }
  }
  const reportIssue = () => { if (issueStop) void execute("report-issue", issueStop, { issueCategory: issueType, issueDescription: issueText.trim() ? `${issueType}: ${issueText.trim()}` : issueType }); };

  if (!hydrated || !selectedDate) return <main className="driver-app"><section className="driver-empty" aria-busy="true">Loading your day…</section></main>;

  return <main className="driver-app">
    <div className={shell.topbar}><button type="button" className={shell.iconButton} aria-label="Open more" onClick={() => setView("more")}>☰</button><p className={shell.brand}>FIKA OS · Driver</p><span aria-hidden="true" /></div>
    <header className={shell.hero} aria-label="Run">
      <div className={shell.vehicleRow}>
        <span className={shell.vehicleField}>{fixedVan && <span className={shell.vehicle}>▣ {driver}</span>}{!fixedVan && <label><span>Vehicle</span><select aria-label="Vehicle" value={selectedVehicle} disabled={Boolean(pendingAction) || authority.loading || Boolean(authority.error)} onChange={(event) => { setSelectedVehicle(event.target.value as LogisticsVehicleId); setSelectedRunId(""); setSelectedStop(undefined); setIssueStop(undefined); setUndoAction(undefined); setRetryDispatchRun(undefined); }}><option value="">Select vehicle</option>{authority.vehicles.map(id => <option key={id} value={id}>{logisticsVehicleLabel(id)}</option>)}</select></label>}</span>
        <span className={`${shell.live} ${freshness === "CURRENT" ? "" : freshness === "STALE" ? shell.stale : shell.offline}`}>● {freshness === "CURRENT" ? "Online" : freshness === "NO WORK" ? "No work" : freshness === "STALE" ? "Stale" : "Offline"}</span>
        <label className={shell.dateField}><span aria-hidden="true">▦</span><select aria-label="Service date" disabled={Boolean(pendingAction)} value={selectedDate} onChange={(event) => selectDate(event.target.value)}>{availableDates.map((option) => <option key={option} value={option}>{formatDate(option)}</option>)}</select></label>
      </div>
      <div className={shell.titleRow}><h1 className={shell.title}>{view === "run" ? "Run" : view === "messages" ? "Messages" : "More"}</h1>{view === "run" && runs[0]?.driverLabel && <span className={shell.subtitle}>{runs[0].driverLabel}</span>}</div>
    </header>
    {authority.error && <div className="driver-alert" role="alert">{authority.error}<button onClick={() => void authority.refresh()}>Retry vehicles</button></div>}{pendingAction && <div className="driver-operation" role="status" aria-live="polite">{operationLabel(pendingAction)} Keep this page open.</div>}{error && <div className="driver-alert" role="alert">{error}<button disabled={Boolean(pendingAction)} onClick={() => retryDispatchRun ? void dispatchRun(retryDispatchRun) : void load(projectionNeedsMaterialisation)}>{retryDispatchRun ? "Retry dispatch" : projectionNeedsMaterialisation ? "Materialise and retry" : "Retry"}</button></div>}
    {!visibleData ? <section className="driver-empty">Loading your day…</section> : view === "messages" ? <Messages messages={messages} onDismiss={(id) => setMessages((current) => current.filter((message) => message.id !== id))} onClear={() => setMessages([])} /> : view === "more" ? <More driver={driver} runs={runs} /> : <>
      {runs.filter((run) => showDispatchChecklist(run.status)).map((run) => { const runStops = stops.filter((stop) => stop.runId === run.canonicalId); const deliveries = runStops.filter((stop) => !stopIsCollection(stop)); const blockers = dispatchBlockers({ hasStops: runStops.length > 0, deliveries, openIssues: runStops.filter(hasOpenIssue).length, unscheduled: runStops.filter((stop) => !hasScheduledTime(stop)).length }); return <RunLoadCheck key={run.canonicalId} deliveries={deliveries} blockers={blockers} pending={Boolean(pendingAction)} pendingLabel="Dispatching…" siteLabel={(stop) => stopLabel(stop, visibleData)} openLabel={(stop) => `Open details for ${stopLabel(stop, visibleData)} delivery`} onOpen={(trigger, stop) => { stopTriggerRef.current = trigger; setSelectedStop(stop); }} onDispatch={() => void dispatchRun(run)} />; })}
      {runs.filter((run) => run.returnToCpuPending).map((run) => <section className="driver-departure return-stage" key={`return-${run.canonicalId}`}><div><p className="driver-section-kicker">ALL STOPS COMPLETE</p><strong>Return to CPU</strong><span>All deliveries and collections are complete. Return the vehicle to CPU to finish the run.</span></div><div className="return-actions"><button className="secondary-action" onClick={() => window.open(process.env.NEXT_PUBLIC_FIKA_CPU_URL || "/", "_blank")}>Navigate to CPU</button><button className="primary-action" disabled={Boolean(pendingAction)} onClick={() => void confirmReturned(run)}>{pendingAction === "confirm-returned-to-cpu" ? "Confirming…" : "Confirm returned to CPU"}</button></div></section>)}
      <RunOverview
        visits={visits}
        siteLabel={(stop) => stopLabel(stop, visibleData)}
        timeLabel={timeFor}
        openLabel={(stop) => `Open details for ${stopLabel(stop, visibleData)} ${stopIsCollection(stop) ? "collection" : "delivery"}`}
        onOpen={(trigger, stop) => { stopTriggerRef.current = trigger; setSelectedStop(stop); }}
      />
    </>}
    <nav className={shell.nav} aria-label="Primary"><NavItem active={view === "run"} icon="▦" label="Run" onClick={() => setView("run")} /><NavItem active={view === "messages"} icon="▢" label="Messages" onClick={() => setView("messages")} badge={messages.length ? String(messages.length) : undefined} /><NavItem active={view === "more"} icon="☰" label="More" onClick={() => setView("more")} /></nav>
    {undoAction && <div className="driver-undo-toast" role="status"><span>{undoAction.label}</span><button disabled={Boolean(pendingAction)} onClick={() => void undoCompletion()}>{pendingAction === "undo-completion" ? "Undoing…" : "Undo"}</button></div>}{selectedStop && visibleData && <StopDetail stop={selectedStop} lanes={selectedVisit?.stops ?? [selectedStop]} visitNumber={selectedVisit?.visitNumber ?? 0} data={visibleData} busy={Boolean(pendingAction)} onClose={closeStopSheet} onAction={execute} onIssue={(lane) => { if (!pendingAction) { setIssueStop(lane); setSelectedStop(undefined); } }} />}{issueStop && <IssueSheet stop={issueStop} type={issueType} setType={setIssueType} text={issueText} setText={setIssueText} busy={Boolean(pendingAction)} onClose={closeIssueSheet} onSubmit={reportIssue} />}
  </main>;
}

function NavItem({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: string; onClick: () => void }) { return <button type="button" className={`${shell.navItem} ${badge ? shell.badge : ""}`} aria-current={active ? "page" : undefined} aria-label={label} onClick={onClick}><span className={shell.navIcon} aria-hidden="true">{icon}</span><span>{label}</span></button>; }
function StopDetail({ stop, lanes, visitNumber, data, busy, onClose, onAction, onIssue }: { stop: DeliveryStop; lanes: DeliveryStop[]; visitNumber: number; data: Data; busy: boolean; onClose: () => void; onAction: (action: string, stop: DeliveryStop, extra?: Record<string, unknown>) => void; onIssue: (lane: DeliveryStop) => void }) {
  const oploc = data.oplocs.find((item) => item.id === stop.locationOplocId);
  const address = oploc?.address || oploc?.label || stop.locationLabelSnapshot;
  const runStatus = data.runs.find((run) => run.canonicalId === stop.runId)?.status;
  const visitState = visitStatusText[groupRunVisits(lanes)[0]?.status ?? "planned"];
  const deliveries = lanes.filter((lane) => !stopIsCollection(lane));
  const collections = lanes.filter((lane) => stopIsCollection(lane));
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className={`stop-detail-sheet ${styles.detail}`} role="dialog" aria-modal="true" aria-labelledby="stop-detail-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); } }}>
    <button ref={closeRef} type="button" className={styles.back} aria-label="Close stop details" onClick={onClose}>← Back to run</button>
    <div className={styles.headRow}><span className={styles.number}>{visitNumber}</span><span className={styles.pill}>{visitState}</span><span className={styles.timePill}>{timeFor(stop)}</span></div>
    <h2 id="stop-detail-title" className={styles.title}>{stopLabel(stop, data)}</h2>
    <p className={styles.address}><span aria-hidden="true">⌖</span> {address}</p>
    <div className={styles.actions}><button type="button" className={`secondary-action navigate-action ${styles.navigate}`} disabled={busy} onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, "_blank")}>View on map</button></div>
    <div className={styles.summary}>
      <div className={styles.summaryCard}><strong>{deliveries.length} {deliveries.length === 1 ? "Delivery" : "Deliveries"}</strong><small>{loadCount(deliveries, data)}</small></div>
      <div className={styles.summaryCard}><strong>{collections.length} {collections.length === 1 ? "Collection" : "Collections"}</strong><small>{collections.length ? "Collect at this stop" : "No collections"}</small></div>
    </div>
    {stop.notes && <div className={styles.notes}><b>Notes</b><p>{stop.notes}</p></div>}
    {lanes.map((lane) => <LaneSection key={lane.canonicalId} lane={lane} data={data} runStatus={runStatus} busy={busy} onAction={onAction} onIssue={onIssue} />)}
  </section></div>;
}
function loadCount(lanes: DeliveryStop[], data: Data) { const count = lanes.reduce((total, lane) => total + loadSubloads(lane, data, movementsForStop(lane, data.movements)[0]).length, 0); return `${count} ${count === 1 ? "load" : "loads"}`; }
function LaneSection({ lane, data, runStatus, busy, onAction, onIssue }: { lane: DeliveryStop; data: Data; runStatus?: DeliveryRun["status"]; busy: boolean; onAction: (action: string, stop: DeliveryStop, extra?: Record<string, unknown>) => void; onIssue: (lane: DeliveryStop) => void }) {
  const movement = movementsForStop(lane, data.movements)[0];
  const collection = stopIsCollection(lane);
  const completed = lane.status === "completed";
  const dispatched = runStatus === "dispatched";
  const subloads = loadSubloads(lane, data, movement);
  const isDelivered = (subload: (typeof subloads)[number]) => lane.status === "completed" || (subload.kind === "requirement" && Boolean((collection ? lane.collectedRequirementIds : lane.deliveredRequirementIds)?.includes(subload.id)));
  const isLoaded = (subload: (typeof subloads)[number]) => lane.loaded === true || (subload.kind === "requirement" && Boolean(lane.loadedRequirementIds?.includes(subload.id)));
  const loadedCount = subloads.filter((subload) => isDelivered(subload) || isLoaded(subload)).length;
  const toggleSubload = (subload: (typeof subloads)[number]) => {
    if (isDelivered(subload)) return;
    const loaded = isLoaded(subload);
    const action = collection ? "mark-subload-collected" : loaded ? "mark-subload-delivered" : "mark-subload-loaded";
    onAction(subload.kind === "requirement" ? action : "mark-stop-loaded", lane, subload.kind === "requirement" ? { requirementId: subload.id, loaded: true } : { loaded: true });
  };
  const openIssues = (lane.issues || []).filter((issue) => issue.status === "open");
  const heading = collection ? "Collections" : "Deliveries";
  return <section className={styles.lane} aria-label={`${collection ? "Collection" : "Delivery"} at this stop`}>
    <div className={styles.laneHead}><h3>{heading} ({subloads.length})</h3>{!collection && !completed && !lane.loaded && (runStatus === "planned" || runStatus === "ready") && <button type="button" className={styles.linkAction} disabled={busy} onClick={() => onAction("mark-stop-loaded", lane, { loaded: true })}>Mark all loaded</button>}</div>
    {subloads.length ? <ul className={styles.loads}>{subloads.map((subload) => { const delivered = isDelivered(subload); const loaded = isLoaded(subload); const label = collection ? delivered ? "Collected" : "Mark collected" : delivered ? "Delivered" : loaded ? "Tap to mark delivered" : "Tap to mark loaded"; const locked = busy || delivered || ((collection || loaded) && !dispatched); return <li key={subload.id}><button type="button" disabled={locked} className={`${styles.load} ${delivered ? styles.loadDone : loaded ? styles.loadLoaded : ""}`} aria-label={`${subload.category}: ${label}`} aria-pressed={delivered} onClick={() => toggleSubload(subload)}><span className={styles.check} aria-hidden="true">{delivered || loaded ? "✓" : ""}</span><span className={styles.loadText}><b>{subload.description}</b><small>{subload.category} · {label}</small></span><strong>{subload.quantity} {subload.unit}</strong></button></li>; })}</ul> : <p className={styles.empty}>No load detail is attached to this {collection ? "collection" : "delivery"}.</p>}
    <p className={styles.loadSummary}>{loadedCount} of {subloads.length} {collection ? "collected" : "loaded"}</p>
    {!completed && !dispatched && <p className={styles.hint}>Dispatch the run before completing this stop.</p>}
    {openIssues.map((issue) => <div className="detail-issue" key={issue.id}>⚠ {issue.description}<button className="secondary-action" disabled={busy} onClick={() => onAction("resolve-issue", lane, { issueId: issue.id })}>Resolve issue</button></div>)}
    <div className={styles.actions}>
      {lane.status === "planned" && dispatched && <button className="secondary-action" disabled={busy} onClick={() => onAction("arrive-stop", lane)}>Mark arrived</button>}
      {completed && lane.canonicalLoadIds && !lane.canUndoCompletion ? <span className={styles.done}>{collection ? "Collection complete" : "Delivery complete"}</span> : completed ? <button className="secondary-action" disabled={busy} onClick={() => onAction("undo-completion", lane)}>{busy ? "Saving…" : collection ? "Undo collection" : "Undo completion"}</button> : <button className={`primary-action ${styles.complete}`} disabled={busy || !dispatched} onClick={() => onAction("complete-stop", lane, { confirmDirect: true })}>{busy ? "Saving…" : collection ? "Mark collection complete" : "Mark stop complete"}</button>}
      <button className="danger-action issue-action" disabled={busy || !dispatched} onClick={() => onIssue(lane)}>Report issue</button>
      {collection && !completed && !lane.canonicalLoadIds && <PostponeCollectionControl disabled={busy} onPostpone={(targetServiceDate) => onAction("defer-collection", lane, { targetServiceDate })} />}
      {collection && !completed && lane.canonicalLoadIds && <p className={styles.empty}>Postponing this collection is unavailable until the future-date workflow is ready.</p>}
    </div>
  </section>;
}
function PostponeCollectionControl({ disabled, onPostpone }: { disabled: boolean; onPostpone: (targetServiceDate: string) => void }) { const [targetDate, setTargetDate] = useState(addDays(operationalDate(), 1)); return <div className="postpone-collection"><label>Postpone collection<select disabled={disabled} value={targetDate} onChange={(event) => setTargetDate(event.target.value)}>{Array.from({ length: 14 }, (_, index) => addDays(operationalDate(), index + 1)).map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</select></label><button className="secondary-action" disabled={disabled} onClick={() => onPostpone(targetDate)}>Postpone collection</button></div>; }
function IssueSheet({ stop, type, setType, text, setText, busy, onClose, onSubmit }: { stop: DeliveryStop; type: string; setType: (value: string) => void; text: string; setText: (value: string) => void; busy: boolean; onClose: () => void; onSubmit: () => void }) { const closeRef = useRef<HTMLButtonElement>(null); useEffect(() => { closeRef.current?.focus(); }, []); return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className="stop-detail-sheet issue-sheet" role="dialog" aria-modal="true" aria-labelledby="issue-sheet-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); } }}><button ref={closeRef} className="sheet-close" aria-label="Close report issue" onClick={onClose}>×</button><p className="driver-section-kicker">REPORT EXCEPTION</p><h2 id="issue-sheet-title">What needs attention?</h2><p className="issue-stop-name">{stop.locationLabelSnapshot}</p><label>Issue type<select disabled={busy} value={type} onChange={(event) => setType(event.target.value)}>{driverIssueTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Notes <span className="optional-label">(optional)</span><textarea disabled={busy} value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a short note for the planner…" rows={4} /></label><button className="danger-action submit-issue" disabled={busy} onClick={onSubmit}>{busy ? "Submitting…" : "Submit issue"}</button></section></div>; }
function Messages({ messages, onDismiss, onClear }: { messages: DriverMessage[]; onDismiss: (id: string) => void; onClear: () => void }) { return <section className="secondary-screen"><div className="messages-heading"><div><p className="driver-section-kicker">INBOX</p><h2>Messages</h2></div>{messages.length > 0 && <button className="clear-messages" onClick={onClear}>Clear all</button>}</div>{messages.length ? messages.map((message) => <article className="message-card" key={message.id}><span>●</span><div><strong>{message.title}</strong><p>{message.body}</p><small>{message.meta}</small></div><button className="dismiss-message" aria-label={`Dismiss ${message.title}`} onClick={() => onDismiss(message.id)}>×</button></article>) : <div className="driver-empty compact">You’re all caught up. No new messages.</div>}</section>; }
function More({ driver, runs }: { driver: string; runs: DeliveryRun[] }) { return <section className="secondary-screen"><p className="driver-section-kicker">ACCOUNT</p><h2>More</h2><div className="more-card"><span>♙</span><div><small>Selected vehicle</small><strong>{driver}</strong></div></div><div className="more-card"><span>▣</span><div><small>Assigned vehicles</small><strong>{runs.map((run) => run.vehicleLabel || "Van").join(" · ") || "No vehicle assigned"}</strong></div></div><a className="planner-return" href="/">Open planner workspace →</a></section>; }
function formatDate(date: string) { return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`)); }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10); }
function dateOptions(startDate = operationalDate()) { const start = new Date(`${startDate}T12:00:00`); return Array.from({ length: 8 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date.toISOString().slice(0, 10); }); }
function timeFor(stop: DeliveryStop) { const planned = stop.plannedWindow; if (planned) return `${planned.startTime}${planned.endTime ? ` – ${planned.endTime}` : ""}`; if (stop.plannedArrivalTime) return stop.plannedArrivalTime; const required = stop.window; return required ? `${required.startTime}${required.endTime ? ` – ${required.endTime}` : ""}` : stop.requiredTime || "Time to confirm"; }
/** Real load totals for one lane stop, from its requirements or the projection; never a placeholder. */
function laneDetail(stop: DeliveryStop, data: Data) {
  const rows = loadSubloads(stop, data);
  if (!rows.length) return itemSummary(stop) || "No load detail";
  const units = new Set(rows.map((row) => row.unit));
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  return `${rows.length} load${rows.length === 1 ? "" : "s"} · ${total} ${units.size === 1 ? [...units][0] : "items"}`;
}
function loadSubloads(stop: DeliveryStop, data: Data, movement?: MovementRequest) {
  const rows = stop.requirementRefs.flatMap((ref) => {
    const requirement = data.requirements.find((item) => item.canonicalId === ref.requirementId);
    if (requirement) {
      const quantity = requirement.lines.reduce((total, line) => total + (Number(line.quantity) || 0), 0);
      const units = new Set(requirement.lines.map((line) => line.unit).filter(Boolean));
      return quantity ? [{ id: ref.requirementId, kind: "requirement" as const, category: requirement.workstream || sourceCategory(requirement.sourceDomain), description: requirement.lines.length === 1 ? requirement.lines[0].displayNameSnapshot : `${requirement.lines.length} items`, quantity, unit: units.size === 1 ? [...units][0] : "pieces" }] : [];
    }
    const job = data.projection?.deliveryLoads.flatMap((load) => load.jobs).find((item) => item.id === ref.requirementId);
    return job?.totalUnits ? [{ id: ref.requirementId, kind: "requirement" as const, category: job.workstream || sourceCategory(job.sourceType), description: job.contents.length === 1 ? job.contents[0].description : `${job.contents.length} items`, quantity: job.totalUnits, unit: "pieces" }] : [];
  });
  if (rows.length) return rows;
  return movement?.items.map((item, index) => ({ id: `${movement.canonicalId}:${index}`, kind: "movement" as const, category: "Movement", description: item.description, quantity: item.quantity, unit: item.unit || "pieces" })) || [];
}
function sourceCategory(source: string) { return fulfilmentWorkstream({ sourceDomain: source }); }
function itemSummary(stop: DeliveryStop) { return stop.requirementRefs.length ? `${stop.requirementRefs.length} load${stop.requirementRefs.length === 1 ? "" : "s"}` : ""; }
function stopLabel(stop: DeliveryStop, data: Data) { return data.oplocs.find((item) => item.id === stop.locationOplocId)?.label || (stop.locationLabelSnapshot.startsWith("oploc:") ? "Operational location" : stop.locationLabelSnapshot); }
function statusLabel(status: DeliveryStop["status"]) { return status === "completed" ? "Complete" : status === "arrived" ? "Current" : status === "issue" ? "Attention" : "Planned"; }
function operationLabel(action: string) { return action === "dispatch-run" ? "Dispatching vehicle…" : action === "confirm-returned-to-cpu" ? "Confirming return…" : action === "report-issue" ? "Submitting issue…" : action === "undo-completion" ? "Undoing completion…" : action === "defer-collection" ? "Postponing collection…" : "Saving update…"; }
