import assert from "node:assert/strict";
import test from "node:test";
import { allergenMatrixContentHash } from "../lib/cpu-allergen-release";
import { buildCpuReviewProjection } from "../lib/cpu-review-package";
import type { ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "../lib/production-types";

const sourcePublicationId = "menu-publication:current";
const order = { canonicalId: "production:current", origin: "menu_planning", destinationOplocId: "oploc:site", serviceDate: "2026-09-07", requiredBy: "2026-09-07T12:00:00Z", version: 3, currentRevision: 4, sourceEntityId: "menu-day:current", sourcePublicationId, sourcePublicationDayId: "menu-publication-day:current:v3", sourceVersion: 3, sourceContentHash: "a".repeat(64), lines: [{ canonicalId: "line:1", sourceBookingLineId: "booking-line:1" }] } as unknown as ProductionOrder;
const items = [{ id: "dish:1", name: "Salad", note: "", sourceLineId: "line:1", subItems: [{ id: "sub:1", name: "Salad", quantity: 1, allergens: { milk: "clear" }, note: "", evidenceStatus: "completed" }] }];
const plan = (scopeHash: string) => ({ id: "production-plan:current", orderId: order.canonicalId, status: "planned", menuItems: items, signatures: [{ role: "production_chef", printedName: "Chef", signedAt: "2026-09-07T08:00:00Z", actor: "chef", attestation: "reviewed", scope: { productionOrderId: order.canonicalId, serviceDate: order.serviceDate, sourceDayId: order.sourceEntityId, sourcePublicationId, sourcePublicationDayId: order.sourcePublicationDayId, sourceVersion: order.sourceVersion, sourceContentHash: order.sourceContentHash, matrixContentHash: scopeHash } }, { role: "head_chef_site_manager", printedName: "Manager", signedAt: "2026-09-07T08:01:00Z", actor: "manager", attestation: "reviewed", scope: { productionOrderId: order.canonicalId, serviceDate: order.serviceDate, sourceDayId: order.sourceEntityId, sourcePublicationId, sourcePublicationDayId: order.sourcePublicationDayId, sourceVersion: order.sourceVersion, sourceContentHash: order.sourceContentHash, matrixContentHash: scopeHash } }], updatedAt: "2026-09-07T08:02:00Z", updatedBy: "chef", audit: [] }) as unknown as ProductionPlan;

test("review package does not treat signatures from another matrix hash as current", () => {
  const current = buildCpuReviewProjection(order.serviceDate!, order.destinationOplocId!, [order], [plan("b".repeat(64))]);
  assert.equal(current.sourceOrders[0].reviewStatus, "pending");
  assert.deepEqual(current.completedSignatureRoles, []);
  const valid = buildCpuReviewProjection(order.serviceDate!, order.destinationOplocId!, [order], [plan(allergenMatrixContentHash(items as never))]);
  assert.equal(valid.sourceOrders[0].reviewStatus, "signed");
  assert.deepEqual(valid.completedSignatureRoles, ["production_chef", "head_chef_site_manager"]);
  assert.equal(valid.sourceLineage[0].sourcePublicationDayId, order.sourcePublicationDayId);
});
