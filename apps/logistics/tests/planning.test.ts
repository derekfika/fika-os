import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignMovementStops,
  chooseTargetRun,
  combineStop,
  isNewlyPlannable,
  isUnplannedMovement,
  isUnplannedRequirement,
  movementsForStop,
  orderedTransferStops,
  linkedCollectionForDelivery,
  planningAttention,
  runsForDriver,
  selectMobileRun,
  selectMobileRuns,
  scopeState,
  validateRequirementForPlanning,
} from "../lib/planning";
import { operationalDate } from "../lib/date";
import {
  addOperationalDays,
  formatWeekRange,
  mondayOf,
  operationalWeek,
} from "../lib/week";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "../lib/types";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";

const requirement = (
  sourceDomain: FulfilmentRequirement["sourceDomain"],
  id: string,
  status: FulfilmentRequirement["status"] = "ready_for_planning",
  sourceVersion = 1,
): FulfilmentRequirement => ({
  canonicalId: `req:${id}`,
  entityType: "Fulfilment Requirement",
  schemaVersion: "0.1.0",
  version: sourceVersion,
  sourceDomain,
  sourceEntityId: id,
  sourceVersion,
  destinationOplocId: "oploc:one",
  destinationLabelSnapshot: "One Angel Court",
  serviceDate: "2026-08-20",
  lines: [
    {
      canonicalId: `line:${id}`,
      sourceLineId: `line:${id}`,
      displayNameSnapshot: `${sourceDomain} item`,
      quantity: 2,
      unit: "portion",
      sortOrder: 0,
    },
  ],
  status,
  createdAt: "now",
  createdBy: "test",
  updatedAt: "now",
  updatedBy: "test",
  audit: [],
  idempotencyKey: `${id}:${sourceVersion}`,
});
const stop = (overrides: Partial<DeliveryStop> = {}): DeliveryStop => ({
  canonicalId: "stop:1",
  runId: "run:1",
  sequence: 1,
  locationOplocId: "oploc:one",
  locationLabelSnapshot: "One Angel Court",
  requirementRefs: [],
  movementRequestIds: [],
  status: "planned",
  createdAt: "now",
  updatedAt: "now",
  version: 1,
  audit: [],
  ...overrides,
});
const movement = (
  id: string,
  type: MovementRequest["type"] = "delivery",
): MovementRequest => ({
  canonicalId: id,
  entityType: "Movement Request",
  type,
  serviceDate: "2026-08-20",
  fromOplocId: "oploc:from",
  toOplocId: "oploc:one",
  items: [
    { description: "Hot cupboards", quantity: 2 },
    { description: "Cambro boxes", quantity: 4 },
  ],
  notes: "Collect from loading bay",
  createdBy: "Franco",
  status: "open",
  version: 1,
  createdAt: "now",
  updatedAt: "now",
  audit: [],
});
const run = (
  id: string,
  serviceDate = "2026-08-20",
  driverLabel?: string,
): DeliveryRun => ({
  canonicalId: id,
  serviceDate,
  status: "draft",
  driverLabel,
  orderedStopIds: [],
  version: 1,
  createdAt: "now",
  updatedAt: "now",
  audit: [],
});

test("central requirements render regardless of source domain", () =>
  assert.equal(
    new Set(
      [
        requirement("cpu-production", "cpu"),
        requirement("menu-planning", "menu"),
        requirement("grab-and-go", "grab"),
      ].map((item) => item.sourceDomain),
    ).size,
    3,
  ));
test("selected run is required when multiple runs exist", () => {
  const runs = [run("one"), run("two")];
  assert.equal(chooseTargetRun(runs), undefined);
  assert.equal(chooseTargetRun(runs, "two"), "two");
  assert.equal(chooseTargetRun([runs[0]]), "one");
});
test("same destination combines requirements and rejects duplicate assignment", () => {
  const first = combineStop([], {
    locationOplocId: "oploc:one",
    locationLabel: "One Angel Court",
    requirement: requirement("cpu-production", "a"),
    runId: "run:1",
    by: "Franco",
  });
  const combined = combineStop([first], {
    locationOplocId: "oploc:one",
    locationLabel: "One Angel Court",
    requirement: requirement("menu-planning", "b"),
    runId: "run:1",
    by: "Franco",
  });
  assert.equal(combined.requirementRefs.length, 2);
  assert.throws(() =>
    combineStop([combined], {
      locationOplocId: "oploc:one",
      locationLabel: "One Angel Court",
      requirement: requirement("cpu-production", "a"),
      runId: "run:1",
      by: "Franco",
    }),
  );
});
test("withdrawn work cannot be newly planned and unplanned queue excludes planned work", () => {
  const withdrawn = requirement("grab-and-go", "gone", "withdrawn");
  const existing = stop({
    requirementRefs: [{ requirementId: "req:planned", sourceVersion: 1 }],
  });
  assert.equal(isNewlyPlannable(withdrawn, []), false);
  assert.equal(
    isUnplannedRequirement(requirement("cpu-production", "unplanned"), [
      existing,
    ]),
    true,
  );
  assert.equal(
    isUnplannedRequirement(
      {
        ...requirement("cpu-production", "planned"),
        canonicalId: "req:planned",
      },
      [existing],
    ),
    false,
  );
  assert.throws(() =>
    combineStop([], {
      locationOplocId: "oploc:one",
      locationLabel: "One Angel Court",
      requirement: withdrawn,
      runId: "run:1",
      by: "Franco",
    }),
  );
});
test("amended and newer requirements stay visibly flagged", () => {
  const ref = { requirementId: "req:a", sourceVersion: 1 };
  assert.equal(
    planningAttention(
      requirement("cpu-production", "a", "ready_for_planning", 2),
      ref,
    ),
    "AMENDED — review source changes",
  );
  assert.equal(
    planningAttention(requirement("cpu-production", "a", "amended", 1), ref),
    "AMENDED — review source changes",
  );
  assert.equal(
    planningAttention(requirement("cpu-production", "a", "withdrawn", 2), ref),
    "WITHDRAWN — remove from plan",
  );
});
test("multiple movements append on one stop and duplicate movement assignment is rejected", () => {
  const first = combineStop([], {
    locationOplocId: "oploc:one",
    locationLabel: "One Angel Court",
    movement: movement("move:1"),
    runId: "run:1",
    by: "Franco",
  });
  const second = combineStop([first], {
    locationOplocId: "oploc:one",
    locationLabel: "One Angel Court",
    movement: movement("move:2", "collection"),
    runId: "run:1",
    by: "Franco",
  });
  assert.deepEqual(second.movementRequestIds, ["move:1", "move:2"]);
  assert.deepEqual(
    movementsForStop(second, [
      movement("move:1"),
      movement("move:2", "collection"),
    ]).map((item) => item.canonicalId),
    ["move:1", "move:2"],
  );
  assert.equal(isUnplannedMovement(movement("move:1"), [second]), false);
  assert.throws(() =>
    combineStop([second], {
      locationOplocId: "oploc:one",
      locationLabel: "One Angel Court",
      movement: movement("move:1"),
      runId: "run:1",
      by: "Franco",
    }),
  );
});
test("actual transfer assignment path orders pickup before drop-off and snapshots governed labels", () => {
  const ordered = assignMovementStops(
    [],
    "run:1",
    {
      ...movement("transfer:1", "transfer"),
      fromOplocId: "oploc:from",
      toOplocId: "oploc:to",
    },
    { from: "Loading Bay", to: "Haleon" },
    "Franco",
  );
  assert.deepEqual(
    ordered.map((item) => item.movementType),
    ["collection", "delivery"],
  );
  assert.deepEqual(
    ordered.map((item) => item.locationLabelSnapshot),
    ["Loading Bay", "Haleon"],
  );
  assert.deepEqual(
    ordered.map((item) => item.sequence),
    [1, 2],
  );
});
test("transfer ordering remains enforced when stops already exist", () => {
  const ordered = orderedTransferStops([
    stop({
      canonicalId: "drop",
      sequence: 1,
      movementType: "delivery",
      movementRequestIds: ["transfer:1"],
    }),
    stop({
      canonicalId: "pickup",
      sequence: 2,
      movementType: "collection",
      movementRequestIds: ["transfer:1"],
    }),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.canonicalId),
    ["pickup", "drop"],
  );
});
test("mobile run selection honours requested run ownership and current-date fallback", () => {
  const currentFranco = run("franco-current", "2026-08-20", "Franco");
  const currentDee = run("dee-current", "2026-08-20", "Dee");
  const historical = run("franco-old", "2026-08-19", "Franco");
  assert.equal(
    selectMobileRun(
      [historical, currentFranco, currentDee],
      "Franco",
      "2026-08-20",
    )?.canonicalId,
    "franco-current",
  );
  assert.equal(
    selectMobileRun(
      [historical, currentFranco, currentDee],
      "Dee",
      "2026-08-20",
    )?.canonicalId,
    "dee-current",
  );
  assert.equal(
    selectMobileRun(
      [historical, currentFranco, currentDee],
      "Dee",
      "2026-08-20",
      "franco-current",
    ),
    undefined,
  );
  assert.equal(
    selectMobileRun(
      [historical, currentFranco],
      "Franco",
      "2026-08-20",
      "franco-old",
    ),
    undefined,
  );
});
test("Europe/London operational date is shared by desktop and mobile", () => {
  assert.equal(
    operationalDate(new Date("2026-08-19T23:30:00.000Z")),
    "2026-08-20",
  );
});
test("drivers only see their assigned runs", () =>
  assert.deepEqual(
    runsForDriver(
      [
        run("franco", "2026-08-20", "Franco"),
        run("dee", "2026-08-20", "Dee"),
        run("old", "2026-08-19", "Franco"),
      ],
      "Franco",
      "2026-08-20",
    ).map((item) => item.canonicalId),
    ["franco"],
  ));
test("mobile multiple-run priority favours dispatched, then ready, then planned", () => {
  const planned = {
    ...run("planned", "2026-08-20", "Franco"),
    status: "planned" as const,
  };
  const ready = {
    ...run("ready", "2026-08-20", "Franco"),
    status: "ready" as const,
  };
  const dispatched = {
    ...run("dispatched", "2026-08-20", "Franco"),
    status: "dispatched" as const,
  };
  assert.deepEqual(
    selectMobileRuns([planned, dispatched, ready], "Franco", "2026-08-20").map(
      (item) => item.canonicalId,
    ),
    ["dispatched", "ready", "planned"],
  );
});
test("server planning validation rejects stale, withdrawn and non-CPU pending requirements", () => {
  assert.throws(
    () =>
      validateRequirementForPlanning(
        requirement("cpu-production", "stale", "ready_for_planning", 2),
        1,
      ),
    /changed upstream/,
  );
  assert.throws(
    () =>
      validateRequirementForPlanning(
        requirement("cpu-production", "gone", "withdrawn"),
        1,
      ),
    /Withdrawn/,
  );
  assert.throws(
    () =>
      validateRequirementForPlanning(
        requirement("menu-planning", "pending", "pending"),
        1,
      ),
    /Pending/,
  );
  assert.doesNotThrow(() =>
    validateRequirementForPlanning(
      requirement("cpu-production", "pending-cpu", "pending"),
      1,
    ),
  );
  assert.doesNotThrow(() =>
    validateRequirementForPlanning(
      requirement("cpu-production", "amended", "amended", 2),
      2,
    ),
  );
});
test("service-date scoping keeps runs, stops and movements coherent", () => {
  const scoped = scopeState(
    {
      runs: [run("today", "2026-08-20"), run("tomorrow", "2026-08-21")],
      stops: [
        stop({ canonicalId: "today-stop", runId: "today" }),
        stop({ canonicalId: "tomorrow-stop", runId: "tomorrow" }),
      ],
      movements: [
        movement("today-move"),
        { ...movement("tomorrow-move"), serviceDate: "2026-08-21" },
      ],
    },
    "2026-08-20",
  );
  assert.deepEqual(
    scoped.runs.map((item) => item.canonicalId),
    ["today"],
  );
  assert.deepEqual(
    scoped.stops.map((item) => item.canonicalId),
    ["today-stop"],
  );
  assert.deepEqual(
    scoped.movements.map((item) => item.canonicalId),
    ["today-move"],
  );
});

test("operational week navigation uses Monday-Friday local date keys", () => {
  assert.equal(mondayOf("2026-08-24"), "2026-08-24");
  assert.equal(mondayOf("2026-08-30"), "2026-08-24");
  assert.deepEqual(operationalWeek("2026-08-24"), [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
  ]);
  assert.equal(addOperationalDays("2026-10-25", 1), "2026-10-26");
  assert.match(formatWeekRange("2026-08-24"), /24 Aug/);
});

test("linked collection is created as an untimed paired operation", () => {
  const delivery = stop({ runId: "run:vehicle", canonicalId: "stop:delivery" });
  const collection = linkedCollectionForDelivery(delivery, delivery.runId, "Franco", "2026-08-20T10:00:00.000Z");
  assert.equal(collection.linkedOperation, "collection");
  assert.equal(collection.linkedStopId, delivery.canonicalId);
  assert.equal(collection.originatingLoadKey, delivery.canonicalId);
  assert.equal(collection.plannedArrivalTime, undefined);
  assert.equal(collection.plannedWindow, undefined);
});
