"use client";

import { useMemo, useState } from "react";
import { deriveTimelineQueueCards, MountedReactTimeline, type QueueCard } from "../../mounted-react-timeline";
import type { PlannerDay } from "../../../lib/planner-read-model";
import { createPendingScheduleOperation, type ConfirmedPlacement, type PendingScheduleOperation, type SchedulePosition } from "../../../lib/scheduling";

type Mode = "success" | "delayed" | "reject" | "adjust";
const date = "2026-09-30";
const addQuarter = (start: string) => { const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + 15; return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };
const mkStop = (stopId: string, destination: string, runId: string, lane: "delivery" | "collection", start?: string, end?: string, reqId?: string) => ({
  stopId, sequence: 1, destination: { id: `site:${stopId}`, label: destination }, ...(start && !end ? { plannedArrivalTime: start } : {}), ...(start && end ? { plannedWindow: { startTime: start, endTime: end } } : {}), requirementCount: reqId ? 2 : 1, movementCount: 0, movementTypes: [lane], sourceLabels: [], combinedLines: reqId ? [{ lineKey: reqId, displayName: destination, unit: "load", quantity: 1, requirementRefs: [reqId], sourceLineRefs: [{ requirementId: reqId, lineId: "line-1" }] }] : [], unitBreakdown: [], attention: [], status: "planned" as const, lane, operationalStatus: "scheduled" as const,
});
const fixturePlanner = (): PlannerDay => ({
  serviceDate: date, workGroups: [{
    groupKey: "projection-collection:load-1", serviceDate: date, destinationOplocId: "site:projected", destinationLabel: "Projected Collection", requiredTimes: [],
    requirementRefs: [{ requirementId: "load-1", sourceVersion: 1, sourceDomain: "grab-and-go", sourceEntityId: "load-1", status: "ready_for_planning", workstream: "Grab & Go", runId: "run-1", stopId: "projection-stop:collection:load-1" }],
    requirementCount: 1, sourceLabels: ["Projection"], combinedLines: [], unitBreakdown: [], readiness: "READY", attention: [], planningState: "partially_planned", collectionRequired: true,
  } as PlannerDay["workGroups"][number], {
    groupKey: "group-partial-delivery", serviceDate: date, destinationOplocId: "site:partial", destinationLabel: "Partially planned delivery", requiredTimes: [],
    requirementRefs: [
      { requirementId: "req-bridge", sourceVersion: 1, sourceDomain: "grab-and-go", sourceEntityId: "bridge", status: "ready_for_planning", workstream: "Grab & Go", runId: "run-1", stopId: "stop-bridgepoint" },
      { requirementId: "req-unassigned", sourceVersion: 1, sourceDomain: "grab-and-go", sourceEntityId: "partial", status: "ready_for_planning", workstream: "Grab & Go" },
    ],
    requirementCount: 2, sourceLabels: ["Fixture"], combinedLines: [], unitBreakdown: [], readiness: "READY", attention: [], planningState: "partially_planned",
  } as PlannerDay["workGroups"][number]], movements: [], summary: {} as PlannerDay["summary"], upstreamHealth: {} as PlannerDay["upstreamHealth"],
  runs: [
    { runId: "run-1", serviceDate: date, driver: "Andy Carter", vehicle: "Van North", status: "planned", operationalStatus: "planned", returnToCpuRequired: false, returnReady: true, completedCollections: 0, remainingCollections: 0, version: 1, stopCount: 4, scheduledStopCount: 3, needsTimeStopCount: 1, completedStops: 0, openIssueCount: 0, readiness: { ready: true, blockers: [] }, stops: [mkStop("stop-mnk", "MNK", "run-1", "delivery", "07:30"), mkStop("stop-bridgepoint", "Bridgepoint", "run-1", "delivery", "08:00", undefined, "req-bridge"), mkStop("stop-riverside", "Riverside", "run-1", "collection", "10:00", "11:00"), mkStop("projection-stop:collection:load-1", "Projected Collection", "run-1", "collection")] },
    { runId: "run-2", serviceDate: date, driver: "Sam Lee", vehicle: "Van South", status: "planned", operationalStatus: "planned", returnToCpuRequired: false, returnReady: true, completedCollections: 0, remainingCollections: 0, version: 1, stopCount: 2, scheduledStopCount: 2, needsTimeStopCount: 0, completedStops: 0, openIssueCount: 0, readiness: { ready: true, blockers: [] }, stops: [mkStop("stop-haleon", "Haleon", "run-2", "delivery", "08:15"), mkStop("stop-window-30", "Thirty minute window", "run-2", "delivery", "09:00", "09:30")] },
    { runId: "run-3", serviceDate: date, driver: "Alex Morgan", vehicle: "Van East", status: "planned", operationalStatus: "planned", returnToCpuRequired: false, returnReady: true, completedCollections: 0, remainingCollections: 0, version: 1, stopCount: 6, scheduledStopCount: 6, needsTimeStopCount: 0, completedStops: 0, openIssueCount: 0, readiness: { ready: true, blockers: [] }, stops: Array.from({ length: 6 }, (_, index) => mkStop(`stop-overlap-${index + 1}`, `Overlap ${index + 1}`, "run-3", "delivery", "09:00")) },
    { runId: `projection-run:${date}:unassigned`, serviceDate: date, driver: "Projection placeholder", vehicle: "Unassigned", status: "planned", operationalStatus: "planned", returnToCpuRequired: false, returnReady: true, completedCollections: 0, remainingCollections: 0, version: 1, stopCount: 1, scheduledStopCount: 1, needsTimeStopCount: 0, completedStops: 0, openIssueCount: 0, readiness: { ready: true, blockers: [] }, stops: [mkStop("stop-placeholder", "Must not render", `projection-run:${date}:unassigned`, "delivery", "09:00")] },
  ],
} as PlannerDay);

export default function MountedTimelineFixturePage() {
  const [planner, setPlanner] = useState(fixturePlanner);
  const [queueItems, setQueueItems] = useState<QueueCard[]>([
    { id: "queue-bridge", kind: "group", destination: "Bridgepoint Queue", lane: "delivery", loadCount: 2, workIds: ["req-queue"], draggable: true },
    { id: "queue-collection", kind: "movement", destination: "Returns", lane: "collection", loadCount: 1, workIds: ["move-return"], draggable: true },
  ]);
  const [pending, setPending] = useState<Record<string, PendingScheduleOperation>>({});
  const [confirmed, setConfirmed] = useState<Record<string, ConfirmedPlacement>>({});
  const [mode, setMode] = useState<Mode>("delayed");
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState("Safe mounted timeline fixture · no Logistics API requests.");
  const [selected, setSelected] = useState<string>();
  const [windowEnd, setWindowEnd] = useState("11:00");
  const queueCards = useMemo(() => [...queueItems, ...deriveTimelineQueueCards(planner.workGroups, planner.movements, planner.runs, pending)], [queueItems, planner, pending]);

  const complete = (identity: string, operation: PendingScheduleOperation, value: Mode) => {
    if (value === "reject") { setPending((current) => { const next = { ...current }; delete next[identity]; return next; }); setMessage("Fixture rejected · confirmed placement restored."); return; }
    const proposed = operation.proposed!;
    const adjusted: SchedulePosition = value === "adjust" ? { ...proposed, start: addQuarter(proposed.start) } : proposed;
    setPending((current) => { const next = { ...current }; delete next[identity]; return next; });
    if (operation.source === "queue") {
      const queueItem = queueCards.find((item) => item.id === identity);
      if (queueItem) {
        const stopId = identity === "projection-collection:load-1" ? "projection-stop:collection:load-1" : `assigned-${identity}`;
        const prior = planner.runs.flatMap((run) => run.stops).find((stop) => stop.stopId === stopId);
        const newStop = { ...(prior || mkStop(stopId, queueItem.destination, adjusted.runId, adjusted.lane)), ...mkStop(stopId, queueItem.destination, adjusted.runId, adjusted.lane, adjusted.start, adjusted.end, queueItem.workIds[0]) };
        setPlanner((current) => ({ ...current, runs: current.runs.map((run) => {
          const stops = run.stops.filter((stop) => stop.stopId !== stopId);
          return run.runId === adjusted.runId ? { ...run, stops: [...stops, newStop], stopCount: stops.length + 1, scheduledStopCount: stops.filter((stop) => stop.plannedArrivalTime || stop.plannedWindow?.startTime).length + 1 } : stops.length !== run.stops.length ? { ...run, stops, stopCount: stops.length } : run;
        }) }));
        setQueueItems((current) => current.filter((item) => item.id !== identity));
      }
    } else setConfirmed((current) => ({ ...current, [identity]: { kind: "scheduled", position: adjusted, operationId: operation.operationId, source: "stop" } }));
    setMessage(value === "adjust" ? `Server adjusted placement to ${adjusted.start}${adjusted.end ? `–${adjusted.end}` : ""}.` : `Fixture placement saved at ${adjusted.start}${adjusted.end ? `–${adjusted.end}` : ""}.`);
  };

  const begin = (identity: string, source: "stop" | "queue", original: SchedulePosition | undefined, proposed: SchedulePosition) => {
    const operation = createPendingScheduleOperation(identity, original, proposed, `fixture:${count + 1}`, { source });
    setPending((current) => ({ ...current, [identity]: { ...operation, state: "saving" } }));
    setCount((value) => value + 1);
    const chosenMode = mode;
    setMessage(`Saving placement · ${proposed.runId} · ${proposed.lane} · ${proposed.start}${proposed.end ? `–${proposed.end}` : ""}.`);
    if (chosenMode === "delayed") window.setTimeout(() => complete(identity, operation, chosenMode), 1100);
    else if (chosenMode === "reject") window.setTimeout(() => complete(identity, operation, chosenMode), 250);
    else complete(identity, operation, chosenMode);
  };
  const returnToQueue = (sourceRunId: string, stopId: string) => {
    const currentRun = planner.runs.find((run) => run.runId === sourceRunId);
    const stop = currentRun?.stops.find((item) => item.stopId === stopId);
    const start = stop?.plannedWindow?.startTime || stop?.plannedArrivalTime;
    if (!currentRun || !stop || !start || pending[stopId]) return;
    const operation = createPendingScheduleOperation(stopId, { runId: sourceRunId, lane: stop.lane, start, ...(stop.plannedWindow?.endTime ? { end: stop.plannedWindow.endTime } : {}) }, undefined, `fixture:return:${count + 1}`, { source: "stop" });
    setPending((current) => ({ ...current, [stopId]: { ...operation, state: "saving" } }));
    setCount((value) => value + 1);
    setMessage(`Saving return of ${stop.destination.label} to the Planning queue.`);
    const settle = () => {
      if (mode === "reject") {
        setPending((current) => { const next = { ...current }; delete next[stopId]; return next; });
        setMessage("Return rejected · confirmed stop restored.");
        return;
      }
      setPlanner((current) => ({ ...current, runs: current.runs.map((run) => run.runId === sourceRunId ? { ...run, stops: run.stops.filter((item) => item.stopId !== stopId), stopCount: Math.max(0, run.stopCount - 1), scheduledStopCount: Math.max(0, run.scheduledStopCount - 1) } : run) }));
      setPending((current) => { const next = { ...current }; delete next[stopId]; return next; });
      setMessage(`Returned ${stop.destination.label} to the Planning queue.`);
    };
    if (mode === "delayed") window.setTimeout(settle, 1100); else settle();
  };

  return <main style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
    <h1>Mounted React timeline fixture</h1>
    <p>Isolated fixture only. No API or staging writes.</p>
    <label>Command mode <select aria-label="Command mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)}><option value="success">Immediate success</option><option value="delayed">Delayed success</option><option value="reject">Reject</option><option value="adjust">Server adjustment</option></select></label>
    <p role="status" aria-live="polite" data-testid="fixture-message">{message} Commands: {count}</p>
    <div className="fixture-queue" data-logistics-planning-queue><h2>Fixture queue</h2>{queueCards.map((item) => <button key={item.id} className="mock-queue-main" data-timeline-queue-id={item.id} onClick={() => setSelected(item.id)}>{item.destination} · {item.lane}</button>)}</div>
    <MountedReactTimeline planner={planner} queueItems={queueCards} pendingSchedules={pending} confirmedSchedules={confirmed} onStop={(sourceRun, id) => { setSelected(id); setMessage(`Inspector opened for source run ${sourceRun}.`); const stop = planner.runs.flatMap((run) => run.stops).find((item) => item.stopId === id); if (stop?.plannedWindow?.endTime) setWindowEnd(stop.plannedWindow.endTime); }} onReturnToQueue={returnToQueue} onRun={() => setMessage("Run details selected.")} onSchedule={(sourceRunId, stopId, targetRunId, start, end, lane) => {
      const sourceStop = planner.runs.flatMap((run) => run.stops.map((stop) => ({ run, stop }))).find(({ stop }) => stop.stopId === stopId);
      if (!sourceStop) return;
      const original: SchedulePosition = { runId: sourceRunId, lane: sourceStop.stop.lane, start: sourceStop.stop.plannedWindow?.startTime || sourceStop.stop.plannedArrivalTime || start, ...(sourceStop.stop.plannedWindow?.endTime ? { end: sourceStop.stop.plannedWindow.endTime } : {}) };
      begin(stopId, "stop", original, { runId: targetRunId, lane: lane || sourceStop.stop.lane, start, ...(end ? { end } : {}) });
    }} onQueueDrop={(kind, id, runId, start, lane) => {
      const item = queueCards.find((entry) => entry.id === id); if (!item) return;
      begin(id, "queue", undefined, { runId, lane: lane || item.lane, start });
      setMessage(`Collection route: ${kind === "group" && lane === "collection" ? "reschedule-delivery-load lane=collection" : kind === "movement" && item.lane === "collection" ? "Collection movement" : "delivery assignment"}`);
    }} />
    {selected && <aside aria-label="Fixture details"><h2>Details · {selected}</h2><label>Window end <input aria-label="Details window end" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} /></label><button onClick={() => { const stop = planner.runs.flatMap((run) => run.stops).find((item) => item.stopId === selected); if (!stop?.plannedWindow?.startTime) return; const run = planner.runs.find((candidate) => candidate.stops.includes(stop)); if (run) begin(selected, "stop", { runId: run.runId, lane: stop.lane, start: stop.plannedWindow.startTime, end: stop.plannedWindow.endTime }, { runId: run.runId, lane: stop.lane, start: stop.plannedWindow.startTime, end: windowEnd }); }}>Save window</button></aside>}
  </main>;
}
