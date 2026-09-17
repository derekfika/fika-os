import assert from "node:assert/strict";
import { test } from "node:test";
import { allergenMatrixContentHash, buildCpuAllergenRelease, revokeCpuAllergenRelease } from "../lib/cpu-allergen-release";
import { currentAllergenReleaseMatchesOrder, signedAllergenCheckpointMatchesOrder, type PlannedMenuItem } from "../app/lib/production-plan";

const source = { sourceDayId: "rolling-week:day:0", sourcePublicationDayId: "publication:day:v1", sourceVersion: 1, sourceContentHash: "a".repeat(64) };
const items: PlannedMenuItem[] = [{ id: "dish:1", name: "Salad A", note: "", subItems: [{ id: "sub:1", name: "Salad A", quantity: 1, allergens: { sulphites: "clear" }, note: "", evidenceStatus: "completed" as const }] }];
const signatures = [{ role: "production_chef" as const, printedName: "Chef One", signedAt: "2026-09-03T09:00:00Z", actor: "chef:1", attestation: "checked", scope: { productionOrderId: "production:1", serviceDate: "2026-09-03", ...source, matrixContentHash: allergenMatrixContentHash(items) } }, { role: "head_chef_site_manager" as const, printedName: "Chef Two", signedAt: "2026-09-03T09:05:00Z", actor: "chef:2", attestation: "checked", scope: { productionOrderId: "production:1", serviceDate: "2026-09-03", ...source, matrixContentHash: allergenMatrixContentHash(items) } }];
const artifact = (id: string) => ({ id, bookingId: "booking:1", fileName: `${id}.pdf`, createdAt: "2026-09-03T09:00:00Z", createdBy: "chef:1", contentHash: "a".repeat(64), pdfStatus: "generated" as const, driveFileId: id, driveStatus: "saved" as const });
const build = () => buildCpuAllergenRelease({ serviceDate: "2026-09-03", ...source, version: 1, signedAt: "2026-09-03T09:10:00Z", signatures, items, masterArtifact: artifact("master"), derivedArtifacts: [artifact("site")], packetArtifacts: [artifact("packet")] });

test("release carries exact published source-day lineage", () => { const release = build(); assert.equal(release.sourceDayId, source.sourceDayId); assert.equal(release.sourcePublicationDayId, source.sourcePublicationDayId); assert.equal(release.sourceContentHash, source.sourceContentHash); });
test("revocation invalidates signatures and every artifact", () => { const release = revokeCpuAllergenRelease(build(), { at: "2026-09-03T10:00:00Z", by: "chef:1", reason: "Correction" }); assert.equal(release.status, "revoked"); assert.ok(release.signatures.every(signature => !signature.valid)); assert.equal(release.masterArtifact.driveStatus, "failed"); assert.ok(release.derivedArtifacts.every(item => item.driveStatus === "failed")); assert.ok(release.packetArtifacts.every(item => item.driveStatus === "failed")); });
test("current release validity requires every current production-order lineage field", () => {
  const release = build();
  const order = { canonicalId: "production:1", serviceDate: "2026-09-03", requiredBy: "2026-09-03T12:00:00Z", sourceEntityId: source.sourceDayId, sourcePublicationDayId: source.sourcePublicationDayId, sourceVersion: source.sourceVersion, sourceContentHash: source.sourceContentHash };
  assert.equal(currentAllergenReleaseMatchesOrder(release, order, items), true);
  assert.equal(currentAllergenReleaseMatchesOrder(release, { ...order, sourceContentHash: "b".repeat(64) }, items), false);
  assert.equal(currentAllergenReleaseMatchesOrder(release, { ...order, sourceVersion: 2 }, items), false);
  assert.equal(currentAllergenReleaseMatchesOrder(release, { ...order, sourcePublicationDayId: "publication:day:v2" }, items), false);
  const revoked = revokeCpuAllergenRelease(release, { at: "2026-09-03T10:00:00Z", by: "chef:1", reason: "Changed source" });
  assert.equal(currentAllergenReleaseMatchesOrder(revoked, order, items), false);
});
test("identical menu content cannot restore a release from another publication lineage", () => {
  const release = build();
  const plan = { signedMenuContentHash: allergenMatrixContentHash(items), signedSignatures: signatures, currentAllergenRelease: release };
  const order = { canonicalId: "production:1", serviceDate: "2026-09-03", requiredBy: "2026-09-03T12:00:00Z", sourceEntityId: source.sourceDayId, sourcePublicationDayId: source.sourcePublicationDayId, sourceVersion: source.sourceVersion, sourceContentHash: source.sourceContentHash };
  assert.equal(signedAllergenCheckpointMatchesOrder(plan, order, items), true);
  assert.equal(signedAllergenCheckpointMatchesOrder(plan, { ...order, sourcePublicationDayId: "publication:day:v2" }, items), false);
});

test("semantic matrix hashing excludes workflow/editor metadata but binds safety evidence", () => {
  const reviewed = structuredClone(items);
  const workflowOnly = structuredClone(items);
  workflowOnly[0].id = "editor-generated-id";
  workflowOnly[0].note = "changed UI note";
  workflowOnly[0].subItems[0].id = "new-editor-sub-id";
  workflowOnly[0].subItems[0].note = "changed workflow note";
  workflowOnly[0].subItems[0].evidenceStatus = "not_completed";
  assert.equal(allergenMatrixContentHash(reviewed), allergenMatrixContentHash(workflowOnly));

  const stateChanged = structuredClone(items);
  stateChanged[0].subItems[0].allergens.milk = "contains";
  assert.notEqual(allergenMatrixContentHash(reviewed), allergenMatrixContentHash(stateChanged));
  const evidenceChanged = structuredClone(items);
  evidenceChanged[0].subItems[0].mayContainNotes = "Shared fryer evidence";
  assert.notEqual(allergenMatrixContentHash(reviewed), allergenMatrixContentHash(evidenceChanged));
  const sourceChanged = structuredClone(items);
  sourceChanged[0].sourceLineId = "source-line:amended";
  assert.notEqual(allergenMatrixContentHash(reviewed), allergenMatrixContentHash(sourceChanged));
});
