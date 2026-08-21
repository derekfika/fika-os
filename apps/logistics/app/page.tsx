"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode, DragEvent } from "react";
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
import { operationalDate } from "../lib/date";
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
};
type WeekData = { weekCommencing: string; days: PlannerWeekSummary[] };
type Draft = {
  type: "delivery" | "collection" | "transfer";
  from: string;
  to: string;
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
  to: "",
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
  const [weekData, setWeekData] = useState<WeekData>();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>();
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
  const [newRunDriver, setNewRunDriver] = useState("Franco");
  const [showRunCreate, setShowRunCreate] = useState(false);
  const [queueFilter, setQueueFilter] = useState<"all" | "unassigned" | "needs_time" | "attention">("all");
  const [queueTypeFilter, setQueueTypeFilter] = useState<"all" | "delivery" | "collection" | "transfer">("all");

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const response = await fetch(`/api/logistics?serviceDate=${date}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Logistics could not be loaded.");
      setData(body);
      setLastUpdated(body.fetchedAt);
      if (!body.planner.upstreamHealth.fulfilment.available)
        setError(
          "Integration Hub fulfilment is unavailable; existing runs remain visible and incoming work cannot currently refresh.",
        );
      else if (!body.planner.upstreamHealth.oplocs.available)
        setError(
          "Integration Hub OPLOCs are unavailable; existing snapshots remain visible and new movement locations are disabled.",
        );
      else setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Logistics could not be loaded.",
      );
    } finally {
      if (silent) setRefreshing(false);
    }
  };
  const loadWeek = async (week = weekCommencing) => {
    try {
      const response = await fetch(`/api/logistics?weekCommencing=${week}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Week summary could not be loaded.");
      setWeekData(await response.json());
    } catch {
      setWeekData(undefined);
    }
  };
  const ensureVehicleDayRuns = async (serviceDate: string) => {
    try {
      await fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ensure-vehicle-day-runs", by: "Franco", serviceDate }) });
    } catch { /* The read model remains usable if automatic provisioning is temporarily unavailable. */ }
  };
  useEffect(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("serviceDate");
    if (requestedDate && requestedDate !== date) {
      setDate(requestedDate);
      setWeekCommencing(mondayOf(requestedDate));
    }
    void load();
    void ensureVehicleDayRuns(requestedDate || date).then(() => load());
    void loadWeek();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [date]);
  useEffect(() => {
    void loadWeek();
  }, [weekCommencing]);

  async function act(payload: object): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/logistics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Action failed.");
      await load();
      setAssigning(undefined);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed.");
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
      by: "Franco",
      run: {
        canonicalId: `run:${date}:${Date.now()}`,
        serviceDate: date,
        status: "draft",
        driverId: newRunDriver.toLowerCase(),
        driverLabel: newRunDriver,
        orderedStopIds: [],
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        audit: [],
      },
    });
  };
  const assignGroup = (group: PlannerWorkGroup) => {
    const run =
      runs.find((item) => item.runId === targetRun) ||
      (runs.length === 1 ? runs[0] : undefined);
    if (!run) return setError("Choose a target run before assigning work.");
    const eligible = group.requirementRefs.filter(
      (ref) =>
        !ref.runId &&
        (ref.status === "ready_for_planning" || ref.status === "amended"),
    );
    if (!eligible.length)
      return setError(
        "There are no currently plannable requirements remaining in this group.",
      );
    void act({
      action: "assign-group",
      by: "Franco",
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
      by: "Franco",
      runId: run.runId,
      expectedRunVersion: run.version,
      movementId: movement.movementId,
    });
  };
  const createMovement = () => {
    if (
      !draft.description.trim() ||
      Number(draft.quantity) < 1 ||
      (draft.type !== "collection" && !draft.to) ||
      (draft.type !== "delivery" && !draft.from)
    )
      return setError(
        "Select the required OPLOCs and add an item with quantity.",
      );
    const now = new Date().toISOString();
    const movement: MovementRequest = {
      canonicalId: `movement:${Date.now()}`,
      entityType: "Movement Request",
      type: draft.type,
      serviceDate: date,
      ...(draft.from ? { fromOplocId: draft.from } : {}),
      ...(draft.to ? { toOplocId: draft.to } : {}),
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
        { action: "movement-created", at: now, by: "Franco", version: 1 },
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
    busy={busy}
    refreshing={refreshing}
    showMovement={showMovement}
    draft={draft}
    showRunCreate={showRunCreate}
    newRunDriver={newRunDriver}
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
    setNewRunDriver={setNewRunDriver}
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
          <p>Plan loads by destination, timing, quantity and run.</p>
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
          <button onClick={() => setShowRunCreate((open) => !open)} disabled={busy}>＋ New run</button>
          <button className="secondary" onClick={() => setShowMovement(true)} disabled={!data?.planner.upstreamHealth.oplocs.available}>＋ New movement</button>
          <button className="secondary" onClick={() => void load(true)} disabled={refreshing}>↻ Refresh</button>
          <a href={runs.length === 1 ? `/mobile?run=${encodeURIComponent(runs[0].runId)}` : "/mobile"}>Driver view →</a>
          {showRunCreate && <RunCreatePopover driver={newRunDriver} setDriver={setNewRunDriver} onCreate={createRun} onClose={() => setShowRunCreate(false)} />}
        </div>
      </SelectedDayHeading>
      <div className="control-tower" aria-label="Dispatch control tower">
        <section className="unassigned-queue" aria-label="Unassigned work">
          <PanelHeading eyebrow="Queue" title="Unassigned work" count={`${groups.length + movements.length} items`} />
          <p className="region-intro">Loads waiting for a driver and run.</p>
          <div className="queue-filters" role="group" aria-label="Unassigned work filters">
            {(["all", "delivery", "collection", "transfer"] as const).map((filter) => {
              const count = filter === "all" ? groups.length + movements.length : filter === "delivery" ? groups.length + movements.filter((item) => item.type === "delivery").length : movements.filter((item) => item.type === filter).length;
              return <button key={filter} className={queueTypeFilter === filter ? "active" : ""} onClick={() => setQueueTypeFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)} <b>{count}</b></button>;
            })}
          </div>
          {!data && <Empty title="Loading operational work" body="Connecting to upstream work and local runs." />}
          {data && !data!.planner.upstreamHealth.fulfilment.available && (
            <div className="degraded-note">Upstream work is unavailable. This is not an empty queue; existing schedule data remains readable.</div>
          )}
          {data && groups.length === 0 && movements.length === 0 && (
            <Empty title="No unassigned work" body="Everything currently plannable is on a run." />
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
            <span>{runs.length} {runs.length === 1 ? "run" : "runs"} · {runs.reduce((count, run) => count + run.stopCount, 0)} stops</span>
          </header>
          <div className="schedule-tools">
            <span><i className="legend-dot delivery" /> Delivery</span><span><i className="legend-dot collection" /> Collection</span><span><i className="legend-dot transfer" /> Transfer</span><span><i className="legend-dot attention" /> Attention</span><span><i className="legend-dot unscheduled" /> Unscheduled</span>
            <div className="view-toggle"><button className="active">Day</button><button disabled>Week</button></div>
          </div>
          <p className="region-intro">Time-ordered work by driver. Select a stop or run to inspect it.</p>
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
  busy: boolean;
  refreshing: boolean;
  showMovement: boolean;
  draft: Draft;
  showRunCreate: boolean;
  newRunDriver: string;
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
  setNewRunDriver: (value: string) => void;
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
  const handleInspectorAction = async (payload: object) => {
    const action = payload as { action?: string; runId?: string; stopId?: string };
    if (action.action === "return-stop-to-planning" && action.runId && action.stopId) {
      await returnStopToPlanning(action.runId, action.stopId);
      return;
    }
    const succeeded = await props.act(payload);
  };
  const queueStateForGroup = (group: PlannerWorkGroup) => groupCollectionPending(group, runs) ? "needs_time" as const : workGroupQueueState(group, runs);
  const queueStateForMovement = (movement: PlannerMovementView) => movementQueueState(movement, runs);
  const includeState = (state: ReturnType<typeof workGroupQueueState>) => props.queueFilter === "all" || props.queueFilter === state;
  const includeType = (type: "delivery" | "collection" | "transfer") => props.queueTypeFilter === "all" || props.queueTypeFilter === type;
  const filteredGroups = groups.filter((group) => queueStateForGroup(group) !== "scheduled" && includeState(queueStateForGroup(group)) && includeType("delivery"));
  const filteredMovements = movements.filter((movement) => queueStateForMovement(movement) !== "scheduled" && includeState(queueStateForMovement(movement)) && includeType(movement.type));
  const summary = data?.planner.summary;
  const queueGroups = groups.filter((group) => queueStateForGroup(group) !== "scheduled");
  const queueMovements = movements.filter((movement) => queueStateForMovement(movement) !== "scheduled");
  const countFor = (filter: RealPlannerProps["queueFilter"]) => filter === "all" ? queueGroups.length + queueMovements.length : groups.filter((group) => queueStateForGroup(group) === filter).length + movements.filter((movement) => queueStateForMovement(movement) === filter).length;
  const selectedDateLabel = formatOperationalDate(date, { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  const scheduleStop = (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => {
    const sourceRun = runs.find((run) => run.runId === sourceRunId);
    const targetRun = runs.find((run) => run.runId === targetRunId);
    const rawStop = data?.stops.find((item) => item.canonicalId === stopId);
    if (!sourceRun || !targetRun || !rawStop) return;
    const timing = end ? { plannedWindow: { startTime: time, endTime: end } } : { plannedArrivalTime: time };
    if (sourceRunId === targetRunId) void props.act({ action: "schedule-stop", by: "Franco", runId: sourceRunId, stopId, ...timing, expectedRunVersion: sourceRun.version, expectedStopVersion: rawStop.version });
    else void props.act({ action: "move-stop", by: "Franco", runId: sourceRunId, targetRunId, stopId, ...timing, expectedRunVersion: sourceRun.version, expectedTargetRunVersion: targetRun.version, expectedStopVersion: rawStop.version });
  };
  const assignQueueItem = (kind: "group" | "movement", id: string, targetRunId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => {
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
        if (collection.run.runId === targetRunId) void props.act({ action: "schedule-stop", by: "Franco", runId: targetRunId, stopId: collection.stop.stopId, ...timing, expectedRunVersion: collection.run.version, expectedStopVersion: rawStop.version });
        else void props.act({ action: "move-stop", by: "Franco", runId: collection.run.runId, targetRunId, stopId: collection.stop.stopId, ...timing, expectedRunVersion: collection.run.version, expectedTargetRunVersion: run.version, expectedStopVersion: rawStop.version });
        return;
      }
      const group = groups.find((item) => item.groupKey === id);
      if (!group) return;
      const eligible = group.requirementRefs.filter((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended"));
      if (!eligible.length) return;
      void props.act({ action: "assign-group", by: "Franco", runId: targetRunId, expectedRunVersion: run.version, requirementIds: eligible.map((ref) => ref.requirementId), expectedSourceVersions: Object.fromEntries(eligible.map((ref) => [ref.requirementId, ref.sourceVersion])), ...(group.collectionRequired || collectionRequired ? { collectionRequired: true } : {}), ...(time ? { plannedArrivalTime: time } : {}) });
    } else {
      const movement = movements.find((item) => item.movementId === id);
      if (!movement || movement.assignedStops.length) return;
      if (lane && movement.type !== lane && !(movement.type === "transfer" && lane === "collection")) return;
      void props.act({ action: "assign", by: "Franco", runId: targetRunId, expectedRunVersion: run.version, movementId: id, ...(time ? { plannedArrivalTime: time } : {}) });
    }
  };
  const returnStopToPlanning = async (runId: string, stopId: string) => {
    try {
      const response = await fetch(`/api/logistics?serviceDate=${date}`, { cache: "no-store" });
      const current = await response.json() as Data;
      const run = current.runs.find((item) => item.canonicalId === runId);
      const stop = current.stops.find((item) => item.canonicalId === stopId);
      if (!run || !stop) return;
      const succeeded = await props.act({ action: "return-stop-to-planning", by: "Franco", runId, stopId, expectedRunVersion: run.version, expectedStopVersion: stop.version });
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
    if (runId && stopId) void returnStopToPlanning(runId, stopId);
  };
  useEffect(() => {
    const isQueueTarget = (event: Event) => (event.target as HTMLElement | null)?.closest('[aria-label="Planning queue"]');
    const allowDrop = (event: Event) => {
      if (!isQueueTarget(event)) return;
      event.preventDefault();
      (event as unknown as DragEvent).dataTransfer.dropEffect = "move";
    };
    const drop = (event: Event) => {
      if (!isQueueTarget(event)) return;
      handlePlanningQueueDrop(event as unknown as DragEvent);
    };
    document.addEventListener("dragover", allowDrop, true);
    document.addEventListener("drop", drop, true);
    return () => {
      document.removeEventListener("dragover", allowDrop, true);
      document.removeEventListener("drop", drop, true);
    };
  }, [data, runs]);
  useEffect(() => {
    const refresh = () => void props.load(true);
    window.addEventListener("logistics-collection-preference-updated", refresh);
    return () => window.removeEventListener("logistics-collection-preference-updated", refresh);
  }, [props.load]);
  return <main className="mock-tower real-planner">
    <header className="mock-shell">
      <div className="mock-brand"><img src="/brand-assets/logos/fika_logo_white_png.png" alt="FIKA" /><span>OS</span></div>
      <div className="mock-context"><span>Operations workspace</span><strong>Logistics</strong></div><span className="mock-chevron">⌄</span><div className="mock-shell-spacer" />
      <div className="mock-environment"><i /> Local development <span>— no cloud data</span></div><div className="mock-bell">♧</div><div className="mock-avatar">DM</div><span className="mock-chevron">⌄</span>
    </header>
    <div className="mock-canvas">
      <section className="mock-heading"><h1>Logistics</h1><p>Plan and dispatch daily deliveries.</p></section>
      <section className="mock-week-nav" aria-label="Operational week navigation"><button aria-label="Previous week" onClick={() => { const next = addOperationalDays(weekCommencing, -7); props.setWeekCommencing(next); props.setDate(next); }}>‹</button><strong>WC {formatWeekRange(weekCommencing)}</strong><button className="mock-this-week" onClick={() => { const next = mondayOf(operationalDate()); props.setWeekCommencing(next); props.setDate(next); }}>This week</button><button aria-label="Next week" onClick={() => { const next = addOperationalDays(weekCommencing, 7); props.setWeekCommencing(next); props.setDate(next); }}>›</button></section>
      <section className="mock-day-cards" aria-label="Operational week">{operationalWeek(weekCommencing).map((day) => { const item = weekData?.days.find((summaryItem) => summaryItem.serviceDate === day); return <button key={day} className={day === date ? "selected" : ""} aria-pressed={day === date} onClick={() => props.setDate(day)}><div className="mock-day-title"><strong>{formatOperationalDate(day, { weekday: "short", day: "numeric", month: "short" })}</strong>{day === date && <b>✓</b>}</div><div className="mock-day-metrics"><span><i className="purple-dot" />{item?.loads || 0} loads</span><span><i className="purple-dot" />{item?.runs || 0} runs</span><span><i className="green-dot" />{item?.deliveries || 0} deliveries</span><span><i className="blue-dot" />{item?.collections || 0} collections</span><span><i className="amber-dot" />{item?.transfers || 0} transfers</span><span><i className="red-dot" />{item?.attention || 0} attention</span></div></button>; })}</section>
      <div className="mock-updated">{props.refreshing ? "Refreshing…" : props.data?.fetchedAt ? `Last updated ${new Date(props.data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for data"}<Health health={data?.planner.upstreamHealth} /></div>
      {props.error && <div className="alert" role="alert">{props.error}</div>}
      {props.showMovement && <MovementForm draft={props.draft} setDraft={props.setDraft} oplocs={data?.oplocs || []} onClose={() => props.setShowMovement(false)} onSave={props.createMovement} busy={props.busy} />}
      <section className="mock-selected-day"><div><span>▣</span><strong>{selectedDateLabel}</strong><small>{summary?.loads || 0} loads · {runs.length} runs &nbsp;·&nbsp; {summary?.deliveries || 0} deliveries · {summary?.collections || 0} collections &nbsp;·&nbsp; {summary?.transfers || 0} transfers · {summary?.attention || 0} attention</small></div><div className="mock-actions"><button onClick={() => props.setShowRunCreate(!props.showRunCreate)} disabled={props.busy}>＋ New run</button><button onClick={() => props.setShowMovement(true)} disabled={!data?.planner.upstreamHealth.oplocs.available}>＋ New movement</button><button onClick={() => void props.load(true)} disabled={props.refreshing}>↻ Refresh</button><a href={runs.length === 1 ? `/mobile?run=${encodeURIComponent(runs[0].runId)}` : "/mobile"}>▦ Driver view</a></div></section>
      {props.showRunCreate && <RunCreatePopover driver={props.newRunDriver} setDriver={props.setNewRunDriver} onCreate={props.createRun} onClose={() => props.setShowRunCreate(false)} />}
      <section className="mock-workspace">
        <aside className="mock-queue" aria-label="Planning queue"><header><div><span>QUEUE</span><h2>Planning queue <em>({queueGroups.length + queueMovements.length})</em></h2><p className="queue-subtitle">Work still needing assignment, timing or review.</p></div><button className="mock-filter-icon">⌯</button></header><div className="mock-filter-pills" role="tablist" aria-label="Planning queue state"><button className={props.queueFilter === "all" ? "active" : ""} onClick={() => props.setQueueFilter("all")}>All <b>{countFor("all")}</b></button><button className={props.queueFilter === "unassigned" ? "active" : ""} onClick={() => props.setQueueFilter("unassigned")}>Unassigned <b>{countFor("unassigned")}</b></button><button className={props.queueFilter === "needs_time" ? "active" : ""} onClick={() => props.setQueueFilter("needs_time")}>Needs time <b>{countFor("needs_time")}</b></button><button className={props.queueFilter === "attention" ? "active" : ""} onClick={() => props.setQueueFilter("attention")}>Attention <b>{countFor("attention")}</b></button></div><div className="mock-secondary-filter"><label>Type <select value={props.queueTypeFilter} onChange={(event) => props.setQueueTypeFilter(event.target.value as RealPlannerProps["queueTypeFilter"])}><option value="all">All work</option><option value="delivery">Delivery</option><option value="collection">Collection</option><option value="transfer">Transfer</option></select></label></div><div className="mock-queue-list">{!data && <Empty title="Loading operational work" body="Connecting to upstream work and local runs." />}{data && !data.planner.upstreamHealth.fulfilment.available && <div className="degraded-note">Incoming work is unavailable; existing local runs remain visible.</div>}{data && !filteredGroups.length && !filteredMovements.length && <Empty title="No work in this queue" body="Fully scheduled work stays on the dispatch timeline." />}{filteredGroups.map((group) => <RealQueueGroup key={group.groupKey} group={group} runs={runs} queueState={queueStateForGroup(group)} assigning={props.assigning === group.groupKey} targetRun={props.targetRun} onInspect={() => props.setInspector({ kind: "group", id: group.groupKey })} onAssign={() => { props.setAssigning(group.groupKey); props.setTargetRun(runs.length === 1 ? runs[0].runId : ""); props.setInspector({ kind: "group", id: group.groupKey }); }} setTargetRun={props.setTargetRun} onConfirm={() => props.assignGroup(group)} onDragStart={(event) => queueDragStart(event, { kind: "group", id: group.groupKey, label: group.destinationLabel, type: "Delivery", load: group.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ") })} />)}{filteredMovements.map((movement) => <RealQueueMovement key={movement.movementId} movement={movement} runs={runs} queueState={queueStateForMovement(movement)} assigning={props.assigning === movement.movementId} targetRun={props.targetRun} onInspect={() => props.setInspector({ kind: "movement", id: movement.movementId })} onAssign={() => { props.setAssigning(movement.movementId); props.setTargetRun(runs.length === 1 ? runs[0].runId : ""); props.setInspector({ kind: "movement", id: movement.movementId }); }} setTargetRun={props.setTargetRun} onConfirm={() => props.assignMovement(movement)} onDragStart={(event) => queueDragStart(event, { kind: "movement", id: movement.movementId, label: movement.to?.label || movement.from?.label || "Movement", type: typeText(movement.type), load: movement.items.map((item) => `${item.quantity} × ${item.description}`).join(" · ") })} />)}</div></aside>
        <section className="mock-schedule" aria-label="Dispatch schedule"><header className="mock-schedule-head"><div><span>PLANNING SURFACE · {selectedDateLabel}</span><h2>Dispatch schedule</h2></div><strong>{runs.length} runs · {summary?.scheduledStops || 0} scheduled · {summary?.needsTime || 0} needs time</strong></header><div className="mock-legend"><span><i className="green-dot" /> Delivery</span><span><i className="blue-dot" /> Collection</span><span><i className="amber-dot" /> Transfer</span><span><i className="red-dot" /> Attention</span><div><button className="active">Day</button><button disabled>Week</button><button>⚙</button></div></div><RealTimeline runs={runs} serviceDate={date} onStop={(runId, stopId) => props.setInspector({ kind: "stop", id: stopId, runId })} onRun={(runId) => props.setInspector({ kind: "run", id: runId })} onSchedule={scheduleStop} onQueueDrop={(kind, id, runId, time, lane, collectionRequired) => assignQueueItem(kind, id, runId, time, lane, collectionRequired)} /><RealScheduleSummary planner={data?.planner} /></section>
      </section>
    </div>
    {props.inspector && data && <Inspector selection={props.inspector} planner={data.planner} rawRequirements={data.requirements} rawStops={data.stops} onClose={() => props.setInspector(undefined)} onAction={handleInspectorAction} runs={runs} targetRun={props.targetRun} setTargetRun={props.setTargetRun} assigning={props.assigning} setAssigning={props.setAssigning} onAssignGroup={props.assignGroup} onAssignMovement={props.assignMovement} />}
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
function RealQueueGroup({ group, runs, queueState, assigning, targetRun, onInspect, onAssign, setTargetRun, onConfirm, onDragStart }: { group: PlannerWorkGroup; runs: PlannerDay["runs"]; queueState: ReturnType<typeof workGroupQueueState>; assigning: boolean; targetRun: string; onInspect: () => void; onAssign: () => void; setTargetRun: (value: string) => void; onConfirm: () => void; onDragStart: (event: DragEvent) => void; }) {
  const eligible = group.requirementRefs.filter((ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended"));
  const assigned = group.requirementRefs.find((ref) => ref.runId);
  const assignedRun = assigned?.runId ? runs.find((run) => run.runId === assigned.runId) : undefined;
  const collectionPending = groupCollectionPending(group, runs);
  const [collectionRequired, setCollectionRequired] = useState(Boolean(group.collectionRequired));
  useEffect(() => setCollectionRequired(Boolean(group.collectionRequired)), [group.collectionRequired]);
  const saveCollectionRequired = (value: boolean) => { setCollectionRequired(value); void fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set-collection-required", by: "Franco", groupKey: group.groupKey, collectionRequired: value }) }).then(() => window.dispatchEvent(new CustomEvent("logistics-collection-preference-updated"))); };
  const collectionToggle = <label className="collection-toggle" onPointerDown={(event) => event.stopPropagation()}><input type="checkbox" checked={collectionRequired} onChange={(event) => { event.stopPropagation(); saveCollectionRequired(event.target.checked); }} /> Collection required</label>;
  const startDrag = (event: DragEvent) => { onDragStart(event); event.dataTransfer.setData("application/x-logistics-collection-required", String(collectionRequired)); };
  return <article draggable={(queueState === "unassigned" && eligible.length > 0) || collectionPending} onDragStart={(queueState === "unassigned" && eligible.length > 0) || collectionPending ? startDrag : undefined} className={`mock-queue-item queue-${queueState}`}><button className="mock-queue-main" onClick={onInspect}><span className="mock-item-time">{formatWindow(group.deliveryWindow) || group.requiredTimes[0] || "Time not confirmed"}</span><span className="mock-type delivery"><b>↓</b> Delivery</span><strong>{group.destinationLabel}</strong><small>{group.sourceLabels.join(" · ")}</small><span className="mock-load">{group.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ")}</span>{assignedRun && <span className="queue-assignment">Assigned to {assignedRun.driver || "Unassigned"} · {assignedRun.runId.split(":").at(-1) || "Run"}</span>}{collectionPending && <span className="queue-assignment">Collection outstanding · place in a collection lane</span>}<span className={`mock-state ${group.attention.length ? "attention" : queueState === "needs_time" ? "needs-time" : "ready"}`}>{group.attention.length ? `⚠ ${group.attention[0]}` : collectionPending ? "⚠ Collection time not confirmed" : queueState === "needs_time" ? "⚠ Time not confirmed" : `● ${group.readiness}`}</span></button>{collectionToggle}<div className="mock-queue-actions"><button onClick={onInspect}>Details</button><button disabled={queueState !== "needs_time" && !eligible.length} onClick={queueState === "needs_time" ? onInspect : onAssign}>{queueState === "needs_time" ? "Set time" : group.planningState === "partially_planned" ? "Assign remaining" : "Assign"}</button><b>⁙</b></div>{assigning && queueState !== "needs_time" && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={onConfirm} label={eligible.length === group.requirementCount ? "Assign all" : "Assign eligible"} />}</article>;
}
function RealQueueMovement({ movement, runs, queueState, assigning, targetRun, onInspect, onAssign, setTargetRun, onConfirm, onDragStart }: { movement: PlannerMovementView; runs: PlannerDay["runs"]; queueState: ReturnType<typeof movementQueueState>; assigning: boolean; targetRun: string; onInspect: () => void; onAssign: () => void; setTargetRun: (value: string) => void; onConfirm: () => void; onDragStart: (event: DragEvent) => void; }) {
  const assigned = movement.assignedStops[0];
  const assignedRun = assigned ? runs.find((run) => run.runId === assigned.runId) : undefined;
  return <article draggable={queueState === "unassigned"} onDragStart={queueState === "unassigned" ? onDragStart : undefined} className={`mock-queue-item queue-${queueState}`}><button className="mock-queue-main" onClick={onInspect}><span className="mock-item-time">{formatWindow(movement.window) || movement.requiredTime || "Time not confirmed"}</span><span className={`mock-type ${movement.type}`}><b>{typeDirection(movement.type)}</b> {typeText(movement.type)}</span><strong>{movement.to?.label || movement.from?.label || "Unknown governed destination"}</strong><small>{movement.from?.label && movement.to ? `${movement.from.label} → ${movement.to.label}` : "Movement"}</small><span className="mock-load">{movement.items.map((item) => `${item.quantity} × ${item.description}`).join(" · ")}</span>{assignedRun && <span className="queue-assignment">Assigned to {assignedRun.driver || "Unassigned"} · {assignedRun.runId.split(":").at(-1) || "Run"}</span>}<span className={`mock-state ${queueState === "needs_time" ? "needs-time" : movement.notes ? "attention" : "ready"}`}>{queueState === "needs_time" ? "⚠ Time not confirmed" : movement.notes ? "⚠ Notes attached" : "● Ready"}</span></button><div className="mock-queue-actions"><button onClick={onInspect}>Details</button><button onClick={queueState === "needs_time" ? onInspect : onAssign}>{queueState === "needs_time" ? "Set time" : "Assign"}</button><b>⁙</b></div>{assigning && queueState !== "needs_time" && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={onConfirm} />}</article>;
}

function LegacyStableTimeline({ runs, serviceDate, onStop, onRun, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", runId: string, targetRunId: string, time?: string) => void; }) {
  const hours = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
  const [zoom, setZoom] = useState(1);
  const [gesture, setGesture] = useState<{ mode: "move" | "resize"; runId: string; stopId: string; start: string; end?: string; pointerId: number }>();
  const [live, setLive] = useState<{ runId: string; stopId: string; start: string; end?: string }>();
  const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
  const endFor = (start: string, value: string) => Math.max(minutes(start) + 15, Math.min(17 * 60, minutes(value)));
  const changeDriver = (run: PlannerDay["runs"][number], driver: string) => { void fetch("/api/logistics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set-run-driver", by: "Franco", runId: run.runId, driverLabel: driver, expectedRunVersion: run.version }) }).then(() => window.location.reload()); };
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
  return <div className="mock-timeline" style={{ "--timeline-scale": timelineZoom } as CSSProperties}><div className="timeline-tools" aria-label="Timeline zoom"><span>Timeline</span><button onClick={() => setTimelineZoom((value) => Math.max(1, value - 0.25))} aria-label="Zoom out">−</button><span>{Math.round(timelineZoom * 100)}%</span><button onClick={() => setTimelineZoom((value) => Math.min(2.5, value + 0.25))} aria-label="Zoom in">＋</button></div><div className="mock-ruler"><span>Time</span>{hours.map((hour) => <b key={hour}>{hour}</b>)}</div>{runs.map((run, index) => { const needsTime = run.stops.filter((stop) => !hasUsableSchedule(stop)).length; const scheduled = run.stops.length - needsTime; return <div className="mock-driver-row" key={run.runId}><div className="mock-driver" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId); } event.currentTarget.classList.remove("drop-target"); }}><b>{(run.driver || "??").slice(0, 2).toUpperCase()}</b><div><strong>{run.driver || "Unassigned"}</strong><span><button className="mock-run-link" onClick={() => onRun(run.runId)}>Run {index + 1} · {run.status.toUpperCase()}</button></span><small>{scheduled} scheduled · {needsTime} needs time</small></div></div><div className="mock-track" onPointerMove={(event) => { if (!resize || resize.pointerId !== event.pointerId) return; const end = timeAt(event, event.currentTarget); const validEnd = minutes(end) <= minutes(resize.start) ? resize.start : end; updatePreview(run.runId, resize.start, run.stops.find((item) => item.stopId === resize.stopId)?.destination.label || "Stop", resize.stopId, validEnd); }} onPointerUp={(event) => { if (!resize || resize.pointerId !== event.pointerId) return; const end = timeAt(event, event.currentTarget); if (minutes(end) > minutes(resize.start)) onSchedule(run.runId, resize.stopId, run.runId, resize.start, end); else setPreview(undefined); setResize(undefined); }} onDragOver={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); const value = event.dataTransfer.getData("application/x-logistics-stop"); if (queue) updatePreview(run.runId, timeAt(event, event.currentTarget), "Work"); else if (value) { const [, stopId] = value.split("|"); const stop = runs.flatMap((item) => item.stops).find((item) => item.stopId === stopId); updatePreview(run.runId, timeAt(event, event.currentTarget), stop?.destination.label || "Stop", stopId); } event.currentTarget.classList.add("drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")} onDrop={(event) => { handleDrop(event, run, event.currentTarget); event.currentTarget.classList.remove("drop-target"); }}>{hours.map((hour) => <i key={hour} />)}{nowPosition !== undefined && <i className="mock-now-line" style={{ left: `${nowPosition}%` }} />}{preview?.runId === run.runId && <div className={`timeline-preview ${preview.overlap ? "overlap" : ""}`} style={{ left: `${timePosition(preview.time) ?? 0}%` }}><b>{preview.time}{preview.end ? `–${preview.end}` : ""}</b><span>{preview.label}</span>{preview.overlap && <em>⚠ Overlaps another stop</em>}</div>}{run.stops.filter(hasUsableSchedule).map((stop) => { const time = stop.plannedWindow?.startTime || stop.plannedArrivalTime!; const end = stop.plannedWindow?.endTime; const left = timePosition(time); const width = end ? Math.max(1.5, (minutes(end) - minutes(time)) / (11 * 60) * 100 : 3); return <button draggable={stop.movementTypes.includes("transfer") ? false : true} key={stop.stopId} className={`mock-stop ${stop.movementTypes[0] || "delivery"} ${stop.attention.length ? "attention" : ""}`} style={{ left: `${left ?? 0}%`, width: `${width}%` }} onDragStart={(event) => { event.dataTransfer.setData("application/x-logistics-stop", `${run.runId}|${stop.stopId}`); }} onClick={() => onStop(run.runId, stop.stopId)} onPointerDown={(event) => { const target = event.target as HTMLElement; if (!target.classList.contains("resize-handle")) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setResize({ runId: run.runId, stopId: stop.stopId, start: time, pointerId: event.pointerId }); }}><small>{time}{end ? `–${end}` : ""}</small><strong>{stop.destination.label}</strong><span>{formatWindow(stop.plannedWindow) || stop.unitBreakdown.map((item) => `${item.quantity} ${item.unit}`).join(" · ") || "Work"}</span>{end && <i className="resize-handle" aria-label="Resize planned window" />}</button>; })}</div></div>; })}</div>;
}

*/
function StableTimelineLane({ run, lane, zoom, onStop, onSchedule, onQueueDrop }: { run: PlannerDay["runs"][number]; lane: "delivery" | "collection"; zoom: number; onStop: (runId: string, stopId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", id: string, runId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => void; }) {
  const [gesture, setGesture] = useState<{ mode: "move" | "resize"; stopId: string; start: string; end?: string; pointerId: number }>();
  const [live, setLive] = useState<{ start: string; end?: string }>();
  const origin = lane === "delivery" ? 6 * 60 : 12 * 60;
  const span = 6 * 60;
  const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
  const timeAt = (clientX: number, rect: DOMRect) => { const value = origin + ((clientX - rect.left) / rect.width) * span; const snapped = Math.max(origin, Math.min(origin + span, Math.round(value / 15) * 15)); return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`; };
  const stops = run.stops.filter((stop) => stop.lane === lane);
  return <div className={`stable-lane ${lane}`} aria-label={`${run.vehicle || "Vehicle"} ${lane} lane`} onPointerMove={(event) => { if (!gesture || event.pointerId !== gesture.pointerId) return; const snapped = timeAt(event.clientX, event.currentTarget.getBoundingClientRect()); if (gesture.mode === "resize") { const end = Math.max(minutes(gesture.start) + 15, minutes(snapped)); setLive({ start: gesture.start, end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` }); } else { const duration = gesture.end ? minutes(gesture.end) - minutes(gesture.start) : 0; const start = minutes(snapped); const end = duration ? Math.min(origin + span, start + duration) : undefined; setLive({ start: snapped, end: end ? `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` : undefined }); } }} onPointerUp={(event) => { if (!gesture || event.pointerId !== gesture.pointerId) return; const final = live || { start: gesture.start, end: gesture.end }; onSchedule(run.runId, gesture.stopId, run.runId, final.start, final.end); setGesture(undefined); setLive(undefined); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const time = timeAt(event.clientX, event.currentTarget.getBoundingClientRect()); const queue = event.dataTransfer.getData("application/x-logistics-queue"); const stopValue = event.dataTransfer.getData("application/x-logistics-stop"); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; const collectionRequired = event.dataTransfer.getData("application/x-logistics-collection-required") === "true"; onQueueDrop(payload.kind, payload.id, run.runId, time, lane, collectionRequired); } else if (stopValue) { const [sourceRunId, stopId] = stopValue.split("|"); onSchedule(sourceRunId, stopId, run.runId, time); } }}>
    {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
    {stops.filter(hasUsableSchedule).map((stop) => { const sourceStart = stop.plannedWindow?.startTime || stop.plannedArrivalTime!; const sourceEnd = stop.plannedWindow?.endTime; const active = live && gesture?.stopId === stop.stopId ? live : undefined; const start = active?.start || sourceStart; const end = active?.end || sourceEnd; const left = ((minutes(start) - origin) / span) * 100; const width = end ? Math.max(4, ((minutes(end) - minutes(start)) / span) * 100) : 4; return <button key={stop.stopId} data-stop-id={stop.stopId} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-logistics-stop", `${run.runId}|${stop.stopId}`); setGesture(undefined); setLive(undefined); }} onDragEnd={() => { setGesture(undefined); setLive(undefined); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const queue = event.dataTransfer.getData("application/x-logistics-queue"); if (queue) { const payload = JSON.parse(queue) as { kind: "group" | "movement"; id: string }; onQueueDrop(payload.kind, payload.id, run.runId, timeAt(event.clientX, event.currentTarget.parentElement!.getBoundingClientRect()), lane); } }} className={`stable-stop ${lane} ${active ? "gesture-active" : ""} ${stop.attention.length ? "attention" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => onStop(run.runId, stop.stopId)} onPointerDown={(event) => { const isResize = Boolean((event.target as HTMLElement).closest(".resize-handle")); event.stopPropagation(); if (isResize) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } setGesture({ mode: isResize ? "resize" : "move", stopId: stop.stopId, start: sourceStart, end: sourceEnd, pointerId: event.pointerId }); }}><small>{start}{end ? `–${end}` : ""}</small><strong>{stop.destination.label}</strong><span>{lane === "collection" ? "Collection" : "Delivery"}</span><span className="resize-handle" aria-label="Resize planned window" /></button>; })}
  </div>;
}

function RealTimeline({ runs, onStop, onRun, onSchedule, onQueueDrop }: { runs: PlannerDay["runs"]; serviceDate: string; onStop: (runId: string, stopId: string) => void; onRun: (runId: string) => void; onSchedule: (sourceRunId: string, stopId: string, targetRunId: string, time: string, end?: string) => void; onQueueDrop: (kind: "group" | "movement", runId: string, targetRunId: string, time?: string, lane?: "delivery" | "collection", collectionRequired?: boolean) => void; }) {
  const [zoom, setZoom] = useState(1.5);
  const hours = (start: number) => Array.from({ length: 7 }, (_, index) => start + index);
  if (!runs.length) return <div className="mock-timeline"><Empty title="No dispatch runs" body="Vehicle-day runs will appear automatically." /></div>;
  const renderGroup = (lane: "delivery" | "collection", label: string, start: number) => <section className={`stable-group ${lane}-group`} aria-label={label}><header className="stable-section-heading"><strong>{label}</strong></header><div className={`stable-ruler ${lane}-ruler`}><span aria-hidden="true" />{hours(start).map((hour) => <b key={hour}>{String(hour).padStart(2, "0")}:00</b>)}</div>{runs.map((run, index) => <div className="stable-vehicle-row" key={`${lane}-${run.runId}`}><div className="stable-driver"><strong>{run.vehicle || `Van ${index + 1}`}</strong><button className="mock-run-link" onClick={() => onRun(run.runId)}>Run {index + 1} · {run.status.toUpperCase()}</button><span>{run.driver || "Select driver"}</span><small>{run.scheduledStopCount} scheduled · {run.needsTimeStopCount} needs time</small></div><StableTimelineLane run={run} lane={lane} zoom={zoom} onStop={onStop} onSchedule={onSchedule} onQueueDrop={onQueueDrop} /></div>)}</section>;
  return <div className="mock-timeline stable-timeline" style={{ "--timeline-scale": zoom } as CSSProperties}><div className="timeline-tools" aria-label="Timeline zoom"><span>Timeline</span><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.75, value - .25))}>−</button><span>{Math.round((zoom / 1.5) * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.25, value + .25))}>＋</button></div>{renderGroup("delivery", "DELIVERIES · 06:00–12:00", 6)}{renderGroup("collection", "COLLECTIONS · 12:00–18:00", 12)}</div>;
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
  return <footer className="mock-summary"><div><b>▣</b><strong>{planner.runs.length}</strong><span>Active runs</span></div><div><b>⌖</b><strong>{planner.summary.scheduledStops} / {stops}</strong><span>Stops scheduled</span></div><div><b>◇</b><strong>{assignedWork}</strong><span>Assigned work items</span></div><div><b>◷</b><strong>{planner.summary.needsTime}</strong><span>Need time</span></div><div className="attention"><b>!</b><strong>{openIssues + planner.summary.attention}</strong><span>Attention / issues</span></div></footer>;
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
    (ref) => !ref.runId && (ref.status === "ready_for_planning" || ref.status === "amended"),
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
  return <aside className="mock-inspector" aria-label="Details inspector">
    <header><div><p className="eyebrow">Inspector</p><h2>{group?.destinationLabel || movement?.type || stop?.destination.label || run?.driver || "Details"}</h2></div><button className="close" onClick={onClose} aria-label="Close inspector">×</button></header>
    {group && <>
      <InspectorMeta label="Timing" value={formatWindow(group.deliveryWindow) || group.requiredTimes[0] || "Unscheduled"} />
      <label className="collection-toggle inspector-collection-toggle"><input type="checkbox" checked={Boolean(group.collectionRequired)} onChange={(event) => onAction({ action: "set-collection-required", by: "Franco", groupKey: group.groupKey, collectionRequired: event.target.checked })} /> Collection required</label>
      <InspectorMeta label="Source" value={group.sourceLabels.join(" · ")} />
      <h3>Load</h3><ul className="inspector-list">{group.combinedLines.map((line) => <li key={line.lineKey}>{line.quantity} {line.unit} · {line.displayName}</li>)}</ul>
      {group.productionContext && <p className="context-line"><strong>{group.productionContext.clientName}</strong>{group.productionContext.guestCount !== undefined && ` · ${group.productionContext.guestCount} guests`}</p>}
      {group.attention.map((item) => <div className="attention-note" key={item}>⚠ {item}</div>)}
      <div className="inspector-actions"><button onClick={() => { setAssigning(group.groupKey); setTargetRun(runs.length === 1 ? runs[0].runId : ""); }}>Assign to run</button></div>
      {assigning === group.groupKey && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={() => onAssignGroup(group)} label="Assign eligible" />}
    </>}
    {movement && <>
      <InspectorMeta label="Direction" value={`${movement.from?.label || "Origin"}${movement.to ? ` → ${movement.to.label}` : ""}`} />
      <InspectorMeta label="Timing" value={formatWindow(movement.window) || movement.requiredTime || "Unscheduled"} />
      <h3>Items</h3><ul className="inspector-list">{movement.items.map((item, index) => <li key={`${item.description}-${index}`}>{item.quantity} × {item.description}</li>)}</ul>
      {movement.notes && <p className="notes-block">Notes: {movement.notes}</p>}
      <div className="inspector-actions"><button onClick={() => { setAssigning(movement.movementId); setTargetRun(runs.length === 1 ? runs[0].runId : ""); }}>Assign to run</button></div>
      {assigning === movement.movementId && <RunChooser runs={runs} targetRun={targetRun} setTargetRun={setTargetRun} onConfirm={() => onAssignMovement(movement)} />}
    </>}
    {run && <>
      <InspectorMeta label="Status" value={run.status.toUpperCase()} />
      <InspectorMeta label="Vehicle" value={run.vehicle || "No vehicle label"} />
      <p>{run.completedStops} of {run.stopCount} stops complete</p>
      {run.readiness.blockers.map((item) => <div className="attention-note" key={item}>⚠ {item}</div>)}
      <div className="inspector-actions">
        {run.status === "planned" && <button disabled={!run.readiness.ready} onClick={() => onAction({ action: "mark-run-ready", by: "Franco", runId: run.runId, expectedRunVersion: run.version })}>Mark ready</button>}
        {run.status === "ready" && <button className="secondary" onClick={() => onAction({ action: "return-run-to-planning", by: "Franco", runId: run.runId, expectedRunVersion: run.version })}>Return to planning</button>}
      </div>
    </>}
    {stop && rawStop && <><div className="inspector-actions"><button className="secondary" onClick={() => onAction({ action: "return-stop-to-planning", by: "Franco", runId: rawStop.runId, stopId: stop.stopId, expectedRunVersion: planner.runs.find((item) => item.runId === rawStop.runId)!.version, expectedStopVersion: rawStop.version })}>Return to planning queue</button></div><ScheduleEditor stop={stop} run={planner.runs.find((item) => item.runId === rawStop.runId)!} rawStop={rawStop} onAction={onAction} /><StopPanel stop={stop} index={Math.max(0, stop.sequence - 1)} run={planner.runs.find((item) => item.runId === rawStop.runId)!} runs={runs} rawStop={rawStop} rawRequirements={rawRequirements} expanded onToggle={() => undefined} onAction={onAction} /></>}
  </aside>;
}

function ScheduleEditor({ stop, run, rawStop, onAction }: { stop: PlannerDay["runs"][number]["stops"][number]; run: PlannerDay["runs"][number]; rawStop: DeliveryStop; onAction: (payload: object) => void }) {
  const [start, setStart] = useState(stop.plannedWindow?.startTime || stop.plannedArrivalTime || "");
  const [end, setEnd] = useState(stop.plannedWindow?.endTime || "");
  return <div className="schedule-editor"><h3>Planned timing</h3><p className="context-line">Logistics timing only; upstream required timing remains unchanged.</p><label>Start / arrival <input type="time" step={900} value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Window end <input type="time" step={900} value={end} onChange={(event) => setEnd(event.target.value)} /></label><div className="inspector-actions"><button disabled={!start || (end !== "" && end <= start)} onClick={() => onAction({ action: "schedule-stop", by: "Franco", runId: run.runId, stopId: stop.stopId, plannedWindow: end ? { startTime: start, endTime: end } : undefined, plannedArrivalTime: end ? undefined : start, expectedRunVersion: run.version, expectedStopVersion: rawStop.version })}>Save time</button>{stop.plannedWindow || stop.plannedArrivalTime ? <button className="secondary" onClick={() => onAction({ action: "clear-stop-schedule", by: "Franco", runId: run.runId, stopId: stop.stopId, expectedRunVersion: run.version, expectedStopVersion: rawStop.version })}>Clear time</button> : null}</div></div>;
}

function InspectorMeta({ label, value }: { label: string; value: string }) {
  return <p className="inspector-meta"><span>{label}</span><strong>{value}</strong></p>;
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
  driver,
  setDriver,
  onCreate,
  onClose,
}: {
  driver: string;
  setDriver: (value: string) => void;
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
          value={driver}
          onChange={(event) => setDriver(event.target.value)}
        >
          <option>Franco</option>
          <option>Dee</option>
        </select>
      </label>
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
        <option value="">Choose a run</option>
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
      (ref.status === "ready_for_planning" || ref.status === "amended"),
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
          <label className="run-driver-control">Driver <select value={run.driver || ""} aria-label="Driver" onChange={(event) => onAction({ action: "set-run-driver", by: "Franco", runId: run.runId, driverLabel: event.target.value, expectedRunVersion: run.version })}><option value="">Select driver</option><option>Franco</option><option>Dee</option></select></label>
        </div>
        <span className="run-status">{run.status}</span>
      </header>
      <div className="run-summary">
        <span>
          {run.completedStops} / {run.stopCount} stops complete
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
                by: "Franco",
                runId: run.runId,
                expectedRunVersion: run.version,
              })
            }
          >
            Mark ready
          </button>
        )}
        {run.status === "ready" && (
          <button
            className="secondary"
            onClick={() =>
              onAction({
                action: "return-run-to-planning",
                by: "Franco",
                runId: run.runId,
                expectedRunVersion: run.version,
              })
            }
          >
            Return to planning
          </button>
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
      <details className="debug-meta">
        <summary>Run details</summary>
        <small>{run.runId}</small>
      </details>
    </article>
  );
}
function swap(values: string[], a: number, b: number) {
  const next = [...values];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
function StopPanel({
  stop,
  index,
  run,
  runs,
  rawStop,
  rawRequirements,
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
  expanded: boolean;
  onToggle: () => void;
  onAction: (payload: object) => void;
}) {
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
        <em>{stop.status}</em>
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
                    by: "Franco",
                    runId: run.runId,
                    stopId: stop.stopId,
                    issueId: issue.id,
                    expectedRunVersion: run.version,
                    expectedStopVersion: rawStop.version,
                    resolutionNotes: "Resolved by planner",
                  })
                }
              >
                Resolve
              </button>
            </div>
          ))}
      {expanded && rawStop && (
        <div className="stop-detail">
          <p>
            {stop.combinedLines
              .map(
                (line) => `${line.quantity} ${line.unit} · ${line.displayName}`,
              )
              .join(" · ")}
          </p>
          {rawStop.requirementRefs.map((ref) => (
            <div className="attached-work" key={ref.requirementId}>
              <span>
                {sourceLabel(
                  rawRequirements.find(
                    (item) => item.canonicalId === ref.requirementId,
                  )?.sourceDomain || "menu-planning",
                )}
              </span>
              <strong>
                {rawRequirements.find(
                  (item) => item.canonicalId === ref.requirementId,
                )?.sourceEntityId || ref.requirementId}
              </strong>
              <button
                onClick={() =>
                  onAction({
                    action: "unassign-requirement",
                    by: "Franco",
                    runId: run.runId,
                    stopId: stop.stopId,
                    requirementId: ref.requirementId,
                    expectedRunVersion: run.version,
                    expectedStopVersion: rawStop.version,
                  })
                }
              >
                Unassign
              </button>
            </div>
          ))}
          {rawStop.movementRequestIds.map((movementId) => (
            <div className="attached-work" key={movementId}>
              <span>Movement</span>
              <strong>{movementId}</strong>
              <button
                onClick={() =>
                  onAction({
                    action: "unassign-movement",
                    by: "Franco",
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
            <button
              disabled={index === 0}
              onClick={() =>
                onAction({
                  action: "reorder",
                  by: "Franco",
                  runId: run.runId,
                  stopIds: swap(
                    run.stops.map((item) => item.stopId),
                    index,
                    index - 1,
                  ),
                  expectedRunVersion: run.version,
                })
              }
            >
              ↑ Up
            </button>
            <button
              disabled={index === run.stops.length - 1}
              onClick={() =>
                onAction({
                  action: "reorder",
                  by: "Franco",
                  runId: run.runId,
                  stopIds: swap(
                    run.stops.map((item) => item.stopId),
                    index,
                    index + 1,
                  ),
                  expectedRunVersion: run.version,
                })
              }
            >
              ↓ Down
            </button>
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value)
                  onAction({
                    action: "move-stop",
                    by: "Franco",
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
              <option value="">Move to run…</option>
              {runs
                .filter((item) => item.runId !== run.runId)
                .map((item) => (
                  <option key={item.runId} value={item.runId}>
                    {item.driver || "Unassigned"}
                  </option>
                ))}
            </select>
            <button
              onClick={() =>
                onAction({
                  action: "defer-stop",
                  by: "Franco",
                  runId: run.runId,
                  stopId: stop.stopId,
                  expectedRunVersion: run.version,
                  expectedStopVersion: rawStop.version,
                })
              }
            >
              Defer
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
        </div>
        <button className="close" onClick={onClose}>
          ×
        </button>
      </header>
      {!oplocs.length ? (
        <Empty
          title="Governed OPLOCs unavailable"
          body="New movements are disabled until Integration Hub locations recover."
        />
      ) : (
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
                oplocs={oplocs}
              />
            )}
            {draft.type !== "collection" && (
              <OplocField
                label="To OPLOC"
                value={draft.to}
                onChange={(value) => field("to", value)}
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
      )}
    </section>
  );
}
function OplocField({
  label,
  value,
  onChange,
  oplocs,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  oplocs: Oploc[];
}) {
  return (
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
  );
}
