import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type {
  DeliveryRun,
  DeliveryStop,
  MovementRequest,
  LogisticsHealth,
} from "./types";
import type { MovementType } from "./types";

export type ProductionContext = {
  canonicalId: string;
  clientName?: string;
  serviceType?: string;
  guestCount?: number;
  origin?: string;
  destinationLabel?: string;
  requiredBy?: string;
  serviceWindow?: { startTime: string; endTime?: string };
  operationalNotes?: string;
};
export type PlannerRequirementRef = {
  requirementId: string;
  sourceVersion: number;
  sourceDomain: FulfilmentRequirement["sourceDomain"];
  sourceEntityId: string;
  status: FulfilmentRequirement["status"];
  runId?: string;
  stopId?: string;
};
export type PlannerLine = {
  lineKey: string;
  displayName: string;
  unit: string;
  quantity: number;
  requirementRefs: string[];
  sourceLineRefs: Array<{ requirementId: string; lineId: string }>;
};
export type PlannerWorkGroup = {
  groupKey: string;
  serviceDate: string;
  destinationOplocId: string;
  destinationLabel: string;
  deliveryWindow?: { startTime: string; endTime?: string };
  requiredTimes: string[];
  requirementRefs: PlannerRequirementRef[];
  requirementCount: number;
  sourceLabels: string[];
  combinedLines: PlannerLine[];
  unitBreakdown: Array<{ unit: string; quantity: number }>;
  readiness: "READY" | "PENDING" | "ATTENTION";
  attention: string[];
  planningState: "unplanned" | "partially_planned" | "planned" | "attention";
  productionContext?: ProductionContext;
  collectionRequired?: boolean;
};
export type PlannerMovementView = {
  movementId: string;
  type: "delivery" | "collection" | "transfer";
  serviceDate: string;
  from?: { id: string; label: string };
  to?: { id: string; label: string };
  requiredTime?: string;
  window?: { startTime: string; endTime?: string };
  items: MovementRequest["items"];
  notes?: string;
  planningState: "unplanned" | "partially_planned" | "planned";
  assignedStops: Array<{ runId: string; stopId: string; sequence: number }>;
};
export type PlannerStopView = {
  stopId: string;
  sequence: number;
  destination: { id: string; label: string };
  requiredTime?: string;
  window?: { startTime: string; endTime?: string };
  plannedArrivalTime?: string;
  plannedWindow?: { startTime: string; endTime?: string };
  loaded?: boolean;
  requirementCount: number;
  movementCount: number;
  movementTypes: MovementType[];
  sourceLabels: string[];
  combinedLines: PlannerLine[];
  unitBreakdown: Array<{ unit: string; quantity: number }>;
  attention: string[];
  status: DeliveryStop["status"];
  lane: "delivery" | "collection";
  linkedStopId?: string;
  linkedOperation?: "delivery" | "collection";
  originatingLoadKey?: string;
  operationalStatus: "scheduled" | "dispatched" | "in_progress" | "delivered" | "collected" | "attention";
};
export type LiveRunStatus = "planned" | "dispatched" | "in_progress" | "returning_to_cpu" | "returned" | "complete" | "attention";
export type PlannerRunView = {
  runId: string;
  serviceDate: string;
  driver?: string;
  vehicle?: string;
  status: DeliveryRun["status"];
  operationalStatus: LiveRunStatus;
  returnToCpuRequired: boolean;
  returnReady: boolean;
  completedCollections: number;
  remainingCollections: number;
  version: number;
  stopCount: number;
  scheduledStopCount: number;
  needsTimeStopCount: number;
  completedStops: number;
  openIssueCount: number;
  nextStop?: { stopId: string; destination: string; requiredTime?: string };
  readiness: { ready: boolean; blockers: string[] };
  stops: PlannerStopView[];
};
export type PlannerDay = {
  serviceDate: string;
  workGroups: PlannerWorkGroup[];
  movements: PlannerMovementView[];
  runs: PlannerRunView[];
  summary: {
    requirements: number;
    destinations: number;
    unplanned: number;
    partiallyPlanned: number;
    planned: number;
    attention: number;
    movements: number;
    loads: number;
    deliveries: number;
    collections: number;
    transfers: number;
    assignedWork: number;
    scheduledStops: number;
    needsTime: number;
  };
  upstreamHealth: LogisticsHealth & {
    enrichment: { available: boolean; error?: string };
  };
};

export type PlannerQueueState = "unassigned" | "needs_time" | "attention" | "scheduled";

export function hasUsableSchedule(stop: Pick<PlannerStopView, "plannedArrivalTime" | "plannedWindow">) {
  return Boolean(stop.plannedWindow?.startTime || stop.plannedArrivalTime);
}

function isCollectionView(stop: Pick<PlannerStopView, "lane" | "movementTypes">) {
  return stop.lane === "collection" || stop.movementTypes.includes("collection");
}

export function liveStopStatus(
  stop: Pick<PlannerStopView, "status" | "attention" | "lane" | "movementTypes">,
  runStatus: DeliveryRun["status"],
): PlannerStopView["operationalStatus"] {
  if (stop.attention.length || stop.status === "issue") return "attention";
  if (stop.status === "completed") return isCollectionView(stop) ? "collected" : "delivered";
  if (stop.status === "arrived") return "in_progress";
  return runStatus === "dispatched" ? "dispatched" : "scheduled";
}

export function liveRunStatus(
  run: Pick<DeliveryRun, "status" | "returnToCpuPending" | "returnedToCpuAt" | "returnToCpuRequired">,
  stops: Array<Pick<PlannerStopView, "operationalStatus">>,
): LiveRunStatus {
  if (stops.some((stop) => stop.operationalStatus === "attention")) return "attention";
  if (run.status === "completed") return run.returnedToCpuAt ? "returned" : "complete";
  if (run.returnToCpuPending) return "returning_to_cpu";
  if (run.status === "dispatched") return stops.some((stop) => stop.operationalStatus === "delivered" || stop.operationalStatus === "collected" || stop.operationalStatus === "in_progress") ? "in_progress" : "dispatched";
  return "planned";
}

function stopForRequirement(group: PlannerWorkGroup, ref: PlannerRequirementRef, runs: PlannerRunView[]) {
  if (!ref.runId || !ref.stopId) return undefined;
  return runs.find((run) => run.runId === ref.runId)?.stops.find((stop) => stop.stopId === ref.stopId);
}

function clockMinutes(value?: string) {
  if (!value) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function workGroupQueueState(group: PlannerWorkGroup, runs: PlannerRunView[]): PlannerQueueState {
  if (group.attention.length) return "attention";
  const assigned = group.requirementRefs.filter((ref) => ref.runId);
  if (assigned.length < group.requirementCount) return "unassigned";
  if (assigned.some((ref) => !hasUsableSchedule(stopForRequirement(group, ref, runs) || {}))) return "needs_time";
  return "scheduled";
}

export function movementQueueState(movement: PlannerMovementView, runs: PlannerRunView[]): PlannerQueueState {
  if (!movement.assignedStops.length) return "unassigned";
  if (movement.assignedStops.some((assignment) => {
    const stop = runs.find((run) => run.runId === assignment.runId)?.stops.find((item) => item.stopId === assignment.stopId);
    return !stop || !hasUsableSchedule(stop);
  })) return "needs_time";
  return "scheduled";
}

export type PlannerWeekSummary = {
  serviceDate: string;
  loads: number;
  ready: number;
  unplanned: number;
  runs: number;
  scheduled?: number;
  needsTime?: number;
  queue?: number;
  attention: number;
  completedStops: number;
  stopCount: number;
  deliveries?: number;
  collections?: number;
  transfers?: number;
};

const sourceLabels: Record<FulfilmentRequirement["sourceDomain"], string> = {
  "menu-planning": "Menu Planning",
  "grab-and-go": "Grab & Go",
  "cpu-production": "CPU Production",
};
function sourceLabel(
  requirement: FulfilmentRequirement,
  production?: ProductionContext,
) {
  return requirement.sourceDomain === "cpu-production" &&
    production?.origin === "hospitality_booking"
    ? "Hospitality"
    : sourceLabels[requirement.sourceDomain];
}
function windowKey(requirement: FulfilmentRequirement) {
  const window = requirement.requiredDeliveryWindow;
  return window ? `${window.startTime}-${window.endTime || ""}` : "unscheduled";
}
function lineKey(line: {
  canonicalItemId?: string;
  displayNameSnapshot: string;
  unit: string;
}) {
  return `${line.canonicalItemId || line.displayNameSnapshot}::${line.unit}`;
}
function addLine(
  target: Map<string, PlannerLine>,
  line: {
    canonicalId: string;
    canonicalItemId?: string;
    displayNameSnapshot: string;
    quantity: number;
    unit: string;
  },
  requirementId: string,
) {
  const key = lineKey(line);
  const current = target.get(key);
  if (current) {
    current.quantity += line.quantity;
    current.requirementRefs = Array.from(
      new Set([...current.requirementRefs, requirementId]),
    );
    current.sourceLineRefs.push({ requirementId, lineId: line.canonicalId });
  } else
    target.set(key, {
      lineKey: key,
      displayName: line.displayNameSnapshot,
      unit: line.unit,
      quantity: line.quantity,
      requirementRefs: [requirementId],
      sourceLineRefs: [{ requirementId, lineId: line.canonicalId }],
    });
}
function addMovementLines(
  target: Map<string, PlannerLine>,
  movement: MovementRequest,
) {
  movement.items.forEach((item, index) => {
    const line = {
      canonicalId: `${movement.canonicalId}:${index}`,
      displayNameSnapshot: item.description,
      quantity: item.quantity,
      unit: item.unit || "item",
    };
    addLine(target, line, movement.canonicalId);
  });
}
function unitBreakdown(lines: PlannerLine[]) {
  const totals = new Map<string, number>();
  lines.forEach((line) =>
    totals.set(line.unit, (totals.get(line.unit) || 0) + line.quantity),
  );
  return Array.from(totals, ([unit, quantity]) => ({ unit, quantity }));
}
function assignedRequirements(
  requirementId: string,
  stops: DeliveryStop[],
  runs: DeliveryRun[],
) {
  return stops.flatMap((stop) =>
    stop.requirementRefs
      .filter((ref) => ref.requirementId === requirementId)
      .map((ref) => ({
        ...ref,
        runId: stop.runId,
        stopId: stop.canonicalId,
        sequence: stop.sequence,
        run: runs.find((run) => run.canonicalId === stop.runId),
      })),
  );
}
function requirementAttention(
  requirement: FulfilmentRequirement,
  assignments: ReturnType<typeof assignedRequirements>,
) {
  const messages: string[] = [];
  if (requirement.status === "withdrawn")
    messages.push("Withdrawn — remove from plan");
  if (requirement.status === "amended")
    messages.push("Amended — review source changes");
  if (
    assignments.some((item) => requirement.sourceVersion > item.sourceVersion)
  )
    messages.push("Newer source version available");
  return messages;
}
function planningState(
  planned: number,
  total: number,
  attention: boolean,
): PlannerWorkGroup["planningState"] {
  if (attention) return "attention";
  if (!planned) return "unplanned";
  return planned === total ? "planned" : "partially_planned";
}

export function buildPlannerDay(input: {
  serviceDate: string;
  requirements: FulfilmentRequirement[];
  runs: DeliveryRun[];
  stops: DeliveryStop[];
  movements: MovementRequest[];
  oplocs: Array<{ id: string; label: string }>;
  health: PlannerDay["upstreamHealth"];
  production?: ProductionContext[];
  collectionRequiredKeys?: string[];
}): PlannerDay {
  const isTechnicalLocation = (label?: string) =>
    !label || /^(oploc:|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(label);
  const oplocLabel = (id?: string, fallback?: string) =>
    input.oplocs.find((oploc) => oploc.id === id)?.label ||
    (!isTechnicalLocation(fallback) ? fallback : undefined) ||
    "Unknown governed destination";
  const productionById = new Map(
    (input.production || []).map((item) => [item.canonicalId, item]),
  );
  const collectionRequiredKeys = new Set(input.collectionRequiredKeys || []);
  const groups = new Map<string, PlannerWorkGroup>();
  for (const requirement of input.requirements.filter(
    (item) => item.serviceDate === input.serviceDate,
  )) {
    const production =
      requirement.sourceDomain === "cpu-production"
        ? productionById.get(requirement.sourceEntityId)
        : undefined;
    const key = `${requirement.serviceDate}:${requirement.destinationOplocId}:${windowKey(requirement)}`;
    const existing = groups.get(key);
    const assignments = assignedRequirements(
      requirement.canonicalId,
      input.stops,
      input.runs,
    );
    const ref: PlannerRequirementRef = {
      requirementId: requirement.canonicalId,
      sourceVersion: requirement.sourceVersion,
      sourceDomain: requirement.sourceDomain,
      sourceEntityId: requirement.sourceEntityId,
      status: requirement.status,
      ...(assignments[0]?.runId
        ? { runId: assignments[0].runId, stopId: assignments[0].stopId }
        : {}),
    };
    if (!existing) {
      const lines = new Map<string, PlannerLine>();
      requirement.lines.forEach((line) =>
        addLine(lines, line, requirement.canonicalId),
      );
      const attention = requirementAttention(requirement, assignments);
      existing ||
        groups.set(key, {
          groupKey: key,
          serviceDate: requirement.serviceDate,
          destinationOplocId: requirement.destinationOplocId,
          destinationLabel: oplocLabel(
            requirement.destinationOplocId,
            requirement.destinationLabelSnapshot,
          ),
          ...(requirement.requiredDeliveryWindow
            ? { deliveryWindow: requirement.requiredDeliveryWindow }
            : {}),
          requiredTimes: requirement.readyAt ? [requirement.readyAt] : [],
          requirementRefs: [ref],
          requirementCount: 1,
          sourceLabels: [sourceLabel(requirement, production)],
          combinedLines: Array.from(lines.values()),
          unitBreakdown: unitBreakdown(Array.from(lines.values())),
          readiness:
            requirement.status === "pending"
              ? "PENDING"
              : attention.length
                ? "ATTENTION"
                : "READY",
          attention,
          planningState: planningState(
            assignments.length,
            1,
            attention.length > 0,
          ),
          ...(production ? { productionContext: production } : {}),
          collectionRequired: collectionRequiredKeys.has(key),
        });
    } else {
      const lines = new Map(
        existing.combinedLines.map((line) => [line.lineKey, line]),
      );
      requirement.lines.forEach((line) =>
        addLine(lines, line, requirement.canonicalId),
      );
      const attention = requirementAttention(requirement, assignments);
      existing.requirementRefs.push(ref);
      existing.requirementCount += 1;
      existing.combinedLines = Array.from(lines.values());
      existing.unitBreakdown = unitBreakdown(existing.combinedLines);
      existing.sourceLabels = Array.from(
        new Set([
          ...existing.sourceLabels,
          sourceLabel(requirement, production),
        ]),
      );
      if (requirement.readyAt) existing.requiredTimes.push(requirement.readyAt);
      existing.attention.push(...attention);
      existing.attention = Array.from(new Set(existing.attention));
      existing.readiness =
        existing.attention.length || existing.readiness === "ATTENTION"
          ? "ATTENTION"
          : existing.requirementRefs.some((item) => item.status === "pending")
            ? "PENDING"
            : "READY";
      const planned = existing.requirementRefs.filter(
        (item) => item.runId,
      ).length;
      existing.planningState = planningState(
        planned,
        existing.requirementCount,
        existing.attention.length > 0,
      );
      if (!existing.productionContext && production)
        existing.productionContext = production;
      existing.collectionRequired = existing.collectionRequired || collectionRequiredKeys.has(key);
    }
  }
  const movements = input.movements
    .filter((movement) => movement.serviceDate === input.serviceDate)
    .map((movement) => {
      const assignedStops = input.stops
        .filter((stop) =>
          (
            stop.movementRequestIds ||
            (stop.movementRequestId ? [stop.movementRequestId] : [])
          ).includes(movement.canonicalId),
        )
        .map((stop) => ({
          runId: stop.runId,
          stopId: stop.canonicalId,
          sequence: stop.sequence,
        }));
      const expected = movement.type === "transfer" ? 2 : 1;
      return {
        movementId: movement.canonicalId,
        type: movement.type,
        serviceDate: movement.serviceDate,
        ...(movement.fromOplocId
          ? {
              from: {
                id: movement.fromOplocId,
                label: oplocLabel(movement.fromOplocId),
              },
            }
          : movement.fromAddress
            ? {
                from: {
                  id: `one-off:${movement.canonicalId}:from`,
                  label: movement.fromAddress,
                },
              }
          : {}),
        ...(movement.toOplocId
          ? {
              to: {
                id: movement.toOplocId,
                label: oplocLabel(movement.toOplocId),
              },
            }
          : movement.toAddress
            ? {
                to: {
                  id: `one-off:${movement.canonicalId}:to`,
                  label: movement.toAddress,
                },
              }
          : {}),
        requiredTime: movement.requiredTime,
        window: movement.window,
        items: movement.items,
        notes: movement.notes,
        planningState: (assignedStops.length === 0
          ? "unplanned"
          : assignedStops.length < expected
            ? "partially_planned"
            : "planned") as PlannerMovementView["planningState"],
        assignedStops,
      };
    });
  const runs = input.runs
    .filter((run) => run.serviceDate === input.serviceDate)
    .map((run) => {
      const runStops = run.orderedStopIds
        .map((id) => input.stops.find((stop) => stop.canonicalId === id))
        .filter(Boolean) as DeliveryStop[];
      let stopViews = runStops.map((stop) => {
        const lines = new Map<string, PlannerLine>();
        const refs = input.requirements.filter((requirement) =>
          stop.requirementRefs.some(
            (ref) => ref.requirementId === requirement.canonicalId,
          ),
        );
        refs.forEach((requirement) =>
          requirement.lines.forEach((line) =>
            addLine(lines, line, requirement.canonicalId),
          ),
        );
        (
          stop.movementRequestIds ||
          (stop.movementRequestId ? [stop.movementRequestId] : [])
        )
          .map((id) =>
            input.movements.find((movement) => movement.canonicalId === id),
          )
          .filter(Boolean)
          .forEach((movement) => addMovementLines(lines, movement!));
        const attention = refs.flatMap((requirement) =>
          requirementAttention(
            requirement,
            assignedRequirements(
              requirement.canonicalId,
              input.stops,
              input.runs,
            ),
          ),
        );
        return {
          stopId: stop.canonicalId,
          sequence: stop.sequence,
          destination: {
            id: stop.locationOplocId,
            label: oplocLabel(stop.locationOplocId, stop.locationLabelSnapshot),
          },
          requiredTime: stop.requiredTime,
          window: stop.window,
          plannedArrivalTime: stop.plannedArrivalTime,
          plannedWindow: stop.plannedWindow,
          loaded: Boolean(stop.loaded),
          requirementCount: stop.requirementRefs.length,
          movementCount: (
            stop.movementRequestIds ||
            (stop.movementRequestId ? [stop.movementRequestId] : [])
          ).length,
          movementTypes: Array.from(
            new Set(
              (
                stop.movementRequestIds ||
                (stop.movementRequestId ? [stop.movementRequestId] : [])
              )
                .map((id) => input.movements.find((movement) => movement.canonicalId === id)?.type)
                .filter(Boolean),
            ),
          ) as MovementType[],
          sourceLabels: Array.from(
            new Set(
              refs.map((requirement) =>
                sourceLabel(
                  requirement,
                  productionById.get(requirement.sourceEntityId),
                ),
              ),
            ),
          ),
          combinedLines: Array.from(lines.values()),
          unitBreakdown: unitBreakdown(Array.from(lines.values())),
          attention: Array.from(new Set(attention)),
          status: stop.status,
          lane: (stop.linkedOperation === "collection" || stop.movementType === "collection" ? "collection" : "delivery") as "collection" | "delivery",
          ...(stop.linkedStopId ? { linkedStopId: stop.linkedStopId } : {}),
          ...(stop.linkedOperation ? { linkedOperation: stop.linkedOperation } : {}),
          ...(stop.originatingLoadKey ? { originatingLoadKey: stop.originatingLoadKey } : {}),
        };
      });
      stopViews = stopViews.map((stop, index) => {
        const start = clockMinutes(stop.plannedWindow?.startTime || stop.plannedArrivalTime);
        const requiredStart = clockMinutes(stop.window?.startTime);
        const requiredEnd = clockMinutes(stop.window?.endTime);
        const warnings: string[] = [];
        if (start !== undefined && requiredStart !== undefined && (start < requiredStart || (requiredEnd !== undefined && start > requiredEnd))) warnings.push("Planned time is outside the required window");
        const end = clockMinutes(stop.plannedWindow?.endTime);
        for (const other of stopViews.slice(0, index)) {
          const otherStart = clockMinutes(other.plannedWindow?.startTime || other.plannedArrivalTime);
          const otherEnd = clockMinutes(other.plannedWindow?.endTime) ?? otherStart;
          if (start !== undefined && otherStart !== undefined && start <= (otherEnd ?? otherStart) && (end ?? start) >= otherStart) warnings.push(`Overlaps ${other.destination.label}`);
        }
        return warnings.length ? { ...stop, attention: Array.from(new Set([...stop.attention, ...warnings])) } : stop;
      });
      stopViews = stopViews.map((stop) => {
        if (!stop.linkedStopId) return stop;
        const counterpart = stopViews.find((item) => item.stopId === stop.linkedStopId);
        if (!counterpart || !hasUsableSchedule(stop) || !hasUsableSchedule(counterpart)) return stop;
        const ownStart = clockMinutes(stop.plannedWindow?.startTime || stop.plannedArrivalTime);
        const counterpartStart = clockMinutes(counterpart.plannedWindow?.startTime || counterpart.plannedArrivalTime);
        if (stop.linkedOperation === "collection" && ownStart !== undefined && counterpartStart !== undefined && ownStart < counterpartStart)
          return { ...stop, attention: Array.from(new Set([...stop.attention, "Collection precedes delivery"])) };
        if (stop.linkedOperation === "delivery" && ownStart !== undefined && counterpartStart !== undefined && ownStart > counterpartStart)
          return { ...stop, attention: Array.from(new Set([...stop.attention, "Collection precedes delivery"])) };
        return stop;
      });
      const liveStops = stopViews.map((stop) => ({
        ...stop,
        operationalStatus: liveStopStatus(stop, run.status),
      }));
      const blockers: string[] = [];
      if (!run.driverLabel) blockers.push("No driver assigned");
      if (!stopViews.length) blockers.push("No stops");
      runStops.forEach((stop) => {
        if ((stop.issues || []).some((issue) => issue.status === "open"))
          blockers.push(`Open issue at ${stop.locationLabelSnapshot}`);
      });
      stopViews.forEach((stop) => {
        if (
          stop.attention.some(
            (message) =>
              message.includes("WITHDRAWN") || message.includes("Newer source"),
          )
        )
          blockers.push(`Blocking attention at ${stop.destination.label}`);
      });
      const returnToCpuRequired = run.returnToCpuRequired !== false;
      const completedCollections = liveStops.filter((stop) => stop.operationalStatus === "collected").length;
      const remainingCollections = liveStops.filter((stop) => isCollectionView(stop) && stop.operationalStatus !== "collected").length;
      const returnReady = returnToCpuRequired && run.status !== "completed" && liveStops.length > 0 && liveStops.every((stop) => stop.operationalStatus === "delivered" || stop.operationalStatus === "collected");
      return {
        runId: run.canonicalId,
        serviceDate: run.serviceDate,
        driver: run.driverLabel,
        vehicle: run.vehicleLabel,
        status: run.status,
        operationalStatus: liveRunStatus({ ...run, returnToCpuRequired }, liveStops),
        returnToCpuRequired,
        returnReady,
        completedCollections,
        remainingCollections,
        version: run.version,
        stopCount: stopViews.length,
        scheduledStopCount: stopViews.filter(hasUsableSchedule).length,
        needsTimeStopCount: stopViews.filter((stop) => !hasUsableSchedule(stop)).length,
        completedStops: liveStops.filter((stop) => stop.operationalStatus === "delivered" || stop.operationalStatus === "collected")
          .length,
        openIssueCount: runStops.reduce(
          (count, stop) =>
            count +
            (stop.issues || []).filter((issue) => issue.status === "open")
              .length,
          0,
        ),
        nextStop: stopViews.find((stop) => stop.status !== "completed")
          ? {
              stopId: stopViews.find((stop) => stop.status !== "completed")!
                .stopId,
              destination: stopViews.find(
                (stop) => stop.status !== "completed",
              )!.destination.label,
              requiredTime: stopViews.find(
                (stop) => stop.status !== "completed",
              )!.requiredTime,
            }
          : undefined,
        readiness: { ready: !blockers.length, blockers },
        stops: liveStops,
      };
    });
  const workGroups = Array.from(groups.values());
  const allStopViews = runs.flatMap((run) => run.stops);
  const assignedWork = workGroups.reduce(
    (total, group) => total + group.requirementRefs.filter((ref) => ref.runId).length,
    0,
  ) + movements.reduce((total, movement) => total + movement.assignedStops.length, 0);
  const transfers = allStopViews.filter((stop) => stop.movementTypes.includes("transfer")).length;
  const collections = allStopViews.filter(
    (stop) => stop.movementTypes.includes("collection") && !stop.movementTypes.includes("transfer"),
  ).length;
  const deliveries = allStopViews.filter(
    (stop) => !stop.movementTypes.includes("collection") || stop.movementTypes.includes("transfer"),
  ).length;
  return {
    serviceDate: input.serviceDate,
    workGroups,
    movements,
    runs,
    summary: {
      requirements: input.requirements.length,
      destinations: new Set(workGroups.map((group) => group.destinationOplocId))
        .size,
      unplanned: workGroups.filter(
        (group) => group.planningState === "unplanned",
      ).length,
      partiallyPlanned: workGroups.filter(
        (group) => group.planningState === "partially_planned",
      ).length,
      planned: workGroups.filter((group) => group.planningState === "planned")
        .length,
      attention: workGroups.filter(
        (group) =>
          group.readiness === "ATTENTION" ||
          group.planningState === "attention",
      ).length,
      movements: movements.length,
      loads: workGroups.length + movements.length,
      deliveries,
      collections,
      transfers,
      assignedWork,
      scheduledStops: allStopViews.filter(hasUsableSchedule).length,
      needsTime: allStopViews.filter((stop) => !hasUsableSchedule(stop)).length,
    },
    upstreamHealth: input.health,
  };
}
