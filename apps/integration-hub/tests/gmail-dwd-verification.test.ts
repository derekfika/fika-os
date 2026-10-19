import assert from "node:assert/strict";
import test from "node:test";
import { verifyGmailDwd, workspaceGmailToken } from "../lib/workspace-gmail-dwd";
import { POST } from "../app/api/internal/gmail-dwd-verify/route";
import { NextRequest } from "next/server";

const mailbox = "rcoa@fikacatering.com";
const serviceAccount = "fika-os-mailer@fika-os.iam.gserviceaccount.com";
const scope = "https://www.googleapis.com/auth/gmail.send";
const env = {
  FIKA_RUNTIME_MODE: "production",
  FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED: "false",
  FIKA_HOSPITALITY_EMAIL_DWD_VERIFY_ENABLED: "true",
  FIKA_HOSPITALITY_EMAIL_MAILER_SERVICE_ACCOUNT: serviceAccount,
  FIKA_HOSPITALITY_EMAIL_MAILER_VERIFY_MAILBOX: mailbox,
};

test("keyless diagnostic signs and exchanges only the RCoA gmail.send assertion and returns status only", async () => {
  let signedClaims: Record<string, unknown> | undefined;
  let exchangedAssertion = "";
  const result = await verifyGmailDwd(env, {
    signJwt: async (account, claims) => { assert.equal(account, serviceAccount); signedClaims = claims; return "private-assertion"; },
    exchangeJwt: async assertion => { exchangedAssertion = assertion; return "secret-access-token"; },
  });
  assert.deepEqual(signedClaims && { iss: signedClaims.iss, sub: signedClaims.sub, scope: signedClaims.scope, aud: signedClaims.aud }, {
    iss: serviceAccount, sub: mailbox, scope, aud: "https://oauth2.googleapis.com/token",
  });
  assert.equal(typeof signedClaims?.iat, "number");
  assert.equal(typeof signedClaims?.exp, "number");
  assert.equal(exchangedAssertion, "private-assertion");
  assert.deepEqual(result, { credentialMode: "keyless", credentialConfigured: true, dwdImpersonationSucceeded: true, mailbox, tokenRequestSucceeded: true, emailsSent: 0 });
  assert.equal(JSON.stringify(result).includes("private-assertion"), false);
  assert.equal(JSON.stringify(result).includes("secret-access-token"), false);
});

test("accepts a successful token response that omits unchanged scope", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers && new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    assert.equal(body.get("assertion"), "private-assertion");
    return new Response(JSON.stringify({ access_token: "secret-access-token", token_type: "Bearer", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await verifyGmailDwd(env, { signJwt: async () => "private-assertion" });
    assert.equal(calls, 1);
    assert.equal(result.dwdImpersonationSucceeded, true);
    assert.equal(result.tokenRequestSucceeded, true);
    assert.equal(result.emailsSent, 0);
    assert.equal(JSON.stringify(result).includes("secret-access-token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a successful token response that reports a different scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ access_token: "secret-access-token", scope: "https://www.googleapis.com/auth/drive" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const result = await verifyGmailDwd(env, { signJwt: async () => "private-assertion" });
    assert.equal(result.dwdImpersonationSucceeded, true);
    assert.equal(result.tokenRequestSucceeded, false);
    assert.equal(result.emailsSent, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns only an allowlisted OAuth error code and redacted description", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "invalid_grant",
    error_description: "Assertion eyJhbGciOiJub25l.e30.c2lnbmVk and access_token=secret-access-token are invalid",
    access_token: "secret-access-token",
  }), { status: 400, headers: { "content-type": "application/json" } });
  try {
    const result = await verifyGmailDwd(env, { signJwt: async () => "private-assertion" });
    assert.equal(result.dwdImpersonationSucceeded, true);
    assert.equal(result.tokenRequestSucceeded, false);
    assert.equal(result.emailsSent, 0);
    assert.deepEqual("oauthError" in result ? result.oauthError : undefined, {
      code: "invalid_grant",
      description: "Assertion [redacted assertion] and access_token=[redacted] are invalid",
    });
    assert.equal(JSON.stringify(result).includes("secret-access-token"), false);
    assert.equal(JSON.stringify(result).includes("private-assertion"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wrong or missing mailbox configuration cannot attempt delegated authentication", async () => {
  let calls = 0;
  for (const config of [{ ...env, FIKA_HOSPITALITY_EMAIL_MAILER_VERIFY_MAILBOX: "mnk@fikacatering.com" }, { ...env, FIKA_HOSPITALITY_EMAIL_MAILER_VERIFY_MAILBOX: undefined }]) {
    const result = await verifyGmailDwd(config, { signJwt: async () => { calls++; return "assertion"; } });
    assert.equal(result.mailbox, config.FIKA_HOSPITALITY_EMAIL_MAILER_VERIFY_MAILBOX || "");
    assert.equal(result.tokenRequestSucceeded, false);
  }
  assert.equal(calls, 0);
});

test("diagnostic requires production or staging with delivery explicitly disabled", async () => {
  for (const config of [
    { ...env, FIKA_RUNTIME_MODE: "local" },
    { ...env, FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED: "true" },
    { ...env, FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED: undefined },
    { ...env, FIKA_HOSPITALITY_EMAIL_DWD_VERIFY_ENABLED: "false" },
  ]) {
    await assert.rejects(verifyGmailDwd(config, { signJwt: async () => { assert.fail("Must not sign JWT"); } }));
  }
  await assert.rejects(workspaceGmailToken("mnk@fikacatering.com", env));
});

test("mailer never falls back to the Drive DWD credential", async () => {
  let calls = 0;
  await assert.rejects(workspaceGmailToken(mailbox, { ...env, FIKA_HOSPITALITY_EMAIL_MAILER_SERVICE_ACCOUNT: undefined, GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "drive-secret" }, {
    signJwt: async () => { calls++; return "assertion"; },
  }));
  assert.equal(calls, 0);
});

test("internal verifier rejects delivery-enabled runtime and unauthenticated production calls before token exchange", async () => {
  const original = { ...process.env };
  let calls = 0;
  try {
    process.env.FIKA_RUNTIME_MODE = "production";
    process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED = "true";
    process.env.FIKA_HOSPITALITY_EMAIL_DWD_VERIFY_ENABLED = "true";
    process.env.FIKA_INTERNAL_API_TOKEN = "internal-test-token";
    assert.equal((await POST(new NextRequest("https://example.test/api/internal/gmail-dwd-verify", { method: "POST" }))).status, 404);
    process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED = "false";
    process.env.FIKA_HOSPITALITY_EMAIL_DWD_VERIFY_ENABLED = "true";
    assert.equal((await POST(new NextRequest("https://example.test/api/internal/gmail-dwd-verify", { method: "POST" }))).status, 401);
    assert.equal(calls, 0);
  } finally { process.env = original; }
});
