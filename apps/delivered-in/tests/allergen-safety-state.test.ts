import assert from "node:assert/strict";
import { test } from "node:test";
import { acknowledgeSafetyState, publishSafetyState, revokeSafetyState } from "../lib/allergen-safety-state";

const v1 = publishSafetyState({ siteId: "site:a", serviceDate: "2026-09-07", releaseId: "release:v1", releaseVersion: "v1", releaseHash: "a".repeat(64), regenerated: true, updatedAt: "2026-09-01T09:00:00Z" });
test("safety state revocation blocks acknowledgement and replacement is version scoped", () => {
  const revoked = revokeSafetyState(v1, "2026-09-02T09:00:00Z");
  assert.equal(revoked.releaseStatus, "revoked_pending");
  assert.equal(revoked.menuStatus, "withdrawn");
  assert.throws(() => acknowledgeSafetyState(revoked, "chef@example.com", "2026-09-02T09:01:00Z"));
  const v2 = publishSafetyState({ siteId: v1.siteId, serviceDate: v1.serviceDate, releaseId: "release:v2", releaseVersion: "v2", releaseHash: "b".repeat(64), previousReleaseId: v1.releaseId, previousReleaseVersion: v1.releaseVersion, regenerated: true, updatedAt: "2026-09-03T09:00:00Z" });
  const acknowledged = acknowledgeSafetyState(v2, "chef@example.com", "2026-09-03T09:01:00Z");
  assert.equal(acknowledged.acknowledgement?.releaseVersion, "v2");
  assert.equal(acknowledged.reprintRequired, true);
});
