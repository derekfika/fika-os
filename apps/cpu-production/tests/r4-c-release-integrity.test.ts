import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allergenMatrixContentHash, buildCpuAllergenRelease, failCpuAllergenReleaseMaterialization, materializeCpuAllergenRelease, revokeCpuAllergenRelease, stageCpuAllergenReleaseMaterialization } from "../lib/cpu-allergen-release";
import { buildCpuAllergenReleaseEvent } from "../lib/cpu-consumer-invalidation";
import { resumeCpuMaterializationPhase } from "../lib/cpu-release-materialization";
import type { PlannedMenuItem, ProductionPlan } from "../app/lib/production-plan";

const items: PlannedMenuItem[] = [{ id: "item:1", name: "Soup", note: "", subItems: [{ id: "sub:1", name: "Soup", quantity: 1, allergens: { sulphites: "clear" }, note: "", evidenceStatus: "completed" }] }];
const source = { serviceDate: "2026-09-15", sourceDayId: "menu-day:1", sourcePublicationId: "publication:1", sourcePublicationDayId: "publication-day:1", sourceVersion: 4, sourceContentHash: "a".repeat(64) };
const scope = { productionOrderId: "order:1", ...source, matrixContentHash: allergenMatrixContentHash(items) };
const signatures = [{ role: "production_chef" as const, printedName: "Chef One", signedAt: "2026-09-15T10:00:00Z", actor: "user:1", attestation: "I reviewed the complete matrix.", scope }, { role: "head_chef_site_manager" as const, printedName: "Chef Two", signedAt: "2026-09-15T10:01:00Z", actor: "user:2", attestation: "I reviewed the complete matrix.", scope }];
const artifact = { id: "artifact:1", bookingId: "booking:1", fileName: "matrix.pdf", createdAt: "2026-09-15T10:01:00Z", createdBy: "user:1", contentHash: "b".repeat(64), pdfStatus: "generated" as const, driveFileId: "drive:1", driveStatus: "saved" as const };

test("release commit is pending until packet and Drive materialization succeeds", () => {
  const pending = buildCpuAllergenRelease({ ...source, version: 1, signedAt: "2026-09-15T10:02:00Z", signatures, items, masterArtifact: { ...artifact, driveStatus: "not_configured", pdfStatus: "unavailable" }, derivedArtifacts: [], packetArtifacts: [], status: "pending" });
  assert.equal(pending.status, "pending");
  assert.equal(pending.materializationStatus, "pending");
  const staged = stageCpuAllergenReleaseMaterialization(pending, { masterArtifact: artifact, derivedArtifacts: [artifact], packetArtifacts: [artifact] });
  assert.equal(staged.status, "current");
  assert.equal(staged.materializationStatus, "pending");
  const ready = materializeCpuAllergenRelease(staged, { masterArtifact: artifact, derivedArtifacts: [artifact], packetArtifacts: [artifact] });
  assert.equal(ready.materializationStatus, "ready");
  assert.equal(revokeCpuAllergenRelease(ready, { at: "2026-09-15T10:03:00Z", by: "user:1", reason: "Correction" }).status, "revoked");
});

test("materialization failure is observable and remains retryable without becoming current", () => {
  const pending = buildCpuAllergenRelease({ ...source, version: 1, signedAt: "2026-09-15T10:02:00Z", signatures, items, masterArtifact: { ...artifact, driveStatus: "not_configured", pdfStatus: "unavailable" }, derivedArtifacts: [], packetArtifacts: [], status: "pending" });
  const staged = stageCpuAllergenReleaseMaterialization(pending, { masterArtifact: pending.masterArtifact, derivedArtifacts: [], packetArtifacts: [] });
  const failed = failCpuAllergenReleaseMaterialization(staged, new Error("Drive unavailable"));
  assert.equal(failed.status, "current");
  assert.equal(failed.materializationStatus, "failed");
  assert.equal(failed.materializationError, "Drive unavailable");
  assert.equal(materializeCpuAllergenRelease(failed, { masterArtifact: artifact, derivedArtifacts: [artifact], packetArtifacts: [artifact] }).materializationStatus, "ready");
});

test("release identity includes publication occurrence even when content is identical", () => {
  const first = buildCpuAllergenRelease({ ...source, version: 1, signedAt: "2026-09-15T10:02:00Z", signatures, items, masterArtifact: artifact, derivedArtifacts: [artifact], packetArtifacts: [artifact] });
  const second = buildCpuAllergenRelease({ ...source, sourcePublicationDayId: "publication-day:2", version: 1, signedAt: "2026-09-15T10:04:00Z", signatures: signatures.map(signature => ({ ...signature, scope: { ...signature.scope, sourcePublicationDayId: "publication-day:2" } })), items, masterArtifact: artifact, derivedArtifacts: [artifact], packetArtifacts: [artifact] });
  assert.equal(allergenMatrixContentHash(items), allergenMatrixContentHash(items));
  assert.notEqual(first.releaseId, second.releaseId);
});

test("release event scope is one exact OPLOC and revocation reuses release identity", () => {
  const release = buildCpuAllergenRelease({ ...source, version: 1, signedAt: "2026-09-15T10:02:00Z", signatures, items, masterArtifact: artifact, derivedArtifacts: [artifact], packetArtifacts: [artifact] });
  const published = buildCpuAllergenReleaseEvent({ release, oplocId: "oploc:A", eventType: "published" });
  const revoked = buildCpuAllergenReleaseEvent({ release: revokeCpuAllergenRelease(release, { at: "2026-09-15T10:05:00Z", by: "user:1", reason: "Correction" }), oplocId: "oploc:A", eventType: "revoked" });
  assert.equal(published.oplocId, "oploc:A");
  assert.equal(revoked.releaseId, published.releaseId);
  assert.equal(revoked.eventType, "revoked");
});

test("signing source has no external artifact call before the authoritative save", async () => {
  const sourceText = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  const signStart = sourceText.indexOf('if (command.action === "sign-matrix")');
  const saveStart = sourceText.indexOf('if (command.action === "save-matrix")');
  const signBlock = sourceText.slice(signStart, saveStart);
  assert.ok(signStart >= 0 && saveStart > signStart);
  assert.doesNotMatch(signBlock, /createMatrixArtifact\(|createCpuReleaseArtifacts\(|publishDailySignedOplocBundle\(|allergen-matrix\/drive/);
  assert.match(sourceText, /saveAndAppendCpuChange\(plan, expectedUpdatedAt/);
  assert.match(sourceText, /deliverCpuPropagation\(materializationDelivery\.eventId\)/);
});

test("the worker commits pending materialization before external publication and keeps final certification explicit", async () => {
  const sourceText = await readFile(new URL("../lib/cpu-release-materialization.ts", import.meta.url), "utf8");
  const started = sourceText.indexOf("const startedResult = await repository.saveAndAppendCpuChange(preparedCandidate, stored.updatedAt");
  const artifactBuild = sourceText.indexOf("createCpuReleaseArtifacts(startedPlan");
  const preparedPhase = sourceText.indexOf("const preparedResult = await repository.saveAndAppendCpuChange(artifactCandidate, startedPlan.updatedAt");
  const publish = sourceText.indexOf("await prepared.publish()");
  const final = sourceText.indexOf("const finalResult = await repository.saveAndAppendCpuChange(ready, preparedPlan.updatedAt");
  assert.ok(started >= 0 && artifactBuild > started && preparedPhase > artifactBuild && publish > preparedPhase && final > publish);
  assert.match(sourceText, /resumeCpuMaterializationPhase\(startedResult, preparedCandidate, "started"\)/);
  assert.match(sourceText, /resumeCpuMaterializationPhase\(preparedResult, artifactCandidate, "prepared"\)/);
  assert.match(sourceText, /resumeCpuMaterializationPhase\(finalResult, ready, "final"\)/);
  assert.match(sourceText, /materializationStatus: "failed"/);
});

test("duplicate materialization phases resume from the persisted plan timestamp", () => {
  const localCandidate = { id: "plan:1", orderId: "order:1", updatedAt: "local-only", menuItems: [], status: "planned", planningNotes: "", audit: [], updatedBy: "chef" } as unknown as ProductionPlan;
  const persisted = { ...localCandidate, updatedAt: "persisted-authoritative" };
  assert.equal(resumeCpuMaterializationPhase({ duplicate: true, plan: persisted }, localCandidate, "started"), persisted);
  assert.equal(resumeCpuMaterializationPhase({ duplicate: true, plan: persisted }, localCandidate, "prepared"), persisted);
  assert.equal(resumeCpuMaterializationPhase({}, localCandidate, "final"), localCandidate);
  assert.throws(() => resumeCpuMaterializationPhase({ duplicate: true }, localCandidate, "prepared"), /receipt has no persisted ProductionPlan/);
});

test("the UI captures one master human signature and fans it out to exact OPLOC releases", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /visibleOrders\.length === 1 \? visibleOrders\[0\]\.canonicalId : undefined/);
  assert.match(page, /Review the complete service-date matrix once/);
  assert.match(page, /const pendingReleaseOrders = useMemo/);
  assert.match(page, /action: "sign-master-matrix"/);
  assert.match(page, /cpu-master-sign/);
  assert.match(page, /expectedLineage/);
  assert.match(matrix, /statuses\.length === orderIds\.length/);
  assert.match(matrix, /statuses\.every\(status => status\.signatureRoles\.includes\(role\)\)/);
  assert.match(matrix, /disabled=\{busy \|\| locked/);
});
