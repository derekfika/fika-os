import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import type { ProductionOrder } from "../lib/production-types";
import { buildCpuDayProjection } from "../lib/cpu-projection";
import { publishCpuProjectionPackage } from "../lib/cpu-read-package";

test("CPU routes limit site scope without hiding one-offs from trusted global staff", { timeout: 30_000 }, async () => {
  const saved = { mode: process.env.FIKA_RUNTIME_MODE, snapshots: process.env.FIKA_SNAPSHOT_DIR, fetch: globalThis.fetch };
  const directory = mkdtempSync(path.join(tmpdir(), "fika-cpu-scope-"));
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIKA_SNAPSHOT_DIR = directory;
  const serviceDate = "2026-11-05";
  const allowedId = "production-order:scope-allowed";
  const otherId = "production-order:scope-other";
  const oneOffId = "production-order:scope-one-off";
  const oneOffDestination = "week:scope:day:0:one-off:venue";
  const order = (canonicalId: string, destinationOplocId: string, destination?: ProductionOrder["destination"]): ProductionOrder => ({
    canonicalId, entityType: "Production Order", schemaVersion: "0.1.0", version: 1, requirementIds: [], sourceBookingId: canonicalId, sourceQuoteRevisionId: "", origin: "menu_planning", status: "menu_available", serviceDate,
    requiredBy: `${serviceDate}T12:00:00.000Z`, serviceWindow: { startTime: "12:00" }, destinationOplocId, destinationLabel: destination?.label || destinationOplocId, ...(destination ? { destination } : {}), priority: "normal", currentRevision: 1,
    lines: [{ canonicalId: `${canonicalId}:line:1`, sourceBookingLineId: `${canonicalId}:source:1`, itemName: "Test meal", customerQuantity: 4, customerUnit: "portion", dietaries: {}, status: "ready", sortOrder: 1 }], exceptions: [], audit: [], createdAt: "2026-11-04T12:00:00.000Z", createdBy: "test", idempotencyKey: canonicalId, externalReferences: [],
  });
  const orders = [
    order(allowedId, "oploc:allowed", { kind: "governed", id: "oploc:allowed", label: "Allowed site" }),
    order(otherId, "oploc:other", { kind: "governed", id: "oploc:other", label: "Other site" }),
    order(oneOffId, oneOffDestination, { kind: "one-off", id: oneOffDestination, sourceDayId: "week:scope:day:0", label: "One-off venue", address: "1 Test Road" }),
  ];
  let globalAccess = false;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method });
    if (url.includes("/api/cpu-production/access")) return new Response(JSON.stringify({ principal: { id: "scope-user", displayName: "Scope user" }, allOplocs: globalAccess, oplocs: [{ id: "oploc:allowed" }] }), { status: 200 });
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order: orders.find(item => url.includes(encodeURIComponent(item.canonicalId))) }), { status: 200 });
    if (url.includes("/api/production?serviceDate=") || url.includes("/api/production?weekCommencing=")) return new Response(JSON.stringify({ orders }), { status: 200 });
    if (url.includes("/api/oploc-labels")) throw new Error("Explicit one-off destinations must not require Hub OPLOC labels.");
    throw new Error(`Unexpected upstream request: ${method} ${url}`);
  }) as typeof fetch;
  const request = (query: string) => new NextRequest(`http://localhost/api/production${query}`, { headers: { cookie: "session=scope-test" } });
  try {
    const { GET, POST } = await import("../app/api/production/route");
    const { GET: reviewGet } = await import("../app/api/delivered-in/review/route");
    const queue = await GET(request(`?serviceDate=${serviceDate}`));
    assert.equal(queue.status, 200);
    assert.deepEqual((await queue.json()).orders.map((item: ProductionOrder) => item.canonicalId), [allowedId]);
    const allowed = await GET(request(`?canonicalId=${encodeURIComponent(allowedId)}`));
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).order.canonicalId, allowedId);
    for (const id of [otherId, oneOffId]) assert.equal((await GET(request(`?canonicalId=${encodeURIComponent(id)}`))).status, 403);
    assert.equal((await GET(request(`?diagnostic=1&serviceDate=${serviceDate}`))).status, 403);
    assert.equal((await GET(request(`?changesSince=0&serviceDate=${serviceDate}`))).status, 403);
    const siteScope = (await (await GET(request("?cacheScope=1"))).json()).cacheScope;
    const projection = buildCpuDayProjection(serviceDate, orders, [], 1);
    await publishCpuProjectionPackage(projection);
    const projected = await GET(request(`?projection=1&serviceDate=${serviceDate}`));
    assert.equal(projected.status, 200, await projected.clone().text());
    const projectedBody = await projected.json();
    assert.deepEqual(projectedBody.projection.orders.map((item: { id: string }) => item.id), [allowedId]);
    assert.equal(projectedBody.projection.summary.orders, 1);
    assert.equal(projectedBody.projection.summary.totalUnits, 4);
    assert.equal(projectedBody.projection.projectionContentHash, undefined, "a filtered view cannot claim the full package content hash");
    assert.equal((await GET(request(`?projectionHead=1&serviceDate=${serviceDate}`))).status, 200);
    const { loadCpuAllergenProjection } = await import("../app/lib/cpu-allergen-projection-loader");
    const cache = new Map<string, any>();
    const dependencies = {
      fetch: (async (input: RequestInfo | URL) => GET(request(String(input).replace("/api/production", "")))) as typeof fetch,
      read: async (key: string, scope: string) => cache.get(`${key}:${scope}`),
      write: async (entry: { key: string; cacheScope: string }) => { cache.set(`${entry.key}:${entry.cacheScope}`, entry); },
    };
    const cold = await loadCpuAllergenProjection(serviceDate, "delivered_in", dependencies);
    assert.equal(cold.cacheHit, false);
    assert.deepEqual(cold.projection.orders.map(item => item.id), [allowedId]);
    const warm = await loadCpuAllergenProjection(serviceDate, "delivered_in", dependencies);
    assert.equal(warm.cacheHit, true, "the global package head must validate the scoped cached view without a refresh loop");
    assert.deepEqual(warm.projection.orders.map(item => item.id), [allowedId]);
    const postCount = calls.filter(call => call.method === "POST").length;
    const deniedMutation = await POST(new NextRequest("http://localhost/api/production", { method: "POST", headers: { cookie: "session=scope-test", "content-type": "application/json" }, body: JSON.stringify({ action: "transition", canonicalId: otherId, expectedVersion: 1, status: "planned", reason: "Test scope denial" }) }));
    assert.equal(deniedMutation.status, 403);
    assert.equal(calls.filter(call => call.method === "POST").length, postCount, "denied mutation must not reach Hub write");
    const deniedReview = await reviewGet(new NextRequest(`http://localhost/api/delivered-in/review?serviceDate=${serviceDate}&oplocId=${encodeURIComponent(oneOffDestination)}`, { headers: { cookie: "session=scope-test" } }));
    assert.equal(deniedReview?.status, 403);
    globalAccess = true;
    const globalScope = (await (await GET(request("?cacheScope=1"))).json()).cacheScope;
    assert.notEqual(globalScope, siteScope, "a changed destination grant must invalidate the local projection cache scope");
    const globalOneOff = await GET(request(`?canonicalId=${encodeURIComponent(oneOffId)}`));
    assert.equal(globalOneOff.status, 200);
    assert.equal((await globalOneOff.json()).order.destination.id, oneOffDestination);
    assert.equal(calls.filter(call => call.url.includes("/api/oploc-labels")).length, 0);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.mode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = saved.mode;
    if (saved.snapshots === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = saved.snapshots;
    rmSync(directory, { recursive: true, force: true });
  }
});
