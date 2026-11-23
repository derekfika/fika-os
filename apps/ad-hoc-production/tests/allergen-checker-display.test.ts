import assert from "node:assert/strict";
import test from "node:test";
import { allergenCheckerDisplay, currentSignedChecker } from "../lib/allergen-checker-display";
import type { AdHocAllergenCheckerStatus } from "../../shared/ad-hoc-production-contract";

const request = { status: "SENT_TO_CPU" as const, sentVersion: 4 };
const signature = (role: "production_chef" | "head_chef_site_manager") => ({ role, printedName: role, signedAt: "2026-11-23T10:00:00.000Z" });
const signed: AdHocAllergenCheckerStatus = { state: "ready", sourceVersion: 4, signatures: [signature("production_chef"), signature("head_chef_site_manager")] };

test("Ad-Hoc reports a signed status and PDF only for the current source and both required signatures", () => {
  assert.equal(currentSignedChecker(signed, request), true);
  assert.equal(allergenCheckerDisplay(signed, request), "Signed and available");
  assert.equal(allergenCheckerDisplay({ ...signed, sourceVersion: 3 }, request), "Requires re-review");
  assert.equal(allergenCheckerDisplay({ ...signed, signatures: [signature("production_chef")] }, request), "Requires re-review");
  assert.equal(currentSignedChecker(signed, request, true), false);
  assert.equal(allergenCheckerDisplay(signed, request, true), "Requires re-review");
});

test("CPU review and signing states remain distinct, while stale and failed evidence fail closed", () => {
  assert.equal(allergenCheckerDisplay({ state: "pending" }, request), "Awaiting CPU review");
  assert.equal(allergenCheckerDisplay({ state: "unsigned" }, request), "Awaiting CPU review");
  assert.equal(allergenCheckerDisplay({ state: "unsigned", signatures: [signature("production_chef")] }, request), "Awaiting signatures");
  assert.equal(allergenCheckerDisplay({ state: "pending", signatures: [signature("production_chef"), signature("head_chef_site_manager")] }, request), "Unavailable/error");
  assert.equal(allergenCheckerDisplay({ state: "revoked" }, request), "Requires re-review");
  assert.equal(allergenCheckerDisplay({ state: "stale" }, request), "Requires re-review");
  assert.equal(allergenCheckerDisplay({ state: "failed" }, request), "Unavailable/error");
  assert.equal(allergenCheckerDisplay({ state: "unavailable" }, request), "Unavailable/error");
  assert.equal(allergenCheckerDisplay(undefined, request), "Unavailable/error");
  assert.equal(allergenCheckerDisplay({ state: "ready" }, { ...request, status: "NEEDS_UPDATE" }), "Requires re-review");
});
