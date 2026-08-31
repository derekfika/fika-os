import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadDeliveredInReviewStatuses, MAX_DELIVERED_IN_REVIEW_ORDER_IDS, parseDeliveredInReviewOrderIds } from "../lib/delivered-in-review";
import type { ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "../lib/production-types";

function order(canonicalId: string, requiresDelivery = true) {
  return { canonicalId, origin: "menu_planning", requiresDelivery, lines: [{ canonicalId: `${canonicalId}:line:1` }] } as unknown as ProductionOrder;
}

function plan(orderId: string, status: ProductionPlan["status"] = "planning") {
  return { id: `production-plan:${orderId}`, orderId, status, menuItems: [{ id: `${orderId}:menu`, sourceLineId: `${orderId}:line:1`, name: "Dish", note: "", subItems: [{ id: `${orderId}:sub`, name: "Dish", quantity: 1, allergens: {}, note: "", evidenceStatus: "completed" }] }], updatedAt: "2026-08-29T10:00:00.000Z", updatedBy: "test", audit: [] } as unknown as ProductionPlan;
}

test("review order IDs are required, deduplicated, and bounded", () => {
  assert.deepEqual(parseDeliveredInReviewOrderIds(" known-a,known-a, known-b "), ["known-a", "known-b"]);
  assert.throws(() => parseDeliveredInReviewOrderIds(null), /order IDs are required/);
  assert.throws(() => parseDeliveredInReviewOrderIds(" , "), /order IDs are required/);
  assert.throws(() => parseDeliveredInReviewOrderIds(Array.from({ length: MAX_DELIVERED_IN_REVIEW_ORDER_IDS + 1 }, (_, index) => `id-${index}`).join(",")), /maximum/);
});

test("review status reads only visible known orders and direct plans, never list or historical records", async () => {
  const requested: string[] = [];
  let listCalls = 0;
  const historical = Array.from({ length: 500 }, (_, index) => `historical-${index}`);
  const plans = new Map([["known-a", plan("known-a", "planned")]]);
  const repository = {
    async get(orderId: string) { requested.push(`plan:${orderId}`); return plans.get(orderId); },
    async list() { listCalls += 1; return []; },
  };
  const statuses = await loadDeliveredInReviewStatuses({
    orderIds: ["known-a", "known-a", "hidden", "missing", ...historical],
    repository: repository as Pick<typeof repository, "get">,
    async loadOrder(orderId) {
      if (orderId === "hidden") return undefined;
      if (orderId === "missing" || historical.includes(orderId)) return undefined;
      return order(orderId);
    },
  });
  assert.equal(listCalls, 0);
  assert.deepEqual(statuses.map((status) => status.orderId), ["known-a"]);
  assert.deepEqual(requested, ["plan:known-a"]);
  assert.equal(statuses[0].reviewed, true);
});

test("missing visible plans return bounded pending status without loading unrelated plans", async () => {
  let getCalls = 0;
  const statuses = await loadDeliveredInReviewStatuses({
    orderIds: ["known-missing"],
    repository: { async get() { getCalls += 1; return undefined; } },
    async loadOrder(orderId) { return order(orderId); },
  });
  assert.equal(getCalls, 1);
  assert.deepEqual(statuses, [{ orderId: "known-missing", planStatus: "draft", reviewed: false, completedSourceLineIds: [], signatureRoles: [] }]);
});

test("single-order GET and Delivered In detail use direct/batch review paths", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const detail = await readFile(new URL("../app/ui/DeliveredInProductionDetail.tsx", import.meta.url), "utf8");
  assert.match(route, /if \(orderId\)/);
  assert.match(route, /getPlan\(request, orderId\)/);
  assert.match(route, /get\("reviewStatus"\) === "1"/);
  assert.match(route, /get\("matrixStatus"\) === "1"/);
  assert.match(route, /action.*batch-plan/);
  assert.doesNotMatch(route, /planRepository\.list\(\)|await loadPlans\(\)/);
  assert.match(route, /PLAN_SCOPE_REQUIRED/);
  assert.match(route, /loadDeliveredInReviewStatuses/);
  assert.doesNotMatch(detail, /orders\.map\(async item =>/);
  assert.match(detail, /reviewStatus=1&orderIds=/);
});

test("matrix hydration uses one bounded request and carries saved cells and signature roles", async () => {
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  assert.match(matrix, /matrixStatus=1&orderIds=/);
  assert.match(matrix, /matrixItems/);
  assert.match(matrix, /onSignatureRolesChange/);
  assert.doesNotMatch(matrix, /orders\.map\(async order =>/);
  assert.doesNotMatch(page, /loadSignatures/);
});
