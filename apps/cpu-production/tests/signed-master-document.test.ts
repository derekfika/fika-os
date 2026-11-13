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


import { currentSignedMasterDocument, masterReviewIdentity } from "../app/lib/signed-master-document";
import type { CpuMasterReview } from "../lib/cpu-master-review";
const date = "2026-11-13";
function masterFixture() {
  const orders = [order(), order({ canonicalId: "order:2", destinationOplocId: "oploc:two" })];
  const plans = orders.map(source => planFor(source).plan);
  const master = { ...file(`allergen-master:${date}:hash`), driveFileId: "current-master" };
  plans.forEach(plan => { plan.currentAllergenRelease!.masterArtifact = master; plan.masterMatrixArtifact = master; });
  const identity = masterReviewIdentity(date, orders, plans);
  plans.forEach(plan => plan.masterReviewId = identity.id);
  const review = { id: identity.id, serviceDate: date, orderIds: orders.map(order => order.canonicalId), status: "signed", semanticMatrixHash: identity.hash, finalization: { state: "completed" } } as CpuMasterReview;
  return { orders, plans, review };
}
test("resolves only the common date master across every current signed OPLOC release", () => { const f = masterFixture(); const result = currentSignedMasterDocument(date, f.orders, f.plans, f.review); assert.equal(result.artifact.driveFileId, "current-master"); assert.match(result.identity, /current-master/); });
test("partial, missing, unfinished, stale or wrong-date reviews never resolve", () => {
  for (const change of [(f: ReturnType<typeof masterFixture>) => f.review.status = "partial", (f: ReturnType<typeof masterFixture>) => f.review.finalization.state = "failed", (f: ReturnType<typeof masterFixture>) => f.review.orderIds.pop(), (f: ReturnType<typeof masterFixture>) => f.orders[0].sourceVersion = 4, (f: ReturnType<typeof masterFixture>) => f.orders[0].supersededBy = "new-order"]) { const f = masterFixture(); change(f); assert.throws(() => currentSignedMasterDocument(date, f.orders, f.plans, f.review)); }
  const f = masterFixture(); assert.throws(() => currentSignedMasterDocument(date, f.orders, f.plans)); assert.throws(() => currentSignedMasterDocument("2026-11-16", f.orders, f.plans, f.review));
});
test("unsigned, revoked, pending, mismatched artifacts and site PDFs remain unavailable", () => {
  for (const change of [(p: ProductionPlan) => p.currentAllergenRelease!.signatures.pop(), (p: ProductionPlan) => p.currentAllergenRelease!.signatures[0].valid = false, (p: ProductionPlan) => p.currentAllergenRelease!.status = "revoked", (p: ProductionPlan) => p.currentAllergenRelease!.materializationStatus = "pending", (p: ProductionPlan) => p.currentAllergenRelease!.masterArtifact = { ...p.currentAllergenRelease!.masterArtifact, driveFileId: "another" }, (p: ProductionPlan) => p.currentAllergenRelease!.masterArtifact = { ...p.currentAllergenRelease!.masterArtifact, id: "site-pdf" }]) { const f = masterFixture(); change(f.plans[0]); assert.throws(() => currentSignedMasterDocument(date, f.orders, f.plans, f.review)); }
});
