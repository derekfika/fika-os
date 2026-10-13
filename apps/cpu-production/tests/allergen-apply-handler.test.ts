import assert from "node:assert/strict";
import test from "node:test";

/**
 * Drives the REAL `POST /api/production-plan` handler for `apply-reused-authority`, with a fault-injected canonical provider
 * (global fetch stub standing in for the Integration Hub and the CPU self-delivery endpoint). It needs the Firestore emulator
 * (the handler rebuilds projections in Firestore) and is run once per plan repository:
 *
 *   HANDLER_REPO=memory    firebase emulators:exec ... "npx tsx --test tests/allergen-apply-handler.test.ts"
 *   HANDLER_REPO=firestore firebase emulators:exec ... "npx tsx --test tests/allergen-apply-handler.test.ts"
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const repoMode = process.env.HANDLER_REPO === "memory" ? "memory" : "firestore";
if (repoMode === "memory") process.env.FIKA_CPU_PLAN_STORE = "memory";
// Read-package files are written to disk by projection rebuilds; isolate them per run so runs never see each other's sequences.
process.env.FIKA_SNAPSHOT_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "cpu-apply-handler-"));
process.env.CPU_PUBLIC_BASE_URL = "http://cpu.test";
process.env.FIKA_INTERNAL_API_TOKEN = "handler-test-token";
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };

const { NextRequest } = await import("next/server");
const { createProductionPlanRepository, createFirestoreProductionPlanRepository } = await import("../lib/production-plan-repository");
const { createAllergenAuthorityStore } = await import("../lib/allergen-authority-store");
const { recordSignedApproval } = await import("../lib/allergen-reuse-orchestrator");
const { compositionIdentity } = await import("../lib/allergen-composition");
const { CANONICAL_ALLERGEN_KEYS, normaliseOperationalAllergens } = await import("../../shared/allergen-contract");
type ProductionPlan = import("../app/lib/production-plan").ProductionPlan;

const plans = repoMode === "memory" ? createProductionPlanRepository() : createFirestoreProductionPlanRepository();
const store = createAllergenAuthorityStore();
const route = emulatorUp ? await import("../app/api/production-plan/route") : undefined;
const AT = "2026-10-12T10:00:00.000Z";
const run = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let counter = 0;
const unique = () => `${run}-${++counter}`;
const states = (over: Record<string, string> = {}) => normaliseOperationalAllergens(Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, over[key] || "clear"])));

type Order = Record<string, unknown> & { canonicalId: string; status: string; version: number; lines: Array<Record<string, unknown>> };
// Each scenario gets its own week, so projection/package sequence counters of one scenario never collide with another's.
let weekOffset = 0;
const nextServiceDate = () => { const d = new Date(Date.UTC(2027, 0, 4 + 7 * (++weekOffset))); return d.toISOString().slice(0, 10); };
const makeOrder = (id: string, items: string[], lineExtra: Record<string, unknown> = {}, serviceDate = nextServiceDate()): Order => ({
  canonicalId: id, entityType: "Production Order", schemaVersion: "1", origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status: "accepted",
  serviceDate, requiredBy: `${serviceDate}T11:00:00.000Z`, clientName: "Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site", exceptions: [], requirementIds: [], priority: "normal", serviceWindow: { startTime: "11:00" },
  lines: items.map((item, index) => ({ canonicalId: `${id}:${index}`, sourceBookingLineId: `${id}:bl${index}`, sourceMenuItemId: item, choices: [], workstream: "sandwiches", customerQuantity: 10 + index, customerUnit: "ea", itemName: `Display ${index}`, dietaries: {}, status: "pending", sortOrder: index, ...lineExtra })),
});

/** The fault-injected canonical provider: Hub order reads/transitions plus the CPU self-delivery endpoint. */
class Provider {
  orders = new Map<string, Order>();
  /** Runs inside the post-commit materialization delivery, i.e. while the apply command is waiting. */
  onDelivery?: () => void;
  failOrderReads = false;
  /** Runs inside the accept confirmation call: a canonical composition change that lands DURING that call. */
  onConfirm?: () => void;
  unhandled: string[] = [];
  install() {
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as { url?: string }).url || String(input));
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.pathname === "/api/production") {
        if ((init?.method || "GET") === "GET") {
          const id = url.searchParams.get("canonicalId");
          if (id) { if (this.failOrderReads) return json({ error: { message: "hub unavailable" } }, 503); const order = this.orders.get(id); return order ? json({ order: structuredClone(order) }) : json({ error: { message: "not found" } }, 404); }
          return json({ orders: [...this.orders.values()].map(order => structuredClone(order)) });
        }
        const body = JSON.parse(String(init?.body || "{}")) as { canonicalId?: string; status?: string };
        const order = body.canonicalId ? this.orders.get(body.canonicalId) : undefined;
        if (order && body.status) { order.status = body.status; order.version += 1; }
        return json({ order: order ? structuredClone(order) : undefined });
      }
      if (url.pathname.includes("/api/hospitality/production-confirmation")) { this.onConfirm?.(); return json({ status: "sent" }); }
      if (url.pathname.includes("/api/internal/cpu-release-materialize")) { this.onDelivery?.(); return json({ status: "materialized" }); }
      if (url.pathname.includes("invalidate")) return json({ ok: true });
      this.unhandled.push(`${init?.method || "GET"} ${url.href}`);
      return json({ error: { message: `unhandled test URL ${url.href}` } }, 404);
    }) as typeof fetch;
  }
}
const realFetch = globalThis.fetch;
const provider = new Provider();

async function seed() {
  provider.orders.clear(); provider.onDelivery = undefined; provider.failOrderReads = false; provider.onConfirm = undefined;
  const items = [`item:${unique()}:ham`, `item:${unique()}:veg`];
  const originOrder = makeOrder(`o-origin-${unique()}`, items); provider.orders.set(originOrder.canonicalId, originOrder);
  const compositionId = compositionIdentity(originOrder as never)!.compositionId;
  const releaseId = `rel-${unique()}`;
  const signatures = [{ role: "production_chef", printedName: "A Chef", signedAt: AT, valid: true }, { role: "head_chef_site_manager", printedName: "B Head", signedAt: AT, valid: true }] as never;
  const originPlan: ProductionPlan = { id: `production-plan:${originOrder.canonicalId}`, orderId: originOrder.canonicalId, status: "planned", planningNotes: "", updatedAt: AT, updatedBy: "t", audit: [], signatures, signedSignatures: signatures, signedMenuContentHash: "h",
    menuItems: originOrder.lines.map((line, i) => ({ id: `mi:${i}`, sourceLineId: line.canonicalId as string, name: `Sandwich ${i}`, note: "", subItems: [{ id: `s:${i}`, productionItemId: `pi:${line.sourceMenuItemId}`, name: `Filling ${i}`, quantity: 10, allergens: states(i === 0 ? { milk: "contains" } : {}) as never, note: "", evidenceStatus: "completed" as const }] })),
    currentAllergenRelease: { releaseId, version: 1, matrixContentHash: `mh:${releaseId}`, signedAt: AT, status: "current", signatures, compositionId, masterArtifact: { id: "m", fileName: "m.pdf", createdAt: AT, createdBy: "t", contentHash: "d".repeat(64), pdfStatus: "generated", driveStatus: "saved" }, derivedArtifacts: [], packetArtifacts: [] } as never };
  await plans.save(originPlan);
  await recordSignedApproval({ store }, originPlan, originOrder as never, AT, "chef");
  const adopter = makeOrder(`production-order:v1:booking:mnk:o-adopter-${unique()}`, items, {}, originOrder.serviceDate as string); provider.orders.set(adopter.canonicalId, adopter);
  return { items, adopter, compositionId };
}
const apply = async (orderId: string, commandId = `apply-${unique()}-cmd`) => {
  const response = await route!.POST(new NextRequest("http://localhost:3400/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply-reused-authority", orderId, commandId }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> & { plan?: ProductionPlan; reuse?: { applied?: boolean; unchanged?: boolean }; error?: { code?: string } } };
};
const breadChanged = (order: Order): Order => { const next = structuredClone(order); for (const line of next.lines) line.productionInstructions = "Use sourdough"; return next; };
const assertFailClosed = (result: Awaited<ReturnType<typeof apply>>, label: string) => {
  assert.equal(result.status, 409, `${label}: never HTTP 200`);
  assert.equal(result.body.error?.code, "CPU_ALLERGEN_REUSE_AUTHORITY_REVOKED", label);
  assert.notEqual(result.body.plan?.status, "planned", `${label}: not reported as planned`);
  assert.equal(result.body.plan?.currentAllergenRelease, undefined, `${label}: no reused release exposed`);
  assert.equal(result.body.plan?.matrixArtifact, undefined);
  assert.deepEqual(result.body.reuse, { applied: false }, `${label}: no success by reuse`);
  assert.equal(result.body.approvedMatrixAvailable, false);
};

test(`handler[${repoMode}]: baseline — apply succeeds against the unchanged canonical order`, opts, async () => {
  provider.install();
  try {
    const s = await seed();
    const result = await apply(s.adopter.canonicalId);
    assert.deepEqual(provider.unhandled, [], "the provider stub covered every upstream call");
    assert.equal(result.status, 200, JSON.stringify(result.body.error));
    assert.equal(result.body.reuse?.applied, true);
    assert.equal(result.body.plan?.status, "planned");
    assert.equal(result.body.plan?.currentAllergenRelease?.approvalMode, "reused_authority");
    // the idempotent replay (same canonical order) is a guarded 200
    const replay = await apply(s.adopter.canonicalId, `apply-${unique()}-replay`);
    assert.equal(replay.status, 200); assert.equal(replay.body.reuse?.unchanged, true);
  } finally { globalThis.fetch = realFetch; }
});

test(`handler[${repoMode}]: the canonical order changes (bread instructions) DURING delivery — the final response fails closed`, opts, async () => {
  provider.install();
  try {
    const s = await seed();
    provider.onDelivery = () => { provider.orders.set(s.adopter.canonicalId, breadChanged(provider.orders.get(s.adopter.canonicalId)!)); };
    const result = await apply(s.adopter.canonicalId);
    assert.deepEqual(provider.unhandled, []);
    assertFailClosed(result, "new adoption, order changed during delivery");
    // the adoption itself committed validly against order A; the stored state is untouched by this task (no new rollback)
    const stored = (await plans.get(s.adopter.canonicalId))!;
    assert.equal(stored.currentAllergenRelease?.approvalMode, "reused_authority");
  } finally { globalThis.fetch = realFetch; }
});

test(`handler[${repoMode}]: replay after the canonical order changed fails closed`, opts, async () => {
  provider.install();
  try {
    const s = await seed();
    assert.equal((await apply(s.adopter.canonicalId)).status, 200);
    provider.orders.set(s.adopter.canonicalId, breadChanged(provider.orders.get(s.adopter.canonicalId)!));
    // The replay re-derives the composition from the LATEST order and refuses the command outright (409, nothing exposed as authoritative).
    const replay = await apply(s.adopter.canonicalId, `apply-${unique()}-replay2`);
    assert.equal(replay.status, 409);
    assert.match(String(replay.body.error?.code), /CPU_ALLERGEN_REUSE_/);
    assert.equal(replay.body.plan?.currentAllergenRelease, undefined);
    assert.notEqual(replay.body.plan?.status, "planned");
    assert.notEqual(replay.body.reuse?.applied, true);
  } finally { globalThis.fetch = realFetch; }
});

test(`handler[${repoMode}]: the latest canonical order cannot be loaded after delivery — fail closed`, opts, async () => {
  provider.install();
  try {
    const s = await seed();
    provider.onDelivery = () => { provider.failOrderReads = true; };
    assertFailClosed(await apply(s.adopter.canonicalId), "order unreadable after delivery");
  } finally { globalThis.fetch = realFetch; }
});

const accept = async (orderId: string) => {
  const response = await route!.POST(new NextRequest("http://localhost:3400/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept", orderId, commandId: `accept-${unique()}-cmd` }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> & { plan?: ProductionPlan; error?: { code?: string } } };
};

test(`handler[${repoMode}]: P1-1 — the canonical composition changes DURING the accept confirmation call: the final response guard reloads the latest order and suppresses the reused release`, opts, async () => {
  provider.install();
  try {
    const s = await seed();
    const adopted = await apply(s.adopter.canonicalId);
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body.error));
    assert.equal(adopted.body.plan?.currentAllergenRelease?.approvalMode, "reused_authority", "the adopter holds a valid reused release before the accept");
    // 1. the request loads canonical order A (first read) and syncs lifecycle; 2. the confirmation call is made;
    // 3. the canonical provider advances the composition to B during that call; 4. the final guard must reload B.
    provider.onConfirm = () => { provider.orders.set(s.adopter.canonicalId, breadChanged(provider.orders.get(s.adopter.canonicalId)!)); };
    const result = await accept(s.adopter.canonicalId);
    assert.deepEqual(provider.unhandled, [], "the provider stub covered every upstream call");
    assert.ok(result.status === 200 || result.status === 409, `accept answered ${result.status}: ${JSON.stringify(result.body.error)}`);
    assert.equal(result.body.plan?.currentAllergenRelease, undefined, "the reused release must not survive a composition change that landed during the call");
    assert.equal(result.body.plan?.matrixArtifact, undefined);
    assert.notEqual(result.body.plan?.status, "planned");
  } finally { globalThis.fetch = realFetch; }
});

test(`handler[${repoMode}]: P1-1 control — an accept with no composition change keeps its reused release readable path intact (no false suppression)`, opts, async () => {
  provider.install();
  try {
    const s = await seed();
    assert.equal((await apply(s.adopter.canonicalId)).status, 200);
    const result = await accept(s.adopter.canonicalId);
    assert.equal(result.status, 200, JSON.stringify(result.body.error));
    assert.equal(result.body.plan?.currentAllergenRelease?.approvalMode, "reused_authority", "unchanged composition: the reused release remains valid");
  } finally { globalThis.fetch = realFetch; }
});
