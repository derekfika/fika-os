import test from "node:test";
import assert from "node:assert/strict";
import { beveragePreviewAccessDecision, beveragePreviewCookieName, checkBeveragePreviewAccess } from "../lib/preview-auth";

const staging = { ...process.env, FIKA_BEVERAGE_PREVIEW_ONLY: "1", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_BEVERAGE_PREVIEW_REVIEWER_EMAILS: "derek@fikacatering.com" };

test("Beverage preview requires the shared staging FIKA session cookie and approved reviewer identity", async () => {
  assert.equal(beveragePreviewCookieName(staging), "fika_os_session_staging");
  assert.equal(await checkBeveragePreviewAccess(staging), "missing");
  const checks: boolean[] = [];
  const verify = async (_cookie: string) => { checks.push(true); return { email: "Derek@FikaCatering.com", email_verified: true }; };
  assert.equal(await checkBeveragePreviewAccess(staging, "signed-session", verify), "allow");
  assert.equal(checks.length, 1);
});

test("preview access fails closed on unverified, unlisted, revoked or misconfigured identities", async () => {
  assert.equal(beveragePreviewAccessDecision(staging, undefined), "missing");
  assert.equal(beveragePreviewAccessDecision(staging, "cookie", { email: "derek@fikacatering.com", email_verified: false }), "denied");
  assert.equal(beveragePreviewAccessDecision(staging, "cookie", { email: "sherice@example.com", email_verified: true }), "denied");
  assert.equal(await checkBeveragePreviewAccess(staging, "revoked", async () => { throw new Error("revoked"); }), "invalid");
  assert.equal(await checkBeveragePreviewAccess({ ...staging, FIREBASE_PROJECT_ID: "fika-os" }, "cookie"), "misconfigured");
  assert.equal(beveragePreviewAccessDecision({ ...staging, FIKA_BEVERAGE_PREVIEW_REVIEWER_EMAILS: "" }, "cookie", { email: "derek@fikacatering.com", email_verified: true }), "misconfigured");
});

test("local preview is available only with the explicit fixture runtime and demo project", () => {
  const local = { ...process.env, FIKA_BEVERAGE_PREVIEW_ONLY: "1", FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os", FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH: "fixture" };
  assert.equal(beveragePreviewAccessDecision(local, undefined), "allow");
  assert.equal(beveragePreviewAccessDecision({ ...local, FIREBASE_PROJECT_ID: "fika-os" }, undefined), "misconfigured");
  assert.equal(beveragePreviewAccessDecision({ ...local, FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH: "" }, undefined), "misconfigured");
});
