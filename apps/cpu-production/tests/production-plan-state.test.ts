import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import test from "node:test";
import { effectiveProductionPlanStatus, isProductionPlanMatrixComplete, mergeMissingProductionOrderLines, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "../lib/production-types";
import { CANONICAL_ALLERGEN_KEYS, type CanonicalAllergenMap } from "../../shared/allergen-contract";

process.env.FIKA_CPU_PLAN_STORE = "memory";

const allClear = (): CanonicalAllergenMap => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map((key) => [key, "clear"])) as CanonicalAllergenMap;
const row = (id: string, complete = true): PlannedMenuItem => ({
  id: `menu:${id}`,
  sourceLineId: `line:${id}`,
  name: complete ? `Dish ${id}` : "",
  note: "",
  subItems: [{ id: `sub:${id}`, name: complete ? `Dish ${id}` : "", quantity: 1, allergens: complete ? allClear() : {}, note: "", evidenceStatus: complete ? "completed" : "not_completed" }],
});
const unsignedPlan = (menuItems: PlannedMenuItem[]): ProductionPlan => ({ id: "plan:state", orderId: "order:state", status: "planned", menuItems, planningNotes: "", updatedAt: "2026-09-17T09:00:00.000Z", updatedBy: "test", audit: [] });
const sourceLines = [{ canonicalId: "line:existing", itemName: "Existing dish", customerQuantity: 1 }, { canonicalId: "line:new", itemName: "New dish", customerQuantity: 1 }];

test("planned unsigned plan with a newly merged incomplete source row is effectively planning", () => {
  const original = unsignedPlan([row("existing")]);
  const before = structuredClone(original);
  const merged = mergeMissingProductionOrderLines(original, "order:state", sourceLines);
  assert.equal(merged.status, "planning");
  assert.equal(merged.menuItems.length, 2);
  assert.equal(isProductionPlanMatrixComplete(merged.menuItems), false);
  assert.deepEqual(original, before);
});

test("planned complete matrices remain planned while signed incomplete matrices remain planning and locked", () => {
  const complete = unsignedPlan([row("existing")]);
  assert.equal(effectiveProductionPlanStatus(complete), "planned");
  const signedIncomplete = { ...unsignedPlan([row("existing", false)]), signatures: [{ role: "production_chef", printedName: "Chef", signedAt: "2026-09-17T09:00:00.000Z", actor: "test", attestation: "reviewed" }] } as never;
  assert.equal(effectiveProductionPlanStatus(signedIncomplete), "planning");
});

test("CPU server rejects marking an actually incomplete matrix Planned", async () => {
  const previousRuntime = process.env.FIKA_RUNTIME_MODE;
  const previousFetch = globalThis.fetch;
  process.env.FIKA_RUNTIME_MODE = "local";
  const order = { canonicalId: "production-order:state", version: 1, origin: "menu_planning", serviceDate: "2026-09-17", requiredBy: "2026-09-17T12:00:00.000Z", lines: [{ canonicalId: "line:state", itemName: "State dish", customerQuantity: 1 }], exceptions: [] } as unknown as ProductionOrder;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order }), { status: 200 });
    if (url.includes("/api/production?serviceDate=")) return new Response(JSON.stringify({ orders: [order] }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url}`);
  };
  try {
    const { POST } = await import("../app/api/production-plan/route");
    const incomplete = row("state");
    incomplete.subItems[0].allergens = { milk: "clear" };
    const response = await POST(new NextRequest("http://localhost/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark-planned", orderId: order.canonicalId, planningNotes: "", menuItems: [incomplete] }) }));
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error.message, /Record every allergen state/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRuntime === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousRuntime;
  }
});

test("Hospitality detail enables completion only for an unlocked row and auto-plans the final complete row", async () => {
  const detail = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /disabled=\{busy \|\| reviewLockedByAuthority \|\| sub\.evidenceStatus === "completed"\}/);
  assert.doesNotMatch(detail, /if \(planStatus === "planned"\) return/);
  assert.match(detail, /const allComplete = [\s\S]*isCompleteOperationalAllergenMap\(candidate\.allergens\)/);
  assert.match(detail, /if \(allComplete\) void planCommand\("mark-planned", \{\}, nextItems\)/);
});

test("signed matrix amendments retain the explicit reopen requirement", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(route, /hasAllergenAuthority\(plan\) && !allergenAuthorityMatchesOrder\(plan, order, reviewedPlan\.menuItems\)/);
  assert.match(route, /planHasAllergenAuthority && !authorityMatches/);
  assert.match(route, /CPU_REVIEW_REOPEN_REQUIRED/);
});
