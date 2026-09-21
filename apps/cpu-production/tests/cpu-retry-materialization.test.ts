import assert from "node:assert/strict";
import test from "node:test";
import { retryCommittedCpuMaterialization } from "../lib/cpu-retry-materialization";
import { matrixSignatureScope, type ProductionPlan } from "../app/lib/production-plan";
import { allergenMatrixContentHash, buildCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { cpuReleaseMaterializationEventId } from "../lib/cpu-release-fanout";
import type { deliverCpuPropagation } from "../lib/cpu-durable-outbox";
import type { ProductionOrder } from "../lib/production-types";

const order = {
  canonicalId: "production-order:haleon",
  entityType: "Production Order",
  schemaVersion: "1",
  version: 3,
  requirementIds: [],
  sourceBookingId: "booking:haleon",
  sourceQuoteRevisionId: "quote:haleon",
  sourceEntityId: "publication-day:2026-09-14",
  sourcePublicationId: "publication:2026-09-14",
  sourcePublicationDayId: "publication-day:2026-09-14",
  sourceVersion: 8,
  sourceContentHash: "b".repeat(64),
  destinationOplocId: "oploc:haleon",
  destinationLabel: "Haleon",
  serviceDate: "2026-09-14",
  requiredBy: "2026-09-14T12:00:00.000Z",
  serviceWindow: { startTime: "12:00" },
  status: "planned",
  priority: "normal",
  lines: [],
  exceptions: [],
  origin: "menu_planning",
  currentRevision: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "menu-planning",
  idempotencyKey: "order:haleon",
  externalReferences: [],
  audit: [],
} as unknown as ProductionOrder;

const menuItems = [{
  id: "menu-item:1",
  name: "Dish",
  note: "",
  subItems: [{ id: "sub-item:1", name: "Dish", quantity: 1, allergens: {}, note: "", evidenceStatus: "completed" as const }],
}];
const scope = matrixSignatureScope(order, allergenMatrixContentHash(menuItems))!;
const signatures = [
  { role: "production_chef" as const, printedName: "Production Chef", signedAt: "2026-09-14T08:00:00.000Z", actor: "chef", attestation: "Reviewed the matrix.", scope },
  { role: "head_chef_site_manager" as const, printedName: "Head Chef", signedAt: "2026-09-14T08:01:00.000Z", actor: "head", attestation: "Approved the matrix.", scope },
];

function planWithRelease(materializationStatus: "pending" | "ready" = "pending") {
  const release = buildCpuAllergenRelease({
    serviceDate: scope.serviceDate,
    sourceDayId: scope.sourceDayId,
    sourcePublicationId: scope.sourcePublicationId,
    sourcePublicationDayId: scope.sourcePublicationDayId,
    sourceVersion: scope.sourceVersion,
    sourceContentHash: scope.sourceContentHash,
    version: 1,
    signedAt: "2026-09-14T08:01:00.000Z",
    signatures,
    items: menuItems,
    masterArtifact: { id: "pending-master", bookingId: order.sourceBookingId, fileName: "pending.pdf", createdAt: "2026-09-14T08:01:00.000Z", createdBy: "chef", contentHash: "c".repeat(64), pdfStatus: "unavailable", driveStatus: "not_configured" },
    derivedArtifacts: [],
    packetArtifacts: [],
    status: "pending",
  });
  if (materializationStatus === "ready") {
    release.status = "current";
    release.materializationStatus = "ready";
  }
  return {
    id: "production-plan:production-order:haleon",
    orderId: order.canonicalId,
    status: "planned" as const,
    menuItems,
    planningNotes: "",
    signatures,
    signedMenuContentHash: scope.matrixContentHash,
    signedSignatures: signatures,
    currentAllergenRelease: release,
    updatedAt: "2026-09-14T08:02:00.000Z",
    updatedBy: "chef",
    audit: [{ action: "allergen-matrix-signature-complete", at: "2026-09-14T08:01:00.000Z", by: "head" }],
  } satisfies ProductionPlan;
}

test("retry-materialization replays the existing event without mutating the ProductionPlan", async () => {
  const plan = planWithRelease();
  const beforeUpdatedAt = plan.updatedAt;
  const beforeAudit = structuredClone(plan.audit);
  const calls: string[] = [];
  const eventId = cpuReleaseMaterializationEventId(plan.currentAllergenRelease!.releaseId, order);
  const result = await retryCommittedCpuMaterialization({ plan, order, expectedLineage: scope, timestamp: "2026-09-14T08:03:00.000Z" }, {
    replay: async id => { calls.push(`replay:${id}`); return undefined; },
    deliver: async id => { calls.push(`deliver:${id}`); return { eventId: id, status: "delivered" as const, attempts: 1 }; },
    loadPlan: async () => plan,
  });
  assert.deepEqual(calls, [`replay:${eventId}`, `deliver:${eventId}`]);
  assert.equal(result.materializationDelivery.status, "delivered");
  assert.equal(plan.updatedAt, beforeUpdatedAt);
  assert.deepEqual(plan.audit, beforeAudit);
  assert.equal(plan.updatedBy, "chef");
});

test("retry-materialization reloads persisted failure state and reports failed delivery", async () => {
  const plan = planWithRelease();
  const persisted = structuredClone(plan);
  persisted.currentAllergenRelease!.materializationStatus = "failed";
  persisted.currentAllergenRelease!.materializationError = "PDF_RENDERER_ERROR: renderer unavailable";
  const result = await retryCommittedCpuMaterialization({ plan, order, expectedLineage: scope, timestamp: "2026-09-14T08:03:00.000Z" }, {
    replay: async () => undefined,
    deliver: async id => ({ eventId: id, status: "failed" as const, attempts: 1, error: "cpu-production returned HTTP 502: PDF_RENDERER_ERROR: renderer unavailable" } as Awaited<ReturnType<typeof deliverCpuPropagation>>),
    loadPlan: async () => persisted,
  });
  assert.equal(result.matrixStatus, "failed");
  assert.equal(result.materializationStatus, "failed");
  assert.equal(result.materializationError, "PDF_RENDERER_ERROR: renderer unavailable");
  assert.equal(result.plan.currentAllergenRelease?.materializationStatus, "failed");
});

test("retry-materialization rejects stale lineage before replay", async () => {
  const plan = planWithRelease();
  let calls = 0;
  await assert.rejects(() => retryCommittedCpuMaterialization({ plan, order, expectedLineage: { ...scope, sourceVersion: scope.sourceVersion + 1 }, timestamp: "2026-09-14T08:03:00.000Z" }, {
    replay: async () => { calls += 1; return undefined; },
    deliver: async id => ({ eventId: id, status: "delivered" as const, attempts: 1 }),
  }), error => (error as { status?: number; code?: string }).status === 409 && (error as { code?: string }).code === "CPU_RELEASE_LINEAGE_CONFLICT");
  assert.equal(calls, 0);
});

test("retry-materialization rejects an already current ready release without replay", async () => {
  const plan = planWithRelease("ready");
  let calls = 0;
  await assert.rejects(() => retryCommittedCpuMaterialization({ plan, order, expectedLineage: scope, timestamp: "2026-09-14T08:03:00.000Z" }, {
    replay: async () => { calls += 1; return undefined; },
    deliver: async id => ({ eventId: id, status: "delivered" as const, attempts: 1 }),
  }), error => (error as { status?: number; code?: string }).status === 409 && (error as { code?: string }).code === "CPU_RELEASE_ALREADY_CURRENT");
  assert.equal(calls, 0);
});
