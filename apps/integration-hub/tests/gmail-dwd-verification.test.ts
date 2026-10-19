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
