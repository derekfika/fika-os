import assert from "node:assert/strict";
import test from "node:test";
import { buildCpuPropagationEvents, CPU_DELIVERY_TIMEOUT_MS, cpuDeliveryTimeoutMs, deliverCpuPropagation, enqueueCpuDelivery, enqueueCpuPropagation, listCpuOutboxForTests, normaliseCpuBaseUrl, replayCpuPropagation, resetCpuOutboxForTests, recoverCpuPropagation, seedCpuOutboxForTests } from "../lib/cpu-durable-outbox";
import { cpuReleaseMaterializationEventId } from "../lib/cpu-release-fanout";

const input = {
  eventId: "cpu-change:plan-1:v7",
  sourceEntityId: "plan-1",
  serviceDate: "2026-09-15",
  sourceVersion: 7,
  changedAt: "2026-09-15T10:00:00.000Z",
  changeType: "amended" as const,
  order: { origin: "menu_planning", destinationOplocId: "oploc-1" },
  logistics: true,
};

test("CPU outbox uses a longer bounded timeout only for self materialisation", () => {
  assert.equal(CPU_DELIVERY_TIMEOUT_MS.materialization, 60_000);
  assert.equal(cpuDeliveryTimeoutMs("cpu-production", "/api/internal/cpu-release-materialize"), 60_000);
  assert.equal(cpuDeliveryTimeoutMs("delivered-in", "/api/delivered-in/invalidate"), 8_000);
  assert.equal(cpuDeliveryTimeoutMs("logistics", "/api/logistics/invalidate"), 8_000);
  assert.equal(cpuDeliveryTimeoutMs("cpu-production", "/api/internal/cpu-post-commit"), 8_000);
});

test("CPU self-delivery normalizes configured bases into absolute safe URLs", () => {
  const cases = [
    ["https://cpu-staging.fikacatering.com", "https://cpu-staging.fikacatering.com"],
    ["cpu-staging.fikacatering.com", "https://cpu-staging.fikacatering.com"],
    ["http://localhost:3400", "http://localhost:3400"],
    ["localhost:3400", "http://localhost:3400"],
    ["  localhost:3400/// ", "http://localhost:3400"],
    ["127.0.0.1:3400/", "http://127.0.0.1:3400"],
    ["::1", "http://[::1]"],
  ] as const;
  for (const [configured, expected] of cases) assert.equal(normaliseCpuBaseUrl(configured), expected);
  assert.throws(() => normaliseCpuBaseUrl("ftp://cpu-staging.fikacatering.com"), /base URL configuration is invalid/);
  assert.throws(() => normaliseCpuBaseUrl("https://[invalid"), /base URL configuration is invalid/);
});

test("CPU self-delivery prefers the public base and builds the materialization endpoint URL safely", async () => {
  resetCpuOutboxForTests();
  const previousFetch = globalThis.fetch;
  const previousPublic = process.env.CPU_PUBLIC_BASE_URL;
  const previousProduction = process.env.CPU_PRODUCTION_BASE_URL;
  const previousRuntime = process.env.FIKA_RUNTIME_MODE;
  let requestedUrl = "";
  delete process.env.CPU_PUBLIC_BASE_URL;
  process.env.CPU_PRODUCTION_BASE_URL = "cpu-staging.fikacatering.com/";
  process.env.FIKA_RUNTIME_MODE = "local";
  globalThis.fetch = (async (input) => { requestedUrl = String(input); return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    const event = await enqueueCpuDelivery({ eventId: "cpu-allergen-materialize:release:oploc:haleon:order:haleon", sourceAggregateId: "release", sourceVersion: 1, occurredAt: "2026-09-14T09:00:00.000Z", consumer: "cpu-production", route: "/api/internal/cpu-release-materialize", body: { orderId: "order:haleon", releaseId: "release" } });
    assert.equal((await deliverCpuPropagation(event.eventId, new Date("2026-09-14T09:00:00.000Z"))).status, "delivered");
    assert.equal(requestedUrl, "https://cpu-staging.fikacatering.com/api/internal/cpu-release-materialize");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousPublic === undefined) delete process.env.CPU_PUBLIC_BASE_URL; else process.env.CPU_PUBLIC_BASE_URL = previousPublic;
    if (previousProduction === undefined) delete process.env.CPU_PRODUCTION_BASE_URL; else process.env.CPU_PRODUCTION_BASE_URL = previousProduction;
    if (previousRuntime === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousRuntime;
  }
});

test("CPU durable outbox trims the internal token before self-delivery", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.FIKA_INTERNAL_API_TOKEN;
  const previousRuntime = process.env.FIKA_RUNTIME_MODE;
  const previousPublic = process.env.CPU_PUBLIC_BASE_URL;
  const sent: string[] = [];
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.CPU_PUBLIC_BASE_URL = "http://cpu.test";
  globalThis.fetch = (async (_input, init) => { sent.push(new Headers(init?.headers).get("x-fika-internal-token") || ""); return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    for (const token of ["secret-token", "  secret-token  ", "secret-token\n"]) {
      resetCpuOutboxForTests();
      process.env.FIKA_INTERNAL_API_TOKEN = token;
      const event = await enqueueCpuDelivery({ eventId: `cpu-token-test:${sent.length}`, sourceAggregateId: "release", sourceVersion: 1, occurredAt: "2026-09-14T09:00:00.000Z", consumer: "cpu-production", route: "/api/internal/cpu-release-materialize", body: { orderId: "order:haleon", releaseId: "release" } });
      assert.equal((await deliverCpuPropagation(event.eventId, new Date("2026-09-14T09:00:00.000Z"))).status, "delivered");
    }
    assert.deepEqual(sent, ["secret-token", "secret-token", "secret-token"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previousToken;
    if (previousRuntime === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousRuntime;
    if (previousPublic === undefined) delete process.env.CPU_PUBLIC_BASE_URL; else process.env.CPU_PUBLIC_BASE_URL = previousPublic;
  }
});

test("CPU self-delivery fails safely before fetch when the non-local token is missing", async () => {
  resetCpuOutboxForTests();
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.FIKA_INTERNAL_API_TOKEN;
  const previousRuntime = process.env.FIKA_RUNTIME_MODE;
  let calls = 0;
  delete process.env.FIKA_INTERNAL_API_TOKEN;
  process.env.FIKA_RUNTIME_MODE = "staging";
  globalThis.fetch = (async () => { calls += 1; throw new Error("fetch must not be called"); }) as typeof fetch;
  try {
    const event = await enqueueCpuDelivery({ eventId: "cpu-token-missing", sourceAggregateId: "release", sourceVersion: 1, occurredAt: "2026-09-14T09:00:00.000Z", consumer: "cpu-production", route: "/api/internal/cpu-release-materialize", body: { orderId: "order:haleon", releaseId: "release" } });
    const result = await deliverCpuPropagation(event.eventId, new Date("2026-09-14T09:00:00.000Z"));
    assert.equal(result.status, "failed");
    assert.equal(calls, 0);
    assert.match(result.error || "", /internal authentication is not configured/);
    assert.doesNotMatch(result.error || "", /secret-token/);
    assert.equal(listCpuOutboxForTests()[0].delivery.status, "failed");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previousToken;
    if (previousRuntime === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousRuntime;
  }
});

test("CPU creates one durable obligation per independent consumer and stable scope", async () => {
  resetCpuOutboxForTests();
  const events = buildCpuPropagationEvents(input);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].eventId, events[1].eventId);
  await enqueueCpuPropagation(input);
  await enqueueCpuPropagation(input);
  assert.equal(listCpuOutboxForTests().length, 2, "retrying the command must not duplicate obligations");
  assert.equal(listCpuOutboxForTests()[0].payload.sourceEventId, input.eventId);
});

test("failed CPU delivery remains observable and bounded recovery retries it", async () => {
  resetCpuOutboxForTests();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response("unavailable", { status: 503 }); }) as typeof fetch;
  try {
    const [event] = await enqueueCpuPropagation(input);
    const result = await deliverCpuPropagation(event.eventId, new Date("2026-09-15T10:00:00.000Z"));
    assert.equal(result.status, "failed");
    assert.equal(calls, 1);
    assert.equal(listCpuOutboxForTests().find(value => value.eventId === event.eventId)?.delivery.status, "failed");
    const recovery = await recoverCpuPropagation(1, new Date("2026-09-15T10:00:31.000Z"));
    assert.equal(recovery.length, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("explicit materialization replay resets a failed event and invokes its endpoint immediately", async () => {
  resetCpuOutboxForTests();
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.CPU_PUBLIC_BASE_URL;
  let calls = 0;
  let requestedUrl = "";
  process.env.CPU_PUBLIC_BASE_URL = "http://cpu.test";
  globalThis.fetch = (async (input) => {
    calls += 1;
    requestedUrl = String(input);
    return new Response(calls === 1 ? "failed" : JSON.stringify({ status: "materialized" }), { status: calls === 1 ? 503 : 200 });
  }) as typeof fetch;
  try {
    const event = await enqueueCpuDelivery({ eventId: "cpu-allergen-materialize:release:oploc:haleon:order:haleon", sourceAggregateId: "release", sourceVersion: 1, occurredAt: "2026-09-14T09:00:00.000Z", consumer: "cpu-production", route: "/api/internal/cpu-release-materialize", body: { orderId: "order:haleon", releaseId: "release" } });
    const failed = await deliverCpuPropagation(event.eventId, new Date("2026-09-14T09:00:00.000Z"));
    assert.equal(failed.status, "failed");
    const replayed = await replayCpuPropagation(event.eventId, new Date("2026-09-14T09:00:01.000Z"));
    assert.equal(replayed?.eventId, event.eventId);
    assert.equal(replayed?.delivery.status, "pending");
    assert.equal(replayed?.delivery.nextEligibleAt, "2026-09-14T09:00:01.000Z");
    const delivered = await deliverCpuPropagation(event.eventId, new Date("2026-09-14T09:00:01.000Z"));
    assert.equal(delivered.status, "delivered");
    assert.equal(calls, 2);
    assert.equal(requestedUrl, "http://cpu.test/api/internal/cpu-release-materialize");
    assert.equal(listCpuOutboxForTests().length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.CPU_PUBLIC_BASE_URL; else process.env.CPU_PUBLIC_BASE_URL = previousBase;
  }
});

test("explicit replay also reopens a dead-lettered materialization without creating an event", async () => {
  resetCpuOutboxForTests();
  const event = await enqueueCpuDelivery({ eventId: "cpu-allergen-materialize:release:oploc:xchange:order:xchange", sourceAggregateId: "release", sourceVersion: 1, occurredAt: "2026-09-14T09:00:00.000Z", consumer: "cpu-production", route: "/api/internal/cpu-release-materialize", body: { orderId: "order:xchange", releaseId: "release" } });
  seedCpuOutboxForTests([{ ...event, delivery: { ...event.delivery, status: "dead-letter", attempts: 10, deadLetteredAt: "2026-09-14T09:01:00.000Z" } }]);
  const replayed = await replayCpuPropagation(event.eventId, new Date("2026-09-14T09:02:00.000Z"));
  assert.equal(replayed?.eventId, event.eventId);
  assert.equal(replayed?.delivery.status, "pending");
  assert.equal(replayed?.delivery.attempts, 0);
  assert.equal(listCpuOutboxForTests().length, 1);
});

test("release delivery identity includes the independent OPLOC scope", async () => {
  resetCpuOutboxForTests();
  const [first, second] = await Promise.all([
    enqueueCpuPropagation({ ...input, eventId: "release:v3", order: { origin: "menu_planning", destinationOplocId: "oploc-1" }, logistics: false }),
    enqueueCpuPropagation({ ...input, eventId: "release:v3", order: { origin: "menu_planning", destinationOplocId: "oploc-2" }, logistics: false }),
  ]);
  assert.notEqual(first[0].eventId, second[0].eventId);
  assert.equal(listCpuOutboxForTests().length, 2);
});

test("each signed destination gets an independent materialization obligation", async () => {
  resetCpuOutboxForTests();
  const releaseId = "cpu-allergen-release:2026-09-15:publication-day:1:v1";
  const first = { canonicalId: "production-order:haleon", destinationOplocId: "oploc:haleon" } as const;
  const second = { canonicalId: "production-order:xchange", destinationOplocId: "oploc:xchange" } as const;
  const firstId = cpuReleaseMaterializationEventId(releaseId, first);
  const secondId = cpuReleaseMaterializationEventId(releaseId, second);
  assert.notEqual(firstId, secondId);
  await Promise.all([
    enqueueCpuDelivery({ eventId: firstId, sourceAggregateId: releaseId, sourceVersion: 1, occurredAt: "2026-09-15T10:00:00.000Z", consumer: "cpu-production", route: "/api/internal/cpu-release-materialize", body: { orderId: first.canonicalId, releaseId } }),
    enqueueCpuDelivery({ eventId: secondId, sourceAggregateId: releaseId, sourceVersion: 1, occurredAt: "2026-09-15T10:00:00.000Z", consumer: "cpu-production", route: "/api/internal/cpu-release-materialize", body: { orderId: second.canonicalId, releaseId } }),
  ]);
  assert.equal(listCpuOutboxForTests().length, 2);
  assert.match(firstId, /oploc:oploc:haleon/);
  assert.match(secondId, /oploc:oploc:xchange/);
});
