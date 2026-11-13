import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionOrder } from "../lib/production-types";
import { allergenMatrixContentHash, buildCpuAllergenRelease, revokeCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { matrixSignatureScope, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
import { signedAllergenDocumentForOrder } from "../app/lib/signed-allergen-document";

const items: PlannedMenuItem[] = [{ id: "item:1", name: "Soup", note: "", subItems: [{ id: "sub:1", name: "Soup", quantity: 1, allergens: { milk: "clear" }, note: "", evidenceStatus: "completed" }] }];
const order = (overrides: Partial<ProductionOrder> = {}) => ({ canonicalId: "order:1", origin: "menu_planning", sourceBookingId: "booking:1", sourceQuoteRevisionId: "quote:1", currentRevision: 3, serviceDate: "2026-11-13", requiredBy: "2026-11-13T11:00:00Z", sourceEntityId: "day:1", sourcePublicationId: "publication:1", sourcePublicationDayId: "publication-day:1", sourceVersion: 3, sourceContentHash: "c".repeat(64), destinationOplocId: "oploc:one", status: "planned", ...overrides } as unknown as ProductionOrder);
const file = (id: string, fileName = "signed.pdf") => ({ id, bookingId: "booking:1", fileName, createdAt: "2026-11-13T09:00:00Z", createdBy: "chef", contentHash: "a".repeat(64), pdfStatus: "generated" as const, driveFileId: "drive_file_1", driveStatus: "saved" as const });
function planFor(sourceOrder = order(), status: "pending" | "current" = "current", materializationStatus: "pending" | "ready" | "failed" = "ready") {
  const scope = matrixSignatureScope(sourceOrder, allergenMatrixContentHash(items))!;
  const signatures = (["production_chef", "head_chef_site_manager"] as const).map(role => ({ role, printedName: role, signedAt: "2026-11-13T09:00:00Z", actor: "chef", attestation: "Reviewed current matrix.", scope, valid: true }));
  const masterArtifact = { ...file("artifact:master"), bookingId: sourceOrder.sourceBookingId! };
  const siteArtifact = { ...file("artifact:site"), bookingId: sourceOrder.sourceBookingId! };
  const release = buildCpuAllergenRelease({ ...scope, version: 1, signedAt: "2026-11-13T09:00:00Z", signatures, items, masterArtifact, derivedArtifacts: [siteArtifact], packetArtifacts: [], status });
  const currentRelease = { ...release, materializationStatus } as typeof release;
  const plan = { id: `plan:${sourceOrder.canonicalId}`, orderId: sourceOrder.canonicalId, status: "planned", menuItems: items, planningNotes: "", signatures, signedMenuContentHash: scope.matrixContentHash, matrixArtifact: siteArtifact, masterMatrixArtifact: masterArtifact, currentAllergenRelease: currentRelease, updatedAt: "2026-11-13T09:00:00Z", updatedBy: "chef", audit: [] } as unknown as ProductionPlan;
  return { plan, release, masterArtifact, siteArtifact };
}

test("only a current, lineage-matched dual-signed release exposes its exact existing OPLOC PDF", () => {
  const sourceOrder = order();
  const { plan, siteArtifact } = planFor(sourceOrder);
  const result = signedAllergenDocumentForOrder(plan, sourceOrder);
  assert.equal(result.state, "ready");
  assert.equal(result.artifact?.id, siteArtifact.id);
  assert.equal(result.artifact?.driveFileId, "drive_file_1");
});

test("Ad-Hoc uses its existing master PDF and never needs a site-derived artifact", () => {
  const sourceOrder = order({ canonicalId: "production-order:v1:ad-hoc:request-1", origin: "cpu_created", sourceBookingId: "request-1", sourceEntityId: "request-1", destinationOplocId: undefined } as Partial<ProductionOrder>);
  const { plan, masterArtifact } = planFor(sourceOrder);
  plan.matrixArtifact = undefined;
  const result = signedAllergenDocumentForOrder(plan, sourceOrder);
  assert.equal(result.state, "ready");
  assert.equal(result.artifact?.id, masterArtifact.id);
});

test("Hospitality uses its exact current OPLOC release PDF", () => {
  const sourceOrder = order({ canonicalId: "hospitality:order:1", origin: "hospitality_booking", sourceEntityId: undefined, sourcePublicationId: undefined, sourcePublicationDayId: undefined });
  const { plan, siteArtifact } = planFor(sourceOrder);
  const result = signedAllergenDocumentForOrder(plan, sourceOrder);
  assert.equal(result.state, "ready");
  assert.equal(result.artifact?.id, siteArtifact.id);
  assert.equal(result.artifact?.bookingId, "booking:1");
});

test("Delivered-In uses the exact current approved destination release PDF", () => {
  const sourceOrder = order({ canonicalId: "delivered-in:order:1", productionCategory: "delivered_in" });
  const { plan, siteArtifact } = planFor(sourceOrder);
  const result = signedAllergenDocumentForOrder(plan, sourceOrder);
  assert.equal(result.state, "ready");
  assert.equal(result.artifact?.id, siteArtifact.id);
  assert.equal(result.artifact?.bookingId, "booking:1");
});

test("unsigned, pending, failed, revoked and stale documents remain unavailable with distinct states", () => {
  const sourceOrder = order();
  assert.equal(signedAllergenDocumentForOrder(undefined, sourceOrder).state, "unsigned");
  const incomplete = planFor(sourceOrder);
  incomplete.plan.currentAllergenRelease!.signatures = incomplete.plan.currentAllergenRelease!.signatures.filter(signature => signature.role === "production_chef");
  assert.equal(signedAllergenDocumentForOrder(incomplete.plan, sourceOrder).state, "unsigned", "both applicable signatures are required");
  assert.equal(signedAllergenDocumentForOrder(planFor(sourceOrder, "pending", "pending").plan, sourceOrder).state, "pending");
  assert.equal(signedAllergenDocumentForOrder(planFor(sourceOrder, "current", "failed").plan, sourceOrder).state, "failed");
  const current = planFor(sourceOrder);
  current.plan.currentAllergenRelease = revokeCpuAllergenRelease(current.release, { at: "2026-11-13T10:00:00Z", by: "chef", reason: "Amended" });
  assert.equal(signedAllergenDocumentForOrder(current.plan, sourceOrder).state, "revoked");
  const stale = planFor(sourceOrder);
  assert.equal(signedAllergenDocumentForOrder(stale.plan, order({ sourceVersion: 4 })).state, "stale");
});

test("missing or invalid existing artifacts never create a replacement PDF", () => {
  const sourceOrder = order();
  const missing = planFor(sourceOrder);
  missing.plan.matrixArtifact = undefined;
  assert.equal(signedAllergenDocumentForOrder(missing.plan, sourceOrder).state, "unavailable");
  const invalid = planFor(sourceOrder);
  invalid.plan.matrixArtifact = { ...invalid.siteArtifact, driveFileId: "bad/file" };
  invalid.plan.currentAllergenRelease!.derivedArtifacts = [{ ...invalid.siteArtifact, driveFileId: "bad/file" }];
  assert.equal(signedAllergenDocumentForOrder(invalid.plan, sourceOrder).state, "unavailable");
});
