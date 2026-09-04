import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCpuAllergenRelease, revokeCpuAllergenRelease } from "../lib/cpu-allergen-release";

const source = { sourceDayId: "rolling-week:day:0", sourcePublicationDayId: "publication:day:v1", sourceVersion: 1, sourceContentHash: "a".repeat(64) };
const signatures = [{ role: "production_chef" as const, printedName: "Chef One", signedAt: "2026-09-03T09:00:00Z", actor: "chef:1", attestation: "checked" }, { role: "head_chef_site_manager" as const, printedName: "Chef Two", signedAt: "2026-09-03T09:05:00Z", actor: "chef:2", attestation: "checked" }];
const artifact = (id: string) => ({ id, bookingId: "booking:1", fileName: `${id}.pdf`, createdAt: "2026-09-03T09:00:00Z", createdBy: "chef:1", contentHash: "a".repeat(64), pdfStatus: "generated" as const, driveFileId: id, driveStatus: "saved" as const });
const build = () => buildCpuAllergenRelease({ serviceDate: "2026-09-03", ...source, version: 1, signedAt: "2026-09-03T09:10:00Z", signatures, items: [{ id: "dish:1", name: "Salad A", note: "", subItems: [{ id: "sub:1", name: "Salad A", quantity: 1, allergens: { sulphites: "clear" }, note: "", evidenceStatus: "completed" as const }] }], masterArtifact: artifact("master"), derivedArtifacts: [artifact("site")], packetArtifacts: [artifact("packet")] });

test("release carries exact published source-day lineage", () => { const release = build(); assert.equal(release.sourceDayId, source.sourceDayId); assert.equal(release.sourcePublicationDayId, source.sourcePublicationDayId); assert.equal(release.sourceContentHash, source.sourceContentHash); });
test("revocation invalidates signatures and every artifact", () => { const release = revokeCpuAllergenRelease(build(), { at: "2026-09-03T10:00:00Z", by: "chef:1", reason: "Correction" }); assert.equal(release.status, "revoked"); assert.ok(release.signatures.every(signature => !signature.valid)); assert.equal(release.masterArtifact.driveStatus, "failed"); assert.ok(release.derivedArtifacts.every(item => item.driveStatus === "failed")); assert.ok(release.packetArtifacts.every(item => item.driveStatus === "failed")); });
