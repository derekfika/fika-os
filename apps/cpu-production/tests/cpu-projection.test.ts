import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCpuDayProjection } from "../lib/cpu-projection";
import { compareMonotonicProjectionWrite, cpuProjectionContentHash } from "../lib/cpu-projection-repository";
import { cpuProjectionToOrders } from "../lib/cpu-dashboard-adapter";
import type { ProductionOrder } from "../lib/production-types";
import type { ProductionPlan } from "../app/lib/production-plan";
import { allergenMatrixContentHash } from "../lib/cpu-allergen-release";
import { CANONICAL_ALLERGEN_KEYS } from "../../shared/allergen-contract";

const order = (id: string, date = "2026-08-24"): ProductionOrder => ({
  canonicalId: id, entityType: "Production Order", schemaVersion: "0.1.0", version: 3,
  requirementIds: [], sourceBookingId: `booking:${id}`, sourceQuoteRevisionId: "quote:1",
  serviceDate: date, requiredBy: `${date}T11:30`, serviceWindow: { startTime: "11:30" },
  status: "accepted", priority: "normal", origin: "hospitality_booking", guestCount: 10,
  destinationOplocId: "oploc:angel", destinationLabel: "Angel Court", clientName: "FIKA",
  lines: [{ canonicalId: `${id}:line:1`, sourceBookingLineId: "line:1", itemName: "Lunch", customerQuantity: 10, customerUnit: "portion", productionQuantity: 10, productionUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 }],
  exceptions: [], currentRevision: 3, createdAt: "now", createdBy: "test", idempotencyKey: id, externalReferences: [], audit: [],
});

const plan = (orderId: string): ProductionPlan => ({ id: `plan:${orderId}`, orderId, status: "planned", menuItems: [{ id: `${orderId}:menu`, sourceLineId: `${orderId}:line:1`, name: "Lunch", note: "", subItems: [{ id: `${orderId}:sub:1`, name: "Lunch", quantity: 10, allergens: Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map((key) => [key, "clear"])), note: "", evidenceStatus: "completed" }] }] } as unknown as ProductionPlan);
const completePlan = (orderId: string): ProductionPlan => plan(orderId);

test("CPU projection merges canonical orders with plan workflow state", () => {
  const projection = buildCpuDayProjection("2026-08-24", [order("order:1"), order("order:2", "2026-08-25")], [completePlan("order:1")], 17);
  assert.equal(projection.orders.length, 1);
  assert.equal(projection.orders[0].workflowStatus, "planned");
  assert.equal(projection.orders[0].destinationLabel, "Angel Court");
  assert.equal(projection.lastChangeSequence, 17);
  assert.equal(projection.summary.totalUnits, 10);
});

test("CPU projection retains cancellation notices and excludes superseded work", () => {
  const cancelled = { ...order("order:cancelled"), status: "cancelled" as const };
  const superseded = { ...order("order:superseded"), supersededBy: "order:new" };
  const projection = buildCpuDayProjection("2026-08-24", [cancelled, superseded]);
  assert.equal(projection.orders.length, 1);
  assert.equal(projection.orders[0].id, "order:cancelled");
  assert.equal(projection.orders[0].status, "cancelled");
  assert.equal(projection.orders[0].cancellationNotice, "Booking cancelled in Manager dashboard.");
  assert.equal(projection.summary.orders, 1);
});

test("CPU all-day projection keeps the service date on each order", () => {
  const projection = buildCpuDayProjection("all", [order("order:1", "2026-08-24"), order("order:2", "2026-08-25")]);
  assert.deepEqual(projection.orders.map((item) => item.serviceDate), ["2026-08-24", "2026-08-25"]);
});

test("empty week projection is a valid zero-order package payload", () => {
  const projection = buildCpuDayProjection("all", [], [], 0, 1, "2026-08-31T10:00:00.000Z");
  assert.deepEqual(projection.orders, []);
  assert.deepEqual(projection.summary, { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 });
});

test("CPU projection preserves booking dietary and note context", () => {
  const source = { ...order("order:context"), bookingDietaries: { vegetarian: 3, gluten_free: 1 }, bookingNotes: "Use the side entrance.", lines: [{ ...order("order:context").lines[0], productionQuantity: 24, productionUnit: "piece", dietaries: { vegetarian: 3 }, productionInstructions: "Label each portion." }] };
  const projection = buildCpuDayProjection("2026-08-24", [source]);
  const hydrated = cpuProjectionToOrders(projection)[0];
  assert.deepEqual(projection.orders[0].bookingDietaries, { vegetarian: 3, gluten_free: 1 });
  assert.equal(projection.orders[0].bookingNotes, "Use the side entrance.");
  assert.equal(projection.orders[0].quantities[0].quantity, 10);
  assert.equal(projection.orders[0].quantities[0].productionQuantity, 24);
  assert.deepEqual(hydrated.lines[0].dietaries, { vegetarian: 3 });
  assert.equal(hydrated.lines[0].productionInstructions, "Label each portion.");
});

test("CPU projection preserves allergen review source identity and evidence", () => {
  const source = {
    ...order("order:allergen-context"),
    sourceEntityId: "menu-publication:1",
    sourcePublicationId: "publication:1",
    sourcePublicationDayId: "menu-publication-day:1",
    sourceVersion: 4,
    sourceContentHash: "sha256:menu",
    lines: [{
      ...order("order:allergen-context").lines[0],
      canonicalId: "production-line:1",
      sourceBookingLineId: "booking-line:1",
      sourceMenuItemId: "menu-item:1",
      allergenEvidenceStatus: "confirmed" as const,
      approvedAllergenSnapshot: {
        allergens: { milk: "contains" },
        mayContainNotes: "Prepared in a shared kitchen.",
        sourcePublicationDayId: "menu-publication-day:1",
        sourceVersion: 4,
        sourceContentHash: "sha256:menu",
      },
    }],
  };
  const projection = buildCpuDayProjection("2026-08-24", [source]);
  const projected = projection.orders[0];
  const hydrated = cpuProjectionToOrders(projection)[0];
  assert.equal(projected.sourceEntityId, "menu-publication:1");
  assert.equal(projected.sourcePublicationId, "publication:1");
  assert.equal(projected.sourcePublicationDayId, "menu-publication-day:1");
  assert.equal(projected.sourceVersion, 4);
  assert.equal(projected.quantities[0].sourceLineId, "production-line:1");
  assert.equal(projected.quantities[0].sourceMenuItemId, "menu-item:1");
  assert.equal(projected.quantities[0].allergenEvidenceStatus, "confirmed");
  assert.deepEqual(projected.quantities[0].approvedAllergenSnapshot, source.lines[0].approvedAllergenSnapshot);
  assert.equal(hydrated.sourcePublicationDayId, "menu-publication-day:1");
  assert.equal(hydrated.sourcePublicationId, "publication:1");
  assert.equal(hydrated.lines[0].canonicalId, "production-line:1");
  assert.equal(hydrated.lines[0].sourceMenuItemId, "menu-item:1");
  assert.deepEqual(hydrated.lines[0].approvedAllergenSnapshot, source.lines[0].approvedAllergenSnapshot);
});

test("the exact signed master review makes every participating Menu OPLOC Planned before materialization", () => {
  const sourcePublicationDayId = "menu-publication-day:shared:v1";
  const orders = ["angel", "haleon", "bridgepoint", "commerzbank"].map((site) => ({
    ...order(`order:${site}`), origin: "menu_planning" as const, destinationLabel: site, workflowStatus: "planning" as const,
    sourcePublicationDayId, sourceEntityId: "menu-publication:shared", sourceVersion: 1, sourceContentHash: "a".repeat(64),
  }));
  const signedPlanFor = (orderValue: ProductionOrder, materializationStatus: "pending" | "ready" | "failed"): ProductionPlan => {
    const reviewedItems = completePlan(orderValue.canonicalId).menuItems;
    const scope = { productionOrderId: orderValue.canonicalId, serviceDate: "2026-08-24", sourceDayId: "menu-publication:shared", sourcePublicationDayId, sourceVersion: 1, sourceContentHash: "a".repeat(64), matrixContentHash: allergenMatrixContentHash(reviewedItems) };
    const signatures = [
      { role: "production_chef" as const, printedName: "Chef A", signedAt: "now", actor: "a", attestation: "checked", scope },
      { role: "head_chef_site_manager" as const, printedName: "Chef B", signedAt: "now", actor: "b", attestation: "checked", scope },
    ];
    return { ...completePlan(orderValue.canonicalId), status: "planned", signedMenuContentHash: scope.matrixContentHash, signatures, signedSignatures: signatures, currentAllergenRelease: { status: "current", materializationStatus, serviceDate: "2026-08-24", sourceDayId: scope.sourceDayId, sourcePublicationDayId, sourceVersion: 1, sourceContentHash: scope.sourceContentHash, signatures: signatures.map(signature => ({ ...signature, valid: true })), masterArtifact: {} as never, derivedArtifacts: [], packetArtifacts: [] } as never };
  };
  const projection = buildCpuDayProjection("2026-08-24", orders, orders.map((item, index) => signedPlanFor(item, index === 0 ? "ready" : index === 1 ? "pending" : "failed")));
  assert.deepEqual(projection.orders.map(item => item.workflowStatus), ["planned", "planned", "planned", "planned"]);
});

test("CPU projection keeps an incomplete signed matrix out of Planned", () => {
  const source = { ...order("order:incomplete-signed"), origin: "menu_planning" as const, workflowStatus: "planning" as const, sourceEntityId: "menu-publication:shared", sourcePublicationDayId: "menu-publication-day:shared:v1", sourceVersion: 1, sourceContentHash: "a".repeat(64) };
  const incomplete = structuredClone(completePlan(source.canonicalId));
  incomplete.menuItems[0].subItems[0].evidenceStatus = "not_completed";
  const projection = buildCpuDayProjection("2026-08-24", [source], [{ ...incomplete, status: "planned", signatures: [{ role: "production_chef", printedName: "Chef", signedAt: "now", actor: "chef", attestation: "reviewed" }] } as unknown as ProductionPlan]);
  assert.equal(projection.orders[0].workflowStatus, "planning");
});

test("CPU projection keeps unsigned, stale, changed-hash and revoked Menu reviews out of Planned", () => {
  const sourcePublicationDayId = "menu-publication-day:shared:v1";
  const menuOrder = { ...order("order:menu"), origin: "menu_planning" as const, workflowStatus: "planning" as const, sourcePublicationDayId, sourceEntityId: "menu-publication:shared", sourceVersion: 1, sourceContentHash: "a".repeat(64) };
  const reviewedItems = completePlan(menuOrder.canonicalId).menuItems;
  const scope = { productionOrderId: menuOrder.canonicalId, serviceDate: "2026-08-24", sourceDayId: "menu-publication:shared", sourcePublicationDayId, sourceVersion: 1, sourceContentHash: "a".repeat(64), matrixContentHash: allergenMatrixContentHash(reviewedItems) };
  const signatures = [
    { role: "production_chef" as const, printedName: "Chef A", signedAt: "now", actor: "a", attestation: "checked", scope },
    { role: "head_chef_site_manager" as const, printedName: "Chef B", signedAt: "now", actor: "b", attestation: "checked", scope },
  ];
  const signed = (overrides: Partial<ProductionPlan> = {}) => ({ ...plan(menuOrder.canonicalId), status: "planned" as const, workflowStatus: undefined, signedMenuContentHash: scope.matrixContentHash, signatures, signedSignatures: signatures, currentAllergenRelease: { status: "current", materializationStatus: "failed", serviceDate: scope.serviceDate, sourceDayId: scope.sourceDayId, sourcePublicationDayId: scope.sourcePublicationDayId, sourceVersion: scope.sourceVersion, sourceContentHash: scope.sourceContentHash, signatures: signatures.map(signature => ({ ...signature, valid: true })), masterArtifact: {} as never, derivedArtifacts: [], packetArtifacts: [] } as never, ...overrides } as ProductionPlan);
  const projection = buildCpuDayProjection("2026-08-24", [menuOrder], [
    { ...signed(), signedMenuContentHash: "b".repeat(64) },
  ]);
  assert.equal(projection.orders[0].workflowStatus, "planning");
  assert.equal(buildCpuDayProjection("2026-08-24", [menuOrder], [{ ...signed(), currentAllergenRelease: { ...signed().currentAllergenRelease!, status: "revoked" } } as ProductionPlan]).orders[0].workflowStatus, "planning");
  assert.equal(buildCpuDayProjection("2026-08-24", [menuOrder], [{ ...plan(menuOrder.canonicalId), status: "planning" }]).orders[0].workflowStatus, "planning");
});

test("CPU projection compare-and-write is monotonic across independent workers", () => {
  const older = buildCpuDayProjection("2026-08-24", [order("order:older")], [], 10, 1, "2026-08-24T10:00:00.000Z");
  const newer = buildCpuDayProjection("2026-08-24", [order("order:newer")], [], 11, 1, "2026-08-24T10:01:00.000Z");
  const current = { ...newer, projectionContentHash: cpuProjectionContentHash(newer) };
  assert.equal(compareMonotonicProjectionWrite(current, older).status, "superseded");
  assert.equal(compareMonotonicProjectionWrite(undefined, newer).status, "created");
  assert.equal(compareMonotonicProjectionWrite(current, { ...newer, revision: 99, rebuiltAt: "later" }).status, "idempotent");
  assert.throws(() => compareMonotonicProjectionWrite(current, { ...newer, orders: [order("order:conflict")] }), /conflicting content/);
});
