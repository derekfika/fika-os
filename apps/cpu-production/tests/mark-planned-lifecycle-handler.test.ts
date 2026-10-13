import assert from "node:assert/strict";
import test from "node:test";

/**
 * Drives the REAL `POST /api/production-plan` handler for `save-plan` / `mark-planned` against a Hub stub that enforces the REAL
 * Hub transition contract. `planning` / `planned` are CPU-local planning states (CPU derives them from its own plan and overlays
 * them as `workflowStatus`); Hub's `/api/production` transition API does not accept them, so CPU must never request them.
 *
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/cpu-production && HANDLER_REPO=memory npx tsx --test tests/mark-planned-lifecycle-handler.test.ts"
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
process.env.FIKA_CPU_PLAN_STORE = "memory";
process.env.FIKA_SNAPSHOT_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "cpu-mark-planned-"));
process.env.CPU_PUBLIC_BASE_URL = "http://cpu.test";
process.env.FIKA_INTERNAL_API_TOKEN = "handler-test-token";
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };

const { NextRequest } = await import("next/server");
const { CANONICAL_ALLERGEN_KEYS } = await import("../../shared/allergen-contract");
const { cpuAttentionLabel, cpuLifecycle } = await import("../lib/production-presentation");
const route = emulatorUp ? await import("../app/api/production-plan/route") : undefined;

const run = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let counter = 0;
const unique = () => `${run}-${++counter}`;
let weekOffset = 0;
const nextServiceDate = () => new Date(Date.UTC(2027, 5, 7 + 7 * (++weekOffset))).toISOString().slice(0, 10);

type Order = Record<string, unknown> & { canonicalId: string; status: string; version: number; lines: Array<Record<string, unknown>> };
const makeOrder = (status: string, version: number): Order => {
  const id = `production-order:v1:booking:mnk:${unique()}`;
  const serviceDate = nextServiceDate();
  return {
    canonicalId: id, entityType: "Production Order", schemaVersion: "1", origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version, status,
    serviceDate, requiredBy: `${serviceDate}T11:00:00.000Z`, clientName: "UAT Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site", exceptions: [], requirementIds: [], priority: "normal", serviceWindow: { startTime: "11:00", endTime: "12:00" },
    lines: [{ canonicalId: `${id}:line:1`, sourceBookingLineId: `${id}:bl1`, sourceMenuItemId: "hospitality-menu-item:mnk:deli_sandwich_lunch", sourceOfferingId: "hospitality-menu-item:mnk:deli_sandwich_lunch", choices: [], workstream: "sandwiches", customerQuantity: 8, customerUnit: "Per person", productionQuantity: 24, productionUnit: "piece", itemName: "Deli Style Sandwich Lunch", description: "d", dietaries: {}, status: "ready", sortOrder: 0 }],
  } as Order;
};

/** The REAL Hub contract: the transition body's status enum (apps/integration-hub/app/api/production/route.ts) and the domain's allowed map. */
const HUB_TRANSITION_ENUM = ["draft", "needs_review", "accepted", "scheduled", "in_production", "partially_complete", "complete", "cancelled", "blocked", "failed", "reconciliation_required"];
const HUB_ALLOWED: Record<string, string[]> = { received: ["accepted", "rejected", "needs_clarification", "cancelled"], draft: ["needs_review", "cancelled"], needs_review: ["accepted", "rejected", "needs_clarification", "blocked", "cancelled"], accepted: ["planning", "scheduled", "in_production", "cancelled", "blocked"] };

class Hub {
  orders = new Map<string, Order>();
  requested: string[] = [];
  rejected: string[] = [];
  unhandled: string[] = [];
  install() {
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as { url?: string }).url || String(input));
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.pathname === "/api/production") {
        if ((init?.method || "GET") === "GET") {
          const id = url.searchParams.get("canonicalId");
          if (id) { const order = this.orders.get(id); return order ? json({ order: structuredClone(order) }) : json({ error: { message: "not found" } }, 404); }
          return json({ orders: [...this.orders.values()].map(order => structuredClone(order)) });
        }
        const body = JSON.parse(String(init?.body || "{}")) as { canonicalId?: string; status?: string };
        this.requested.push(String(body.status));
        const order = body.canonicalId ? this.orders.get(body.canonicalId) : undefined;
        if (!body.status || !HUB_TRANSITION_ENUM.includes(body.status)) { this.rejected.push(String(body.status)); return json({ error: { code: "INVALID_REQUEST", message: "Some booking information was incomplete. Refresh the page and try again." } }, 400); }
        if (!order || !(HUB_ALLOWED[order.status] || []).includes(body.status)) { this.rejected.push(String(body.status)); return json({ error: { code: "INVALID_TRANSITION", message: "That status change is not allowed." } }, 409); }
        order.status = body.status; order.version += 1;
        return json({ order: structuredClone(order) });
      }
      if (url.pathname.includes("/api/internal/")) return json({ ok: true, status: "materialized" });
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
const post = async (body: Record<string, unknown>) => {
  const response = await route!.POST(new NextRequest("http://localhost:3400/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() as { plan?: { status?: string; signatures?: unknown[]; audit?: Array<{ action: string }> }; error?: { code?: string; message?: string } } };
};
const markPlanned = (order: Order, commandId = `mp-${unique()}-cmd`) => post({ action: "mark-planned", orderId: order.canonicalId, menuItems: complete(order), planningNotes: "", commandId });
const hubOrder = (order: Order) => hub.orders.get(order.canonicalId)!;
const reset = (order: Order) => { hub.orders.clear(); hub.requested = []; hub.rejected = []; hub.unhandled = []; hub.orders.set(order.canonicalId, order); };

test("contract guard: the Hub stub rejects planning/planned exactly as the real transition API does", () => {
  assert.ok(!HUB_TRANSITION_ENUM.includes("planning"));
  assert.ok(!HUB_TRANSITION_ENUM.includes("planned"));
});

test("an order at the valid Hub state `accepted` can have its CPU plan marked planned: success, no Hub write, order stays accepted", opts, async () => {
  hub.install();
  try {
    const order = makeOrder("accepted", 1); reset(order);
    const result = await markPlanned(order);
    assert.deepEqual(hub.unhandled, []);
    assert.equal(result.status, 200, JSON.stringify(result.body.error));
    assert.equal(result.body.plan?.status, "planned", "the CPU-local planned state is persisted");
    assert.deepEqual(hub.requested, [], "no Hub transition is attempted: planning/planned are CPU-local");
    assert.deepEqual(hub.rejected, []);
    assert.equal(hubOrder(order).status, "accepted", "the governed Hub state is unchanged");
    assert.equal(hubOrder(order).version, 1, "no version bump, so nothing makes the order look amended");
    assert.equal(cpuAttentionLabel(hubOrder(order) as never), "", "this path produces no Amended attention state");
    // CPU overlays its local state on the governed order
    assert.equal(cpuLifecycle({ ...(hubOrder(order) as object), workflowStatus: "planned" } as never), "planned");
  } finally { globalThis.fetch = realFetch; }
});

test("a freshly handed-off (draft) order is brought only to the governed `accepted` state, never to planning/planned", opts, async () => {
  hub.install();
  try {
    const order = makeOrder("draft", 1); reset(order);
    const result = await markPlanned(order);
    assert.equal(result.status, 200, JSON.stringify(result.body.error));
    assert.equal(result.body.plan?.status, "planned");
    assert.deepEqual(hub.requested, ["needs_review", "accepted"], "only the explicit governed steps a chef would use");
    assert.deepEqual(hub.rejected, []);
    assert.equal(hubOrder(order).status, "accepted");
    for (const forbidden of ["planning", "planned", "amended"]) assert.ok(!hub.requested.includes(forbidden), `never requests ${forbidden}`);
  } finally { globalThis.fetch = realFetch; }
});

test("repeating mark-planned is idempotent: success every time, no further Hub writes, no version drift", opts, async () => {
  hub.install();
  try {
    const order = makeOrder("draft", 1); reset(order);
    const first = await markPlanned(order, `mp-${unique()}-same`);
    const versionAfterFirst = hubOrder(order).version;
    const transitionsAfterFirst = [...hub.requested];
    const sameCommand = await markPlanned(order, `mp-${unique()}-other`);
    const again = await markPlanned(order);
    for (const result of [first, sameCommand, again]) { assert.equal(result.status, 200, JSON.stringify(result.body.error)); assert.equal(result.body.plan?.status, "planned"); }
    assert.deepEqual(hub.requested, transitionsAfterFirst, "no additional Hub transition on repeats");
    assert.equal(hubOrder(order).version, versionAfterFirst);
    assert.equal(hubOrder(order).status, "accepted");
    assert.equal((again.body.plan?.audit || []).filter(entry => entry.action === "plan-marked-planned").length >= 1, true);
  } finally { globalThis.fetch = realFetch; }
});

test("signing stays available straight after the successful save: planned, no signatures, no error to retry", opts, async () => {
  hub.install();
  try {
    const order = makeOrder("accepted", 1); reset(order);
    const saved = await markPlanned(order);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.error, undefined, "no false save failure, so autosave ends Saved");
    assert.equal(saved.body.plan?.status, "planned", "the gate's server-confirmed planned condition is met immediately");
    assert.equal((saved.body.plan?.signatures || []).length, 0, "nothing was signed or fabricated");
  } finally { globalThis.fetch = realFetch; }
});
