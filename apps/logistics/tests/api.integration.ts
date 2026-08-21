import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { NextRequest } from "next/server";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "../lib/types";
import { GET, POST } from "../app/api/logistics/route";
import { db } from "../lib/firebase";
import { collectionPreferences, movements, runs, stops } from "../lib/store";

const serviceDate = "2099-01-01";
const oplocs = [
  { id: "oploc:integration-from", label: "Integration Loading Bay" },
  { id: "oploc:integration-destination", label: "Integration Destination" },
];
const prefix = () => `integration-logistics:${randomUUID()}`;
const requirement = (
  id: string,
  status: FulfilmentRequirement["status"] = "ready_for_planning",
  sourceVersion = 1,
): FulfilmentRequirement => ({
  canonicalId: `${id}:requirement`,
  entityType: "Fulfilment Requirement",
  schemaVersion: "0.1.0",
  version: sourceVersion,
  sourceDomain: "menu-planning",
  sourceEntityId: id,
  sourceVersion,
  destinationOplocId: "oploc:integration-destination",
  destinationLabelSnapshot: "Integration Destination",
  serviceDate,
  requiredDeliveryWindow: { startTime: "10:15", endTime: "10:45" },
  lines: [
    {
      canonicalId: `${id}:line`,
      sourceLineId: `${id}:source-line`,
      canonicalItemId: "dish:integration",
      displayNameSnapshot: "Integration lunch",
      quantity: 2,
      unit: "portion",
      sortOrder: 0,
    },
  ],
  status,
  createdAt: "now",
  createdBy: "integration-test",
  updatedAt: "now",
  updatedBy: "integration-test",
  audit: [],
  idempotencyKey: `${id}:v${sourceVersion}`,
});
const run = (id: string, version = 1): DeliveryRun => ({
  canonicalId: id,
  serviceDate,
  status: "draft",
  driverLabel: "Franco",
  orderedStopIds: [],
  version,
  createdAt: "now",
  updatedAt: "now",
  audit: [],
});
const movement = (
  id: string,
  type: MovementRequest["type"] = "delivery",
): MovementRequest => ({
  canonicalId: id,
  entityType: "Movement Request",
  type,
  serviceDate,
  fromOplocId: "oploc:integration-from",
  toOplocId: "oploc:integration-destination",
  items: [{ description: "Integration crates", quantity: 2, unit: "item" }],
  notes: "Integration test movement",
  createdBy: "integration-test",
  status: "open",
  version: 1,
  createdAt: "now",
  updatedAt: "now",
  audit: [],
});
const responseBody = async (body: unknown) => {
  const response = await POST(
    new NextRequest("http://localhost:3900/api/logistics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { response, body: (await response.json()) as Record<string, unknown> };
};
const seed = async (
  collection: FirebaseFirestore.CollectionReference,
  value: Record<string, unknown>,
) => {
  await collection.doc(String(value.canonicalId)).set(value);
};
async function cleanup(id: string) {
  for (const collection of [runs(), stops(), movements()]) {
    const snapshot = await collection
      .where("canonicalId", ">=", id)
      .where("canonicalId", "<", `${id}\uf8ff`)
      .get();
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
}
let upstreamRequirements: FulfilmentRequirement[] = [];
let failFulfilment = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/fulfilment-requirements"))
    return failFulfilment
      ? new Response(JSON.stringify({ error: "upstream unavailable" }), {
          status: 503,
        })
      : new Response(JSON.stringify({ requirements: upstreamRequirements }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  if (url.includes("/api/oplocs"))
    return new Response(
      JSON.stringify({
        oplocs: oplocs.map((item) => ({
          canonicalId: item.id,
          label: item.label,
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  return originalFetch(input);
}) as typeof fetch;

test("create-run persists a versioned audited run in the emulator", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const result = await responseBody({
    action: "create-run",
    by: "Franco",
    run: run(runId),
  });
  assert.equal(result.response.status, 200);
  const saved = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.equal(saved.canonicalId, runId);
  assert.equal(saved.version, 1);
  assert.equal(saved.audit[0].action, "run-created");
});

test("collection-required assignment exposes one linked untimed collection and returns the pair to planning", async (t) => {
  const id = prefix();
  t.after(async () => { upstreamRequirements = []; await collectionPreferences().doc(encodeURIComponent(`${serviceDate}:oploc:integration-destination:10:15-10:45`)).delete(); await cleanup(id); });
  const req = requirement(`${id}:load`);
  upstreamRequirements = [req];
  const runId = `${id}:run`;
  await seed(runs(), run(runId));
  const groupKey = `${serviceDate}:${req.destinationOplocId}:10:15-10:45`;
  assert.equal((await responseBody({ action: "set-collection-required", by: "integration-test", groupKey, collectionRequired: true })).response.status, 200);
  const assigned = await responseBody({ action: "assign-group", by: "integration-test", runId, expectedRunVersion: 1, requirementIds: [req.canonicalId], expectedSourceVersions: { [req.canonicalId]: req.sourceVersion }, collectionRequired: true, plannedArrivalTime: "10:15" });
  assert.equal(assigned.response.status, 200);
  let savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  let savedStops = (await stops().where("runId", "==", runId).get()).docs.map((doc) => doc.data() as DeliveryStop);
  assert.equal(savedStops.filter((stop) => stop.linkedOperation === "collection").length, 1);
  const delivery = savedStops.find((stop) => stop.linkedOperation === "delivery")!;
  const collection = savedStops.find((stop) => stop.linkedOperation === "collection")!;
  assert.equal(collection.linkedStopId, delivery.canonicalId);
  assert.equal(collection.plannedArrivalTime, undefined);
  assert.equal(savedRun.orderedStopIds.length, 2);
  const scheduled = await responseBody({ action: "schedule-stop", by: "integration-test", runId, stopId: collection.canonicalId, plannedArrivalTime: "13:00", expectedRunVersion: savedRun.version, expectedStopVersion: collection.version });
  assert.equal(scheduled.response.status, 200);
  savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  savedStops = (await stops().where("runId", "==", runId).get()).docs.map((doc) => doc.data() as DeliveryStop);
  const returnResult = await responseBody({ action: "return-stop-to-planning", by: "integration-test", runId, stopId: delivery.canonicalId, expectedRunVersion: savedRun.version, expectedStopVersion: savedStops.find((stop) => stop.canonicalId === delivery.canonicalId)!.version });
  assert.equal(returnResult.response.status, 200);
  assert.equal((await stops().where("runId", "==", runId).get()).size, 0);
  assert.equal((await runs().doc(runId).get()).data()?.orderedStopIds.length, 0);
  assert.equal((await runs().doc(runId).get()).exists, true);
  assert.equal((await runs().doc(runId).get()).data()?.audit.at(-1).action, "returned-to-planning");
});

test("schedule-stop and clear-stop-schedule are version-safe and audited", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const stopId = `${id}:stop`;
  await seed(runs(), { ...run(runId), orderedStopIds: [stopId] });
  await seed(stops(), {
    canonicalId: stopId,
    runId,
    sequence: 1,
    locationOplocId: "oploc:integration-destination",
    locationLabelSnapshot: "Integration Destination",
    requirementRefs: [],
    movementRequestIds: [],
    status: "planned",
    createdAt: "now",
    updatedAt: "now",
    version: 1,
    audit: [],
  });
  const scheduled = await responseBody({
    action: "schedule-stop",
    by: "Franco",
    runId,
    stopId,
    plannedArrivalTime: "10:15",
    expectedRunVersion: 1,
    expectedStopVersion: 1,
  });
  assert.equal(scheduled.response.status, 200);
  const saved = (await stops().doc(stopId).get()).data() as DeliveryStop;
  assert.equal(saved.plannedArrivalTime, "10:15");
  assert.equal(saved.version, 2);
  assert.equal((await runs().doc(runId).get()).data()?.version, 2);
  const cleared = await responseBody({
    action: "clear-stop-schedule",
    by: "Franco",
    runId,
    stopId,
    expectedRunVersion: 2,
    expectedStopVersion: 2,
  });
  assert.equal(cleared.response.status, 200);
  const afterClear = (await stops().doc(stopId).get()).data() as DeliveryStop;
  assert.equal(afterClear.plannedArrivalTime, undefined);
  assert.equal(afterClear.version, 3);
});

test("week summary returns five local Monday-Friday day summaries", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  await seed(runs(), run(`${id}:run`));
  const response = await GET(
    new NextRequest("http://localhost/api/logistics?weekCommencing=2098-12-29"),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    weekCommencing: string;
    days: Array<{ serviceDate: string; runs: number }>;
  };
  assert.equal(body.weekCommencing, "2098-12-29");
  assert.equal(body.days.length, 5);
  assert.equal(
    body.days.find((day) => day.serviceDate === serviceDate)?.runs,
    1,
  );
});

test("assign-group combines same-destination requirements and updates run atomically", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const first = requirement(`${id}:one`);
  const second = requirement(`${id}:two`);
  upstreamRequirements = [first, second];
  await seed(runs(), run(runId));
  const result = await responseBody({
    action: "assign-group",
    by: "Franco",
    runId,
    expectedRunVersion: 1,
    requirementIds: [first.canonicalId, second.canonicalId],
    expectedSourceVersions: { [first.canonicalId]: 1, [second.canonicalId]: 1 },
  });
  assert.equal(result.response.status, 200);
  const savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  const savedStops = (await stops().where("runId", "==", runId).get()).docs.map(
    (doc) => doc.data() as DeliveryStop,
  );
  assert.equal(savedRun.version, 2);
  assert.equal(savedRun.orderedStopIds.length, 1);
  assert.equal(savedStops.length, 1);
  assert.deepEqual(
    savedStops[0].requirementRefs.map((ref) => ref.requirementId).sort(),
    [first.canonicalId, second.canonicalId].sort(),
  );
});

test("partial group assignment sends only remaining work and skips pending/withdrawn", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const planned = requirement(`${id}:planned`);
  const pending = requirement(`${id}:pending`, "pending");
  const ready = requirement(`${id}:ready`);
  upstreamRequirements = [planned, pending, ready];
  await seed(runs(), run(runId));
  const first = await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [planned.canonicalId],
    expectedSourceVersions: { [planned.canonicalId]: 1 },
  });
  assert.equal(first.response.status, 200);
  const second = await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 2,
    requirementIds: [pending.canonicalId, ready.canonicalId],
    expectedSourceVersions: {
      [pending.canonicalId]: 1,
      [ready.canonicalId]: 1,
    },
  });
  assert.equal(second.response.status, 200);
  assert.deepEqual(
    (second.body.skipped as Array<{ requirementId: string }>).map(
      (item) => item.requirementId,
    ),
    [pending.canonicalId],
  );
  const saved = (
    await stops().where("runId", "==", runId).get()
  ).docs[0].data() as DeliveryStop;
  assert.equal(
    saved.requirementRefs.filter(
      (ref) => ref.requirementId === planned.canonicalId,
    ).length,
    1,
  );
  assert.equal(
    saved.requirementRefs.filter(
      (ref) => ref.requirementId === ready.canonicalId,
    ).length,
    1,
  );
  assert.equal(
    saved.requirementRefs.some(
      (ref) => ref.requirementId === pending.canonicalId,
    ),
    false,
  );
});

test("stale source version returns 409 without mutating Logistics state", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:item`, "ready_for_planning", 2);
  upstreamRequirements = [item];
  await seed(runs(), run(runId));
  const result = await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [item.canonicalId],
    expectedSourceVersions: { [item.canonicalId]: 1 },
  });
  assert.equal(result.response.status, 409);
  assert.equal((await runs().doc(runId).get()).data()?.version, 1);
  assert.equal((await stops().where("runId", "==", runId).get()).empty, true);
});

test("stale run version returns 409 without creating a stop", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:item`);
  upstreamRequirements = [item];
  await seed(runs(), run(runId, 2));
  const result = await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [item.canonicalId],
    expectedSourceVersions: { [item.canonicalId]: 1 },
  });
  assert.equal(result.response.status, 409);
  assert.equal((await stops().where("runId", "==", runId).get()).empty, true);
});

test("unassigning work updates the multi-work stop and deletes it after the final removal", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const first = requirement(`${id}:one`);
  const second = requirement(`${id}:two`);
  upstreamRequirements = [first, second];
  await seed(runs(), run(runId));
  await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [first.canonicalId, second.canonicalId],
    expectedSourceVersions: { [first.canonicalId]: 1, [second.canonicalId]: 1 },
  });
  let savedStop = (await stops().where("runId", "==", runId).get()).docs[0];
  let savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  let result = await responseBody({
    action: "unassign-requirement",
    runId,
    stopId: savedStop.id,
    requirementId: first.canonicalId,
    expectedRunVersion: savedRun.version,
    expectedStopVersion: (savedStop.data() as DeliveryStop).version,
  });
  assert.equal(result.response.status, 200);
  savedStop = (await stops().where("runId", "==", runId).get()).docs[0];
  assert.equal((savedStop.data() as DeliveryStop).requirementRefs.length, 1);
  savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  result = await responseBody({
    action: "unassign-requirement",
    runId,
    stopId: savedStop.id,
    requirementId: second.canonicalId,
    expectedRunVersion: savedRun.version,
    expectedStopVersion: (savedStop.data() as DeliveryStop).version,
  });
  assert.equal(result.response.status, 200);
  assert.equal((await stops().where("runId", "==", runId).get()).empty, true);
  assert.deepEqual(
    ((await runs().doc(runId).get()).data() as DeliveryRun).orderedStopIds,
    [],
  );
});

test("move-stop validates both run versions and keeps source/target sequences coherent", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const sourceId = `${id}:source`;
  const targetId = `${id}:target`;
  const stopId = `${id}:stop`;
  await seed(runs(), { ...run(sourceId), orderedStopIds: [stopId] });
  await seed(runs(), run(targetId));
  await seed(stops(), {
    canonicalId: stopId,
    runId: sourceId,
    sequence: 1,
    locationOplocId: "oploc:integration-destination",
    locationLabelSnapshot: "Integration Destination",
    requirementRefs: [],
    movementRequestIds: [],
    status: "planned",
    createdAt: "now",
    updatedAt: "now",
    version: 1,
    audit: [],
  });
  const result = await responseBody({
    action: "move-stop",
    runId: sourceId,
    targetRunId: targetId,
    stopId,
    expectedRunVersion: 1,
    expectedTargetRunVersion: 1,
    expectedStopVersion: 1,
  });
  assert.equal(result.response.status, 200);
  assert.equal((await stops().doc(stopId).get()).data()?.runId, targetId);
  assert.deepEqual(
    ((await runs().doc(sourceId).get()).data() as DeliveryRun).orderedStopIds,
    [],
  );
  assert.deepEqual(
    ((await runs().doc(targetId).get()).data() as DeliveryRun).orderedStopIds,
    [stopId],
  );
});

test("reorder persists order and rejects a transfer order that breaks pickup-before-drop-off", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const pickup = `${id}:pickup`;
  const drop = `${id}:drop`;
  await seed(runs(), { ...run(runId), orderedStopIds: [pickup, drop] });
  const base = {
    runId,
    locationOplocId: "oploc:integration-destination",
    locationLabelSnapshot: "Integration Destination",
    requirementRefs: [],
    status: "planned" as const,
    createdAt: "now",
    updatedAt: "now",
    version: 1,
    audit: [],
  };
  await seed(stops(), {
    ...base,
    canonicalId: pickup,
    sequence: 1,
    movementRequestIds: [`${id}:transfer`],
    movementType: "collection" as const,
  });
  await seed(stops(), {
    ...base,
    canonicalId: drop,
    sequence: 2,
    movementRequestIds: [`${id}:transfer`],
    movementType: "delivery" as const,
  });
  let result = await responseBody({
    action: "reorder",
    runId,
    stopIds: [drop, pickup],
    expectedRunVersion: 1,
  });
  assert.equal(result.response.status, 422);
  assert.deepEqual(
    ((await runs().doc(runId).get()).data() as DeliveryRun).orderedStopIds,
    [pickup, drop],
  );
  result = await responseBody({
    action: "reorder",
    runId,
    stopIds: [pickup, drop],
    expectedRunVersion: 1,
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    ((await runs().doc(runId).get()).data() as DeliveryRun).orderedStopIds,
    [pickup, drop],
  );
});

test("transfer assignment creates linked pickup/drop-off and movement resolution ignores tampered browser data", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const canonical = movement(`${id}:movement`, "transfer");
  upstreamRequirements = [];
  await seed(runs(), run(runId));
  await seed(movements(), canonical);
  const result = await responseBody({
    action: "assign",
    runId,
    expectedRunVersion: 1,
    movementId: canonical.canonicalId,
    movement: {
      ...canonical,
      toOplocId: "oploc:tampered",
      items: [{ description: "tampered", quantity: 999 }],
    },
  });
  assert.equal(result.response.status, 200);
  const saved = (await stops().where("runId", "==", runId).get()).docs
    .map((doc) => doc.data() as DeliveryStop)
    .sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(
    saved.map((stop) => stop.movementType),
    ["collection", "delivery"],
  );
  assert.deepEqual(
    saved.map((stop) => stop.locationLabelSnapshot),
    ["Integration Loading Bay", "Integration Destination"],
  );
  assert.equal(saved[0].movementRequestIds[0], canonical.canonicalId);
  assert.equal(
    (await movements().doc(canonical.canonicalId).get()).data()?.status,
    "planned",
  );
});

test("movement unassignment restores canonical movement and service dates remain isolated", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const otherRunId = `${id}:other`;
  const item = movement(`${id}:movement`);
  await seed(runs(), run(runId));
  await seed(runs(), { ...run(otherRunId), serviceDate: "2099-01-02" });
  await seed(movements(), item);
  const assigned = await responseBody({
    action: "assign",
    runId,
    expectedRunVersion: 1,
    movementId: item.canonicalId,
  });
  assert.equal(assigned.response.status, 200);
  const current = (await runs().doc(runId).get()).data() as DeliveryRun;
  const result = await responseBody({
    action: "unassign-movement",
    runId,
    movementId: item.canonicalId,
    expectedRunVersion: current.version,
  });
  assert.equal(result.response.status, 200);
  assert.equal(
    (await movements().doc(item.canonicalId).get()).data()?.status,
    "open",
  );
  assert.equal(
    ((await runs().doc(otherRunId).get()).data() as DeliveryRun).version,
    1,
  );
});

test("run mutations remain available while Fulfilment is unavailable, but assignment fails explicitly", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  await seed(runs(), run(runId));
  failFulfilment = true;
  try {
    const created = await responseBody({
      action: "update-run",
      run: { ...run(runId), driverLabel: "Dee", driverId: "dee" },
      expectedRunVersion: 1,
    });
    assert.equal(created.response.status, 200);
    const failed = await responseBody({
      action: "assign-group",
      runId,
      expectedRunVersion: 2,
      requirementIds: [`${id}:missing:requirement`],
      expectedSourceVersions: { [`${id}:missing:requirement`]: 1 },
    });
    assert.equal(failed.response.status, 503);
    assert.equal((await stops().where("runId", "==", runId).get()).empty, true);
  } finally {
    failFulfilment = false;
  }
});

test("lifecycle readiness, dispatch and completion are explicit and versioned", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:item`);
  upstreamRequirements = [item];
  await seed(runs(), {
    ...run(runId),
    driverLabel: "Franco",
    driverId: "franco",
  });
  let result = await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 1,
  });
  assert.equal(result.response.status, 422);
  assert.deepEqual(result.body.blockers, ["No stops"]);
  await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [item.canonicalId],
    expectedSourceVersions: { [item.canonicalId]: 1 },
  });
  result = await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 2,
  });
  assert.equal(result.response.status, 200);
  result = await responseBody({
    action: "dispatch-run",
    runId,
    expectedRunVersion: 3,
  });
  assert.equal(result.response.status, 200);
  const stopSnap = (await stops().where("runId", "==", runId).get()).docs[0];
  let currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  result = await responseBody({
    action: "arrive-stop",
    runId,
    stopId: stopSnap.id,
    expectedRunVersion: currentRun.version,
    expectedStopVersion: (stopSnap.data() as DeliveryStop).version,
  });
  assert.equal(result.response.status, 200);
  const arrived = await stops().doc(stopSnap.id).get();
  currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  result = await responseBody({
    action: "complete-stop",
    runId,
    stopId: stopSnap.id,
    expectedRunVersion: currentRun.version,
    expectedStopVersion: (arrived.data() as DeliveryStop).version,
  });
  assert.equal(result.response.status, 200);
  assert.equal(
    ((await runs().doc(runId).get()).data() as DeliveryRun).status,
    "completed",
  );
});

test("ready runs lock structural planning until explicitly returned", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:item`);
  upstreamRequirements = [item];
  await seed(runs(), { ...run(runId), driverLabel: "Dee", driverId: "dee" });
  await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [item.canonicalId],
    expectedSourceVersions: { [item.canonicalId]: 1 },
  });
  await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 2,
  });
  const blocked = await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 3,
    requirementIds: [`${id}:other:requirement`],
    expectedSourceVersions: { [`${id}:other:requirement`]: 1 },
  });
  assert.equal(blocked.response.status, 422);
  const returned = await responseBody({
    action: "return-run-to-planning",
    runId,
    expectedRunVersion: 3,
  });
  assert.equal(returned.response.status, 200);
  assert.equal((returned.body as { status?: string }).status, "planned");
});

test("reporting and resolving an issue preserves execution status and audit state", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:item`);
  upstreamRequirements = [item];
  await seed(runs(), {
    ...run(runId),
    driverLabel: "Franco",
    driverId: "franco",
  });
  await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [item.canonicalId],
    expectedSourceVersions: { [item.canonicalId]: 1 },
  });
  await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 2,
  });
  await responseBody({ action: "dispatch-run", runId, expectedRunVersion: 3 });
  let stopSnap = (await stops().where("runId", "==", runId).get()).docs[0];
  let currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  let result = await responseBody({
    action: "report-issue",
    runId,
    stopId: stopSnap.id,
    expectedRunVersion: currentRun.version,
    expectedStopVersion: (stopSnap.data() as DeliveryStop).version,
    issueDescription: "Loading bay is blocked",
    issueCategory: "Access",
  });
  assert.equal(result.response.status, 200);
  let saved = await stops().doc(stopSnap.id).get();
  assert.equal((saved.data() as DeliveryStop).status, "planned");
  assert.equal((saved.data() as DeliveryStop).issues?.[0].status, "open");
  currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  result = await responseBody({
    action: "arrive-stop",
    runId,
    stopId: stopSnap.id,
    expectedRunVersion: currentRun.version,
    expectedStopVersion: (saved.data() as DeliveryStop).version,
  });
  assert.equal(result.response.status, 200);
  saved = await stops().doc(stopSnap.id).get();
  currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  result = await responseBody({
    action: "resolve-issue",
    runId,
    stopId: stopSnap.id,
    issueId: (saved.data() as DeliveryStop).issues![0].id,
    expectedRunVersion: currentRun.version,
    expectedStopVersion: (saved.data() as DeliveryStop).version,
    resolutionNotes: "Access restored",
  });
  assert.equal(result.response.status, 200);
  assert.equal(
    (await stops().doc(stopSnap.id).get()).data()?.status,
    "arrived",
  );
});

test("defer moves an ordinary stop later and rejects breaking a transfer", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const first = requirement(`${id}:first`);
  const second = {
    ...requirement(`${id}:second`),
    destinationOplocId: "oploc:integration-from",
    destinationLabelSnapshot: "Integration Loading Bay",
  };
  upstreamRequirements = [first, second];
  await seed(runs(), {
    ...run(runId),
    driverLabel: "Franco",
    driverId: "franco",
  });
  await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [first.canonicalId, second.canonicalId],
    expectedSourceVersions: { [first.canonicalId]: 1, [second.canonicalId]: 1 },
  });
  await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 2,
  });
  await responseBody({ action: "dispatch-run", runId, expectedRunVersion: 3 });
  let savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  const firstStop = (
    await stops().doc(savedRun.orderedStopIds[0]).get()
  ).data() as DeliveryStop;
  let result = await responseBody({
    action: "defer-stop",
    runId,
    stopId: firstStop.canonicalId,
    expectedRunVersion: savedRun.version,
    expectedStopVersion: firstStop.version,
  });
  assert.equal(result.response.status, 200);
  savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.equal(savedRun.orderedStopIds.at(-1), firstStop.canonicalId);
  const transferId = `${id}:transfer`;
  const transferRun = `${id}:transfer-run`;
  const transfer = movement(transferId, "transfer");
  await seed(runs(), {
    ...run(transferRun),
    driverLabel: "Franco",
    driverId: "franco",
  });
  await seed(movements(), transfer);
  await responseBody({
    action: "assign",
    runId: transferRun,
    expectedRunVersion: 1,
    movementId: transferId,
  });
  await responseBody({
    action: "mark-run-ready",
    runId: transferRun,
    expectedRunVersion: 2,
  });
  await responseBody({
    action: "dispatch-run",
    runId: transferRun,
    expectedRunVersion: 3,
  });
  const transferRunSaved = (
    await runs().doc(transferRun).get()
  ).data() as DeliveryRun;
  const pickup = (
    await stops().doc(transferRunSaved.orderedStopIds[0]).get()
  ).data() as DeliveryStop;
  result = await responseBody({
    action: "defer-stop",
    runId: transferRun,
    stopId: pickup.canonicalId,
    expectedRunVersion: transferRunSaved.version,
    expectedStopVersion: pickup.version,
  });
  assert.equal(result.response.status, 422);
  assert.deepEqual(
    ((await runs().doc(transferRun).get()).data() as DeliveryRun)
      .orderedStopIds,
    transferRunSaved.orderedStopIds,
  );
});
