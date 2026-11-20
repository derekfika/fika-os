import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Transaction } from "firebase-admin/firestore";
import { createDomainEvent } from "../../shared/domain-events";
import { RCOA_HOSPITALITY_OPLOC_ID } from "../lib/booking-email-site-identities";
import { hospitalityProductionEventId, stageHospitalityMirrorIntent, triggerHospitalityMirrorEvent } from "../lib/cpux-mirror/queue";

test("Hospitality create, amendment and withdrawal target their staged deterministic domain event IDs", () => {
  assert.equal(hospitalityProductionEventId("production-order:rcoa:1", 1, "created"), "production.order.created:production-order:rcoa:1:v1");
  assert.equal(hospitalityProductionEventId("production-order:rcoa:1", 2, "amended"), "production.order.amended:production-order:rcoa:1:v2");
  assert.equal(hospitalityProductionEventId("production-order:rcoa:1", 3, "withdrawn"), "production.order.cancelled:production-order:rcoa:1:v3");
});

test("successful CPU projection immediately invokes the existing targeted outbox replay", async () => {
  const eventId = hospitalityProductionEventId("production-order:rcoa:2", 1, "created");
  const calls: string[] = [];
  const result = await triggerHospitalityMirrorEvent(eventId, async id => {
    calls.push(id);
    return { eventId: id, status: "delivered" };
  });

  assert.deepEqual(calls, [eventId]);
  assert.deepEqual(result, { eventId, status: "delivered" });
});

test("Calendar replay failure is reported as pending without failing CPU handoff", async () => {
  const eventId = hospitalityProductionEventId("production-order:rcoa:3", 1, "created");
  const result = await triggerHospitalityMirrorEvent(eventId, async () => { throw new Error("provider unavailable"); });
  assert.deepEqual(result, { eventId, status: "pending", errorCode: "MIRROR_WORKER_UNAVAILABLE" });
});

test("Calendar staging is durable with writes disabled and restricted to the production RCoA OPLOC", () => {
  const at = "2026-10-24T23:15:00.000Z"; // 25 October in London
  const orderId = "production-order:rcoa:fixture";
  const productionOrder = {
    origin: "hospitality_booking", canonicalId: orderId, sourceBookingId: "booking:rcoa:fixture",
    destinationOplocId: RCOA_HOSPITALITY_OPLOC_ID, version: 1, serviceDate: "2026-10-25", lines: [],
  };
  const event = createDomainEvent({
    eventType: "production.order.created", sourceAggregateId: orderId, sourceVersion: 1, occurredAt: at, payload: { productionOrder },
  });
  const env: NodeJS.ProcessEnv = {
    FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os", NODE_ENV: "production",
    FIKA_CPUX_HOSPITALITY_ALLOWED_OPLOC: RCOA_HOSPITALITY_OPLOC_ID, FIKA_CPUX_MIRROR_WRITES_ENABLED: "false",
  };
  const records: Record<string, unknown>[] = [];
  const transaction = { create(_ref: unknown, record: Record<string, unknown>) { records.push(record); } } as unknown as Transaction;
  stageHospitalityMirrorIntent(transaction, event, { ...env, FIKA_RUNTIME_MODE: "staging" });
  stageHospitalityMirrorIntent(transaction, event, { ...env, FIRESTORE_EMULATOR_HOST: "localhost:8080" });
  stageHospitalityMirrorIntent(transaction, { ...event, payload: { productionOrder: { ...productionOrder, destinationOplocId: "oploc:other" } } }, env);
  stageHospitalityMirrorIntent(transaction, { ...event, payload: { productionOrder: { ...productionOrder, serviceDate: "2026-10-24" } } }, env);
  assert.equal(records.length, 0);
  stageHospitalityMirrorIntent(transaction, event, env);
  assert.equal(records.length, 1);
  assert.equal(records[0].eventId, event.eventId);
  assert.equal(records[0].outboxStatus, "live-pending");
  assert.deepEqual((records[0].payload as { cpuProjection: unknown }).cpuProjection, {
    changeType: "created", idempotencyKey: `cpu-projection:${orderId}:v1`,
  });
  stageHospitalityMirrorIntent(transaction, { ...event, eventType: "production.order.amended" }, env);
  assert.equal(records.length, 1);
  stageHospitalityMirrorIntent(transaction, { ...event, eventType: "production.order.cancelled", causationId: "withdrawal-key" }, env);
  assert.deepEqual((records[1].payload as { cpuProjection: unknown }).cpuProjection, {
    changeType: "withdrawn", idempotencyKey: "withdrawal-key", useCancellationOutbox: true,
  });
});

test("Send to CPU runs post-commit propagation and targets the staged event through immediate replay", () => {
  const source = readFileSync(new URL("../lib/hospitality-booking-service.ts", import.meta.url), "utf8");
  const createOrder = source.slice(source.indexOf("export async function createProductionOrder("));
  assert.match(createOrder, /const result = await createProductionFromApprovedBooking\([\s\S]*?const projectionPropagation = await propagateProductionChanges\(/);
  assert.match(source, /const calendarMirrorPromise = cpuDelivery\.then\(confirmed => hospitalityMirrorAfterCpu\(/);
  assert.match(source, /productionStatus === "delivered" && \["delivered", "not_required"\]\.includes\(calendarMirror\.status\)/);
});
