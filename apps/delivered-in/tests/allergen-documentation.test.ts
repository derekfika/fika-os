import assert from "node:assert/strict";
import test from "node:test";
import { currentAllergenDocument } from "../lib/allergen-documentation";
import type { ProjectedDay } from "../lib/projection";

const day: ProjectedDay = {
  publicationId: "pub:1", publicationDayId: "pubday:1", sourceDayId: "day:1", date: "2026-11-09", dayName: "Monday", version: 4, contentHash: "menu-hash", entries: [], allergenSignoff: {},
  drivePdfUrl: "https://drive.google.com/file/d/release-pdf/view",
  cpuReview: { status: "signed", drivePdfUrl: "https://drive.google.com/file/d/release-pdf/view", signatures: [
    { role: "production_chef", printedName: "Chef", signedAt: "2026-11-09T07:00:00Z" },
    { role: "head_chef_site_manager", printedName: "Manager", signedAt: "2026-11-09T07:01:00Z" },
  ] },
  sourceLineage: { cpu: { sourceStatus: "current", sourceCompleteness: "complete", sourceBundleHash: "menu-hash", releaseId: "release:1", releaseVersion: "r4", signedAt: "2026-11-09T07:01:00Z" } },
};

test("current signed CPU release exposes its versioned checker PDF", () => {
  assert.deepEqual(currentAllergenDocument(day), {
    href: day.drivePdfUrl,
    releaseId: "release:1",
    releaseVersion: "r4",
    signedAt: "2026-11-09T07:01:00Z",
  });
});

test("pending, incomplete, stale-lineage and under-signed releases expose no PDF", () => {
  assert.equal(currentAllergenDocument({ ...day, cpuReview: { ...day.cpuReview!, status: "pending" } }), undefined);
  assert.equal(currentAllergenDocument({ ...day, sourceLineage: { cpu: { ...day.sourceLineage!.cpu, sourceCompleteness: "partial" } } }), undefined);
  assert.equal(currentAllergenDocument({ ...day, sourceLineage: { cpu: { ...day.sourceLineage!.cpu, sourceBundleHash: "old-menu-hash" } } }), undefined);
  assert.equal(currentAllergenDocument({ ...day, cpuReview: { ...day.cpuReview!, signatures: day.cpuReview!.signatures.slice(0, 1) } }), undefined);
});

test("invalid timestamps and non-HTTPS document references are never linked", () => {
  assert.equal(currentAllergenDocument({ ...day, sourceLineage: { cpu: { ...day.sourceLineage!.cpu, signedAt: "invalid" } } }), undefined);
  assert.equal(currentAllergenDocument({ ...day, drivePdfUrl: "http://example.test/release.pdf" }), undefined);
});
