import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { driveAccessToken, type ResolvedDriveOwner } from "../src/drive-owner";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const owner = (authMode: "dwd" | "local-oauth"): ResolvedDriveOwner => ({ type: "app-workspace", appId: "cpu-production", workspaceEmail: "synthetic@example.test", authMode });
test.afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
  globalThis.fetch = originalFetch;
});

test("staging blocks both DWD and local OAuth before credential parsing, file reads or network", async () => {
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "not-json";
  process.env.GOOGLE_OAUTH_CLIENT_FILE = "nonexistent-test-client";
  process.env.GOOGLE_OAUTH_TOKEN_FILE = "nonexistent-test-token";
  process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID = "unverified-folder";
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected network"); };
  for (const mode of ["dwd", "local-oauth"] as const) {
    await assert.rejects(driveAccessToken(owner(mode)), { code: "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED" });
  }
  assert.equal(requests, 0);
});

test("hosted staging project fails closed even if its runtime mode is missing or incorrect", async () => {
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.FIREBASE_PROJECT_ID = "fika-os-dev";
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected network"); };
  for (const mode of [undefined, "production", "local"]) {
    if (mode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = mode;
    await assert.rejects(driveAccessToken(owner("dwd")), { code: "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED" });
  }
  assert.equal(requests, 0);
});

test("unknown and contradictory hosted configuration never reaches metadata, token or Drive", async () => {
  Reflect.set(process.env, "NODE_ENV", "production");
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected network"); };
  for (const [mode, project, cloud] of [["production", undefined, undefined], ["production", "fika-os", "fika-os-dev"], ["local", "fika-os", "fika-os"]]) {
    process.env.FIKA_RUNTIME_MODE = mode!;
    if (project) process.env.FIREBASE_PROJECT_ID = project; else delete process.env.FIREBASE_PROJECT_ID;
    if (cloud) process.env.GOOGLE_CLOUD_PROJECT = cloud; else delete process.env.GOOGLE_CLOUD_PROJECT;
    await assert.rejects(driveAccessToken(owner("dwd")), { code: "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED" });
  }
  assert.equal(requests, 0);
});

test("a mismatched metadata project is denied before credential parsing or token request", async () => {
  Reflect.set(process.env, "NODE_ENV", "production"); process.env.FIKA_RUNTIME_MODE = "production";
  process.env.FIREBASE_PROJECT_ID = "fika-os"; delete process.env.GOOGLE_CLOUD_PROJECT; delete process.env.GCLOUD_PROJECT;
  let requests = 0;
  globalThis.fetch = async (url) => { requests++; assert.match(String(url), /metadata.google.internal/); return new Response("fika-os-dev", { headers: { "Metadata-Flavor": "Google" } }); };
  await assert.rejects(driveAccessToken(owner("dwd")), { code: "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED" });
  assert.equal(requests, 1);
});

test("verified production metadata preserves the DWD token path", async () => {
  Reflect.set(process.env, "NODE_ENV", "production"); process.env.FIKA_RUNTIME_MODE = "production";
  process.env.FIREBASE_PROJECT_ID = "fika-os"; delete process.env.GOOGLE_CLOUD_PROJECT; delete process.env.GCLOUD_PROJECT;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "synthetic@example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  let requests = 0;
  globalThis.fetch = async (url) => { requests++; if (String(url).includes("metadata.google.internal")) return new Response("fika-os", { headers: { "Metadata-Flavor": "Google" } }); assert.equal(String(url), "https://oauth2.googleapis.com/token"); return new Response(JSON.stringify({ access_token: "synthetic-token" })); };
  assert.equal(await driveAccessToken(owner("dwd")), "synthetic-token");
  assert.equal(requests, 2);
});

test("local OAuth still uses its existing cached token path", async () => {
  process.env.FIKA_RUNTIME_MODE = "local";
  Reflect.set(process.env, "NODE_ENV", "test");
  process.env.FIREBASE_PROJECT_ID = "fika-os-dev";
  const dir = await mkdtemp(path.join(os.tmpdir(), "fika-drive-containment-"));
  try {
    process.env.GOOGLE_OAUTH_CLIENT_FILE = path.join(dir, "client.json");
    process.env.GOOGLE_OAUTH_TOKEN_FILE = path.join(dir, "token.json");
    await writeFile(process.env.GOOGLE_OAUTH_CLIENT_FILE, JSON.stringify({ installed: { client_id: "test", client_secret: "test" } }));
    await writeFile(process.env.GOOGLE_OAUTH_TOKEN_FILE, JSON.stringify({ access_token: "cached-test-token", refresh_token: "test", expiry_date: Date.now() + 120_000 }));
    globalThis.fetch = async () => { throw new Error("unexpected network"); };
    assert.equal(await driveAccessToken(owner("local-oauth")), "cached-test-token");
  } finally {
    await rm(path.join(dir, "client.json"), { force: true });
    await rm(path.join(dir, "token.json"), { force: true });
    await rmdir(dir);
  }
});
