import assert from "node:assert/strict";
import test from "node:test";
import { requireLogisticsAccess } from "../lib/auth";
import { requiredUpstreamUrl } from "../lib/runtime";

const request = { cookies: { get: () => undefined } };

test("hosted runtime requires explicit HTTPS upstream URLs", () => {
  const env = { FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_HUB_BASE_URL: "https://staging-os.example", FIKA_CPU_BASE_URL: "https://cpu.example" };
  assert.equal(requiredUpstreamUrl("FIKA_HUB_BASE_URL", env), "https://staging-os.example");
  assert.equal(requiredUpstreamUrl("FIKA_CPU_BASE_URL", env), "https://cpu.example");
  assert.throws(() => requiredUpstreamUrl("FIKA_HUB_BASE_URL", { ...env, FIKA_HUB_BASE_URL: "http://localhost:3200" }), /must use HTTPS/);
});

test("hosted runtime never falls back to localhost for missing upstream configuration", () => {
  assert.throws(() => requiredUpstreamUrl("FIKA_HUB_BASE_URL", { FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev" }), /required in hosted Logistics runtime/);
});

test("Logistics access rejects missing/invalid sessions and accepts authorized sessions", async () => {
  await assert.rejects(() => requireLogisticsAccess(request, { allowLocalFallback: false, sessionReader: async () => { throw Object.assign(new Error("Authentication is required."), { status: 401 }); } }), /required/);
  await assert.rejects(() => requireLogisticsAccess(request, { allowLocalFallback: false, sessionReader: async () => { throw Object.assign(new Error("The FIKA OS session is invalid or expired."), { status: 401 }); } }), /invalid or expired/);
  await assert.rejects(() => requireLogisticsAccess(request, { allowLocalFallback: false, sessionReader: async () => ({ firebaseUid: "uid", authmodIdentityId: "identity", displayName: "Unauthorised", identityKind: "person" }), accessChecker: async () => { throw Object.assign(new Error("Logistics access denied."), { status: 403 }); } }), /denied/);
  const principal = await requireLogisticsAccess(request, { allowLocalFallback: false, sessionReader: async () => ({ firebaseUid: "uid", authmodIdentityId: "identity", displayName: "Authorized", identityKind: "person" }), accessChecker: async (value) => { assert.equal(value.type, "interactive"); } });
  assert.equal(principal.displayName, "Authorized");
});
