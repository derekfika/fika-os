import assert from "node:assert/strict";
import test from "node:test";
import { buildCpuPropagationEvents, deliverCpuPropagation, enqueueCpuDelivery, enqueueCpuPropagation, listCpuOutboxForTests, resetCpuOutboxForTests, recoverCpuPropagation } from "../lib/cpu-durable-outbox";
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
