import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { cpuMasterSignatureAuthority, cpuPostCommitRosterMatchesJob, processCpuPostCommitJob } from "../lib/cpu-post-commit-worker";
import { allergenMatrixContentHash, buildCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { cpuMasterReviewId } from "../lib/cpu-master-review";
import { matrixSignatureScope, type ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "../lib/production-types";

const items: ProductionPlan["menuItems"] = [];
const order = (canonicalId: string): ProductionOrder => ({
  canonicalId, entityType: "Production Order", schemaVersion: "1", version: 1, requirementIds: [],
  sourceBookingId: "booking:master", sourceQuoteRevisionId: "quote:master", sourceEntityId: "source-day:master",
  sourcePublicationId: "publication:master", sourcePublicationDayId: "publication-day:master", sourceVersion: 1,
  sourceContentHash: "a".repeat(64), destinationOplocId: `oploc:${canonicalId}`, serviceDate: "2026-11-26",
  requiredBy: "2026-11-26T12:00:00.000Z", serviceWindow: { startTime: "12:00" }, status: "planned", priority: "normal",
  lines: [{ sourceMenuItemId: "menu-item:source", sourceBookingLineId: `booking-line:${canonicalId}`, allergenEvidenceStatus: "confirmed", approvedAllergenSnapshot: { allergenEvidenceHash: "c".repeat(64), allergenEvidenceComplete: true, allergenEvidenceStatus: "confirmed" } } as ProductionOrder["lines"][number]], exceptions: [], origin: "menu_planning", currentRevision: 1, createdAt: "2026-11-26T08:00:00.000Z",
  createdBy: "menu-planning", idempotencyKey: canonicalId, externalReferences: [], audit: [],
});

function signedPlan(sourceOrder: ProductionOrder): ProductionPlan {
  const scope = matrixSignatureScope(sourceOrder, allergenMatrixContentHash(items))!;
  const signatures = [
    { role: "production_chef" as const, printedName: "Production Chef", signedAt: "2026-11-26T08:00:00.000Z", actor: "test:chef", attestation: "Reviewed the matrix.", scope },
    { role: "head_chef_site_manager" as const, printedName: "Head Chef", signedAt: "2026-11-26T08:01:00.000Z", actor: "test:manager", attestation: "Approved the matrix.", scope },
  ];
  const release = buildCpuAllergenRelease({
    serviceDate: scope.serviceDate, sourceOrigin: "menu_planning", sourceDayId: scope.sourceDayId,
    sourcePublicationId: scope.sourcePublicationId, sourcePublicationDayId: scope.sourcePublicationDayId,
    sourceVersion: scope.sourceVersion, sourceContentHash: scope.sourceContentHash, allergenEvidenceHash: scope.allergenEvidenceHash, version: 1,
    signedAt: signatures[1].signedAt, signatures, items,
    masterArtifact: { id: "pending-master", bookingId: sourceOrder.sourceBookingId, fileName: "pending.pdf", createdAt: signatures[1].signedAt, createdBy: "test", contentHash: "b".repeat(64), pdfStatus: "unavailable", driveStatus: "not_configured" },
    derivedArtifacts: [], packetArtifacts: [], status: "pending",
  });
  const plan: ProductionPlan = {
    id: `production-plan:${sourceOrder.canonicalId}`, orderId: sourceOrder.canonicalId, status: "planned",
    menuItems: structuredClone(items), planningNotes: "", signatures, signedMenuContentHash: scope.matrixContentHash,
    currentAllergenRelease: release, updatedAt: "2026-11-26T08:01:00.000Z", updatedBy: "test:manager", audit: [],
  };
  const identity = cpuMasterSignatureAuthority([sourceOrder], new Map([[sourceOrder.canonicalId, plan]]));
  plan.masterReviewId = cpuMasterReviewId({ serviceDate: scope.serviceDate, members: identity.members });
  return plan;
}

test("first-role post-commit remains pending without a frozen release", () => {
  const sourceOrder = order("order:first-role");
  const plan = signedPlan(sourceOrder);
  plan.currentAllergenRelease = undefined;
  plan.signatures = plan.signatures?.slice(0, 1);
  const authority = cpuMasterSignatureAuthority([sourceOrder], new Map([[sourceOrder.canonicalId, plan]]));

  assert.equal(authority.signaturesComplete, false);
  assert.deepEqual(authority.signedPlans, []);
  assert.deepEqual(authority.signatureRoles[sourceOrder.canonicalId], ["production_chef"]);
});

test("an invalid later member cannot turn a valid earlier member into a partial signed master", () => {
  const firstOrder = order("order:first");
  const secondOrder = order("order:second");
  const firstPlan = signedPlan(firstOrder);
  const secondPlan = signedPlan(secondOrder);
  secondPlan.currentAllergenRelease!.signatures = secondPlan.currentAllergenRelease!.signatures.slice(0, 1);

  const authority = cpuMasterSignatureAuthority([firstOrder, secondOrder], new Map([[firstOrder.canonicalId, firstPlan], [secondOrder.canonicalId, secondPlan]]));
  assert.equal(authority.signaturesComplete, false);
  assert.deepEqual(authority.signedPlans, []);
  assert.deepEqual(authority.signatureRoles[firstOrder.canonicalId], ["production_chef", "head_chef_site_manager"]);
  assert.deepEqual(authority.signatureRoles[secondOrder.canonicalId], []);
});

test("mutable plan signatures cannot authorize or erase the frozen release roles", () => {
  const sourceOrder = order("order:frozen");
  const plan = signedPlan(sourceOrder);
  plan.signatures = plan.signatures?.slice(0, 1);

  const authority = cpuMasterSignatureAuthority([sourceOrder], new Map([[sourceOrder.canonicalId, plan]]));
  assert.equal(authority.signaturesComplete, true);
  assert.equal(authority.signedPlans.length, 1);
  assert.deepEqual(authority.signatureRoles[sourceOrder.canonicalId], ["production_chef", "head_chef_site_manager"]);
});

test("master review lineage comes from canonical order and matrix scope, not mutable signatures", () => {
  const sourceOrder = order("order:lineage");
  const plan = signedPlan(sourceOrder);
  const expectedScope = matrixSignatureScope(sourceOrder, allergenMatrixContentHash(plan.menuItems))!;
  const authority = cpuMasterSignatureAuthority([sourceOrder], new Map([[sourceOrder.canonicalId, plan]]));
  const expectedMember = {
    orderId: sourceOrder.canonicalId, sourceDayId: expectedScope.sourceDayId,
    sourcePublicationId: expectedScope.sourcePublicationId, sourcePublicationDayId: expectedScope.sourcePublicationDayId,
    sourceVersion: expectedScope.sourceVersion, sourceContentHash: expectedScope.sourceContentHash,
    matrixContentHash: expectedScope.matrixContentHash,
  };
  assert.deepEqual(authority.members, [expectedMember]);
  const beforeMutation = cpuMasterReviewId({ serviceDate: sourceOrder.serviceDate!, members: authority.members });
  plan.signatures = [];
  const afterMutation = cpuMasterSignatureAuthority([sourceOrder], new Map([[sourceOrder.canonicalId, plan]]));
  assert.deepEqual(afterMutation.members, [expectedMember]);
  assert.equal(beforeMutation, cpuMasterReviewId({ serviceDate: sourceOrder.serviceDate!, members: afterMutation.members }));
});

test("master post-commit requires an exact current roster in both directions", () => {
  const first = order("order:first");
  const second = order("order:second");
  const newlyActive = order("order:new");
  assert.equal(cpuPostCommitRosterMatchesJob([first, second], [second.canonicalId, first.canonicalId]), true);
  assert.equal(cpuPostCommitRosterMatchesJob([first], [first.canonicalId, second.canonicalId]), false, "a withdrawn or missing requested order blocks the stale job");
  assert.equal(cpuPostCommitRosterMatchesJob([first, second, newlyActive], [first.canonicalId, second.canonicalId]), false, "a newly active service-date order blocks a partial master");
  assert.equal(cpuPostCommitRosterMatchesJob([first, second], [first.canonicalId, first.canonicalId]), false, "duplicate job members are invalid");
});

test("actual worker rejects a stale roster before loading plans or recording a review", async () => {
  const first = order("order:first");
  const second = order("order:second");
  let planReads = 0;
  let reviewWrites = 0;
  const job = { action: "master-sign" as const, commandId: "master-sign:stale", serviceDate: "2026-11-26", orderIds: [first.canonicalId, second.canonicalId] };
  await assert.rejects(() => processCpuPostCommitJob(new NextRequest("http://localhost/api/internal/cpu-post-commit"), job, {
    productionQueue: async () => [first],
    loadPlansForOrders: async () => { planReads += 1; return []; },
    saveCpuMasterReview: async review => { reviewWrites += 1; return review; },
  }), { code: "CPU_MASTER_REVIEW_LINEAGE_CONFLICT" });
  assert.equal(planReads, 0);
  assert.equal(reviewWrites, 0);
});

test("actual worker rejects an invalid frozen member before recording or dispatching work", async () => {
  const firstOrder = order("order:first");
  const secondOrder = order("order:second");
  const firstPlan = signedPlan(firstOrder);
  const secondPlan = signedPlan(secondOrder);
  secondPlan.currentAllergenRelease!.signatures = secondPlan.currentAllergenRelease!.signatures.slice(0, 1);
  const planMap = new Map([[firstOrder.canonicalId, firstPlan], [secondOrder.canonicalId, secondPlan]]);
  const identity = cpuMasterSignatureAuthority([firstOrder, secondOrder], planMap);
  const reviewId = cpuMasterReviewId({ serviceDate: "2026-11-26", members: identity.members });
  firstPlan.masterReviewId = reviewId;
  secondPlan.masterReviewId = reviewId;
  let reviewWrites = 0;
  const job = { action: "master-sign" as const, commandId: "master-sign:corrupt", serviceDate: "2026-11-26", orderIds: [firstOrder.canonicalId, secondOrder.canonicalId] };
  await assert.rejects(() => processCpuPostCommitJob(new NextRequest("http://localhost/api/internal/cpu-post-commit"), job, {
    productionQueue: async () => [firstOrder, secondOrder],
    loadPlansForOrders: async () => [...planMap.values()],
    saveCpuMasterReview: async review => { reviewWrites += 1; return review; },
  }), { code: "CPU_MASTER_REVIEW_LINEAGE_CONFLICT" });
  assert.equal(reviewWrites, 0);
});
