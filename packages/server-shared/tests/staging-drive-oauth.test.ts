import assert from "node:assert/strict";
import test from "node:test";
import { APPROVED_STAGING_DRIVE_ROOT as root, stagingDriveSession, assertStagingDriveResource } from "../src/staging-drive";
import { driveAccessToken, resolveDriveOwner, stagingDriveAccessBlocked, stagingDriveOperationsBlocked } from "../src/drive-owner";
const original = { ...process.env };
const originalFetch = globalThis.fetch;
const scope = "https://www.googleapis.com/auth/drive";
const config = () => ({ FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_STAGING_DRIVE_ENABLED: "true", FIKA_STAGING_DRIVE_EMAIL: "sandbox@example.test", FIKA_STAGING_DRIVE_PERMISSION_ID: "stage-user", FIKA_STAGING_DRIVE_ROOT_ID: root, FIKA_STAGING_DRIVE_ALLOWED_PERMISSION_IDS: "owner,stage-user", FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS: "production-sentinel", FIKA_STAGING_DRIVE_OAUTH_JSON: JSON.stringify({ client_id: "client", client_secret: "secret", refresh_token: "refresh" }) });
function fake(overrides: Record<string, unknown> = {}) {
  const requests: string[] = [];
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    const url = String(input); requests.push(url);
    assert.equal(init?.redirect, "error");
    if (url.includes("metadata.google.internal")) return new Response(String(overrides.project || "fika-os-dev"), { headers: { "Metadata-Flavor": "Google" } });
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(new URLSearchParams(String(init?.body)).get("grant_type"), "refresh_token");
      assert.equal(new URLSearchParams(String(init?.body)).has("assertion"), false);
      return Response.json({ access_token: "token", token_type: "Bearer", scope, ...overrides.token as object });
    }
    if (url.includes("/about?")) return Response.json({ user: { emailAddress: "sandbox@example.test", permissionId: "stage-user", ...overrides.user as object } });
    if (url.includes(`/files/${root}?`)) return Response.json({ id: root, mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: true }, permissions: [{ id: "owner", type: "user", role: "owner" }, { id: "stage-user", type: "user", role: "writer" }], ...overrides.folder as object });
    if (url.includes("production-sentinel")) return overrides.sentinel as Response || new Response(null, { status: 404 });
    if (url.includes("/files/child?")) return Response.json({ id: "child", parents: [root], ...overrides.child as object });
    throw Error("Unexpected request");
  }) as typeof fetch;
  return { fetcher, requests };
}
test.afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); globalThis.fetch = originalFetch; });
test("verified dev runtime uses user OAuth and fixed root for every app and OPLOC; DWD is never selected", async () => {
  Object.assign(process.env, config()); const { fetcher } = fake(); globalThis.fetch = fetcher;
  assert.equal(await stagingDriveAccessBlocked(), true, "raw stored links remain masked");
  assert.equal(await stagingDriveOperationsBlocked(), false);
  for (const owner of [{ type: "app-workspace", appId: "cpu-production" }, { type: "oploc-workspace", oplocId: "oploc:test" }] as const) {
    const resolved = resolveDriveOwner(owner);
    assert.equal(resolved.workspaceEmail, "sandbox@example.test"); assert.equal(resolved.configuredRootFolderId, root); assert.equal(resolved.authMode, "staging-oauth");
    assert.equal(await driveAccessToken(resolved), "token");
  }
});
test("disabled, contradictory projects, DWD-bound and incomplete settings deny before OAuth/network", async () => {
  for (const change of [{ FIKA_STAGING_DRIVE_ENABLED: "false" }, { GOOGLE_CLOUD_PROJECT: "fika-os" }, { GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "key" }, { GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER: "key" }, { FIKA_STAGING_DRIVE_ROOT_ID: "other" }, { FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS: "" }]) {
    const { fetcher, requests } = fake(); await assert.rejects(stagingDriveSession({ ...config(), ...change }, fetcher)); assert.equal(requests.length, 0);
  }
});
test("wrong actual project denies before OAuth credential use", async () => {
  const { fetcher, requests } = fake({ project: "fika-os" }); await assert.rejects(stagingDriveSession(config(), fetcher)); assert.equal(requests.length, 1);
});
test("wrong token user, scope, broad root ACL, nonwritable folder and accessible production sentinel fail closed", async () => {
  for (const changes of [{ user: { permissionId: "production-owner" } }, { token: { scope: scope + " gmail" } }, { folder: { permissions: [{ id: "all", type: "domain" }] } }, { folder: { capabilities: {} } }, { sentinel: Response.json({ id: "production-sentinel" }) }, { sentinel: Response.json({ error: { errors: [{ reason: "rateLimitExceeded" }] } }, { status: 403 }) }]) {
    await assert.rejects(stagingDriveSession(config(), fake(changes).fetcher));
  }
});
test("file ancestry permits root descendants and rejects outside files, shortcuts and cycles", async () => {
  Object.assign(process.env, config());
  await assert.doesNotReject(assertStagingDriveResource("child", "Bearer token", fake().fetcher));
  for (const child of [{ parents: [] }, { mimeType: "application/vnd.google-apps.shortcut" }, { parents: ["child"] }, { trashed: true }]) await assert.rejects(assertStagingDriveResource("child", "Bearer token", fake({ child }).fetcher));
});
test("production cannot select staging OAuth and malformed credential errors do not disclose secret text", async () => {
  Object.assign(process.env, config(), { FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os-dev" });
  await assert.rejects(driveAccessToken({ type: "app-workspace", appId: "cpu-production", authMode: "staging-oauth" }));
  await assert.rejects(stagingDriveSession({ ...config(), FIKA_STAGING_DRIVE_OAUTH_JSON: "SECRET-CONTENT" }, fake().fetcher), error => !String(error).includes("SECRET-CONTENT"));
});
