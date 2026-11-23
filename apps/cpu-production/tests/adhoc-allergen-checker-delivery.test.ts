import assert from "node:assert/strict";
import test from "node:test";
import { adHocAllergenCheckerDelivery } from "../lib/adhoc-allergen-checker-delivery";
import type { CpuAllergenRelease } from "../lib/cpu-allergen-release";
import type { ProductionOrder } from "../lib/production-types";

const order = { canonicalId: "production-order:v1:ad-hoc:adhoc-request:one", origin: "cpu_created", sourceEntityId: "adhoc-request:one", sourceVersion: 2, status: "draft" } as unknown as ProductionOrder;
const release = { releaseId: "release:two", sourceVersion: 2, sourceRevision: 2, sourceContentHash: "a".repeat(64), version: 2, signedAt: "2026-11-23T09:00:00.000Z", status: "current", materializationStatus: "ready", masterArtifact: { fileName: "checker.pdf", driveFileId: "must-not-leave-cpu", driveUrl: "https://drive.example.test/private" }, signatures: [
  { role: "production_chef", printedName: "Production Chef", signedAt: "2026-11-23T08:00:00.000Z", valid: true },
  { role: "head_chef_site_manager", printedName: "Head Chef", signedAt: "2026-11-23T09:00:00.000Z", valid: true },
] } as unknown as CpuAllergenRelease;

test("Ad-Hoc current release delivery carries dual signer lineage without Drive access details", () => {
  const delivery = adHocAllergenCheckerDelivery(release, order, "current");
  assert.equal(delivery?.consumer, "integration-hub");
  assert.equal(delivery?.route, "/api/internal/ad-hoc-production/allergen-checker");
  assert.deepEqual((delivery?.body.signatures as Array<{ role: string }>).map(signature => signature.role), ["production_chef", "head_chef_site_manager"]);
  assert.equal(delivery?.body.pdfAvailable, true);
  assert.equal(JSON.stringify(delivery?.body).includes("must-not-leave-cpu"), false);
  assert.equal(JSON.stringify(delivery?.body).includes("drive.example.test"), false);
});

test("Ad-Hoc revocation does not depend on a site packet or OPLOC destination", () => {
  const delivery = adHocAllergenCheckerDelivery({ ...release, status: "revoked", revokedAt: "2026-11-23T09:10:00.000Z" } as CpuAllergenRelease, order, "revoked");
  assert.equal(delivery?.body.state, "revoked");
  assert.equal(delivery?.body.pdfAvailable, false);
  assert.equal(adHocAllergenCheckerDelivery({ ...release, signatures: [release.signatures[0]] } as CpuAllergenRelease, order, "current"), undefined, "dual signature authority remains mandatory");
});
