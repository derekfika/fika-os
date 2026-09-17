import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allergenMatrixContentHash, buildCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { MasterSignCommand } from "../lib/production-plan-command-schema";
import { sameMatrixSignatureScope, signingLineageForOrder, type PlannedMenuItem } from "../app/lib/production-plan";

const serviceDate = "2026-09-17";
const order = {
  canonicalId: "production-order:v1:booking:hospitality-liana",
  origin: "hospitality_booking" as const,
  sourceBookingId: "booking:hospitality-liana",
  sourceQuoteRevisionId: "quote-revision:hospitality-liana:v3",
  currentRevision: 1,
  version: 1,
  serviceDate,
  requiredBy: `${serviceDate}T12:00:00.000Z`,
};
const items: PlannedMenuItem[] = [{
  id: "menu-item:chicken",
  sourceLineId: "production-line:chicken",
  name: "Chicken sandwich",
  note: "",
  subItems: [{ id: "sub-item:chicken", name: "Chicken sandwich", quantity: 1, allergens: { milk: "unrecorded" }, note: "", evidenceStatus: "completed" }],
}];

test("Hospitality signing lineage is canonical, deterministic and has no fabricated Menu publication", () => {
  const scope = signingLineageForOrder(order, allergenMatrixContentHash(items));
  assert.ok(scope);
  assert.equal(scope.sourceOrigin, "hospitality_booking");
  assert.equal(scope.productionOrderId, order.canonicalId);
  assert.equal(scope.serviceDate, serviceDate);
  assert.equal(scope.sourceBookingId, order.sourceBookingId);
  assert.equal(scope.sourceQuoteRevisionId, order.sourceQuoteRevisionId);
  assert.equal(scope.sourceRevision, 1);
  assert.match(scope.sourceContentHash, /^[a-f0-9]{64}$/);
  assert.equal(scope.sourceDayId, undefined);
  assert.equal(scope.sourcePublicationDayId, undefined);
  assert.equal(scope.sourceVersion, 1);
  assert.equal(scope.matrixContentHash, allergenMatrixContentHash(items));
  assert.deepEqual(signingLineageForOrder({ ...order }, scope.matrixContentHash), scope);
  const amended = signingLineageForOrder({ ...order, currentRevision: 2, version: 2 }, scope.matrixContentHash);
  assert.ok(amended);
  assert.notEqual(amended.sourceContentHash, scope.sourceContentHash);
  assert.equal(sameMatrixSignatureScope(amended, scope), false);
});

test("Hospitality lineage accepts legacy orders without Menu publication fields", () => {
  const legacy = signingLineageForOrder({ ...order, sourceContentHash: undefined, sourceEntityId: undefined, sourcePublicationDayId: undefined, sourceVersion: undefined }, allergenMatrixContentHash(items));
  assert.ok(legacy);
  assert.equal(legacy.sourceOrigin, "hospitality_booking");
  assert.equal(legacy.sourceBookingId, order.sourceBookingId);
  assert.equal(legacy.sourceQuoteRevisionId, order.sourceQuoteRevisionId);
  assert.match(legacy.sourceContentHash, /^[a-f0-9]{64}$/);
});

test("Menu Planning lineage keeps its existing publication-day shape", () => {
  const menuScope = signingLineageForOrder({ canonicalId: "production-order:menu", origin: "menu_planning", serviceDate, requiredBy: `${serviceDate}T12:00:00.000Z`, sourceEntityId: "menu-day:2026-09-17", sourcePublicationId: "menu-publication:v8", sourcePublicationDayId: "menu-publication-day:v8:2026-09-17", sourceVersion: 8, sourceContentHash: "a".repeat(64) }, "b".repeat(64));
  assert.deepEqual(menuScope, { productionOrderId: "production-order:menu", serviceDate, sourceDayId: "menu-day:2026-09-17", sourcePublicationId: "menu-publication:v8", sourcePublicationDayId: "menu-publication-day:v8:2026-09-17", sourceVersion: 8, sourceContentHash: "a".repeat(64), matrixContentHash: "b".repeat(64) });
});

test("origin-aware ExpectedLineage schema accepts Hospitality signing payload", () => {
  const scope = signingLineageForOrder(order, allergenMatrixContentHash(items))!;
  const parsed = MasterSignCommand.parse({
    action: "sign-master-matrix",
    serviceDate,
    role: "production_chef",
    printedName: "Production Chef",
    attestation: "I reviewed the current allergen matrix and source evidence.",
    signatureDataUrl: "data:image/png;base64,c2lnbmF0dXJl",
    orderIds: [order.canonicalId],
    expectedLineages: [scope],
    reviewOperations: [{ action: "mark-planned", orderId: order.canonicalId, menuItems: items, planningNotes: "" }],
    commandId: "hospitality-lineage-test",
  });
  assert.equal(parsed.expectedLineages[0].sourceOrigin, "hospitality_booking");
  assert.equal(parsed.expectedLineages[0].sourceBookingId, order.sourceBookingId);
});

test("Hospitality pending release retains source lineage without publication identity", () => {
  const scope = signingLineageForOrder(order, allergenMatrixContentHash(items))!;
  const signatures = [
    { role: "production_chef" as const, printedName: "Chef One", signedAt: "2026-09-17T08:00:00.000Z", actor: "chef", attestation: "reviewed", scope },
    { role: "head_chef_site_manager" as const, printedName: "Chef Two", signedAt: "2026-09-17T08:01:00.000Z", actor: "manager", attestation: "reviewed", scope },
  ];
  const release = buildCpuAllergenRelease({ serviceDate, sourceOrigin: scope.sourceOrigin, sourceBookingId: scope.sourceBookingId, sourceQuoteRevisionId: scope.sourceQuoteRevisionId, sourceRevision: scope.sourceRevision, sourceVersion: scope.sourceVersion, sourceContentHash: scope.sourceContentHash, version: 1, signedAt: "2026-09-17T08:01:00.000Z", signatures, items, masterArtifact: { id: "pending", bookingId: order.sourceBookingId, fileName: "pending.pdf", createdAt: "2026-09-17T08:01:00.000Z", createdBy: "chef", contentHash: "c".repeat(64), pdfStatus: "unavailable", driveStatus: "not_configured" }, derivedArtifacts: [], packetArtifacts: [], status: "pending" });
  assert.equal(release.sourceOrigin, "hospitality_booking");
  assert.equal(release.sourceBookingId, order.sourceBookingId);
  assert.equal(release.sourceQuoteRevisionId, order.sourceQuoteRevisionId);
  assert.equal(release.sourcePublicationDayId, undefined);
});

test("GET exposes canonical Hospitality lineage and Liana uses source-lineage wording", async () => {
  const route = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const liana = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(route, /const signingLineage = selectedOrder && selectedPlan \? matrixSignatureScope/);
  assert.match(route, /signingLineage: signingLineage \|\| null/);
  assert.match(liana, /body\.signingLineage/);
  assert.match(liana, /current source lineage is unavailable/);
  assert.match(liana, /authoritative\?: ReviewedLineage/);
});
