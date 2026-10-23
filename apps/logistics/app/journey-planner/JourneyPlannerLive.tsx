"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PlannerDay } from "../../lib/planner-read-model";
import { groupIntoVisitRows } from "../../lib/stop-visits";
import type { StopPiece } from "../../lib/run-stop-order";
import { inspectorFor, queueItemsFromWork, runRows, type QueueWork } from "./adapter";
import { JourneyPlannerShell, type ShellActions, type ShellNotice } from "./JourneyPlannerShell";
import { PlaceWorkDialog } from "./PlaceWorkDialog";
import type { PlannerStatus, PlannerViewModel, RunRowView } from "./model";
import type { NewCollection } from "./RunInspector";

export type LiveCreatingRun = { id: string; vehicleId: string; start?: string; end?: string };

/** What the live planner asks of the existing Logistics command handlers. All ids are canonical; nothing here talks to the network. */
export type LiveCallbacks = {
  selectRun: (runId: string) => void;
  closeInspector: () => void;
  createRun: (vehicleId: "van1" | "van2", departure?: string, returnTime?: string) => void;
  runTiming: (runId: string, departure: string, returnTime: string) => void;
  queueOpen: (itemId: string) => void;
  /** Returns "needs-time" when the work has no requested time and Franco must choose one. */
  queueDrop: (itemId: string, runId: string, time?: string) => "needs-time" | void;
  newCollection: () => void;
  newMovement: () => void;
  saveOrder: (runId: string, stopIds: string[]) => void;
  addCollection: (runId: string, collection: NewCollection) => void;
  returnStop: (runId: string, stopId: string) => void;
  viewStop: (runId: string, stopId: string) => void;
  retireRun: (runId: string) => void;
  dateStep: (delta: -1 | 1) => void;
  dateSet: (date: string) => void;
  thisWeek: () => void;
  refresh: () => void;
};

export type LiveProps = {
  date: string;
  dateLabel: string;
  planner: PlannerDay;
  /** The schedulable runs the host plans against (already filtered by the host). */
  runs: PlannerDay["runs"];
  /** Selected run (any inspector selection inside a run highlights its row). */
  selectedRunId?: string;
  /** Show the V3 Run inspector (selection is the run itself). Otherwise `sidePanel` carries stop/load/queue details. */
  runInspectorOpen: boolean;
  status: PlannerStatus;
  pendingRunTimings: Record<string, { start: string; end: string }>;
  creatingRuns: LiveCreatingRun[];
  queueWork: QueueWork;
  pendingQueueIds: ReadonlySet<string>;
  pieces: Record<string, StopPiece[]>;
  /** The host is mid-command (used to keep order saving distinct from idle). */
  busy: boolean;
  notices: ShellNotice[];
  fetchedAt?: string;
  refreshing: boolean;
  refreshDisabled?: boolean;
  newMovementDisabled?: boolean;
  healthNote?: ReactNode;
  sidePanel?: ReactNode;
  modals?: ReactNode;
  callbacks: LiveCallbacks;
};

const londonMinuteNow = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")!.value) % 24 * 60 + Number(parts.find((part) => part.type === "minute")!.value);
};
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * The Journey Planner V3 screen on live Logistics data: maps the canonical planner read model to the
 * presentation model and maps UI events to the host's EXISTING command handlers.
 */
export function JourneyPlannerLive(props: LiveProps) {
  const { planner, callbacks } = props;
  const [now, setNow] = useState<number | undefined>();
  const [placing, setPlacing] = useState<{ itemId: string; runId: string }>();
  const today = props.date === londonToday();
  useEffect(() => {
    if (!today) { setNow(undefined); return; }
    setNow(londonMinuteNow());
    const timer = window.setInterval(() => setNow(londonMinuteNow()), 60_000);
    return () => window.clearInterval(timer);
  }, [today]);

  const model = useMemo<PlannerViewModel>(() => {
    // Proposed (unconfirmed) run times are shown as such: the row says "Saving…" until the server confirms.
    const overlaid: PlannerDay = { ...planner, runs: props.runs.map((run) => {
      const pending = props.pendingRunTimings[run.runId];
      return pending ? { ...run, plannedCpuDepartureTime: pending.start, plannedCpuReturnTime: pending.end } : run;
    }) };
    const context = { dateLabel: props.dateLabel, user: { initials: "LP", name: "Logistics planner", role: "Signed in" }, pieces: props.pieces, pendingRunIds: new Set(Object.keys(props.pendingRunTimings)), pendingQueueIds: props.pendingQueueIds };
    const rows = runRows(overlaid, context);
    // A run being created disappears the moment the confirmed run (same canonical id) is on the board: never two rows for one run.
    const creating: RunRowView[] = props.creatingRuns.filter((item) => !props.runs.some((run) => run.runId === item.id)).map((item) => ({
      id: item.id, title: "New Run", vehicleId: item.vehicleId === "van2" ? "van2" : "van1", vehicleLabel: item.vehicleId === "van2" ? "Van 2" : "Van 1", status: "draft",
      ...(item.start && item.end ? { departure: item.start, return: item.end } : {}),
      stopCount: 0, loadCount: 0, chips: [{ key: `${item.id}:out`, kind: "cpu-departure", label: "CPU" }, { key: `${item.id}:in`, kind: "cpu-return", label: "CPU" }],
      pending: true, canRetire: false, editable: false,
    }));
    const all = [...rows, ...creating];
    const selected = all.find((row) => row.id === props.selectedRunId);
    const inspectorRow = props.runInspectorOpen ? selected : undefined;
    return {
      dateLabel: props.dateLabel,
      vehicles: [{ id: "van1", label: "Van 1" }, { id: "van2", label: "Van 2" }],
      queue: queueItemsFromWork(props.queueWork, context),
      runs: all,
      ...(selected ? { selectedRunId: selected.id } : {}),
      ...(now !== undefined ? { nowMinute: now } : {}),
      user: context.user,
      ...(inspectorRow ? { inspector: inspectorFor(overlaid, inspectorRow, context) } : {}),
    };
  }, [planner, props.runs, props.pendingRunTimings, props.creatingRuns, props.dateLabel, props.pieces, props.queueWork, props.pendingQueueIds, props.selectedRunId, props.runInspectorOpen, now]);

  const memberStopIds = (runId: string, key: string) => {
    const run = props.runs.find((candidate) => candidate.runId === runId);
    return run ? groupIntoVisitRows(run.stops).find((row) => row.key === key)?.stops.map((stop) => stop.stopId) ?? [] : [];
  };
  const actions: ShellActions = {
    onSelectRun: callbacks.selectRun,
    onSelectStop: (runId) => callbacks.selectRun(runId),
    onCloseInspector: callbacks.closeInspector,
    onCreateRun: (input) => callbacks.createRun(input.vehicleId, input.departure, input.return),
    onRunTiming: callbacks.runTiming,
    onQueueOpen: callbacks.queueOpen,
    onQueueDrop: (itemId, runId) => { if (callbacks.queueDrop(itemId, runId) === "needs-time") setPlacing({ itemId, runId }); },
    onNewCollection: callbacks.newCollection,
    onSaveOrder: callbacks.saveOrder,
    onAddCollection: callbacks.addCollection,
    onReturnStop: (runId, key) => memberStopIds(runId, key).forEach((stopId) => callbacks.returnStop(runId, stopId)),
    onViewStop: (runId, key) => { const [stopId] = memberStopIds(runId, key); if (stopId) callbacks.viewStop(runId, stopId); },
    onRetireRun: callbacks.retireRun,
    onDateStep: callbacks.dateStep,
    onDateSet: callbacks.dateSet,
    onThisWeek: callbacks.thisWeek,
    onRetryLoad: callbacks.refresh,
  };
  const placingItem = placing ? model.queue.find((item) => item.id === placing.itemId) : undefined;
  const placingRun = placing ? model.runs.find((run) => run.id === placing.runId) : undefined;
  const statusLine = <>
    <span aria-live="polite">{props.refreshing ? "Refreshing…" : props.fetchedAt ? `Last updated ${new Date(props.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for data"}</span>
    <button type="button" onClick={callbacks.refresh} disabled={props.refreshing || props.refreshDisabled} aria-busy={props.refreshing}>{props.refreshing ? "Refreshing…" : "↻ Refresh"}</button>
    <button type="button" onClick={callbacks.newMovement} disabled={props.newMovementDisabled}>＋ New movement</button>
    {props.healthNote}
  </>;
  return <JourneyPlannerShell
    model={model} status={props.status} actions={actions} saving={props.busy} dateValue={props.date}
    notices={props.notices} statusLine={statusLine} creatingRun={props.creatingRuns.length > 0}
    sidePanel={props.sidePanel}
    modals={<>
      {props.modals}
      {placing && placingItem && placingRun && <PlaceWorkDialog destination={placingItem.destination} runTitle={placingRun.title} kind={placingItem.kind} onClose={() => setPlacing(undefined)} onPlace={(time) => { const target = placing; setPlacing(undefined); callbacks.queueDrop(target.itemId, target.runId, time); }} />}
    </>}
  />;
}
