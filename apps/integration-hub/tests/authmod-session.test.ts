import test from "node:test";
import assert from "node:assert/strict";
import { createFikaSessionCookie, principalFromSession, requireFikaSession, resolveSessionIdentity, assertRecentVerifiedFirebaseIdentity } from "../lib/fika-session";
import { MemoryAuthModRepository } from "../lib/authmod-core";
import { createAuthIdentity } from "../lib/authmod-core/identity";
import { assignPrimaryCustodian } from "../lib/authmod-core/custodianship";
import type { AuthPrincipal } from "../lib/authmod-core";
import { validateReturnTo } from "../lib/safe-return-to";

const actor: AuthPrincipal = { type: "interactive", id: "admin", displayName: "Test admin", email: "admin@fikacatering.com", identityKind: "person" };
const decoded = (overrides: Record<string, unknown> = {}) => ({ uid: "firebase:uid", email: "user@fikacatering.com", email_verified: true, auth_time: Math.floor(Date.now() / 1000), ...overrides }) as never;
const request = (cookie?: string) => ({ cookies: { get: (name: string) => name === "fika_os_session" && cookie ? { value: cookie } : undefined } });

test("session cookie exchange uses Firebase session-cookie API and bounded lifetime", async () => {
  let received = 0;
  const cookie = await createFikaSessionCookie("short-lived-id-token", 60, { createSessionCookie: async (token, options) => { assert.equal(token, "short-lived-id-token"); received = options.expiresIn; return "server-session-cookie"; }, verifySessionCookie: async () => decoded() });
  assert.equal(cookie, "server-session-cookie"); assert.equal(received, 60_000);
  assert.notEqual(cookie, "short-lived-id-token");
  await assert.rejects(() => createFikaSessionCookie("token", 14 * 24 * 60 * 60 + 1, { createSessionCookie: async () => "", verifySessionCookie: async () => decoded() }));
});

test("recent verified Workspace identity policy rejects stale, unverified, and non-FIKA users", () => {
  assert.doesNotThrow(() => assertRecentVerifiedFirebaseIdentity(decoded(), Math.floor(Date.now() / 1000)));
  assert.throws(() => assertRecentVerifiedFirebaseIdentity(decoded({ email: "user@example.com" })), /not eligible/);
  assert.throws(() => assertRecentVerifiedFirebaseIdentity(decoded({ email_verified: false })), /not eligible/);
  assert.throws(() => assertRecentVerifiedFirebaseIdentity(decoded({ auth_time: Math.floor(Date.now() / 1000) - 301 })), /too old/);
});

test("exact enrolled email binds the first Firebase UID and records audit evidence", async () => {
  const repository = new MemoryAuthModRepository();
  const identity = await createAuthIdentity(repository, { actor, displayName: "Imported User", email: "USER@fikacatering.com", provenance: "import" });
  const bound = await resolveSessionIdentity(repository, { uid: "firebase:first", email: "user@fikacatering.com", name: "Imported User" });
  assert.equal(bound.id, identity.id); assert.equal(bound.externalProvider, "firebase"); assert.equal(bound.externalUid, "firebase:first");
  assert.equal(repository.audits.at(-1)?.action, "auth-identity-bound");
  const again = await resolveSessionIdentity(repository, { uid: "firebase:first", email: "changed@fikacatering.com", name: "Imported User" });
  assert.equal(again.id, identity.id);
});

test("unknown and inactive identities cannot create a trusted session", async () => {
  const repository = new MemoryAuthModRepository();
  await assert.rejects(() => resolveSessionIdentity(repository, { uid: "unknown", email: "unknown@fikacatering.com", name: "Unknown" }), /not been enrolled/);
  const identity = await createAuthIdentity(repository, { actor, displayName: "Inactive", email: "inactive@fikacatering.com", externalProvider: "firebase", externalUid: "inactive", status: "inactive" });
  await assert.rejects(() => resolveSessionIdentity(repository, { uid: identity.externalUid!, email: identity.normalizedEmail, name: identity.displayName }), /inactive/);
});

test("requireFikaSession rejects missing and invalid cookies, and preserves operational identity", async () => {
  const repository = new MemoryAuthModRepository();
  const operational = await createAuthIdentity(repository, { actor, displayName: "CPU Production", email: "cpux@fikacatering.com", externalProvider: "firebase", externalUid: "cpu-uid", identityKind: "operational", operationalPurpose: "CPU Production", provenance: "import" });
  await assignPrimaryCustodian(repository, { operationalIdentityId: operational.id, custodianLegendId: "legend:chef", actor, reason: "Shared production account custodian." });
  await assert.rejects(() => requireFikaSession(request()), /required/);
  await assert.rejects(() => requireFikaSession(request("bad-cookie"), repository, { verifySessionCookie: async () => { throw new Error("invalid"); }, createSessionCookie: async () => "" }), /invalid or expired/);
  const principal = await requireFikaSession(request("good-cookie"), repository, { verifySessionCookie: async () => decoded({ uid: "cpu-uid", email: "cpux@fikacatering.com", name: "CPU Production" }), createSessionCookie: async () => "" });
  assert.equal(principal.identityKind, "operational"); assert.equal(principal.authmodIdentityId, operational.id); assert.equal(principal.primaryCustodianLegendId, "legend:chef"); assert.equal(principal.displayName, "CPU Production");
});

test("session principal contains identity context only, not live access entitlements", async () => {
  const repository = new MemoryAuthModRepository();
  const identity = await createAuthIdentity(repository, { actor, displayName: "Person", email: "person@fikacatering.com", externalProvider: "firebase", externalUid: "person-uid", provenance: "import" });
  const principal = await principalFromSession(repository, { ...identity, fullAccess: true }, "person-uid");
  assert.equal(principal.authmodIdentityId, identity.id); assert.equal("fullAccess" in principal, false); assert.equal("apps" in principal, false); assert.equal("sites" in principal, false);
});

test("returnTo accepts FIKA paths and configured app origins but rejects open redirects", () => {
  assert.equal(validateReturnTo("/authmod/accounts/example"), "/authmod/accounts/example");
  assert.equal(validateReturnTo("https://hub.fikacatering.com/authmod?tab=accounts", ["https://hub.fikacatering.com"]), "/authmod?tab=accounts");
  assert.throws(() => validateReturnTo("https://evil.example"), /not allowed/);
  assert.throws(() => validateReturnTo("//evil.example"), /not allowed/);
});
