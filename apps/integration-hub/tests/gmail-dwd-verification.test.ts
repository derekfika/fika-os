import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { verifyStagingGmailDwd, workspaceGmailToken } from "../lib/workspace-gmail-dwd";
import { POST } from "../app/api/internal/gmail-dwd-verify/route";
import { NextRequest } from "next/server";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { FIKA_RUNTIME_MODE: "staging", FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED: "false", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER: JSON.stringify({ type: "service_account", client_email: "test@example.iam.gserviceaccount.com", private_key: key }) };

test("verification requests send-only delegated token and returns no secrets, with no Gmail calls", async () => {
  let calls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No HTTP calls allowed in this injected token test"); };
  try {
    const result = await verifyStagingGmailDwd(env, options => {
      calls++;
      assert.equal(options.subject, "mnk@fikacatering.com");
      assert.deepEqual(options.scopes, ["https://www.googleapis.com/auth/gmail.send"]);
      assert.equal(options.email, "test@example.iam.gserviceaccount.com");
      assert.equal(options.key, key);
      return { getAccessToken: async () => ({ token: "secret-token" }) };
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { secretReadable: true, dwdImpersonationSucceeded: true, mailbox: "mnk@fikacatering.com", tokenRequestSucceeded: true, emailsSent: 0 });
  } finally { globalThis.fetch = oldFetch; }
});

test("missing/malformed credentials stop before constructing JWT; no old-secret fallback", async () => {
  for (const value of [undefined, "invalid", "null", JSON.stringify({ type: "service_account", client_email: "test@example.iam.gserviceaccount.com", private_key: "invalid" })]) {
    const config = { ...env, GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER: value, GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER };
    const result = await verifyStagingGmailDwd(config, () => { assert.fail("Must not construct JWT"); });
    assert.equal(result.tokenRequestSucceeded, false);
    assert.equal(result.emailsSent, 0);
  }
});

test("DWD errors and empty tokens fail safely without leaking request secrets", async () => {
  for (const getAccessToken of [async () => { throw new Error(key + "secret-token"); }, async () => ({ token: null })]) {
    const result = await verifyStagingGmailDwd(env, () => ({ getAccessToken }));
    assert.equal(result.dwdImpersonationSucceeded, false);
    assert.equal(result.tokenRequestSucceeded, false);
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  }
});

test("production/local and enabled or unspecified delivery cannot request tokens", async () => {
  for (const config of [{ ...env, FIKA_RUNTIME_MODE: "production" }, { ...env, FIKA_RUNTIME_MODE: "local" }, { ...env, FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED: "true" }, { ...env, FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED: undefined }]) {
    await assert.rejects(verifyStagingGmailDwd(config, () => { assert.fail("Must not construct JWT"); }));
  }
  await assert.rejects(workspaceGmailToken("invalid", env));
});

test("route denies non-staging and unauthenticated requests before token exchange", async () => {
  const original = { ...process.env };
  try {
    process.env.FIKA_RUNTIME_MODE = "production";
    assert.equal((await POST(new NextRequest("https://example.test/api/internal/gmail-dwd-verify", { method: "POST" }))).status, 404);
    process.env.FIKA_RUNTIME_MODE = "staging";
    process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED = "false";
    process.env.FIKA_INTERNAL_API_TOKEN = "test-internal-token";
    assert.equal((await POST(new NextRequest("https://example.test/api/internal/gmail-dwd-verify", { method: "POST" }))).status, 401);
  } finally { process.env = original; }
});
