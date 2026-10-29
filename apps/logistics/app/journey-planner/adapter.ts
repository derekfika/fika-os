import { workGroupQueueState, movementQueueState, type PlannerDay, type PlannerRunView, type PlannerStopView } from "../../lib/planner-read-model";
import { overlappingRunIds } from "../../lib/run-journey";
import { groupIntoVisitRows } from "../../lib/stop-visits";
import type { StopPiece } from "../../lib/run-stop-order";
import { minutesOf, type InspectorStopView, type PlannerViewModel, type QueueItemView, type RunInspectorView, type RunRowView, type RunStatusView, type SequenceChipView, type StopPieceView } from "./model";

/**
 * Canonical planner projection (`PlannerDay`, the read model the live planner already uses)
 * -> Journey Planner presentation model. Pure: no network, no commands, no persistence.
 * The presentation components never see `PlannerDay` directly.
 */
export type AdapterContext = {
  dateLabel: string;
  user: PlannerViewModel["user"];
  selectedRunId?: string;
  nowMinute?: number;
  /** Individually tracked pieces of work per stop id (same source the Organise panel uses). Optional refinement. */
  pieces?: Record<string, StopPiece[]>;
  /** Runs with an unresolved command. */
  pendingRunIds?: ReadonlySet<string>;
  pendingQueueIds?: ReadonlySet<string>;
};

const VEHICLE_LABELS: Record<string, string> = { van1: "Van 1", van2: "Van 2" };
const rowStart = (stops: PlannerStopView[]) => stops.map((stop) => stop.plannedWindow?.startTime || stop.plannedArrivalTime).filter((value): value is string => Boolean(value)).sort()[0];

export function runStatusView(run: PlannerRunView): RunStatusView {
  if (run.operationalStatus === "attention") return "attention";
  if (run.operationalStatus === "complete" || run.operationalStatus === "returned") return "completed";
  if (run.operationalStatus === "in_progress" || run.operationalStatus === "returning_to_cpu") return "in_progress";
  return run.status === "completed" ? "completed" : run.status;
}

/** Deliveries/collections represented by one lane stop. Exact when `pieces` supplies them. */
function countsFor(stops: PlannerStopView[], pieces: AdapterContext["pieces"]) {
  let deliveries = 0, collections = 0;
  for (const stop of stops) {
    const known = pieces?.[stop.stopId];
    if (known?.length) {
      deliveries += known.filter((piece) => piece.kind === "delivery" || piece.kind === "transfer").length;
      collections += known.filter((piece) => piece.kind === "collection").length;
      continue;
    }
    const amount = Math.max(1, stop.loadCount ?? stop.requirementCount ?? 1);
    if (stop.lane === "collection" && !stop.movementTypes.includes("delivery")) collections += amount;
    else if (stop.movementTypes.includes("collection") && stop.movementTypes.includes("delivery")) { deliveries += Math.max(1, stop.movementCount - 1); collections += 1; }
    else deliveries += amount;
  }
  return { deliveries, collections };
}

export function runRows(planner: PlannerDay, context: AdapterContext): RunRowView[] {
  const overlaps = overlappingRunIds(planner.runs.map((run) => ({ canonicalId: run.runId, vehicleId: run.vehicleId, plannedCpuDepartureTime: run.plannedCpuDepartureTime, plannedCpuReturnTime: run.plannedCpuReturnTime })));
  const ordered = [...planner.runs].sort((left, right) => (left.plannedCpuDepartureTime || "99:99").localeCompare(right.plannedCpuDepartureTime || "99:99") || left.runId.localeCompare(right.runId));
  return ordered.map((run, index): RunRowView => {
    const visits = groupIntoVisitRows(run.stops);
    const chips: SequenceChipView[] = [
      { key: `${run.runId}:cpu-out`, kind: "cpu-departure", label: "CPU" },
      ...visits.map((visit): SequenceChipView => {
        const counts = countsFor(visit.stops, context.pieces);
        return { key: `${run.runId}:${visit.key}`, kind: "visit", stopKey: visit.key, label: visit.stops[0].destination.label, ...counts };
      }),
      { key: `${run.runId}:cpu-in`, kind: "cpu-return", label: "CPU" },
    ];
    const loads = chips.reduce((total, chip) => total + (chip.kind === "visit" ? chip.deliveries + chip.collections : 0), 0);
    const planning = run.status === "draft" || run.status === "planned";
    const empty = visits.length === 0;
    const retire = planning && empty;
    return {
      id: run.runId,
      title: `Run ${index + 1}`,
      vehicleId: (run.vehicleId === "van2" ? "van2" : "van1"),
      vehicleLabel: run.vehicle || VEHICLE_LABELS[run.vehicleId || ""] || "Vehicle",
      status: runStatusView(run),
      ...(run.plannedCpuDepartureTime && run.plannedCpuReturnTime ? { departure: run.plannedCpuDepartureTime, return: run.plannedCpuReturnTime } : {}),
      stopCount: visits.length,
      loadCount: loads,
      chips,
      pending: context.pendingRunIds?.has(run.runId),
      ...(overlaps.has(run.runId) ? { overlapWarning: "Overlaps another run on this vehicle. You can still save; review before dispatch." } : {}),
      ...(run.openIssueCount ? { attention: `${run.openIssueCount} open issue${run.openIssueCount === 1 ? "" : "s"}` } : {}),
      canRetire: retire,
      ...(run.vehicleId === "van1" || run.vehicleId === "van2" ? {
        driverHref: `/mobile/${run.vehicleId}?run=${encodeURIComponent(run.runId)}&serviceDate=${encodeURIComponent(run.serviceDate)}`,
      } : {}),
      ...(retire ? {} : { retireBlocker: !planning ? "Only a draft or planned run can be deleted." : "A run with work can’t be deleted. Return its work to the queue first." }),
      editable: planning,
    };
  });
}

const windowText = (value?: { startTime: string; endTime?: string }) => value ? (value.endTime ? `${value.startTime} – ${value.endTime}` : value.startTime) : undefined;
type QueueState = ReturnType<typeof workGroupQueueState>;
const stateLabelFor = (state: QueueState) => state === "needs_time" ? "Needs time" : state === "attention" ? "Needs attention" : undefined;

export type QueueWork = {
  groups: Array<{ group: PlannerDay["workGroups"][number]; state: QueueState; /** The delivery is placed; this item is its outstanding collection. */ collectionPending?: boolean }>;
  movements: Array<{ movement: PlannerDay["movements"][number]; state: QueueState }>;
};

/** Queue rows from work the host has ALREADY classified (the host owns the queue-state rules, incl. collection-pending). */
export function queueItemsFromWork(work: QueueWork, context: Pick<AdapterContext, "pendingQueueIds">): QueueItemView[] {
  const groups = work.groups.map(({ group, state, collectionPending }): QueueItemView => {
    const pending = Boolean(context.pendingQueueIds?.has(group.groupKey));
    return {
      id: group.groupKey,
      kind: collectionPending || group.groupKey.startsWith("projection-collection:") ? "collection" : "delivery",
      destination: group.destinationLabel,
      description: group.sourceLabels.join(" · ") || "Fulfilment work",
      ...(windowText(group.deliveryWindow) || group.requiredTimes[0] ? { window: windowText(group.deliveryWindow) || group.requiredTimes[0] } : {}),
      ...(group.unitBreakdown.length ? { quantity: group.unitBreakdown.map((line) => `${line.quantity} ${line.unit}`).join(" · ") } : {}),
      ...(group.attention.length ? { attention: group.attention[0] } : {}),
      ...(stateLabelFor(state) ? { stateLabel: stateLabelFor(state) } : {}),
      pending,
      draggable: !pending,
    };
  });
  const movements = work.movements.map(({ movement, state }): QueueItemView => {
    const pending = Boolean(context.pendingQueueIds?.has(movement.movementId));
    const assignedNeedsTime = movement.assignedStops.length > 0 && state === "needs_time";
    return {
      id: movement.movementId,
      kind: movement.type === "collection" ? "collection" : "delivery",
      destination: movement.to?.label || movement.from?.label || "Movement",
      description: movement.type === "transfer" ? "Transfer" : movement.items.map((item) => item.description).join(", "),
      ...(windowText(movement.window) || movement.requiredTime ? { window: windowText(movement.window) || movement.requiredTime } : {}),
      quantity: movement.items.map((item) => `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`).join(" · "),
      ...(movement.notes ? { attention: "Notes attached" } : {}),
      ...(assignedNeedsTime ? { stateLabel: "On Run · Needs time" } : stateLabelFor(state) ? { stateLabel: stateLabelFor(state) } : {}),
      pending,
      draggable: !pending && !assignedNeedsTime,
    };
  });
  return [...groups, ...movements];
}

export function queueItems(planner: PlannerDay, context: AdapterContext): QueueItemView[] {
  return queueItemsFromWork({
    groups: planner.workGroups.map((group) => ({ group, state: workGroupQueueState(group, planner.runs) })).filter((entry) => entry.state !== "scheduled"),
    movements: planner.movements.map((movement) => ({ movement, state: movementQueueState(movement, planner.runs) })).filter((entry) => entry.state !== "scheduled"),
  }, context);
}

export function inspectorFor(planner: PlannerDay, row: RunRowView, context: AdapterContext): RunInspectorView | undefined {
  const run = planner.runs.find((candidate) => candidate.runId === row.id);
  if (!run) return undefined;
  const visits = groupIntoVisitRows(run.stops);
  const stops: InspectorStopView[] = [
    { key: `${run.runId}:cpu-out`, kind: "cpu-departure", ...(row.departure ? { time: row.departure } : {}) },
    ...visits.map((visit): InspectorStopView => {
      const pieces = visit.stops.flatMap((stop) => context.pieces?.[stop.stopId] ?? []);
      const counts = countsFor(visit.stops, context.pieces);
      return {
        key: visit.key, kind: "visit", name: visit.stops[0].destination.label, deliveries: counts.deliveries, collections: counts.collections,
        pieces: pieces.map((piece): StopPieceView => ({ key: piece.key + piece.kind, kind: piece.kind === "collection" ? "collection" : "delivery", title: `${piece.kind === "collection" ? "Collection" : piece.kind === "transfer" ? "Transfer" : "Delivery"}`, detail: piece.label })),
        canAddCollection: row.editable,
      };
    }),
    { key: `${run.runId}:cpu-in`, kind: "cpu-return", ...(row.return ? { time: row.return } : {}) },
  ];
  // Order vs planned time: a warning only. Times are never rewritten.
  const orderWarnings: string[] = [];
  const timed = visits.map((visit) => ({ name: visit.stops[0].destination.label, start: rowStart(visit.stops) })).filter((visit): visit is { name: string; start: string } => Boolean(visit.start));
  for (let i = 0; i < timed.length; i += 1) for (let j = i + 1; j < timed.length; j += 1) if (minutesOf(timed[i].start) > minutesOf(timed[j].start)) { orderWarnings.push(`${timed[i].name} (${timed[i].start}) is listed before ${timed[j].name} (${timed[j].start}).`); break; }
  return { run: row, stops, orderWarnings };
}

export function plannerDayToViewModel(planner: PlannerDay, context: AdapterContext): PlannerViewModel {
  const runs = runRows(planner, context);
  const selected = runs.find((run) => run.id === context.selectedRunId);
  return {
    dateLabel: context.dateLabel,
    vehicles: [{ id: "van1", label: "Van 1" }, { id: "van2", label: "Van 2" }],
    queue: queueItems(planner, context),
    runs,
    ...(selected ? { selectedRunId: selected.id } : {}),
    ...(context.nowMinute !== undefined ? { nowMinute: context.nowMinute } : {}),
    user: context.user,
    ...(selected ? { inspector: inspectorFor(planner, selected, context) } : {}),
  };
}
