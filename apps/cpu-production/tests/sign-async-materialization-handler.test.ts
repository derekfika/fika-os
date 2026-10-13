import assert from "node:assert/strict";
import test from "node:test";

/**
 * Drives the REAL `POST /api/production-plan` handler for `save-plan`, `mark-planned` and `sign-matrix`, with a canonical-provider
 * stub (Hub) that counts order reads and a CPU self-delivery stub for `/api/internal/cpu-release-materialize` that can block or fail.
 *
 * Proves, per request: (1) the final signature returns after the durable commit WITHOUT waiting for materialization, which still
 * happens afterwards from the committed outbox obligation, exactly once, and survives a failed dispatch; (2) one request never reads
 * the same Hub order twice unless it must (a safety boundary or a Hub transition made by the request).
 *
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/cpu-production && npx tsx --test tests/sign-async-materialization-handler.test.ts"
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
process.env.FIKA_CPU_PLAN_STORE = "memory";
process.env.FIKA_SNAPSHOT_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "cpu-sign-async-"));
process.env.CPU_PUBLIC_BASE_URL = "http://cpu.test";
process.env.FIKA_INTERNAL_API_TOKEN = "handler-test-token";
// Drive is "configured" so the response reports a pending artifact as `generating` (the materialize endpoint itself is stubbed).
process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "{}";
process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "uat-owner@example.test";
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };

const { NextRequest } = await import("next/server");
const { CANONICAL_ALLERGEN_KEYS } = await import("../../shared/allergen-contract");
const { deliverCpuPropagation, listCpuOutboxForTests, resetCpuOutboxForTests } = await import("../lib/cpu-durable-outbox");
const route = emulatorUp ? await import("../app/api/production-plan/route") : undefined;

const run = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let counter = 0;
const unique = () => `${run}-${++counter}`;
let weekOffset = 0;
const nextServiceDate = () => new Date(Date.UTC(2027, 8, 6 + 7 * (++weekOffset))).toISOString().slice(0, 10);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type Order = Record<string, unknown> & { canonicalId: string; status: string; version: number; lines: Array<Record<string, unknown>> };
const makeOrder = (status: string): Order => {
  const id = `production-order:v1:booking:mnk:${unique()}`;
  const serviceDate = nextServiceDate();
  return {
    canonicalId: id, entityType: "Production Order", schemaVersion: "1", origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status,
    serviceDate, requiredBy: `${serviceDate}T11:00:00.000Z`, clientName: "UAT Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site", exceptions: [], requirementIds: [], priority: "normal", serviceWindow: { startTime: "11:00", endTime: "12:00" },
    lines: [{ canonicalId: `${id}:line:1`, sourceBookingLineId: `${id}:bl1`, sourceMenuItemId: "hospitality-menu-item:mnk:deli_sandwich_lunch", sourceOfferingId: "hospitality-menu-item:mnk:deli_sandwich_lunch", choices: [], workstream: "sandwiches", customerQuantity: 8, customerUnit: "Per person", productionQuantity: 24, productionUnit: "piece", itemName: "Deli Style Sandwich Lunch", description: "d", dietaries: {}, status: "ready", sortOrder: 0 }],
  } as Order;
};

const HUB_ALLOWED: Record<string, string[]> = { draft: ["needs_review", "cancelled"], needs_review: ["accepted", "cancelled"] };
class Hub {
  orders = new Map<string, Order>();
  orderReads = 0;
  transitions: string[] = [];
  /** Runs on the Nth order read of the current scenario (1-based) and may change the order, like a concurrent amendment. */
  onRead?: (count: number, order: Order) => void;
  // CPU self-delivery (materialization) controls
  materializeCalls = 0;
  materializeBehaviour: "ok" | "fail" | "block" = "ok";
  releaseBlocked?: () => void;
  blocked?: Promise<void>;
  unhandled: string[] = [];
  reset(order: Order) { this.orders.clear(); this.orders.set(order.canonicalId, order); this.orderReads = 0; this.transitions = []; this.onRead = undefined; this.materializeCalls = 0; this.materializeBehaviour = "ok"; this.blocked = undefined; this.releaseBlocked = undefined; this.unhandled = []; resetCpuOutboxForTests(); }
  install() {
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as { url?: string }).url || String(input));
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.pathname === "/api/production") {
        if ((init?.method || "GET") === "GET") {
          const id = url.searchParams.get("canonicalId");
          if (id) { const order = this.orders.get(id); if (!order) return json({ error: { message: "not found" } }, 404); this.orderReads += 1; if (process.env.DEBUG_READS) console.log(`READ#${this.orderReads}`, (new Error().stack || "").split(String.fromCharCode(10)).filter(l => /production-plan|production-http|allergen-reuse|cpu-/.test(l)).slice(0, 7).map(l => l.trim()).join(" <- ")); this.onRead?.(this.orderReads, order); return json({ order: structuredClone(order) }); }
          return json({ orders: [...this.orders.values()].map(order => structuredClone(order)) });
        }
        const body = JSON.parse(String(init?.body || "{}")) as { canonicalId?: string; status?: string };
        const order = body.canonicalId ? this.orders.get(body.canonicalId) : undefined;
        if (!order || !body.status || !(HUB_ALLOWED[order.status] || []).includes(body.status)) return json({ error: { code: "INVALID_TRANSITION", message: "not allowed" } }, 409);
        this.transitions.push(body.status); order.status = body.status; order.version += 1;
        return json({ order: structuredClone(order) });
      }
      if (url.pathname.includes("/api/internal/cpu-release-materialize")) {
        this.materializeCalls += 1;
        if (this.materializeBehaviour === "fail") return json({ error: { message: "renderer unavailable" } }, 503);
        if (this.materializeBehaviour === "block") await this.blocked;
        return json({ status: "materialized" });
      }
      if (url.pathname.includes("/api/internal/")) return json({ ok: true });
      this.unhandled.push(`${init?.method || "GET"} ${url.href}`);
      return json({ error: { message: `unhandled test URL ${url.href}` } }, 404);
    }) as typeof fetch;
  }
}
const realFetch = globalThis.fetch;
const hub = new Hub();

const complete = (order: Order) => order.lines.map((line, i) => ({
  id: `mi:${i}`, sourceLineId: line.canonicalId as string, name: "Deli Style Sandwich Lunch", note: "",
  subItems: [{ id: `s:${i}`, name: "UAT ham sandwich", quantity: 8, allergens: Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, key === "gluten" ? "contains" : "clear"])), note: "", evidenceStatus: "completed" }],
}));
type Body = { plan?: { status?: string; signatures?: unknown[]; currentAllergenRelease?: { status?: string; materializationStatus?: string }; matrixArtifact?: unknown }; signingLineage?: unknown; matrixStatus?: string; error?: { code?: string; message?: string } };
const post = async (body: Record<string, unknown>) => {
  const response = await route!.POST(new NextRequest("http://localhost:3400/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() as Body };
};
const markPlanned = (order: Order) => post({ action: "mark-planned", orderId: order.canonicalId, menuItems: complete(order), planningNotes: "", commandId: `mp-${unique()}-cmd` });
const sign = (order: Order, role: "production_chef" | "head_chef_site_manager", lineage: unknown, commandId = `sg-${unique()}-cmd`) => post({ action: "sign-matrix", orderId: order.canonicalId, role, printedName: role === "production_chef" ? "A Chef" : "B Head", attestation: "UAT test attestation for the handler test", signatureDataUrl: PNG, expectedLineage: lineage, commandId });
const settle = async (ms = 50) => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, ms)); };
/** A planned, complete, unsigned plan on a valid Hub `accepted` order, plus the lineage a chef would be signing. */
async function readyToSign() {
  const order = makeOrder("accepted"); hub.reset(order);
  const planned = await markPlanned(order);
  assert.equal(planned.status, 200, JSON.stringify(planned.body.error));
  assert.ok(planned.body.signingLineage, "the saved response carries the lineage to sign");
  return { order, lineage: planned.body.signingLineage };
}
const stage = (order: Order) => { hub.orderReads = 0; hub.transitions = []; return order; };

test("a first signature is unchanged: success, one signature, no release, no materialization, and exactly two Hub order reads", opts, async () => {
  hub.install();
  try {
    const { order, lineage } = await readyToSign(); stage(order);
    const first = await sign(order, "production_chef", lineage);
    assert.equal(first.status, 200, JSON.stringify(first.body.error));
    assert.equal(first.body.plan?.signatures?.length, 1);
    assert.equal(first.body.plan?.currentAllergenRelease, undefined, "one role does not create a release");
    assert.equal(hub.materializeCalls, 0);
    assert.equal(hub.orderReads, 2, "the order is read once for the request and once more at the stale-lineage safety boundary (was 4)");
    assert.deepEqual(hub.unhandled, []);
  } finally { globalThis.fetch = realFetch; }
});

test("the FINAL signature returns after the durable commit without waiting for materialization; materialization then runs once from the committed obligation", opts, async () => {
  hub.install();
  try {
    const { order, lineage } = await readyToSign();
    assert.equal((await sign(order, "production_chef", lineage)).status, 200);
    // materialization would hang forever: if the response waited for it, this request could never complete
    hub.materializeBehaviour = "block"; hub.blocked = new Promise<void>(resolve => { hub.releaseBlocked = resolve; });
    stage(order);
    const finalCommand = `sg-${unique()}-final`;
    const outcome = await Promise.race([sign(order, "head_chef_site_manager", lineage, finalCommand), new Promise<"waited">(resolve => setTimeout(() => resolve("waited"), 8000))]);
    assert.notEqual(outcome, "waited", "the signing response must not wait for PDF/Drive materialization");
    const final = outcome as Awaited<ReturnType<typeof sign>>;
    assert.equal(final.status, 200, JSON.stringify(final.body.error));
    assert.equal(final.body.plan?.signatures?.length, 2, "both genuine signatures are recorded");
    assert.equal(final.body.matrixStatus, "generating", "the response legitimately reports the artifact as generating");
    assert.equal(final.body.plan?.matrixArtifact, undefined, "no artifact yet");
    assert.equal(final.body.plan?.currentAllergenRelease?.status, "pending", "the release is committed; its artifact is not ready");
    assert.equal(hub.orderReads, 2);
    // the obligation was durably staged in the same commit as the signature
    const obligation = listCpuOutboxForTests().find(event => event.payload.route === "/api/internal/cpu-release-materialize");
    assert.ok(obligation, "a durable materialization obligation exists");
    // materialization still happens afterwards, once
    await settle();
    assert.equal(hub.materializeCalls, 1, "dispatch started after the response");
    hub.releaseBlocked?.(); await settle();
    assert.equal(hub.materializeCalls, 1);
    assert.equal(listCpuOutboxForTests().find(event => event.eventId === obligation!.eventId)?.delivery.status, "delivered");
    // an idempotent replay of the same final signature never dispatches materialization again
    const replay = await sign(order, "head_chef_site_manager", lineage, finalCommand);
    await settle();
    assert.equal(replay.status, 200, JSON.stringify(replay.body.error));
    assert.equal(hub.materializeCalls, 1, "replay does not duplicate materialization");
    assert.equal(listCpuOutboxForTests().filter(event => event.payload.route === "/api/internal/cpu-release-materialize").length, 1, "still exactly one obligation");
  } finally { globalThis.fetch = realFetch; }
});

test("a failed materialization dispatch never fails or delays the signature, and the obligation survives for the outbox drain", opts, async () => {
  hub.install();
  try {
    const { order, lineage } = await readyToSign();
    assert.equal((await sign(order, "production_chef", lineage)).status, 200);
    hub.materializeBehaviour = "fail";
    const final = await sign(order, "head_chef_site_manager", lineage);
    assert.equal(final.status, 200, "the signature is committed regardless of the downstream failure");
    assert.equal(final.body.plan?.signatures?.length, 2);
    await settle();
    assert.ok(hub.materializeCalls >= 1, "dispatch was attempted");
    const obligation = listCpuOutboxForTests().find(event => event.payload.route === "/api/internal/cpu-release-materialize")!;
    assert.ok(obligation, "the obligation is not lost");
    assert.notEqual(obligation.delivery.status, "delivered", "still outstanding");
    // the durable outbox drain delivers it once the renderer recovers
    hub.materializeBehaviour = "ok";
    const before = hub.materializeCalls;
    // when its retry time arrives, the outbox drain delivers the very same committed obligation (the drain passes the due time)
    const drained = await deliverCpuPropagation(obligation.eventId, new Date(Date.now() + 5 * 60 * 1000));
    assert.equal(drained.status, "delivered");
    assert.ok(hub.materializeCalls > before, "recovery re-delivers the committed obligation");
    assert.equal(listCpuOutboxForTests().find(event => event.eventId === obligation.eventId)?.delivery.status, "delivered");
  } finally { globalThis.fetch = realFetch; }
});

test("Hub order reads per request: an ordinary save reads the order twice (initial + the fresh pre-commit snapshot); sign twice (initial + safety boundary); repeated non-safety reads are cached", opts, async () => {
  hub.install();
  try {
    // save-plan on a valid accepted order: the request read plus ONE fresh pre-commit snapshot (the freshness boundary feeding the commit and the guarded response)
    const order = makeOrder("accepted"); hub.reset(order);
    const save = await post({ action: "save-plan", orderId: order.canonicalId, menuItems: complete(order).map(item => ({ ...item, subItems: item.subItems.map(sub => ({ ...sub, evidenceStatus: "not_completed" })) })), planningNotes: "", commandId: `sp-${unique()}-cmd` });
    assert.equal(save.status, 200, JSON.stringify(save.body.error));
    assert.equal(hub.orderReads, 2, "two canonical reads per ordinary save: initial + fresh pre-commit snapshot (5 before the performance patch; 1 in b61d7c8, which hid a stale-composition race)");
    // mark-planned on an already accepted order: initial + fresh pre-commit snapshot (the lifecycle sync reuses the initial read), no Hub write
    stage(order);
    const planned = await markPlanned(order);
    assert.equal(planned.status, 200);
    assert.equal(hub.orderReads, 2);
    assert.deepEqual(hub.transitions, []);
    // mark-planned on a draft order walks Hub, so the state read before the transitions is stale and the request reads again afterwards
    const draft = makeOrder("draft"); hub.reset(draft);
    const walked = await markPlanned(draft);
    assert.equal(walked.status, 200, JSON.stringify(walked.body.error));
    assert.deepEqual(hub.transitions, ["needs_review", "accepted"]);
    assert.equal(hub.orders.get(draft.canonicalId)!.status, "accepted");
    assert.equal(hub.orderReads, 2, "the initial read (shared with the lifecycle sync) + one fresh read after the Hub transitions (also the pre-commit snapshot); no redundant identical reads");
  } finally { globalThis.fetch = realFetch; }
});

test("stale-order protection is intact: a lineage change between the request's first read and the safety-boundary read still blocks signing", opts, async () => {
  hub.install();
  try {
    const { order, lineage } = await readyToSign(); stage(order);
    // the order is amended after this request first read it: the cached first read must NOT hide that from the safety check
    hub.onRead = (count, current) => { if (count === 2) { current.sourceQuoteRevisionId = `${current.sourceQuoteRevisionId}:amended`; current.currentRevision = 2; } };
    const attempt = await sign(order, "production_chef", lineage);
    assert.equal(attempt.status, 409, JSON.stringify(attempt.body));
    assert.equal(attempt.body.error?.code, "CPU_SIGN_LINEAGE_CONFLICT");
    assert.equal(hub.orderReads, 2, "the safety boundary performed its own fresh read");
    const stored = await post({ action: "save-plan", orderId: order.canonicalId, menuItems: complete(order), planningNotes: "", commandId: `sp-${unique()}-cmd` });
    assert.equal((stored.body.plan?.signatures || []).length, 0, "nothing was signed");
  } finally { globalThis.fetch = realFetch; }
});
