import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hospitalityProductionEventId, triggerHospitalityMirrorEvent } from "../lib/cpux-mirror/queue";

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
  assert.deepEqual(result, { eventId, status: "pending" });
});

test("Send to CPU runs post-commit propagation and targets the staged event through immediate replay", () => {
  const source = readFileSync(new URL("../lib/hospitality-booking-service.ts", import.meta.url), "utf8");
  const createOrder = source.slice(source.indexOf("export async function createProductionOrder("));
  assert.match(createOrder, /const result = await createProductionFromApprovedBooking\([\s\S]*?const projectionPropagation = await propagateProductionChanges\(/);
  assert.match(source, /const calendarMirrorPromise = cpuProjectionPromise\.then\(async cpuProjection =>/);
  assert.match(source, /await triggerHospitalityMirrorEvent\(calendarEventId\)/);
});
