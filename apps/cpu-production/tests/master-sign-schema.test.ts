import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { PlannedMenuItem } from "../app/lib/production-plan";
import { buildCpuReviewProjection } from "../lib/cpu-review-package";
import { normaliseOperationalAllergens } from "../../shared/allergen-contract";
import type { ProductionOrder } from "../lib/production-types";
import { MasterSignCommand } from "../lib/production-plan-command-schema";

process.env.FIKA_CPU_PLAN_STORE = "memory";
const { POST } = await import("../app/api/production-plan/route");

const serviceDate = "2026-09-14";
const orderId = "production-order:menu:test";
const lineId = "production-line:menu:test";
const sourceOrder = {
  canonicalId: orderId,
  version: 1,
  origin: "menu_planning",
  destinationOplocId: "oploc:test",
  serviceDate,
  requiredBy: `${serviceDate}T12:00:00.000Z`,
  currentRevision: 1,
  signatures: [],
  lines: [{ canonicalId: lineId, sourceBookingLineId: "menu-line:test", sourceMenuItemId: "dish:test", itemName: "Test dish", customerQuantity: 1, customerUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 }],
} as unknown as ProductionOrder;

function payload() {
  const menuItems: PlannedMenuItem[] = [{
    id: "menu-item:test",
    sourceLineId: lineId,
    name: "Test dish",
    note: "",
    subItems: [{ id: "sub-item:test", name: "Test dish", quantity: 1, allergens: { milk: "unrecorded" }, note: "", evidenceStatus: "completed" }],
  }];
  return {
    action: "sign-master-matrix" as const,
    serviceDate,
    role: "production_chef" as const,
    printedName: "Production Chef",
    attestation: "I reviewed the complete service-date matrix and the recorded evidence is accurate.",
    signatureDataUrl: "data:image/png;base64,c2lnbmF0dXJl",
    orderIds: [orderId],
    expectedLineages: [{ productionOrderId: orderId, serviceDate, sourceDayId: "source-day:test", sourcePublicationId: "publication:test", sourcePublicationDayId: "publication-day:test", sourceVersion: 1, sourceContentHash: "a".repeat(64), matrixContentHash: "b".repeat(64) }],
    reviewOperations: [{ action: "mark-planned" as const, orderId, planningNotes: "CPU Delivered-In allergen review", menuItems }],
    commandId: "cpu-master-sign:test",
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function withProductionStub(run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousRuntime = process.env.FIKA_RUNTIME_MODE;
  process.env.FIKA_RUNTIME_MODE = "local";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/production?serviceDate=")) return new Response(JSON.stringify({ orders: [sourceOrder] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/production?canonicalId=")) return new Response(JSON.stringify({ order: sourceOrder }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected test fetch: ${url}`);
  };
  try { await run(); } finally {
    globalThis.fetch = previousFetch;
    if (previousRuntime === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousRuntime;
  }
}

test("master-sign schema accepts unrecorded and reaches the authoritative handler", async () => withProductionStub(async () => {
  const command = MasterSignCommand.parse(payload());
  assert.equal(command.reviewOperations[0].menuItems[0].subItems[0].allergens.milk, "unrecorded");
  const response = await POST(request(payload()));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.match(body.error.message, /not available for signing/);
  assert.notEqual(body.error.message, "Some booking information was incomplete. Refresh the page and try again.");
}));

test("invalid master-sign allergen state is still rejected with a safe field path", async () => withProductionStub(async () => {
  const invalid = payload() as Record<string, unknown>;
  const operations = invalid.reviewOperations as Array<Record<string, unknown>>;
  const menuItems = (operations[0].menuItems as Array<Record<string, unknown>>);
  const subItems = menuItems[0].subItems as Array<Record<string, unknown>>;
  subItems[0].allergens = { milk: "not-a-state" };
  const response = await POST(request(invalid));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "INVALID_REQUEST");
  assert.equal(body.error.message, "Some booking information was incomplete. Refresh the page and try again.");
  assert.ok(body.error.details.issues.some((issue: { path: unknown[] }) => issue.path.join(".") === "reviewOperations.0.menuItems.0.subItems.0.allergens.milk"));
}));

test("unrecorded remains unrecorded and downstream CPU review remains fail-closed", () => {
  const normalised = normaliseOperationalAllergens({ milk: "unrecorded" });
  assert.equal(normalised.milk, "unrecorded");
  const plan = { id: `production-plan:${orderId}`, orderId, menuItems: payload().reviewOperations[0].menuItems, status: "planned", audit: [] } as never;
  const review = buildCpuReviewProjection(serviceDate, "oploc:test", [sourceOrder], [plan]);
  assert.equal(review.sourceOrders[0].entries[0].allergenState, "UNRECORDED");
});
