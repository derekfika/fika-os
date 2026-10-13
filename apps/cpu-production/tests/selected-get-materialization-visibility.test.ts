import assert from "node:assert/strict";
import test from "node:test";

/**
 * P1-2: after the final signature returns `generating`, a completed background materialization (this instance's `after()`, the outbox,
 * or ANOTHER instance/process) must become visible to the next selected GET without a restart, a manual refresh or cache expiry,
 * while stable plans keep their normal caching. Run once per plan repository:
 *
 *   HANDLER_REPO=memory    firebase emulators:exec ... "npx tsx --test tests/selected-get-materialization-visibility.test.ts"
 *   HANDLER_REPO=firestore firebase emulators:exec ... "npx tsx --test tests/selected-get-materialization-visibility.test.ts"
 */
const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const repoMode = process.env.HANDLER_REPO === "memory" ? "memory" : "firestore";
if (repoMode === "memory") process.env.FIKA_CPU_PLAN_STORE = "memory";
process.env.FIKA_SNAPSHOT_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "cpu-get-visibility-"));
process.env.CPU_PUBLIC_BASE_URL = "http://cpu.test";
process.env.FIKA_INTERNAL_API_TOKEN = "handler-test-token";
process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "{}";
process.env.GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION = "uat-owner@example.test";
const opts = { skip: emulatorUp ? false : "Firestore emulator is not running (FIRESTORE_EMULATOR_HOST unset)" };

const { NextRequest } = await import("next/server");
const { CANONICAL_ALLERGEN_KEYS } = await import("../../shared/allergen-contract");
const { createProductionPlanRepository, createFirestoreProductionPlanRepository } = await import("../lib/production-plan-repository");
const route = emulatorUp ? await import("../app/api/production-plan/route") : undefined;
type ProductionPlan = import("../app/lib/production-plan").ProductionPlan;
const repository = repoMode === "memory" ? createProductionPlanRepository() : createFirestoreProductionPlanRepository();

const run = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let counter = 0;
const unique = () => `${run}-${++counter}`;
let weekOffset = 0;
const nextServiceDate = () => new Date(Date.UTC(2028, 0, 3 + 7 * (++weekOffset))).toISOString().slice(0, 10);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type Order = Record<string, unknown> & { canonicalId: string; status: string; version: number; lines: Array<Record<string, unknown>> };
const makeOrder = (): Order => {
  const id = `production-order:v1:booking:mnk:${unique()}`;
  const serviceDate = nextServiceDate();
  return {
    canonicalId: id, entityType: "Production Order", schemaVersion: "1", origin: "hospitality_booking", requiresDelivery: true, sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: `quote:${id}:1`, currentRevision: 1, version: 1, status: "accepted",
    serviceDate, requiredBy: `${serviceDate}T11:00:00.000Z`, clientName: "UAT Customer", destinationOplocId: "oploc:test", destinationLabel: "Test site", exceptions: [], requirementIds: [], priority: "normal", serviceWindow: { startTime: "11:00", endTime: "12:00" },
    lines: [{ canonicalId: `${id}:line:1`, sourceBookingLineId: `${id}:bl1`, sourceMenuItemId: "hospitality-menu-item:mnk:deli_sandwich_lunch", sourceOfferingId: "hospitality-menu-item:mnk:deli_sandwich_lunch", choices: [], workstream: "sandwiches", customerQuantity: 8, customerUnit: "Per person", productionQuantity: 24, productionUnit: "piece", itemName: "Deli Style Sandwich Lunch", description: "d", dietaries: {}, status: "ready", sortOrder: 0 }],
  } as Order;
};

class Hub {
  orders = new Map<string, Order>();
  materializeCalls = 0;
  /** Called when the materialize endpoint is hit; the real endpoint would finish the artifact and persist it. */
  onMaterialize?: () => Promise<void>;
  blockMaterialize?: Promise<void>;
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
        return json({ error: { message: "no transitions expected" } }, 409);
      }
      if (url.pathname.includes("/api/internal/cpu-release-materialize")) {
        this.materializeCalls += 1;
        if (this.blockMaterialize) await this.blockMaterialize;
        await this.onMaterialize?.();
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

type Body = { plan?: ProductionPlan; signingLineage?: unknown; matrixStatus?: string; error?: { code?: string; message?: string } };
const post = async (body: Record<string, unknown>) => {
  const response = await route!.POST(new NextRequest("http://localhost:3400/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() as Body };
};
const selectedGet = async (order: Order) => {
  const response = await route!.GET(new NextRequest(`http://localhost:3400/api/production-plan?orderId=${encodeURIComponent(order.canonicalId)}`, { method: "GET" }));
  return { status: response.status, body: await response.json() as Body };
};
const complete = (order: Order) => order.lines.map((line, i) => ({
  id: `mi:${i}`, sourceLineId: line.canonicalId as string, name: "Deli Style Sandwich Lunch", note: "",
  subItems: [{ id: `s:${i}`, name: "UAT ham sandwich", quantity: 8, allergens: Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, key === "gluten" ? "contains" : "clear"])), note: "", evidenceStatus: "completed" }],
}));
const sign = (order: Order, role: "production_chef" | "head_chef_site_manager", lineage: unknown) => post({ action: "sign-matrix", orderId: order.canonicalId, role, printedName: role === "production_chef" ? "A Chef" : "B Head", attestation: "UAT test attestation for the handler test", signatureDataUrl: PNG, expectedLineage: lineage, commandId: `sg-${unique()}-cmd` });
const settle = async (ms = 50) => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, ms)); };

/** Both genuine-role signatures through the real handler; returns the response of the FINAL one (release pending / generating). */
async function signedAndGenerating(beforeFinal?: () => void) {
  const order = makeOrder(); hub.orders.clear(); hub.orders.set(order.canonicalId, order);
  hub.materializeCalls = 0; hub.onMaterialize = undefined; hub.blockMaterialize = undefined; hub.unhandled = [];
  const planned = await post({ action: "mark-planned", orderId: order.canonicalId, menuItems: complete(order), planningNotes: "", commandId: `mp-${unique()}-cmd` });
  assert.equal(planned.status, 200, JSON.stringify(planned.body.error));
  const first = await sign(order, "production_chef", planned.body.signingLineage);
  assert.equal(first.status, 200, JSON.stringify(first.body.error));
  beforeFinal?.();
  const final = await sign(order, "head_chef_site_manager", planned.body.signingLineage);
  assert.equal(final.status, 200, JSON.stringify(final.body.error));
  assert.equal(final.body.matrixStatus, "generating");
  assert.equal(final.body.plan?.currentAllergenRelease?.status, "pending");
  return { order, final };
}
/** What the real materialization endpoint persists on completion, written straight to the authoritative repository. */
async function persistMaterialized(order: Order) {
  const stored = (await repository.get(order.canonicalId))!;
  const release = stored.currentAllergenRelease!;
  const artifact = { id: `artifact-${unique()}`, bookingId: order.canonicalId, fileName: "signed-matrix.pdf", createdAt: new Date().toISOString(), createdBy: "materializer", contentHash: "a".repeat(64), pdfStatus: "generated", driveStatus: "saved", driveFileId: "file", driveUrl: "https://drive.example.test/signed-matrix.pdf" } as never;
  const ready = { ...stored, currentAllergenRelease: { ...release, status: "current", materializationStatus: "ready", masterArtifact: artifact, derivedArtifacts: [artifact] }, matrixArtifact: artifact, signedMatrixArtifact: artifact, updatedAt: new Date().toISOString() } as ProductionPlan;
  await repository.save(ready);
}

test(`GET[${repoMode}]: a completed background materialization becomes visible to the next selected GET (this instance's dispatch)`, opts, async () => {
  hub.install();
  try {
    // the dispatch started after the final response is held until we release it, then completes the artifact like the real endpoint
    let release!: () => void;
    const { order } = await signedAndGenerating(() => { hub.blockMaterialize = new Promise<void>(resolve => { release = resolve; }); });
    await settle();
    assert.equal(hub.materializeCalls, 1, "the dispatch ran after the response");
    const pending = await selectedGet(order);
    assert.equal(pending.status, 200);
    assert.equal(pending.body.plan?.currentAllergenRelease?.status, "pending", "still generating before completion");
    assert.equal(pending.body.plan?.matrixArtifact, undefined);
    hub.onMaterialize = async () => { await persistMaterialized(order); };
    release(); await settle();
    const after = await selectedGet(order);
    assert.equal(after.status, 200, JSON.stringify(after.body.error));
    assert.equal(after.body.plan?.currentAllergenRelease?.status, "current", "the persisted current release is returned, not the cached pending one");
    assert.equal(after.body.plan?.currentAllergenRelease?.materializationStatus, "ready");
    assert.ok(after.body.plan?.matrixArtifact, "the artifact is exposed");
    assert.equal(after.body.matrixStatus, "ready");
  } finally { globalThis.fetch = realFetch; }
});

test(`GET[${repoMode}]: completion by ANOTHER instance/process (no local callback) is observed without restart or cache expiry`, opts, async () => {
  hub.install();
  try {
    // this instance's own dispatch never completes it: another process does, writing only to the authoritative repository
    const { order } = await signedAndGenerating();
    await settle();
    const still = await selectedGet(order);
    assert.notEqual(still.body.plan?.currentAllergenRelease?.materializationStatus, "ready");
    assert.equal(still.body.plan?.matrixArtifact, undefined, "not visible before completion");
    await persistMaterialized(order);
    const seen = await selectedGet(order);
    assert.equal(seen.body.plan?.currentAllergenRelease?.materializationStatus, "ready");
    assert.ok(seen.body.plan?.matrixArtifact);
    assert.equal(seen.body.matrixStatus, "ready");
  } finally { globalThis.fetch = realFetch; }
});

test(`GET[${repoMode}]: once ready, repeated GETs use the normal cache again (no perpetual bypass)`, opts, async () => {
  hub.install();
  try {
    const { order } = await signedAndGenerating();
    await settle();
    await persistMaterialized(order);
    const ready = await selectedGet(order);
    assert.equal(ready.body.plan?.currentAllergenRelease?.materializationStatus, "ready");
    // a later unrelated persisted change is not re-read for a stable (ready) plan: the instance cache answers
    const stored = (await repository.get(order.canonicalId))!;
    await repository.save({ ...stored, planningNotes: "changed behind the cache", updatedAt: new Date().toISOString() } as ProductionPlan);
    const cached = await selectedGet(order);
    assert.equal(cached.body.plan?.currentAllergenRelease?.materializationStatus, "ready");
    assert.notEqual(cached.body.plan?.planningNotes, "changed behind the cache", "a stable plan is served from the instance cache");
  } finally { globalThis.fetch = realFetch; }
});
