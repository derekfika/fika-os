import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";

/**
 * Actual POST /api/production-plan route regressions against an isolated, throw-away Firestore EMULATOR (demo project, loopback
 * port, started and killed by this file). Nothing here can reach production Firestore: the route module is only imported after the
 * runtime is pinned to local mode with an emulator host, and local mode refuses any other configuration.
 */
const PORT = 8197;
const HOST = `127.0.0.1:${PORT}`;
const PROJECT = "demo-fika-os";
const saved = { nodeEnv: process.env.NODE_ENV, snapshots: process.env.FIKA_SNAPSHOT_DIR, mode: process.env.FIKA_RUNTIME_MODE, host: process.env.FIRESTORE_EMULATOR_HOST, project: process.env.FIREBASE_PROJECT_ID, store: process.env.FIKA_CPU_PLAN_STORE, fetch: globalThis.fetch };
let emulator: ChildProcess | undefined;
let workdir = "";

const listening = () => new Promise<boolean>((resolve) => {
  const socket = net.connect(PORT, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

before(async () => {
  assert.equal(await listening(), false, `port ${PORT} is already in use; refusing to share someone else's emulator`);
  workdir = mkdtempSync(path.join(tmpdir(), "fika-cpu-route-emulator-"));
  writeFileSync(path.join(workdir, "firebase.json"), JSON.stringify({ emulators: { firestore: { host: "127.0.0.1", port: PORT }, ui: { enabled: false } } }));
  emulator = spawn("firebase", ["emulators:start", "--only", "firestore", "--project", PROJECT], { cwd: workdir, shell: true, detached: process.platform !== "win32", stdio: "ignore" });
  const deadline = Date.now() + 90_000;
  while (!(await listening())) {
    assert.ok(Date.now() < deadline, "the isolated Firestore emulator did not start within 90 seconds");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  process.env.FIREBASE_PROJECT_ID = PROJECT;
  process.env.FIKA_SNAPSHOT_DIR = path.join(workdir, "read-packages"); // package store writes stay inside this throw-away directory
  Reflect.deleteProperty(process.env, "NODE_ENV"); // CI sets test, which otherwise forces the memory repository and bypasses these emulator transactions
  delete process.env.FIKA_CPU_PLAN_STORE; // the real Firestore-backed repository, pointed at the emulator
}, { timeout: 120_000 });

after(() => {
  globalThis.fetch = saved.fetch;
  const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  restore("NODE_ENV", saved.nodeEnv); restore("FIKA_SNAPSHOT_DIR", saved.snapshots); restore("FIKA_RUNTIME_MODE", saved.mode); restore("FIRESTORE_EMULATOR_HOST", saved.host); restore("FIREBASE_PROJECT_ID", saved.project); restore("FIKA_CPU_PLAN_STORE", saved.store);
  if (emulator?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(emulator.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try { process.kill(-emulator.pid, "SIGTERM"); } // only the process group created by this fixture
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  }
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

const DEFAULT_SERVICE_DATE = "2026-10-20";
const orderFor = (orderId: string, SERVICE_DATE = DEFAULT_SERVICE_DATE) => ({
  canonicalId: orderId, entityType: "Production Order", schemaVersion: "0.1.0", version: 1, requirementIds: [], origin: "menu_planning", status: "planning", serviceDate: SERVICE_DATE,
  requiredBy: `${SERVICE_DATE}T12:00:00.000Z`, lines: [{ canonicalId: `line:${orderId}`, itemName: "Concurrency dish", customerQuantity: 4 }], exceptions: [], audit: [], destinationOplocId: "oploc:test", destinationLabel: "Test site",
});
const installOrderFetch = (orderId: string, serviceDate?: string) => {
  const order = orderFor(orderId, serviceDate);
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order }), { status: 200 });
    if (url.includes("/api/production?serviceDate=") || url.includes("/api/production?weekCommencing=")) return new Response(JSON.stringify({ orders: [order] }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url}`);
  }) as typeof fetch;
};
const sub = (notes: string, allergens: Record<string, string> = { milk: "clear" }) => ({ id: "sub:1", name: "Concurrency dish", quantity: 4, allergens, note: notes, evidenceStatus: "not_completed" });
const menuItems = (notes: string, allergens?: Record<string, string>) => [{ id: "menu:1", sourceLineId: "line:x", name: "Concurrency dish", note: "", subItems: [sub(notes, allergens)] }];
const post = (POST: (request: NextRequest) => Promise<Response>, body: unknown) => POST(new NextRequest("http://localhost/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/** Test hook: runs right after a production-plan write transaction commits (i.e. at the CPU-committed / Hub-not-yet-touched point). */
let afterPlanTransaction: (() => void) | undefined;
type Gate = { arrived: number; releases: Array<() => void>; waiters: Array<() => void> };
async function importRouteWithTransactionGate() {
  const { db } = await import("../lib/firebase-admin");
  const original = db.runTransaction.bind(db);
  let gate: Gate | undefined;
  (db as unknown as { runTransaction: unknown }).runTransaction = (async (...args: Parameters<typeof original>) => {
    // Only the production-plan repository's write transaction is held; this is the point AFTER the route's own initial reads.
    const isPlanTransaction = /FirestoreProductionPlanRepository/.test(new Error().stack || "");
    if (gate && isPlanTransaction) {
      const current = gate;
      current.arrived += 1;
      current.waiters.splice(0).forEach((wake) => wake());
      await new Promise<void>((release) => current.releases.push(release));
    }
    const result = await original(...args);
    if (isPlanTransaction) afterPlanTransaction?.();
    return result;
  }) as typeof db.runTransaction;
  const { POST, GET } = await import("../app/api/production-plan/route");
  return {
    db, POST, GET,
    hold() { gate = { arrived: 0, releases: [], waiters: [] }; return gate; },
    async arrivals(count: number, inFlight: Promise<Response>) {
      const current = gate!;
      const deadline = Date.now() + 30_000;
      let settled: Response | undefined;
      void inFlight.then((response) => { settled = response; current.waiters.splice(0).forEach((wake) => wake()); });
      while (current.arrived < count) {
        if (settled) throw new Error(`request finished before reaching the write transaction: ${settled.status} ${await settled.clone().text()}`);
        assert.ok(Date.now() < deadline, "timed out waiting for the request to reach the write transaction");
        await new Promise<void>((wake) => { current.waiters.push(wake); setTimeout(wake, 1_000); });
      }
    },
    release(index: number) { gate!.releases[index](); },
    open() { gate = undefined; },
    pending() { return gate ? gate.releases : []; },
  };
}

const STATE_COLLECTIONS = ["fikaCpuProductionChangesV1", "fikaCpuProductionChangeCursorV1", "fikaCpuProductionChangeReceiptsV1", "fikaCpuPropagationOutboxV1"] as const;
async function snapshotEvidence(db: Awaited<ReturnType<typeof importRouteWithTransactionGate>>["db"], orderId: string) {
  const plan = await db.collection("fikaCpuProductionPlansV1").doc(orderId).get();
  const rest: Record<string, unknown> = {};
  for (const name of STATE_COLLECTIONS) rest[name] = (await db.collection(name).get()).docs.map((doc) => [doc.id, doc.data()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.parse(JSON.stringify({ plan: plan.exists ? plan.data() : null, ...rest }));
}

const seededPlan = (orderId: string, updatedAt?: string) => ({
  id: `production-plan:${orderId}`, orderId, status: "planning", menuItems: menuItems("seed"), planningNotes: "seed", updatedBy: "seed", audit: [{ action: "seeded", at: "2026-10-01T09:00:00.000Z", by: "seed" }],
  ...(updatedAt ? { updatedAt } : {}),
});

const scenarios: Array<{ name: string; orderId: string; seed?: (orderId: string) => Record<string, unknown>; expectedRevision: string | null }> = [
  { name: "first creation of a plan (two reviewers both loaded no stored plan)", orderId: "production-order:concurrency-new", expectedRevision: null },
  { name: "legacy unstamped plan (no updatedAt)", orderId: "production-order:concurrency-legacy", seed: (orderId) => seededPlan(orderId), expectedRevision: "legacy-unversioned" },
  { name: "normal timestamped plan", orderId: "production-order:concurrency-versioned", seed: (orderId) => seededPlan(orderId, "2026-10-01T10:00:00.000Z"), expectedRevision: "2026-10-01T10:00:00.000Z" },
];

for (const scenario of scenarios) {
  test(`POST /api/production-plan: second concurrent save is rejected with 409 and changes nothing — ${scenario.name}`, { timeout: 120_000 }, async () => {
    installOrderFetch(scenario.orderId);
    const route = await importRouteWithTransactionGate();
    if (scenario.seed) await route.db.collection("fikaCpuProductionPlansV1").doc(scenario.orderId).set(scenario.seed(scenario.orderId));
    const save = (notes: string) => post(route.POST, { action: "save-plan", orderId: scenario.orderId, planningNotes: notes, expectedRevision: scenario.expectedRevision, menuItems: menuItems(notes) });

    route.hold();
    // Reviewer A and reviewer B each complete the route's initial reads (stored plan + revision pre-check) and are then held at the write transaction.
    const requestA = save("reviewer A evidence");
    await route.arrivals(1, requestA);
    const requestB = save("reviewer B evidence");
    await route.arrivals(2, requestB);

    try {
    route.release(0);
    const responseA = await requestA;
    const bodyA = await responseA.json();
    assert.equal(responseA.status, 200, `A commits first: ${JSON.stringify(bodyA).slice(0, 500)}`);
    assert.ok(bodyA.revision && bodyA.revision !== scenario.expectedRevision, "A advances the revision");
    const afterA = await snapshotEvidence(route.db, scenario.orderId);
    assert.equal(afterA.plan.planningNotes, "reviewer A evidence");
    assert.ok(afterA.fikaCpuProductionChangesV1.length >= 1, "A left durable change evidence");

    route.release(1);
    const responseB = await requestB;
    assert.equal(responseB.status, 409, "B held its initial read, A committed, B resumed => atomic conflict");
    assert.equal((await responseB.json()).error.code, "CPU_ALLERGEN_REVIEW_CONFLICT");

    const afterB = await snapshotEvidence(route.db, scenario.orderId);
    assert.deepEqual(afterB, afterA, "B changed neither the stored plan (evidence/signatures/audit) nor any change, receipt, cursor or outbox record");
    } finally {
      for (const release of route.pending()) release();
      route.open();
    }
  });
}

test("POST /api/production-plan: a forged no_key_allergens value is ignored and derived on the server from the 14 named allergens", { timeout: 120_000 }, async () => {
  const orderId = "production-order:concurrency-nokey";
  installOrderFetch(orderId);
  const route = await importRouteWithTransactionGate();
  route.open();
  let revision: string | null = null;
  let lastOrderId = orderId;
  const named = ["peanuts", "tree_nuts", "gluten", "sesame", "molluscs", "fish", "soya", "celery", "shellfish", "eggs", "milk", "mustard", "lupin", "sulphites"];
  const cases: Array<{ forged: string; allergens: Record<string, string>; expected: string }> = [
    { forged: "contains", allergens: { milk: "clear", gluten: "clear" }, expected: "unrecorded" },
    { forged: "contains", allergens: {}, expected: "unrecorded" },
    { forged: "may_contain", allergens: { milk: "unrecorded" }, expected: "unrecorded" },
    { forged: "contains", allergens: { gluten: "contains", milk: "may_contain", peanuts: "clear" }, expected: "clear" },
    { forged: "unrecorded", allergens: Object.fromEntries(named.map((key) => [key, "clear"])), expected: "contains" },
  ];
  for (const [index, scenario] of cases.entries()) {
    // One order and service date per case: each case is an independent first save with its own change/package sequence.
    const caseOrderId = `${orderId}-${index}`;
    installOrderFetch(caseOrderId, `2026-11-0${index + 1}`);
    const sent = { ...scenario.allergens, no_key_allergens: scenario.forged };
    const response = await post(route.POST, { action: "save-plan", orderId: caseOrderId, planningNotes: `forged ${index}`, expectedRevision: null, menuItems: menuItems(`forged ${index}`, sent) });
    const body = await response.json();
    assert.equal(response.status, 200, `case ${index}: ${JSON.stringify(body).slice(0, 600)}`);
    const stored = (await route.db.collection("fikaCpuProductionPlansV1").doc(caseOrderId).get()).data() as { menuItems: Array<{ subItems: Array<{ allergens: Record<string, string> }> }> };
    const allergens = stored.menuItems.flatMap((item) => item.subItems).find((candidate) => candidate.allergens)!.allergens;
    assert.equal(allergens.no_key_allergens, scenario.expected, `case ${index}: derived, not the forged ${scenario.forged}`);
    for (const [key, state] of Object.entries(scenario.allergens)) assert.equal(allergens[key], state, `case ${index}: named ${key} preserved exactly`);
    revision = body.revision;
    lastOrderId = caseOrderId;
  }
  const forgedPlanned = await post(route.POST, { action: "mark-planned", orderId: lastOrderId, planningNotes: "", expectedRevision: revision, menuItems: menuItems("x", { milk: "clear", no_key_allergens: "contains" }) });
  assert.equal(forgedPlanned.status, 422, "a forged 'No key allergens' cannot complete an incomplete matrix");
});

// ---------------------------------------------------------------------------------------------------------------------------
// mark-planned ordering: CPU validates and atomically persists FIRST; the Hub lifecycle is only touched afterwards.
// ---------------------------------------------------------------------------------------------------------------------------
const NAMED = ["peanuts", "tree_nuts", "gluten", "sesame", "molluscs", "fish", "soya", "celery", "shellfish", "eggs", "milk", "mustard", "lupin", "sulphites"];
const completeItems = (notes: string, orderId: string) => [{ id: "menu:1", sourceLineId: `line:${orderId}`, name: "Concurrency dish", note: "", subItems: [{ id: "sub:1", name: "Concurrency dish", quantity: 4, allergens: Object.fromEntries(NAMED.map((key) => [key, "clear"])), note: notes, evidenceStatus: "completed" }] }];

/** A stateful stand-in for the Hub that records every lifecycle transition it is asked to make. */
function installHub(orderId: string, serviceDate: string) {
  const hub = { status: "planning", version: 1, transitions: [] as string[], failTransitions: 0, missing: false };
  const current = () => ({ ...orderFor(orderId, serviceDate), status: hub.status, version: hub.version });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/api/production")) {
      if (hub.failTransitions > 0) { hub.failTransitions -= 1; return new Response(JSON.stringify({ error: { message: "hub down" } }), { status: 503 }); }
      const body = JSON.parse(String(init.body)) as { status: string };
      hub.transitions.push(body.status); hub.status = body.status; hub.version += 1;
      return new Response(JSON.stringify({ order: current() }), { status: 200 });
    }
    if (url.includes("/api/production?canonicalId=")) return hub.missing ? new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }), { status: 404 }) : new Response(JSON.stringify({ order: current() }), { status: 200 });
    if (url.includes("/api/production?serviceDate=") || url.includes("/api/production?weekCommencing=")) return new Response(JSON.stringify({ orders: [current()] }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url}`);
  }) as typeof fetch;
  return hub;
}
const storedPlanOf = async (db: Awaited<ReturnType<typeof importRouteWithTransactionGate>>["db"], orderId: string) => (await db.collection("fikaCpuProductionPlansV1").doc(orderId).get()).data() as Record<string, any> | undefined;

test("mark-planned: a stale request is rejected with 409 and the Hub is never touched (pre-check and in-transaction race)", { timeout: 120_000 }, async () => {
  const orderId = "production-order:markplanned-stale";
  const hub = installHub(orderId, "2026-12-01");
  const route = await importRouteWithTransactionGate();
  await route.db.collection("fikaCpuProductionPlansV1").doc(orderId).set(seededPlan(orderId, "2026-10-01T10:00:00.000Z"));
  const markPlanned = (notes: string, expectedRevision: string | null) => post(route.POST, { action: "mark-planned", orderId, planningNotes: notes, expectedRevision, menuItems: completeItems(notes, orderId) });
  try {
    // Race: both reviewers loaded T. B is held at the write transaction, A commits a different save, B resumes.
    const held = route.hold();
    const requestB = markPlanned("B", "2026-10-01T10:00:00.000Z");
    await route.arrivals(1, requestB);
    route.open();
    const responseA = await post(route.POST, { action: "save-plan", orderId, planningNotes: "A", expectedRevision: "2026-10-01T10:00:00.000Z", menuItems: menuItems("A") });
    assert.equal(responseA.status, 200);
    const afterA = await storedPlanOf(route.db, orderId);
    held.releases[0]();
    const responseB = await requestB;
    assert.equal(responseB.status, 409, "B loses the atomic compare");
    assert.deepEqual(hub.transitions, [], "a failed CPU save leaves the Hub untouched");
    assert.equal(hub.status, "planning");
    assert.deepEqual(await storedPlanOf(route.db, orderId), afterA, "B changed nothing in CPU");
    // Plain stale request (pre-check path) behaves the same.
    const stale = await markPlanned("C", "2026-10-01T10:00:00.000Z");
    assert.equal(stale.status, 409);
    assert.deepEqual(hub.transitions, []);
    assert.equal((await storedPlanOf(route.db, orderId))!.lifecycleSync, undefined, "no pending marker was written by a rejected request");
  } finally {
    for (const release of route.pending()) release();
    route.open();
  }
});

test("mark-planned: CPU persists first, then the Hub transition happens exactly once, and a repeat has no further Hub effect", { timeout: 120_000 }, async () => {
  const orderId = "production-order:markplanned-success";
  const hub = installHub(orderId, "2026-12-02");
  const route = await importRouteWithTransactionGate();
  route.open();
  const first = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("x", orderId) });
  assert.equal(first.status, 200);
  const revision = (await first.json()).revision as string;
  const markPlanned = (expectedRevision: string) => post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision, menuItems: completeItems("x", orderId) });
  const planned = await markPlanned(revision);
  const body = await planned.json();
  assert.equal(planned.status, 200, JSON.stringify(body).slice(0, 400));
  assert.deepEqual(body.hubLifecycle, { status: "synced" });
  assert.equal(body.synchronised, true);
  assert.deepEqual(hub.transitions, ["planned"], "exactly one Hub transition");
  const stored = (await storedPlanOf(route.db, orderId))!;
  assert.equal(stored.status, "planned");
  assert.equal(stored.lifecycleSync.status, "synced");
  assert.equal(body.revision, stored.updatedAt, "the response carries the revision actually saved");
  // A repeat mark-planned (new revision, same review) must not create a second or contradictory Hub transition.
  const repeat = await markPlanned(body.revision);
  assert.equal(repeat.status, 200);
  assert.deepEqual(hub.transitions, ["planned"]);
});

test("mark-planned: Hub failure after CPU success is reported as pending, stays recoverable, and the retry has exactly one Hub effect", { timeout: 120_000 }, async () => {
  const orderId = "production-order:markplanned-hubfail";
  const hub = installHub(orderId, "2026-12-03");
  const route = await importRouteWithTransactionGate();
  route.open();
  const first = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("y", orderId) });
  const revision = (await first.json()).revision as string;
  const markPlanned = (expectedRevision: string) => post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision, menuItems: completeItems("y", orderId) });

  hub.failTransitions = 100; // the Hub is down for the whole first attempt
  const attempt = await markPlanned(revision);
  const attemptBody = await attempt.json();
  assert.equal(attempt.status, 200, "CPU is durably committed");
  assert.equal(attemptBody.hubLifecycle.status, "pending");
  assert.equal(attemptBody.synchronised, false, "overall synchronisation is not reported complete");
  assert.deepEqual(hub.transitions, []);
  const pendingStored = (await storedPlanOf(route.db, orderId))!;
  assert.equal(pendingStored.status, "planned");
  assert.equal(pendingStored.lifecycleSync.status, "pending", "the pending transition is durably recorded");
  assert.equal(attemptBody.revision, pendingStored.updatedAt);

  hub.failTransitions = 0; // Hub recovers; retry with the revision the first response returned
  const retry = await markPlanned(attemptBody.revision);
  const retryBody = await retry.json();
  assert.equal(retry.status, 200, JSON.stringify(retryBody).slice(0, 400));
  assert.deepEqual(retryBody.hubLifecycle, { status: "synced" });
  assert.deepEqual(hub.transitions, ["planned"], "exactly one effective Hub transition after the retry");
  assert.equal((await storedPlanOf(route.db, orderId))!.lifecycleSync.status, "synced");
  const again = await markPlanned(retryBody.revision);
  assert.equal(again.status, 200);
  assert.deepEqual(hub.transitions, ["planned"], "further retries cannot duplicate or contradict the transition");
});

// ---------------------------------------------------------------------------------------------------------------------------
// The "synced" marker is only written after the Hub order is VERIFIED to be Planned.
// ---------------------------------------------------------------------------------------------------------------------------
async function plannedWith(orderId: string, serviceDate: string, afterCommit: (hub: ReturnType<typeof installHub>) => void) {
  const hub = installHub(orderId, serviceDate);
  const route = await importRouteWithTransactionGate();
  route.open();
  const first = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("v", orderId) });
  assert.equal(first.status, 200);
  const revision = (await first.json()).revision as string;
  const markPlanned = (expectedRevision: string) => post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision, menuItems: completeItems("v", orderId) });
  // The Hub state changes at the moment CPU has committed and the Hub has not yet been touched.
  afterPlanTransaction = () => afterCommit(hub);
  try {
    const response = await markPlanned(revision);
    return { hub, route, markPlanned, response, body: await response.json() };
  } finally {
    afterPlanTransaction = undefined;
  }
}
const reload = async (route: Awaited<ReturnType<typeof importRouteWithTransactionGate>>, orderId: string) => (await route.GET(new NextRequest(`http://localhost/api/production-plan?orderId=${encodeURIComponent(orderId)}`))).json();

test("lifecycle sync: a missing Hub order is never reported synchronised, stays pending with its reason, and is visible after reload", { timeout: 120_000 }, async () => {
  const orderId = "production-order:lifecycle-missing";
  const { hub, route, markPlanned, response, body } = await plannedWith(orderId, "2026-12-04", (state) => { state.missing = true; });
  assert.equal(response.status, 200, "CPU itself is committed");
  assert.equal(body.hubLifecycle.status, "pending");
  assert.equal(body.hubLifecycle.code, "HUB_ORDER_MISSING");
  assert.equal(body.synchronised, false);
  assert.deepEqual(hub.transitions, []);
  const stored = (await storedPlanOf(route.db, orderId))!;
  assert.equal(stored.lifecycleSync.status, "pending");
  assert.match(stored.lifecycleSync.lastError, /no Production Order with this identity/);
  // Reload (the order is visible again, e.g. restored in the Hub): the warning comes straight from the stored plan; no Save is needed.
  hub.missing = false;
  const reloaded = await reload(route, orderId);
  assert.equal(reloaded.hubLifecycle.status, "pending");
  assert.match(reloaded.hubLifecycle.error, /no Production Order with this identity/);
  assert.equal(reloaded.synchronised, false);
  assert.equal(reloaded.plan.lifecycleSync.status, "pending");
  // The retry transitions it exactly once and the warning clears.
  const retry = await (await markPlanned(body.revision)).json();
  assert.deepEqual({ status: retry.hubLifecycle.status }, { status: "synced" });
  assert.deepEqual(hub.transitions, ["planned"]);
  const cleared = await reload(route, orderId);
  assert.equal(cleared.hubLifecycle, undefined, "no warning once the Hub is verified Planned");
  assert.equal((await storedPlanOf(route.db, orderId))!.lifecycleSync.status, "synced");
});

test("lifecycle sync: a Cancelled Hub order is never moved to Planned or reported synchronised", { timeout: 120_000 }, async () => {
  const orderId = "production-order:lifecycle-cancelled";
  const { hub, route, markPlanned, response, body } = await plannedWith(orderId, "2026-12-05", (state) => { state.status = "cancelled"; });
  assert.equal(response.status, 200);
  assert.equal(body.hubLifecycle.status, "pending");
  assert.equal(body.hubLifecycle.code, "HUB_ORDER_CANCELLED");
  assert.equal(body.synchronised, false);
  assert.deepEqual(hub.transitions, [], "no transition was attempted");
  assert.equal(hub.status, "cancelled", "the Cancelled order was not reactivated");
  assert.match((await reload(route, orderId)).hubLifecycle.error, /Cancelled/);
  // Retrying while it is still Cancelled changes nothing and is still reported as unresolved.
  const retry = await (await markPlanned(body.revision)).json();
  assert.equal(retry.hubLifecycle.status, "pending");
  assert.deepEqual(hub.transitions, []);
  assert.equal(hub.status, "cancelled");
  assert.equal((await storedPlanOf(route.db, orderId))!.lifecycleSync.status, "pending");
});

test("lifecycle sync: an already-Planned Hub order verifies as success with no duplicate transition", { timeout: 120_000 }, async () => {
  const orderId = "production-order:lifecycle-already";
  const { hub, route, markPlanned, response, body } = await plannedWith(orderId, "2026-12-06", (state) => { state.status = "planned"; });
  assert.equal(response.status, 200);
  assert.deepEqual(body.hubLifecycle, { status: "synced" });
  assert.equal(body.synchronised, true);
  assert.deepEqual(hub.transitions, [], "nothing needed to change");
  assert.equal((await storedPlanOf(route.db, orderId))!.lifecycleSync.status, "synced");
  const again = await markPlanned(body.revision);
  assert.equal(again.status, 200);
  assert.deepEqual(hub.transitions, []);
});

test("lifecycle sync: a successful transition is verified against the Hub before the marker becomes synced", { timeout: 120_000 }, async () => {
  const orderId = "production-order:lifecycle-success";
  const { hub, route, response, body } = await plannedWith(orderId, "2026-12-07", () => undefined);
  assert.equal(response.status, 200);
  assert.deepEqual(body.hubLifecycle, { status: "synced" });
  assert.deepEqual(hub.transitions, ["planned"]);
  assert.equal(hub.status, "planned");
  assert.equal((await storedPlanOf(route.db, orderId))!.lifecycleSync.status, "synced");
});

// ---------------------------------------------------------------------------------------------------------------------------
// Matrix semantics: Mark checked confirms the displayed row (white = Clear). The server still never infers Clear from missing data.
// ---------------------------------------------------------------------------------------------------------------------------
test("Mini Pastries: a row confirmed with Gluten/Eggs/Milk persists those as Contains and the other 11 as Clear, via the real route", { timeout: 120_000 }, async () => {
  const orderId = "production-order:matrix-mini-pastries";
  installHub(orderId, "2026-12-08");
  const route = await importRouteWithTransactionGate();
  route.open();
  const { confirmAllergenReviewMap } = await import("../app/lib/allergen-review-state");
  const displayed = { gluten: "contains", eggs: "contains", milk: "contains" } as Record<string, any>; // what the chef sees: 3 black squares, 11 white
  const rowFor = (allergens: Record<string, unknown>, evidenceStatus: string) => [{ id: "menu:1", sourceLineId: `line:${orderId}`, name: "Mini Pastries", note: "", subItems: [{ id: "sub:1", name: "Mini Pastries", quantity: 4, allergens, note: "", evidenceStatus }] }];

  // The white cells are NOT inferred as Clear by the server: an unconfirmed row cannot be planned.
  const unconfirmed = await post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: null, menuItems: rowFor(displayed, "completed") });
  assert.equal(unconfirmed.status, 422, "unrecorded white cells are never silently treated as Clear by the server");

  // Mark checked (client-side row confirmation), then Save allergen review.
  const confirmed = confirmAllergenReviewMap(displayed).states;
  const saved = await post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: null, menuItems: rowFor(confirmed, "completed") });
  const body = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(body).slice(0, 300));
  const stored = (await storedPlanOf(route.db, orderId))!;
  const states = stored.menuItems[0].subItems[0].allergens as Record<string, string>;
  for (const key of ["gluten", "eggs", "milk"]) assert.equal(states[key], "contains", key);
  for (const key of NAMED.filter((candidate) => !["gluten", "eggs", "milk"].includes(candidate))) assert.equal(states[key], "clear", key);
  assert.equal(states.no_key_allergens, "clear", "derived, never client-supplied");
  assert.equal(stored.status, "planned");
  assert.equal(stored.menuItems[0].subItems[0].evidenceStatus, "completed");
});

// ---------------------------------------------------------------------------------------------------------------------------
// Sole-reviewer flow: Save, then sign WITHOUT refreshing. The Hub lifecycle sync bumps the order version (part of the signing
// lineage), so the lineage handed back by Save must be the POST-sync one, and a Save must not re-read the Hub order over and over.
// ---------------------------------------------------------------------------------------------------------------------------
function installHospitalityHub(orderId: string, serviceDate: string) {
  const hub = { status: "accepted", version: 3, transitions: [] as string[], orderReads: 0 };
  const current = () => ({ ...orderFor(orderId, serviceDate), origin: "hospitality_booking", sourceBookingId: "booking:rcoa:lineage-test", sourceQuoteRevisionId: "quote-revision:lineage-test:v1", currentRevision: 1, requiresDelivery: true, status: hub.status, version: hub.version });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/api/production")) {
      const body = JSON.parse(String(init.body)) as { status: string };
      hub.transitions.push(body.status); hub.status = body.status; hub.version += 1;
      return new Response(JSON.stringify({ order: current() }), { status: 200 });
    }
    if (url.includes("/api/production?canonicalId=")) { hub.orderReads += 1; return new Response(JSON.stringify({ order: current() }), { status: 200 }); }
    if (url.includes("/api/production?serviceDate=") || url.includes("/api/production?weekCommencing=")) return new Response(JSON.stringify({ orders: [current()] }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url}`);
  }) as typeof fetch;
  return { hub, current };
}
const PNG = `data:image/png;base64,${"A".repeat(120)}`;

test("Save then sign without refreshing: the lineage returned by Save already includes the Hub sync, so the first signature is accepted", { timeout: 120_000 }, async () => {
  const orderId = "production-order:lineage-first-sign";
  const { hub } = installHospitalityHub(orderId, "2026-12-09");
  const route = await importRouteWithTransactionGate();
  route.open();
  const first = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("z", orderId) });
  const revision = (await first.json()).revision as string;
  const saved = await post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: revision, menuItems: completeItems("z", orderId) });
  const savedBody = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(savedBody).slice(0, 300));
  assert.deepEqual(hub.transitions, ["planning", "planned"], "the sync bumped the Hub order version");
  assert.ok(savedBody.signingLineage, "Save returns a signing lineage");

  // The browser signs straight away with the lineage Save returned: no reload.
  const signed = await post(route.POST, { action: "sign-matrix", orderId, role: "production_chef", printedName: "Derek Buckley", attestation: "I have checked the allergen matrix.", signatureDataUrl: PNG, expectedLineage: savedBody.signingLineage });
  const signedBody = await signed.json();
  assert.equal(signed.status, 200, `first signature must not 409: ${JSON.stringify(signedBody).slice(0, 300)}`);
  assert.equal(signedBody.signatures.length, 1);
});

test("a genuinely stale lineage is still refused at signing (concurrent source change protection is intact)", { timeout: 120_000 }, async () => {
  const orderId = "production-order:lineage-stale-protected";
  const { hub } = installHospitalityHub(orderId, "2026-12-10");
  const route = await importRouteWithTransactionGate();
  route.open();
  const first = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("z", orderId) });
  const revision = (await first.json()).revision as string;
  const saved = await (await post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: revision, menuItems: completeItems("z", orderId) })).json();
  hub.version += 1; // someone amends the source order after the reviewer loaded the lineage
  const signed = await post(route.POST, { action: "sign-matrix", orderId, role: "production_chef", printedName: "Derek Buckley", attestation: "I have checked the allergen matrix.", signatureDataUrl: PNG, expectedLineage: saved.signingLineage });
  assert.equal(signed.status, 409);
  assert.equal((await signed.json()).error.code, "CPU_SIGN_LINEAGE_CONFLICT");
});

test("a Save no longer re-reads the Hub order over and over (8 reads before memoisation, 5 now)", { timeout: 120_000 }, async () => {
  const orderId = "production-order:latency-order-reads";
  const { hub } = installHospitalityHub(orderId, "2026-12-11");
  const route = await importRouteWithTransactionGate();
  route.open();
  const first = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("z", orderId) });
  const revision = (await first.json()).revision as string;
  hub.orderReads = 0;
  const saved = await post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: revision, menuItems: completeItems("z", orderId) });
  assert.equal(saved.status, 200);
  // Order GETs for the whole mark-planned request: initial read, the lifecycle pre-check/verification reads, and one fresh post-sync read.
  assert.ok(hub.orderReads <= 5, `expected at most 5 Hub order reads for a Save, saw ${hub.orderReads}`);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Edit locally -> Save once -> Sign -> Sign -> the PDF is generated in the background. Also prints request-count/latency metrics.
// ---------------------------------------------------------------------------------------------------------------------------
function installMeteredHospitalityHub(orderId: string, serviceDate: string, options: { hubLatencyMs?: number; materialization?: "fail" | "ok" } = {}) {
  const hub = { status: "accepted", version: 3, transitions: [] as string[], orderReads: 0, hubCalls: 0, materializationCalls: 0 };
  const current = () => ({ ...orderFor(orderId, serviceDate), origin: "hospitality_booking", sourceBookingId: "booking:rcoa:bg-test", sourceQuoteRevisionId: "quote-revision:bg-test:v1", currentRevision: 1, requiresDelivery: true, status: hub.status, version: hub.version });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/internal/cpu-release-materialize")) {
      hub.materializationCalls += 1;
      return options.materialization === "ok" ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : new Response(JSON.stringify({ error: { message: "Drive unavailable" } }), { status: 503 });
    }
    hub.hubCalls += 1;
    if (options.hubLatencyMs) await new Promise((resolve) => setTimeout(resolve, options.hubLatencyMs));
    if (init?.method === "POST" && url.endsWith("/api/production")) {
      const body = JSON.parse(String(init.body)) as { status: string };
      hub.transitions.push(body.status); hub.status = body.status; hub.version += 1;
      return new Response(JSON.stringify({ order: current() }), { status: 200 });
    }
    if (url.includes("/api/production?canonicalId=")) { hub.orderReads += 1; return new Response(JSON.stringify({ order: current() }), { status: 200 }); }
    if (url.includes("/api/production?serviceDate=") || url.includes("/api/production?weekCommencing=")) return new Response(JSON.stringify({ orders: [current()] }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url}`);
  }) as typeof fetch;
  return hub;
}
const timed = async <T,>(work: () => Promise<T>) => { const started = performance.now(); const value = await work(); return { value, ms: Math.round(performance.now() - started) }; };
const signBody = (orderId: string, role: string, lineage: unknown) => ({ action: "sign-matrix", orderId, role, printedName: role === "production_chef" ? "Derek Buckley" : "Sam Busby", attestation: "I have checked the allergen matrix.", signatureDataUrl: PNG, expectedLineage: lineage });

test("sole reviewer: Save once, sign, sign - no refresh, no 409, and a failing PDF job never blocks or undoes the signatures", { timeout: 180_000 }, async () => {
  const orderId = "production-order:bg-save-sign-sign";
  const hub = installMeteredHospitalityHub(orderId, "2026-12-12", { hubLatencyMs: 120, materialization: "fail" });
  const route = await importRouteWithTransactionGate();
  route.open();
  // Edit locally (nothing is sent), then ONE explicit Save: the first request is the initial draft creation, the second is the Save allergen review.
  const created = await timed(() => post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("bg", orderId) }));
  const createdBody = await created.value.json();
  const hubBefore = { calls: hub.hubCalls, reads: hub.orderReads };
  const saved = await timed(() => post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: createdBody.revision, menuItems: completeItems("bg", orderId) }));
  const savedBody = await saved.value.json();
  assert.equal(saved.value.status, 200, JSON.stringify(savedBody).slice(0, 300));
  const saveHubCalls = hub.hubCalls - hubBefore.calls;

  const first = await timed(() => post(route.POST, signBody(orderId, "production_chef", savedBody.signingLineage)));
  const firstBody = await first.value.json();
  assert.equal(first.value.status, 200, `first signature must succeed without a refresh: ${JSON.stringify(firstBody).slice(0, 300)}`);
  const second = await timed(() => post(route.POST, signBody(orderId, "head_chef_site_manager", firstBody.signingLineage ?? savedBody.signingLineage)));
  const secondBody = await second.value.json();
  assert.equal(second.value.status, 200, `second signature must succeed: ${JSON.stringify(secondBody).slice(0, 300)}`);
  assert.equal(secondBody.plan.signatures.length, 2, "both signatures persisted");
  assert.notEqual(secondBody.matrixStatus, "ready", "the PDF is not claimed ready");
  assert.ok(["generating", "failed", "not_configured"].includes(secondBody.matrixStatus), secondBody.matrixStatus);
  // The materialisation obligation is durable (outbox) and was attempted exactly once by the background step; the failure did not undo the signatures.
  assert.equal(hub.materializationCalls, 1);
  const stored = (await storedPlanOf(route.db, orderId))!;
  assert.equal(stored.signatures.length, 2);
  assert.ok(stored.currentAllergenRelease, "a release bound to the signed matrix exists");
  assert.notEqual(stored.currentAllergenRelease.materializationStatus, "ready");
  const outbox = await route.db.collection("fikaCpuPropagationOutboxV1").get();
  const materialisation = outbox.docs.map((doc) => doc.data()).filter((event) => String(event.payload?.route || "").includes("cpu-release-materialize"));
  assert.equal(materialisation.length, 1, "one durable materialisation event, no duplicates");
  assert.ok(["failed", "pending"].includes(materialisation[0].delivery.status), "retryable, not lost");
  console.log(`METRIC save-allergen-review ms=${saved.ms} hubCalls=${saveHubCalls} | first-signature ms=${first.ms} | second-signature ms=${second.ms} (hub latency simulated at 120 ms/call; PDF/Drive step stubbed)`);
});

test("root cause reproduced: signing with the lineage loaded BEFORE Save (what the old editor kept) is refused, the lineage Save returns is accepted", { timeout: 120_000 }, async () => {
  const orderId = "production-order:bg-root-cause";
  installMeteredHospitalityHub(orderId, "2026-12-13", { materialization: "fail" });
  const route = await importRouteWithTransactionGate();
  route.open();
  const created = await (await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: completeItems("rc", orderId) })).json();
  // The editor's initial load (GET) hands it a lineage; the old editor kept it through Save.
  const loaded = await (await route.GET(new NextRequest(`http://localhost/api/production-plan?orderId=${encodeURIComponent(orderId)}`))).json();
  const saved = await (await post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: created.revision, menuItems: completeItems("rc", orderId) })).json();
  assert.notDeepEqual(saved.signingLineage, loaded.signingLineage, "Save (Hub sync) changed the lineage");
  const stale = await post(route.POST, signBody(orderId, "production_chef", loaded.signingLineage));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "CPU_SIGN_LINEAGE_CONFLICT");
  const fresh = await post(route.POST, signBody(orderId, "production_chef", saved.signingLineage));
  assert.equal(fresh.status, 200);
});


// Real packing route + isolated Firestore persistence; no plan/signature/feed writers.
async function packingFixture(name: string) {
  const { GET, POST } = await import("../app/api/packing/route");
  const { db } = await import("../lib/firebase-admin");
  const { PACKING_COLLECTION, packingHash } = await import("../lib/packing-checklist");
  let order = { ...orderFor(`packing:${name}`), lines: [{ ...orderFor(`packing:${name}`).lines[0], customerUnit: "portions", description: "Original recipe" }] };
  let allow = true;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input).includes("/api/cpu-production/access")) return Response.json(allow ? { principal: { id: new Headers(init?.headers).get("cookie") === "session=second" ? "authid:second" : "authid:first" } } : { error: { message: "CPU access denied" } }, { status: allow ? 200 : 403 });
    if (String(input).includes("/api/production?canonicalId=")) return Response.json({ order });
    throw Error("Unexpected packing upstream: " + input);
  }) as typeof fetch;
  const get = () => GET(new NextRequest(`http://localhost/api/packing?orderId=${encodeURIComponent(order.canonicalId)}`, { headers: { cookie: "session=first" } }));
  const post = (body: unknown, actor = "first", origin = "http://localhost") => POST(new NextRequest("http://localhost/api/packing", { method: "POST", headers: { cookie: `session=${actor}`, origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const initial = await (await get()).json();
  const command = (overrides = {}) => ({ orderId: order.canonicalId, orderVersion: order.version, lineId: order.lines[0].canonicalId, fingerprint: initial.lines[0].fingerprint, packed: true, expectedRevision: initial.revision, commandId: crypto.randomUUID(), ...overrides });
  const ref = db.collection(PACKING_COLLECTION).doc(packingHash(order.canonicalId));
  const current = () => order;
  return { db, get, post, command, ref, current, amend: () => { order = { ...order, version: order.version + 1, lines: order.lines.map(line => ({ ...line, customerQuantity: 9 })) }; }, deny: () => { allow = false; } };
}

test("packing route persists across devices, permits unticking and audits once per change", async () => {
  const f = await packingFixture("sessions");
  const before = await snapshotEvidence(f.db, f.current().canonicalId);
  const c = f.command();
  assert.equal((await f.post(c)).status, 200);
  assert.equal((await f.post(c)).status, 200);
  assert.equal((await (await f.get()).json()).packedCount, 1);
  assert.equal((await f.ref.collection("commands").get()).size, 1);
  assert.equal((await f.post(f.command({ expectedRevision: 1, packed: false }), "second")).status, 200);
  assert.equal((await (await f.get()).json()).packedCount, 0);
  const events = (await f.ref.collection("commands").get()).docs.map(doc => doc.data());
  assert.equal(events.length, 2);
  assert.deepEqual(new Set(events.map(event => event.actorId)), new Set(["authid:first", "authid:second"]));
  assert.deepEqual(await snapshotEvidence(f.db, f.current().canonicalId), before);
});

test("packing concurrent route writes reject stale revisions without silent overwrite", async () => {
  const f = await packingFixture("concurrent");
  const replies = await Promise.all([f.post(f.command()), f.post(f.command(), "second")]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
  assert.equal((await f.ref.get()).data()?.revision, 1);
  assert.equal((await f.ref.collection("commands").get()).size, 1);
});

test("packing amendments invalidate ticks, reject stale writes and retain audit evidence", async () => {
  const f = await packingFixture("amendment"); const old = f.command();
  assert.equal((await f.post(old)).status, 200); f.amend();
  const current = await (await f.get()).json();
  assert.equal(current.packedCount, 0); assert.equal(current.lines[0].changed, true);
  assert.equal((await f.post(old)).status, 409);
  assert.equal((await f.post(f.command({ orderVersion: 2, expectedRevision: 1 }))).status, 409);
  assert.equal((await f.post(f.command({ orderVersion: 2, expectedRevision: 1, fingerprint: current.lines[0].fingerprint }))).status, 200);
  assert.equal((await f.ref.collection("commands").get()).size, 2);
});

test("packing rejects denied access, cross-origin and reused command identities before writes", async () => {
  const f = await packingFixture("access"); const c = f.command();
  assert.equal((await f.post(c, "first", "https://untrusted.example")).status, 403);
  f.deny(); assert.equal((await f.post(c)).status, 403); assert.equal((await f.get()).status, 403);
  assert.equal((await f.ref.get()).exists, false);
  const second = await packingFixture("identity"); const valid = second.command();
  assert.equal((await second.post(valid)).status, 200);
  assert.equal((await second.post({ ...valid, packed: false })).status, 409);
  assert.equal((await second.post(valid, "second")).status, 409);
  assert.equal((await second.ref.collection("commands").get()).size, 1);
});


test("packing failed Firestore write leaves no success state and same command can retry safely", async () => {
  const f = await packingFixture("failed-write");
  const original = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = (async () => { throw Error("Injected unavailable store"); }) as typeof f.db.runTransaction;
  const c = f.command();
  try {
    assert.equal((await f.post(c)).status, 503);
    assert.equal((await f.ref.get()).exists, false);
    assert.equal((await f.ref.collection("commands").get()).size, 0);
  } finally { f.db.runTransaction = original; }
  assert.equal((await f.post(c)).status, 200);
  const noop = f.command({ expectedRevision: 1 });
  assert.equal((await f.post(noop)).status, 200);
  assert.equal((await f.ref.get()).data()?.revision, 1);
  assert.equal((await f.ref.collection("commands").get()).size, 1);
});


test("packing actual POST route accepts configured App Hosting public origin and retains CPU authorisation", async () => {
  const f = await packingFixture("proxy-route");
  const { POST } = await import("../app/api/packing/route");
  const keys = ["FIKA_RUNTIME_MODE", "CPU_PUBLIC_BASE_URL", "FIKA_HUB_BASE_URL"];
  const prior = keys.map(key=>process.env[key]);
  try {
    process.env.FIKA_RUNTIME_MODE="staging";
    process.env.CPU_PUBLIC_BASE_URL="https://cpu-staging.fikacatering.com";
    process.env.FIKA_HUB_BASE_URL="https://staging-os.fikacatering.com";
    const request = (origin:string) => new NextRequest("http://localhost:8080/api/packing", {method:"POST",headers:{origin,"x-forwarded-host":"cpu-staging.fikacatering.com","x-forwarded-proto":"https",cookie:"session=first","content-type":"application/json"},body:JSON.stringify(f.command())});
    assert.equal((await POST(request("https://attacker.example"))).status,403);
    assert.equal((await f.ref.get()).exists,false);
    assert.equal((await POST(request("https://cpu-staging.fikacatering.com"))).status,200);
    f.deny();
    assert.equal((await POST(request("https://cpu-staging.fikacatering.com"))).status,403);
    assert.equal((await f.ref.collection("commands").get()).size,1);
  } finally { keys.forEach((key,i)=>{if(prior[i]===undefined)delete process.env[key];else process.env[key]=prior[i];}); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Row confirmation evidence through the real route: the server stamps reviewer/time, a metadata-only re-save never disturbs a
// signed release, and a material edit after signing revokes the release while retaining the historical record.
// ---------------------------------------------------------------------------------------------------------------------------
test("allergen row confirmation: stamped by the server, survives re-save, and a material edit after signing revokes the release but keeps history", { timeout: 180_000 }, async () => {
  const orderId = "production-order:confirm-sign-edit-revoke";
  installMeteredHospitalityHub(orderId, "2026-12-14", { hubLatencyMs: 0, materialization: "fail" });
  const route = await importRouteWithTransactionGate();
  route.open();
  const rowFor = (allergens: Record<string, unknown>, evidenceStatus: string) => [{ id: "menu:1", sourceLineId: `line:${orderId}`, name: "Concurrency dish", note: "", subItems: [{ id: "sub:1", name: "Concurrency dish", quantity: 4, allergens, note: "", evidenceStatus }] }];
  const { confirmAllergenReviewMap } = await import("../app/lib/allergen-review-state");
  const confirmed = confirmAllergenReviewMap({ milk: "contains" }).states;

  const created = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: rowFor({ milk: "contains" }, "not_completed") });
  const createdBody = await created.json();
  assert.equal(created.status, 200, JSON.stringify(createdBody).slice(0, 300));
  assert.equal((await storedPlanOf(route.db, orderId))!.menuItems[0].subItems[0].allergenReview, undefined, "an unchecked row carries no confirmation");

  // A forged client record is ignored; the server stamps its own reviewer and time.
  const forged = { status: "confirmed", semantics: 2, confirmedBy: "Forged Chef", confirmedAt: "2020-01-01T00:00:00.000Z", statement: "recipe-ingredients-allergens-verified", inputFingerprint: "x" };
  const items = rowFor(confirmed, "completed"); (items[0].subItems[0] as Record<string, unknown>).allergenReview = forged;
  const planned = await post(route.POST, { action: "mark-planned", orderId, planningNotes: "", expectedRevision: createdBody.revision, menuItems: items });
  const plannedBody = await planned.json();
  assert.equal(planned.status, 200, JSON.stringify(plannedBody).slice(0, 300));
  const stamped = (await storedPlanOf(route.db, orderId))!.menuItems[0].subItems[0].allergenReview;
  assert.ok(stamped, "the server stamped the confirmed row");
  assert.notEqual(stamped.confirmedBy, "Forged Chef");
  assert.notEqual(stamped.confirmedAt, forged.confirmedAt);

  const first = await post(route.POST, signBody(orderId, "production_chef", plannedBody.signingLineage));
  const firstBody = await first.json();
  assert.equal(first.status, 200, JSON.stringify(firstBody).slice(0, 300));
  const second = await post(route.POST, signBody(orderId, "head_chef_site_manager", firstBody.signingLineage ?? plannedBody.signingLineage));
  const secondBody = await second.json();
  assert.equal(second.status, 200, JSON.stringify(secondBody).slice(0, 300));
  const signed = (await storedPlanOf(route.db, orderId))!;
  assert.equal(signed.signatures.length, 2);
  assert.ok(signed.currentAllergenRelease, "a release is bound to the signed matrix");
  assert.deepEqual(signed.menuItems[0].subItems[0].allergenReview, stamped, "signing did not restamp the confirmed row");
  const signedHash = signed.signedMenuContentHash;

  // A material edit after signing: positives change and the row is no longer confirmed -> authority is revoked, history retained.
  const edited = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: signed.updatedAt, menuItems: rowFor({ milk: "contains", eggs: "contains" }, "not_completed") });
  const editedBody = await edited.json();
  assert.equal(edited.status, 200, JSON.stringify(editedBody).slice(0, 300));
  const after = (await storedPlanOf(route.db, orderId))!;
  assert.equal(after.signatures, undefined, "signatures are withdrawn");
  assert.equal(after.currentAllergenRelease, undefined, "no current release remains");
  assert.equal(after.signedMenuContentHash, undefined);
  const history = after.allergenReleaseHistory as Array<Record<string, any>>;
  assert.ok(history.some(release => release.releaseId === signed.currentAllergenRelease.releaseId), "the withdrawn release is retained as historical evidence");
  assert.notEqual(history.find(release => release.releaseId === signed.currentAllergenRelease.releaseId)!.status, "current", "a withdrawn release is never current");
  assert.equal(history.find(release => release.releaseId === signed.currentAllergenRelease.releaseId)!.signatures.length, 2, "the historical record keeps its signatures");
  assert.ok((after.audit as Array<{ action: string }>).some(entry => entry.action === "allergen-release-revoked"));
  const row = after.menuItems[0].subItems[0];
  assert.equal(row.evidenceStatus, "not_completed");
  assert.equal(row.allergenReview, undefined, "the edited row needs a fresh confirmation");
  assert.equal(row.allergens.sesame, undefined, "no derived Clear survives on the reopened row");
});

test("UAT-HAIKU4 regression: a confirmed row whose sub-item is unnamed (the CPU default) is stamped, and the GET the browser uses returns the stamp", { timeout: 120_000 }, async () => {
  const orderId = "production-order:repro-stamp-get";
  installHub(orderId, "2026-12-15");
  const route = await importRouteWithTransactionGate();
  route.open();
  const { confirmAllergenReviewMap } = await import("../app/lib/allergen-review-state");
  const confirmed = confirmAllergenReviewMap({ milk: "contains", gluten: "contains" }).states;
  const rows = [
    { id: "menu:1", sourceLineId: `line:${orderId}`, name: "Cheese sandwich platter", note: "", subItems: [{ id: "sub:1", name: "", quantity: 4, allergens: confirmed, note: "", evidenceStatus: "completed" }] },
    { id: "menu:2", sourceLineId: `line:${orderId}:2`, name: "Fruit pot", note: "", subItems: [{ id: "sub:2", name: "", quantity: 4, allergens: {}, note: "", evidenceStatus: "not_completed" }] },
  ];
  const saved = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: rows });
  const savedBody = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(savedBody).slice(0, 300));
  const stamp = savedBody.plan.menuItems[0].subItems[0].allergenReview;
  assert.ok(stamp, "POST response carries the stamp for an unnamed sub-item");
  assert.equal(savedBody.plan.menuItems[1].subItems[0].allergenReview, undefined, "an unchecked row carries none");
  assert.ok((await storedPlanOf(route.db, orderId))!.menuItems[0].subItems[0].allergenReview, "stored plan carries the stamp");
  const got = await route.GET(new NextRequest(`http://localhost/api/production-plan?orderId=${encodeURIComponent(orderId)}`));
  const gotBody = await got.json();
  const sub = (gotBody.plan?.menuItems ?? gotBody.menuItems)?.[0]?.subItems?.[0];
  assert.deepEqual(sub?.allergenReview, stamp, "GET returns the same stamp");
});

test("UAT-HAIKU4 regression: renaming the source order line reopens the reviewed row and a signed release cannot survive it", { timeout: 120_000 }, async () => {
  const orderId = "production-order:source-rename-reopen";
  let lineName = "Cheese sandwich platter"; let version = 1;
  const order = () => ({ ...orderFor(orderId, "2026-12-16"), version, lines: [{ canonicalId: `line:${orderId}`, itemName: lineName, customerQuantity: 4 }] });
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order: order() }), { status: 200 });
    if (url.includes("/api/production?serviceDate=") || url.includes("/api/production?weekCommencing=")) return new Response(JSON.stringify({ orders: [order()] }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url}`);
  }) as typeof fetch;
  const route = await importRouteWithTransactionGate();
  route.open();
  const { confirmAllergenReviewMap } = await import("../app/lib/allergen-review-state");
  const confirmed = confirmAllergenReviewMap({ milk: "contains" }).states;
  const rows = () => [{ id: "menu:1", sourceLineId: `line:${orderId}`, name: lineName, note: "", subItems: [{ id: "sub:1", name: "", quantity: 4, allergens: confirmed, note: "", evidenceStatus: "completed" }] }];
  const first = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: null, menuItems: rows() });
  const firstBody = await first.json();
  assert.equal(first.status, 200, JSON.stringify(firstBody).slice(0, 300));
  assert.ok(firstBody.plan.menuItems[0].subItems[0].allergenReview, "confirmed and stamped");
  assert.equal((await storedPlanOf(route.db, orderId))!.menuItems[0].sourceItemName, "Cheese sandwich platter", "server-owned baseline recorded");

  // Quantity-only change at the source: still confirmed.
  version = 2;
  const same = await route.GET(new NextRequest(`http://localhost/api/production-plan?orderId=${encodeURIComponent(orderId)}`));
  assert.ok((await same.json()).plan.menuItems[0].subItems[0].allergenReview, "an unrenamed source change keeps the confirmation");

  // The source dish is renamed (Ad-Hoc amendment): the row must be reopened on read AND on the next save.
  lineName = "Cheese and ham sandwich platter"; version = 3;
  const read = await route.GET(new NextRequest(`http://localhost/api/production-plan?orderId=${encodeURIComponent(orderId)}`));
  const readItem = (await read.json()).plan.menuItems[0];
  assert.equal(readItem.name, "Cheese and ham sandwich platter");
  assert.equal(readItem.subItems[0].evidenceStatus, "not_completed");
  assert.equal(readItem.subItems[0].allergenReview, undefined);
  assert.deepEqual(readItem.subItems[0].allergens, {}, "no allergen state is carried onto a different dish");

  // A stale browser still holding the old, confirmed row cannot re-confirm it by saving.
  const stale = await post(route.POST, { action: "save-plan", orderId, planningNotes: "", expectedRevision: firstBody.revision, menuItems: rows().map(item => ({ ...item, name: "Cheese sandwich platter" })) });
  const staleBody = await stale.json();
  assert.equal(stale.status, 200, JSON.stringify(staleBody).slice(0, 300));
  const after = (await storedPlanOf(route.db, orderId))!;
  assert.equal(after.menuItems[0].name, "Cheese and ham sandwich platter");
  assert.equal(after.menuItems[0].subItems[0].evidenceStatus, "not_completed");
  assert.equal(after.menuItems[0].subItems[0].allergenReview, undefined);
});
