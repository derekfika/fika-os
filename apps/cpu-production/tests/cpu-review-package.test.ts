import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCpuReviewProjection, getCpuReviewPackage, publishCpuReviewPackage, type CpuReviewProjection } from "../lib/cpu-review-package";
import type { ProductionOrder } from "../lib/production-types";
import type { ProductionPlan } from "../app/lib/production-plan";

const makeOrder = (id: string, overrides: Partial<ProductionOrder> = {}): ProductionOrder => ({
  canonicalId: id, entityType: "Production Order", schemaVersion: "0.1.0", version: 4, requirementIds: [], sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: "quote:1", serviceDate: "2026-08-31", requiredBy: "2026-08-31T11:30", serviceWindow: { startTime: "11:30" }, status: "accepted", priority: "normal", origin: "menu_planning", destinationOplocId: "oploc:angel", destinationLabel: "Angel Court", lines: [{ canonicalId: `${id}:line:1`, sourceBookingLineId: "menu-line:1", sourceMenuItemId: "dish:1", itemName: "Lunch", customerQuantity: 10, customerUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 }], exceptions: [], currentRevision: 4, createdAt: "2026-08-30T10:00:00.000Z", createdBy: "menu", idempotencyKey: id, externalReferences: [], audit: [], ...overrides,
});
const makePlan = (orderId: string, allergens: Record<string, "clear" | "contains" | "may_contain"> = { gluten: "contains" }): ProductionPlan => ({ id: `production-plan:${orderId}`, orderId, status: "planned", menuItems: [{ id: "menu:1", sourceLineId: `${orderId}:line:1`, name: "Lunch", note: "", subItems: [{ id: "sub:1", name: "Lunch", quantity: 10, allergens, mayContainNotes: "Check shared kitchen", note: "", evidenceStatus: "completed" }] }], planningNotes: "", signatures: [{ role: "production_chef", printedName: "Chef One", signedAt: "2026-08-31T09:00:00.000Z", actor: "chef:1", attestation: "checked" }, { role: "head_chef_site_manager", printedName: "Chef Two", signedAt: "2026-08-31T09:05:00.000Z", actor: "chef:2", attestation: "checked" }], updatedAt: "2026-08-31T09:05:00.000Z", updatedBy: "chef:2", audit: [{ action: "signed", at: "2026-08-31T09:05:00.000Z", by: "chef:2" }] });

test("CPU review projection uses stable OPLOC/day scope and preserves allergen semantics", () => {
  const projection = buildCpuReviewProjection("2026-08-31", "oploc:angel", [makeOrder("order:1")], [makePlan("order:1")], 2, 17, "2026-08-31T10:00:00.000Z");
  assert.equal(projection.oplocId, "oploc:angel");
  assert.equal(projection.serviceDate, "2026-08-31");
  assert.equal(projection.sourceOrders[0].entries[0].allergenState, "CONTAINS");
  assert.equal(projection.sourceOrders[0].entries[0].mayContainNotes, "Check shared kitchen");
  assert.deepEqual(projection.completedSignatureRoles.sort(), ["head_chef_site_manager", "production_chef"]);
});

test("missing plans and evidence remain explicit unknown, never clear", () => {
  const projection = buildCpuReviewProjection("2026-08-31", "oploc:angel", [makeOrder("order:missing")], [], 1, 1);
  assert.equal(projection.sourceOrders[0].reviewStatus, "missing");
  assert.equal(projection.sourceOrders[0].entries[0].allergenState, "UNRECORDED");
  assert.deepEqual(projection.sourceOrders[0].entries[0].allergens, {});
});

test("CPU review projection keeps every separately checked sub-item", () => {
  const plan = makePlan("order:multi");
  plan.menuItems[0].subItems.push({ id: "sub:2", name: "Sauce", quantity: 10, allergens: { sesame: "may_contain" }, note: "", evidenceStatus: "completed" });
  const projection = buildCpuReviewProjection("2026-08-31", "oploc:angel", [makeOrder("order:multi")], [plan]);
  assert.equal(projection.sourceOrders[0].entries.length, 2);
  assert.deepEqual(projection.sourceOrders[0].entries.map(entry => entry.sourceSubItemId), ["sub:1", "sub:2"]);
  assert.equal(projection.sourceOrders[0].entries[1].allergenState, "MAY_CONTAIN");
});

test("cancellation and supersession update the bounded review projection", () => {
  const cancelled = makeOrder("order:cancelled", { status: "cancelled" });
  const superseded = makeOrder("order:old", { supersededBy: "order:new" });
  const projection = buildCpuReviewProjection("2026-08-31", "oploc:angel", [cancelled, superseded], [], 1, 4);
  assert.deepEqual(projection.sourceOrders.map(order => order.productionOrderId), ["order:cancelled"]);
});

test("review package publication is content-addressed and older change sequences cannot advance it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fika-cpu-review-package-"));
  const previous = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    const current = buildCpuReviewProjection("2026-08-31", "oploc:angel", [makeOrder("order:1")], [makePlan("order:1")], 1, 20);
    const older = { ...current, revision: 99, lastChangeSequence: 19 } satisfies CpuReviewProjection;
    const first = await publishCpuReviewPackage(current);
    const second = await publishCpuReviewPackage(older);
    assert.equal(first.packageVersion, 1);
    assert.equal(second.packageVersion, 1);
    const retrieved = await getCpuReviewPackage("2026-08-31", "oploc:angel");
    assert.equal(retrieved?.manifest.sourceVersion, "cpu-change-20");
    assert.deepEqual(retrieved?.value.projection, current);
    const manifest = JSON.parse(await readFile(path.join(root, "manifests", "cpu-production_review_oploc%3Aangel_2026-08-31.json"), "utf8"));
    assert.equal(manifest.packageVersion, 1);
  } finally {
    if (previous === undefined) delete process.env.FIKA_SNAPSHOT_DIR;
    else process.env.FIKA_SNAPSHOT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("review route keeps compatibility while package path precedes source reconstruction", async () => {
  const route = await readFile(new URL("../app/api/delivered-in/review/route.ts", import.meta.url), "utf8");
  const packageBranch = route.slice(route.indexOf("const reconcile"));
  assert.match(route, /requireCpuActor\(request\)/);
  assert.match(route, /status: signed \? "signed" : "pending"/);
  assert.ok(packageBranch.indexOf("getCpuReviewPackage") < packageBranch.indexOf("productionQueue(request, serviceDate)"));
  assert.match(route, /reconcile=|searchParams\.get\("reconcile"\)/);
});
