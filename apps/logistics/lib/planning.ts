import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type {
  DeliveryRun,
  DeliveryStop,
  MovementRequest,
  PlanningItem,
} from "./types";

export const plannedRequirementIds = (stops: DeliveryStop[]) =>
  new Set(
    stops.flatMap((stop) =>
      stop.requirementRefs.map((ref) => ref.requirementId),
    ),
  );
export const plannedMovementIds = (stops: DeliveryStop[]) =>
  new Set(
    stops.flatMap(
      (stop) =>
        stop.movementRequestIds ||
        (stop.movementRequestId ? [stop.movementRequestId] : []),
    ),
  );
export function validateRequirementForPlanning(
  requirement: FulfilmentRequirement,
  expectedSourceVersion: number,
) {
  if (requirement.sourceVersion !== expectedSourceVersion)
    throw new Error(
      "Fulfilment work changed upstream. Refresh and review before assigning it.",
    );
  if (requirement.status === "withdrawn")
    throw new Error("Withdrawn fulfilment work cannot be newly planned.");
  if (requirement.status === "pending" && requirement.sourceDomain !== "cpu-production")
    throw new Error("Pending fulfilment work is not ready for planning.");
  if (
    requirement.status !== "ready_for_planning" &&
    requirement.status !== "amended" &&
    !(requirement.status === "pending" && requirement.sourceDomain === "cpu-production")
  )
    throw new Error("Fulfilment work is not currently plannable.");
}
export function isNewlyPlannable(
  requirement: FulfilmentRequirement,
  stops: DeliveryStop[],
) {
  return (
    requirement.status !== "withdrawn" &&
    !plannedRequirementIds(stops).has(requirement.canonicalId)
  );
}
export function planningAttention(
  requirement: FulfilmentRequirement,
  ref?: { requirementId: string; sourceVersion: number },
) {
  if (!ref) return undefined;
  if (requirement.status === "withdrawn") return "WITHDRAWN — remove from plan";
  if (
    requirement.status === "amended" ||
    requirement.sourceVersion !== ref.sourceVersion
  )
    return "AMENDED — review source changes";
  return undefined;
}
export function chooseTargetRun(runs: DeliveryRun[], selectedRunId?: string) {
  if (selectedRunId && runs.some((run) => run.canonicalId === selectedRunId))
    return selectedRunId;
  return runs.length === 1 ? runs[0].canonicalId : undefined;
}
export function selectMobileRuns(
  runs: DeliveryRun[],
  driver: string,
  serviceDate: string,
) {
  const priority: Record<DeliveryRun["status"], number> = {
    dispatched: 0,
    ready: 1,
    planned: 2,
    draft: 3,
    completed: 4,
  };
  return runs
    .filter(
      (run) => run.serviceDate === serviceDate && run.driverLabel === driver,
    )
    .sort(
      (a, b) =>
        priority[a.status] - priority[b.status] ||
        a.canonicalId.localeCompare(b.canonicalId),
    );
}
export function selectMobileRun(
  runs: DeliveryRun[],
  driver: string,
  serviceDate: string,
  requestedRunId?: string,
) {
  const matching = selectMobileRuns(runs, driver, serviceDate);
  return requestedRunId
    ? matching.find((run) => run.canonicalId === requestedRunId)
    : matching.length === 1
      ? matching[0]
      : matching.find((run) => run.status !== "completed") || matching[0];
}
export function movementsForStop(
  stop: DeliveryStop,
  movements: MovementRequest[],
) {
  const ids =
    stop.movementRequestIds ||
    (stop.movementRequestId ? [stop.movementRequestId] : []);
  return ids
    .map((id) => movements.find((movement) => movement.canonicalId === id))
    .filter(Boolean) as MovementRequest[];
}
export function isUnplannedRequirement(
  requirement: FulfilmentRequirement,
  stops: DeliveryStop[],
) {
  return !plannedRequirementIds(stops).has(requirement.canonicalId);
}
export function isUnplannedMovement(
  movement: MovementRequest,
  stops: DeliveryStop[],
) {
  return !plannedMovementIds(stops).has(movement.canonicalId);
}
export function combineStop(
  stops: DeliveryStop[],
  input: {
    locationOplocId: string;
    locationLabel: string;
    requirement?: FulfilmentRequirement;
    movement?: MovementRequest;
    runId: string;
    by: string;
    now?: string;
    allowExistingMovement?: boolean;
  },
) {
  const now = input.now || new Date().toISOString();
  const existing = stops.find(
    (stop) =>
      stop.runId === input.runId &&
      stop.locationOplocId === input.locationOplocId &&
      stop.status !== "completed",
  );
  if (input.requirement && !isNewlyPlannable(input.requirement, stops))
    throw new Error(
      input.requirement.status === "withdrawn"
        ? "Withdrawn work cannot be newly planned."
        : "This requirement is already planned.",
    );
  if (
    input.movement &&
    !input.allowExistingMovement &&
    plannedMovementIds(stops).has(input.movement.canonicalId)
  )
    throw new Error("This movement is already planned.");
  if (!existing)
    return {
      ...({
        canonicalId: `stop:${input.runId}:${input.locationOplocId}:${Date.now()}`,
        runId: input.runId,
        sequence: stops.length + 1,
        locationOplocId: input.locationOplocId,
        locationLabelSnapshot: input.locationLabel,
        requirementRefs: input.requirement
          ? [
              {
                requirementId: input.requirement.canonicalId,
                sourceVersion: input.requirement.sourceVersion,
              },
            ]
          : [],
        movementRequestIds: input.movement ? [input.movement.canonicalId] : [],
        movementType: input.movement?.type,
        requiredTime:
          input.requirement?.readyAt || input.movement?.requiredTime,
        window:
          input.requirement?.requiredDeliveryWindow || input.movement?.window,
        status: "planned",
        createdAt: now,
        updatedAt: now,
        version: 1,
        audit: [{ action: "stop-created", at: now, by: input.by, version: 1 }],
      } as DeliveryStop),
    };
  const movementIds = input.movement
    ? Array.from(
        new Set([
          ...(existing.movementRequestIds || []),
          ...(existing.movementRequestId ? [existing.movementRequestId] : []),
          input.movement.canonicalId,
        ]),
      )
    : existing.movementRequestIds || [];
  return {
    ...existing,
    requirementRefs: input.requirement
      ? [
          ...existing.requirementRefs,
          {
            requirementId: input.requirement.canonicalId,
            sourceVersion: input.requirement.sourceVersion,
          },
        ]
      : existing.requirementRefs,
    movementRequestIds: movementIds,
    movementType: input.movement?.type || existing.movementType,
    updatedAt: now,
    version: existing.version + 1,
    audit: [
      ...existing.audit,
      {
        action: "work-combined",
        at: now,
        by: input.by,
        version: existing.version + 1,
      },
    ],
  };
}
export function orderedTransferStops(stops: DeliveryStop[]) {
  return [...stops]
    .sort(
      (a, b) =>
        (a.movementType === "collection" ? -1 : 0) -
          (b.movementType === "collection" ? -1 : 0) || a.sequence - b.sequence,
    )
    .map((stop, index) => ({ ...stop, sequence: index + 1 }));
}
export function linkedCollectionForDelivery(delivery: DeliveryStop, runId: string, by: string, now = new Date().toISOString()) {
  return {
    ...delivery,
    canonicalId: `${delivery.canonicalId}:collection`,
    runId,
    sequence: delivery.sequence + 1,
    requirementRefs: [],
    movementRequestIds: [],
    movementType: "collection" as const,
    collectionRequired: false,
    linkedStopId: delivery.canonicalId,
    linkedOperation: "collection" as const,
    originatingLoadKey: delivery.canonicalId,
    plannedArrivalTime: undefined,
    plannedWindow: undefined,
    status: "planned" as const,
    createdAt: now,
    updatedAt: now,
    version: 1,
    audit: [{ action: "linked-collection-created", at: now, by, version: 1 }],
  } as DeliveryStop;
}
export function assignMovementStops(
  stops: DeliveryStop[],
  runId: string,
  movement: MovementRequest,
  labels: { from?: string; to?: string },
  by: string,
) {
  const scoped = stops.filter((stop) => stop.runId === runId);
  let working = scoped;
  if (movement.type === "transfer") {
    const pickup = combineStop(working, {
      locationOplocId: movement.fromOplocId || "",
      locationLabel: labels.from || "",
      movement: { ...movement, type: "collection" },
      runId,
      by,
    });
    working = [
      ...working.filter((stop) => stop.canonicalId !== pickup.canonicalId),
      pickup,
    ];
    const dropoff = combineStop(working, {
      locationOplocId: movement.toOplocId || "",
      locationLabel: labels.to || "",
      movement: { ...movement, type: "delivery" },
      runId,
      by,
      allowExistingMovement: true,
    });
    working = [
      ...working.filter((stop) => stop.canonicalId !== dropoff.canonicalId),
      dropoff,
    ];
  } else {
    const next = combineStop(working, {
      locationOplocId: movement.toOplocId || movement.fromOplocId || "",
      locationLabel: labels.to || labels.from || "",
      movement,
      runId,
      by,
    });
    working = [
      ...working.filter((stop) => stop.canonicalId !== next.canonicalId),
      next,
    ];
  }
  return orderedTransferStops(working);
}
export function runsForDriver<
  T extends { driverLabel?: string; serviceDate?: string },
>(runs: T[], driver: string, serviceDate?: string) {
  return runs.filter(
    (run) =>
      run.driverLabel === driver &&
      (!serviceDate || run.serviceDate === serviceDate),
  );
}
export const asPlanningItems = (
  requirements: FulfilmentRequirement[],
  movements: MovementRequest[],
): PlanningItem[] => [
  ...requirements.map((requirement) => ({
    kind: "fulfilment" as const,
    requirement,
  })),
  ...movements.map((movement) => ({ kind: "movement" as const, movement })),
];
export function scopeState<
  T extends { serviceDate: string },
  S extends { runId: string },
>(
  state: { runs: DeliveryRun[]; stops: S[]; movements: T[] },
  serviceDate: string,
) {
  const runs = state.runs.filter((run) => run.serviceDate === serviceDate);
  const runIds = new Set(runs.map((run) => run.canonicalId));
  return {
    runs,
    stops: state.stops.filter((stop) => runIds.has(stop.runId)),
    movements: state.movements.filter(
      (movement) => movement.serviceDate === serviceDate,
    ),
  };
}
