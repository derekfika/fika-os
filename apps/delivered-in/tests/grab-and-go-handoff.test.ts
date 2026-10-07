import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GrabAndGoOrder } from "../lib/grab-and-go";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { typescriptLoader } = require("../../../scripts/testing/load-typescript.cjs");

function fixture() {
  const records = new Map<string, any>(), calls: any[] = [], queries: any[] = [];
  let queue = Promise.resolve(), failCommit = false;
  let forward = async (_input: any) => "delivered";
  const snapshot = (ref: any) => ({ exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
  const collection = (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}`, get: async function () { return snapshot(this); } }),
    where: (field: string, operator: string, value: string) => ({ orderBy: (sort: string) => ({ limit: (limit: number) => ({ get: async () => {
      queries.push({ name, field, operator, sort, limit });
      const rows = [...records.entries()].filter(([key, row]) => key.startsWith(`${name}/`) && row[field] !== undefined && row[field] <= value).map(([, row]) => row).sort((a, b) => a[sort].localeCompare(b[sort])).slice(0, limit);
      return { docs: rows.map(row => ({ data: () => structuredClone(row) })) };
    } }) }) }),
  });
  const db = { collection, runTransaction: (callback: any) => {
    const operation = queue.then(async () => {
      const writes: Array<[any, any, boolean]> = [];
      const result = await callback({ get: async (ref: any) => snapshot(ref), set: (ref: any, data: any) => writes.push([ref, data, false]), create: (ref: any, data: any) => writes.push([ref, data, true]) });
      if (failCommit) { failCommit = false; throw new Error("isolated commit failure"); }
      for (const [ref, , create] of writes) if (create && records.has(ref.path)) throw new Error("already exists");
      for (const [ref, data] of writes) records.set(ref.path, structuredClone(data));
      return result;
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } };
  const load = typescriptLoader({ typescript: require("typescript"), appRoot, mocks: {
    [resolve(appRoot, "lib/firebase-admin.ts")]: { db },
    [resolve(appRoot, "lib/production-client.ts")]: { forwardProductionMaterialisation: async (input: any) => { calls.push(structuredClone(input)); return forward(input); } },
    [resolve(appRoot, "lib/delivered-in-read-budget.ts")]: { recordDeliveredInAppReadBudget() {} },
    [resolve(appRoot, "lib/server.ts")]: { resolveAccess: async () => ({ access: { email: "isolated-operator", oplocIds: ["oploc:owned"], permissions: ["grab_and_go.order"] } }), deliveredInErrorBody: (error: Error) => ({ error: { message: error.message } }) },
    [resolve(appRoot, "lib/grab-and-go-catalogue-client.ts")]: { getGrabAndGoCataloguePackage: async () => { throw new Error("Unexpected catalogue read"); } },
    [resolve(appRoot, "../shared/app-data-path.ts")]: { appDataPath: () => "unused-isolated-hosted-store" },
    "@fika/server-shared/data-source-meter-server": { recordDataAccess() {}, withDataTrace: (_trace: any, fn: any) => fn() },
  } });
  return { records, calls, queries, db, load, handoff: load(resolve(appRoot, "lib/grab-and-go-handoff.ts")),
    store: load(resolve(appRoot, "lib/grab-and-go-store.ts")), failCommit: () => { failCommit = true; }, forward: (fn: typeof forward) => { forward = fn; } };
}
function order(version = 1, status: "submitted" | "cancelled" = "submitted"): GrabAndGoOrder {
  return { orderId: "grab-and-go:oploc:owned:2026-10-12", oplocId: "oploc:owned", deliveryDate: "2026-10-12", rotationWeek: 4, status, version, submittedAt: "2026-10-07T10:00:00Z", updatedAt: "2026-10-07T10:00:00Z", updatedBy: "isolated-operator", history: [], lines: [{ productId: "product:owned", productName: "Owned pot", quantity: version, category: "grab_250ml", sortOrder: 1 }] };
}
const withHosted = async (run: () => Promise<void>) => {
  const previous = process.env.FIKA_RUNTIME_MODE; process.env.FIKA_RUNTIME_MODE = "staging";
  try { await run(); } finally { if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous; }
};

test("hosted source and immutable handoff commit atomically; failed commits leave neither", () => withHosted(async () => {
  const f = fixture(), source = order(); f.failCommit();
  await assert.rejects(f.store.saveGrabAndGoOrderHosted(source), /commit failure/); assert.equal(f.records.size, 0);
  await f.store.saveGrabAndGoOrderHosted(source); assert.equal(f.records.size, 2);
  const event = [...f.records.values()].find(row => row.eventId);
  assert.equal(event.actorId, source.updatedBy); assert.equal(event.sourceVersion, 1); assert.equal(event.payload.lines[0].quantity, 1);
  await assert.rejects(f.store.saveGrabAndGoOrderHosted(source), (error: any) => error.status === 409);
  assert.equal(f.records.size, 2); assert.equal(f.calls.length, 0);
}));

test("network failure keeps the committed source and recovers the identical payload through a bounded worker", () => withHosted(async () => {
  const f = fixture(), source = order(); await f.store.saveGrabAndGoOrderHosted(source);
  f.forward(async () => { throw new Error("isolated network unavailable"); });
  assert.equal(await f.handoff.deliverGrabHandoff(f.handoff.grabHandoffId(source)), "pending");
  const failed = [...f.records.values()].find(row => row.eventId); assert.equal(failed.delivery.status, "failed");
  assert.equal((await f.store.getGrabAndGoOrderHosted(source.oplocId, source.deliveryDate)).version, 1);
  f.forward(async () => "delivered");
  assert.deepEqual(await f.handoff.recoverGrabHandoffs(25, new Date(Date.now() + 31_000)), { attempted: 1, delivered: 1, pending: 0, interventionRequired: 0 });
  assert.deepEqual(f.calls[1], f.calls[0]);
  assert.deepEqual(f.queries[0], { name: f.handoff.GRAB_HANDOFF_COLLECTION, field: "nextEligibleAt", operator: "<=", sort: "nextEligibleAt", limit: 25 });
  assert.equal([...f.records.values()].find(row => row.eventId).nextEligibleAt, undefined);
  assert.equal((await f.handoff.recoverGrabHandoffs()).attempted, 0);
}));

test("concurrent delivery claims forward once and delivered replay does not forward again", () => withHosted(async () => {
  const f = fixture(), source = order(); await f.store.saveGrabAndGoOrderHosted(source);
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  f.forward(async () => { await waiting; return "delivered"; });
  const first = f.handoff.deliverGrabHandoff(f.handoff.grabHandoffId(source));
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(await f.handoff.deliverGrabHandoff(f.handoff.grabHandoffId(source)), "pending");
  release(); assert.equal(await first, "delivered");
  assert.equal(await f.handoff.deliverGrabHandoff(f.handoff.grabHandoffId(source)), "delivered"); assert.equal(f.calls.length, 1);
}));

test("historical cancelled source recovery preserves history and current-version CAS", () => withHosted(async () => {
  const f = fixture(), source = order(3, "cancelled");
  const { stableDocumentId } = f.load(require.resolve("@fika/server-shared/stable-document-id"));
  const key = `fikaDeliveredInGrabAndGoOrdersV1/${stableDocumentId(source.orderId)}`;
  f.records.set(key, structuredClone(source));
  await assert.rejects(f.handoff.ensureGrabHandoff(source.oplocId, source.deliveryDate, 2), (error: any) => error.status === 409);
  await f.handoff.ensureGrabHandoff(source.oplocId, source.deliveryDate, 3); await f.handoff.ensureGrabHandoff(source.oplocId, source.deliveryDate, 3);
  assert.equal(f.records.size, 2); assert.deepEqual(f.records.get(key), source);
  await f.handoff.deliverGrabHandoff(f.handoff.grabHandoffId(source)); assert.equal(f.calls[0].status, "cancelled"); assert.equal(f.calls[0].sourceVersion, 3);
}));

test("worker rejects unauthorised and unbounded requests before accessing persistence", async () => {
  const f = fixture(), route = f.load(resolve(appRoot, "app/api/internal/grab-and-go-outbox/route.ts"));
  const { NextRequest } = require("next/server"); const previous = process.env.FIKA_INTERNAL_API_TOKEN;
  process.env.FIKA_INTERNAL_API_TOKEN = "isolated-token";
  try {
    const request = (body: unknown, authorised = true) => new NextRequest("http://localhost/api/internal/grab-and-go-outbox", { method: "POST", headers: { "content-type": "application/json", ...(authorised ? { "x-fika-internal-token": "isolated-token" } : {}) }, body: JSON.stringify(body) });
    assert.equal((await route.POST(request({ limit: 25 }, false))).status, 403);
    assert.equal((await route.POST(request({ limit: 26 }))).status, 422);
    assert.equal((await route.POST(request({ eventId: "unrelated" }))).status, 422); assert.equal(f.queries.length, 0);
    assert.equal((await route.POST(request({ limit: 25 }))).status, 200); assert.equal(f.queries.length, 1);
  } finally { if (previous === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previous; }
});

test("governed handoff retry denies another site without touching source or outbox", () => withHosted(async () => {
  const f = fixture(), route = f.load(resolve(appRoot, "app/api/delivered-in/grab-and-go/route.ts"));
  const { NextRequest } = require("next/server");
  const response = await route.POST(new NextRequest("http://localhost/api/delivered-in/grab-and-go", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ oplocId: "oploc:denied", deliveryDate: "2026-10-12", action: "retry-handoff", expectedVersion: 1 }) }));
  assert.equal(response.status, 403); assert.equal(f.records.size, 0); assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
}));

test("expired claims are recoverable and late acknowledgements cannot settle a different claim", () => withHosted(async () => {
  const f = fixture(), source = order(); await f.store.saveGrabAndGoOrderHosted(source);
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  f.forward(async () => { await waiting; return "delivered"; });
  const first = f.handoff.deliverGrabHandoff(f.handoff.grabHandoffId(source));
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  f.forward(async () => { throw new Error("new claim network failure"); });
  assert.equal(await f.handoff.deliverGrabHandoff(f.handoff.grabHandoffId(source), new Date(Date.now() + 61_000)), "pending");
  release(); assert.equal(await first, "pending");
  const failed = [...f.records.values()].find(row => row.eventId); assert.equal(failed.delivery.status, "failed"); assert.equal(failed.delivery.attempts, 1);
  f.forward(async () => "delivered"); assert.equal((await f.handoff.recoverGrabHandoffs(25, new Date(Date.now() + 92_000))).delivered, 1);
}));
