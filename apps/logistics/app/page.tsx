"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import type { CSSProperties, ReactNode, DragEvent, MouseEvent, MutableRefObject } from "react";
import { DayPilotScheduler, DayPilot } from "@daypilot/daypilot-lite-react";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "../lib/types";
import {
  workGroupQueueState,
  movementQueueState,
  hasUsableSchedule,
} from "../lib/planner-read-model";
import type {
  PlannerDay,
  PlannerMovementView,
  PlannerWorkGroup,
  PlannerWeekSummary,
} from "../lib/planner-read-model";
import type { LogisticsDayProjection } from "../lib/types";
import { projectionToDashboardData } from "../lib/projection-dashboard-adapter";
import { operationalDate } from "../lib/date";
import { clientErrorDetails, requireSuccessfulResponse } from "../lib/client-errors";
import { drainIncrementalPages } from "../lib/incremental-sync";
import { readCachedProjection, writeCachedProjection } from "../lib/logistics-cache";
import { fetchPlannerGet } from "../lib/planner-fetch";
import {
  addOperationalDays,
  formatOperationalDate,
  formatWeekRange,
  mondayOf,
  operationalWeek,
} from "../lib/week";

type Oploc = { id: string; label: string };
type Data = {
  requirements: FulfilmentRequirement[];
  runs: DeliveryRun[];
  stops: DeliveryStop[];
  movements: MovementRequest[];
  oplocs: Oploc[];
  serviceDate: string;
  fetchedAt?: string;
  planner: PlannerDay;
  projection?: LogisticsDayProjection;
};
type WeekData = { weekCommencing: string; days: PlannerWeekSummary[] };

function clockMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function addClockMinutes(value: string, amount: number) {
  const total = clockMinutes(value) + amount;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
type Draft = {
  type: "delivery" | "collection" | "transfer";
  from: string;
  fromAddress: string;
  fromOneOff: boolean;
  to: string;
  toAddress: string;
  toOneOff: boolean;
  requiredTime: string;
  start: string;
  end: string;
  description: string;
  quantity: string;
  notes: string;
};
const blank: Draft = {
  type: "delivery",
  from: "",
  fromAddress: "",
  fromOneOff: false,
  to: "",
  toAddress: "",
  toOneOff: false,
  requiredTime: "",
  start: "",
  end: "",
  description: "",
  quantity: "1",
  notes: "",
};

export default function Planner() {
  const [date, setDate] = useState(operationalDate());
  const [weekCommencing, setWeekCommencing] = useState(mondayOf(operationalDate()));
  const [viewPreferencesReady, setViewPreferencesReady] = useState(false);
  const [weekData, setWeekData] = useState<WeekData>();
  const [data, setData] = useState<Data>();
  const emptyProjection = (serviceDate: string): LogisticsDayProjection => ({ serviceDate, revision: 0, lastChangeSequence: 0, planningQueue: [], deliveryLoads: [], runs: [], exceptions: [], summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: new Date().toISOString() });
  const [error, setError] = useState("");
  const [errorReference, setErrorReference] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const requestsBlocked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [planningAttention, setPlanningAttention] = useState<Array<{ serviceDate: string; count: number }>>([]);
  const [showMovement, setShowMovement] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [expandedGroup, setExpandedGroup] = useState<string>();
  const [expandedStop, setExpandedStop] = useState<string>();
  const [inspector, setInspector] = useState<
    | { kind: "group"; id: string }
    | { kind: "movement"; id: string }
    | { kind: "stop"; id: string; runId: string }
    | { kind: "run"; id: string }
  >();
  const [assigning, setAssigning] = useState<string>();
  const [targetRun, setTargetRun] = useState("");
  const [newRunDriverId, setNewRunDriverId] = useState("");
  const [newRunReturnToCpu, setNewRunReturnToCpu] = useState(true);
  const [showRunCreate, setShowRunCreate] = useState(false);
  const [queueFilter, setQueueFilter] = useState<"all" | "unassigned" | "needs_time" | "attention">("all");
  const [queueTypeFilter, setQueueTypeFilter] = useState<"all" | "delivery" | "collection" | "transfer">("all");

  const recordError = (cause: unknown, fallback: string) => {
    const details = clientErrorDetails(cause, fallback);
    if ([401, 403, 503].includes(details.status)) requestsBlocked.current = true;
    if ([401, 403].includes(details.status)) setAuthRequired(true);
    setError(details.message);
    setErrorReference(details.requestId || "");
  };

  useEffect(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("serviceDate");
    let restoredDate = requestedDate || operationalDate();
    try {
      const saved = JSON.parse(window.localStorage.getItem("fika-logistics-view") || "null") as { date?: string; weekCommencing?: string } | null;
      if (!requestedDate && saved?.date) restoredDate = saved.date;
      setDate(restoredDate);
      setWeekCommencing(saved?.weekCommencing || mondayOf(restoredDate));
    } catch {
      setDate(restoredDate);
      setWeekCommencing(mondayOf(restoredDate));
    }
    setViewPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!viewPreferencesReady) return;
    try { window.localStorage.setItem("fika-logistics-view", JSON.stringify({ date, weekCommencing })); } catch { /* Preferences are an optimisation only. */ }
  }, [date, weekCommencing, viewPreferencesReady]);

  const load = async (silent = false) => {
    if (requestsBlocked.current) return;
    if (silent) setRefreshing(true);
    let cached: LogisticsDayProjection | undefined;
    let cacheScope = "";
    try {
      const headResponse = await fetchPlannerGet(`/api/logistics?syncHead=1&serviceDate=${date}`, { cache: "no-store" });
      const head = await requireSuccessfulResponse(headResponse, "Logistics sync state could not be checked.");
      cacheScope = headResponse.headers.get("x-logistics-cache-scope") || "";
      if (cacheScope) {
        cached = await readCachedProjection(cacheScope, date);
        if (cached) { setData({ ...projectionToDashboardData(cached), projection: cached }); }
      }
      if (cached && Number(head.sequence) === cached.lastChangeSequence) {
        setLastUpdated(new Date().toISOString());
        setError("");
        return;
      }
      const response = await fetchPlannerGet(`/api/logistics?projection=1&serviceDate=${date}`, {
        cache: "no-store",
      });
      const body = await requireSuccessfulResponse(response, "Logistics could not be loaded.");
      let projection = body.projection as LogisticsDayProjection | undefined;
      if (!projection && body.state === "EMPTY") {
        projection = emptyProjection(date);
        setData({ ...projectionToDashboardData(projection), projection });
        setLastUpdated(new Date().toISOString());
        setError("");
        return;
      }
      if (!projection) throw new Error("Logistics projection is unavailable.");
      setData({ ...projectionToDashboardData(projection), projection });
      if (cacheScope) await writeCachedProjection(cacheScope, projection);
      setLastUpdated(new Date().toISOString());
      setError("");
      const drained = await drainIncrementalPages(cached?.lastChangeSequence ?? projection.lastChangeSequence, async (cursor) => {
        const changes = await fetchPlannerGet(`/api/logistics?changesSince=${cursor}&serviceDate=${date}`, { cache: "no-store" });
        const changed = await requireSuccessfulResponse(changes, "Logistics changes could not be loaded.");
        return { hasMore: Boolean(changed.hasMore), nextCursor: Number(changed.nextCursor ?? cursor), projection: changed.projection as LogisticsDayProjection | undefined };
      });
      if (drained.latestProjection && drained.latestProjection.lastChangeSequence >= drained.cursor && drained.latestProjection !== projection) {
        setData({ ...projectionToDashboardData(drained.latestProjection), projection: drained.latestProjection });
        if (cacheScope) await writeCachedProjection(cacheScope, drained.latestProjection);
      }
    } catch (cause) {
      recordError(cause, cached ? "Sync failed; showing the last valid Logistics projection." : "Logistics projection could not be loaded.");
    } finally {
      if (silent) setRefreshing(false);
    }
  };
  const loadWeek = async (week = weekCommencing) => {
    if (requestsBlocked.current) return;
    try {
      const body = await fetchPlannerGet(`/api/logistics?weekSummary=1&weekCommencing=${week}`, { cache: "no-store" }).then((response) => requireSuccessfulResponse(response, "Logistics week summary could not be loaded."));
      setWeekData({ weekCommencing: body.weekCommencing as string, days: (body.days || []) as PlannerWeekSummary[] });
    } catch (cause) {
      recordError(cause, "Logistics week data could not be loaded.");
      setWeekData(undefined);
    }
  };
  const ensureVehicleDayRuns = async (serviceDate: string) => {
    if (requestsBlocked.current) return;
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ensure-vehicle-day-runs", serviceDate }) });
      await requireSuccessfulResponse(response, "Vehicle-day runs could not be prepared.");
    } catch (cause) { recordError(cause, "Vehicle-day runs could not be prepared."); }
  };
  useEffect(() => {
    if (!viewPreferencesReady) return;
    const requestedDate = new URLSearchParams(window.location.search).get("serviceDate");
    if (requestedDate && requestedDate !== date) {
      setDate(requestedDate);
      setWeekCommencing(mondayOf(requestedDate));
    }
    // Render the selected day immediately. Vehicle-day provisioning runs in
    // the background and must not trigger a second full dashboard load.
    void load();
    if (!requestsBlocked.current) void ensureVehicleDayRuns(requestedDate || date);
    const liveChannel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("fika-logistics-live");
    const onLiveChange = (event: MessageEvent<{ serviceDate?: string }>) => { if (!event.data?.serviceDate || event.data.serviceDate === date) void load(true); };
    liveChannel?.addEventListener("message", onLiveChange);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !requestsBlocked.current) void load(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !requestsBlocked.current) void load(true);
    }, 15 * 60_000);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibilityChange); liveChannel?.removeEventListener("message", onLiveChange); liveChannel?.close(); };
  }, [date, viewPreferencesReady]);
  useEffect(() => {
    if (!viewPreferencesReady) return;
    void loadWeek();
  }, [weekCommencing, viewPreferencesReady]);
  const checkPlanningAttention = async () => {
    if (requestsBlocked.current || document.visibilityState !== "visible") return;
    try {
      const response = await fetchPlannerGet(`/api/logistics?planningAttention=1&serviceDate=${operationalDate()}&days=14`, { cache: "no-store" });
      const body = await requireSuccessfulResponse(response, "Planning attention could not be checked.");
      setPlanningAttention((body.attention || []) as Array<{ serviceDate: string; count: number }>);
    } catch (cause) { recordError(cause, "Planning attention could not be checked."); }
  };
  useEffect(() => {
    if (!viewPreferencesReady) return;
    void checkPlanningAttention();
    const timer = window.setInterval(() => { void checkPlanningAttention(); }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [viewPreferencesReady]);

  async function act(payload: object): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/logistics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      await requireSuccessfulResponse(response, "Action failed.");
      await load();
      setAssigning(undefined);
      return true;
    } catch (cause) {
      recordError(cause, "Action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const allRuns = data?.planner.runs || [];
  const vehicleRuns = allRuns.filter((run) => run.vehicle === "Van 1" || run.vehicle === "Van 2");
  const runs = vehicleRuns.length ? vehicleRuns : allRuns.slice(0, 2);
  const groups = data?.planner.workGroups || [];
  const movements = data?.planner.movements || [];
  const filteredGroups = queueTypeFilter === "all" || queueTypeFilter === "delivery" ? groups : [];
  const filteredMovements = movements.filter((movement) => queueTypeFilter === "all" || movement.type === queueTypeFilter);
  const createRun = () => {
    setShowRunCreate(false);
    void act({
      action: "create-run",
      run: {
        canonicalId: `run:${date}:${Date.now()}`,
        serviceDate: date,
        status: "draft",
        driverId: newRunDriverId || undefined,
        driverLabel: data?.runs.find((item) => item.driverId === newRunDriverId)?.driverLabel,
        returnToCpuRequired: newRunReturnToCpu,
        orderedStopIds: [],
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        audit: [],
      },
    });
  };
  const assignGroup = (group: PlannerWorkGroup) => {
    if (data?.projection) {
      const jobId = group.requirementRefs[0]?.requirementId;
      if (!jobId) return setError("This projection queue item has no LogisticsJob identity.");
      const scheduledTime = group.deliveryWindow?.startTime || group.requiredTimes[0];
      if (!scheduledTime) return setError("Set a delivery time before assigning this job.");
      void act({ action: "assign-job-to-load", jobId, scheduledTime });
      return;
    }
    const run =
      runs.find((item) => item.runId === targetRun) ||
      (runs.length === 1 ? runs[0] : undefined);
    if (!run) return setError("Choose a target run before assigning work.");
    const eligible = group.requirementRefs.filter(
      (ref) =>
        !ref.runId &&
        (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")),
    );
    if (!eligible.length)
      return setError(
        "There are no currently plannable requirements remaining in this group.",
      );
    void act({
      action: "assign-group",
      runId: run.runId,
      expectedRunVersion: run.version,
      requirementIds: eligible.map((ref) => ref.requirementId),
      expectedSourceVersions: Object.fromEntries(
        eligible.map((ref) => [ref.requirementId, ref.sourceVersion]),
      ),
      ...(group.collectionRequired ? { collectionRequired: true } : {}),
    });
  };
  const assignMovement = (movement: PlannerMovementView) => {
    const run =
      runs.find((item) => item.runId === targetRun) ||
      (runs.length === 1 ? runs[0] : undefined);
    if (!run)
      return setError("Choose a target run before assigning movement work.");
    void act({
      action: "assign",
      runId: run.runId,
      expectedRunVersion: run.version,
      movementId: movement.movementId,
    });
  };
  const createMovement = () => {
    if (
      !draft.description.trim() ||
      Number(draft.quantity) < 1 ||
      (draft.type !== "collection" && !draft.toAddress.trim() && !draft.to) ||
      (draft.type !== "delivery" && !draft.fromAddress.trim() && !draft.from)
    )
      return setError(
        "Choose a governed OPLOC or enter a one-off address for each required endpoint, then add an item with quantity.",
      );
    const now = new Date().toISOString();
    const movement: MovementRequest = {
      canonicalId: `movement:${Date.now()}`,
      entityType: "Movement Request",
      type: draft.type,
      serviceDate: date,
      ...(draft.from ? { fromOplocId: draft.from } : {}),
      ...(draft.fromAddress.trim() ? { fromAddress: draft.fromAddress.trim() } : {}),
      ...(draft.to ? { toOplocId: draft.to } : {}),
      ...(draft.toAddress.trim() ? { toAddress: draft.toAddress.trim() } : {}),
      ...(draft.requiredTime ? { requiredTime: draft.requiredTime } : {}),
      ...(draft.start
        ? {
            window: {
              startTime: draft.start,
              ...(draft.end ? { endTime: draft.end } : {}),
            },
          }
        : {}),
      items: [
        {
          description: draft.description.trim(),
          quantity: Number(draft.quantity),
        },
      ],
      ...(draft.notes ? { notes: draft.notes } : {}),
      createdBy: "Franco",
      status: "open",
      version: 1,
      createdAt: now,
      updatedAt: now,
      audit: [
      ],
    };
    void act({ action: "save-movement", movement }).then(() => {
      setDraft(blank);
      setShowMovement(false);
    });
  };

  return <RealPlanner
    date={date}
    weekCommencing={weekCommencing}
    weekData={weekData}
    data={data}
    error={error}
    errorReference={errorReference}
    authRequired={authRequired}
    onSignInAgain={() => { window.location.assign(process.env.NEXT_PUBLIC_FIKA_HUB_URL || "/"); }}
    setError={setError}
    busy={busy}
    refreshing={refreshing}
    showMovement={showMovement}
    draft={draft}
    showRunCreate={showRunCreate}
    newRunDriverId={newRunDriverId}
    newRunReturnToCpu={newRunReturnToCpu}
    queueFilter={queueFilter}
    queueTypeFilter={queueTypeFilter}
    runs={runs}
    groups={groups}
    movements={movements}
    inspector={inspector}
    assigning={assigning}
    targetRun={targetRun}
    setDate={setDate}
    setWeekCommencing={setWeekCommencing}
    setShowMovement={setShowMovement}
    setDraft={setDraft}
    setShowRunCreate={setShowRunCreate}
    setNewRunDriverId={setNewRunDriverId}
    setNewRunReturnToCpu={setNewRunReturnToCpu}
    setQueueFilter={setQueueFilter}
    setQueueTypeFilter={setQueueTypeFilter}
    setInspector={setInspector}
    setAssigning={setAssigning}
    setTargetRun={setTargetRun}
    load={load}
    act={act}
    createRun={createRun}
    createMovement={createMovement}
    assignGroup={assignGroup}
    assignMovement={assignMovement}
  />;
  return (
    <main className="shell">
      <AppHeader />
      <section className="page-intro">
        <div>
          <p className="eyebrow">Delivery operations</p>
          <h2>Logistics</h2>
          <p>Plan loads by destination, timing and quantity.</p>
        </div>
      </section>
      <nav className="toolbar" aria-label="Logistics actions">
        <WeekNavigation
          weekCommencing={weekCommencing}
          onChange={(next) => {
            setWeekCommencing(next);
            setDate(next);
          }}
        />
      </nav>
      <div className="status-line">
        <span>
          {refreshing
            ? "Refreshing…"
            : lastUpdated
              ? `Last updated ${new Date(lastUpdated!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Waiting for data"}
        </span>
        <Health health={data?.planner.upstreamHealth} />
      </div>
      <WeekStrip
        weekCommencing={weekCommencing}
        selectedDate={date}
        summaries={weekData?.days || []}
        onSelect={setDate}
      />
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {planningAttention.length > 0 && (
        <div className="degraded-note" role="status">
          New or unplanned work needs planning: {planningAttention.map((item) => `${item.serviceDate} (${item.count})`).join(" · ")}
        </div>
      )}
      {showMovement && (
        <MovementForm
          draft={draft}
          setDraft={setDraft}
          oplocs={data?.oplocs || []}
          onClose={() => setShowMovement(false)}
          onSave={createMovement}
          busy={busy}
        />
      )}
      <SelectedDayHeading planner={data?.planner} date={date}>
        <div className="day-actions">
          <button className="secondary" onClick={() => setShowMovement(true)} disabled={!data?.planner.upstreamHealth.oplocs.available}>＋ New movement</button>
          <button className="secondary" onClick={() => void load(true)} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
          <a href={runs.length === 1 ? `/mobile?run=${encodeURIComponent(runs[0].runId)}` : "/mobile"}>Driver view →</a>
          {showRunCreate && <RunCreatePopover driverId={newRunDriverId} setDriverId={setNewRunDriverId} driverOptions={data?.runs || []} returnToCpuRequired={newRunReturnToCpu} setReturnToCpuRequired={setNewRunReturnToCpu} onCreate={createRun} onClose={() => setShowRunCreate(false)} />}
        </div>
      </SelectedDayHeading>
      <div className="control-tower" aria-label="Dispatch control tower">
        <section className="unassigned-queue" aria-label="Unassigned work">
          <PanelHeading eyebrow="Queue" title="Unassigned work" count={`${groups.length + movements.length} items`} />
          <p className="region-intro">Loads waiting for a vehicle, timing or review.</p>
          <div className="queue-filters" role="group" aria-label="Unassigned work filters">
            {(["all", "delivery", "collection", "transfer"] as const).map((filter) => {
              const count = filter === "all" ? groups.length + movements.length : filter === "delivery" ? groups.length + movements.filter((item) => item.type === "delivery").length : movements.filter((item) => item.type === filter).length;
              return <button key={filter} className={queueTypeFilter === filter ? "active" : ""} onClick={() => setQueueTypeFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)} <b>{count}</b></button>;
            })}
          </div>
          {!data && <Empty title="Loading operational work" body="Connecting to upstream work and vehicles." />}
          {data && !data!.planner.upstreamHealth.fulfilment.available && (
            <div className="degraded-note">Upstream work is unavailable. This is not an empty queue; existing schedule data remains readable.</div>
          )}
          {data && groups.length === 0 && movements.length === 0 && (
            <Empty title="No unassigned work" body="Everything currently plannable is on the dispatch timeline." />
          )}
          {filteredGroups.map((group) => (
            <WorkQueueItem
              key={group.groupKey}
              group={group}
              onInspect={() => setInspector({ kind: "group", id: group.groupKey })}
              onAssign={() => {
                setAssigning(group.groupKey);
                setTargetRun(runs.length === 1 ? runs[0].runId : "");
                setInspector({ kind: "group", id: group.groupKey });
              }}
              assigning={assigning === group.groupKey}
              runs={runs}
              targetRun={targetRun}
              setTargetRun={setTargetRun}
              onConfirm={() => assignGroup(group)}
            />
          ))}
          {filteredMovements.map((movement) => (
            <MovementQueueItem
              key={movement.movementId}
              movement={movement}
              onInspect={() => setInspector({ kind: "movement", id: movement.movementId })}
              onAssign={() => {
                setAssigning(movement.movementId);
                setTargetRun(runs.length === 1 ? runs[0].runId : "");
                setInspector({ kind: "movement", id: movement.movementId });
              }}
              assigning={assigning === movement.movementId}
              runs={runs}
              targetRun={targetRun}
              setTargetRun={setTargetRun}
              onConfirm={() => assignMovement(movement)}
            />
          ))}
        </section>
        <section className="dispatch-schedule" aria-label="Dispatch schedule">
          <header className="region-heading">
            <div><p className="eyebrow">Routes</p><h2>Dispatch schedule</h2></div>
            <span>{runs.length} vehicles · {runs.reduce((count, run) => count + run.stopCount, 0)} stops</span>
          </header>
          <div className="schedule-tools">
            <span><i className="legend-dot delivery" /> Delivery</span><span><i className="legend-dot collection" /> Collection</span><span><i className="legend-dot transfer" /> Transfer</span><span><i className="legend-dot attention" /> Attention</span><span><i className="legend-dot unscheduled" /> Unscheduled</span>
            <div className="view-toggle"><button className="active">Day</button><button disabled>Week</button></div>
          </div>
          <p className="region-intro">Time-ordered work by driver. Select a stop or vehicle to inspect it.</p>
          <DriverTimeline
            runs={runs}
            onStop={(runId, stopId) => setInspector({ kind: "stop", id: stopId, runId })}
            onRunInspect={(runId) => setInspector({ kind: "run", id: runId })}
          />
          <ScheduleSummary planner={data?.planner} />
        </section>
      </div>
      {inspector && data && (
        <Inspector
          selection={inspector!}
          planner={data!.planner}
          rawRequirements={data!.requirements}
          rawStops={data!.stops}
          onClose={() => setInspector(undefined)}
          onAction={act}
          runs={runs}
          targetRun={targetRun}
          setTargetRun={setTargetRun}
          assigning={assigning}
          setAssigning={setAssigning}
          onAssignGroup={assignGroup}
          onAssignMovement={assignMovement}
        />
      )}
    </main>
  );
}

type RealPlannerProps = {
  date: string;
  weekCommencing: string;
  weekData?: WeekData;
  data?: Data;
  error: string;
  errorReference: string;
  authRequired: boolean;
  onSignInAgain: () => void;
  setError: (value: string) => void;
  busy: boolean;
  refreshing: boolean;
  showMovement: boolean;
  draft: Draft;
  showRunCreate: boolean;
  newRunDriverId: string;
  newRunReturnToCpu: boolean;
  queueFilter: "all" | "unassigned" | "needs_time" | "attention";
  queueTypeFilter: "all" | "delivery" | "collection" | "transfer";
  runs: PlannerDay["runs"];
  groups: PlannerWorkGroup[];
  movements: PlannerMovementView[];
  inspector?: { kind: "group"; id: string } | { kind: "movement"; id: string } | { kind: "stop"; id: string; runId: string } | { kind: "run"; id: string };
  assigning?: string;
  targetRun: string;
  setDate: (value: string) => void;
  setWeekCommencing: (value: string) => void;
  setShowMovement: (value: boolean) => void;
  setDraft: (value: Draft) => void;
  setShowRunCreate: (value: boolean) => void;
  setNewRunDriverId: (value: string) => void;
  setNewRunReturnToCpu: (value: boolean) => void;
  setQueueFilter: (value: "all" | "unassigned" | "needs_time" | "attention") => void;
  setQueueTypeFilter: (value: "all" | "delivery" | "collection" | "transfer") => void;
  setInspector: (value: RealPlannerProps["inspector"]) => void;
  setAssigning: (value: string | undefined) => void;
  setTargetRun: (value: string) => void;
  load: (silent?: boolean) => Promise<void>;
  act: (payload: object) => Promise<boolean>;
  createRun: () => void;
  createMovement: () => void;
  assignGroup: (group: PlannerWorkGroup) => void;
  assignMovement: (movement: PlannerMovementView) => void;
};

function groupCollectionPending(group: PlannerWorkGroup, runs: PlannerDay["runs"]) {
  if (!group.collectionRequired) return false;
  if (group.groupKey.startsWith("projection-collection:")) {
    const stopId = group.requirementRefs.find((ref) => ref.stopId)?.stopId;
    const stop = stopId ? runs.flatMap((run) => run.stops).find((item) => item.stopId === stopId) : undefined;
    return Boolean(stop && !hasUsableSchedule(stop));
  }
  return group.requirementRefs.some((ref) => {
    if (!ref.runId || !ref.stopId) return false;
    const delivery = runs.find((run) => run.runId === ref.runId)?.stops.find((stop) => stop.stopId === ref.stopId);
    if (!delivery?.linkedStopId || delivery.linkedOperation !== "delivery") return false;
    const collection = runs.flatMap((run) => run.stops).find((stop) => stop.stopId === delivery.linkedStopId);
    return Boolean(collection && !hasUsableSchedule(collection));
  });
}

function RealPlanner(props: RealPlannerProps) {
  const { data, weekData, date, weekCommencing, runs, groups, movements } = props;
  useEffect(() => {
    const selection = props.inspector;
    if (!selection) return;
    if (selection.kind === "group" && !groups.some((group) => group.groupKey === selection.id)) {
      props.setInspector(undefined);
    } else if (selection.kind === "movement" && !movements.some((movement) => movement.movementId === selection.id)) {
      props.setInspector(undefined);
    } else if (selection.kind === "stop" && !runs.some((run) => run.runId === selection.runId && run.stops.some((stop) => stop.stopId === selection.id))) {
      props.setInspector(undefined);
    } else if (selection.kind === "run" && !runs.some((run) => run.runId === selection.id)) {
      props.setInspector(undefined);
    }
  }, [groups, movements, props, runs]);
  const projectionLoadIdsForStop = (stopId: string) => {
    const load = data?.projection?.deliveryLoads.find((item) => [`projection-stop:${item.id}`, `projection-stop:delivery:${item.id}`, `projection-stop:collection:${item.id}`].includes(stopId));
    return load?.loadIds?.length ? load.loadIds : stopId.startsWith("projection-stop:") ? [stopId.slice("projection-stop:".length)] : [];
  };
  const projectionLoadIdForStop = (stopId: string) => stopId.split(":").slice(2).join(":") || stopId.slice("projection-stop:".length);
  const handleInspectorAction = async (payload: object) => {
    const action = payload as { action?: string; runId?: string; stopId?: string; requirementId?: string; plannedArrivalTime?: string; plannedWindow?: { startTime: string; endTime?: string }; loaded?: boolean };
    if (data?.projection && action.stopId?.startsWith("projection-stop:") && action.action === "schedule-stop") {
      const loadIds = projectionLoadIdsForStop(action.stopId);
      const scheduledTime = action.plannedWindow?.startTime || action.plannedArrivalTime;
      if (loadIds.length && scheduledTime && action.runId) {
        for (const loadId of loadIds) await props.act({ action: "reschedule-delivery-load", loadId, scheduledTime, ...(action.plannedWindow?.endTime ? { scheduledEnd: action.plannedWindow.endTime } : {}), targetRunId: action.runId });
      }
      return;
    }
    if (data?.projection && action.action === "unassign-requirement" && action.requirementId) {
      await props.act({ action: "remove-job-from-load", jobId: action.requirementId });
      return;
    }
    if (data?.projection && action.action === "mark-stop-loaded" && action.stopId) {
      const loadIds = projectionLoadIdsForStop(action.stopId);
      if (loadIds.length) {
        for (const loadId of loadIds) await props.act({ action: "mark-delivery-load-loaded", loadId, loaded: action.loaded });
        return;
      }
    }
    if (data?.projection && action.action === "return-stop-to-planning" && action.stopId) {
      const rawStop = data.stops.find((item) => item.canonicalId === action.stopId);
      for (const ref of rawStop?.requirementRefs || []) await props.act({ action: "remove-job-from-load", jobId: ref.requirementId });
      props.setInspector(undefined);
      return;
    }
    if (data?.projection && action.action === "defer-stop" && action.stopId) {
      const rawStop = data.stops.find((item) => item.canonicalId === action.stopId);
      for (const ref of rawStop?.requirementRefs || []) await props.act({ action: "remove-job-from-load", jobId: ref.requirementId });
      props.setInspector(undefined);
      return;
    }
    if (action.action === "return-stop-to-planning" && action.runId && action.stopId) {
      await returnStopToPlanning(action.runId, action.stopId);
      return;
    }
    const succeeded = await props.act(payload);
  };
  const queueStateForGroup = (group: PlannerWorkGroup) => groupCollectionPending(group, runs) ? "needs_time" as const : workGroupQueueState(group, runs);
  const queueStateForMovement = (movement: PlannerMovementView) => movementQueueState(movement, runs);
  const nextAvailableTime = (targetRunId: string, lane: "delivery" | "collection", requested: string, destinationId: string, excludeStopId?: string) => {
    let candidate = requested;
    let changed = true;
    while (changed) {
      changed = false;
      for (const stop of runs.find((run) => run.runId === targetRunId)?.stops || []) {
        if (stop.stopId === excludeStopId || stop.lane !== lane || stop.destination.id === destinationId || !hasUsableSchedule(stop)) continue;
        const start = stop.plannedWindow?.startTime || stop.plannedArrivalTime!;
        const end = stop.plannedWindow?.endTime || addClockMinutes(start, 15);
        if (clockMinutes(candidate) < clockMinutes(end) && clockMinutes(candidate) >= clockMinutes(start)) {
          candidate = end;
          changed = true;
        }
      }
    }
    return candidate;
  };
  const includeState = (state: ReturnType<typeof workGroupQueueState>) => props.queueFilter === "all" || props.queueFilter === state;
  const includeType = (type: "delivery" | "collection" | "transfer") => props.queueTypeFilter === "all" || props.queueTypeFilter === type;
  const filteredGroups = groups.filter((group) => queueStateForGroup(group) !== "scheduled" && includeState(queueStateForGroup(group)) && includeType("delivery"));
  const filteredMovements = movements.filter((movement) => queueStateForMovement(movement) !== "scheduled" && includeState(queueStateForMovement(movement)) && includeType(movement.type));
  const summary = data?.planner.summary;
  const queueGroups = groups.filter((group) => queueStateForGroup(group) !== "scheduled");
  const queueMovements = movements.filter((movement) => queueStateForMovement(movement) !== "scheduled");
  const countFor = (filter: RealPlannerProps["queueFilter"]) => filter === "all" ? queueGroups.length + queueMovements.length : groups.filter((group) => queueStateForGroup(group) === filter).length + movements.filter((movement) => queueStateForMovement(movement) === filter).length;
  const selectedDateLabel = formatOperationalDate(date, { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  const scheduleStop = (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: "delivery" | "collection") => {
    if (data?.projection && stopId.startsWith("projection-stop:")) {
      const loadIds = projectionLoadIdsForStop(stopId);
      if (!loadIds.length || !time) return;
      const collection = stopId.startsWith("projection-stop:collection:");
      const rawStop = data.stops.find((item) => item.canonicalId === stopId);
      const safeTime = nextAvailableTime(targetRunId, collection ? "collection" : "delivery", time, rawStop?.locationOplocId || "", stopId);
      void (async () => { for (const loadId of loadIds) await props.act({ action: "reschedule-delivery-load", loadId: collection ? projectionLoadIdForStop(stopId) : loadId, scheduledTime: safeTime, ...(end ? { scheduledEnd: addClockMinutes(safeTime, Math.max(15, clockMinutes(end) - clockMinutes(time))) } : {}), targetRunId, ...(collection ? { lane: "collection" } : {}) }); })();
      return;
    }
    const sourceRun = runs.find((run) => run.runId === sourceRunId);
    const targetRun = runs.find((run) => run.runId === targetRunId);
    const rawStop = data?.stops.find((item) => item.canonicalId === stopId);
    if (!sourceRun || !targetRun || !rawStop) return;
    const safeTime = nextAvailableTime(targetRunId, lane === "collection" || rawStop.movementType === "collection" ? "collection" : "delivery", time, rawStop.locationOplocId, stopId);
    const timing = end ? { plannedWindow: { startTime: safeTime, endTime: addClockMinutes(safeTime, Math.max(15, clockMinutes(end) - clockMinutes(time))) } } : { plannedArrivalTime: safeTime };
    if (sourceRunId === targetRunId) void props.act({ action: "schedule-stop", runId: sourceRunId, stopId, ...timing, expectedRunVersion: sourceRun.version, expectedStopVersion: rawStop.version });
    else void props.act({ action: "move-stop", runId: sourceRunId, targetRunId, stopId, ...timing, expectedRunVersion: sourceRun.version, expectedTargetRunVersion: targetRun.version, expectedStopVersion: rawStop.version });
  };
  const assignQueueItem = (kind: "group" | "movement", id: string, targetRunId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => {
    if (data?.projection && kind === "group") {
      if (lane === "collection") {
        const loadId = id.startsWith("projection-collection:") ? id.slice("projection-collection:".length) : "";
        if (loadId && time) void props.act({ action: "reschedule-delivery-load", loadId, scheduledTime: time, targetRunId, lane: "collection" });
        return;
      }
      const group = groups.find((item) => item.groupKey === id);
      const jobId = group?.requirementRefs[0]?.requirementId;
      if (!jobId || !time) return;
      const safeTime = nextAvailableTime(targetRunId, "delivery", time, group?.destinationOplocId || "");
      void props.act({ action: "assign-job-to-load", jobId, scheduledTime: safeTime, targetRunId, lane, ...(group?.collectionRequired || collectionRequired ? { collectionRequired: true } : {}) });
      return;
    }
    const run = runs.find((item) => item.runId === targetRunId);
    if (!run) return;
    if (kind === "group") {
      if (lane === "collection") {
        const group = groups.find((item) => item.groupKey === id);
        const delivery = group?.requirementRefs.flatMap((ref) => ref.runId && ref.stopId ? [{ ref, stop: runs.find((run) => run.runId === ref.runId)?.stops.find((stop) => stop.stopId === ref.stopId) }] : []).find((item) => item.stop?.linkedStopId && item.stop.linkedOperation === "delivery");
        const collection = delivery?.stop?.linkedStopId ? runs.flatMap((item) => item.stops.map((stop) => ({ run: item, stop }))).find((item) => item.stop.stopId === delivery.stop!.linkedStopId) : undefined;
        if (!collection || !time) return;
        const rawStop = data?.stops.find((item) => item.canonicalId === collection.stop.stopId);
        if (!rawStop) return;
        const timing = { plannedArrivalTime: time };
        if (collection.run.runId === targetRunId) void props.act({ action: "schedule-stop", runId: targetRunId, stopId: collection.stop.stopId, ...timing, expectedRunVersion: collection.run.version, expectedStopVersion: rawStop.version });
        else void props.act({ action: "move-stop", runId: collection.run.runId, targetRunId, stopId: collection.stop.stopId, ...timing, expectedRunVersion: collection.run.version, expectedTargetRunVersion: run.version, expectedStopVersion: rawStop.version });
        return;
      }
      const group = groups.find((item) => item.groupKey === id);
      if (!group) return;
      const eligible = group.requirementRefs.filter((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")));
      if (!eligible.length) return;
      const safeTime = time ? nextAvailableTime(targetRunId, "delivery", time, group.destinationOplocId) : time;
      void props.act({ action: "assign-group", runId: targetRunId, expectedRunVersion: run.version, requirementIds: eligible.map((ref) => ref.requirementId), expectedSourceVersions: Object.fromEntries(eligible.map((ref) => [ref.requirementId, ref.sourceVersion])), ...(group.collectionRequired || collectionRequired ? { collectionRequired: true } : {}), ...(safeTime ? { plannedArrivalTime: safeTime } : {}) });
    } else {
      const movement = movements.find((item) => item.movementId === id);
      if (!movement || movement.assignedStops.length) return;
      if (lane && movement.type !== lane && !(movement.type === "transfer" && lane === "collection")) return;
      const safeTime = time ? nextAvailableTime(targetRunId, lane === "collection" ? "collection" : "delivery", time, movement.to?.id || movement.from?.id || "") : time;
      void props.act({ action: "assign", runId: targetRunId, expectedRunVersion: run.version, movementId: id, ...(safeTime ? { plannedArrivalTime: safeTime } : {}) });
    }
  };
  const returnStopToPlanning = async (runId: string, stopId: string) => {
    try {
      const response = await fetchPlannerGet(`/api/logistics?serviceDate=${date}`, { cache: "no-store" });
      const current = await response.json() as Data;
      const run = current.runs.find((item) => item.canonicalId === runId);
      const stop = current.stops.find((item) => item.canonicalId === stopId);
      if (!run || !stop) return;
      const succeeded = await props.act({ action: "return-stop-to-planning", runId, stopId, expectedRunVersion: run.version, expectedStopVersion: stop.version });
      if (succeeded) props.setInspector(undefined);
    } catch {
      // The normal planner refresh/error path remains responsible for surfacing read failures.
    }
  };
  const handlePlanningQueueDrop = (event: DragEvent) => {
    event.preventDefault();
    const value = event.dataTransfer.getData("application/x-logistics-stop");
    if (!value) return;
    const [runId, stopId] = value.split("|");
    if (!runId || !stopId) return;
    if (data?.projection && stopId.startsWith("projection-stop:")) {
      const rawStop = data.stops.find((item) => item.canonicalId === stopId);
      if (!rawStop) return;
      void Promise.all(rawStop.requirementRefs.map((ref) => props.act({ action: "remove-job-from-load", jobId: ref.requirementId })));
      return;
    }
    void returnStopToPlanning(runId, stopId);
  };
  useEffect(() => {
    const refresh = () => void props.load(true);
    window.addEventListener("logistics-collection-preference-updated", refresh);
    return () => window.removeEventListener("logistics-collection-preference-updated", refresh);
  }, [props.load]);
  useEffect(() => {
    const hideNativeDragImage = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const drag = event as unknown as DragEvent;
      if (!target?.closest(".stable-stop") || !drag.dataTransfer) return;
      const image = document.createElement("canvas");
      image.width = 1;
      image.height = 1;
      drag.dataTransfer.setDragImage(image, 0, 0);
    };
    document.addEventListener("dragstart", hideNativeDragImage, true);
    return () => document.removeEventListener("dragstart", hideNativeDragImage, true);
  }, []);
  return <main className="mock-tower real-planner">
    <header className="mock-shell">
      <div className="mock-brand"><img src="/brand-assets/logos/fika_logo_white_png.png" alt="FIKA" /><span>OS</span></div>
      <div className="mock-context"><span>Operations workspace</span><strong>Logistics</strong></div><div className="mock-shell-spacer" />
    </header>
    <div className="mock-canvas">
      <section className="mock-heading"><h1>Logistics</h1><p>Plan and dispatch daily deliveries.</p></section>
      <section className="mock-week-nav" aria-label="Operational week navigation"><button aria-label="Previous week" onClick={() => { const next = addOperationalDays(weekCommencing, -7); props.setWeekCommencing(next); props.setDate(next); }}>‹</button><strong>WC {formatWeekRange(weekCommencing)}</strong><button className="mock-this-week" onClick={() => { const next = mondayOf(operationalDate()); props.setWeekCommencing(next); props.setDate(next); }}>This week</button><button aria-label="Next week" onClick={() => { const next = addOperationalDays(weekCommencing, 7); props.setWeekCommencing(next); props.setDate(next); }}>›</button></section>
      <section className="mock-day-cards" aria-label="Operational week">{operationalWeek(weekCommencing).map((day) => { const item = weekData?.days.find((summaryItem) => summaryItem.serviceDate === day); return <button key={day} className={day === date ? "selected" : ""} aria-pressed={day === date} onClick={() => props.setDate(day)}><div className="mock-day-title"><strong>{formatOperationalDate(day, { weekday: "short", day: "numeric", month: "short" })}</strong>{day === date && <b>✓</b>}</div><div className="mock-day-metrics"><span><i className="purple-dot" />{item?.loads || 0} loads</span><span><i className="purple-dot" />{item?.scheduled || 0} scheduled</span><span><i className="green-dot" />{item?.queue || 0} in queue</span><span><i className="blue-dot" />{item?.needsTime || 0} needs time</span><span><i className="red-dot" />{item?.attention || 0} attention</span></div></button>; })}</section>
      <div className="mock-updated">{props.refreshing ? "Refreshing…" : props.data?.fetchedAt ? `Last updated ${new Date(props.data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for data"}<Health health={data?.planner.upstreamHealth} /></div>
      {props.error && <div className="alert" role="alert"><span>{props.error}{props.errorReference && <> <small>Reference: {props.errorReference}</small></>}</span>{props.authRequired && <button className="secondary" onClick={props.onSignInAgain}>Sign in again</button>}</div>}
      {props.showMovement && <MovementForm draft={props.draft} setDraft={props.setDraft} oplocs={data?.oplocs || []} onClose={() => props.setShowMovement(false)} onSave={props.createMovement} busy={props.busy} />}
      <section className="mock-selected-day"><div><span>▣</span><strong>{selectedDateLabel}</strong><small>{summary?.loads || 0} loads · {runs.length} vans &nbsp;·&nbsp; {summary?.scheduledStops || 0} scheduled · {queueGroups.length + queueMovements.length} in queue · {summary?.needsTime || 0} needs time · {summary?.attention || 0} attention</small></div><div className="mock-actions"><button onClick={() => props.setShowMovement(true)} disabled={!data?.planner.upstreamHealth.oplocs.available}>＋ New movement</button><button onClick={() => void props.load(true)} disabled={props.refreshing} aria-busy={props.refreshing}>{props.refreshing ? "Refreshing…" : "↻ Refresh"}</button><a href={runs.length === 1 ? `/mobile?run=${encodeURIComponent(runs[0].runId)}` : "/mobile"}>▦ Driver view</a></div></section>
      {props.showRunCreate && <RunCreatePopover driverId={props.newRunDriverId} setDriverId={props.setNewRunDriverId} driverOptions={props.data?.runs || []} returnToCpuRequired={props.newRunReturnToCpu} setReturnToCpuRequired={props.setNewRunReturnToCpu} onCreate={props.createRun} onClose={() => props.setShowRunCreate(false)} />}
      <section className="mock-workspace">
        <aside className="mock-queue" aria-label="Planning queue" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={handlePlanningQueueDrop}>
          <header><div><span>QUEUE</span><h2>Planning queue <em>({queueGroups.length + queueMovements.length})</em></h2><p className="queue-subtitle">Work still needing assignment, timing or review.</p></div><button className="mock-filter-icon">⌯</button></header>
          <div className="mock-filter-pills" role="tablist" aria-label="Planning queue state">
            <button className={props.queueFilter === "all" ? "active" : ""} onClick={() => props.setQueueFilter("all")}>All <b>{countFor("all")}</b></button>
            <button className={props.queueFilter === "unassigned" ? "active" : ""} onClick={() => props.setQueueFilter("unassigned")}>Unassigned <b>{countFor("unassigned")}</b></button>
            <button className={props.queueFilter === "needs_time" ? "active" : ""} onClick={() => props.setQueueFilter("needs_time")}>Needs time <b>{countFor("needs_time")}</b></button>
            <button className={props.queueFilter === "attention" ? "active" : ""} onClick={() => props.setQueueFilter("attention")}>Attention <b>{countFor("attention")}</b></button>
          </div>
          <div className="mock-secondary-filter"><label>Type <select value={props.queueTypeFilter} onChange={(event) => props.setQueueTypeFilter(event.target.value as RealPlannerProps["queueTypeFilter"])}><option value="all">All work</option><option value="delivery">Delivery</option><option value="collection">Collection</option><option value="transfer">Transfer</option></select></label></div>
          <div className="mock-queue-list">
            {!data && <Empty title="Loading operational work" body="Connecting to upstream work and vehicles." />}
            {data && !data.planner.upstreamHealth.fulfilment.available && <div className="degraded-note">Incoming work is unavailable; existing vehicle schedules remain visible.</div>}
            {data && !filteredGroups.length && !filteredMovements.length && <Empty title="No work in this queue" body="Fully scheduled work stays on the dispatch timeline." />}
            {filteredGroups.map((group) => <RealQueueGroup key={group.groupKey} group={group} runs={runs} queueState={queueStateForGroup(group)} assigning={props.assigning === group.groupKey} targetRun={props.targetRun} onInspect={() => props.setInspector({ kind: "group", id: group.groupKey })} onAssign={() => { props.setAssigning(group.groupKey); props.setTargetRun(runs.length === 1 ? runs[0].runId : ""); props.setInspector({ kind: "group", id: group.groupKey }); }} setTargetRun={props.setTargetRun} onConfirm={() => props.assignGroup(group)} onDragStart={(event) => queueDragStart(event, { kind: "group", id: group.groupKey, label: group.destinationLabel, type: "Delivery", load: group.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ") })} />)}
            {filteredMovements.map((movement) => <RealQueueMovement key={movement.movementId} movement={movement} runs={runs} queueState={queueStateForMovement(movement)} assigning={props.assigning === movement.movementId} targetRun={props.targetRun} onInspect={() => props.setInspector({ kind: "movement", id: movement.movementId })} onAssign={() => { props.setAssigning(movement.movementId); props.setTargetRun(runs.length === 1 ? runs[0].runId : ""); props.setInspector({ kind: "movement", id: movement.movementId }); }} setTargetRun={props.setTargetRun} onConfirm={() => props.assignMovement(movement)} onDragStart={(event) => queueDragStart(event, { kind: "movement", id: movement.movementId, label: movement.to?.label || movement.from?.label || "Movement", type: typeText(movement.type), load: movement.items.map((item) => `${item.quantity} × ${item.description}`).join(" · ") })} />)}
          </div>
        </aside>
        <section className="mock-schedule" aria-label="Dispatch schedule"><header className="mock-schedule-head"><div><span>PLANNING SURFACE · {selectedDateLabel}</span><h2>Dispatch schedule</h2></div><strong>{runs.length} vehicles · {summary?.scheduledStops || 0} scheduled · {summary?.needsTime || 0} needs time</strong></header><div className="mock-legend"><span><i className="green-dot" /> Delivery</span><span><i className="blue-dot" /> Collection</span><span><i className="amber-dot" /> Transfer</span><span><i className="red-dot" /> Attention</span></div><DayPilotTimeline runs={runs} serviceDate={date} onStop={(runId, stopId) => props.setInspector({ kind: "stop", id: stopId, runId })} onSchedule={scheduleStop} onQueueDrop={(kind, id, runId, time, lane, collectionRequired) => assignQueueItem(kind, id, runId, time, lane, collectionRequired)} /><RealScheduleSummary planner={data?.planner} /></section>
      </section>
    </div>
    {props.inspector && data && <Inspector selection={props.inspector} planner={data.planner} projection={data.projection} rawRequirements={data.requirements} rawStops={data.stops} onClose={() => props.setInspector(undefined)} onAction={handleInspectorAction} runs={runs} targetRun={props.targetRun} setTargetRun={props.setTargetRun} assigning={props.assigning} setAssigning={props.setAssigning} onAssignGroup={props.assignGroup} onAssignMovement={props.assignMovement} />}
  </main>;
}

function typeText(type: "delivery" | "collection" | "transfer") { return type[0].toUpperCase() + type.slice(1); }
function typeDirection(type: "delivery" | "collection" | "transfer") { return type === "collection" ? "↑" : type === "transfer" ? "↔" : "↓"; }
function timePosition(time?: string) { if (!time) return undefined; const [hour, minute] = time.split(":").map(Number); return ((hour * 60 + minute - 6 * 60) / (11 * 60)) * 100; }
function snappedTimelineTime(clientX: number, rect: DOMRect) {
  const minutes = Math.max(0, Math.min(11 * 60, Math.round(((clientX - rect.left) / rect.width) * 11 * 60 / 15) * 15));
  return `${String(6 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function queueDragStart(event: DragEvent, payload: { kind: "group" | "movement"; id: string; label: string; type: string; load: string }) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-logistics-queue", JSON.stringify(payload));
  const preview = document.createElement("span");
  preview.className = "drag-preview";
  preview.textContent = `${payload.label} · ${payload.type} · ${payload.load}`;
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 12, 12);
  window.setTimeout(() => preview.remove(), 0);
}
function RealQueueGroup({ group, runs, queueState, assigning, targetRun, onInspect: inspect, onAssign, setTargetRun, onConfirm, onDragStart }: { group: PlannerWorkGroup; runs: PlannerDay["runs"]; queueState: ReturnType<typeof workGroupQueueState>; assigning: boolean; targetRun: string; onInspect: () => void; onAssign: () => void; setTargetRun: (value: string) => void; onConfirm: () => void; onDragStart: (event: DragEvent) => void; }) {
  const eligible = group.requirementRefs.filter((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")));
  const assigned = group.requirementRefs.find((ref) => ref.runId);
  const assignedRun = assigned?.runId ? runs.find((run) => run.runId === assigned.runId) : undefined;
  const collectionPending = groupCollectionPending(group, runs);
  const [collectionRequired, setCollectionRequired] = useState(Boolean(group.collectionRequired));
  useEffect(() => setCollectionRequired(Boolean(group.collectionRequired)), [group.collectionRequired]);
  const saveCollectionRequired = (value: boolean) => { setCollectionRequired(value); void fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set-collection-required", groupKey: group.groupKey, collectionRequired: value }) }).then(() => window.dispatchEvent(new CustomEvent("logistics-collection-preference-updated"))); };
  const onInspect = (event?: MouseEvent) => { if (!event || event.detail === 2) inspect(); };
  const collectionToggle = <label className="collection-toggle" onPointerDown={(event) => event.stopPropagation()}><input type="checkbox" checked={collectionRequired} onChange={(event) => { event.stopPropagation(); saveCollectionRequired(event.target.checked); }} /> Collection required</label>;
  const startDrag = (event: DragEvent) => { onDragStart(event); event.dataTransfer.setData("application/x-logistics-collection-required", String(collectionRequired)); };
  return <article draggable={(queueState === "unassigned" && eligible.length > 0) || collectionPending} onDragStart={(queueState === "unassigned" && eligible.length > 0) || collectionPending ? startDrag : undefined} className={`mock-queue-item queue-${queueState}`}><button className="mock-queue-main" onClick={onInspect}><span className="mock-item-time">Time set on timeline</span><span className="mock-type delivery"><b>↓</b> Delivery</span><strong>{group.destinationLabel}</strong><small>{group.sourceLabels.join(" · ")}</small><span className="mock-load">{group.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ")}</span>{assignedRun && <span className="queue-assignment">Assigned to {assignedRun.driver || "Unassigned"}</span>}{collectionPending && <span className="queue-assignment">Collection outstanding · place in a collection lane</span>}<span className={`mock-state ${group.attention.length ? "attention" : queueState === "needs_time" ? "needs-time" : "ready"}`}>{group.attention.length ? `⚠ ${group.attention[0]}` : collectionPending ? "⚠ Collection time not confirmed" : queueState === "needs_time" ? "⚠ Time not confirmed" : `● ${group.readiness}`}</span></button>{collectionToggle}<div className="mock-queue-actions"><button onClick={onInspect}>Details</button><button disabled={queueState !== "needs_time" && !eligible.length} onClick={queueState === "needs_time" ? onInspect : onAssign}>{queueState === "needs_time" ? "Set time" : group.planningState === "partially_planned" ? "Assign remaining" : "Assign"}</button><b>⁙</b></div>{assigning && queueState !== "needs_time" && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={onConfirm} label={eligible.length === group.requirementCount ? "Assign all" : "Assign eligible"} />}</article>;
}
function RealQueueMovement({ movement, runs, queueState, assigning, targetRun, onInspect: inspect, onAssign, setTargetRun, onConfirm, onDragStart }: { movement: PlannerMovementView; runs: PlannerDay["runs"]; queueState: ReturnType<typeof movementQueueState>; assigning: boolean; targetRun: string; onInspect: () => void; onAssign: () => void; setTargetRun: (value: string) => void; onConfirm: () => void; onDragStart: (event: DragEvent) => void; }) {
  const assigned = movement.assignedStops[0];
  const assignedRun = assigned ? runs.find((run) => run.runId === assigned.runId) : undefined;
  const onInspect = (event?: MouseEvent) => { if (!event || event.detail === 2) inspect(); };
  return <article draggable={queueState === "unassigned"} onDragStart={queueState === "unassigned" ? onDragStart : undefined} className={`mock-queue-item queue-${queueState}`}><button className="mock-queue-main" onClick={onInspect}><span className="mock-item-time">Time set on timeline</span><span className={`mock-type ${movement.type}`}><b>{typeDirection(movement.type)}</b> {typeText(movement.type)}</span><strong>{movement.to?.label || movement.from?.label || "Unknown governed destination"}</strong><small>{movement.from?.label && movement.to ? `${movement.from.label} → ${movement.to.label}` : "Movement"}</small><span className="mock-load">{movement.items.map((item) => `${item.quantity} × ${item.description}`).join(" · ")}</span>{assignedRun && <span className="queue-assignment">Assigned to {assignedRun.driver || "Unassigned"} · {assignedRun.runId.split(":").at(-1) || "Run"}</span>}<span className={`mock-state ${queueState === "needs_time" ? "needs-time" : movement.notes ? "attention" : "ready"}`}>{queueState === "needs_time" ? "⚠ Time not confirmed" : movement.notes ? "⚠ Notes attached" : "● Ready"}</span></button><div className="mock-queue-actions"><button onClick={onInspect}>Details</button><button onClick={queueState === "needs_time" ? onInspect : onAssign}>{queueState === "needs_time" ? "Set time" : "Assign"}</button><b>⁙</b></div>{assigning && queueState !== "needs_time" && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={onConfirm} />}</article>;
}

function LegacyStableTimeline({ runs, serviceDate, onStop, onRun, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", runId: string, targetRunId: string, time?: string) => void; }) {
  const hours = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
  const [zoom, setZoom] = useState(1);
  const [gesture, setGesture] = useState<{ mode: "move" | "resize"; runId: string; stopId: string; start: string; end?: string; pointerId: number }>();
  const [live, setLive] = useState<{ runId: string; stopId: string; start: string; end?: string }>();
  const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
  const endFor = (start: string, value: string) => Math.max(minutes(start) + 15, Math.min(17 * 60, minutes(value)));
  if (!runs.length) return <div className="mock-timeline"><Empty title="No dispatch runs" body="Create a run to start assigning work to a driver." /></div>;
  return <div className="mock-timeline" style={{ "--timeline-scale": zoom } as CSSProperties}>
    <div className="timeline-tools" aria-label="Timeline zoom"><span>Timeline</span><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}>＋</button></div>
    <div className="mock-ruler"><span>Time</span>{hours.map((hour) => <b key={hour}>{hour}</b>)}</div>
    {runs.map((run, index) => <div className="mock-driver-row" key={run.runId}>
      <div className="mock-driver" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId); } }}><b>{(run.driver || "??").slice(0, 2).toUpperCase()}</b><div><strong>{run.vehicle || "Vehicle"}</strong><span>{run.driver || "Select driver"} · <button className="mock-run-link" onClick={() => onRun(run.runId)}>Run {index + 1} · {run.status.toUpperCase()}</button></span><small>{run.scheduledStopCount} scheduled · {run.needsTimeStopCount} needs time</small></div></div>
      <div className="mock-track" onPointerMove={(event) => { if (!gesture || gesture.pointerId !== event.pointerId) return; const snapped = snappedTimelineTime(event.clientX, event.currentTarget.getBoundingClientRect()); if (gesture.mode === "resize") { const endMinutes = endFor(gesture.start, snapped); const end = `${Math.floor(endMinutes / 60).toString().padStart(2, "0")}:${(endMinutes % 60).toString().padStart(2, "0")}`; setLive({ runId: run.runId, stopId: gesture.stopId, start: gesture.start, end }); } else { const endMinutes = gesture.end ? Math.min(17 * 60, minutes(snapped) + minutes(gesture.end) - minutes(gesture.start)) : undefined; const end = endMinutes ? `${Math.floor(endMinutes / 60).toString().padStart(2, "0")}:${(endMinutes % 60).toString().padStart(2, "0")}` : undefined; setLive({ runId: run.runId, stopId: gesture.stopId, start: snapped, end }); } }} onPointerUp={(event) => { if (!gesture || gesture.pointerId !== event.pointerId) return; const final = live || { runId: run.runId, stopId: gesture.stopId, start: gesture.start, end: gesture.end }; onSchedule(run.runId, gesture.stopId, run.runId, final.start, final.end); setGesture(undefined); setLive(undefined); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); const value = event.dataTransfer.getData("application/x-logistics-stop"); const time = snappedTimelineTime(event.clientX, event.currentTarget.getBoundingClientRect()); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId, time); } else if (value) { const [sourceRunId, stopId] = value.split("|"); onSchedule(sourceRunId, stopId, run.runId, time); } }}>
        {hours.map((hour) => <i key={hour} />)}
        {run.stops.filter(hasUsableSchedule).map((stop) => { const sourceStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime!; const sourceEnd = stop.plannedWindow?.endTime; const active = live?.runId === run.runId && live.stopId === stop.stopId ? live : undefined; const start = active?.start || sourceStart; const end = active?.end || sourceEnd; const width = end ? Math.max(1.5, ((minutes(end) - minutes(start)) / (11 * 60)) * 100) : 3; return <button draggable={false} key={stop.stopId} className={`mock-stop ${stop.movementTypes[0] || "delivery"} ${active ? "gesture-active" : ""}`} style={{ left: `${timePosition(start) ?? 0}%`, width: `${width}%` }} onClick={() => onStop(run.runId, stop.stopId)} onPointerDown={(event) => { const target = event.target as HTMLElement; event.preventDefault(); event.stopPropagation(); event.currentTarget.parentElement?.setPointerCapture(event.pointerId); if (target.closest(".resize-handle")) setGesture({ mode: "resize", runId: run.runId, stopId: stop.stopId, start: sourceStart, end: sourceEnd, pointerId: event.pointerId }); else setGesture({ mode: "move", runId: run.runId, stopId: stop.stopId, start: sourceStart, end: sourceEnd, pointerId: event.pointerId }); }}><small>{start}{end ? `–${end}` : ""}</small><strong>{stop.destination.label}</strong><span>{formatWindow(stop.plannedWindow) || "Work"}</span><span className="resize-handle" role="separator" aria-label="Resize planned window" /></button>; })}
      </div>
    </div>)}
  </div>;
}

function DayPilotTimeline({ runs, serviceDate, onStop, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: "delivery" | "collection") => void; onQueueDrop: (kind: "group" | "movement", id: string, runId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => void; }) {
  const [deliveryStart, setDeliveryStart] = useState(6);
  const [collectionStart, setCollectionStart] = useState(12);
  const [zoom, setZoom] = useState(1);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [optimisticSchedules, setOptimisticSchedules] = useState<Record<string, { start: string; end: string }>>({});
  const deliveryControl = useRef<DayPilot.Scheduler | null>(null);
  const collectionControl = useRef<DayPilot.Scheduler | null>(null);
  const lastQueueDrag = useRef<{ lane: "delivery" | "collection"; clientX: number; time: DayPilot.Date; rowId: string } | undefined>(undefined);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("fika-logistics-timeline") || "null") as { deliveryStart?: number; collectionStart?: number; zoom?: number; verticalZoom?: number } | null;
      if (typeof saved?.zoom === "number") setZoom(Math.max(0.5, Math.min(2.5, saved.zoom)));
      if (typeof saved?.verticalZoom === "number") setVerticalZoom(Math.max(0.5, Math.min(2.5, saved.verticalZoom)));
    } catch { /* Preferences are an optimisation only. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem("fika-logistics-timeline", JSON.stringify({ deliveryStart, collectionStart, zoom, verticalZoom })); } catch { /* Preferences are an optimisation only. */ }
  }, [collectionStart, deliveryStart, ready, verticalZoom, zoom]);
  const alignTimeline = (control: DayPilot.Scheduler | null, start: number) => {
    if (!control) return;
    try {
      control.scrollTo(`${serviceDate}T${String(start).padStart(2, "0")}:00:00`);
    } catch {
      // DayPilot can briefly have no viewport while it is updating. The retry
      // below is intentionally guarded so a transient update cannot crash the page.
    }
  };
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const align = (attempt: number) => {
      if (cancelled) return;
      const cellWidth = Math.max(20, Math.round((145 * zoom) / 4));
      try { deliveryControl.current?.update({ scale: "CellDuration", cellDuration: 15, cellWidth, snapToGrid: true }); } catch { /* wait for DayPilot's viewport */ }
      try { collectionControl.current?.update({ scale: "CellDuration", cellDuration: 15, cellWidth, snapToGrid: true }); } catch { /* wait for DayPilot's viewport */ }
      alignTimeline(deliveryControl.current, deliveryStart);
      alignTimeline(collectionControl.current, collectionStart);
      if (attempt < 3) frame = window.requestAnimationFrame(() => align(attempt + 1));
    };
    frame = window.requestAnimationFrame(() => align(0));
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [collectionStart, deliveryStart, serviceDate, zoom]);
  useEffect(() => {
    setOptimisticSchedules((current) => {
      const next = { ...current };
      for (const [stopId, schedule] of Object.entries(current)) {
        const stop = runs.flatMap((run) => run.stops).find((item) => item.stopId === stopId);
        const actualStart = stop?.plannedWindow?.startTime || stop?.plannedArrivalTime;
        const actualEnd = stop?.plannedWindow?.endTime || (actualStart ? addClockMinutes(actualStart, 15) : undefined);
        if (actualStart === schedule.start && actualEnd === schedule.end) delete next[stopId];
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [runs]);
  const time = (value: DayPilot.Date) => value.toString("HH:mm");
  const quarterTime = (value: string) => { const [hour, minute] = value.split(":").map(Number); const total = Math.min(23 * 60 + 45, Math.max(0, Math.round((hour * 60 + minute) / 15) * 15)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };
  const resourceId = (lane: "delivery" | "collection", runId: string) => `${lane}:${runId}`;
  const resourceParts = (value: string) => { const separator = value.indexOf(":"); return { lane: value.slice(0, separator) as "delivery" | "collection", runId: value.slice(separator + 1) }; };
  const resources = (lane: "delivery" | "collection") => runs.map((run, index) => ({ id: resourceId(lane, run.runId), name: run.vehicle || `Van ${index + 1}`, html: `<span class="daypilot-resource"><strong>${run.vehicle || `Van ${index + 1}`}</strong><small>${run.driver || "Select driver"}</small></span>` }));
  const events = (lane: "delivery" | "collection") => runs.flatMap((run) => run.stops.filter((stop) => stop.lane === lane && hasUsableSchedule(stop)).map((stop) => {
    const optimistic = optimisticSchedules[stop.stopId];
    const start = optimistic?.start || stop.plannedWindow?.startTime || stop.plannedArrivalTime!;
    const end = optimistic?.end || stop.plannedWindow?.endTime || addClockMinutes(start, 15);
    return { id: stop.stopId, text: `${stop.destination.label} · ${start}`, start: `${serviceDate}T${start}:00`, end: `${serviceDate}T${end}:00`, resource: resourceId(lane, run.runId), cssClass: `fika-event ${stop.attention.length ? "attention" : ""}`, tags: { runId: run.runId, stopId: stop.stopId, lane } } satisfies DayPilot.EventData;
  }));
  const scheduler = (lane: "delivery" | "collection", start: number, controlRef: React.MutableRefObject<DayPilot.Scheduler | null>) => <DayPilotScheduler controlRef={controlRef} startDate={`${serviceDate}T${String(start).padStart(2, "0")}:00:00`} days={1} scale="CellDuration" cellDuration={15} cellWidth={Math.max(20, Math.round((145 * zoom) / 4))} rowHeaderWidth={108} rowMarginTop={6} rowMarginBottom={6} eventHeight={Math.max(42, Math.round(52 * verticalZoom))} height={Math.max(160, runs.length * Math.round(78 * verticalZoom) + 38)} heightSpec="Auto" timeFormat="Clock24Hours" timeHeaders={[{ groupBy: "Hour", format: "HH:mm" }]} resources={resources(lane)} events={events(lane)} eventMoveHandling="Update" eventResizeHandling="Update" snapToGrid={true} eventTextWrappingEnabled={true} dynamicEventRendering="Disabled" progressiveRowRendering={false} scrollDelayEvents={0} scrollDelayRows={0} onEventClick={(args) => { const tags = args.e.data.tags as { runId: string; stopId: string }; onStop(tags.runId, tags.stopId); }} onEventMoved={(args) => { const tags = args.e.data.tags as { runId: string; stopId: string; lane: "delivery" | "collection" }; const startTime = quarterTime(time(args.newStart)); const endTime = quarterTime(time(args.newEnd)); setOptimisticSchedules((current) => ({ ...current, [tags.stopId]: { start: startTime, end: endTime } })); const target = resourceParts(String(args.newResource)); onSchedule(tags.runId, tags.stopId, target.runId, startTime, endTime, target.lane); }} onEventResized={(args) => { const tags = args.e.data.tags as { runId: string; stopId: string; lane: "delivery" | "collection" }; const startTime = quarterTime(time(args.newStart)); const endTime = quarterTime(time(args.newEnd)); setOptimisticSchedules((current) => ({ ...current, [tags.stopId]: { start: startTime, end: endTime } })); onSchedule(tags.runId, tags.stopId, tags.runId, startTime, endTime, tags.lane); }} onBeforeEventRender={(args) => { const tags = args.data.tags as { runId?: string; stopId?: string; lane?: "delivery" | "collection" } | undefined; const eventLane = tags?.lane || lane; const stopId = tags?.stopId || String(args.data.id); const resource = String(args.data.resource || ""); const runId = tags?.runId || resource.slice(resource.indexOf(":") + 1); args.data.backColor = eventLane === "collection" ? "#f0f8fd" : "#eefaf3"; args.data.borderColor = eventLane === "collection" ? "#218ac3" : "#58bd39"; args.data.fontColor = "#280f8c"; args.data.html = `<strong>${args.data.text}</strong>`; }} />;
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".daypilot-timeline");
    if (!root) return;
    // DayPilot owns movement of timeline events. Nested browser draggable
    // elements compete with it and cause the event to jump while dragging.
    root.querySelectorAll<HTMLElement>(".fika-event-drag-source").forEach((element) => element.removeAttribute("draggable"));
    const allowDrop = (event: Event) => {
      const drag = event as unknown as globalThis.DragEvent;
      if (!drag.dataTransfer?.types.includes("application/x-logistics-queue")) return;
      drag.preventDefault();
      const group = (drag.target as HTMLElement | null)?.closest(".daypilot-group");
      const lane = group === root.querySelector(".daypilot-group") ? "delivery" : "collection";
      const control = lane === "delivery" ? deliveryControl.current : collectionControl.current;
      const coords = control?.getCoords();
      if (coords) lastQueueDrag.current = { lane, clientX: drag.clientX, time: coords.time, rowId: String(coords.row.id) };
    };
    const handleDrop = (event: Event) => {
      const drag = event as unknown as globalThis.DragEvent;
      const value = drag.dataTransfer?.getData("application/x-logistics-queue");
      if (!value) return;
      drag.preventDefault();
      const group = (drag.target as HTMLElement | null)?.closest(".daypilot-group");
      const lane = group === root.querySelector(".daypilot-group") ? "delivery" : "collection";
      const control = lane === "delivery" ? deliveryControl.current : collectionControl.current;
      const coords = control?.getCoords();
      const remembered = lastQueueDrag.current?.lane === lane ? lastQueueDrag.current : undefined;
      if (!coords && !remembered) return;
      const target = resourceParts(remembered?.rowId || String(coords?.row.id));
      // DayPilot's coordinates are already calculated from the current
      // pointer position. Applying a second clientX delta shifted drops twice
      // and was the source of the inaccurate placement.
      const pointerTime = remembered?.time || coords!.time;
      const payload = JSON.parse(value) as { kind: "group" | "movement"; id: string };
      const collectionRequired = drag.dataTransfer?.getData("application/x-logistics-collection-required") === "true";
      onQueueDrop(payload.kind, payload.id, target.runId, quarterTime(time(pointerTime)), lane, collectionRequired);
      lastQueueDrag.current = undefined;
    };
    root.addEventListener("dragover", allowDrop);
    root.addEventListener("drop", handleDrop);
    return () => { root.removeEventListener("dragover", allowDrop); root.removeEventListener("drop", handleDrop); };
  }, [onQueueDrop]);
  const shift = (lane: "delivery" | "collection", amount: number) => { const setter = lane === "delivery" ? setDeliveryStart : setCollectionStart; setter((value) => Math.max(lane === "collection" ? 12 : 6, Math.min(18, value + amount))); };
  if (!runs.length) return <div className="mock-timeline"><Empty title="No vehicles available" body="Vehicles will appear automatically for the selected day." /></div>;
  return <div className="mock-timeline daypilot-timeline"><div className="timeline-tools" aria-label="Timeline controls"><span className="timeline-tools-title">Timeline</span><span className="timeline-tools-label">Horizontal</span><button aria-label="Zoom timeline out" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button><input aria-label="Timeline horizontal zoom" type="range" min="0.5" max="2.5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom timeline in" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}>＋</button><span className="timeline-tools-label">Vertical</span><button aria-label="Zoom rows out" onClick={() => setVerticalZoom((value) => Math.max(0.5, value - 0.25))}>−</button><input aria-label="Zoom rows" type="range" min="0.5" max="2.5" step="0.05" value={verticalZoom} onChange={(event) => setVerticalZoom(Number(event.target.value))} /><span>{Math.round(verticalZoom * 100)}%</span><button aria-label="Zoom rows in" onClick={() => setVerticalZoom((value) => Math.min(2.5, value + 0.25))}>＋</button><button onClick={() => { setZoom(1); setVerticalZoom(1); setDeliveryStart(6); setCollectionStart(12); }}>Fit 6h</button></div><section className="daypilot-group"><header className="stable-section-heading"><strong>DELIVERIES · {String(deliveryStart).padStart(2, "0")}:00</strong><span className="timeline-scroll-controls"><button aria-label="Scroll deliveries earlier" disabled={deliveryStart === 6} onClick={() => shift("delivery", -1)}>←</button><button aria-label="Scroll deliveries later" disabled={deliveryStart === 18} onClick={() => shift("delivery", 1)}>→</button></span></header>{scheduler("delivery", deliveryStart, deliveryControl)}</section><section className="daypilot-group"><header className="stable-section-heading"><strong>COLLECTIONS · {String(collectionStart).padStart(2, "0")}:00</strong><span className="timeline-scroll-controls"><button aria-label="Scroll collections earlier" disabled={collectionStart === 12} onClick={() => shift("collection", -1)}>←</button><button aria-label="Scroll collections later" disabled={collectionStart === 18} onClick={() => shift("collection", 1)}>→</button></span></header>{scheduler("collection", collectionStart, collectionControl)}</section><p className="daypilot-attribution">This scheduler includes DayPilot Lite, licensed under Apache 2.0.</p></div>;
}

function ScrollableRealTimeline({ runs, onStop, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun?: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: "delivery" | "collection") => void; onQueueDrop: (kind: "group" | "movement", runId: string, targetRunId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => void; }) {
  const [deliveryStart, setDeliveryStart] = useState(6);
  const [collectionStart, setCollectionStart] = useState(12);
  const [zoom, setZoom] = useState(1);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [timelinePreferencesReady, setTimelinePreferencesReady] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("fika-logistics-timeline") || "null") as { deliveryStart?: number; collectionStart?: number; zoom?: number; verticalZoom?: number } | null;
      if (typeof saved?.deliveryStart === "number") setDeliveryStart(Math.max(0, Math.min(18, saved.deliveryStart)));
      if (typeof saved?.collectionStart === "number") setCollectionStart(Math.max(12, Math.min(18, saved.collectionStart)));
      if (typeof saved?.zoom === "number") setZoom(Math.max(0.5, Math.min(2.5, saved.zoom)));
      if (typeof saved?.verticalZoom === "number") setVerticalZoom(Math.max(0.5, Math.min(2.5, saved.verticalZoom)));
    } catch { /* Preferences are an optimisation only. */ }
    setTimelinePreferencesReady(true);
  }, []);
  useEffect(() => {
    if (!timelinePreferencesReady) return;
    try { window.localStorage.setItem("fika-logistics-timeline", JSON.stringify({ deliveryStart, collectionStart, zoom, verticalZoom })); } catch { /* Preferences are an optimisation only. */ }
  }, [collectionStart, deliveryStart, timelinePreferencesReady, verticalZoom, zoom]);
  useEffect(() => {
    timelineRef.current?.style.setProperty("--timeline-width", `${400 / zoom}%`);
  }, [zoom]);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const hourWidth = 100 / (6 * zoom);
    for (const [lane, start] of [["delivery", deliveryStart], ["collection", collectionStart]] as const) {
      const viewport = timeline.querySelector<HTMLElement>(`.${lane}-group .stable-lane-viewport`);
      viewport?.style.setProperty("--grid-hour-width", `${hourWidth}%`);
      viewport?.style.setProperty("--grid-offset", `${start * hourWidth}%`);
    }
  }, [collectionStart, deliveryStart, zoom]);
  const move = useCallback((lane: "delivery" | "collection", amount: number) => {
    const setter = lane === "delivery" ? setDeliveryStart : setCollectionStart;
    setter((value) => Math.max(0, Math.min(18, value + amount)));
    const element = timelineRef.current;
    if (element) element.scrollLeft += amount * ((940 * zoom) / 6);
  }, [zoom]);
  const wheelZoomDelta = useRef(0);
  const wheelPanDelta = useRef(0);
  const handleWheel = useCallback((event: WheelEvent) => {
    const horizontalDelta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    const isPinch = event.ctrlKey || event.metaKey;
    const isHorizontalPan = Math.abs(horizontalDelta) > 0 && Math.abs(horizontalDelta) >= Math.abs(event.deltaY);
    const target = event.target as HTMLElement;
    const lane = target.closest(".collection-group") ? "collection" : "delivery";

    // Pro Tools / Premiere-style gesture model: wheel or pinch changes timeline
    // scale, while a horizontal trackpad gesture pans the active lane through
    // the full day. Browsers expose trackpad pinch as ctrl/meta + wheel.
    if (isPinch || !isHorizontalPan) {
      if (isPinch || event.deltaY !== 0) event.preventDefault();
      if (event.deltaY !== 0) {
        wheelZoomDelta.current += event.deltaY;
        const threshold = isPinch ? 45 : 100;
        const steps = Math.trunc(Math.abs(wheelZoomDelta.current) / threshold);
        if (steps > 0) {
          const direction = wheelZoomDelta.current < 0 ? 1 : -1;
          wheelZoomDelta.current %= threshold;
          setZoom((value) => Math.max(0.5, Math.min(2.5, value + direction * 0.1 * steps)));
        }
      }
      return;
    }

    if (horizontalDelta !== 0) {
      event.preventDefault();
      wheelPanDelta.current += horizontalDelta;
      const steps = Math.trunc(Math.abs(wheelPanDelta.current) / 100);
      if (steps > 0) {
        const direction = wheelPanDelta.current > 0 ? 1 : -1;
        wheelPanDelta.current %= 100;
        move(lane, direction * Math.min(steps, 2));
      }
    }
  }, [move]);
  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return;
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);
  const timeLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const group = (lane: "delivery" | "collection", start: number) => <section className={`stable-group ${lane}-group`}><header className="stable-section-heading"><strong>{lane === "delivery" ? "DELIVERIES" : "COLLECTIONS"} · {timeLabel(start)}–{timeLabel(start + 6)}</strong><span className="timeline-scroll-controls"><button aria-label={`Scroll ${lane} earlier`} disabled={start === 0} onClick={() => move(lane, -1)}>←</button><button aria-label={`Scroll ${lane} later`} disabled={start === 18} onClick={() => move(lane, 1)}>→</button></span></header><div className="stable-ruler-viewport"><div className="stable-ruler-canvas" style={{ transform: `translateX(-${(start / 24) * 100}%)` }}><div className={`stable-ruler ${lane}-ruler`}><span aria-hidden="true" />{Array.from({ length: 25 }, (_, hour) => <b key={hour} style={{ "--ruler-position": hour } as CSSProperties}>{timeLabel(hour)}</b>)}</div></div></div>{runs.map((run, index) => <div className="stable-vehicle-row" key={`${lane}-${run.runId}`}><div className="stable-driver"><strong>{run.vehicle || `Van ${index + 1}`}</strong><span>{run.driver || "Select driver"}</span><small>{run.scheduledStopCount} scheduled · {run.needsTimeStopCount} needs time</small></div><div className="stable-lane-viewport"><StableTimelineLane run={run} lane={lane} startHour={start} zoom={zoom} onStop={onStop} onSchedule={onSchedule} onQueueDrop={onQueueDrop} /></div></div>)}</section>;
  if (!runs.length) return <div className="mock-timeline"><Empty title="No vehicles available" body="Vehicles will appear automatically for the selected day." /></div>;
  return <div ref={timelineRef} className="mock-timeline stable-timeline" style={{ "--timeline-scale": zoom, "--timeline-vertical-scale": verticalZoom } as CSSProperties}><div className="timeline-tools" aria-label="Timeline controls"><span className="timeline-tools-title">Timeline</span><span className="timeline-tools-label">Horizontal</span><button aria-label="Zoom timeline out" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button><input aria-label="Timeline horizontal zoom" type="range" min="0.5" max="2.5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom timeline in" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}>＋</button><span className="timeline-tools-label">Vertical</span><button aria-label="Zoom rows out" onClick={() => setVerticalZoom((value) => Math.max(0.5, value - 0.25))}>−</button><input aria-label="Timeline vertical zoom" type="range" min="0.5" max="2.5" step="0.05" value={verticalZoom} onChange={(event) => setVerticalZoom(Number(event.target.value))} /><span>{Math.round(verticalZoom * 100)}%</span><button aria-label="Zoom rows in" onClick={() => setVerticalZoom((value) => Math.min(2.5, value + 0.25))}>＋</button><button onClick={() => { setZoom(1); setVerticalZoom(1); setDeliveryStart(6); setCollectionStart(12); }}>Fit 6h</button></div>{group("delivery", deliveryStart)}{group("collection", collectionStart)}</div>;
}

/* function RealTimeline({ runs, serviceDate, onStop, onRun, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", runId: string, targetRunId: string, time?: string) => void; }) {
  const hours = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
  const [preview, setPreview] = useState<{ runId: string; time: string; end?: string; label: string; overlap: boolean }>();
  const [resize, setResize] = useState<{ runId: string; stopId: string; start: string; pointerId: number }>();
  useEffect(() => {
    const cancelNativeResizeDrag = (event: globalThis.DragEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".resize-handle")) event.preventDefault();
    };
    document.addEventListener("dragstart", cancelNativeResizeDrag, true);
    return () => document.removeEventListener("dragstart", cancelNativeResizeDrag, true);
  }, []);
  useEffect(() => {
    const protectResizePointer = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".resize-handle")) event.preventDefault();
    };
    document.addEventListener("pointerdown", protectResizePointer, true);
    return () => document.removeEventListener("pointerdown", protectResizePointer, true);
  }, []);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const showNow = serviceDate === operationalDate();
  const nowPosition = showNow ? timePosition(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })) : undefined;
  const minutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
  const timeAt = (event: { clientX: number }, element: HTMLElement) => snappedTimelineTime(event.clientX, element.getBoundingClientRect());
  const overlapFor = (run: PlannerDay["runs"][number], stopId: string, start: string, end?: string) => {
    const proposedEnd = minutes(end || start) + (end ? 0 : 15);
    return run.stops.filter((item) => item.stopId !== stopId && hasUsableSchedule(item)).some((item) => {
      const otherStart = minutes(item.plannedWindow?.startTime || item.plannedArrivalTime!);
      const otherEnd = item.plannedWindow?.endTime ? minutes(item.plannedWindow.endTime) : otherStart + 15;
      return minutes(start) < otherEnd && proposedEnd > otherStart;
    });
  };
  const updatePreview = (runId: string, time: string, label: string, stopId?: string, end?: string) => setPreview({ runId, time, end, label, overlap: overlapFor(runs.find((item) => item.runId === runId)!, stopId || "", time, end) });
  const handleDrop = (event: DragEvent, run: PlannerDay["runs"][number], track: HTMLElement) => {
    event.preventDefault();
    const time = timeAt(event, track);
    const queue = event.dataTransfer.getData("application/x-logistics-queue");
    if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId, time); setPreview(undefined); return; }
    const value = event.dataTransfer.getData("application/x-logistics-stop");
    if (!value) return;
    const [sourceRunId, stopId] = value.split("|");
    const sourceStop = runs.flatMap((item) => item.stops).find((item) => item.stopId === stopId);
    const oldStart = sourceStop?.plannedWindow?.startTime || sourceStop?.plannedArrivalTime;
    const oldEnd = sourceStop?.plannedWindow?.endTime;
    const duration = oldEnd && oldStart ? minutes(oldEnd) - minutes(oldStart) : undefined;
    const nextEnd = duration ? `${String(6 + Math.floor(Math.min(11 * 60, minutes(time) - 6 * 60 + duration) / 60)).padStart(2, "0")}:${String((minutes(time) - 6 * 60 + duration) % 60).padStart(2, "0")}` : undefined;
    onSchedule(sourceRunId, stopId, run.runId, time, nextEnd);
    setPreview(undefined);
  };
  if (!runs.length) return <div className="mock-timeline"><Empty title="No dispatch runs" body="Create a run to start assigning work to a driver." /></div>;
  return <div className="mock-timeline" style={{ "--timeline-scale": timelineZoom } as CSSProperties}><div className="timeline-tools" aria-label="Timeline zoom"><span>Timeline</span><button onClick={() => setTimelineZoom((value) => Math.max(1, value - 0.25))} aria-label="Zoom out">−</button><span>{Math.round(timelineZoom * 100)}%</span><button onClick={() => setTimelineZoom((value) => Math.min(2.5, value + 0.25))} aria-label="Zoom in">＋</button></div><div className="mock-ruler"><span>Time</span>{hours.map((hour) => <b key={hour}>{hour}</b>)}</div>{runs.map((run, index) => { const needsTime = run.stops.filter((stop) => !hasUsableSchedule(stop)).length; const scheduled = run.stops.length - needsTime; return <div className="mock-driver-row" key={run.runId}><div className="mock-driver" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId); } event.currentTarget.classList.remove("drop-target"); }}><b>{(run.driver || "??").slice(0, 2).toUpperCase()}</b><div><strong>{run.driver || "Unassigned"}</strong><span><button className="mock-run-link" onClick={() => onRun(run.runId)}>Run {index + 1} · {liveStatusLabel(run.operationalStatus)}</button></span><small>{run.completedStops} / {run.stopCount} stops complete · {run.remainingCollections} collections remaining</small></div></div><div className="mock-track" onPointerMove={(event) => { if (!resize || resize.pointerId !== event.pointerId) return; const end = timeAt(event, event.currentTarget); const validEnd = minutes(end) <= minutes(resize.start) ? resize.start : end; updatePreview(run.runId, resize.start, run.stops.find((item) => item.stopId === resize.stopId)?.destination.label || "Stop", resize.stopId, validEnd); }} onPointerUp={(event) => { if (!resize || resize.pointerId !== event.pointerId) return; const end = timeAt(event, event.currentTarget); if (minutes(end) > minutes(resize.start)) onSchedule(run.runId, resize.stopId, run.runId, resize.start, end); else setPreview(undefined); setResize(undefined); }} onDragOver={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); const value = event.dataTransfer.getData("application/x-logistics-stop"); if (queue) updatePreview(run.runId, timeAt(event, event.currentTarget), "Work"); else if (value) { const [, stopId] = value.split("|"); const stop = runs.flatMap((item) => item.stops).find((item) => item.stopId === stopId); updatePreview(run.runId, timeAt(event, event.currentTarget), stop?.destination.label || "Stop", stopId); } event.currentTarget.classList.add("drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={(event) => { handleDrop(event, run, event.currentTarget); event.currentTarget.classList.remove("drop-target"); }}>{hours.map((hour) => <i key={hour} />)}{nowPosition !== undefined && <i className="mock-now-line" style={{ left: `${nowPosition}%` }} />}{preview?.runId === run.runId && <div className={`timeline-preview ${preview.overlap ? "overlap" : ""}`} style={{ left: `${timePosition(preview.time) ?? 0}%` }}><b>{preview.time}{preview.end ? `–${preview.end}` : ""}</b><span>{preview.label}</span>{preview.overlap && <em>⚠ Overlaps another stop</em>}</div>}{run.stops.filter(hasUsableSchedule).map((stop) => { const time = stop.plannedWindow?.startTime || stop.plannedArrivalTime!; const end = stop.plannedWindow?.endTime; const left = timePosition(time); const width = end ? Math.max(1.5, (minutes(end) - minutes(time)) / (11 * 60) * 100 : 3); return <button draggable={stop.movementTypes.includes("transfer") ? false : true} key={stop.stopId} className={`mock-stop ${stop.movementTypes[0] || "delivery"} ${stop.attention.length ? "attention" : ""} status-${stop.operationalStatus}`} style={{ left: `${left ?? 0}%`, width: `${width}%` }} onDragStart={(event) => { event.dataTransfer.setData("application/x-logistics-stop", `${run.runId}|${stop.stopId}`); }} onClick={() => onStop(run.runId, stop.stopId)} onPointerDown={(event) => { const target = event.target as HTMLElement; if (!target.classList.contains("resize-handle")) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setResize({ runId: run.runId, stopId: stop.stopId, start: time, pointerId: event.pointerId }); }}><small>{time}{end ? `–${end}` : ""}</small><strong>{stop.destination.label}</strong><span>{stopOperationalStatusLabel(stop.operationalStatus)} · {formatWindow(stop.plannedWindow) || stop.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ") || "Work"}</span>{end && <i className="resize-handle" aria-label="Resize planned window" />}</button>; })}</div></div>; })}</div>;
}

*/
function StableTimelineLane({ run, lane, startHour, zoom, onStop: inspectStop, onSchedule, onQueueDrop }: { run: PlannerDay["runs"][number]; lane: "delivery" | "collection"; startHour?: number; zoom: number; onStop: (runId: string, stopId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: "delivery" | "collection") => void; onQueueDrop: (kind: "group" | "movement", id: string, runId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => void; }) {
  const [gesture, setGesture] = useState<{ mode: "move" | "resize"; stopId: string; start: string; end?: string; pointerId: number }>();
  const [live, setLive] = useState<{ start: string; end?: string }>();
  const [dragPreview, setDragPreview] = useState<{ start: string; label: string }>();
  const [draggingStop, setDraggingStop] = useState<{ stopId: string; start: string; valid: boolean }>();
  const origin = 0;
  const span = 24 * 60;
  const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
  const timeAt = (clientX: number, rect: DOMRect) => { const value = origin + ((clientX - rect.left) / rect.width) * span; const snapped = Math.max(origin, Math.min(origin + span, Math.round(value / 15) * 15)); return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`; };
  const updateDragPreview = (event: DragEvent) => {
    const value = event.dataTransfer.getData("application/x-logistics-stop");
    if (!value) return;
    const [, stopId] = value.split("|");
    const stop = run.stops.find((item) => item.stopId === stopId);
    const start = timeAt(event.clientX, event.currentTarget.getBoundingClientRect());
    const sourceLane = event.dataTransfer.getData("application/x-logistics-stop-lane");
    const valid = !sourceLane || sourceLane === lane;
    setDragPreview({ start, label: stop?.destination.label || "Moving job" });
    window.dispatchEvent(new CustomEvent("logistics-drag-time", { detail: { stopId, start, valid } }));
  };
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ stopId: string; start: string; valid: boolean }>).detail;
      if (detail.stopId === draggingStop?.stopId) setDraggingStop(detail);
    };
    const outsideTimeline = (event: Event) => {
      if (!draggingStop) return;
      const drag = event as unknown as DragEvent;
      const target = (drag.target as HTMLElement | null)?.closest(".stable-lane");
      if (!target) {
        window.dispatchEvent(new CustomEvent("logistics-drag-time", { detail: { stopId: draggingStop.stopId, start: draggingStop.start, valid: false } }));
        return;
      }
      const rect = target.getBoundingClientRect();
      const raw = Math.max(0, Math.min(24 * 60, ((drag.clientX - rect.left) / rect.width) * 24 * 60));
      const snapped = Math.round(raw / 15) * 15;
      const start = `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
      const targetLane = target.classList.contains("collection") ? "collection" : "delivery";
      window.dispatchEvent(new CustomEvent("logistics-drag-time", { detail: { stopId: draggingStop.stopId, start, valid: targetLane === lane } }));
    };
    window.addEventListener("logistics-drag-time", update);
    document.addEventListener("dragover", outsideTimeline, true);
    return () => { window.removeEventListener("logistics-drag-time", update); document.removeEventListener("dragover", outsideTimeline, true); };
  }, [draggingStop?.stopId]);
  let lastStopClick: { runId: string; stopId: string; at: number } | undefined;
  const onStop = (runId: string, stopId: string, event?: MouseEvent) => {
    if (event) { if (event.detail === 2) inspectStop(runId, stopId); return; }
    const now = Date.now();
    if (lastStopClick && lastStopClick.runId === runId && lastStopClick.stopId === stopId && now - lastStopClick.at < 350) inspectStop(runId, stopId);
    lastStopClick = { runId, stopId, at: now };
  };
  const stops = run.stops.filter((stop) => stop.lane === lane);
  const visibleStops = stops.filter((stop) => stop.plannedWindow?.startTime || stop.plannedArrivalTime);
  return <div className={`stable-lane ${lane}`} style={{ width: "400%", transform: `translateX(-${((startHour ?? 0) / 24) * 100}%)` }} aria-label={`${run.vehicle || "Vehicle"} ${lane} lane`} onPointerMove={(event) => { if (!gesture || event.pointerId !== gesture.pointerId) return; const snapped = timeAt(event.clientX, event.currentTarget.getBoundingClientRect()); if (gesture.mode === "resize") { const end = Math.max(minutes(gesture.start) + 15, minutes(snapped)); setLive({ start: gesture.start, end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` }); } else { const duration = gesture.end ? minutes(gesture.end) - minutes(gesture.start) : 0; const start = minutes(snapped); const end = duration ? Math.min(origin + span, start + duration) : undefined; setLive({ start: snapped, end: end ? `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` : undefined }); } }} onPointerUp={(event) => { if (!gesture || gesture.pointerId !== event.pointerId) return; const final = live || { start: gesture.start, end: gesture.end }; onSchedule(run.runId, gesture.stopId, run.runId, final.start, final.end); setGesture(undefined); setLive(undefined); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; updateDragPreview(event); }} onDragLeave={() => setDragPreview(undefined)} onDrop={(event) => { event.preventDefault(); const time = timeAt(event.clientX, event.currentTarget.getBoundingClientRect()); const queue = event.dataTransfer.getData("application/x-logistics-queue"); const stopValue = event.dataTransfer.getData("application/x-logistics-stop"); const sourceLane = event.dataTransfer.getData("application/x-logistics-stop-lane"); setDragPreview(undefined); window.dispatchEvent(new CustomEvent("logistics-drag-time", { detail: { stopId: stopValue.split("|")[1], start: time, valid: !sourceLane || sourceLane === lane } })); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; const collectionRequired = event.dataTransfer.getData("application/x-logistics-collection-required") === "true"; onQueueDrop(payload.kind, payload.id, run.runId, time, lane, collectionRequired); } else if (stopValue && (!sourceLane || sourceLane === lane)) { const [sourceRunId, stopId] = stopValue.split("|"); onSchedule(sourceRunId, stopId, run.runId, time); } }}>
    {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
    {dragPreview && <div className={`stable-drag-preview ${draggingStop && !draggingStop.valid ? "invalid" : ""}`} style={{ left: `${(minutes(dragPreview.start) / span) * 100}%` }}><small>{dragPreview.start}</small><strong>{dragPreview.label}</strong></div>}
    {visibleStops.map((stop) => { const sourceStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime!; const sourceEnd = stop.plannedWindow?.endTime; const active = live && gesture?.stopId === stop.stopId ? live : undefined; const dragging = draggingStop?.stopId === stop.stopId ? draggingStop : undefined; const start = active?.start || dragging?.start || sourceStart; const end = active?.end || sourceEnd; const left = Math.max(0, Math.min(100, ((minutes(start) - origin) / span) * 100)); const width = end ? Math.max(4, Math.min(100 - left, ((minutes(end) - minutes(start)) / span) * 100)) : 4; return <button key={stop.stopId} data-stop-id={stop.stopId} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-logistics-stop", `${run.runId}|${stop.stopId}`); event.dataTransfer.setData("application/x-logistics-stop-lane", lane); setDraggingStop({ stopId: stop.stopId, start: sourceStart, valid: true }); setDragPreview({ start: sourceStart, label: stop.destination.label }); setGesture(undefined); setLive(undefined); }} onDragEnd={() => { setDragPreview(undefined); setDraggingStop(undefined); setGesture(undefined); setLive(undefined); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; updateDragPreview(event); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const targetRect = event.currentTarget.parentElement!.getBoundingClientRect(); const time = timeAt(event.clientX, targetRect); const queue = event.dataTransfer.getData("application/x-logistics-queue"); const stopValue = event.dataTransfer.getData("application/x-logistics-stop"); const sourceLane = event.dataTransfer.getData("application/x-logistics-stop-lane"); setDragPreview(undefined); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId, time, lane); } else if (stopValue && (!sourceLane || sourceLane === lane)) { const [sourceRunId, stopId] = stopValue.split("|"); if (sourceRunId && stopId) onSchedule(sourceRunId, stopId, run.runId, time); } }} className={`stable-stop ${lane} ${active ? "gesture-active" : ""} ${dragging && !dragging.valid ? "drag-invalid" : ""} ${stop.attention.length ? "attention" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => onStop(run.runId, stop.stopId)} onPointerDown={(event) => { const isResize = Boolean((event.target as HTMLElement).closest(".resize-handle")); event.stopPropagation(); if (!isResize) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setGesture({ mode: "resize", stopId: stop.stopId, start: sourceStart, end: sourceEnd, pointerId: event.pointerId }); }}><small>{start}{end ? `–${end}` : ""}</small><strong>{stop.destination.label}</strong><span>{lane === "collection" ? "Collection" : "Delivery"}</span><span className="resize-handle" aria-label="Resize planned window" /></button>; })}
  </div>;
}

function RealTimeline({ runs, onStop, onRun, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", runId: string, targetRunId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => void; }) {
  const verticalBase = 1.75;
  const horizontalDefault = 1;
  const horizontalStep = 0.25;
  const verticalStep = verticalBase * 0.25;
  const [zoom, setZoom] = useState(horizontalDefault);
  const [verticalZoom, setVerticalZoom] = useState(verticalBase);
  const hours = (start: number, count: number) => Array.from({ length: count }, (_, index) => start + index);
  if (!runs.length) return <div className="mock-timeline"><Empty title="No vehicles available" body="Vehicles will appear automatically for the selected day." /></div>;
  const renderGroup = (lane: "delivery" | "collection", label: string, start: number) => <section className={`stable-group ${lane}-group`} aria-label={label}><header className="stable-section-heading"><strong>{label}</strong></header><div className={`stable-ruler ${lane}-ruler`}><span aria-hidden="true" />{hours(start, lane === "delivery" ? 13 : 7).map((hour, index) => <b key={hour} style={{ "--ruler-position": index } as CSSProperties}>{String(hour).padStart(2, "0")}:00</b>)}</div>{runs.map((run, index) => <div className="stable-vehicle-row" key={`${lane}-${run.runId}`}><div className="stable-driver"><strong>{run.vehicle || `Van ${index + 1}`}</strong><span>{run.driver || "Select driver"}</span><small>{run.scheduledStopCount} scheduled · {run.needsTimeStopCount} needs time</small></div><StableTimelineLane run={run} lane={lane} zoom={zoom} onStop={onStop} onSchedule={onSchedule} onQueueDrop={onQueueDrop} /></div>)}</section>;
  return <div className="mock-timeline stable-timeline" style={{ "--timeline-scale": zoom, "--timeline-vertical-scale": verticalZoom } as CSSProperties}><div className="timeline-tools" aria-label="Timeline zoom"><span className="timeline-tools-title">Timeline</span><span className="timeline-tools-label">Horizontal</span><button aria-label="Zoom timeline out horizontally" onClick={() => setZoom((value) => Math.max(horizontalDefault * 0.5, value - horizontalStep))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom timeline in horizontally" onClick={() => setZoom((value) => Math.min(2.5, value + horizontalStep))}>＋</button><span className="timeline-tools-label">Vertical</span><button aria-label="Zoom timeline out vertically" onClick={() => setVerticalZoom((value) => Math.max(verticalBase * 0.5, value - verticalStep))}>−</button><span>{Math.round((verticalZoom / verticalBase) * 100)}%</span><button aria-label="Zoom timeline in vertically" onClick={() => setVerticalZoom((value) => Math.min(verticalBase * 2, value + verticalStep))}>＋</button><button aria-label="Reset timeline zoom" onClick={() => { setZoom(horizontalDefault); setVerticalZoom(verticalBase); }}>Reset</button></div>{renderGroup("delivery", "DELIVERIES · 06:00–18:00", 6)}{renderGroup("collection", "COLLECTIONS · 12:00–18:00", 12)}</div>;
}

function VehicleViewportTimeline({ runs, serviceDate, onStop, onRun, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", runId: string, targetRunId: string, time?: string, lane?: "delivery" | "collection") => void; }) {
  const [deliveryStart, setDeliveryStart] = useState(6 * 60);
  const [collectionStart, setCollectionStart] = useState(12 * 60);
  const [deliveryZoom, setDeliveryZoom] = useState(1);
  const [collectionZoom, setCollectionZoom] = useState(1);
  const viewport = (lane: "delivery" | "collection") => lane === "delivery" ? { start: deliveryStart, end: deliveryStart + 11 * 60, zoom: deliveryZoom } : { start: collectionStart, end: collectionStart + 8 * 60, zoom: collectionZoom };
  const timeAt = (event: DragEvent, lane: "delivery" | "collection", element: HTMLElement) => { const view = viewport(lane); const ratio = Math.max(0, Math.min(1, (event.clientX - element.getBoundingClientRect().left) / element.getBoundingClientRect().width)); const minutes = Math.round((view.start + ratio * (view.end - view.start)) / 15) * 15; return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; };
  const ruler = (lane: "delivery" | "collection") => { const view = viewport(lane); return Array.from({ length: lane === "delivery" ? 12 : 9 }, (_, index) => view.start + index * 60); };
  const shift = (lane: "delivery" | "collection", amount: number) => lane === "delivery" ? setDeliveryStart((value) => Math.max(5 * 60, Math.min(8 * 60, value + amount))) : setCollectionStart((value) => Math.max(10 * 60, Math.min(14 * 60, value + amount)));
  const renderLane = (run: PlannerDay["runs"][number], lane: "delivery" | "collection") => { const view = viewport(lane); return <div className={`vehicle-lane mock-track ${lane}`} aria-label={`${run.vehicle || "Vehicle"} ${lane} lane`} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("drop-target"); const queue = event.dataTransfer.getData("application/x-logistics-queue"); const stopValue = event.dataTransfer.getData("application/x-logistics-stop"); const time = timeAt(event, lane, event.currentTarget); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId, time, lane); return; } if (stopValue) { const [sourceRunId, stopId] = stopValue.split("|"); onSchedule(sourceRunId, stopId, run.runId, time); } }}>{ruler(lane).map((value) => <i key={value} />)}{run.stops.filter((stop) => stop.lane === lane && hasUsableSchedule(stop)).map((stop) => { const time = stop.plannedWindow?.startTime || stop.plannedArrivalTime!; const end = stop.plannedWindow?.endTime; const startMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); const left = Math.max(0, Math.min(100, ((startMinutes - view.start) / (view.end - view.start)) * 100)); const width = end ? Math.max(2, ((Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - startMinutes) / (view.end - view.start)) * 100) : 4; return <button key={stop.stopId} draggable onDragStart={(event) => event.dataTransfer.setData("application/x-logistics-stop", `${run.runId}|${stop.stopId}`)} className={`mock-stop ${lane} ${stop.attention.length ? "attention" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => onStop(run.runId, stop.stopId)}><small>{time}{end ? `–${end}` : ""}</small><strong>{stop.destination.label}</strong><span>{lane === "collection" ? "Collection" : "Delivery"}</span><span className="resize-handle" /></button>; })}</div>; };
  if (!runs.length) return <div className="mock-timeline"><Empty title="No dispatch runs" body="Vehicle-day runs will appear automatically." /></div>;
  return <div className="mock-timeline vehicle-timeline"><div className="viewport-toolbar delivery-toolbar"><b>Deliveries</b><span>06:00–17:00 viewport</span><button onClick={() => shift("delivery", -60)} aria-label="Pan deliveries left">←</button><button onClick={() => shift("delivery", 60)} aria-label="Pan deliveries right">→</button><button onClick={() => setDeliveryZoom((value) => Math.max(1, value - .25))} aria-label="Zoom deliveries out">−</button><strong>{Math.round(deliveryZoom * 100)}%</strong><button onClick={() => setDeliveryZoom((value) => Math.min(2.5, value + .25))} aria-label="Zoom deliveries in">＋</button><button onClick={() => { setDeliveryStart(360); setDeliveryZoom(1); }}>Reset</button></div><div className="vehicle-ruler delivery-ruler">{ruler("delivery").map((value) => <b key={value}>{String(Math.floor(value / 60)).padStart(2, "0")}:00</b>)}</div>{runs.map((run, index) => <div className="vehicle-row" key={run.runId}><div className="mock-driver"><b>{(run.driver || "??").slice(0, 2).toUpperCase()}</b><div><strong>{run.vehicle || `Van ${index + 1}`}</strong><span>{run.driver || "Select driver"} · <button className="mock-run-link" onClick={() => onRun(run.runId)}>Run {index + 1} · {run.status.toUpperCase()}</button></span><small>{run.scheduledStopCount} scheduled · {run.needsTimeStopCount} needs time</small></div></div><div className="vehicle-lanes"><div className="lane-label">Deliveries</div>{renderLane(run, "delivery")}<div className="lane-label">Collections</div>{renderLane(run, "collection")}</div></div>)}<div className="viewport-toolbar collection-toolbar"><b>Collections</b><span>12:00–20:00 viewport</span><button onClick={() => shift("collection", -60)} aria-label="Pan collections left">←</button><button onClick={() => shift("collection", 60)} aria-label="Pan collections right">→</button><button onClick={() => setCollectionZoom((value) => Math.max(1, value - .25))} aria-label="Zoom collections out">−</button><strong>{Math.round(collectionZoom * 100)}%</strong><button onClick={() => setCollectionZoom((value) => Math.min(2.5, value + .25))} aria-label="Zoom collections in">＋</button><button onClick={() => { setCollectionStart(720); setCollectionZoom(1); }}>Reset</button></div><div className="vehicle-ruler collection-ruler">{ruler("collection").map((value) => <b key={value}>{String(Math.floor(value / 60)).padStart(2, "0")}:00</b>)}</div></div>;
}

function LegacyTimeline({ runs, serviceDate, onStop, onRun, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", id: string, runId: string, time?: string) => void; }) {
  const hours = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
  const showNow = serviceDate === operationalDate();
  const nowPosition = showNow ? timePosition(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })) : undefined;
  if (!runs.length) return <div className="mock-timeline"><Empty title="No dispatch runs" body="Create a run to start assigning work to a driver." /></div>;
  return <div className="mock-timeline"><div className="mock-ruler"><span>Time</span>{hours.map((hour) => <b key={hour}>{hour}</b>)}</div>{runs.map((run, index) => { const needsTime = run.stops.filter((stop) => !hasUsableSchedule(stop)).length; const scheduled = run.stops.length - needsTime; const queueDrop = (event: DragEvent, time?: string) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); if (!queue) return; const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId, time); event.currentTarget.classList.remove("drop-target"); }; return <div className="mock-driver-row" key={run.runId}><div className="mock-driver" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={(event) => queueDrop(event)}><b>{(run.driver || "??").slice(0, 2).toUpperCase()}</b><div><strong>{run.driver || "Unassigned"}</strong><span><button className="mock-run-link" onClick={() => onRun(run.runId)}>Run {index + 1} · {run.status.toUpperCase()}</button></span><small>{scheduled} scheduled · {needsTime} needs time</small></div></div><div className="mock-track" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId, snappedTimelineTime(event.clientX, event.currentTarget.getBoundingClientRect())); event.currentTarget.classList.remove("drop-target"); return; } const value = event.dataTransfer.getData("application/x-logistics-stop"); if (!value) return; const [sourceRunId, stopId] = value.split("|"); onSchedule(sourceRunId, stopId, run.runId, snappedTimelineTime(event.clientX, event.currentTarget.getBoundingClientRect())); }}>{hours.map((hour) => <i key={hour} />)}{nowPosition !== undefined && <i className="mock-now-line" style={{ left: `${nowPosition}%` }} />}{run.stops.filter(hasUsableSchedule).map((stop) => { const time = stop.plannedWindow?.startTime || stop.plannedArrivalTime!; const left = timePosition(time); return <button draggable={stop.movementTypes.includes("transfer") ? false : true} key={stop.stopId} className={`mock-stop ${stop.movementTypes[0] || "delivery"} ${stop.attention.length ? "attention" : ""}`} style={{ left: `${left ?? 0}%` }} onDragStart={(event) => { event.dataTransfer.setData("application/x-logistics-stop", `${run.runId}|${stop.stopId}`); }} onClick={() => onStop(run.runId, stop.stopId)}><small>{time}</small><strong>{stop.destination.label}</strong><span>{formatWindow(stop.plannedWindow) || stop.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ") || "Work"}</span></button>; })}</div></div>; })}</div>;
}

function RealScheduleSummary({ planner }: { planner?: PlannerDay }) {
  if (!planner) return null;
  const stops = planner.runs.reduce((total, run) => total + run.stopCount, 0);
  const completed = planner.runs.reduce((total, run) => total + run.completedStops, 0);
  const assignedWork = planner.runs.reduce((total, run) => total + run.stops.reduce((count, stop) => count + stop.requirementCount + stop.movementCount, 0), 0);
  const openIssues = planner.runs.reduce((total, run) => total + run.openIssueCount, 0);
  return <footer className="mock-summary"><div><b>▣</b><strong>{planner.runs.length}</strong><span>Vehicles in service</span></div><div><b>⌖</b><strong>{planner.summary.scheduledStops} / {stops}</strong><span>Stops scheduled</span></div><div><b>◇</b><strong>{assignedWork}</strong><span>Assigned work items</span></div><div><b>◷</b><strong>{planner.summary.needsTime}</strong><span>Need time</span></div><div className="attention"><b>!</b><strong>{openIssues + planner.summary.attention}</strong><span>Attention / issues</span></div></footer>;
}


function WeekNavigation({
  weekCommencing,
  onChange,
}: {
  weekCommencing: string;
  onChange: (date: string) => void;
}) {
  const currentWeek = mondayOf(operationalDate());
  return (
    <div className="week-navigation" aria-label="Operational week navigation">
      <button
        aria-label="Previous week"
        onClick={() => onChange(addOperationalDays(weekCommencing, -7))}
      >
        ← Previous week
      </button>
      <strong>WC {formatWeekRange(weekCommencing)}</strong>
      <button
        className={weekCommencing === currentWeek ? "active" : ""}
        onClick={() => onChange(currentWeek)}
      >
        This week
      </button>
      <button
        aria-label="Next week"
        onClick={() => onChange(addOperationalDays(weekCommencing, 7))}
      >
        Next week →
      </button>
    </div>
  );
}

function WorkQueueItem({
  group,
  onInspect,
  onAssign,
  assigning,
  runs,
  targetRun,
  setTargetRun,
  onConfirm,
}: {
  group: PlannerWorkGroup;
  onInspect: () => void;
  onAssign: () => void;
  assigning: boolean;
  runs: PlannerDay["runs"];
  targetRun: string;
  setTargetRun: (value: string) => void;
  onConfirm: () => void;
}) {
  const eligible = group.requirementRefs.filter(
    (ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")),
  );
  return (
    <article className="queue-item" data-testid="unassigned-item">
      <button className="queue-main" onClick={onInspect} aria-label={`Inspect ${group.destinationLabel}`}>
        <span className="queue-time">{formatWindow(group.deliveryWindow) || group.requiredTimes[0] || "Unscheduled"}</span>
        <span className="queue-destination">{group.destinationLabel}</span>
        <span className="queue-type"><b>↓</b> DELIVERY <i>{group.sourceLabels.join(" · ")}</i></span>
        <span className="queue-load">{group.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ") || `${group.requirementCount} jobs`}</span>
        <span className={`queue-state ${group.attention.length ? "attention" : ""}`}>{group.attention.length ? `⚠ ${group.attention[0]}` : group.readiness}</span>
      </button>
      <div className="queue-actions">
        <button className="secondary compact-action" onClick={onInspect}>Details</button>
        <button className="compact-action" onClick={onAssign} disabled={!eligible.length}>{group.planningState === "partially_planned" ? "Assign remaining" : "Assign"}</button>
      </div>
      {assigning && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={onConfirm} label={eligible.length === group.requirementCount ? "Assign all" : "Assign eligible"} />}
    </article>
  );
}

function MovementQueueItem({
  movement,
  onInspect,
  onAssign,
  assigning,
  runs,
  targetRun,
  setTargetRun,
  onConfirm,
}: {
  movement: PlannerMovementView;
  onInspect: () => void;
  onAssign: () => void;
  assigning: boolean;
  runs: PlannerDay["runs"];
  targetRun: string;
  setTargetRun: (value: string) => void;
  onConfirm: () => void;
}) {
  const icon = movement.type === "collection" ? "↑" : movement.type === "transfer" ? "↔" : "↓";
  return (
    <article className="queue-item movement-queue-item" data-testid="unassigned-item">
      <button className="queue-main" onClick={onInspect} aria-label={`Inspect ${movement.type} movement`}>
        <span className="queue-time">{formatWindow(movement.window) || movement.requiredTime || "Unscheduled"}</span>
        <span className="queue-destination">{movement.from?.label || "Origin"}{movement.to ? ` → ${movement.to.label}` : ""}</span>
        <span className="queue-type"><b>{icon}</b> {movement.type.toUpperCase()} <i>Movement</i></span>
        <span className="queue-load">{movement.items.map((item) => `${item.quantity} × ${item.description}`).join(" · ")}</span>
        <span className="queue-state">{movement.notes ? "Notes attached" : "READY"}</span>
      </button>
      <div className="queue-actions">
        <button className="secondary compact-action" onClick={onInspect}>Details</button>
        <button className="compact-action" onClick={onAssign}>Assign</button>
      </div>
      {assigning && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={onConfirm} />}
    </article>
  );
}

function DriverTimeline({
  runs,
  onStop,
  onRunInspect,
}: {
  runs: PlannerDay["runs"];
  onStop: (runId: string, stopId: string) => void;
  onRunInspect: (runId: string) => void;
}) {
  const drivers = Array.from(new Set(runs.map((run) => run.driver || "Unassigned driver")));
  const timed = runs.flatMap((run) => run.stops.map((stop) => stop.window?.startTime || stop.requiredTime).filter(Boolean) as string[]);
  const hours = timed.length ? Math.min(8, ...timed.map((time) => Math.max(0, Number(time.slice(0, 2)) - 1))) : 8;
  const endHour = timed.length ? Math.max(17, ...timed.map((time) => Math.min(23, Number(time.slice(0, 2)) + 2))) : 17;
  const ruler = Array.from({ length: endHour - hours + 1 }, (_, index) => hours + index);
  if (!runs.length) return <Empty title="No dispatch runs" body="Create a run to start assigning work to a driver." />;
  return (
    <div className="timeline-shell">
      <div className="timeline-ruler"><span>DRIVER / RUN</span>{ruler.map((hour) => <b key={hour}>{String(hour).padStart(2, "0")}:00</b>)}</div>
      {drivers.map((driver) => {
        const driverRuns = runs.filter((run) => (run.driver || "Unassigned driver") === driver);
        return <div className="driver-row" key={driver}>
          <div className="driver-label"><strong>{driver}</strong><span>{driverRuns.reduce((count, run) => count + run.stopCount, 0)} stops</span></div>
          <div className="driver-track" style={{ ["--timeline-columns" as string]: ruler.length } as CSSProperties}>
            {ruler.map((hour) => <i key={hour} style={{ gridColumn: hour - hours + 1 }} />)}
            {driverRuns.map((run, runIndex) => <div className="run-band" key={run.runId}>
              <button className="run-band-label" onClick={() => onRunInspect(run.runId)}>Run {runIndex + 1} · {run.status.toUpperCase()} · {run.stopCount} stops</button>
              <div className="run-stops">
                {run.stops.filter((stop) => !stop.window?.startTime && !stop.requiredTime).length > 0 && <button className="unscheduled-chip" onClick={() => onRunInspect(run.runId)}>UNSCHEDULED · {run.stops.filter((stop) => !stop.window?.startTime && !stop.requiredTime).length}</button>}
                {run.stops.filter((stop) => stop.window?.startTime || stop.requiredTime).map((stop) => {
                  const time = stop.window?.startTime || stop.requiredTime!;
                  const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
                  const left = Math.max(0, ((start - hours * 60) / 60) * (100 / Math.max(1, ruler.length - 1)));
                  const width = Math.max(9, (100 / Math.max(1, ruler.length - 1)) * (stop.window?.endTime ? Math.max(0.35, (Number(stop.window.endTime.slice(0, 2)) * 60 + Number(stop.window.endTime.slice(3, 5)) - start) / 60) : 0.75));
                  const movement = stop.movementTypes[0];
                  return <button className={`timeline-stop ${stop.attention.length ? "has-attention" : ""}`} key={stop.stopId} style={{ left: `${left}%`, width: `${Math.min(width, 28)}%` }} onClick={() => onStop(run.runId, stop.stopId)}>
                    <small>{time}</small><strong>{stop.destination.label}</strong><span>{movement === "collection" ? "↑ Collection" : movement === "transfer" ? "↔ Transfer" : "↓ Delivery"}</span>
                  </button>;
                })}
              </div>
            </div>)}
          </div>
        </div>;
      })}
    </div>
  );
}

function Inspector({
  selection,
  planner,
  projection,
  rawRequirements,
  rawStops,
  onClose,
  onAction,
  runs,
  targetRun,
  setTargetRun,
  assigning,
  setAssigning,
  onAssignGroup,
  onAssignMovement,
}: {
  selection: { kind: "group"; id: string } | { kind: "movement"; id: string } | { kind: "stop"; id: string; runId: string } | { kind: "run"; id: string };
  planner: PlannerDay;
  projection?: LogisticsDayProjection;
  rawRequirements: FulfilmentRequirement[];
  rawStops: DeliveryStop[];
  onClose: () => void;
  onAction: (payload: object) => void;
  runs: PlannerDay["runs"];
  targetRun: string;
  setTargetRun: (value: string) => void;
  assigning?: string;
  setAssigning: (value: string | undefined) => void;
  onAssignGroup: (group: PlannerWorkGroup) => void;
  onAssignMovement: (movement: PlannerMovementView) => void;
}) {
  const group = selection.kind === "group" ? planner.workGroups.find((item) => item.groupKey === selection.id) : undefined;
  const movement = selection.kind === "movement" ? planner.movements.find((item) => item.movementId === selection.id) : undefined;
  const run = selection.kind === "run" ? planner.runs.find((item) => item.runId === selection.id) : undefined;
  const stop = selection.kind === "stop" ? planner.runs.flatMap((item) => item.stops).find((item) => item.stopId === selection.id) : undefined;
  const rawStop = stop ? rawStops.find((item) => item.canonicalId === stop.stopId) : undefined;
  const stopTitle = stop ? `${stop.destination.label} · ${stop.plannedWindow?.startTime || stop.plannedArrivalTime || "Time to confirm"}` : undefined;
  return <aside className="mock-inspector" aria-label="Details inspector">
    <header><div><p className="eyebrow">Inspector</p><h2>{group?.destinationLabel || movement?.type || stopTitle || run?.driver || "Details"}</h2></div><button className="close" onClick={onClose} aria-label="Close inspector">×</button></header>
    {group && <>
      <InspectorMeta label="Timing" value={formatWindow(group.deliveryWindow) || group.requiredTimes[0] || "Unscheduled"} />
      <label className="collection-toggle inspector-collection-toggle"><input type="checkbox" checked={Boolean(group.collectionRequired)} onChange={(event) => onAction({ action: "set-collection-required", groupKey: group.groupKey, collectionRequired: event.target.checked })} /> Collection required</label>
      <InspectorMeta label="Source" value={group.sourceLabels.join(" · ")} />
      <h3>Load</h3><ul className="inspector-list">{group.combinedLines.map((line) => <li key={line.lineKey}>{line.quantity} {line.unit} · {line.displayName}</li>)}</ul>
      {group.productionContext && <p className="context-line"><strong>{group.productionContext.clientName}</strong>{group.productionContext.guestCount !== undefined && ` · ${group.productionContext.guestCount} guests`}</p>}
      {group.attention.map((item) => <div className="attention-note" key={item}>⚠ {item}</div>)}
      <div className="inspector-actions"><button onClick={() => { setAssigning(group.groupKey); setTargetRun(runs.length === 1 ? runs[0].runId : ""); }}>Assign to vehicle</button></div>
      {assigning === group.groupKey && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={() => onAssignGroup(group)} label="Assign eligible" />}
    </>}
    {movement && <>
      <InspectorMeta label="Direction" value={`${movement.from?.label || "Origin"}${movement.to ? ` → ${movement.to.label}` : ""}`} />
      <InspectorMeta label="Timing" value={formatWindow(movement.window) || movement.requiredTime || "Unscheduled"} />
      <h3>Items</h3><ul className="inspector-list">{movement.items.map((item, index) => <li key={`${item.description}-${index}`}>{item.quantity} × {item.description}</li>)}</ul>
      {movement.notes && <p className="notes-block">Notes: {movement.notes}</p>}
      <div className="inspector-actions"><button onClick={() => { setAssigning(movement.movementId); setTargetRun(runs.length === 1 ? runs[0].runId : ""); }}>Assign to vehicle</button></div>
      {assigning === movement.movementId && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={() => onAssignMovement(movement)} />}
    </>}
    {run && <>
      <InspectorMeta label="Status" value={liveStatusLabel(run.operationalStatus)} />
      <InspectorMeta label="Vehicle" value={run.vehicle || "No vehicle label"} />
      <p>{run.completedStops} of {run.stopCount} stops complete · {run.remainingCollections} collection{run.remainingCollections === 1 ? "" : "s"} remaining</p>
      <label className="collection-toggle inspector-collection-toggle"><input type="checkbox" checked={run.returnToCpuRequired} disabled={run.status === "dispatched" || run.status === "completed"} onChange={(event) => onAction({ action: "set-run-return-required", runId: run.runId, returnToCpuRequired: event.target.checked, expectedRunVersion: run.version })} /> Return to CPU required</label>
      {run.returnReady && <p className="context-line">All deliveries and collections complete · ready to return to CPU.</p>}
      {run.readiness.blockers.map((item) => <div className="attention-note" key={item}>⚠ {item}</div>)}
      <div className="inspector-actions">
        {run.status === "planned" && <button disabled={!run.readiness.ready} onClick={() => onAction({ action: "mark-run-ready", runId: run.runId, expectedRunVersion: run.version })}>Mark ready</button>}
        {run.status === "ready" && <button className="secondary" onClick={() => onAction({ action: "return-run-to-planning", runId: run.runId, expectedRunVersion: run.version })}>Return to planning</button>}
      </div>
    </>}
    {stop && rawStop && <><div className="inspector-actions"><button className="secondary" onClick={() => onAction({ action: "return-stop-to-planning", runId: rawStop.runId, stopId: stop.stopId, expectedRunVersion: planner.runs.find((item) => item.runId === rawStop.runId)!.version, expectedStopVersion: rawStop.version })}>Return to planning queue</button></div><ScheduleEditor stop={stop} run={planner.runs.find((item) => item.runId === rawStop.runId)!} rawStop={rawStop} onAction={onAction} /><StopPanel stop={stop} index={Math.max(0, stop.sequence - 1)} run={planner.runs.find((item) => item.runId === rawStop.runId)!} runs={runs} rawStop={rawStop} rawRequirements={rawRequirements} projection={projection} expanded onToggle={() => undefined} onAction={onAction} /></>}
  </aside>;
}

function ScheduleEditor({ stop, run, rawStop, onAction }: { stop: PlannerDay["runs"][number]["stops"][number]; run: PlannerDay["runs"][number]; rawStop: DeliveryStop; onAction: (payload: object) => void }) {
  const initialStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime || "";
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(stop.plannedWindow?.endTime || (initialStart ? addClockMinutes(initialStart, 15) : ""));
  useEffect(() => {
    const nextStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime || "";
    setStart(nextStart);
    setEnd(stop.plannedWindow?.endTime || (nextStart ? addClockMinutes(nextStart, 15) : ""));
  }, [stop.plannedArrivalTime, stop.plannedWindow?.endTime, stop.plannedWindow?.startTime]);
  const invalidWindow = end !== "" && (!start || clockMinutes(end) - clockMinutes(start) < 15);
  return <div className="schedule-editor"><h3>Planned timing</h3><p className="context-line">Logistics timing only; upstream required timing remains unchanged.</p><label>Start / arrival <input type="time" step={900} value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Window end <input type="time" step={900} min={start ? addClockMinutes(start, 15) : undefined} value={end} onChange={(event) => setEnd(event.target.value)} /></label><div className="inspector-actions"><button disabled={!start || invalidWindow} onClick={() => onAction({ action: "schedule-stop", runId: run.runId, stopId: stop.stopId, plannedWindow: end ? { startTime: start, endTime: end } : undefined, plannedArrivalTime: end ? undefined : start, expectedRunVersion: run.version, expectedStopVersion: rawStop.version })}>Save time</button>{stop.plannedWindow || stop.plannedArrivalTime ? <button className="secondary" onClick={() => onAction({ action: "clear-stop-schedule", runId: run.runId, stopId: stop.stopId, expectedRunVersion: run.version, expectedStopVersion: rawStop.version })}>Clear time</button> : null}</div></div>;
}

function InspectorMeta({ label, value }: { label: string; value: string }) {
  return <p className="inspector-meta"><span>{label}</span><strong>{value}</strong></p>;
}

function liveStatusLabel(status: PlannerDay["runs"][number]["operationalStatus"]) {
  return status === "in_progress" ? "In progress" : status === "returning_to_cpu" ? "Returning to CPU" : status === "attention" ? "Attention" : status === "returned" ? "Returned" : status[0].toUpperCase() + status.slice(1);
}

function stopOperationalStatusLabel(status: PlannerDay["runs"][number]["stops"][number]["operationalStatus"]) {
  return status === "in_progress" ? "In progress" : status === "dispatched" ? "Dispatched" : status === "delivered" ? "Delivered" : status === "collected" ? "Collected" : status === "attention" ? "Attention" : "Scheduled";
}

function ScheduleSummary({ planner }: { planner?: PlannerDay }) {
  if (!planner) return null;
  const stops = planner.runs.reduce((count, run) => count + run.stopCount, 0);
  const completed = planner.runs.reduce((count, run) => count + run.completedStops, 0);
  const units = planner.runs.reduce(
    (count, run) => count + run.stops.reduce((total, stop) => total + stop.unitBreakdown.reduce((sum, item) => sum + item.quantity, 0), 0),
    0,
  );
  return <div className="schedule-summary" aria-label="Schedule summary">
    <div><span className="summary-icon">▣</span><strong>{planner.runs.length}</strong><small>Active runs</small></div>
    <div><span className="summary-icon">⌖</span><strong>{completed} / {stops}</strong><small>Stops scheduled</small></div>
    <div><span className="summary-icon">◇</span><strong>{units}</strong><small>Units planned</small></div>
    <div className={planner.summary.attention ? "attention" : ""}><span className="summary-icon">△</span><strong>{planner.summary.attention}</strong><small>Items need attention</small></div>
  </div>;
}

function RunCreatePopover({
  driverId,
  setDriverId,
  driverOptions,
  returnToCpuRequired,
  setReturnToCpuRequired,
  onCreate,
  onClose,
}: {
  driverId: string;
  setDriverId: (value: string) => void;
  driverOptions: DeliveryRun[];
  returnToCpuRequired: boolean;
  setReturnToCpuRequired: (value: boolean) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="run-create-popover"
      role="dialog"
      aria-label="Create delivery run"
    >
      <label>
        Driver
        <select
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
        >
          <option value="">Unassigned</option>
          {Array.from(new Map(driverOptions.filter((item) => item.driverId && item.driverLabel && item.driverId.toLowerCase() !== item.driverLabel.toLowerCase()).map((item) => [item.driverId, item.driverLabel])).entries()).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="collection-toggle"><input type="checkbox" checked={returnToCpuRequired} onChange={(event) => setReturnToCpuRequired(event.target.checked)} /> Return to CPU required</label>
      <button onClick={onCreate}>Create run</button>
      <button className="popover-close" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function WeekStrip({
  weekCommencing,
  selectedDate,
  summaries,
  onSelect,
}: {
  weekCommencing: string;
  selectedDate: string;
  summaries: PlannerWeekSummary[];
  onSelect: (date: string) => void;
}) {
  return (
    <section className="week-strip" aria-label="Operational week">
      {operationalWeek(weekCommencing).map((date) => {
        const summary = summaries.find((item) => item.serviceDate === date);
        const weekday = formatOperationalDate(date, {
          weekday: "short",
        }).toUpperCase();
        return (
          <button
            className={date === selectedDate ? "selected" : ""}
            key={date}
            onClick={() => onSelect(date)}
            aria-pressed={date === selectedDate}
          >
            <span className="week-day-name">{weekday}</span>
            <strong>
              {formatOperationalDate(date, {
                day: "numeric",
                month: "short",
              }).toUpperCase()}
            </strong>
            <span className="week-card-primary">{summary?.loads || 0} loads <b>·</b> {summary?.runs || 0} runs</span>
            <span>{summary?.deliveries || 0} deliveries · {summary?.collections || 0} collections</span>
            <span className={summary?.attention ? "week-attention" : ""}>{summary?.transfers || 0} transfers · {summary?.attention || 0} attention</span>
          </button>
        );
      })}
    </section>
  );
}

function SelectedDayHeading({
  planner,
  date,
  children,
}: {
  planner?: PlannerDay;
  date: string;
  children?: ReactNode;
}) {
  return (
    <div className="selected-day-heading">
      <div>
        <p className="eyebrow">Dispatch day</p>
        <h2>
          {formatOperationalDate(date, {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).toUpperCase()}
        </h2>
      </div>
      <span className="day-summary-line">
        {planner?.summary.requirements ?? 0} loads · {planner?.runs.length ?? 0} runs<br />
        {planner?.summary.deliveries ?? 0} deliveries · {planner?.summary.collections ?? 0} collections · {planner?.summary.transfers ?? 0} transfers · {planner?.summary.unplanned ?? 0} unassigned · {planner?.summary.attention ?? 0} attention
      </span>
      {children}
    </div>
  );
}

function AppHeader() {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <img
          src="/brand-assets/logos/fika_logo_white_png.png"
          alt="FIKA"
          width="88"
          height="42"
        />
        <span className="brand-os">OS</span>
      </div>
      <div className="app-title">
        <span className="app-kicker">Operations workspace</span>
        <h1>Logistics</h1>
      </div>
      <div className="header-context">
        <span className="live-dot" /> Local development{" "}
        <span className="header-context-muted">— no cloud data</span>
      </div>
      <a className="header-link" href="/mobile">
        Driver view <span aria-hidden="true">→</span>
      </a>
    </header>
  );
}
function PanelHeading({
  eyebrow,
  title,
  count,
}: {
  eyebrow: string;
  title: string;
  count: string;
}) {
  return (
    <header>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <span>{count}</span>
    </header>
  );
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <p className="empty">
      <span className="empty-mark">＋</span>
      <strong>{title}</strong>
      <span>{body}</span>
    </p>
  );
}
function Health({ health }: { health?: PlannerDay["upstreamHealth"] }) {
  if (!health) return null;
  return (
    <span className="health-inline">
      <i className={health.fulfilment.available ? "health-ok" : "health-bad"}>
        Fulfilment
      </i>
      <i className={health.oplocs.available ? "health-ok" : "health-bad"}>
        OPLOCs
      </i>
      <i className={health.enrichment.available ? "health-ok" : "health-bad"}>
        Production context
      </i>
    </span>
  );
}
function Summary({ planner }: { planner?: PlannerDay }) {
  if (!planner) return null;
  return (
    <section className="summary selected-day-summary">
      <Metric
        value={
          planner.workGroups.filter(
            (group) =>
              group.readiness === "READY" && group.planningState !== "planned",
          ).length
        }
        label="ready to plan"
      />
      <Metric value={planner.summary.unplanned} label="unplanned" />
      <Metric value={planner.runs.length} label="runs" />
      <Metric value={planner.summary.attention} label="attention" warn />
    </section>
  );
}
function Metric({
  value,
  label,
  warn = false,
}: {
  value: number;
  label: string;
  warn?: boolean;
}) {
  return (
    <div className={warn ? "warn" : ""}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function RunChooser({
  runs,
  targetRun,
  setTargetRun,
  onConfirm,
  label = "Assign to run",
}: {
  runs: PlannerDay["runs"];
  targetRun: string;
  setTargetRun: (value: string) => void;
  onConfirm: () => void;
  label?: string;
}) {
  return (
    <div className="run-chooser">
      <select
        aria-label="Target delivery run"
        value={targetRun}
        onChange={(event) => setTargetRun(event.target.value)}
      >
        <option value="">Choose a vehicle</option>
        {runs.map((run) => (
          <option key={run.runId} value={run.runId}>
            {run.driver || "Unassigned"} · {run.stopCount} stops · v
            {run.version}
          </option>
        ))}
      </select>
      <button onClick={onConfirm} disabled={!targetRun}>
        {label}
      </button>
    </div>
  );
}

function WorkGroupCard({
  group,
  expanded,
  onToggle,
  assigning,
  onAssign,
  targetRun,
  setTargetRun,
  runs,
  onConfirm,
  requirements,
}: {
  group: PlannerWorkGroup;
  expanded: boolean;
  onToggle: () => void;
  assigning: boolean;
  onAssign: () => void;
  targetRun: string;
  setTargetRun: (value: string) => void;
  runs: PlannerDay["runs"];
  onConfirm: () => void;
  requirements: FulfilmentRequirement[];
}) {
  const eligible = group.requirementRefs.filter(
    (ref) =>
      !ref.runId &&
      (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")),
  );
  return (
    <article
      className={`planner-card work-group ${group.readiness.toLowerCase()}`}
    >
      <button className="card-main" onClick={onToggle}>
        <span className="destination">{group.destinationLabel}</span>
        <strong className="timing">
          {formatWindow(group.deliveryWindow) ||
            group.requiredTimes[0] ||
            "Time to confirm"}
        </strong>
        <span className="group-meta">
          {group.requirementCount} jobs · {group.sourceLabels.join(" · ")}
        </span>
        <span className="load-summary">
          {group.unitBreakdown
            .map(
              (item) =>
                `${item.quantity} ${item.unit}${item.quantity === 1 ? "" : "s"}`,
            )
            .join(" · ")}
        </span>
        <span className={`state state-${group.readiness.toLowerCase()}`}>
          {group.readiness}
        </span>
        {group.planningState !== "unplanned" && (
          <span className="planning-state">
            {group.planningState.replace("_", " ")}
          </span>
        )}
      </button>
      {group.attention.length > 0 && (
        <div className="attention-note">⚠ {group.attention.join(" · ")}</div>
      )}
      <div className="card-actions">
        {group.planningState !== "planned" && (
          <button onClick={onAssign} disabled={!eligible.length}>
            {group.planningState === "partially_planned"
              ? "Assign remaining"
              : "Assign to run"}
          </button>
        )}
        <button className="secondary" onClick={onToggle}>
          {expanded ? "Hide details" : "View details"}
        </button>
      </div>
      {assigning && (
        <RunChooser
          runs={runs}
          targetRun={targetRun}
          setTargetRun={setTargetRun}
          onConfirm={onConfirm}
          label={
            eligible.length === group.requirementCount
              ? "Assign all"
              : "Assign eligible"
          }
        />
      )}
      {expanded && (
        <div className="detail-panel">
          {group.productionContext && (
            <p className="context-line">
              <strong>
                {group.productionContext.clientName || "Production context"}
              </strong>
              {group.productionContext.serviceType &&
                ` · ${group.productionContext.serviceType}`}
              {group.productionContext.guestCount !== undefined &&
                ` · ${group.productionContext.guestCount} guests`}
            </p>
          )}
          <ul>
            {group.requirementRefs.map((ref) => (
              <li key={ref.requirementId}>
                <strong>{sourceLabel(ref.sourceDomain)}</strong> ·{" "}
                {ref.sourceEntityId} · source v{ref.sourceVersion} ·{" "}
                {ref.status}
                {ref.runId && ` · ${ref.runId}/${ref.stopId}`}
              </li>
            ))}
          </ul>
          {group.combinedLines.map((line) => (
            <p key={line.lineKey}>
              {line.quantity} {line.unit} · {line.displayName}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
function sourceLabel(source: string) {
  return source === "cpu-production"
    ? "CPU Production"
    : source === "grab-and-go"
      ? "Grab & Go"
      : "Menu Planning";
}
function formatWindow(window?: { startTime: string; endTime?: string }) {
  return window
    ? `${window.startTime}${window.endTime ? `–${window.endTime}` : ""}`
    : undefined;
}

function MovementCard({
  movement,
  runs,
  targetRun,
  setTargetRun,
  onAssign,
  assigning,
  onChoose,
}: {
  movement: PlannerMovementView;
  runs: PlannerDay["runs"];
  targetRun: string;
  setTargetRun: (value: string) => void;
  onAssign: () => void;
  assigning: boolean;
  onChoose: () => void;
}) {
  return (
    <article className={`planner-card movement-card ${movement.type}`}>
      <div className="movement-head">
        <span className="movement-type">{movement.type}</span>
        <strong>
          {movement.from?.label || movement.to?.label || "Movement"}
        </strong>
        <span className="state">{movement.planningState}</span>
      </div>
      <p className="movement-route">
        {movement.from?.label || "Origin"} →{" "}
        {movement.to?.label || "Destination"}
      </p>
      <p className="load-summary">
        {movement.items
          .map(
            (item) =>
              `${item.quantity} ${item.unit || "items"} · ${item.description}`,
          )
          .join(" · ")}
      </p>
      <p className="movement-time">
        {formatWindow(movement.window) ||
          movement.requiredTime ||
          "Time to confirm"}
        {movement.notes && " · Notes attached"}
      </p>
      {assigning && (
        <RunChooser
          runs={runs}
          targetRun={targetRun}
          setTargetRun={setTargetRun}
          onConfirm={onAssign}
        />
      )}
      <div className="card-actions">
        <button onClick={onChoose}>Assign to run</button>
        {movement.type === "transfer" && (
          <small>Pickup → drop-off stays linked</small>
        )}
      </div>
    </article>
  );
}

function RunPanel({
  run,
  index,
  data,
  expandedStop,
  setExpandedStop,
  onAction,
}: {
  run: PlannerDay["runs"][number];
  index: number;
  data?: Data;
  expandedStop?: string;
  setExpandedStop: (value: string | undefined) => void;
  onAction: (payload: object) => void;
}) {
  return (
    <article className="run-panel">
      <header>
        <div>
          <p className="run-kicker">Run {index + 1}</p>
          <h3>{run.driver || "Unassigned driver"}</h3>
          <label className="run-driver-control">Driver <select value={run.driverId || ""} aria-label="Driver" onChange={(event) => { const option = (data?.runs || []).find((item) => item.driverId === event.target.value); onAction({ action: "set-run-driver", runId: run.runId, driverId: event.target.value, driverLabel: option?.driverLabel || "", expectedRunVersion: run.version }); }}><option value="">Select driver</option>{Array.from(new Map((data?.runs || []).filter((item) => item.driverId && item.driverLabel && item.driverId.toLowerCase() !== item.driverLabel.toLowerCase()).map((item) => [item.driverId, item.driverLabel])).entries()).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        </div>
        <span className="run-status">{liveStatusLabel(run.operationalStatus)}</span>
      </header>
      <div className="run-summary">
        <span>
          {run.completedStops} / {run.stopCount} stops complete · {run.remainingCollections} collection{run.remainingCollections === 1 ? "" : "s"} remaining
        </span>
        {run.vehicle && <span>{run.vehicle}</span>}
        {run.openIssueCount > 0 && (
          <span className="run-attention">
            {run.openIssueCount} open issue{run.openIssueCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {run.readiness.blockers.length > 0 && run.status !== "completed" && (
        <div className="readiness-blockers">
          {run.readiness.blockers.map((blocker) => (
            <span key={blocker}>⚠ {blocker}</span>
          ))}
        </div>
      )}
      <div className="lifecycle-actions">
        {run.status === "planned" && (
          <button
            disabled={!run.readiness.ready}
            onClick={() =>
              onAction({
                action: "mark-run-ready",

                runId: run.runId,
                expectedRunVersion: run.version,
              })
            }
          >
            Mark ready
          </button>
        )}
        {run.status === "ready" && (
          <>
            <button
              className="secondary"
              onClick={() =>
                onAction({
                  action: "return-run-to-planning",

                  runId: run.runId,
                  expectedRunVersion: run.version,
                })
              }
            >
              Return to planning
            </button>
          </>
        )}
      </div>
      {run.stops.map((stop, index) => (
        <StopPanel
          key={stop.stopId}
          stop={stop}
          index={index}
          run={run}
          runs={data?.planner.runs || []}
          rawStop={data?.stops.find((item) => item.canonicalId === stop.stopId)}
          rawRequirements={data?.requirements || []}
          expanded={expandedStop === stop.stopId}
          onToggle={() =>
            setExpandedStop(
              expandedStop === stop.stopId ? undefined : stop.stopId,
            )
          }
          onAction={onAction}
        />
      ))}
      {!run.stops.length && (
        <div className="run-empty">No stops assigned yet.</div>
      )}
      <a href={`/mobile?run=${encodeURIComponent(run.runId)}`}>
        Open driver workflow →
      </a>
    </article>
  );
}
function swap(values: string[], a: number, b: number) {
  const next = [...values];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
function PostponeCollectionControl({ run, stop, onAction }: { run: PlannerDay["runs"][number]; stop: DeliveryStop; onAction: (payload: object) => void }) {
  const [targetDate, setTargetDate] = useState(addOperationalDays(run.serviceDate, 1));
  const dates = Array.from({ length: 14 }, (_, index) => addOperationalDays(run.serviceDate, index + 1));
  return <div className="postpone-collection"><label>Postpone collection<select value={targetDate} onChange={(event) => setTargetDate(event.target.value)}>{dates.map((date) => <option key={date} value={date}>{formatOperationalDate(date, { weekday: "short", day: "numeric", month: "short" })}</option>)}</select></label><button onClick={() => onAction({ action: "defer-collection", runId: run.runId, stopId: stop.canonicalId, targetServiceDate: targetDate, expectedRunVersion: run.version, expectedStopVersion: stop.version })}>Postpone collection</button></div>;
}
function StopPanel({
  stop,
  index,
  run,
  runs,
  rawStop,
  rawRequirements,
  projection,
  expanded,
  onToggle,
  onAction,
}: {
  stop: PlannerDay["runs"][number]["stops"][number];
  index: number;
  run: PlannerDay["runs"][number];
  runs: PlannerDay["runs"];
  rawStop?: DeliveryStop;
  rawRequirements: FulfilmentRequirement[];
  projection?: LogisticsDayProjection;
  expanded: boolean;
  onToggle: () => void;
  onAction: (payload: object) => void;
}) {
  const collectionRequired = Boolean(rawStop?.collectionRequired || stop.linkedStopId);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [removedSubloadIds, setRemovedSubloadIds] = useState<string[]>([]);
  const selectedProjectionJob = selectedJobId ? projection?.planningQueue.find((job) => job.id === selectedJobId) || projection?.deliveryLoads.flatMap((load) => load.jobs).find((job) => job.id === selectedJobId) : undefined;
  const selectedRequirement = selectedJobId ? rawRequirements.find((requirement) => requirement.canonicalId === selectedJobId) : undefined;
  const subloads = rawStop?.requirementRefs.filter((ref) => !removedSubloadIds.includes(ref.requirementId)).map((ref) => {
    const projectionJob = projection?.planningQueue.find((job) => job.id === ref.requirementId) || projection?.deliveryLoads.flatMap((load) => load.jobs).find((job) => job.id === ref.requirementId);
    const requirement = rawRequirements.find((item) => item.canonicalId === ref.requirementId);
    const contents = projectionJob?.contents || requirement?.lines.map((line) => ({ description: line.displayNameSnapshot, quantity: line.quantity, unit: line.unit })) || [];
    const total = contents.reduce((sum, item) => sum + item.quantity, 0);
    const unit = contents[0]?.unit || "items";
    return { ref, source: sourceLabel(projectionJob?.sourceType || requirement?.sourceDomain || "menu-planning"), total, unit, contents, sourceType: projectionJob?.sourceType || requirement?.sourceDomain, sourceId: projectionJob?.sourceId || requirement?.sourceEntityId, notes: projectionJob?.notes };
  }) || [];
  return (
    <div className={`stop-panel ${stop.status}`}>
      <button className="stop-main" onClick={onToggle}>
        <b className="sequence">{stop.sequence || index + 1}</b>
        <span>
          <strong>{stop.destination.label}</strong>
          <small>
            {formatWindow(stop.window) ||
              stop.requiredTime ||
              "Time to confirm"}
          </small>
          <small>
            {stop.requirementCount + stop.movementCount} jobs ·{" "}
            {stop.sourceLabels.join(" · ") || "Logistics"}
          </small>
          <small>
            {stop.unitBreakdown
              .map((item) => `${item.quantity} ${item.unit}`)
              .join(" · ")}
          </small>
        </span>
        <em>{stopOperationalStatusLabel(stop.operationalStatus)}</em>
      </button>
      {stop.attention.length > 0 && (
        <div className="attention-note">⚠ {stop.attention.join(" · ")}</div>
      )}
      {rawStop &&
        (rawStop.issues || [])
          .filter((issue) => issue.status === "open")
          .map((issue) => (
            <div className="attention-note" key={issue.id}>
              ⚠ Issue: {issue.description}
              <button
                onClick={() =>
                  onAction({
                    action: "resolve-issue",

                    runId: run.runId,
                    stopId: stop.stopId,
                    issueId: issue.id,
                    expectedRunVersion: run.version,
                    expectedStopVersion: rawStop.version,
                    resolutionNotes: "Resolved by planner",
                  })}
              >
                Resolve
              </button>
            </div>
          ))}
      {expanded && rawStop && (
        <div className="stop-detail">
          {selectedJobId && <JobDetailScreen jobId={selectedJobId} sourceType={selectedProjectionJob?.sourceType || selectedRequirement?.sourceDomain} sourceId={selectedProjectionJob?.sourceId || selectedRequirement?.sourceEntityId} contents={selectedProjectionJob?.contents || selectedRequirement?.lines.map((line) => ({ description: line.displayNameSnapshot, quantity: line.quantity, unit: line.unit })) || []} notes={selectedProjectionJob?.notes} onBack={() => setSelectedJobId(undefined)} />}
          {stop.lane === "delivery" && <button className="load-action" onClick={() => onAction({ action: "mark-stop-loaded", loaded: !rawStop.loaded, runId: run.runId, stopId: stop.stopId, expectedRunVersion: run.version, expectedStopVersion: rawStop.version })}>{rawStop.loaded ? "✓ Loaded · remove mark" : "Mark delivery as loaded"}</button>}
          {stop.lane === "collection" && run.status !== "completed" && <PostponeCollectionControl run={run} stop={rawStop} onAction={onAction} />}
          <p>
            {stop.combinedLines
              .map(
                (line) => `${line.quantity} ${line.unit} · ${line.displayName}`,
              )
              .join(" · ")}
          </p>
          {rawStop.postponedFromServiceDate && <p className="postponed-note">Outstanding collection · postponed from {formatOperationalDate(rawStop.postponedFromServiceDate, { weekday: "short", day: "numeric", month: "short" })}</p>}
          <p className="subloads-heading">Subloads · {subloads.length}</p>
          {subloads.map(({ ref, source, total, unit }) => (
            <div className="attached-work" key={ref.requirementId}>
              <button className="subload-card" onClick={() => setSelectedJobId(ref.requirementId)}>
                <span>{source}</span>
                <strong>{total.toLocaleString()} {unit}</strong>
                <small>View subload details →</small>
              </button>
              <button
                onClick={() => {
                  setRemovedSubloadIds((current) => [...current, ref.requirementId]);
                  if (selectedJobId === ref.requirementId) setSelectedJobId(undefined);
                  onAction({
                  action: "unassign-requirement",

                    runId: run.runId,
                    stopId: stop.stopId,
                    requirementId: ref.requirementId,
                    expectedRunVersion: run.version,
                    expectedStopVersion: rawStop.version,
                  });
                }}
              >
                Unassign
              </button>
            </div>
          ))}
          {rawStop.movementRequestIds.map((movementId) => (
            <div className="attached-work" key={movementId}>
              <span>Movement</span>
                <div className="attached-work__copy">
                  <strong>Included movement</strong>
                  <small>{movementId}</small>
                </div>
              <button
                onClick={() =>
                  onAction({
                    action: "unassign-movement",

                    runId: run.runId,
                    movementId,
                    expectedRunVersion: run.version,
                  })
                }
              >
                Unassign
              </button>
            </div>
          ))}
          <div className="correction-row">
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value)
                  onAction({
                    action: "move-stop",
                    runId: run.runId,
                    targetRunId: event.target.value,
                    stopId: stop.stopId,
                    expectedRunVersion: run.version,
                    expectedTargetRunVersion: runs.find(
                      (item) => item.runId === event.target.value,
                    )?.version,
                    expectedStopVersion: rawStop.version,
                  });
                event.currentTarget.value = "";
              }}
            >
              <option value="">Move to vehicle…</option>
              {runs
                .filter((item) => item.runId !== run.runId)
                .map((item) => (
                  <option key={item.runId} value={item.runId}>
                    {item.driver || "Unassigned"}
                  </option>
                ))}
            </select>
            {collectionRequired && <button
              onClick={() =>
                onAction({
                  action: "defer-collection",

                  runId: run.runId,
                  stopId: stop.stopId,
                  targetServiceDate: addOperationalDays(run.serviceDate, 1),
                  expectedRunVersion: run.version,
                  expectedStopVersion: rawStop.version,
                })
              }
            >
              Defer collection
            </button>}
          </div>
        </div>
      )}
    </div>
  );
}

function JobDetailScreen({ sourceType, contents, notes, onBack }: { jobId: string; sourceType?: string; sourceId?: string; contents: Array<{ description: string; quantity: number; unit: string }>; notes?: string; onBack: () => void }) {
  return <section className="job-detail-screen" role="dialog" aria-modal="true" aria-label="Subload detail">
    <button type="button" className="job-detail-back" onClick={onBack}>← Back to delivery</button>
    <p className="eyebrow">CPU production job</p>
    <h3>What this job contains</h3>
    <p className="job-detail-reference">{sourceType ? sourceLabel(sourceType as FulfilmentRequirement["sourceDomain"]) : "Production"}</p>
    <div className="job-detail-items">{contents.map((item, index) => <div className="job-detail-item" key={`${item.description}-${index}`}><strong>{item.quantity.toLocaleString()}</strong><span>{item.unit}</span><p>{item.description}</p></div>)}</div>
    {notes && <div className="job-detail-notes"><strong>Notes from CPU</strong><p>{notes}</p></div>}
    {!contents.length && <p className="context-line">No item detail was included in the current CPU hand-off.</p>}
  </section>;
}

function MovementForm({
  draft,
  setDraft,
  oplocs,
  onClose,
  onSave,
  busy,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  oplocs: Oploc[];
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const field = (key: keyof Draft, value: string) =>
    setDraft({ ...draft, [key]: value });
  return (
    <section className="movement-form panel">
      <header>
        <div>
          <p className="eyebrow">Logistics-owned work</p>
          <h2>New movement</h2>
          <p className="movement-form-subtitle">
            Add a delivery, collection or transfer to the planning queue.
          </p>
        </div>
        <button className="close" onClick={onClose} aria-label="Close new movement form">
          ×
        </button>
      </header>
      {!oplocs.length && (
        <div className="movement-form-notice">
          Integration Hub locations are unavailable. You can still enter a one-off address.
        </div>
      )}
      <>
          <div className="form-grid">
            <label>
              Type
              <select
                value={draft.type}
                onChange={(event) => field("type", event.target.value)}
              >
                <option value="delivery">Delivery</option>
                <option value="collection">Collection</option>
                <option value="transfer">
                  Collection + Delivery / transfer
                </option>
              </select>
            </label>
            {draft.type !== "delivery" && (
              <OplocField
                label="From OPLOC"
                value={draft.from}
                onChange={(value) => field("from", value)}
                address={draft.fromAddress}
                onAddressChange={(value) => field("fromAddress", value)}
                oneOff={draft.fromOneOff}
                onOneOffChange={(value) => setDraft({ ...draft, fromOneOff: value, ...(value ? { from: "" } : { fromAddress: "" }) })}
                oplocs={oplocs}
              />
            )}
            {draft.type !== "collection" && (
              <OplocField
                label="To OPLOC"
                value={draft.to}
                onChange={(value) => field("to", value)}
                address={draft.toAddress}
                onAddressChange={(value) => field("toAddress", value)}
                oneOff={draft.toOneOff}
                onOneOffChange={(value) => setDraft({ ...draft, toOneOff: value, ...(value ? { to: "" } : { toAddress: "" }) })}
                oplocs={oplocs}
              />
            )}
            <label>
              Required time
              <input
                type="time"
                value={draft.requiredTime}
                onChange={(event) => field("requiredTime", event.target.value)}
              />
            </label>
            <label>
              Window start
              <input
                type="time"
                value={draft.start}
                onChange={(event) => field("start", event.target.value)}
              />
            </label>
            <label>
              Window end
              <input
                type="time"
                value={draft.end}
                onChange={(event) => field("end", event.target.value)}
              />
            </label>
            <label>
              Item description
              <input
                value={draft.description}
                onChange={(event) => field("description", event.target.value)}
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                min="1"
                value={draft.quantity}
                onChange={(event) => field("quantity", event.target.value)}
              />
            </label>
            <label className="wide">
              Notes
              <textarea
                value={draft.notes}
                onChange={(event) => field("notes", event.target.value)}
              />
            </label>
          </div>
          <footer>
            <button className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button onClick={onSave} disabled={busy}>
              Create movement
            </button>
          </footer>
      </>
    </section>
  );
}
function OplocField({
  label,
  value,
  onChange,
  address,
  onAddressChange,
  oneOff,
  onOneOffChange,
  oplocs,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  address: string;
  onAddressChange: (value: string) => void;
  oneOff: boolean;
  onOneOffChange: (value: boolean) => void;
  oplocs: Oploc[];
}) {
  return (
    <div className="location-field">
      {!oneOff ? (
        <label>
          {label}
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select governed site</option>
            {oplocs.map((oploc) => (
              <option key={oploc.id} value={oploc.id}>
                {oploc.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          One-off address
          <input
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder="Enter address or collection point"
          />
        </label>
      )}
      <label className="one-off-toggle">
        <input
          type="checkbox"
          checked={oneOff}
          onChange={(event) => onOneOffChange(event.target.checked)}
        />
        Use one-off address
      </label>
    </div>
  );
}
