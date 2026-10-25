import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { before, test } from "node:test";
import { NextRequest } from "next/server";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import type { DeliveryLoad, DeliveryRun, DeliveryStop, LogisticsAssignment, LogisticsDayProjection, LogisticsJob, MovementRequest } from "../lib/types";
import { GET, POST } from "../app/api/logistics/route";
import { db } from "../lib/firebase";
import { collectionPreferences, deliveryLoads, logisticsAssignments, logisticsChanges, logisticsDayCursorId, logisticsDayProjections, logisticsJobs, logisticsChangeCursor, movements, runs, stops } from "../lib/store";

before(async () => {
  const [host, rawPort] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
  const port = Number(rawPort);
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    const fail = () => { socket.destroy(); reject(new Error(`Firestore emulator is unavailable at ${host}:${port}; start the FIKA local supervisor before running Logistics integration tests.`)); };
    socket.setTimeout(1500, fail);
    socket.once("error", fail);
    socket.once("connect", () => { socket.end(); resolve(); });
  });
  await cleanup("integration-logistics:");
});

const serviceDate = "2099-01-01";
const oplocs = [
  { id: "oploc:integration-from", label: "Integration Loading Bay" },
  { id: "oploc:integration-destination", label: "Integration Destination" },
  { id: "oploc:integration-other", label: "Other Customer" },
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
  vehicleId: "van1",
  driverId: "identity:integration-franco",
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
const markRunLoaded = async (runId: string) => {
  let currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  const snapshots = await stops().where("runId", "==", runId).get();
  for (const snapshot of snapshots.docs) {
    const stop = snapshot.data() as DeliveryStop;
    if (stop.linkedOperation === "collection" || stop.movementType === "collection") continue;
    const result = await responseBody({
      action: "mark-stop-loaded",
      runId,
      stopId: snapshot.id,
      expectedRunVersion: currentRun.version,
      expectedStopVersion: (snapshot.data() as DeliveryStop).version,
    });
    assert.equal(result.response.status, 200);
    currentRun = result.body.run as DeliveryRun;
  }
  const canonicalLoads = (await deliveryLoads().where("serviceDate", "==", currentRun.serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).filter((load) => load.runId === runId && load.status !== "cancelled");
  for (const load of canonicalLoads) {
    const assignments = (await logisticsAssignments().where("loadId", "==", load.id).get()).docs.map((doc) => doc.data() as LogisticsAssignment);
    const jobs = await Promise.all(assignments.map((assignment) => logisticsJobs().doc(assignment.jobId).get()));
    const expectedJobVersions = Object.fromEntries(jobs.filter((snapshot) => snapshot.exists).map((snapshot) => { const job = snapshot.data() as LogisticsJob; return [job.id, job.version]; }));
    const result = await responseBody({ action: "mark-delivery-load-loaded", loadId: load.id, expectedRunVersion: currentRun.version, expectedLoadVersion: load.version, expectedJobVersions });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
  }
  return currentRun;
};
const seed = async (
  collection: FirebaseFirestore.CollectionReference,
  value: Record<string, unknown>,
) => {
  await collection.doc(String(value.canonicalId)).set(value);
};
async function cleanup(id: string) {
  const [runRows, stopRows, movementRows, allJobs, allLoads, allAssignments, eventRows] = await Promise.all([
    runs().where("canonicalId", ">=", id).where("canonicalId", "<", `${id}\uf8ff`).get(),
    stops().where("canonicalId", ">=", id).where("canonicalId", "<", `${id}\uf8ff`).get(),
    movements().where("canonicalId", ">=", id).where("canonicalId", "<", `${id}\uf8ff`).get(),
    logisticsJobs().where("serviceDate", "==", serviceDate).get(),
    deliveryLoads().where("serviceDate", "==", serviceDate).get(),
    logisticsAssignments().where("serviceDate", "==", serviceDate).get(),
    logisticsChanges().where("serviceDate", "==", serviceDate).get(),
  ]);
  const jobRows = allJobs.docs.filter((doc) => String(doc.data().id || "").startsWith(`logistics-job:${id}`) || String(doc.data().requirementId || "").startsWith(id) || String(doc.data().sourceId || "").startsWith(id));
  const ownedJobIds = new Set(jobRows.map((doc) => String(doc.data().id || doc.id)));
  const loadRows = allLoads.docs.filter((doc) => String(doc.data().runId || "").startsWith(id) || String(doc.data().collectionRunId || "").startsWith(id));
  const ownedLoadIds = new Set(loadRows.map((doc) => String(doc.data().id || doc.id)));
  const assignmentRows = allAssignments.docs.filter((doc) => ownedJobIds.has(String(doc.data().jobId || "")) || ownedLoadIds.has(String(doc.data().loadId || "")));
  const ownedEvents = eventRows.docs.filter((doc) => String(doc.data().entityId || "").includes(id) || String(doc.data().relatedEntityId || "").includes(id) || doc.data().changeType === "collection-preference-changed" && String(doc.data().entityId || "").startsWith(serviceDate));
  await Promise.all([...runRows.docs, ...stopRows.docs, ...movementRows.docs, ...jobRows, ...loadRows, ...assignmentRows, ...ownedEvents].map((doc) => doc.ref.delete()));
  await Promise.all([logisticsDayProjections().doc(serviceDate).delete(), logisticsChangeCursor().doc(logisticsDayCursorId(serviceDate)).delete()]);
  upstreamRequirements = [];
  failFulfilment = false;
  failProductionAuthority = false;
  productionOrderOverrides.clear();
  principalVehicles = ["van1", "van2"];
}
let principalVehicles = ["van1", "van2"];
let upstreamRequirements: FulfilmentRequirement[] = [];
let failFulfilment = false;
let failProductionAuthority = false;
const productionOrderOverrides = new Map<string, Record<string, unknown> | null>();
function expectedMenuProductionId(item: FulfilmentRequirement) {
  const safe = (value:string) => value.replace(/[^A-Za-z0-9:_-]+/g, "_");
  return `production-order:v1:menu-planning:${safe(item.sourceEntityId)}:${safe(item.destinationOplocId)}`;
}
function productionOrderFor(item: FulfilmentRequirement, status = "menu_available") {
  const canonicalId = expectedMenuProductionId(item);
  return { canonicalId, origin: "menu_planning", status, version: item.sourceVersion, sourceVersion: item.sourceVersion, sourceEntityId: item.sourceEntityId, destinationOplocId: item.destinationOplocId, serviceDate: item.serviceDate };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/logistics/access")) return Response.json({ principal: { authmodIdentityId: "identity:integration-operator", displayName: "Integration operator", identityKind: "person", permittedVehicleIds: principalVehicles, maintenanceAuthorities: ["logistics.repair", "logistics.reconcile", "logistics.reset"] } });
  if (url.includes("/api/logistics/drivers")) {
    const requested = new URL(url).searchParams.get("driverId");
    const drivers = ["identity:integration-franco", "franco", "dee"].map(driverId => ({ driverId, displayName: driverId === "dee" ? "Dee" : "Franco", permittedDriverVehicleIds: ["van1", "van2"] }));
    return Response.json({ drivers: requested ? drivers.filter(driver => driver.driverId === requested) : drivers });
  }
  if (url.includes("/api/fulfilment-requirements"))
    return failFulfilment
      ? new Response(JSON.stringify({ error: "upstream unavailable" }), {
          status: 503,
        })
      : new Response(JSON.stringify({ requirements: upstreamRequirements }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  if (url.includes("/api/production?")) {
    if (failProductionAuthority) return new Response(JSON.stringify({ error: "upstream unavailable" }), { status: 503 });
    const canonicalId = new URL(url).searchParams.get("canonicalId") || "";
    if (productionOrderOverrides.has(canonicalId)) {
      const order = productionOrderOverrides.get(canonicalId);
      return Response.json({ ...(order ? { order } : {}) });
    }
    const requirement = upstreamRequirements.find(item => expectedMenuProductionId(item) === canonicalId);
    return Response.json({ ...(requirement ? { order: productionOrderFor(requirement, requirement.status === "withdrawn" ? "cancelled" : "menu_available") } : {}) });
  }
  if (url.includes("/api/internal/oplocs"))
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
  assert.equal(saved.returnToCpuRequired, true);
  const duplicate = await responseBody({ action: "create-run", run: run(runId) });
  assert.equal(duplicate.response.status, 409);
  assert.equal(((await runs().doc(runId).get()).data() as DeliveryRun).audit.length, 1);
  const invalidTimes = await responseBody({ action: "update-run-timing", runId, plannedCpuDepartureTime: "07:10", plannedCpuReturnTime: "16:00", expectedRunVersion: 1 });
  assert.equal(invalidTimes.response.status, 422);
  assert.equal(((await runs().doc(runId).get()).data() as DeliveryRun).version, 1);
  const timed = await responseBody({ action: "update-run-timing", runId, plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "16:00", expectedRunVersion: 1 });
  assert.equal(timed.response.status, 200);
  const updated = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.equal(updated.plannedCpuDepartureTime, "07:00");
  assert.equal(updated.plannedCpuReturnTime, "16:00");
  assert.equal(updated.version, 2);
  assert.equal(updated.audit.at(-1)?.action, "run-journey-times-updated");
});

test("legacy Runs without CPU journey timing remain readable without being rewritten", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const legacy = run(`${id}:legacy-run`);
  await seed(runs(), legacy);

  const response = await GET(new NextRequest(`http://localhost/api/logistics?serviceDate=${serviceDate}`));
  assert.equal(response.status, 200);
  const body = await response.json() as { runs: DeliveryRun[]; planner?: { runs: Array<{ runId: string; plannedCpuDepartureTime?: string; plannedCpuReturnTime?: string }> } };
  const readable = body.runs.find((item) => item.canonicalId === legacy.canonicalId);
  assert.deepEqual(readable, legacy);
  const plannerRun = body.planner?.runs.find((item) => item.runId === legacy.canonicalId);
  assert.ok(plannerRun, "the planner read model must include legacy Runs");
  assert.equal(plannerRun.plannedCpuDepartureTime, undefined);
  assert.equal(plannerRun.plannedCpuReturnTime, undefined);
  assert.deepEqual((await runs().doc(legacy.canonicalId).get()).data(), legacy);
});

test("movement creation is idempotent for an identical actor-bound replay and rejects ID reuse with different content", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const requested = movement(`${id}:movement`);
  const created = await responseBody({ action: "save-movement", movement: { ...requested, createdBy: "spoofed-browser-actor" } });
  assert.equal(created.response.status, 200);
  const saved = (await movements().doc(requested.canonicalId).get()).data() as MovementRequest;
  assert.notEqual(saved.createdBy, "spoofed-browser-actor");
  assert.equal(saved.version, 1);
  const replay = await responseBody({ action: "save-movement", movement: requested });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.canonicalId, requested.canonicalId);
  assert.equal((await movements().doc(requested.canonicalId).get()).data()?.version, 1, "a retry must not create or advance a second movement");
  const changeEvents = await logisticsChanges().where("serviceDate", "==", serviceDate).get();
  assert.equal(changeEvents.docs.filter((doc) => doc.data().entityId === requested.canonicalId && doc.data().changeType === "movement-created").length, 1, "a replay must not append a second canonical movement event");
  const conflictingReuse = await responseBody({ action: "save-movement", movement: { ...requested, items: [{ description: "Different collection", quantity: 3 }] } });
  assert.equal(conflictingReuse.response.status, 409);
});

test("collection-required assignment persists canonical load, job, assignment and projected legs", async (t) => {
  const id = prefix();
  t.after(async () => { upstreamRequirements = []; await collectionPreferences().doc(encodeURIComponent(`${serviceDate}:oploc:integration-destination:10:15-10:45`)).delete(); await cleanup(id); });
  const req = requirement(`${id}:load`);
  upstreamRequirements = [req];
  const runId = `${id}:run`;
  await seed(runs(), run(runId));
  const groupKey = `${serviceDate}:${req.destinationOplocId}:10:15-10:45`;
  assert.equal((await responseBody({ action: "set-collection-required", by: "integration-test", groupKey, serviceDate, collectionRequired: true })).response.status, 200);
  const assigned = await responseBody({ action: "assign-group", by: "integration-test", runId, expectedRunVersion: 1, requirementIds: [req.canonicalId], expectedSourceVersions: { [req.canonicalId]: req.sourceVersion }, collectionRequired: true, plannedArrivalTime: "10:15" });
  assert.equal(assigned.response.status, 200);
  const initialLoad = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).find((load) => load.runId === runId)!;
  const collectionScheduled = await responseBody({ action: "reschedule-delivery-load", lane: "collection", loadId: initialLoad.id, targetRunId: runId, scheduledTime: "16:15", expectedLoadVersion: initialLoad.version });
  assert.equal(collectionScheduled.response.status, 200, JSON.stringify(collectionScheduled.body));
  const savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  const savedLoads = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).filter((load) => load.runId === runId);
  const savedJobs = (await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsJob).filter((job) => job.requirementId === req.canonicalId);
  const savedAssignments = (await logisticsAssignments().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsAssignment).filter((assignment) => assignment.jobId === savedJobs[0]?.id);
  const projection = (await logisticsDayProjections().doc(serviceDate).get()).data() as LogisticsDayProjection;
  assert.equal((await stops().where("runId", "==", runId).get()).size, 0, "fulfilment assignment must not create native DeliveryStop records");
  assert.equal(savedRun.status, "planned");
  assert.equal(savedRun.version, 2);
  assert.equal(savedLoads.length, 1);
  assert.equal(savedLoads[0].collectionRequired, true);
  assert.equal(savedLoads[0].collectionScheduledTime, "16:15");
  assert.deepEqual(savedJobs.map((job) => job.requirementId), [req.canonicalId]);
  assert.equal(savedJobs[0].activeLoadId, savedLoads[0].id);
  assert.equal(savedAssignments.length, 1);
  assert.equal(savedAssignments[0].loadId, savedLoads[0].id);
  const projectedLoad = projection.deliveryLoads.find((load) => load.id === savedLoads[0].id)!;
  assert.equal(projectedLoad.jobCount, 1);
  assert.equal(projectedLoad.collectionRequired, true);
  assert.equal(projectedLoad.collectionScheduledTime, "16:15");
  const dayResponse = await GET(new NextRequest(`http://localhost/api/logistics?projection=1&serviceDate=${serviceDate}`));
  assert.equal(dayResponse.status, 200);
  const day = await dayResponse.json() as { stops: Array<Pick<DeliveryStop, "movementType"> & { canonicalLoadIds?: string[] }> };
  assert.deepEqual(day.stops.filter((stop) => stop.canonicalLoadIds?.includes(savedLoads[0].id)).map((stop) => stop.movementType).sort(), ["collection", "delivery"]);
});

test("single-load rescheduling moves one canonical load while a same-OPLOC sibling remains assigned", async (t) => {
  const id = prefix();
  t.after(async () => { upstreamRequirements = []; await cleanup(id); });
  const firstRunId = `${id}:run:first`;
  const secondRunId = `${id}:run:second`;
  const firstRequirement = requirement(`${id}:first`);
  const secondRequirement = requirement(`${id}:second`);
  upstreamRequirements = [firstRequirement, secondRequirement];
  await seed(runs(), run(firstRunId));
  await seed(runs(), run(secondRunId));
  for (const [req, plannedArrivalTime] of [[firstRequirement, "10:15"], [secondRequirement, "11:15"]] as const) {
    const currentRun = (await runs().doc(firstRunId).get()).data() as DeliveryRun;
    const assigned = await responseBody({ action: "assign-group", runId: firstRunId, expectedRunVersion: currentRun.version, requirementIds: [req.canonicalId], expectedSourceVersions: { [req.canonicalId]: req.sourceVersion }, plannedArrivalTime });
    assert.equal(assigned.response.status, 200, JSON.stringify(assigned.body));
  }
  const before = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).filter((load) => load.runId === firstRunId);
  assert.equal(before.length, 2);
  assert.equal(before[0].destinationOplocId, before[1].destinationOplocId);
  const moving = before.find((load) => load.scheduledTime === "10:15")!;
  const sibling = before.find((load) => load.id !== moving.id)!;
  const moved = await responseBody({ action: "reschedule-delivery-load", loadId: moving.id, expectedLoadVersion: moving.version, targetRunId: secondRunId, lane: "delivery", scheduledTime: "10:15" });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  const savedMoving = (await deliveryLoads().doc(moving.id).get()).data() as DeliveryLoad;
  const savedSibling = (await deliveryLoads().doc(sibling.id).get()).data() as DeliveryLoad;
  assert.equal(savedMoving.runId, secondRunId);
  assert.equal(savedSibling.runId, firstRunId);
  assert.equal(savedSibling.id, sibling.id);
  assert.notEqual(savedMoving.id, savedSibling.id);
  assert.equal(savedMoving.scheduledTime, "10:15");
  const assignments = (await logisticsAssignments().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsAssignment);
  assert.equal(assignments.find((assignment) => assignment.loadId === moving.id)?.jobId, (await logisticsJobs().where("requirementId", "==", firstRequirement.canonicalId).get()).docs[0]?.id);
  assert.equal(assignments.find((assignment) => assignment.loadId === sibling.id)?.jobId, (await logisticsJobs().where("requirementId", "==", secondRequirement.canonicalId).get()).docs[0]?.id);
});

test("collection deferral remains explicitly unavailable before Gate C and preserves canonical assignment", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const req = requirement(`${id}:defer`);
  upstreamRequirements = [req];
  await seed(runs(), run(runId));
  const assigned = await responseBody({ action: "assign-group", runId, expectedRunVersion: 1, requirementIds: [req.canonicalId], expectedSourceVersions: { [req.canonicalId]: req.sourceVersion }, plannedArrivalTime: "10:15", collectionRequired: true });
  assert.equal(assigned.response.status, 200);
  let load = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).find((item) => item.runId === runId)!;
  const collectionScheduled = await responseBody({ action: "reschedule-delivery-load", lane: "collection", loadId: load.id, targetRunId: runId, scheduledTime: "16:15", expectedLoadVersion: load.version });
  assert.equal(collectionScheduled.response.status, 200, JSON.stringify(collectionScheduled.body));
  load = (await deliveryLoads().doc(load.id).get()).data() as DeliveryLoad;
  const denied = await responseBody({ action: "defer-collection", runId, stopId: `projection-stop:collection:${load.id}`, targetServiceDate: "2099-01-05", expectedRunVersion: 2, expectedLoadVersion: load.version });
  assert.equal(denied.response.status, 422);
  assert.match(String((denied.body.error as { message?: string })?.message), /unavailable until A10/);
  assert.deepEqual((await deliveryLoads().doc(load.id).get()).data(), load);
  assert.equal((await logisticsAssignments().where("jobId", "==", `logistics-job:${req.canonicalId}`).get()).size, 1);
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
  const rebuild = await responseBody({ action: "rebuild-logistics-projection", serviceDate });
  assert.equal(rebuild.response.status, 200);
  assert.equal((rebuild.body.projection as LogisticsDayProjection).runs.some((item) => item.canonicalId === `${id}:run`), true);
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

test("projection endpoint classifies an isolated empty day without stale projection state", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const response = await GET(new NextRequest(`http://localhost/api/logistics?projection=1&serviceDate=${serviceDate}`));
  assert.equal(response.status, 200);
  const body = await response.json() as { projection: unknown; state: string; serviceDate: string };
  assert.equal(body.projection, null);
  assert.equal(body.state, "EMPTY");
  assert.equal(body.serviceDate, serviceDate);
});

test("projection endpoint rejects an invalid service date", async () => {
  const response = await GET(new NextRequest("http://localhost/api/logistics?projection=1&serviceDate=not-a-date"));
  assert.equal(response.status, 400);
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
  const savedLoads = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).filter((load) => load.runId === runId);
  const savedJobs = (await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsJob).filter((job) => [first.canonicalId, second.canonicalId].includes(job.requirementId || ""));
  const savedAssignments = (await logisticsAssignments().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsAssignment).filter((assignment) => savedJobs.some((job) => job.id === assignment.jobId));
  const projection = (await logisticsDayProjections().doc(serviceDate).get()).data() as LogisticsDayProjection;
  assert.equal(savedRun.version, 2);
  assert.equal(savedRun.status, "planned");
  assert.equal((await stops().where("runId", "==", runId).get()).size, 0);
  assert.equal(savedLoads.length, 1);
  assert.equal(savedJobs.length, 2);
  assert.equal(savedAssignments.length, 2);
  assert.deepEqual(
    savedJobs.map((job) => job.requirementId).sort(),
    [first.canonicalId, second.canonicalId].sort(),
  );
  assert.equal(savedJobs.every((job) => job.activeLoadId === savedLoads[0].id), true);
  assert.deepEqual(projection.deliveryLoads.find((load) => load.id === savedLoads[0].id)?.jobs.map((job) => job.requirementId).sort(), [first.canonicalId, second.canonicalId].sort());
});

test("menu assignment fails closed while the Hub Production Order is withdrawn but fulfilment is stale", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:menu`);
  upstreamRequirements = [item]; // deliberately still ready during the propagation window
  productionOrderOverrides.set(expectedMenuProductionId(item), productionOrderFor(item, "cancelled"));
  await seed(runs(), run(runId));
  const result = await responseBody({ action: "assign-group", runId, expectedRunVersion: 1, requirementIds: [item.canonicalId], expectedSourceVersions: { [item.canonicalId]: item.sourceVersion }, plannedArrivalTime: "10:15" });
  assert.equal(result.response.status, 409);
  assert.equal((await runs().doc(runId).get()).data()?.version, 1);
  assert.equal((await logisticsAssignments().where("serviceDate", "==", serviceDate).get()).empty, true);
});

test("menu assignment fails closed when Hub Production Order authority is unavailable", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:menu`);
  upstreamRequirements = [item];
  failProductionAuthority = true;
  await seed(runs(), run(runId));
  const result = await responseBody({ action: "assign-group", runId, expectedRunVersion: 1, requirementIds: [item.canonicalId], expectedSourceVersions: { [item.canonicalId]: item.sourceVersion }, plannedArrivalTime: "10:15" });
  assert.equal(result.response.status, 503);
  assert.equal((await runs().doc(runId).get()).data()?.version, 1);
  assert.equal((await logisticsAssignments().where("serviceDate", "==", serviceDate).get()).empty, true);
});

test("menu delivery loading rejects a stale ready requirement after canonical withdrawal", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:menu`);
  upstreamRequirements = [item];
  await seed(runs(), run(runId));
  const assigned = await responseBody({ action: "assign-group", runId, expectedRunVersion: 1, requirementIds: [item.canonicalId], expectedSourceVersions: { [item.canonicalId]: item.sourceVersion }, plannedArrivalTime: "10:15" });
  assert.equal(assigned.response.status, 200);
  const load = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map(doc => doc.data() as DeliveryLoad).find(candidate => candidate.runId === runId)!;
  productionOrderOverrides.set(expectedMenuProductionId(item), productionOrderFor(item, "cancelled"));
  const job = (await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.map(doc => doc.data() as LogisticsJob).find(candidate => candidate.requirementId === item.canonicalId)!;
  const result = await responseBody({ action: "mark-delivery-load-loaded", loadId: load.id, expectedRunVersion: 2, expectedLoadVersion: load.version, expectedJobVersions: { [job.id]: job.version } });
  assert.equal(result.response.status, 409);
  assert.equal((await deliveryLoads().doc(load.id).get()).data()?.loaded, false);
});

test("menu run dispatch rejects a withdrawal in the source-to-projection propagation window", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const item = requirement(`${id}:menu`);
  upstreamRequirements = [item];
  await seed(runs(), { ...run(runId), status: "planned", driverLabel: "Franco", driverId: "franco" });
  const assigned = await responseBody({ action: "assign-group", runId, expectedRunVersion: 1, requirementIds: [item.canonicalId], expectedSourceVersions: { [item.canonicalId]: item.sourceVersion }, plannedArrivalTime: "10:15" });
  assert.equal(assigned.response.status, 200);
  const ready = await responseBody({ action: "mark-run-ready", runId, expectedRunVersion: 1 });
  assert.equal(ready.response.status, 200, JSON.stringify({ body: ready.body, run: (await runs().doc(runId).get()).data(), assignments: (await logisticsAssignments().where("serviceDate", "==", serviceDate).get()).docs.map(doc => doc.data()).filter(item => String(item.jobId || "").includes(id)) }));
  const loaded = await markRunLoaded(runId);
  productionOrderOverrides.set(expectedMenuProductionId(item), productionOrderFor(item, "cancelled"));
  const result = await responseBody({ action: "dispatch-run", runId, expectedRunVersion: loaded.version });
  assert.equal(result.response.status, 409);
  assert.equal((result.body.error as { code?: string })?.code, "INVALID_REQUEST");
  assert.equal((await runs().doc(runId).get()).data()?.status, "ready");
});

test("Menu Planning source guard does not block Hospitality or Grab & Go demand", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const hospitality = { ...requirement(`${id}:hospitality`), sourceDomain: "cpu-production" as const, workstream: "Hospitality" as const };
  const grabAndGo = { ...requirement(`${id}:grab`), sourceDomain: "grab-and-go" as const, workstream: "Grab & Go" as const };
  upstreamRequirements = [hospitality, grabAndGo];
  failProductionAuthority = true;
  await seed(runs(), run(runId));
  const result = await responseBody({ action: "assign-group", runId, expectedRunVersion: 1, requirementIds: [hospitality.canonicalId, grabAndGo.canonicalId], expectedSourceVersions: { [hospitality.canonicalId]: 1, [grabAndGo.canonicalId]: 1 }, plannedArrivalTime: "10:15" });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.assigned, 2);
});

test("partial group assignment adds remaining ready work and skips pending/withdrawn jobs", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const planned = requirement(`${id}:planned`);
  const pending = requirement(`${id}:pending`, "pending");
  const withdrawn = requirement(`${id}:withdrawn`, "withdrawn");
  const ready = requirement(`${id}:ready`);
  upstreamRequirements = [planned, pending, withdrawn, ready];
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
    requirementIds: [pending.canonicalId, withdrawn.canonicalId, ready.canonicalId],
    expectedSourceVersions: {
      [pending.canonicalId]: 1,
      [withdrawn.canonicalId]: 1,
      [ready.canonicalId]: 1,
    },
    expectedLoadVersions: Object.fromEntries((await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => { const load = doc.data() as DeliveryLoad; return [load.id, load.version]; })),
  });
  assert.equal(second.response.status, 200);
  assert.deepEqual((second.body.skipped as Array<{ requirementId: string }>).map((item) => item.requirementId).sort(), [pending.canonicalId, withdrawn.canonicalId].sort());
  const loads = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).filter((load) => load.runId === runId && load.status !== "cancelled");
  const jobIds = new Set([planned.canonicalId, pending.canonicalId, withdrawn.canonicalId, ready.canonicalId]);
  const jobs = (await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsJob).filter((job) => jobIds.has(job.requirementId || ""));
  const assignments = (await logisticsAssignments().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsAssignment).filter((assignment) => jobs.some((job) => job.id === assignment.jobId));
  assert.equal(loads.length, 1);
  assert.deepEqual(jobs.filter((job) => job.activeLoadId).map((job) => job.requirementId).sort(), [planned.canonicalId, ready.canonicalId].sort());
  assert.deepEqual(assignments.map((assignment) => jobs.find((job) => job.id === assignment.jobId)?.requirementId).sort(), [planned.canonicalId, ready.canonicalId].sort());
  assert.equal(jobs.some((job) => job.requirementId === pending.canonicalId || job.requirementId === withdrawn.canonicalId), false);
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
  assert.equal((await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.some((doc) => doc.data().requirementId === item.canonicalId), false);
  assert.equal((await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.some((doc) => doc.data().runId === runId), false);
  assert.equal((await logisticsAssignments().where("jobId", "==", `logistics-job:${item.canonicalId}`).get()).empty, true);
});

test("stale run version returns 409 without creating canonical assignment state", async (t) => {
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
  assert.equal((await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.some((doc) => doc.data().requirementId === item.canonicalId), false);
  assert.equal((await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.some((doc) => doc.data().runId === runId), false);
  assert.equal((await logisticsAssignments().where("jobId", "==", `logistics-job:${item.canonicalId}`).get()).empty, true);
});

test("removing canonical jobs updates load membership and cancels the empty load", async (t) => {
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
  const savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.equal(savedRun.version, 2);
  const jobs = (await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsJob);
  const load = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).find((item) => item.runId === runId)!;
  assert.equal((await stops().where("runId", "==", runId).get()).empty, true);
  const initialAssignments = await logisticsAssignments().where("loadId", "==", load.id).get();
  assert.equal(initialAssignments.size, 2);
  let result = await responseBody({
    action: "remove-job-from-load",
    loadId: load.id,
    jobId: jobs.find((job) => job.requirementId === first.canonicalId)!.id,
    expectedLoadVersion: load.version,
    expectedJobVersion: jobs.find((job) => job.requirementId === first.canonicalId)!.version,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const remainingLoad = (await deliveryLoads().doc(load.id).get()).data() as DeliveryLoad;
  const remainingJob = (await logisticsJobs().doc(jobs.find((job) => job.requirementId === second.canonicalId)!.id).get()).data() as LogisticsJob;
  const remainingProjection = (await logisticsDayProjections().doc(serviceDate).get()).data() as LogisticsDayProjection;
  assert.deepEqual(remainingProjection.deliveryLoads.find((item) => item.id === load.id)?.jobs.map((job) => job.requirementId), [second.canonicalId]);
  assert.equal(remainingJob.activeLoadId, load.id);
  const removedJob = await logisticsJobs().doc(jobs.find((job) => job.requirementId === first.canonicalId)!.id).get();
  assert.equal(removedJob.data()?.activeLoadId, undefined);
  const removedAssignment = await logisticsAssignments().where("jobId", "==", jobs.find((job) => job.requirementId === first.canonicalId)!.id).get();
  assert.equal(removedAssignment.empty, true);
  const currentJob = (await logisticsJobs().doc(jobs.find((job) => job.requirementId === second.canonicalId)!.id).get()).data() as LogisticsJob;
  result = await responseBody({
    action: "remove-job-from-load",
    loadId: load.id,
    jobId: currentJob.id,
    expectedLoadVersion: remainingLoad.version,
    expectedJobVersion: currentJob.version,
  });
  assert.equal(result.response.status, 200);
  assert.equal((await stops().where("runId", "==", runId).get()).empty, true);
  const cancelled = (await deliveryLoads().doc(load.id).get()).data() as DeliveryLoad;
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await logisticsAssignments().where("loadId", "==", load.id).get()).empty, true);
  assert.equal((await logisticsAssignments().where("loadId", "==", load.id).get()).empty, true);
  assert.equal(((await runs().doc(runId).get()).data() as DeliveryRun).version, 2);
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
  assert.deepEqual(result.body.placementAuthority, {
    stopId,
    stopRunId: targetId,
    stopVersion: 2,
    runVersions: { [sourceId]: 2, [targetId]: 2 },
  });
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
  await seed(movements(), movement(`${id}:transfer`, "transfer"));
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
    ...run(runId), status: "planned",
    driverLabel: "Franco",
    driverId: "franco",
  });
  let result = await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 1,
  });
  assert.equal(result.response.status, 422);
  assert.match(String((result.body.error as { message?: string })?.message), /Run has no execution work/);
  const assignment = await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [item.canonicalId],
    expectedSourceVersions: { [item.canonicalId]: 1 },
  });
  assert.equal(assignment.response.status, 200);
  result = await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 1,
  });
  assert.equal(result.response.status, 200);
  const loadedRun = await markRunLoaded(runId);
  result = await responseBody({
    action: "dispatch-run",
    runId,
    expectedRunVersion: loadedRun.version,
  });
  assert.equal(result.response.status, 200);
  let currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  let load = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).find((item) => item.runId === runId)!;
  const job = (await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsJob).find((candidate) => candidate.requirementId === item.canonicalId)!;
  const projectedDeliveryId = `projection-stop:delivery:${load.id}`;
  result = await responseBody({
    action: "arrive-stop",
    runId,
    stopId: projectedDeliveryId,
    expectedRunVersion: currentRun.version,
    expectedLoadVersion: load.version,
  });
  assert.equal(result.response.status, 200);
  currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  load = (await deliveryLoads().doc(load.id).get()).data() as DeliveryLoad;
  result = await responseBody({
    action: "complete-stop",
    runId,
    stopId: projectedDeliveryId,
    expectedRunVersion: currentRun.version,
    expectedLoadVersion: load.version,
    expectedJobVersions: { [job.id]: job.version },
  });
  assert.equal(result.response.status, 200);
  const readyToReturn = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.equal(readyToReturn.status, "dispatched");
  assert.equal(readyToReturn.returnToCpuPending, true);
  result = await responseBody({
    action: "confirm-returned-to-cpu",
    runId,
    expectedRunVersion: readyToReturn.version,
  });
  assert.equal(result.response.status, 200);
  assert.equal((result.body as unknown as DeliveryRun).status, "completed");
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

test("reporting and resolving an issue preserves canonical load execution and audit state", async (t) => {
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
  const assigned = await responseBody({
    action: "assign-group",
    runId,
    expectedRunVersion: 1,
    requirementIds: [item.canonicalId],
    expectedSourceVersions: { [item.canonicalId]: 1 },
  });
  assert.equal(assigned.response.status, 200);
  await responseBody({
    action: "mark-run-ready",
    runId,
    expectedRunVersion: 2,
  });
  const loadedRun = await markRunLoaded(runId);
  const dispatched = await responseBody({
    action: "dispatch-run",
    runId,
    expectedRunVersion: loadedRun.version,
  });
  assert.equal(dispatched.response.status, 200);
  let currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  let load = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).find((candidate) => candidate.runId === runId)!;
  const projectedDeliveryId = `projection-stop:delivery:${load.id}`;
  let result = await responseBody({
    action: "report-issue",
    runId,
    stopId: projectedDeliveryId,
    expectedRunVersion: currentRun.version,
    expectedLoadVersion: load.version,
    issueDescription: "Loading bay is blocked",
    issueCategory: "Access",
  });
  assert.equal(result.response.status, 200);
  let saved = (await deliveryLoads().doc(load.id).get()).data() as DeliveryLoad;
  assert.equal(saved.deliveryExecution?.issues?.[0].status, "open");
  assert.equal(saved.audit.at(-1)?.action, "report-issue:delivery");
  currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  result = await responseBody({
    action: "arrive-stop",
    runId,
    stopId: projectedDeliveryId,
    expectedRunVersion: currentRun.version,
    expectedLoadVersion: saved.version,
  });
  assert.equal(result.response.status, 200);
  saved = (await deliveryLoads().doc(load.id).get()).data() as DeliveryLoad;
  currentRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  result = await responseBody({
    action: "resolve-issue",
    runId,
    stopId: projectedDeliveryId,
    issueId: saved.deliveryExecution!.issues![0].id,
    expectedRunVersion: currentRun.version,
    expectedLoadVersion: saved.version,
    resolutionNotes: "Access restored",
  });
  assert.equal(result.response.status, 200);
  const resolved = (await deliveryLoads().doc(load.id).get()).data() as DeliveryLoad;
  assert.equal(resolved.deliveryExecution?.arrivedAt !== undefined, true);
  assert.equal(resolved.deliveryExecution?.issues?.[0].status, "resolved");
  assert.equal((await runs().doc(runId).get()).data()?.status, "dispatched");
});

test("defer reorders legacy operational stops while preserving transfer pickup-before-drop-off", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  const firstId = `${id}:first-stop`;
  const secondId = `${id}:second-stop`;
  await seed(runs(), {
    ...run(runId), status: "planned", orderedStopIds: [firstId, secondId],
    driverLabel: "Franco",
    driverId: "franco",
  });
  const stop = (canonicalId: string, sequence: number, plannedArrivalTime: string) => ({ canonicalId, runId, sequence, locationOplocId: "oploc:integration-destination", locationLabelSnapshot: "Integration Destination", requirementRefs: [], movementRequestIds: [], plannedArrivalTime, status: "planned" as const, createdAt: "now", updatedAt: "now", version: 1, audit: [] });
  await seed(stops(), stop(firstId, 1, "10:15"));
  await seed(stops(), stop(secondId, 2, "11:15"));
  const ready = await responseBody({ action: "mark-run-ready", runId, expectedRunVersion: 1 });
  assert.equal(ready.response.status, 200);
  let savedRun = await markRunLoaded(runId);
  const dispatched = await responseBody({
    action: "dispatch-run",
    runId,
    expectedRunVersion: savedRun.version,
  });
  assert.equal(dispatched.response.status, 200);
  savedRun = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.deepEqual(savedRun.orderedStopIds, [firstId, secondId]);
  const firstStop = (await stops().doc(firstId).get()).data() as DeliveryStop;
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
    plannedArrivalTime: "10:15",
  });
  await responseBody({
    action: "mark-run-ready",
    runId: transferRun,
    expectedRunVersion: 2,
  });
  const loadedTransferRun = await markRunLoaded(transferRun);
  await responseBody({
    action: "dispatch-run",
    runId: transferRun,
    expectedRunVersion: loadedTransferRun.version,
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

// ---- Interactive Run planning commands (emulator-backed) -------------------------------
// NOT EXECUTED in the authoring environment (no Firestore emulator on 127.0.0.1:8085).
// The same behaviours are covered against the real route + isolated transactional store in
// tests/run-planning-commands.test.cjs; these prove the identical commands on the emulator.
test("create-run accepts validated journey times; invalid pairs are rejected without persisting", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const timedId = `${id}:timed`;
  const timed = await responseBody({ action: "create-run", run: { ...run(timedId), plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "12:00" } });
  assert.equal(timed.response.status, 200, JSON.stringify(timed.body));
  const saved = (await runs().doc(timedId).get()).data() as DeliveryRun;
  assert.deepEqual([saved.plannedCpuDepartureTime, saved.plannedCpuReturnTime, saved.status], ["09:00", "12:00", "draft"]);
  const badId = `${id}:bad`;
  for (const [departure, returnTime] of [["09:00", undefined], ["12:00", "09:00"], ["09:10", "12:00"]] as const) {
    const bad = await responseBody({ action: "create-run", run: { ...run(badId), plannedCpuDepartureTime: departure, plannedCpuReturnTime: returnTime } });
    assert.equal(bad.response.status, 422);
  }
  assert.equal((await runs().doc(badId).get()).exists, false);
});

test("set-run-stop-order persists a version-checked, audited order for load-backed stops and rejects stale or non-exact orders", async (t) => {
  const id = prefix();
  t.after(async () => { upstreamRequirements = []; await cleanup(id); });
  const reqs = ["a", "b"].map((suffix) => ({ ...requirement(`${id}:${suffix}`), destinationOplocId: `oploc:integration-destination-${suffix}` }));
  upstreamRequirements = reqs;
  const runId = `${id}:run`;
  await seed(runs(), run(runId));
  for (const [index, req] of reqs.entries()) {
    const assigned = await responseBody({ action: "assign-group", by: "integration-test", runId, expectedRunVersion: (index + 1), requirementIds: [req.canonicalId], expectedSourceVersions: { [req.canonicalId]: req.sourceVersion }, scheduledTime: index ? "11:00" : "10:00" });
    assert.equal(assigned.response.status, 200, JSON.stringify(assigned.body));
  }
  const projection = (await logisticsDayProjections().doc(serviceDate).get()).data() as LogisticsDayProjection;
  const stopIds = projection.deliveryLoads.filter((load) => load.runId === runId).map((load) => `projection-stop:delivery:${load.id}`);
  assert.equal(stopIds.length, 2);
  const current = (await runs().doc(runId).get()).data() as DeliveryRun;
  const reversed = [...stopIds].reverse();
  const saved = await responseBody({ action: "set-run-stop-order", runId, expectedRunVersion: current.version, stopIds: reversed });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const after = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.deepEqual(after.orderedStopIds, reversed);
  assert.equal(after.version, current.version + 1);
  assert.equal(after.audit.at(-1)?.action, "run-stop-order-saved");
  assert.equal((await responseBody({ action: "set-run-stop-order", runId, expectedRunVersion: current.version, stopIds: stopIds })).response.status, 409);
  assert.equal((await responseBody({ action: "set-run-stop-order", runId, expectedRunVersion: after.version, stopIds: stopIds.slice(0, 1) })).response.status, 422);
  assert.deepEqual(((await runs().doc(runId).get()).data() as DeliveryRun).orderedStopIds, reversed);
  const day = await (await GET(new NextRequest(`http://localhost/api/logistics?projection=1&serviceDate=${serviceDate}`))).json() as { runs: DeliveryRun[] };
  assert.deepEqual(day.runs.find((item) => item.canonicalId === runId)?.orderedStopIds, reversed);
});

test("retire-empty-run soft-retires only an empty planning Run, keeps its audit, and ensure-vehicle-day-runs does not resurrect it", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const runId = `${id}:run`;
  await seed(runs(), run(runId));
  assert.equal((await responseBody({ action: "retire-empty-run", runId, expectedRunVersion: 99 })).response.status, 409);
  const retired = await responseBody({ action: "retire-empty-run", runId, expectedRunVersion: 1 });
  assert.equal(retired.response.status, 200, JSON.stringify(retired.body));
  const saved = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.ok(saved.retiredAt, "retired, not physically deleted");
  assert.equal(saved.audit.at(-1)?.action, "run-retired-empty");
  assert.equal((await responseBody({ action: "retire-empty-run", runId, expectedRunVersion: saved.version })).response.status, 200, "replay is idempotent");
  const projection = (await logisticsDayProjections().doc(serviceDate).get()).data() as LogisticsDayProjection | undefined;
  assert.ok(!projection?.runs.some((item) => item.canonicalId === runId));
  const busyId = `${id}:busy`;
  await seed(runs(), { ...run(busyId), status: "dispatched" });
  assert.equal((await responseBody({ action: "retire-empty-run", runId: busyId, expectedRunVersion: 1 })).response.status, 422);
  assert.equal(((await runs().doc(busyId).get()).data() as DeliveryRun).retiredAt, undefined);
});

test("a planned Run holding assigned work cannot be retired; stale and invalid requests leave authoritative state unchanged", async (t) => {
  const id = prefix();
  t.after(async () => { upstreamRequirements = []; await cleanup(id); });
  const req = requirement(`${id}:busy`);
  upstreamRequirements = [req];
  const runId = `${id}:run`;
  await seed(runs(), run(runId));
  const assigned = await responseBody({ action: "assign-group", by: "integration-test", runId, expectedRunVersion: 1, requirementIds: [req.canonicalId], expectedSourceVersions: { [req.canonicalId]: req.sourceVersion }, scheduledTime: "10:00" });
  assert.equal(assigned.response.status, 200, JSON.stringify(assigned.body));
  const before = (await runs().doc(runId).get()).data() as DeliveryRun;
  const loadsBefore = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).filter((load) => load.runId === runId);
  assert.equal(loadsBefore.length, 1);
  const busy = await responseBody({ action: "retire-empty-run", runId, expectedRunVersion: before.version });
  assert.equal(busy.response.status, 422, JSON.stringify(busy.body));
  const stale = await responseBody({ action: "retire-empty-run", runId, expectedRunVersion: before.version - 1 });
  assert.equal(stale.response.status, 409);
  const badOrder = await responseBody({ action: "set-run-stop-order", runId, expectedRunVersion: before.version, stopIds: ["projection-stop:delivery:not-a-load"] });
  assert.ok([404, 422].includes(badOrder.response.status), String(badOrder.response.status));
  const after = (await runs().doc(runId).get()).data() as DeliveryRun;
  assert.deepEqual(after, before, "no rejected command may change the authoritative Run");
  const loadsAfter = (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad).filter((load) => load.runId === runId);
  assert.deepEqual(loadsAfter, loadsBefore, "nor its assigned work");
});

test("overlapping Runs on one vehicle are allowed (warning-first): both persist and the other Run is untouched", async (t) => {
  const id = prefix();
  t.after(() => cleanup(id));
  const first = `${id}:first`, second = `${id}:second`;
  assert.equal((await responseBody({ action: "create-run", run: { ...run(first), plannedCpuDepartureTime: "08:00", plannedCpuReturnTime: "11:00" } })).response.status, 200);
  const firstSaved = (await runs().doc(first).get()).data() as DeliveryRun;
  const created = await responseBody({ action: "create-run", run: { ...run(second), plannedCpuDepartureTime: "10:00", plannedCpuReturnTime: "13:00" } });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  const moved = await responseBody({ action: "update-run-timing", runId: second, plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "12:00", expectedRunVersion: 1 });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  assert.deepEqual((await runs().doc(first).get()).data(), firstSaved, "the overlapped Run is never modified");
  assert.equal(((await runs().doc(second).get()).data() as DeliveryRun).plannedCpuDepartureTime, "09:00");
  assert.equal((await responseBody({ action: "update-run-timing", runId: second, plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "12:00", expectedRunVersion: 1 })).response.status, 409);
  assert.equal(((await runs().doc(second).get()).data() as DeliveryRun).plannedCpuDepartureTime, "09:00");
});

// ============================================================================================
// Physical-stop (visit) identity and collection location — emulator-backed.
// ============================================================================================
import { FieldValue } from "firebase-admin/firestore";
import { projectionToDashboardData } from "../lib/projection-dashboard-adapter";
import { rebuildLogisticsProjection } from "../lib/logistics-materialisation";
import { groupIntoVisitRows, visitStopId } from "../lib/stop-visits";

const customerA = "oploc:integration-destination";
const customerB = "oploc:integration-other";
const reqFor = (id: string, customer = customerA): FulfilmentRequirement => ({ ...requirement(id), destinationOplocId: customer, destinationLabelSnapshot: customer === customerA ? "Integration Destination" : "Other Customer" });
const runVersion = async (runId: string) => ((await runs().doc(runId).get()).data() as DeliveryRun).version;
const loadsOnDay = async () => (await deliveryLoads().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as DeliveryLoad);
const jobOf = async (req: FulfilmentRequirement) => (await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.map((doc) => doc.data() as LogisticsJob).find((job) => job.requirementId === req.canonicalId)!;
const loadOf = async (req: FulfilmentRequirement) => { const job = await jobOf(req); return (await deliveryLoads().doc(job.activeLoadId!).get()).data() as DeliveryLoad; };
const projectionDoc = async () => (await logisticsDayProjections().doc(serviceDate).get()).data() as LogisticsDayProjection;
const dashboardRun = async (runId: string) => { const data = projectionToDashboardData(await projectionDoc()); return { data, run: data.runs.find((item) => item.canonicalId === runId)!, planner: data.planner.runs.find((item) => item.runId === runId)! }; };
async function assignReq(req: FulfilmentRequirement, runId: string, time: string, extra: Record<string, unknown> = {}, status = 200) {
  upstreamRequirements = [...upstreamRequirements.filter((item) => item.canonicalId !== req.canonicalId), req];
  const expectedLoadVersions = Object.fromEntries((await loadsOnDay()).map((load) => [load.id, load.version]));
  const result = await responseBody({ action: "assign-group", by: "integration-test", runId, expectedRunVersion: await runVersion(runId), requirementIds: [req.canonicalId], expectedSourceVersions: { [req.canonicalId]: req.sourceVersion }, scheduledTime: time, expectedLoadVersions, ...extra });
  assert.equal(result.response.status, status, JSON.stringify(result.body));
  return result;
}
async function scheduleCollection(req: FulfilmentRequirement, runId: string, time: string, extra: Record<string, unknown> = {}, status = 200) {
  const load = await loadOf(req);
  const result = await responseBody({ action: "reschedule-delivery-load", lane: "collection", loadId: load.id, targetRunId: runId, scheduledTime: time, expectedLoadVersion: load.version, ...extra });
  assert.equal(result.response.status, status, JSON.stringify(result.body));
  return result;
}
const seededRuns = async (id: string) => { const first = `${id}:run1`, second = `${id}:run2`; await seed(runs(), run(first)); await seed(runs(), { ...run(second), vehicleId: "van2" }); return { first, second }; };
const physicalRows = (planner: { stops: Array<{ stopId: string; visitId?: string; lane: string }> }) => groupIntoVisitRows(planner.stops);

test("visits 1+5: two deliveries to one customer share ONE physical stop, and the collection stop resolves to the customer, not CPU", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first } = await seededRuns(id);
  const a = reqFor(`${id}:a`), b = reqFor(`${id}:b`);
  await assignReq(a, first, "10:00");
  await assignReq(b, first, "10:30"); // different time, same customer, one unambiguous visit -> joins
  const [la, lb] = [await loadOf(a), await loadOf(b)];
  assert.notEqual(la.id, lb.id, "individual loads keep their own identity");
  assert.ok(la.deliveryVisitId && la.deliveryVisitId === lb.deliveryVisitId, "same visit id");
  const originBefore = la.originOplocId;
  assert.equal(la.destinationOplocId, customerA);
  const { planner } = await dashboardRun(first);
  assert.equal(physicalRows(planner).length, 1, "ONE physical stop");
  assert.equal((await projectionDoc()).deliveryLoads.filter((load) => load.runId === first).length, 1, "projected as one stop even though the planned times differ");
  await scheduleCollection(a, first, "15:00");
  const view = await dashboardRun(first);
  const collection = view.data.stops.find((stop) => stop.movementType === "collection")!;
  assert.equal(collection.locationOplocId, customerA, "collection stop location is the CUSTOMER");
  assert.equal(collection.locationLabelSnapshot, "Integration Destination");
  assert.notEqual(collection.locationOplocId, la.originOplocId);
  const after = await loadOf(a);
  assert.equal(after.originOplocId, originBefore, "origin/destination never rewritten by collection scheduling");
  assert.equal(after.destinationOplocId, customerA);
});

test("visit 2: a delivery plus a collection at one customer on one Run is ONE mixed physical stop", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first } = await seededRuns(id);
  const a = reqFor(`${id}:a`), b = reqFor(`${id}:b`);
  await assignReq(a, first, "10:00");
  await assignReq(b, first, "10:00");
  await scheduleCollection(a, first, "15:00");
  const la = await loadOf(a);
  assert.ok(la.deliveryVisitId);
  assert.equal(la.collectionVisitId, la.deliveryVisitId, "the collection joined the delivery visit by default");
  const { planner } = await dashboardRun(first);
  const rows = physicalRows(planner);
  assert.equal(rows.length, 1, "one mixed physical stop");
  assert.deepEqual(rows[0].stops.map((stop) => stop.lane).sort(), ["collection", "delivery"]);
  const ok = await responseBody({ action: "set-run-stop-order", runId: first, expectedRunVersion: await runVersion(first), stopIds: [visitStopId(la.deliveryVisitId!)] });
  assert.equal(ok.response.status, 200, JSON.stringify(ok.body));
});

test("visit 3: deliberate repeat visits to one customer on one Run; ambiguity forces an explicit choice; New visit is explicit", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first } = await seededRuns(id);
  const [a, b, c, d] = ["a", "b", "c", "d"].map((x) => reqFor(`${id}:${x}`));
  await assignReq(a, first, "09:00");
  await assignReq(b, first, "12:00", { visit: "new" });
  const [la, lb] = [await loadOf(a), await loadOf(b)];
  assert.notEqual(la.deliveryVisitId, lb.deliveryVisitId, "an explicit new visit is a separate physical stop");
  assert.equal(physicalRows((await dashboardRun(first)).planner).length, 2);
  const ambiguous = await assignReq(c, first, "10:00", {}, 422);
  assert.equal((ambiguous.body.error as { code?: string }).code, "LOGISTICS_VISIT_CHOICE_REQUIRED");
  assert.equal((await logisticsJobs().where("serviceDate", "==", serviceDate).get()).docs.some((doc) => (doc.data() as LogisticsJob).requirementId === c.canonicalId && (doc.data() as LogisticsJob).activeLoadId), false, "a rejected choice writes nothing");
  await assignReq(c, first, "10:00", { visit: lb.deliveryVisitId });
  assert.equal((await loadOf(c)).deliveryVisitId, lb.deliveryVisitId);
  upstreamRequirements = [...upstreamRequirements, d];
  assert.equal((await responseBody({ action: "assign-group", by: "integration-test", runId: first, expectedRunVersion: await runVersion(first), requirementIds: [d.canonicalId], expectedSourceVersions: { [d.canonicalId]: 1 }, scheduledTime: "11:00", visit: "visit:not-at-this-customer" })).response.status, 422);
  assert.equal(physicalRows((await dashboardRun(first)).planner).length, 2, "still two physical stops");
});

test("visit 4: delivery on one Run/vehicle and collection on another are different physical stops", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first, second } = await seededRuns(id);
  const a = reqFor(`${id}:a`);
  await assignReq(a, first, "10:00");
  await scheduleCollection(a, second, "15:00");
  const la = await loadOf(a);
  assert.equal(la.runId, first); assert.equal(la.collectionRunId, second);
  assert.ok(la.deliveryVisitId && la.collectionVisitId && la.deliveryVisitId !== la.collectionVisitId, "each leg has its own visit on its own Run");
  const [one, two] = [await dashboardRun(first), await dashboardRun(second)];
  assert.deepEqual(physicalRows(one.planner).map((row) => row.stops.map((stop) => stop.lane)), [["delivery"]]);
  assert.deepEqual(physicalRows(two.planner).map((row) => row.stops.map((stop) => stop.lane)), [["collection"]]);
  assert.equal(two.planner.stops[0].destination.id, customerA, "the collection stop on the other vehicle is at the customer");
  assert.equal(((await runs().doc(second).get()).data() as DeliveryRun).vehicleId, "van2");
});

test("visit 6: editing a load time never splits its physical stop; moving it to another Run leaves the visit", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first, second } = await seededRuns(id);
  const [a, b] = [reqFor(`${id}:a`), reqFor(`${id}:b`)];
  await assignReq(a, first, "10:00"); await assignReq(b, first, "10:30"); // two loads, one visit
  assert.notEqual((await loadOf(a)).id, (await loadOf(b)).id);
  const lb = await loadOf(b);
  const edited = await responseBody({ action: "reschedule-delivery-load", loadId: lb.id, targetRunId: first, scheduledTime: "13:30", expectedLoadVersion: lb.version });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  assert.equal((await loadOf(b)).deliveryVisitId, (await loadOf(a)).deliveryVisitId, "membership unchanged by a time edit");
  assert.equal(physicalRows((await dashboardRun(first)).planner).length, 1, "still ONE stop");
  assert.equal((await projectionDoc()).deliveryLoads.filter((load) => load.runId === first)[0].jobCount, 2);
  const current = await loadOf(b);
  const moved = await responseBody({ action: "reschedule-delivery-load", loadId: current.id, targetRunId: second, scheduledTime: "11:00", expectedLoadVersion: current.version });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  const [la, lbAfter] = [await loadOf(a), await loadOf(b)];
  assert.equal(lbAfter.runId, second);
  assert.notEqual(lbAfter.deliveryVisitId, la.deliveryVisitId);
  assert.equal(physicalRows((await dashboardRun(first)).planner).length, 1);
  assert.equal(physicalRows((await dashboardRun(second)).planner).length, 1);
});

test("visits 7+8: reordering physical stops persists membership and order; the driver projection and execution follow it without completing unrelated work", async (t) => {
  const id = prefix(); t.after(async () => { upstreamRequirements = []; await cleanup(id); });
  const { first } = await seededRuns(id);
  const [a, b, c] = [reqFor(`${id}:a`), reqFor(`${id}:b`), reqFor(`${id}:c`, customerB)];
  await assignReq(a, first, "09:00"); await assignReq(b, first, "09:30"); await assignReq(c, first, "08:00");
  const [la, lb, lc] = [await loadOf(a), await loadOf(b), await loadOf(c)];
  assert.equal(la.deliveryVisitId, lb.deliveryVisitId);
  assert.notEqual(la.deliveryVisitId, lc.deliveryVisitId);
  const baseline = (await dashboardRun(first)).planner.stops.map((stop) => stop.destination.id);
  assert.deepEqual(baseline, [customerB, customerA], "unordered work follows planned time");
  const order = [visitStopId(la.deliveryVisitId!), visitStopId(lc.deliveryVisitId!)];
  const saved = await responseBody({ action: "set-run-stop-order", runId: first, expectedRunVersion: await runVersion(first), stopIds: order });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(((await runs().doc(first).get()).data() as DeliveryRun).orderedStopIds, order, "stored on the canonical Run");
  const day = await (await GET(new NextRequest(`http://localhost/api/logistics?projection=1&serviceDate=${serviceDate}`))).json() as { planner: { runs: Array<{ runId: string; stops: Array<{ destination: { id: string }; sequence: number }> }> } };
  const driverStops = day.planner.runs.find((item) => item.runId === first)!.stops;
  assert.deepEqual(driverStops.map((stop) => stop.destination.id), [customerA, customerB], "driver sees the chosen visit sequence");
  assert.deepEqual(driverStops.map((stop) => stop.sequence), [1, 2]);
  const projection = await projectionDoc();
  const group = projection.deliveryLoads.find((load) => (load.loadIds || [load.id]).includes(la.id))!;
  assert.equal((group.loadIds || []).length, 2, "both loads execute as one projected stop despite different planned times");
  const jobA = await jobOf(a), jobB = await jobOf(b), jobC = await jobOf(c);
  const one = await responseBody({ action: "mark-subload-loaded", runId: first, expectedRunVersion: await runVersion(first), stopId: `projection-stop:delivery:${group.id}`, loadIds: group.loadIds, expectedLoadVersions: group.loadVersions, jobId: jobA.id, expectedJobVersion: jobA.version, loaded: true });
  assert.equal(one.response.status, 200, JSON.stringify(one.body));
  assert.equal((await jobOf(a)).deliveryStatus, "loaded");
  assert.notEqual((await jobOf(b)).deliveryStatus, "loaded", "the sibling in the same physical stop is untouched");
  assert.notEqual((await jobOf(c)).deliveryStatus, "loaded", "so is the other visit");
  assert.equal(jobB.version, (await jobOf(b)).version); assert.equal(jobC.version, (await jobOf(c)).version);
});

test("visit 9: legacy loads without visit fields stay readable by placement and gain an id only when work is deliberately joined", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first } = await seededRuns(id);
  const [a, b, c] = [reqFor(`${id}:a`), reqFor(`${id}:b`), reqFor(`${id}:c`)];
  await assignReq(a, first, "10:00"); await assignReq(b, first, "11:00", { visit: "new" });
  for (const load of await loadsOnDay()) if (load.runId === first) await deliveryLoads().doc(load.id).update({ deliveryVisitId: FieldValue.delete(), collectionVisitId: FieldValue.delete() });
  await rebuildLogisticsProjection(serviceDate, "legacy-test");
  const legacy = await dashboardRun(first);
  assert.equal(physicalRows(legacy.planner).length, 2, "legacy placements project exactly as before: one stop per placement");
  assert.ok(legacy.planner.stops.every((stop) => stop.visitId === undefined));
  await assignReq(c, first, "10:00", {}, 422);
  const lb = await loadOf(b);
  await assignReq(c, first, "10:00", { visit: `member:${lb.id}` });
  const [lbAfter, lc, la] = [await loadOf(b), await loadOf(c), await loadOf(a)];
  assert.ok(lbAfter.deliveryVisitId, "the joined legacy load was given an explicit identity in the same transaction");
  assert.equal(lc.deliveryVisitId, lbAfter.deliveryVisitId);
  assert.equal(la.deliveryVisitId, undefined, "unrelated legacy load is untouched");
  assert.equal(physicalRows((await dashboardRun(first)).planner).length, 2);
});

test("visit 10: stale versions, vehicle authority, idempotency and rejected mutations leave authoritative state unchanged", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first, second } = await seededRuns(id);
  const [a, b] = [reqFor(`${id}:a`), reqFor(`${id}:b`)];
  await assignReq(a, first, "10:00"); await assignReq(b, first, "10:00");
  const snapshot = async () => JSON.stringify([(await loadsOnDay()).sort((x, y) => x.id.localeCompare(y.id)), (await runs().doc(first).get()).data(), (await runs().doc(second).get()).data()]);
  const before = await snapshot();
  const lb = await loadOf(b);
  assert.equal((await responseBody({ action: "reschedule-delivery-load", loadId: lb.id, targetRunId: second, scheduledTime: "11:00", expectedLoadVersion: lb.version - 1 })).response.status, 409);
  assert.equal((await responseBody({ action: "set-run-stop-order", runId: first, expectedRunVersion: 0, stopIds: [] })).response.status, 409);
  assert.equal((await responseBody({ action: "set-run-stop-order", runId: first, expectedRunVersion: await runVersion(first), stopIds: ["projection-visit:visit:nope"] })).response.status, 422);
  assert.equal((await responseBody({ action: "reschedule-delivery-load", loadId: lb.id, targetRunId: second, scheduledTime: "11:00", expectedLoadVersion: lb.version, visit: "visit:not-on-this-run" })).response.status, 422);
  principalVehicles = ["van1"];
  const forbidden = await responseBody({ action: "reschedule-delivery-load", loadId: lb.id, targetRunId: second, scheduledTime: "11:00", expectedLoadVersion: lb.version });
  assert.ok([403, 404].includes(forbidden.response.status), String(forbidden.response.status));
  assert.ok([403, 404].includes((await responseBody({ action: "set-run-stop-order", runId: second, expectedRunVersion: 1, stopIds: [] })).response.status));
  principalVehicles = ["van1", "van2"];
  assert.equal(await snapshot(), before, "no rejected command changed any Run or load");
  const la = await loadOf(a);
  const order = { action: "set-run-stop-order", runId: first, stopIds: [visitStopId(la.deliveryVisitId!)] };
  assert.equal((await responseBody({ ...order, expectedRunVersion: await runVersion(first) })).response.status, 200);
  const settled = await snapshot();
  assert.equal((await responseBody({ ...order, expectedRunVersion: await runVersion(first) })).response.status, 200);
  assert.equal(await snapshot(), settled, "replay changes nothing");
  const replay = await assignReq(a, first, "10:00");
  assert.equal(replay.response.status, 200);
  assert.equal((await loadOf(a)).deliveryVisitId, la.deliveryVisitId);
});

test("native stops: several visits at one customer need an explicit choice; New visit and a target stop are honoured", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const runId = `${id}:run`;
  await seed(runs(), run(runId));
  const ids = [`${id}:m1`, `${id}:m2`, `${id}:m3`];
  for (const mid of ids) await seed(movements(), movement(mid));
  const assignMovement = async (mid: string, extra: Record<string, unknown> = {}) => responseBody({ action: "assign", by: "integration-test", runId, expectedRunVersion: await runVersion(runId), movementId: mid, plannedArrivalTime: "10:00", ...extra });
  assert.equal((await assignMovement(ids[0])).response.status, 200);
  assert.equal((await assignMovement(ids[1], { newVisit: true })).response.status, 200, "deliberate repeat visit at the same customer");
  assert.equal((await stops().where("runId", "==", runId).get()).size, 2);
  const ambiguous = await assignMovement(ids[2]);
  assert.ok([400, 422].includes(ambiguous.response.status), String(ambiguous.response.status));
  assert.equal((ambiguous.body.error as { code?: string }).code, "LOGISTICS_VISIT_CHOICE_REQUIRED");
  const [firstStop] = (await stops().where("runId", "==", runId).get()).docs.map((doc) => doc.data() as DeliveryStop).sort((x, y) => x.sequence - y.sequence);
  assert.equal((await assignMovement(ids[2], { targetStopId: firstStop.canonicalId })).response.status, 200);
  const after = (await stops().where("runId", "==", runId).get()).docs.map((doc) => doc.data() as DeliveryStop);
  assert.equal(after.length, 2, "joined an existing visit, no third stop");
  assert.equal(after.find((stop) => stop.canonicalId === firstStop.canonicalId)!.movementRequestIds.length, 2);
});

// ============================================================================================
// Journey Planner V3: "+ Add collection" inside a physical stop — a governed collection movement AT THE CUSTOMER
// that joins the (load-backed) visit by explicit visit id, so both are ONE physical stop on the Run.
// ============================================================================================
const collectionMovement = (mid: string, customer = customerA, quantity = 3): MovementRequest => ({
  canonicalId: mid, entityType: "Movement Request", type: "collection", serviceDate, fromOplocId: customer,
  items: [{ description: "Empty hot boxes", quantity, unit: "boxes" }], createdBy: "integration-test", status: "open", version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audit: [],
});
async function addCollection(runId: string, mid: string, extra: Record<string, unknown> = {}, customer = customerA) {
  const saved = await responseBody({ action: "save-movement", movement: collectionMovement(mid, customer) });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  return responseBody({ action: "assign", by: "integration-test", runId, expectedRunVersion: await runVersion(runId), movementId: mid, ...extra });
}

test("collections 1: a collection movement joins the load-backed visit by explicit visit id: ONE physical stop, one order key, driver order follows", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first } = await seededRuns(id);
  const a = reqFor(`${id}:a`), other = reqFor(`${id}:o`, customerB);
  await assignReq(a, first, "10:00");
  await assignReq(other, first, "11:00");
  const la = await loadOf(a);
  assert.ok(la.deliveryVisitId);
  const mid = `${id}:collect`;
  const joined = await addCollection(first, mid, { visit: visitStopId(la.deliveryVisitId!) });
  assert.equal(joined.response.status, 200, JSON.stringify(joined.body));
  const native = (await stops().where("runId", "==", first).get()).docs.map((doc) => doc.data() as DeliveryStop);
  assert.equal(native.length, 1);
  assert.equal(native[0].visitId, la.deliveryVisitId, "the native collection stop carries the visit id");
  assert.equal(native[0].locationOplocId, customerA, "the pickup is the selected customer, never CPU");
  assert.deepEqual(native[0].movementRequestIds, [mid]);
  const saved = (await movements().doc(mid).get()).data() as MovementRequest;
  assert.deepEqual(saved.items, [{ description: "Empty hot boxes", quantity: 3, unit: "boxes" }]);
  assert.equal(saved.fromOplocId, customerA);
  const { planner } = await dashboardRun(first);
  const rows = physicalRows(planner);
  assert.equal(rows.length, 2, "customer A (delivery + collection) and customer B");
  const mixed = rows.find((row) => row.key === visitStopId(la.deliveryVisitId!))!;
  assert.deepEqual(mixed.stops.map((stop) => stop.lane).sort(), ["collection", "delivery"]);
  // the existing delivery is unchanged
  assert.equal((await loadOf(a)).deliveryVisitId, la.deliveryVisitId);
  assert.equal((await loadOf(a)).scheduledTime, "10:00");
  // exact-permutation order validation treats the visit as ONE stop and accepts any member id of it
  const otherLoad = await loadOf(other);
  const order = [visitStopId(otherLoad.deliveryVisitId!), visitStopId(la.deliveryVisitId!)];
  const ok = await responseBody({ action: "set-run-stop-order", runId: first, expectedRunVersion: await runVersion(first), stopIds: order });
  assert.equal(ok.response.status, 200, JSON.stringify(ok.body));
  const twice = await responseBody({ action: "set-run-stop-order", runId: first, expectedRunVersion: await runVersion(first), stopIds: [order[0], native[0].canonicalId, order[1]] });
  assert.equal(twice.response.status, 422, "naming the same physical stop twice (visit id + its native member) is refused");
  assert.deepEqual(((await runs().doc(first).get()).data() as DeliveryRun).orderedStopIds, order, "the stored order names visits");
  const reordered = (await dashboardRun(first)).planner;
  assert.equal(reordered.stops[0].destination.id, customerB, "saved order is honoured");
});

test("collections 2: a visit id at another customer or run is refused and writes nothing; a second collection joins the same native stop", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first, second } = await seededRuns(id);
  const a = reqFor(`${id}:a`), other = reqFor(`${id}:o`, customerB);
  await assignReq(a, first, "10:00");
  await assignReq(other, first, "11:00");
  const [la, lo] = [await loadOf(a), await loadOf(other)];
  const before = JSON.stringify((await stops().where("runId", "==", first).get()).docs.map((doc) => doc.data()));
  const wrongCustomer = await addCollection(first, `${id}:c1`, { visit: visitStopId(lo.deliveryVisitId!) }); // visit B offered to a collection at customer A
  assert.equal(wrongCustomer.response.status, 422, JSON.stringify(wrongCustomer.body));
  const wrongRun = await addCollection(second, `${id}:c2`, { visit: visitStopId(la.deliveryVisitId!) }); // visit A lives on the first run
  assert.equal(wrongRun.response.status, 422, JSON.stringify(wrongRun.body));
  assert.equal(JSON.stringify((await stops().where("runId", "==", first).get()).docs.map((doc) => doc.data())), before, "rejected joins write no stop");
  assert.equal((await stops().where("runId", "==", second).get()).size, 0);
  assert.equal(((await movements().doc(`${id}:c1`).get()).data() as MovementRequest).status, "open", "the movement stays open in the queue, nothing is lost");
  const ok = await addCollection(first, `${id}:c3`, { visit: visitStopId(la.deliveryVisitId!) });
  assert.equal(ok.response.status, 200, JSON.stringify(ok.body));
  const again = await responseBody({ action: "assign", by: "integration-test", runId: first, expectedRunVersion: await runVersion(first), movementId: `${id}:c1`, visit: visitStopId(la.deliveryVisitId!) });
  assert.equal(again.response.status, 200, JSON.stringify(again.body));
  const native = (await stops().where("runId", "==", first).get()).docs.map((doc) => doc.data() as DeliveryStop);
  assert.equal(native.length, 1, "the second collection joined the existing native member of the visit");
  assert.equal(native[0].movementRequestIds.length, 2);
  assert.equal(physicalRows((await dashboardRun(first)).planner).length, 2);
});

test("collections 3: an explicit New visit keeps a collection separate from the delivery visit", async (t) => {
  const id = prefix(); t.after(() => cleanup(id));
  const { first } = await seededRuns(id);
  const a = reqFor(`${id}:a`);
  await assignReq(a, first, "10:00");
  const separate = await addCollection(first, `${id}:sep`, { visit: "new" });
  assert.equal(separate.response.status, 200, JSON.stringify(separate.body));
  const native = (await stops().where("runId", "==", first).get()).docs.map((doc) => doc.data() as DeliveryStop);
  assert.equal(native.length, 1);
  assert.equal(native[0].visitId, undefined);
  assert.equal(physicalRows((await dashboardRun(first)).planner).length, 2, "delivery visit and the deliberate separate collection stop");
});
