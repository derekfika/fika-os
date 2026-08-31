import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_PRODUCTION_PLAN_ORDER_IDS } from "../lib/production-plan-repository";

test("Production Plan repository has no whole-collection read and exposes bounded direct reads", async () => {
  const repository = await readFile(new URL("../lib/production-plan-repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(repository, /async list\(|collection\(\)\)\.get\(\)/s);
  assert.doesNotMatch(repository, /async list\(/);
  assert.match(repository, /getByOrderIds/);
  assert.match(repository, /MAX_PRODUCTION_PLAN_ORDER_IDS/);
  assert.match(repository, /\.doc\(orderId\)\.get\(\)/);
});

test("normal Production Plan requests fail closed when no selector is supplied", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /await loadPlans\(\)|planRepository\.list\(\)/);
  assert.match(route, /rejected-unsafe-broad-request/);
  assert.match(route, /PLAN_SCOPE_REQUIRED/);
  assert.match(route, /orderId or an explicit bounded orderIds list/);
  assert.match(route, /getByOrderIds\(sourceOrders\.map/);
});

test("bounded detail and review callers remain direct or package-backed", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const review = await readFile(new URL("../app/api/delivered-in/review/route.ts", import.meta.url), "utf8");
  const projection = await readFile(new URL("../lib/cpu-projection-repository.ts", import.meta.url), "utf8");
  assert.match(route, /planRepository\.get\(command\.orderId\)/);
  assert.match(route, /loadDeliveredInReviewStatuses/);
  assert.doesNotMatch(review, /planRepository\.list\(\)|productionPlansCollection\.get\(\)/);
  assert.match(projection, /wanted\.map\(orderId/);
  assert.ok(MAX_PRODUCTION_PLAN_ORDER_IDS <= 100);
});

test("CPU package routes remain package-backed and reconciliation is explicit", async () => {
  const production = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  const review = await readFile(new URL("../app/api/delivered-in/review/route.ts", import.meta.url), "utf8");
  assert.match(production, /getCpuProjectionPackage/);
  assert.match(production, /reconcile/);
  assert.match(review, /getCpuReviewPackage/);
  assert.match(review, /reconcile/);
});
