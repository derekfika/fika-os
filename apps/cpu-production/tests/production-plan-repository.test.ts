import assert from "node:assert/strict";
import test from "node:test";
import { createProductionPlanRepository } from "../lib/production-plan-repository";
import type { ProductionPlan } from "../app/lib/production-plan";

const plan = (updatedAt = "2026-08-27T10:00:00.000Z"): ProductionPlan => ({ id: "production-plan:order-1", orderId: "order-1", status: "planning", menuItems: [], planningNotes: "", updatedAt, updatedBy: "chef", audit: [] });

test("production plan repository round-trips plans and preserves nested state", async () => {
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  const repository = createProductionPlanRepository();
  const value = plan();
  await repository.save(value);
  assert.deepEqual(await repository.get(value.orderId), value);
  assert.deepEqual(await repository.list(), [value]);
});

test("production plan repository rejects stale updates", async () => {
  process.env.FIKA_CPU_PLAN_STORE = "memory";
  const repository = createProductionPlanRepository();
  const value = plan();
  await repository.save(value);
  await repository.save({ ...value, updatedAt: "2026-08-27T10:01:00.000Z" }, value.updatedAt);
  await assert.rejects(() => repository.save({ ...value, planningNotes: "stale" }, value.updatedAt), (error: { status?: number }) => error.status === 409);
});
