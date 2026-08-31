import assert from "node:assert/strict";
import test from "node:test";
import { eventTypeForConsumers, notifyCpuConsumerInvalidations } from "../lib/cpu-consumer-invalidation";

test("CPU menu-planning changes notify Delivered-In and Logistics with bounded metadata", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.FIKA_INTERNAL_API_TOKEN;
  process.env.FIKA_INTERNAL_API_TOKEN = "test-token";
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: HeadersInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: init?.headers || {} });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await notifyCpuConsumerInvalidations({ eventId: "cpu-change:12", sourceEntityId: "order:1", serviceDate: "2026-08-31", sourceVersion: 7, changedAt: "2026-08-31T10:00:00Z", changeType: "amended", order: { origin: "menu_planning", destinationOplocId: "oploc:1" }, logistics: true, reviewManifest: { sourceVersion: "cpu-change-12", contentHash: "hash-12" } as never });
    assert.equal(result.attempted, 2);
    assert.equal(requests.length, 2);
    const delivered = requests.find(request => request.url.includes("delivered-in"))!;
    const logistics = requests.find(request => request.url.includes("logistics"))!;
    assert.deepEqual(delivered.body, { sourceDomain: "cpu-production", sourceEntityId: "order:1", eventId: "cpu-change:12", eventType: "amended", serviceDate: "2026-08-31", oplocId: "oploc:1", sourceVersion: "cpu-change-12", contentHash: "hash-12" });
    assert.deepEqual(logistics.body, { serviceDate: "2026-08-31", sourceDomain: "cpu-production", sourceEntityId: "order:1", sourceVersion: 7, changedAt: "2026-08-31T10:00:00Z", changeType: "amended", sourceContentHash: "hash-12" });
    assert.equal(new Headers(delivered.headers).get("x-fika-internal-token"), "test-token");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previousToken;
  }
});

test("CPU non-delivered orders notify Logistics once and unrelated review scopes notify neither", async () => {
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async input => { requests.push(String(input)); return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    await notifyCpuConsumerInvalidations({ eventId: "cpu-change:13", sourceEntityId: "order:2", serviceDate: "2026-09-01", sourceVersion: 8, changedAt: "2026-09-01T10:00:00Z", changeType: "changed", order: { origin: "cpu_created" }, logistics: true });
    assert.equal(requests.length, 1);
    assert.match(requests[0], /logistics/);
    requests.length = 0;
    await notifyCpuConsumerInvalidations({ eventId: "cpu-change:14", sourceEntityId: "plan:3", serviceDate: "2026-09-01", sourceVersion: 9, changedAt: "2026-09-01T10:00:00Z", changeType: "amended" });
    assert.equal(requests.length, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("CPU plan changes notify Delivered-In without notifying Logistics", async () => {
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async input => { requests.push(String(input)); return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    await notifyCpuConsumerInvalidations({ eventId: "cpu-change:16", sourceEntityId: "plan:5", serviceDate: "2026-09-02", sourceVersion: 11, changedAt: "2026-09-02T10:00:00Z", changeType: "amended", order: { origin: "menu_planning", destinationOplocId: "oploc:5" }, logistics: false });
    assert.deepEqual(requests, ["http://localhost:3800/api/delivered-in/invalidate"]);
  } finally { globalThis.fetch = previousFetch; }
});

test("CPU notification retry is bounded and change classification is deterministic", async () => {
  const previousFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => { attempts += 1; return new Response("{}", { status: attempts === 2 ? 200 : 503 }); }) as typeof fetch;
  try {
    const result = await notifyCpuConsumerInvalidations({ eventId: "cpu-change:15", sourceEntityId: "order:4", serviceDate: "2026-09-02", sourceVersion: 10, changedAt: "2026-09-02T10:00:00Z", changeType: "withdrawn", order: { origin: "cpu_created" }, logistics: true });
    assert.equal(attempts, 2);
    assert.deepEqual(result.results, [{ delivered: true, attempts: 2 }]);
    assert.equal(eventTypeForConsumers("cancelled-order-dismissed"), "withdrawn");
    assert.equal(eventTypeForConsumers("sign-matrix"), "changed");
    assert.equal(eventTypeForConsumers("lines-updated"), "amended");
  } finally { globalThis.fetch = previousFetch; }
});

test("CPU mutation routes publish before consumer notification without per-order fanout", async () => {
  const production = await (await import("node:fs/promises")).readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  const plan = await (await import("node:fs/promises")).readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(production, /rebuildCpuReviewPackage[\s\S]*notifyCpuConsumerInvalidations/);
  assert.match(plan, /rebuildCpuReviewPackage[\s\S]*notifyCpuConsumerInvalidations/);
  assert.doesNotMatch(production, /orders\.map\([^)]*notifyCpuConsumerInvalidations/);
});
