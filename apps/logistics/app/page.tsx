"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import type { CSSProperties, ReactNode, DragEvent, MouseEvent, MutableRefObject } from "react";
import { deriveTimelineQueueCards, MountedReactTimeline } from "./mounted-react-timeline";
import { schedulableTimelineRuns } from "../lib/react-timeline-model";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { fulfilmentWorkstream } from "../../shared/fulfilment-workstream";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "../lib/types";
import { DriverAuthorityProvider, DriverSelector, useDriverAuthority, useRunDriverEligibility } from "./driver-selector";
import { logisticsVehicleLabel, type LogisticsVehicleId } from "../../shared/logistics-authority";
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
import type { LogisticsDayProjection, LogisticsProjectionState } from "../lib/types";
import { projectionToDashboardData } from "../lib/projection-dashboard-adapter";
import { operationalDate } from "../lib/date";
import { clientErrorDetails, requireSuccessfulResponse } from "../lib/client-errors";
import { drainIncrementalPages } from "../lib/incremental-sync";
import { readCachedProjection, writeCachedProjection } from "../lib/logistics-cache";
import { fetchPlannerGet } from "../lib/planner-fetch";
import { fetchProjectionWithRecovery } from "../lib/projection-fetch";
import { mayRequestPassiveRefresh, PASSIVE_REFRESH_INTERVAL_MS } from "../lib/passive-refresh";
import {
  canStartPlacement,
  collectionTargetForGroup,
  confirmedResponseConverged,
  confirmedPlacementIsSuperseded,
  createPendingScheduleOperation,
  decodePlacementAuthority,
  decodeConfirmedSchedulePosition,
  effectivePlacement,
  groupAssignmentRoute,
  markUncertainPlacement,
  mergePlacementAuthority,
  nativePlacementVersions,
  projectedCollectionScheduleCommand,
  queuePlacementConverged,
  reconcileUncertainPlacement,
  retireConvergedPlacementAuthorities,
  resolveNextAvailableScheduleStart,
  settlePendingScheduleOperation,
  sameSchedulePosition,
  uncertainPlacementTimeout,
  uncertainPlacementWindowExpired,
  type ConfirmedPlacement,
  type PlacementAuthority,
  type PendingScheduleOperation,
  type SchedulePosition,
  UNCERTAIN_PLACEMENT_MAX_ATTEMPTS,
} from "../lib/scheduling";
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
type LoadResult = { ok: true; projection: LogisticsDayProjection } | { ok: false };
type LoadMode = "initial" | "explicit" | "passive";
type PlacementOutcome =
  | { ok: true; body: Record<string, unknown>; refresh?: Promise<LoadResult> }
  | { ok: false; uncertain: boolean; message: string; body?: Record<string, unknown>; refresh?: Promise<LoadResult>; conflict?: boolean };

type PlacementIntent = {
  original?: SchedulePosition;
  proposed?: SchedulePosition;
  execute: () => Promise<PlacementOutcome>;
  settlePosition: (body: Record<string, unknown>, fallback: SchedulePosition) => SchedulePosition | undefined;
};

type ActivePlacement = { operation: PendingScheduleOperation; intent: PlacementIntent; priorConfirmed?: ConfirmedPlacement };

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

export default function Planner() { return <DriverAuthorityProvider><PlannerContents /></DriverAuthorityProvider>; }
function PlannerContents() {
  // Keep the server render deterministic. The operational date and saved view
  // are browser state and are resolved only after hydration.
  const [date, setDate] = useState("");
  const [weekCommencing, setWeekCommencing] = useState("");
  const [viewPreferencesReady, setViewPreferencesReady] = useState(false);
  const [weekData, setWeekData] = useState<WeekData>();
  const [data, setData] = useState<Data>();
  const emptyProjection = (serviceDate: string): LogisticsDayProjection => ({ serviceDate, revision: 0, lastChangeSequence: 0, planningQueue: [], deliveryLoads: [], runs: [], exceptions: [], summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: new Date().toISOString() });
  const [error, setError] = useState("");
  const [errorReference, setErrorReference] = useState("");
  const [passiveSyncError, setPassiveSyncError] = useState("");
  const [projectionNeedsMaterialisation, setProjectionNeedsMaterialisation] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const requestsBlocked = useRef(false);
  const dataRef = useRef<Data | undefined>(undefined);
  const projectionSequence = useRef<number | undefined>(undefined);
  const lastPassiveSyncAt = useRef<number | undefined>(undefined);
  const syncCheckInFlight = useRef<Promise<void> | undefined>(undefined);
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
  const [projectionState, setProjectionState] = useState<LogisticsProjectionState | "LOADING">("LOADING");
  const loadInFlight = useRef<Promise<LoadResult> | undefined>(undefined);
  const bootstrapInFlight = useRef<Promise<void> | undefined>(undefined);
  const weekLoadInFlight = useRef<Promise<void> | undefined>(undefined);

  const setProjectionData = (next: Data | undefined) => {
    dataRef.current = next;
    setData(next);
  };

  const recordError = (cause: unknown, fallback: string) => {
    const details = clientErrorDetails(cause, fallback);
    if ([401, 403].includes(details.status)) requestsBlocked.current = true;
    if ([401, 403].includes(details.status)) setAuthRequired(true);
    setProjectionNeedsMaterialisation(details.code === "LOGISTICS_PROJECTION_NOT_MATERIALIZED");
    setPassiveSyncError("");
    setError(details.message);
    setErrorReference(details.requestId || "");
  };

  const recordPassiveError = (cause: unknown, fallback: string) => {
    const details = clientErrorDetails(cause, fallback);
    if ([401, 403].includes(details.status)) {
      recordError(cause, fallback);
      return;
    }
    if (dataRef.current) {
      setProjectionState("STALE");
      setError("");
    }
    setPassiveSyncError("Sync unavailable · showing last updated data");
    setErrorReference(details.requestId || "");
  };

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

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

  const loadAuthoritative = async (silent = false, _materialiseMissing = true, mode: LoadMode = "explicit"): Promise<LoadResult> => {
    if (requestsBlocked.current) return { ok: false };
    if (!date) return { ok: false };
    const showRefreshing = silent && mode === "explicit";
    if (showRefreshing) setRefreshing(true);
    let cached: LogisticsDayProjection | undefined;
    let cacheScope = "";
    try {
      const headResponse = await fetchPlannerGet(`/api/logistics?syncHead=1&serviceDate=${date}`, { cache: "no-store" });
      const head = await requireSuccessfulResponse(headResponse, "Logistics sync state could not be checked.");
      cacheScope = headResponse.headers.get("x-logistics-cache-scope") || "";
      if (cacheScope) {
        cached = await readCachedProjection(cacheScope, date);
        if (cached) {
          setProjectionData({ ...projectionToDashboardData(cached), projection: cached });
          setProjectionState(cached.state || "CURRENT");
          projectionSequence.current = cached.lastChangeSequence;
        }
      }
      if (cached && Number(head.sequence) === cached.lastChangeSequence && cached.state !== "STALE") {
        lastPassiveSyncAt.current = Date.now();
        setLastUpdated(new Date().toISOString());
        setError("");
        setPassiveSyncError("");
        setProjectionNeedsMaterialisation(false);
        return { ok: true, projection: cached };
      }
      const recovered = await fetchProjectionWithRecovery({ serviceDate: date, fetcher: fetchPlannerGet });
      await requireSuccessfulResponse(recovered.response, "Logistics could not be loaded after automatic materialisation.");
      const body = recovered.body || {};
      let projection = body.projection as LogisticsDayProjection | undefined;
      if (!projection && body.state === "EMPTY") {
        projection = { ...emptyProjection(date), state: "VALID_EMPTY", lastChangeSequence: Number(head.sequence || 0) };
        setProjectionData({ ...projectionToDashboardData(projection), projection });
        setProjectionState("VALID_EMPTY");
        setLastUpdated(new Date().toISOString());
        setError("");
        setPassiveSyncError("");
        setProjectionNeedsMaterialisation(false);
        projectionSequence.current = projection.lastChangeSequence;
        return { ok: true, projection };
      }
      if (!projection) throw new Error("Logistics projection is unavailable.");
      setProjectionData({ ...projectionToDashboardData(projection), projection });
      setProjectionState((body.projectionState || projection.state || "CURRENT") as LogisticsProjectionState);
      projectionSequence.current = projection.lastChangeSequence;
      setProjectionNeedsMaterialisation(false);
      if (cacheScope) await writeCachedProjection(cacheScope, projection);
      setLastUpdated(new Date().toISOString());
      setError("");
      setPassiveSyncError("");
      lastPassiveSyncAt.current = Date.now();
      let convergedProjection = projection;
      const freshHeadResponse = await fetchPlannerGet(`/api/logistics?syncHead=1&serviceDate=${date}`, { cache: "no-store" });
      const freshHead = await requireSuccessfulResponse(freshHeadResponse, "Logistics sync state could not be checked after projection load.");
      if (Number(freshHead.sequence) > projection.lastChangeSequence) {
        const drained = await drainIncrementalPages(projection.lastChangeSequence, async (cursor) => {
          const changes = await fetchPlannerGet(`/api/logistics?changesSince=${cursor}&serviceDate=${date}`, { cache: "no-store" });
          const changed = await requireSuccessfulResponse(changes, "Logistics changes could not be loaded.");
          return { hasMore: Boolean(changed.hasMore), nextCursor: Number(changed.nextCursor ?? cursor), projection: changed.projection as LogisticsDayProjection | undefined };
        });
        if (drained.cursor < Number(freshHead.sequence)) throw new Error("Logistics changes did not converge to the current sync head.");
        if (drained.latestProjection && drained.latestProjection.lastChangeSequence >= drained.cursor && drained.latestProjection !== projection) {
          convergedProjection = drained.latestProjection;
          setProjectionData({ ...projectionToDashboardData(drained.latestProjection), projection: drained.latestProjection });
          setProjectionState(drained.latestProjection.state || "CURRENT");
          projectionSequence.current = drained.latestProjection.lastChangeSequence;
          if (cacheScope) await writeCachedProjection(cacheScope, drained.latestProjection);
        }
      }
      return { ok: true, projection: convergedProjection };
    } catch (cause) {
      if (mode === "passive" && (cached || dataRef.current)) {
        if (cached) setProjectionState("STALE");
        recordPassiveError(cause, "Sync failed; the last valid Logistics projection remains visible.");
      } else {
        if (cached) setProjectionState("STALE");
        else {
          setProjectionData(undefined);
          setProjectionState("UNAVAILABLE");
        }
        recordError(cause, cached ? "Sync failed; showing the last valid Logistics projection." : "Logistics projection could not be loaded.");
      }
      return { ok: false };
    } finally {
      if (showRefreshing) setRefreshing(false);
    }
  };
  const load = (silent = false, materialiseMissing = true, mode: LoadMode = "explicit"): Promise<LoadResult> => {
    if (loadInFlight.current) return loadInFlight.current;
    const pending = loadAuthoritative(silent, materialiseMissing, mode);
    loadInFlight.current = pending;
    void pending.then(() => { if (loadInFlight.current === pending) loadInFlight.current = undefined; }, () => { if (loadInFlight.current === pending) loadInFlight.current = undefined; });
    return pending;
  };
  const loadFresh = async (silent = true, mode: LoadMode = "explicit"): Promise<LoadResult> => {
    const current = loadInFlight.current;
    if (current) {
      await current;
      if (loadInFlight.current === current) loadInFlight.current = undefined;
    }
    return load(silent, true, mode);
  };
  const loadWeekAuthoritative = async (week = weekCommencing, mode: LoadMode = "explicit") => {
    if (requestsBlocked.current) return;
    try {
      const body = await fetchPlannerGet(`/api/logistics?weekSummary=1&weekCommencing=${week}`, { cache: "no-store" }).then((response) => requireSuccessfulResponse(response, "Logistics week summary could not be loaded."));
      setWeekData({ weekCommencing: body.weekCommencing as string, days: (body.days || []) as PlannerWeekSummary[] });
    } catch (cause) {
      if (mode === "passive" && dataRef.current) {
        recordPassiveError(cause, "Logistics week summary could not be refreshed.");
      } else {
        recordError(cause, "Logistics week data could not be loaded.");
        setWeekData(undefined);
      }
    }
  };
  const loadWeek = (week = weekCommencing, mode: LoadMode = "explicit"): Promise<void> => {
    if (weekLoadInFlight.current) return weekLoadInFlight.current;
    const pending = loadWeekAuthoritative(week, mode);
    weekLoadInFlight.current = pending;
    void pending.then(() => { if (weekLoadInFlight.current === pending) weekLoadInFlight.current = undefined; }, () => { if (weekLoadInFlight.current === pending) weekLoadInFlight.current = undefined; });
    return pending;
  };
  const checkForUpdates = async () => {
    if (requestsBlocked.current || !date || document.visibilityState !== "visible") return;
    if (bootstrapInFlight.current) return bootstrapInFlight.current;
    if (syncCheckInFlight.current) return syncCheckInFlight.current;
    const pending = (async () => {
      try {
        const response = await fetchPlannerGet(`/api/logistics?syncHead=1&serviceDate=${date}`, { cache: "no-store" });
        const head = await requireSuccessfulResponse(response, "Logistics sync state could not be checked.");
        if (projectionSequence.current !== undefined && Number(head.sequence) === projectionSequence.current) {
          setPassiveSyncError("");
          return;
        }
        const refreshed = await load(true, true, "passive");
        if (refreshed.ok) {
          await loadWeek(weekCommencing, "passive");
        }
      } catch (cause) {
        recordPassiveError(cause, "Logistics sync state could not be checked.");
      }
    })().finally(() => { syncCheckInFlight.current = undefined; });
    syncCheckInFlight.current = pending;
    return pending;
  };

  const requestPassiveRefresh = (reason: string) => {
    void reason;
    if (!mayRequestPassiveRefresh({
      now: Date.now(),
      lastAttemptAt: lastPassiveSyncAt.current,
      visible: document.visibilityState === "visible",
      requestsBlocked: requestsBlocked.current,
      inFlight: Boolean(syncCheckInFlight.current),
    })) return;
    lastPassiveSyncAt.current = Date.now();
    void checkForUpdates();
  };
  const ensureVehicleDayRuns = async (serviceDate: string) => {
    if (requestsBlocked.current) return;
    try {
      const response = await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ensure-vehicle-day-runs", serviceDate }) });
      const result = await requireSuccessfulResponse(response, "Vehicle-day runs could not be prepared.");
      if (result.changed) {
        const refreshed = await load(true);
        if (refreshed.ok) await loadWeek();
      }
    } catch (cause) { recordError(cause, "Vehicle-day runs could not be prepared."); }
  };
  useEffect(() => {
    if (!viewPreferencesReady) return;
    const requestedDate = new URLSearchParams(window.location.search).get("serviceDate");
    if (requestedDate && requestedDate !== date) {
      setDate(requestedDate);
      setWeekCommencing(mondayOf(requestedDate));
      return;
    }
    setData(undefined);
    dataRef.current = undefined;
    setProjectionState("LOADING");
    setProjectionNeedsMaterialisation(false);
    setPassiveSyncError("");
    lastPassiveSyncAt.current = undefined;
    const bootstrap = (async () => {
      const result = await load();
      if (result.ok && !requestsBlocked.current) await ensureVehicleDayRuns(date);
    })();
    bootstrapInFlight.current = bootstrap;
    void bootstrap.then(() => { if (bootstrapInFlight.current === bootstrap) bootstrapInFlight.current = undefined; }, () => { if (bootstrapInFlight.current === bootstrap) bootstrapInFlight.current = undefined; });
    const liveChannel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("fika-logistics-live");
    const onLiveChange = (event: MessageEvent<{ serviceDate?: string }>) => { if (!event.data?.serviceDate || event.data.serviceDate === date) requestPassiveRefresh("broadcast"); };
    liveChannel?.addEventListener("message", onLiveChange);
    const onVisibilityChange = () => {
      requestPassiveRefresh("visibility");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(() => {
      requestPassiveRefresh("interval");
    }, PASSIVE_REFRESH_INTERVAL_MS);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibilityChange); liveChannel?.removeEventListener("message", onLiveChange); liveChannel?.close(); };
  }, [date, viewPreferencesReady]);
  useEffect(() => {
    if (!viewPreferencesReady) return;
    void (async () => {
      if (bootstrapInFlight.current) await bootstrapInFlight.current;
      await loadWeek();
    })();
  }, [weekCommencing, viewPreferencesReady]);
  const checkPlanningAttention = async (_passive = false) => {
    if (requestsBlocked.current || document.visibilityState !== "visible") return;
    try {
      const response = await fetchPlannerGet(`/api/logistics?planningAttention=1&serviceDate=${operationalDate()}&days=14`, { cache: "no-store" });
      const body = await requireSuccessfulResponse(response, "Planning attention could not be checked.");
      setPlanningAttention((body.attention || []) as Array<{ serviceDate: string; count: number }>);
    } catch (cause) { recordPassiveError(cause, "Planning attention could not be checked."); }
  };
  useEffect(() => {
    if (!viewPreferencesReady) return;
    void checkPlanningAttention(true);
    const timer = window.setInterval(() => { void checkPlanningAttention(true); }, PASSIVE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [viewPreferencesReady]);

  function withLoadAuthority(payload: object) {
    const command = payload as { jobId?: string; loadId?: string; stopId?: string };
    const projection = dataRef.current?.projection;
    const versions = Object.assign({}, ...(projection?.deliveryLoads || []).map(load => load.loadVersions || (load.version === undefined ? {} : { [load.id]: load.version })));
    const job = projection?.planningQueue.find(job => job.id === command.jobId) || projection?.deliveryLoads.flatMap(load => load.jobs).find(job => job.id === command.jobId);
    return { ...payload, expectedJobVersions: Object.fromEntries([...(projection?.planningQueue || []), ...(projection?.deliveryLoads || []).flatMap(load => load.jobs)].filter(job => job.version !== undefined).map(job => [job.id, job.version])), expectedLoadVersions: versions, ...(command.loadId && versions[command.loadId] !== undefined ? { expectedLoadVersion: versions[command.loadId] } : {}), ...(job?.version !== undefined ? { expectedJobVersion: job.version } : {}) };
  }
  async function act(payload: object): Promise<boolean | Record<string, unknown>> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/logistics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withLoadAuthority(payload)),
      });
      const result = await requireSuccessfulResponse(response, "Action failed.");
      await Promise.all([load(), loadWeek()]);
      setAssigning(undefined);
      return result;
    } catch (cause) {
      recordError(cause, "Action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function placementCommand(payload: object): Promise<PlacementOutcome> {
    try {
      const response = await fetch("/api/logistics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withLoadAuthority(payload)),
      });
      const body = await requireSuccessfulResponse(response, "Scheduling action failed.");
      // The command response is the best-known truth. Settle the placement
      // coordinator immediately, then refresh projections without blocking
      // unrelated timeline interactions.
      const refresh = loadFresh(true, "passive");
      void loadWeek(weekCommencing, "passive");
      return { ok: true, body, refresh };
    } catch (cause) {
      const details = clientErrorDetails(cause, "Scheduling action could not be confirmed.");
      if ([401, 403].includes(details.status)) recordError(cause, details.message);
      if (details.status === 409) {
        const refresh = loadFresh(true, "passive");
        void loadWeek(weekCommencing, "passive");
        return { ok: false, uncertain: false, conflict: true, message: details.message, refresh };
      }
      return { ok: false, uncertain: details.status === 0, message: details.message };
    }
  }
  const allRuns = data?.planner.runs || [];
  const runs = schedulableTimelineRuns(allRuns);
  const groups = data?.planner.workGroups || [];
  const movements = data?.planner.movements || [];
  const filteredGroups = queueTypeFilter === "all" || queueTypeFilter === "delivery" ? groups : [];
  const filteredMovements = movements.filter((movement) => queueTypeFilter === "all" || movement.type === queueTypeFilter);
  const createRun = (vehicleId: LogisticsVehicleId) => {
    setShowRunCreate(false);
    void act({
      action: "create-run",
      run: {
        canonicalId: `run:${date}:${Date.now()}`,
        serviceDate: date,
        status: "draft",
        driverId: newRunDriverId || undefined,
        vehicleId,
        returnToCpuRequired: newRunReturnToCpu,
        orderedStopIds: [],
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        audit: [],
      },
    });
  };
  const assignGroup = (group: PlannerWorkGroup, choice?: AssignmentChoice) => {
    if (choice?.lane && choice.lane !== "delivery") return setError("Delivery queue work must be assigned to the delivery lane.");
    if (data?.projection) {
      const jobId = group.requirementRefs[0]?.requirementId;
      if (!jobId) return setError("This projection queue item has no LogisticsJob identity.");
      const scheduledTime = choice?.start || group.deliveryWindow?.startTime || group.requiredTimes[0];
      if (!scheduledTime) return setError("Set a delivery time before assigning this job.");
      const selectedRun = choice?.runId || targetRun;
      return placementCommand({ action: "assign-job-to-load", jobId, scheduledTime, ...(group.collectionRequired ? { collectionRequired: true } : {}), ...(choice?.end ? { scheduledEnd: choice.end } : {}), ...(selectedRun ? { targetRunId: selectedRun } : {}) });
    }
    const run =
      runs.find((item) => item.runId === (choice?.runId || targetRun)) ||
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
    return placementCommand({
      action: "assign-group",
      runId: run.runId,
      expectedRunVersion: run.version,
      requirementIds: eligible.map((ref) => ref.requirementId),
      expectedSourceVersions: Object.fromEntries(
        eligible.map((ref) => [ref.requirementId, ref.sourceVersion]),
      ),
      ...(group.collectionRequired ? { collectionRequired: true } : {}),
      ...(choice?.start ? (choice.end ? { plannedWindow: { startTime: choice.start, endTime: choice.end } } : { plannedArrivalTime: choice.start }) : {}),
    });
  };
  const assignMovement = (movement: PlannerMovementView, choice?: AssignmentChoice) => {
    const run =
      runs.find((item) => item.runId === (choice?.runId || targetRun)) ||
      (runs.length === 1 ? runs[0] : undefined);
    if (!run)
      return setError("Choose a target run before assigning movement work.");
    return placementCommand({
      action: "assign",
      runId: run.runId,
      expectedRunVersion: run.version,
      movementId: movement.movementId,
      ...(choice?.start ? (choice.end ? { plannedWindow: { startTime: choice.start, endTime: choice.end } } : { plannedArrivalTime: choice.start }) : {}),
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
      createdBy: "",
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

  if (!viewPreferencesReady || !date || !weekCommencing) {
    return <main className="mock-tower real-planner"><div className="mock-canvas"><section className="mock-heading" aria-busy="true"><h1>Logistics</h1><p>Loading operational workspace…</p></section></div></main>;
  }

  return <RealPlanner
    date={date}
    weekCommencing={weekCommencing}
    weekData={weekData}
    data={data}
    error={error}
    errorReference={errorReference}
    passiveSyncError={passiveSyncError}
    projectionNeedsMaterialisation={projectionNeedsMaterialisation}
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
    projectionState={projectionState}
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
    loadFresh={loadFresh}
    act={act}
    placementCommand={placementCommand}
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
        {passiveSyncError && <span className="passive-sync-warning" role="status" aria-live="polite">{passiveSyncError}</span>}
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
          onScheduleStop={(sourceRunId, stopId, targetRunId, time, end, lane) => {
            const source = runs.find((item) => item.runId === sourceRunId);
            const target = runs.find((item) => item.runId === targetRunId);
            const raw = data!.stops.find((item) => item.canonicalId === stopId);
            if (!source || !target || !raw) return;
            const timing = end ? { plannedWindow: { startTime: time, endTime: end } } : { plannedArrivalTime: time };
            void placementCommand(sourceRunId === targetRunId ? { action: "schedule-stop", runId: sourceRunId, stopId, ...timing, expectedRunVersion: source.version, expectedStopVersion: raw.version } : { action: "move-stop", runId: sourceRunId, targetRunId, stopId, ...timing, ...(lane ? { lane } : {}), expectedRunVersion: source.version, expectedTargetRunVersion: target.version, expectedStopVersion: raw.version });
          }}
          runs={runs}
          targetRun={targetRun}
          setTargetRun={setTargetRun}
          assigning={assigning}
          setAssigning={setAssigning}
          onAssignGroup={assignGroup}
          onAssignMovement={assignMovement}
          placementPending={false}
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
  projectionState: LogisticsProjectionState | "LOADING";
  error: string;
  errorReference: string;
  passiveSyncError: string;
  projectionNeedsMaterialisation: boolean;
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
  load: (silent?: boolean, materialiseMissing?: boolean) => Promise<LoadResult>;
  loadFresh: (silent?: boolean, mode?: LoadMode) => Promise<LoadResult>;
  act: (payload: object) => Promise<boolean | Record<string, unknown>>;
  placementCommand: (payload: object) => Promise<PlacementOutcome>;
  createRun: (vehicleId: LogisticsVehicleId) => void;
  createMovement: () => void;
  assignGroup: (group: PlannerWorkGroup, choice?: AssignmentChoice) => void | Promise<PlacementOutcome>;
  assignMovement: (movement: PlannerMovementView, choice?: AssignmentChoice) => void | Promise<PlacementOutcome>;
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
  const [pendingSchedules, setPendingSchedules] = useState<Record<string, PendingScheduleOperation>>({});
  const pendingSchedulesRef = useRef<Record<string, PendingScheduleOperation>>({});
  const [confirmedSchedules, setConfirmedSchedules] = useState<Record<string, ConfirmedPlacement>>({});
  const confirmedSchedulesRef = useRef<Record<string, ConfirmedPlacement>>({});
  const [placementErrors, setPlacementErrors] = useState<Record<string, string>>({});
  const activePlacementsRef = useRef<Record<string, ActivePlacement>>({});
  const queuedPlacementsRef = useRef<Record<string, PlacementIntent>>({});
  const placementAuthorityRef = useRef<Record<string, PlacementAuthority>>({});
  const placementOperationSequence = useRef(0);
  useEffect(() => { pendingSchedulesRef.current = pendingSchedules; }, [pendingSchedules]);
  useEffect(() => { confirmedSchedulesRef.current = confirmedSchedules; }, [confirmedSchedules]);
  useEffect(() => {
    if (props.projectionState !== "CURRENT" && props.projectionState !== "VALID_EMPTY" || !data) return;
    placementAuthorityRef.current = retireConvergedPlacementAuthorities(
      placementAuthorityRef.current,
      data.stops,
      runs,
      new Set([...Object.keys(activePlacementsRef.current), ...Object.keys(queuedPlacementsRef.current)]),
    );
  }, [data, props.projectionState, runs]);
  useEffect(() => {
    if (props.projectionState !== "CURRENT" && props.projectionState !== "VALID_EMPTY") return;
    let changed = false;
    const next = { ...pendingSchedulesRef.current };
    for (const [identity, operation] of Object.entries(next)) {
      if (operation.state !== "confirmed-response") continue;
      let converged = false;
      if (operation.source === "queue") {
        const group = groups.find((item) => item.groupKey === identity);
        const movement = movements.find((item) => item.movementId === identity);
        const exists = Boolean(group || movement);
        const actionable = group
          ? groupCollectionPending(group, runs) || group.requirementRefs.some((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")))
          : Boolean(movement && !movement.assignedStops.length);
        converged = queuePlacementConverged(operation, { projectionBacked: Boolean(data?.projection), projectionSequence: data?.projection?.lastChangeSequence, exists, actionable });
      } else {
        const raw = data?.stops.find((item) => item.canonicalId === identity);
        const runVersions = Object.fromEntries((operation.runVersionsAtStart ? Object.keys(operation.runVersionsAtStart) : []).flatMap((runId) => {
          const run = runs.find((item) => item.runId === runId);
          return run ? [[runId, run.version] as const] : [];
        }));
        converged = confirmedResponseConverged(operation, {
          projectionSequence: data?.projection?.lastChangeSequence,
          stopVersion: raw?.version,
          runVersions,
          exists: Boolean(raw),
        });
      }
      if (!converged) continue;
      delete next[identity];
      setPlacementErrors((errors) => { const updated = { ...errors }; delete updated[identity]; return updated; });
      changed = true;
    }
    if (changed) { pendingSchedulesRef.current = next; setPendingSchedules(next); }
  }, [data?.projection?.lastChangeSequence, data?.stops, groups, movements, props.projectionState, runs]);
  useEffect(() => {
    const next = { ...confirmedSchedulesRef.current };
    let changed = false;
    for (const [identity, confirmed] of Object.entries(next)) {
      const raw = data?.stops.find((item) => item.canonicalId === identity);
      if (!raw) {
        const removedFromProjection = confirmed.source === "projection" && data?.projection?.lastChangeSequence !== undefined && confirmed.projectionSequenceAtStart !== undefined && data.projection.lastChangeSequence > confirmed.projectionSequenceAtStart;
        if (removedFromProjection || (confirmed.source === "stop" && confirmed.kind === "unscheduled")) { delete next[identity]; changed = true; }
        continue;
      }
      const lane = raw.linkedOperation === "collection" || raw.movementType === "collection" ? "collection" : "delivery";
      const current: SchedulePosition | undefined = (raw.plannedWindow?.startTime || raw.plannedArrivalTime) ? { runId: raw.runId, lane, start: raw.plannedWindow?.startTime || raw.plannedArrivalTime!, ...(raw.plannedWindow?.endTime ? { end: raw.plannedWindow.endTime } : {}) } : undefined;
      const projectionBacked = confirmed.source === "projection";
      const superseded = confirmedPlacementIsSuperseded(confirmed, projectionBacked
        ? { source: "projection", projectionSequence: data?.projection?.lastChangeSequence, position: current }
        : { source: "stop", stopVersion: raw.version, position: current });
      if (superseded) { delete next[identity]; changed = true; }
    }
    if (changed) { confirmedSchedulesRef.current = next; setConfirmedSchedules(next); }
  }, [data?.stops]);
  useEffect(() => {
    if (props.projectionState !== "CURRENT" && props.projectionState !== "VALID_EMPTY") return;
    for (const [identity, operation] of Object.entries(pendingSchedulesRef.current)) {
      if (operation.state !== "uncertain") continue;
      if (operation.source === "queue") continue;
      const raw = data?.stops.find((item) => item.canonicalId === identity);
      const projectionBacked = operation.source !== "stop";
      if (!raw && projectionBacked && data?.projection?.lastChangeSequence !== undefined && operation.projectionSequenceAtStart !== undefined && data.projection.lastChangeSequence > operation.projectionSequenceAtStart) {
        const nextPending = { ...pendingSchedulesRef.current }; delete nextPending[identity];
        pendingSchedulesRef.current = nextPending; setPendingSchedules(nextPending);
        setPlacementErrors((errors) => { const next = { ...errors }; delete next[identity]; return next; });
        continue;
      }
      if (!raw) {
        if (operation.source !== "stop") continue;
        const nextPending = { ...pendingSchedulesRef.current }; delete nextPending[identity];
        pendingSchedulesRef.current = nextPending; setPendingSchedules(nextPending);
        setPlacementErrors((errors) => { const next = { ...errors }; delete next[identity]; return next; });
        continue;
      }
      const lane = raw.linkedOperation === "collection" || raw.movementType === "collection" ? "collection" : "delivery";
      const current: SchedulePosition | undefined = (raw.plannedWindow?.startTime || raw.plannedArrivalTime) ? { runId: raw.runId, lane, start: raw.plannedWindow?.startTime || raw.plannedArrivalTime!, ...(raw.plannedWindow?.endTime ? { end: raw.plannedWindow.endTime } : {}) } : undefined;
      const reconciliation = reconcileUncertainPlacement(operation, current, projectionBacked
        ? { source: "projection", projectionSequence: data?.projection?.lastChangeSequence }
        : { source: "stop", stopVersion: raw.version });
      if (reconciliation === "pending") continue;
      const nextPending = { ...pendingSchedulesRef.current }; delete nextPending[identity];
      pendingSchedulesRef.current = nextPending; setPendingSchedules(nextPending);
      if (reconciliation === "confirmed" && current) {
        const reconciled: ConfirmedPlacement = { kind: "scheduled", position: current, operationId: operation.operationId, source: operation.source, ...(operation.source === "stop" ? { stopVersion: raw.version } : { projectionSequenceAtStart: operation.projectionSequenceAtStart }) };
        const nextConfirmed: Record<string, ConfirmedPlacement> = { ...confirmedSchedulesRef.current, [identity]: reconciled };
        confirmedSchedulesRef.current = nextConfirmed; setConfirmedSchedules(nextConfirmed);
        setPlacementErrors((errors) => { const next = { ...errors }; delete next[identity]; return next; });
      } else {
        setPlacementErrors((errors) => { const next = { ...errors }; delete next[identity]; return next; });
      }
    }
  }, [data?.stops, props.projectionState]);
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
    const action = payload as { action?: string; runId?: string; targetRunId?: string; stopId?: string; requirementId?: string; plannedArrivalTime?: string; plannedWindow?: { startTime: string; endTime?: string }; loaded?: boolean };
    if (action.action === "schedule-stop" && action.runId && action.stopId) {
      const start = action.plannedWindow?.startTime || action.plannedArrivalTime;
      if (start) scheduleStop(action.runId, action.stopId, action.runId, start, action.plannedWindow?.endTime, undefined);
      return;
    }
    if (action.action === "move-stop" && action.runId && action.targetRunId && action.stopId) {
      const rawStop = data?.stops.find((item) => item.canonicalId === action.stopId);
      const start = rawStop?.plannedWindow?.startTime || rawStop?.plannedArrivalTime;
      if (start) scheduleStop(action.runId, action.stopId, action.targetRunId, start, rawStop?.plannedWindow?.endTime, undefined);
      else props.setError("Set a time before moving this stop to another vehicle.");
      return;
    }
    if (action.action === "clear-stop-schedule" && action.runId && action.stopId) {
      clearScheduleStop(action.runId, action.stopId);
      return;
    }
    if (action.action === "return-stop-to-planning" && action.runId && action.stopId) {
      returnWorkToPlanning(action.runId, action.stopId);
      return;
    }
    if (data?.projection && action.action === "unassign-requirement" && action.requirementId) {
      await props.act({ action: "remove-job-from-load", jobId: action.requirementId });
      return;
    }
    if (data?.projection && action.action === "mark-stop-loaded" && action.stopId) {
      const loadIds = projectionLoadIdsForStop(action.stopId);
      if (loadIds.length) {
        const raw = data.stops.find(stop => stop.canonicalId === action.stopId);
        const run = data.runs.find(run => run.canonicalId === raw?.runId);
        await props.act({ action: "mark-stop-loaded", stopId: action.stopId, runId: raw?.runId, expectedRunVersion: run?.version, loadIds, loaded: action.loaded });
        return;
      }
    }
    if (data?.projection && action.action === "defer-stop" && action.stopId) {
      const rawStop = data.stops.find((item) => item.canonicalId === action.stopId);
      for (const ref of rawStop?.requirementRefs || []) await props.act({ action: "remove-job-from-load", jobId: ref.requirementId });
      props.setInspector(undefined);
      return;
    }
    const succeeded = await props.act(payload);
  };
  const queueStateForGroup = (group: PlannerWorkGroup) => groupCollectionPending(group, runs) ? "needs_time" as const : workGroupQueueState(group, runs);
  const queueStateForMovement = (movement: PlannerMovementView) => movementQueueState(movement, runs);
  const nextAvailableTime = (targetRunId: string, lane: "delivery" | "collection", requested: string, destinationId: string, excludeStopId?: string, requestedEnd?: string) => {
    const conflicts = (runs.find((run) => run.runId === targetRunId)?.stops || []).flatMap((stop) => {
      if (stop.stopId === excludeStopId || stop.lane !== lane || stop.destination.id === destinationId || !hasUsableSchedule(stop)) return [];
      const start = stop.plannedWindow?.startTime || stop.plannedArrivalTime;
      return start ? [{ start, end: stop.plannedWindow?.endTime }] : [];
    });
    return resolveNextAvailableScheduleStart(requested, requestedEnd, conflicts);
  };
  const placementAvailableTime = (targetRunId: string, lane: "delivery" | "collection", requested: string, destinationId: string, excludeStopId?: string, requestedEnd?: string) => {
    try { return nextAvailableTime(targetRunId, lane, requested, destinationId, excludeStopId, requestedEnd); }
    catch (error) { props.setError(error instanceof Error ? error.message : "No safe placement is available within the operational day."); return undefined; }
  };
  const includeState = (state: ReturnType<typeof workGroupQueueState>) => props.queueFilter === "all" || props.queueFilter === state;
  const includeType = (type: "delivery" | "collection" | "transfer") => props.queueTypeFilter === "all" || props.queueTypeFilter === type;
  const filteredGroups = groups.filter((group) => queueStateForGroup(group) !== "scheduled" && includeState(queueStateForGroup(group)) && includeType("delivery"));
  const filteredMovements = movements.filter((movement) => queueStateForMovement(movement) !== "scheduled" && includeState(queueStateForMovement(movement)) && includeType(movement.type));
  const summary = data?.planner.summary;
  const metricsReady = props.projectionState === "CURRENT" || props.projectionState === "VALID_EMPTY";
  const metric = (value: number | undefined) => metricsReady && value !== undefined ? value : "—";
  const queueGroups = groups.filter((group) => queueStateForGroup(group) !== "scheduled");
  const queueMovements = movements.filter((movement) => queueStateForMovement(movement) !== "scheduled");
  const queueCount = metricsReady ? queueGroups.length + queueMovements.length : "—";
  const countFor = (filter: RealPlannerProps["queueFilter"]) => filter === "all" ? queueGroups.length + queueMovements.length : groups.filter((group) => queueStateForGroup(group) === filter).length + movements.filter((movement) => queueStateForMovement(movement) === filter).length;
  const selectedDateLabel = formatOperationalDate(date, { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  const responseVersion = (result: Record<string, unknown>) => {
    const value = (result.stop && typeof result.stop === "object" ? result.stop : result) as Record<string, unknown>;
    const version = typeof value.version === "number" ? value.version : undefined;
    return version;
  };
  const responseStopVersion = (result: Record<string, unknown>) => {
    const value = result.stop && typeof result.stop === "object" ? result.stop as Record<string, unknown> : undefined;
    return typeof value?.version === "number" ? value.version : undefined;
  };
  const freshPlacementRead = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 1500); });
    const read = props.loadFresh().catch(() => undefined);
    return Promise.race([read, timeout]).finally(() => { if (timer) clearTimeout(timer); });
  };
  const reconcileUncertainWithinWindow = async (identity: string, operationId: string) => {
    for (let attempt = 1; attempt <= UNCERTAIN_PLACEMENT_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 350));
      const operation = pendingSchedulesRef.current[identity];
      if (!operation || operation.operationId !== operationId || operation.state !== "uncertain") return;
      const refreshed = await freshPlacementRead();
      if (refreshed?.ok && refreshed.projection) {
        const snapshot = { ...projectionToDashboardData(refreshed.projection), projection: refreshed.projection };
        let resolution: "confirmed" | "superseded" | "pending" = "pending";
        let current: SchedulePosition | undefined;
        const sourceRaw = snapshot.stops.find((item) => item.canonicalId === identity);
        const sourceRun = sourceRaw && operation.source === "stop"
          ? snapshot.planner.runs.find((run) => run.stops.some((stop) => stop.stopId === identity))
          : undefined;
        if (sourceRaw && sourceRun && operation.source === "stop") {
          placementAuthorityRef.current = {
            ...placementAuthorityRef.current,
            [identity]: {
              stopId: identity,
              stopRunId: sourceRun.runId,
              stopVersion: sourceRaw.version,
              runVersions: Object.fromEntries(snapshot.planner.runs.flatMap((run) => [[run.runId, run.version] as const])),
            },
          };
        }
        if (operation.source === "queue") {
          const group = snapshot.planner.workGroups.find((item) => item.groupKey === identity);
          const movement = snapshot.planner.movements.find((item) => item.movementId === identity);
          const exists = Boolean(group || movement);
          const actionable = group
            ? groupCollectionPending(group, snapshot.planner.runs) || group.requirementRefs.some((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")))
            : Boolean(movement && !movement.assignedStops.length);
          if (queuePlacementConverged({ ...operation, state: "confirmed-response" }, { projectionBacked: true, projectionSequence: refreshed.projection.lastChangeSequence, exists, actionable })) resolution = "confirmed";
        } else if (!sourceRaw) {
          if (operation.source === "stop" || (operation.projectionSequenceAtStart !== undefined && refreshed.projection.lastChangeSequence > operation.projectionSequenceAtStart)) resolution = "superseded";
        } else {
          const lane = sourceRaw.linkedOperation === "collection" || sourceRaw.movementType === "collection" ? "collection" : "delivery";
          const start = sourceRaw.plannedWindow?.startTime || sourceRaw.plannedArrivalTime;
          current = start ? { runId: sourceRaw.runId, lane, start, ...(sourceRaw.plannedWindow?.endTime ? { end: sourceRaw.plannedWindow.endTime } : {}) } : undefined;
          resolution = reconcileUncertainPlacement(operation, current, operation.source === "projection"
            ? { source: "projection", projectionSequence: refreshed.projection.lastChangeSequence }
            : { source: "stop", stopVersion: sourceRaw.version });
        }
        if (resolution !== "pending") {
          const nextPending = { ...pendingSchedulesRef.current };
          delete nextPending[identity];
          pendingSchedulesRef.current = nextPending;
          setPendingSchedules(nextPending);
          setPlacementErrors((errors) => { const next = { ...errors }; delete next[identity]; return next; });
          if (resolution === "confirmed") {
            const confirmed: ConfirmedPlacement | undefined = operation.intent === "unscheduled"
              ? { kind: "unscheduled", operationId, source: operation.source, ...(operation.source === "stop" ? { stopVersion: sourceRaw?.version } : { projectionSequenceAtStart: operation.projectionSequenceAtStart }) }
              : current ? { kind: "scheduled", position: current, operationId, source: operation.source, ...(operation.source === "stop" ? { stopVersion: sourceRaw?.version } : { projectionSequenceAtStart: operation.projectionSequenceAtStart }) } : undefined;
            if (confirmed) {
              const nextConfirmed = { ...confirmedSchedulesRef.current, [identity]: confirmed };
              confirmedSchedulesRef.current = nextConfirmed;
              setConfirmedSchedules(nextConfirmed);
            }
          }
          return;
        }
      }
      if (!uncertainPlacementWindowExpired(attempt)) continue;
      const latest = pendingSchedulesRef.current[identity];
      if (!latest || latest.operationId !== operationId || latest.state !== "uncertain") return;
      const timeout = uncertainPlacementTimeout(latest);
      if (timeout.retainLock) {
        const confirmedResponse = { ...latest, state: "confirmed-response" as const, error: timeout.message };
        pendingSchedulesRef.current = { ...pendingSchedulesRef.current, [identity]: confirmedResponse };
        setPendingSchedules(pendingSchedulesRef.current);
        setPlacementErrors((errors) => ({ ...errors, [identity]: timeout.message }));
        return;
      }
      const nextPending = { ...pendingSchedulesRef.current };
      delete nextPending[identity];
      pendingSchedulesRef.current = nextPending;
      setPendingSchedules(nextPending);
      if (timeout.preserveConfirmedResponse) {
        const confirmed: ConfirmedPlacement | undefined = latest.intent === "unscheduled"
          ? { kind: "unscheduled", operationId, source: latest.source, ...(latest.source === "stop" ? { stopVersion: latest.serverStopVersion } : { projectionSequenceAtStart: latest.projectionSequenceAtStart }) }
          : latest.serverPosition ? { kind: "scheduled", position: latest.serverPosition, operationId, source: latest.source, ...(latest.source === "stop" ? { stopVersion: latest.serverStopVersion } : { projectionSequenceAtStart: latest.projectionSequenceAtStart }) } : undefined;
        if (confirmed) {
          const nextConfirmed = { ...confirmedSchedulesRef.current, [identity]: confirmed };
          confirmedSchedulesRef.current = nextConfirmed;
          setConfirmedSchedules(nextConfirmed);
        }
        setPlacementErrors((errors) => ({ ...errors, [identity]: timeout.message }));
      } else {
        setPlacementErrors((errors) => ({ ...errors, [identity]: timeout.message }));
      }
      return;
    }
  };
  const startPlacement = (identity: string, intent: PlacementIntent, priorConfirmed = confirmedSchedulesRef.current[identity]) => {
    const hasNativeStop = Boolean(data?.stops.some((item) => item.canonicalId === identity));
    const source = identity.startsWith("projection-stop:") ? "projection" : hasNativeStop ? "stop" : "queue";
    const authority = placementAuthorityRef.current[identity];
    const rawVersion = data?.stops.find((item) => item.canonicalId === identity)?.version;
    const affectedRunIds = [...new Set([intent.original?.runId, intent.proposed?.runId].filter((runId): runId is string => Boolean(runId)))];
    const runVersionsAtStart = source === "stop"
      ? Object.fromEntries(affectedRunIds.flatMap((runId) => {
        const version = authority?.runVersions[runId] ?? runs.find((item) => item.runId === runId)?.version;
        return version === undefined ? [] : [[runId, version] as const];
      }))
      : undefined;
    placementOperationSequence.current += 1;
    const operation = createPendingScheduleOperation(
      identity,
      intent.original,
      intent.proposed,
      `schedule:${identity}:${Date.now()}:${placementOperationSequence.current}`,
      { source, projectionSequenceAtStart: data?.projection?.lastChangeSequence, stopVersionAtStart: authority?.stopVersion ?? rawVersion, runVersionsAtStart },
    );
    const active: ActivePlacement = { operation, intent, priorConfirmed };
    activePlacementsRef.current = { ...activePlacementsRef.current, [identity]: active };
    const saving = { ...operation, state: "saving" as const };
    pendingSchedulesRef.current = { ...pendingSchedulesRef.current, [identity]: saving };
    setPendingSchedules(pendingSchedulesRef.current);
    setPlacementErrors((current) => { const next = { ...current }; delete next[identity]; return next; });

    void Promise.resolve().then(intent.execute).then((outcome) => {
      if (activePlacementsRef.current[identity]?.operation.operationId !== operation.operationId) return;
      const visible = pendingSchedulesRef.current[identity];
      if (!visible || visible.operationId !== operation.operationId) return;
      if (outcome.ok) {
        const settledPosition = intent.proposed ? intent.settlePosition(outcome.body, intent.proposed) : undefined;
        const returnedAuthority = decodePlacementAuthority(outcome.body, identity);
        if (returnedAuthority) {
          placementAuthorityRef.current = {
            ...placementAuthorityRef.current,
            [identity]: mergePlacementAuthority(placementAuthorityRef.current[identity], returnedAuthority),
          };
        }
        const sourceVersion = returnedAuthority?.stopVersion ?? responseVersion(outcome.body);
        const confirmedOperation = {
          ...settlePendingScheduleOperation(operation, settledPosition),
          responseConfirmed: true,
          serverPosition: settledPosition,
          serverStopVersion: sourceVersion,
        };
        const responsePlacement: ConfirmedPlacement | undefined = operation.source === "queue" ? undefined : settledPosition
          ? { kind: "scheduled", position: settledPosition, operationId: operation.operationId, source: operation.source, ...(operation.source === "stop" ? { stopVersion: sourceVersion } : { projectionSequenceAtStart: operation.projectionSequenceAtStart }) }
          : { kind: "unscheduled", operationId: operation.operationId, source: operation.source, ...(operation.source === "stop" ? { stopVersion: sourceVersion } : { projectionSequenceAtStart: operation.projectionSequenceAtStart }) };
        if (responsePlacement) {
          const nextConfirmed = { ...confirmedSchedulesRef.current, [identity]: responsePlacement };
          confirmedSchedulesRef.current = nextConfirmed;
          setConfirmedSchedules(nextConfirmed);
        }
        delete activePlacementsRef.current[identity];
        const queued = queuedPlacementsRef.current[identity];
        if (queued) {
          delete queuedPlacementsRef.current[identity];
          if (sameSchedulePosition(queued.proposed, settledPosition)) {
            const nextPending = { ...pendingSchedulesRef.current, [identity]: { ...confirmedOperation, proposed: settledPosition, state: "confirmed-response" as const } };
            pendingSchedulesRef.current = nextPending;
            setPendingSchedules(nextPending);
          } else {
            startPlacement(identity, { ...queued, original: settledPosition }, responsePlacement || priorConfirmed);
          }
        } else {
          const nextPending = { ...pendingSchedulesRef.current, [identity]: { ...confirmedOperation, state: "confirmed-response" as const } };
          pendingSchedulesRef.current = nextPending;
          setPendingSchedules(nextPending);
        }
        setPlacementErrors((errors) => { const next = { ...errors }; delete next[identity]; return next; });
        if (props.assigning === identity) props.setAssigning(undefined);
        if (outcome.refresh) void outcome.refresh.then((refreshed) => {
          const latest = pendingSchedulesRef.current[identity];
          if (!latest || latest.operationId !== operation.operationId || latest.state !== "confirmed-response" || refreshed.ok) return;
          const waiting = { ...latest, error: "Saved; waiting for refresh" };
          pendingSchedulesRef.current = { ...pendingSchedulesRef.current, [identity]: waiting };
          setPendingSchedules(pendingSchedulesRef.current);
        });
        return;
      }

      delete activePlacementsRef.current[identity];
      if (outcome.conflict) {
        delete queuedPlacementsRef.current[identity];
        const checking = { ...markUncertainPlacement(operation, intent.original), proposed: intent.original, intent: intent.original ? "scheduled" as const : "unscheduled" as const, state: "uncertain" as const, error: "Checking save…" };
        pendingSchedulesRef.current = { ...pendingSchedulesRef.current, [identity]: checking };
        setPendingSchedules(pendingSchedulesRef.current);
        setPlacementErrors((errors) => ({ ...errors, [identity]: checking.error! }));
        const refresh = outcome.refresh || props.loadFresh(true, "passive");
        void refresh.then((refreshed) => {
          const latest = pendingSchedulesRef.current[identity];
          if (!latest || latest.operationId !== operation.operationId || latest.state !== "uncertain") return;
          if (!refreshed.ok) {
            const waiting = { ...latest, error: "Refresh before retrying this placement." };
            pendingSchedulesRef.current = { ...pendingSchedulesRef.current, [identity]: waiting };
            setPendingSchedules(pendingSchedulesRef.current);
            setPlacementErrors((errors) => ({ ...errors, [identity]: waiting.error! }));
            return;
          }
          const snapshot = projectionToDashboardData(refreshed.projection);
          const raw = snapshot.stops.find((item) => item.canonicalId === identity);
          const containingRun = snapshot.planner.runs.find((run) => run.stops.some((stop) => stop.stopId === identity));
          if (raw && containingRun) {
            const runVersions = Object.fromEntries(snapshot.planner.runs.flatMap((run) => [[run.runId, run.version] as const]));
            placementAuthorityRef.current = {
              ...placementAuthorityRef.current,
              [identity]: { stopId: identity, stopRunId: containingRun.runId, stopVersion: raw.version, runVersions },
            };
          }
          const nextPending = { ...pendingSchedulesRef.current };
          delete nextPending[identity];
          pendingSchedulesRef.current = nextPending;
          setPendingSchedules(nextPending);
          setPlacementErrors((errors) => ({ ...errors, [identity]: "This placement changed elsewhere. The latest version is loaded; retry your move." }));
        });
        return;
      }
      if (outcome.uncertain) {
        delete queuedPlacementsRef.current[identity];
        const bestKnown = outcome.body && intent.proposed ? intent.settlePosition(outcome.body, intent.proposed) : intent.original;
        const uncertain = { ...markUncertainPlacement(operation, bestKnown, Boolean(outcome.body), decodePlacementAuthority(outcome.body || {}, identity)?.stopVersion), error: "Checking save…" };
        pendingSchedulesRef.current = { ...pendingSchedulesRef.current, [identity]: uncertain };
        setPendingSchedules(pendingSchedulesRef.current);
        setPlacementErrors((errors) => ({ ...errors, [identity]: uncertain.error! }));
        void reconcileUncertainWithinWindow(identity, operation.operationId);
        return;
      }
      delete queuedPlacementsRef.current[identity];
      const nextPending = { ...pendingSchedulesRef.current };
      delete nextPending[identity];
      pendingSchedulesRef.current = nextPending;
      setPendingSchedules(nextPending);
      const nextConfirmed = { ...confirmedSchedulesRef.current };
      if (priorConfirmed) nextConfirmed[identity] = priorConfirmed;
      else delete nextConfirmed[identity];
      confirmedSchedulesRef.current = nextConfirmed;
      setConfirmedSchedules(nextConfirmed);
      setPlacementErrors((errors) => ({ ...errors, [identity]: outcome.message }));
    });
  };

  const coordinatePlacement = (identity: string, original: SchedulePosition | undefined, proposed: SchedulePosition | undefined, execute: () => Promise<PlacementOutcome>, settlePosition: (body: Record<string, unknown>, fallback: SchedulePosition) => SchedulePosition | undefined = decodeConfirmedSchedulePosition) => {
    const intent: PlacementIntent = { original, proposed, execute, settlePosition };
    const active = activePlacementsRef.current[identity];
    const pending = pendingSchedulesRef.current[identity];
    if (active && active.operation.source !== "queue" && active.operation.intent === "scheduled" && proposed) {
      queuedPlacementsRef.current[identity] = intent;
      pendingSchedulesRef.current = { ...pendingSchedulesRef.current, [identity]: { ...active.operation, proposed, intent: "scheduled", state: "saving", error: undefined } };
      setPendingSchedules(pendingSchedulesRef.current);
      setPlacementErrors((errors) => { const next = { ...errors }; delete next[identity]; return next; });
      return;
    }
    if (pending?.state === "uncertain" || (!canStartPlacement(identity, pendingSchedulesRef.current) && !(pending?.state === "confirmed-response" && pending.source !== "queue"))) {
      setPlacementErrors((current) => ({ ...current, [identity]: "This placement is being checked. Refresh before trying another change." }));
      return;
    }
    startPlacement(identity, intent);
  };
  const coordinateAssignment = (identity: string, choice: AssignmentChoice | undefined, execute: () => Promise<PlacementOutcome | void>) => {
    if (!choice?.start) {
      props.setError("Set a time before assigning this work.");
      return;
    }
    const proposed: SchedulePosition = { runId: choice.runId, lane: choice.lane, start: choice.start, ...(choice.end ? { end: choice.end } : {}) };
    coordinatePlacement(identity, { runId: "planning-queue", lane: choice.lane, start: choice.start }, proposed, async () => {
      const result = await execute();
      return result && typeof result === "object" && "ok" in result ? result : { ok: false, uncertain: false, message: "Assignment could not be started." };
    });
  };
  const submitGroupAssignment = (group: PlannerWorkGroup, choice?: AssignmentChoice) => {
    if (groupAssignmentRoute(groupCollectionPending(group, runs)) === "collection") {
      if (!choice?.runId || !choice.start) {
        props.setError("Choose a vehicle and collection time before scheduling the outstanding collection.");
        return;
      }
      if (choice.lane !== "collection") {
        props.setError("Outstanding collection work must be scheduled in the collection lane.");
        return;
      }
      const stops = runs.flatMap((run) => run.stops.map((stop) => ({ stopId: stop.stopId, runId: run.runId, linkedStopId: stop.linkedStopId, linkedOperation: stop.linkedOperation })));
      const target = collectionTargetForGroup(group.groupKey, group.requirementRefs.map((ref) => ({ runId: ref.runId, stopId: ref.stopId })), stops);
      if (!target) {
        props.setError("The outstanding collection stop could not be resolved safely.");
        return;
      }
      if (target.kind === "projection") {
        coordinateQueuePlacement(group.groupKey, choice.runId, "collection", choice.start, choice.end, () => props.placementCommand(projectedCollectionScheduleCommand(projectionLoadIdsForStop(`projection-stop:collection:${target.loadId}`), choice.runId, choice.start, choice.end)));
        return;
      }
      scheduleStop(target.runId, target.stopId, choice.runId, choice.start, choice.end, "collection");
      return;
    }
    coordinateAssignment(group.groupKey, choice, () => Promise.resolve(props.assignGroup(group, choice)));
  };
  const submitMovementAssignment = (movement: PlannerMovementView, choice?: AssignmentChoice) => coordinateAssignment(movement.movementId, choice, () => Promise.resolve(props.assignMovement(movement, choice)));
  const coordinateQueuePlacement = (identity: string, targetRunId: string, lane: "delivery" | "collection", start: string, end: string | undefined, execute: () => Promise<PlacementOutcome>) => coordinatePlacement(identity, { runId: "planning-queue", lane, start }, { runId: targetRunId, lane, start, ...(end ? { end } : {}) }, execute);
  const scheduleStop = (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: "delivery" | "collection", preserveStart = false) => {
    if (data?.projection && stopId.startsWith("projection-stop:")) {
      const loadIds = projectionLoadIdsForStop(stopId);
      if (!loadIds.length || !time) return;
      const collection = stopId.startsWith("projection-stop:collection:");
      const rawStop = data.stops.find((item) => item.canonicalId === stopId);
      const safeTime = placementAvailableTime(targetRunId, collection ? "collection" : "delivery", time, rawStop?.locationOplocId || "", stopId, end);
      if (!safeTime) return;
      if (preserveStart && safeTime !== time) {
        props.setError("This window end would overlap another stop. Shorten the window to keep its start fixed.");
        return;
      }
      const originalStop = runs.flatMap((run) => run.stops.map((item) => ({ run, item }))).find(({ item }) => item.stopId === stopId);
      const original: SchedulePosition = { runId: originalStop?.run.runId || sourceRunId, lane: collection ? "collection" : "delivery", start: originalStop?.item.plannedWindow?.startTime || originalStop?.item.plannedArrivalTime || safeTime, ...(originalStop?.item.plannedWindow?.endTime ? { end: originalStop.item.plannedWindow.endTime } : {}) };
      const proposed: SchedulePosition = { runId: targetRunId, lane: collection ? "collection" : "delivery", start: safeTime, ...(end ? { end: addClockMinutes(safeTime, Math.max(15, clockMinutes(end) - clockMinutes(time))) } : {}) };
      coordinatePlacement(stopId, original, proposed, async () => {
        return props.placementCommand({ action: "reschedule-delivery-loads", loadIds, scheduledTime: safeTime, ...(proposed.end ? { scheduledEnd: proposed.end } : {}), targetRunId, lane: collection ? "collection" : "delivery" });
      });
      return;
    }
    const previousConfirmed = confirmedSchedulesRef.current[stopId];
    const confirmedPosition = previousConfirmed?.kind === "scheduled" ? previousConfirmed.position : undefined;
    const pendingPosition = pendingSchedulesRef.current[stopId]?.proposed;
    const effectiveSourceRunId = pendingPosition?.runId || confirmedPosition?.runId || placementAuthorityRef.current[stopId]?.stopRunId || sourceRunId;
    const sourceRun = runs.find((run) => run.runId === effectiveSourceRunId);
    const targetRun = runs.find((run) => run.runId === targetRunId);
    const rawStop = data?.stops.find((item) => item.canonicalId === stopId);
    if (!sourceRun || !targetRun || !rawStop) return;
    const effectiveLane = rawStop.movementType === "collection" ? "collection" : "delivery";
    if (lane && lane !== effectiveLane) {
      props.setError("This stop cannot be changed from its confirmed delivery or collection lane.");
      return;
    }
    const safeTime = placementAvailableTime(targetRunId, effectiveLane, time, rawStop.locationOplocId, stopId, end);
    if (!safeTime) return;
    if (preserveStart && safeTime !== time) {
      props.setError("This window end would overlap another stop. Shorten the window to keep its start fixed.");
      return;
    }
    const timing = end ? { plannedWindow: { startTime: safeTime, endTime: addClockMinutes(safeTime, Math.max(15, clockMinutes(end) - clockMinutes(time))) } } : { plannedArrivalTime: safeTime };
    const original: SchedulePosition = pendingPosition || confirmedPosition || { runId: effectiveSourceRunId, lane: effectiveLane, start: rawStop.plannedWindow?.startTime || rawStop.plannedArrivalTime || safeTime, ...(rawStop.plannedWindow?.endTime ? { end: rawStop.plannedWindow.endTime } : {}) };
    const proposed: SchedulePosition = { runId: targetRunId, lane: effectiveLane, start: safeTime, ...(end ? { end: addClockMinutes(safeTime, Math.max(15, clockMinutes(end) - clockMinutes(time))) } : {}) };
    const fallbackRunVersions = Object.fromEntries(runs.map((run) => [run.runId, run.version] as const));
    coordinatePlacement(stopId, original, proposed, () => {
      const authority = placementAuthorityRef.current[stopId];
      const versions = nativePlacementVersions(authority, {
        stopRunId: effectiveSourceRunId,
        stopVersion: rawStop.version,
        runVersions: fallbackRunVersions,
      }, targetRunId);
      const latestSourceRun = runs.find((run) => run.runId === versions.sourceRunId);
      const latestTargetRun = runs.find((run) => run.runId === targetRunId);
      if (!latestSourceRun || !latestTargetRun || versions.expectedRunVersion === undefined || versions.expectedStopVersion === undefined || (versions.sourceRunId !== targetRunId && versions.expectedTargetRunVersion === undefined)) {
        return Promise.resolve({ ok: false, uncertain: false, message: "Current schedule authority is unavailable. Refresh and retry this placement." });
      }
      const payload = versions.sourceRunId === targetRunId
        ? { action: "schedule-stop", runId: versions.sourceRunId, stopId, ...timing, expectedRunVersion: versions.expectedRunVersion, expectedStopVersion: versions.expectedStopVersion }
        : { action: "move-stop", runId: versions.sourceRunId, targetRunId, stopId, ...timing, expectedRunVersion: versions.expectedRunVersion, expectedTargetRunVersion: versions.expectedTargetRunVersion, expectedStopVersion: versions.expectedStopVersion };
      return props.placementCommand(payload);
    });
  };
  const clearScheduleStop = (runId: string, stopId: string) => {
    const run = runs.find((item) => item.runId === runId);
    const rawStop = data?.stops.find((item) => item.canonicalId === stopId);
    if (!run || !rawStop) return;
    const lane = rawStop.movementType === "collection" ? "collection" : "delivery";
    const currentStart = rawStop.plannedWindow?.startTime || rawStop.plannedArrivalTime;
    if (!currentStart) return;
    const original: SchedulePosition = { runId, lane, start: currentStart, ...(rawStop.plannedWindow?.endTime ? { end: rawStop.plannedWindow.endTime } : {}) };
    coordinatePlacement(stopId, original, original, () => props.placementCommand({ action: "clear-stop-schedule", runId, stopId, expectedRunVersion: run.version, expectedStopVersion: rawStop.version }), () => undefined);
  };
  const returnWorkToPlanning = (runId: string, stopId: string) => {
    const rawStop = data?.stops.find((item) => item.canonicalId === stopId);
    const displayed = runs.flatMap((candidate) => candidate.stops.map((stop) => ({ run: candidate, stop }))).find((entry) => entry.stop.stopId === stopId);
    if (!rawStop || !displayed) return;
    const start = displayed.stop.plannedWindow?.startTime || displayed.stop.plannedArrivalTime;
    const original = start ? { runId: displayed.run.runId, lane: displayed.stop.lane, start, ...(displayed.stop.plannedWindow?.endTime ? { end: displayed.stop.plannedWindow.endTime } : {}) } satisfies SchedulePosition : undefined;
    const projected = Boolean(data?.projection && stopId.startsWith("projection-stop:"));
    coordinatePlacement(stopId, original, undefined, async () => {
      if (projected) {
        const requirementIds = rawStop.requirementRefs.map((ref) => ref.requirementId);
        if (!requirementIds.length) return { ok: false, uncertain: false, message: "This projected stop has no removable LogisticsJob references." };
        let lastBody: Record<string, unknown> = {};
        for (let index = 0; index < requirementIds.length; index += 1) {
          const outcome = await props.placementCommand({ action: "remove-job-from-load", jobId: requirementIds[index] });
          if (!outcome.ok) return index ? { ...outcome, uncertain: true, body: lastBody } : outcome;
          lastBody = outcome.body;
        }
        props.setInspector(undefined);
        return { ok: true, body: lastBody };
      }
      try {
        const response = await fetchPlannerGet(`/api/logistics?serviceDate=${date}`, { cache: "no-store" });
        const current = await response.json() as Data;
        const freshRun = current.runs.find((item) => item.canonicalId === runId);
        const freshStop = current.stops.find((item) => item.canonicalId === stopId);
        if (!freshRun || !freshStop) return { ok: false, uncertain: false, message: "The stop or run no longer exists." };
        const outcome = await props.placementCommand({ action: "return-stop-to-planning", runId, stopId, expectedRunVersion: freshRun.version, expectedStopVersion: freshStop.version });
        if (outcome.ok) props.setInspector(undefined);
        return outcome;
      } catch (error) {
        return { ok: false, uncertain: true, message: error instanceof Error ? error.message : "Could not confirm the stop before returning it to planning." };
      }
    }, () => undefined);
  };
  const assignQueueItem = (kind: "group" | "movement", id: string, targetRunId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => {
    if (!time) { props.setError("Set a time before placing this queue item."); return; }
    if (data?.projection && kind === "group") {
      if (lane === "collection") {
        const loadId = id.startsWith("projection-collection:") ? id.slice("projection-collection:".length) : "";
        if (!loadId) return;
        coordinateQueuePlacement(id, targetRunId, "collection", time, undefined, () => props.placementCommand(projectedCollectionScheduleCommand(projectionLoadIdsForStop(`projection-stop:collection:${loadId}`), targetRunId, time)));
        return;
      }
      const group = groups.find((item) => item.groupKey === id);
      const jobId = group?.requirementRefs[0]?.requirementId;
      if (!jobId) return;
      const safeTime = placementAvailableTime(targetRunId, "delivery", time, group?.destinationOplocId || "");
      if (!safeTime) return;
      coordinateQueuePlacement(id, targetRunId, "delivery", safeTime, undefined, () => props.placementCommand({ action: "assign-job-to-load", jobId, scheduledTime: safeTime, targetRunId, lane: "delivery", ...(group?.collectionRequired || collectionRequired ? { collectionRequired: true } : {}) }));
      return;
    }
    const run = runs.find((item) => item.runId === targetRunId);
    if (!run) return;
    if (kind === "group") {
      if (lane === "collection") {
        const group = groups.find((item) => item.groupKey === id);
        const delivery = group?.requirementRefs.flatMap((ref) => ref.runId && ref.stopId ? [{ ref, stop: runs.find((candidate) => candidate.runId === ref.runId)?.stops.find((stop) => stop.stopId === ref.stopId) }] : []).find((item) => item.stop?.linkedStopId && item.stop.linkedOperation === "delivery");
        const collection = delivery?.stop?.linkedStopId ? runs.flatMap((item) => item.stops.map((stop) => ({ run: item, stop }))).find((item) => item.stop.stopId === delivery.stop!.linkedStopId) : undefined;
        if (!collection) return;
        scheduleStop(collection.run.runId, collection.stop.stopId, targetRunId, time, collection.stop.plannedWindow?.endTime, "collection");
        return;
      }
      const group = groups.find((item) => item.groupKey === id);
      if (!group) return;
      const eligible = group.requirementRefs.filter((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")));
      if (!eligible.length) return;
      const safeTime = placementAvailableTime(targetRunId, "delivery", time, group.destinationOplocId);
      if (!safeTime) return;
      coordinateQueuePlacement(id, targetRunId, "delivery", safeTime, undefined, () => props.placementCommand({ action: "assign-group", runId: targetRunId, expectedRunVersion: run.version, requirementIds: eligible.map((ref) => ref.requirementId), expectedSourceVersions: Object.fromEntries(eligible.map((ref) => [ref.requirementId, ref.sourceVersion])), ...(group.collectionRequired || collectionRequired ? { collectionRequired: true } : {}), plannedArrivalTime: safeTime }));
    } else {
      const movement = movements.find((item) => item.movementId === id);
      if (!movement || movement.assignedStops.length) return;
      const effectiveLane = movement.type === "collection" ? "collection" : "delivery";
      if (lane && lane !== effectiveLane && movement.type !== "transfer") return;
      const safeTime = placementAvailableTime(targetRunId, effectiveLane, time, movement.to?.id || movement.from?.id || "");
      if (!safeTime) return;
      coordinateQueuePlacement(id, targetRunId, effectiveLane, safeTime, undefined, () => props.placementCommand({ action: "assign", runId: targetRunId, expectedRunVersion: run.version, movementId: id, plannedArrivalTime: safeTime }));
    }
  };
  const inspectorPendingIdentity = (() => {
    const selection = props.inspector;
    if (!selection) return "";
    if (selection.kind !== "group") return selection.id;
    const group = groups.find((item) => item.groupKey === selection.id);
    if (!group || !groupCollectionPending(group, runs)) return group?.groupKey || selection.id;
    const stops = runs.flatMap((run) => run.stops.map((stop) => ({ stopId: stop.stopId, runId: run.runId, linkedStopId: stop.linkedStopId, linkedOperation: stop.linkedOperation })));
    const target = collectionTargetForGroup(group.groupKey, group.requirementRefs.map((ref) => ({ runId: ref.runId, stopId: ref.stopId })), stops);
    return target?.kind === "native" ? target.stopId : group.groupKey;
  })();
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
      <section className="mock-day-cards" aria-label="Operational week">{operationalWeek(weekCommencing).map((day) => { const item = weekData?.days.find((summaryItem) => summaryItem.serviceDate === day); const weekMetricsReady = item?.projectionState === "CURRENT" || item?.projectionState === "VALID_EMPTY"; const weekMetric = (value: number | undefined) => weekMetricsReady && value !== undefined ? value : "—"; return <button key={day} className={day === date ? "selected" : ""} aria-pressed={day === date} onClick={() => props.setDate(day)}><div className="mock-day-title"><strong>{formatOperationalDate(day, { weekday: "short", day: "numeric", month: "short" })}</strong>{day === date && <b>✓</b>}</div><div className="mock-day-metrics"><span><i className="purple-dot" />{weekMetric(item?.loads)} loads</span><span><i className="purple-dot" />{weekMetric(item?.scheduled)} scheduled</span><span><i className="green-dot" />{weekMetric(item?.queue)} in queue</span><span><i className="blue-dot" />{weekMetric(item?.needsTime)} needs time</span><span><i className="red-dot" />{weekMetric(item?.attention)} attention</span></div></button>; })}</section>
      <div className="mock-updated">{props.refreshing ? "Refreshing…" : props.data?.fetchedAt ? `Last updated ${new Date(props.data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for data"}<Health health={data?.planner.upstreamHealth} /></div>
      {props.passiveSyncError && <div className="passive-sync-warning" role="status" aria-live="polite">{props.passiveSyncError}</div>}
      {props.error && <div className="alert" role="alert"><span>{props.error}{props.errorReference && <> <small>Reference: {props.errorReference}</small></>}</span><button className="secondary" onClick={() => void props.load(true, props.projectionNeedsMaterialisation)} disabled={props.refreshing}>{props.projectionNeedsMaterialisation ? "Materialise and retry" : "Try again"}</button>{props.authRequired && <button className="secondary" onClick={props.onSignInAgain}>Sign in again</button>}</div>}
      {props.showMovement && <MovementForm draft={props.draft} setDraft={props.setDraft} oplocs={data?.oplocs || []} onClose={() => props.setShowMovement(false)} onSave={props.createMovement} busy={props.busy} />}
      <section className="mock-selected-day"><div><span>▣</span><strong>{selectedDateLabel}</strong><small>{metric(summary?.loads)} loads · {metricsReady ? runs.length : "—"} vans &nbsp;·&nbsp; {metric(summary?.scheduledStops)} scheduled · {queueCount} in queue · {metric(summary?.needsTime)} needs time · {metric(summary?.attention)} attention</small></div><div className="mock-actions"><button onClick={() => props.setShowRunCreate(true)}>＋ New run</button><button onClick={() => props.setShowMovement(true)} disabled={!data?.planner.upstreamHealth.oplocs.available}>＋ New movement</button><button onClick={() => void props.load(true)} disabled={props.refreshing} aria-busy={props.refreshing}>{props.refreshing ? "Refreshing…" : "↻ Refresh"}</button><a href={runs.length === 1 ? `/mobile?run=${encodeURIComponent(runs[0].runId)}` : "/mobile"}>▦ Driver view</a></div></section>
      {props.showRunCreate && <RunCreatePopover driverId={props.newRunDriverId} setDriverId={props.setNewRunDriverId} driverOptions={props.data?.runs || []} returnToCpuRequired={props.newRunReturnToCpu} setReturnToCpuRequired={props.setNewRunReturnToCpu} onCreate={props.createRun} onClose={() => props.setShowRunCreate(false)} />}
      <section className="mock-workspace">
        <aside className="mock-queue" aria-label="Planning queue" data-logistics-planning-queue>
          <header><div><span>QUEUE</span><h2>Planning queue <em>({queueCount})</em></h2><p className="queue-subtitle">Work still needing assignment, timing or review.</p></div></header>
          <div className="mock-filter-pills" role="tablist" aria-label="Planning queue state">
            <button className={props.queueFilter === "all" ? "active" : ""} onClick={() => props.setQueueFilter("all")}>All <b>{countFor("all")}</b></button>
            <button className={props.queueFilter === "unassigned" ? "active" : ""} onClick={() => props.setQueueFilter("unassigned")}>Unassigned <b>{countFor("unassigned")}</b></button>
            <button className={props.queueFilter === "needs_time" ? "active" : ""} onClick={() => props.setQueueFilter("needs_time")}>Needs time <b>{countFor("needs_time")}</b></button>
            <button className={props.queueFilter === "attention" ? "active" : ""} onClick={() => props.setQueueFilter("attention")}>Attention <b>{countFor("attention")}</b></button>
          </div>
          <div className="mock-secondary-filter"><label>Type <select value={props.queueTypeFilter} onChange={(event) => props.setQueueTypeFilter(event.target.value as RealPlannerProps["queueTypeFilter"])}><option value="all">All work</option><option value="delivery">Delivery</option><option value="collection">Collection</option><option value="transfer">Transfer</option></select></label></div>
          <div className="mock-queue-list">
            {!data && <Empty title={props.projectionState === "LOADING" ? "Loading operational work" : "Operational work unavailable"} body={props.projectionState === "LOADING" ? "Waiting for the materialised Logistics projection." : "The authoritative projection could not be loaded. Use Try again to retry."} />}
            {data && !data.planner.upstreamHealth.fulfilment.available && <div className="degraded-note">Incoming work is unavailable; existing vehicle schedules remain visible.</div>}
            {data && props.projectionState !== "CURRENT" && props.projectionState !== "VALID_EMPTY" && <div className="degraded-note">This queue is from a non-current materialised view. Refresh before dispatching.</div>}
            {data && !filteredGroups.length && !filteredMovements.length && <Empty title="No work in this queue" body="Fully scheduled work stays on the dispatch timeline." />}
            {filteredGroups.map((group) => <RealQueueGroup key={group.groupKey} group={group} runs={runs} queueState={queueStateForGroup(group)} assigning={props.assigning === group.groupKey} placementPending={Boolean(pendingSchedules[group.groupKey])} targetRun={props.targetRun} onInspect={() => props.setInspector({ kind: "group", id: group.groupKey })} onAssign={() => { props.setAssigning(group.groupKey); props.setTargetRun(runs.length === 1 ? runs[0].runId : ""); props.setInspector({ kind: "group", id: group.groupKey }); }} setTargetRun={props.setTargetRun} onConfirm={(choice) => submitGroupAssignment(group, choice)} onCollectionRequired={async (value) => Boolean(await props.act({ action: "set-collection-required", groupKey: group.groupKey, serviceDate: group.serviceDate, collectionRequired: value }))} />)}
            {filteredMovements.map((movement) => <RealQueueMovement key={movement.movementId} movement={movement} runs={runs} queueState={queueStateForMovement(movement)} assigning={props.assigning === movement.movementId} placementPending={Boolean(pendingSchedules[movement.movementId])} targetRun={props.targetRun} onInspect={() => props.setInspector({ kind: "movement", id: movement.movementId })} onAssign={() => { props.setAssigning(movement.movementId); props.setTargetRun(runs.length === 1 ? runs[0].runId : ""); props.setInspector({ kind: "movement", id: movement.movementId }); }} setTargetRun={props.setTargetRun} onConfirm={(choice) => submitMovementAssignment(movement, choice)} />)}
          </div>
        </aside>
        <section className="mock-schedule" aria-label="Dispatch schedule"><header className="mock-schedule-head"><div><span>PLANNING SURFACE · {selectedDateLabel}</span><h2>Dispatch schedule</h2></div><strong>{metricsReady ? runs.length : "—"} vehicles · {metric(summary?.scheduledStops)} scheduled · {metric(summary?.needsTime)} needs time</strong></header><div className="mock-legend"><span><i className="green-dot" /> Delivery</span><span><i className="blue-dot" /> Collection</span><span><i className="amber-dot" /> Transfer</span><span><i className="red-dot" /> Attention</span></div>{Object.entries(placementErrors).map(([identity, message]) => <div className="degraded-note" role="status" key={identity}>{message}</div>)}{!data && <Empty title={props.projectionState === "LOADING" ? "Loading dispatch schedule" : "Dispatch schedule unavailable"} body={props.projectionState === "LOADING" ? "Waiting for the materialised Logistics projection." : "The authoritative projection could not be loaded."} />}{data && props.projectionState !== "CURRENT" && props.projectionState !== "VALID_EMPTY" && <div className="degraded-note">This materialised view is not current. Refresh before dispatching.</div>}{data && <MountedReactTimeline planner={{ ...data.planner, runs }} queueItems={deriveTimelineQueueCards(groups, movements, runs, pendingSchedules)} pendingSchedules={pendingSchedules} confirmedSchedules={confirmedSchedules} onStop={(runId, stopId) => props.setInspector({ kind: "stop", id: stopId, runId })} onSchedule={scheduleStop} onQueueDrop={(kind, id, runId, time, lane, collectionRequired) => assignQueueItem(kind, id, runId, time, lane, collectionRequired)} onReturnToQueue={returnWorkToPlanning} onRun={(runId) => props.setInspector({ kind: "run", id: runId })} />}<RealScheduleSummary planner={data?.planner} /></section>
      </section>
    </div>
    {props.inspector && data && <Inspector selection={props.inspector} planner={data.planner} projection={data.projection} rawRequirements={data.requirements} rawStops={data.stops} onClose={() => props.setInspector(undefined)} onAction={handleInspectorAction} onScheduleStop={scheduleStop} runs={runs} targetRun={props.targetRun} setTargetRun={props.setTargetRun} assigning={props.assigning} setAssigning={props.setAssigning} onAssignGroup={(group, choice) => submitGroupAssignment(group, choice)} onAssignMovement={(movement, choice) => submitMovementAssignment(movement, choice)} placementPending={Boolean(pendingSchedules[inspectorPendingIdentity] || (props.inspector.kind === "group" && confirmedSchedules[inspectorPendingIdentity]))} />}
  </main>;
}

function typeText(type: "delivery" | "collection" | "transfer") { return type[0].toUpperCase() + type.slice(1); }
function typeDirection(type: "delivery" | "collection" | "transfer") { return type === "collection" ? "↑" : type === "transfer" ? "↔" : "↓"; }
function timePosition(time?: string) { if (!time) return undefined; const [hour, minute] = time.split(":").map(Number); return ((hour * 60 + minute - 6 * 60) / (11 * 60)) * 100; }
function snappedTimelineTime(clientX: number, rect: DOMRect) {
  const minutes = Math.max(0, Math.min(11 * 60, Math.round(((clientX - rect.left) / rect.width) * 11 * 60 / 15) * 15));
  return `${String(6 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function RealQueueGroup({ group, runs, queueState, assigning, placementPending = false, targetRun, onInspect: inspect, onAssign, setTargetRun, onConfirm, onCollectionRequired }: { group: PlannerWorkGroup; runs: PlannerDay["runs"]; queueState: ReturnType<typeof workGroupQueueState>; assigning: boolean; placementPending?: boolean; targetRun: string; onInspect: () => void; onAssign: () => void; setTargetRun: (value: string) => void; onConfirm: (choice?: AssignmentChoice) => void; onCollectionRequired: (value: boolean) => Promise<boolean>; }) {
  const eligible = group.requirementRefs.filter((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended" || (ref.status === "pending" && ref.sourceDomain === "cpu-production")));
  const assigned = group.requirementRefs.find((ref) => ref.runId);
  const assignedRun = assigned?.runId ? runs.find((run) => run.runId === assigned.runId) : undefined;
  const collectionPending = groupCollectionPending(group, runs);
  const [collectionRequired, setCollectionRequired] = useState(Boolean(group.collectionRequired));
  const [savingCollection, setSavingCollection] = useState(false);
  useEffect(() => setCollectionRequired(Boolean(group.collectionRequired)), [group.collectionRequired]);
  const saveCollectionRequired = (value: boolean) => { if (savingCollection) return; const previous = collectionRequired; setCollectionRequired(value); setSavingCollection(true); void onCollectionRequired(value).then((saved) => { if (!saved) setCollectionRequired(previous); }).finally(() => setSavingCollection(false)); };
  const onInspect = (event?: MouseEvent) => { if (!event || (event.detail === 0 || event.detail === 2)) inspect(); };
  const collectionToggle = <label className="collection-toggle" onPointerDown={(event) => event.stopPropagation()}><input type="checkbox" checked={collectionRequired} disabled={savingCollection} onChange={(event) => { event.stopPropagation(); saveCollectionRequired(event.target.checked); }} /> Collection required</label>;
  return <article data-timeline-queue-id={group.groupKey} draggable={false} className={`mock-queue-item queue-${queueState}`}><button className="mock-queue-main" onClick={onInspect}><span className="mock-item-time">Time set on timeline</span><span className="mock-type delivery"><b>↓</b> Delivery</span><strong>{group.destinationLabel}</strong><small>{group.sourceLabels.join(" · ")}</small><span className="mock-load">{group.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ")}</span>{assignedRun && <span className="queue-assignment">Assigned to {assignedRun.driver || "Unassigned"}</span>}{collectionPending && <span className="queue-assignment">Collection outstanding · place in a collection lane</span>}<span className={`mock-state ${group.attention.length ? "attention" : queueState === "needs_time" ? "needs-time" : "ready"}`}>{group.attention.length ? `⚠ ${group.attention[0]}` : collectionPending ? "⚠ Collection time not confirmed" : queueState === "needs_time" ? "⚠ Time not confirmed" : `● ${group.readiness}`}</span></button>{collectionToggle}<div className="mock-queue-actions"><button onClick={() => inspect()} disabled={placementPending}>Details</button><button disabled={placementPending || (queueState !== "needs_time" && !eligible.length)} onClick={queueState === "needs_time" ? () => inspect() : onAssign}>{placementPending ? "Saving…" : queueState === "needs_time" ? "Set time" : group.planningState === "partially_planned" ? "Assign remaining" : "Assign"}</button><b>⁙</b></div>{assigning && queueState !== "needs_time" && !placementPending && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={onConfirm} label={eligible.length === group.requirementCount ? "Assign all" : "Assign eligible"} />}</article>;
}
function RealQueueMovement({ movement, runs, queueState, assigning, placementPending = false, targetRun, onInspect: inspect, onAssign, setTargetRun, onConfirm }: { movement: PlannerMovementView; runs: PlannerDay["runs"]; queueState: ReturnType<typeof movementQueueState>; assigning: boolean; placementPending?: boolean; targetRun: string; onInspect: () => void; onAssign: () => void; setTargetRun: (value: string) => void; onConfirm: (choice?: AssignmentChoice) => void; }) {
  const assigned = movement.assignedStops[0];
  const assignedRun = assigned ? runs.find((run) => run.runId === assigned.runId) : undefined;
  const onInspect = (event?: MouseEvent) => { if (!event || event.detail === 2) inspect(); };
  return <article data-timeline-queue-id={movement.movementId} draggable={false} className={`mock-queue-item queue-${queueState}`}><button className="mock-queue-main" onClick={onInspect}><span className="mock-item-time">Time set on timeline</span><span className={`mock-type ${movement.type}`}><b>{typeDirection(movement.type)}</b> {typeText(movement.type)}</span><strong>{movement.to?.label || movement.from?.label || "Unknown governed destination"}</strong><small>{movement.from?.label && movement.to ? `${movement.from.label} → ${movement.to.label}` : "Movement"}</small><span className="mock-load">{movement.items.map((item) => `${item.quantity} × ${item.description}`).join(" · ")}</span>{assignedRun && <span className="queue-assignment">Assigned to {assignedRun.driver || "Unassigned"} · {assignedRun.runId.split(":").at(-1) || "Run"}</span>}<span className={`mock-state ${queueState === "needs_time" ? "needs-time" : movement.notes ? "attention" : "ready"}`}>{queueState === "needs_time" ? "⚠ Time not confirmed" : movement.notes ? "⚠ Notes attached" : "● Ready"}</span></button><div className="mock-queue-actions"><button onClick={onInspect} disabled={placementPending}>Details</button><button disabled={placementPending} onClick={queueState === "needs_time" ? onInspect : onAssign}>{placementPending ? "Saving…" : queueState === "needs_time" ? "Set time" : "Assign"}</button><b>⁙</b></div>{assigning && queueState !== "needs_time" && !placementPending && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} allowedLanes={movement.type === "collection" ? ["collection"] : ["delivery"]} onConfirm={onConfirm} />}</article>;
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
  onScheduleStop,
  runs,
  targetRun,
  setTargetRun,
  assigning,
  setAssigning,
  onAssignGroup,
  onAssignMovement,
  placementPending,
}: {
  selection: { kind: "group"; id: string } | { kind: "movement"; id: string } | { kind: "stop"; id: string; runId: string } | { kind: "run"; id: string };
  planner: PlannerDay;
  projection?: LogisticsDayProjection;
  rawRequirements: FulfilmentRequirement[];
  rawStops: DeliveryStop[];
  onClose: () => void;
  onAction: (payload: object) => void;
  onScheduleStop: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: "delivery" | "collection") => void;
  runs: PlannerDay["runs"];
  targetRun: string;
  setTargetRun: (value: string) => void;
  assigning?: string;
  setAssigning: (value: string | undefined) => void;
  onAssignGroup: (group: PlannerWorkGroup, choice?: AssignmentChoice) => void;
  onAssignMovement: (movement: PlannerMovementView, choice?: AssignmentChoice) => void;
  placementPending: boolean;
}) {
  const group = selection.kind === "group" ? planner.workGroups.find((item) => item.groupKey === selection.id) : undefined;
  const movement = selection.kind === "movement" ? planner.movements.find((item) => item.movementId === selection.id) : undefined;
  const run = selection.kind === "run" ? planner.runs.find((item) => item.runId === selection.id) : undefined;
  const driverEligible = useRunDriverEligibility(run);
  const stop = selection.kind === "stop" ? planner.runs.flatMap((item) => item.stops).find((item) => item.stopId === selection.id) : undefined;
  const rawStop = stop ? rawStops.find((item) => item.canonicalId === stop.stopId) : undefined;
  const stopTitle = stop ? `${stop.destination.label} · ${stop.plannedWindow?.startTime || stop.plannedArrivalTime || "Time to confirm"}` : undefined;
  const collectionPending = group ? groupCollectionPending(group, planner.runs) : false;
  return <aside className="mock-inspector" aria-label="Details inspector">
    <header><div><p className="eyebrow">Inspector</p><h2>{group?.destinationLabel || movement?.type || stopTitle || run?.driver || "Details"}</h2></div><button className="close" onClick={onClose} aria-label="Close inspector">×</button></header>
    {group && <>
      <InspectorMeta label="Timing" value={formatWindow(group.deliveryWindow) || group.requiredTimes[0] || "Unscheduled"} />
      <label className="collection-toggle inspector-collection-toggle"><input type="checkbox" checked={Boolean(group.collectionRequired)} onChange={(event) => onAction({ action: "set-collection-required", groupKey: group.groupKey, serviceDate: group.serviceDate, collectionRequired: event.target.checked })} /> Collection required</label>
      <InspectorMeta label="Source" value={group.sourceLabels.join(" · ")} />
      <h3>Load</h3><ul className="inspector-list">{group.combinedLines.map((line) => <li key={line.lineKey}>{line.quantity} {line.unit} · {line.displayName}</li>)}</ul>
      {group.productionContext && <p className="context-line"><strong>{group.productionContext.clientName}</strong>{group.productionContext.guestCount !== undefined && ` · ${group.productionContext.guestCount} guests`}</p>}
      {group.attention.map((item) => <div className="attention-note" key={item}>⚠ {item}</div>)}
      <div className="inspector-actions"><button disabled={placementPending} onClick={() => { setAssigning(group.groupKey); setTargetRun(runs.length === 1 ? runs[0].runId : ""); }}>{placementPending ? "Saving…" : collectionPending ? "Schedule collection" : "Assign to vehicle"}</button></div>
      {assigning === group.groupKey && <RunChooser key={`${group.groupKey}-${collectionPending ? "collection" : "delivery"}`} runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} allowedLanes={collectionPending ? ["collection"] : ["delivery"]} onConfirm={(choice) => onAssignGroup(group, choice)} label={collectionPending ? "Schedule collection" : "Assign eligible"} pending={placementPending} />}
    </>}
    {movement && <>
      <InspectorMeta label="Direction" value={`${movement.from?.label || "Origin"}${movement.to ? ` → ${movement.to.label}` : ""}`} />
      <InspectorMeta label="Timing" value={formatWindow(movement.window) || movement.requiredTime || "Unscheduled"} />
      <h3>Items</h3><ul className="inspector-list">{movement.items.map((item, index) => <li key={`${item.description}-${index}`}>{item.quantity} × {item.description}</li>)}</ul>
      {movement.notes && <p className="notes-block">Notes: {movement.notes}</p>}
      <div className="inspector-actions"><button disabled={placementPending} onClick={() => { setAssigning(movement.movementId); setTargetRun(runs.length === 1 ? runs[0].runId : ""); }}>{placementPending ? "Saving…" : "Assign to vehicle"}</button></div>
      {assigning === movement.movementId && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} allowedLanes={movement.type === "collection" ? ["collection"] : ["delivery"]} onConfirm={(choice) => onAssignMovement(movement, choice)} pending={placementPending} />}
    </>}
    {run && <>
      <InspectorMeta label="Status" value={liveStatusLabel(run.operationalStatus)} />
      <InspectorMeta label="Vehicle" value={run.vehicle || "No vehicle label"} />
      <DriverSelector vehicleId={run.vehicleId} driverId={run.driverId} historicalLabel={run.driver} disabled={placementPending || run.status === "dispatched" || run.status === "completed"} onChange={driverId => onAction({ action: "set-run-driver", runId: run.runId, driverId, expectedRunVersion: run.version })} />
      <p>{run.completedStops} of {run.stopCount} stops complete · {run.remainingCollections} collection{run.remainingCollections === 1 ? "" : "s"} remaining</p>
      <label className="collection-toggle inspector-collection-toggle"><input type="checkbox" checked={run.returnToCpuRequired} disabled={run.status === "dispatched" || run.status === "completed"} onChange={(event) => onAction({ action: "set-run-return-required", runId: run.runId, returnToCpuRequired: event.target.checked, expectedRunVersion: run.version })} /> Return to CPU required</label>
      {run.returnReady && <p className="context-line">All deliveries and collections complete · ready to return to CPU.</p>}
      {run.readiness.blockers.map((item) => <div className="attention-note" key={item}>⚠ {item}</div>)}
      <div className="inspector-actions">
        {run.status === "planned" && <button disabled={!run.readiness.ready || !driverEligible} onClick={() => onAction({ action: "mark-run-ready", runId: run.runId, expectedRunVersion: run.version })}>Mark ready</button>}
        {run.status === "ready" && <button className="secondary" onClick={() => onAction({ action: "return-run-to-planning", runId: run.runId, expectedRunVersion: run.version })}>Return to planning</button>}
      </div>
    </>}
    {stop && rawStop && <><div className="inspector-actions"><button className="secondary" disabled={placementPending} onClick={() => onAction({ action: "return-stop-to-planning", runId: rawStop.runId, stopId: stop.stopId, expectedRunVersion: planner.runs.find((item) => item.runId === rawStop.runId)!.version, expectedStopVersion: rawStop.version })}>Return to planning queue</button></div><ScheduleEditor stop={stop} run={planner.runs.find((item) => item.runId === rawStop.runId)!} rawStop={rawStop} runs={runs} onScheduleStop={onScheduleStop} onAction={onAction} placementPending={placementPending} /><StopPanel stop={stop} index={Math.max(0, stop.sequence - 1)} run={planner.runs.find((item) => item.runId === rawStop.runId)!} runs={runs} rawStop={rawStop} rawRequirements={rawRequirements} projection={projection} expanded onToggle={() => undefined} onAction={onAction} placementPending={placementPending} /></>}
  </aside>;
}

function ScheduleEditor({ stop, run, rawStop, runs, onScheduleStop, onAction, placementPending = false }: { stop: PlannerDay["runs"][number]["stops"][number]; run: PlannerDay["runs"][number]; rawStop: DeliveryStop; runs: PlannerDay["runs"]; onScheduleStop: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string, lane?: "delivery" | "collection") => void; onAction: (payload: object) => void; placementPending?: boolean }) {
  const initialStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime || "";
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(stop.plannedWindow?.endTime || "");
  const [targetRun, setTargetRun] = useState(run.runId);
  const [lane, setLane] = useState<"delivery" | "collection">(stop.lane);
  useEffect(() => {
    const nextStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime || "";
    setStart(nextStart);
    setEnd(stop.plannedWindow?.endTime || "");
    setTargetRun(run.runId);
    setLane(stop.lane);
  }, [run.runId, stop.lane, stop.plannedArrivalTime, stop.plannedWindow?.endTime, stop.plannedWindow?.startTime]);
  const invalidWindow = end !== "" && (!start || clockMinutes(end) - clockMinutes(start) < 15);
  return <div className="schedule-editor"><h3>Planned timing</h3><p className="context-line">Logistics timing only; upstream required timing remains unchanged.</p><label>Vehicle <select value={targetRun} disabled={placementPending} onChange={(event) => setTargetRun(event.target.value)}>{runs.map((candidate, index) => <option key={candidate.runId} value={candidate.runId}>{candidate.vehicle || `Run ${index + 1}`} · {candidate.driver || "Driver unassigned"}</option>)}</select></label><label>Lane <select value={lane} disabled aria-label="Confirmed stop lane"><option value={lane}>{lane[0].toUpperCase() + lane.slice(1)} lane</option></select></label><label>Start / arrival <input type="time" step={900} disabled={placementPending} value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Window end <input type="time" step={900} min={start ? addClockMinutes(start, 15) : undefined} disabled={placementPending} value={end} onChange={(event) => setEnd(event.target.value)} /></label><div className="inspector-actions"><button disabled={placementPending || !start || invalidWindow} onClick={() => onScheduleStop(run.runId, stop.stopId, targetRun, start, end || undefined, lane)}>Save time and placement</button>{stop.plannedWindow || stop.plannedArrivalTime ? <button className="secondary" disabled={placementPending} onClick={() => onAction({ action: "clear-stop-schedule", runId: run.runId, stopId: stop.stopId, expectedRunVersion: run.version, expectedStopVersion: rawStop.version })}>Clear time</button> : null}</div></div>;
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
  returnToCpuRequired,
  setReturnToCpuRequired,
  onCreate,
  onClose,
}: {
  driverId: string;
  setDriverId: (value: string) => void;
  driverOptions?: DeliveryRun[]; // Retained caller compatibility; never a driver authority.
  returnToCpuRequired: boolean;
  setReturnToCpuRequired: (value: boolean) => void;
  onCreate: (vehicleId: LogisticsVehicleId) => void;
  onClose: () => void;
}) {
  const catalogue = useDriverAuthority();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const [vehicleId, setVehicleId] = useState<LogisticsVehicleId | undefined>(catalogue.vehicles[0]);
  useEffect(() => { void catalogue.refresh(); }, []);
  useEffect(() => { if (!vehicleId || !catalogue.vehicles.includes(vehicleId)) setVehicleId(catalogue.vehicles[0]); }, [catalogue.vehicles, vehicleId]);
  const eligibleSelection = !driverId || catalogue.drivers.some(driver => driver.driverId === driverId && vehicleId && driver.permittedDriverVehicleIds.includes(vehicleId));
  return (
    <div
      className="run-create-popover"
      role="dialog"
      aria-label="Create delivery run"
      aria-modal="true"
      ref={dialog}
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)") || []);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
        }
      }}
    >
      <label>Vehicle <select aria-label="Vehicle" value={vehicleId || ""} disabled={catalogue.loading || Boolean(catalogue.error)} onChange={event => { setVehicleId(event.target.value as LogisticsVehicleId); setDriverId(""); }}>{catalogue.vehicles.map(id => <option key={id} value={id}>{logisticsVehicleLabel(id)}</option>)}</select></label>
      <DriverSelector vehicleId={vehicleId} driverId={driverId} onChange={setDriverId} />
      <label className="collection-toggle"><input type="checkbox" checked={returnToCpuRequired} onChange={(event) => setReturnToCpuRequired(event.target.checked)} /> Return to CPU required</label>
      <button disabled={!vehicleId || catalogue.loading || Boolean(catalogue.error) || !eligibleSelection} onClick={() => vehicleId && onCreate(vehicleId)}>Create run</button>
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
  const weekMetric = (summary: PlannerWeekSummary | undefined, key: "loads" | "runs" | "deliveries" | "collections" | "transfers" | "attention") => {
    const ready = summary?.projectionState === "CURRENT" || summary?.projectionState === "VALID_EMPTY";
    const value = summary?.[key];
    return ready && value !== undefined ? value : "—";
  };
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
            <span className="week-card-primary">{weekMetric(summary, "loads")} loads <b>·</b> {weekMetric(summary, "runs")} runs</span>
            <span>{weekMetric(summary, "deliveries")} deliveries · {weekMetric(summary, "collections")} collections</span>
            <span className={summary?.projectionState === "CURRENT" && (summary.attention || 0) > 0 ? "week-attention" : ""}>{weekMetric(summary, "transfers")} transfers · {weekMetric(summary, "attention")} attention</span>
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
        {planner ? planner.summary.requirements : "—"} loads · {planner ? planner.runs.length : "—"} runs<br />
        {planner ? planner.summary.deliveries : "—"} deliveries · {planner ? planner.summary.collections : "—"} collections · {planner ? planner.summary.transfers : "—"} transfers · {planner ? planner.summary.unplanned : "—"} unassigned · {planner ? planner.summary.attention : "—"} attention
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
type AssignmentChoice = { runId: string; lane: "delivery" | "collection"; start: string; end?: string };

function RunChooser({
  runs,
  targetRun,
  setTargetRun,
  onConfirm,
  allowedLanes = ["delivery"],
  label = "Assign to run",
  pending = false,
}: {
  runs: PlannerDay["runs"];
  targetRun: string;
  setTargetRun: (value: string) => void;
  onConfirm: (choice?: AssignmentChoice) => void;
  allowedLanes?: AssignmentChoice["lane"][];
  label?: string;
  pending?: boolean;
}) {
  const [lane, setLane] = useState<AssignmentChoice["lane"]>(allowedLanes[0]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const selectedRun = runs.find((run) => run.runId === targetRun);
  return (
    <div className="run-chooser">
      <select
        aria-label="Target delivery run"
        value={targetRun}
        disabled={pending}
        onChange={(event) => setTargetRun(event.target.value)}
      >
        <option value="">Choose a vehicle</option>
        {runs.map((run) => (
          <option key={run.runId} value={run.runId}>
            {run.vehicle || `Run ${run.runId.split(":").at(-1) || "unassigned"}`} · {run.driver || "Driver unassigned"} · {run.stopCount} stops
          </option>
        ))}
      </select>
      {allowedLanes.length > 1 || allowedLanes[0] === "collection" ? <select aria-label="Schedule lane" value={lane} onChange={(event) => setLane(event.target.value as AssignmentChoice["lane"])} disabled={pending || !targetRun}>
        {allowedLanes.map((candidate) => <option key={candidate} value={candidate}>{candidate[0].toUpperCase() + candidate.slice(1)} lane</option>)}
      </select> : <small>{allowedLanes[0][0].toUpperCase() + allowedLanes[0].slice(1)} lane</small>}
      <label>Time <input aria-label="Schedule time" type="time" step={900} disabled={pending} value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>Window end <input aria-label="Schedule window end" type="time" step={900} disabled={pending} min={start || undefined} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      {selectedRun && !selectedRun.vehicle && <small>Vehicle label unavailable; using {selectedRun.driver || "the selected run"}.</small>}
      <button onClick={() => onConfirm({ runId: targetRun, lane, start, ...(end ? { end } : {}) })} disabled={pending || !targetRun || !start}>
        {pending ? "Saving…" : label}
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
  return fulfilmentWorkstream({ sourceDomain: source });
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
  placementPending = false,
}: {
  run: PlannerDay["runs"][number];
  index: number;
  data?: Data;
  expandedStop?: string;
  setExpandedStop: (value: string | undefined) => void;
  onAction: (payload: object) => void;
  placementPending?: boolean;
}) {
  const driverEligible = useRunDriverEligibility(run);
  return (
    <article className="run-panel">
      <header>
        <div>
          <p className="run-kicker">Run {index + 1}</p>
          <h3>{run.driver || "Unassigned driver"}</h3>
          <DriverSelector vehicleId={run.vehicleId} driverId={run.driverId} historicalLabel={run.driver} disabled={placementPending} onChange={driverId => onAction({ action: "set-run-driver", runId: run.runId, driverId, expectedRunVersion: run.version })} />
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
            disabled={!run.readiness.ready || !driverEligible}
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
  placementPending = false,
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
  placementPending?: boolean;
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
    return { ref, source: projectionJob?.workstream || requirement?.workstream || sourceLabel(projectionJob?.sourceType || requirement?.sourceDomain || "menu-planning"), total, unit, contents, sourceType: projectionJob?.sourceType || requirement?.sourceDomain, sourceId: projectionJob?.sourceId || requirement?.sourceEntityId, notes: projectionJob?.notes };
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
          {selectedJobId && <JobDetailScreen jobId={selectedJobId} workstream={selectedProjectionJob?.workstream || selectedRequirement?.workstream || sourceLabel(selectedProjectionJob?.sourceType || selectedRequirement?.sourceDomain || "menu-planning")} contents={selectedProjectionJob?.contents || selectedRequirement?.lines.map((line) => ({ description: line.displayNameSnapshot, quantity: line.quantity, unit: line.unit })) || []} notes={selectedProjectionJob?.notes} onBack={() => setSelectedJobId(undefined)} />}
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
              disabled={placementPending}
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
                    {item.vehicle || item.driver || `Run ${runs.indexOf(item) + 1}`}
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

function JobDetailScreen({ workstream, contents, notes, onBack }: { jobId: string; workstream?: string; contents: Array<{ description: string; quantity: number; unit: string }>; notes?: string; onBack: () => void }) {
  return <section className="job-detail-screen" role="dialog" aria-modal="true" aria-label="Subload detail">
    <button type="button" className="job-detail-back" onClick={onBack}>← Back to delivery</button>
    <p className="eyebrow">CPU production job</p>
    <h3>What this job contains</h3>
    <p className="job-detail-reference">{workstream || "Production"}</p>
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
