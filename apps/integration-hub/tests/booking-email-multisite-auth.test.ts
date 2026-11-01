import assert from "node:assert/strict";
import test from "node:test";
import { resolveBookingOutbound, resolveBookingSender } from "../lib/booking-email-delivery";
import { HOSPITALITY_EMAIL_SITE_IDENTITIES } from "../lib/booking-email-site-identities";
import { workspaceGmailToken } from "../lib/workspace-gmail-dwd";

const mailer = "fika-os-mailer@fika-os.iam.gserviceaccount.com";
const baseEnv = { FIKA_HOSPITALITY_EMAIL_MAILER_SERVICE_ACCOUNT: mailer };
const lifecycle = ["submitted", "confirmed", "amended", "cancelled"] as const;

function sender(identity: (typeof HOSPITALITY_EMAIL_SITE_IDENTITIES)[keyof typeof HOSPITALITY_EMAIL_SITE_IDENTITIES], authenticatedAccount: string = identity.primaryMailbox, verifiedSendAs = true) {
  return { from: identity.from, replyTo: identity.replyTo, authenticatedAccount, displayName: `${identity.siteId} Hospitality`, verifiedSendAs, enabled: [...lifecycle] };
}

test("code-owned identities bind each supported site's canonical OPLOC to its fixed From and Reply-To", () => {
  assert.equal(Object.keys(HOSPITALITY_EMAIL_SITE_IDENTITIES).length, 5);
  for (const [oplocId, identity] of Object.entries(HOSPITALITY_EMAIL_SITE_IDENTITIES)) {
    const configured = sender(identity);
    const resolved = resolveBookingSender(oplocId, "submitted", {
      ...baseEnv,
      FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ [oplocId]: configured }),
    });
    assert.equal(resolved.from, identity.from);
    assert.equal(resolved.replyTo, identity.replyTo);
    assert.equal(resolved.authenticatedAccount, identity.primaryMailbox);
    assert.equal(resolved.oplocId, oplocId);
    assert.deepEqual(resolved.enabled, lifecycle);
  }
});

test("a sender config cannot impersonate another OPLOC or use a client-selected identity", () => {
  const [[cfcOploc, cfc], [, mnk]] = Object.entries(HOSPITALITY_EMAIL_SITE_IDENTITIES);
  assert.throws(() => resolveBookingSender(cfcOploc, "submitted", {
    ...baseEnv,
    FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ [cfcOploc]: { ...sender(cfc), from: mnk.from, replyTo: mnk.replyTo } }),
  }), /does not match its OPLOC identity/);
  assert.throws(() => resolveBookingSender("oploc:client-selected", "submitted", {
    ...baseEnv,
    FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ "oploc:client-selected": sender(cfc) }),
  }), /no approved sender identity/);
  assert.throws(() => resolveBookingSender(cfcOploc, "submitted", {
    ...baseEnv,
    FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ [cfcOploc]: { ...sender(cfc), authenticatedAccount: mnk.primaryMailbox } }),
  }), /not explicitly authorised/);
});

test("verified Send As requires the delegated mailbox to be explicitly allowlisted for that OPLOC", async () => {
  const [[cfcOploc, cfc], [, mnk]] = Object.entries(HOSPITALITY_EMAIL_SITE_IDENTITIES);
  const delegate = "hospitality-delegate@fikacatering.com";
  const env = {
    ...baseEnv,
    FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ [cfcOploc]: sender(cfc, delegate) }),
    FIKA_HOSPITALITY_EMAIL_AUTHENTICATED_ACCOUNTS_JSON: JSON.stringify({ [cfcOploc]: [delegate] }),
  };
  assert.equal(resolveBookingSender(cfcOploc, "confirmed", env).authenticatedAccount, delegate);
  let signedClaims: Record<string, unknown> | undefined;
  const token = await workspaceGmailToken(delegate, env, {
    signJwt: async (serviceAccountEmail, claims) => { assert.equal(serviceAccountEmail, mailer); signedClaims = claims; return "opaque-assertion"; },
    exchangeJwt: async assertion => { assert.equal(assertion, "opaque-assertion"); return "opaque-token"; },
  }, cfcOploc);
  assert.equal(token, "opaque-token");
  assert.equal(signedClaims?.iss, mailer);
  assert.equal(signedClaims?.sub, delegate);
  assert.equal(signedClaims?.scope, "https://www.googleapis.com/auth/gmail.send");
  assert.equal(signedClaims?.aud, "https://oauth2.googleapis.com/token");
  assert.ok(Number.isInteger(signedClaims?.iat));
  assert.equal(signedClaims?.exp, (signedClaims?.iat as number) + 3600);
  let signingAttempts = 0;
  await assert.rejects(workspaceGmailToken(mnk.primaryMailbox, env, {
    signJwt: async () => { signingAttempts++; return "must-not-sign"; },
    exchangeJwt: async () => "must-not-exchange",
  }, cfcOploc));
  assert.equal(signingAttempts, 0);
  assert.throws(() => resolveBookingSender(cfcOploc, "submitted", {
    ...env,
    FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ [cfcOploc]: sender(cfc, delegate, false) }),
  }), /has not been verified/);
});

test("malformed or out-of-domain mailbox allowlists fail closed", () => {
  const [oplocId, identity] = Object.entries(HOSPITALITY_EMAIL_SITE_IDENTITIES)[0];
  const config = { ...baseEnv, FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ [oplocId]: sender(identity) }) };
  assert.throws(() => resolveBookingSender(oplocId, "submitted", { ...config, FIKA_HOSPITALITY_EMAIL_AUTHENTICATED_ACCOUNTS_JSON: "not-json" }), /allowlist is invalid/);
  assert.throws(() => resolveBookingSender(oplocId, "submitted", {
    ...config,
    FIKA_HOSPITALITY_EMAIL_AUTHENTICATED_ACCOUNTS_JSON: JSON.stringify({ [oplocId]: ["delegate@example.net"] }),
  }), /allowlist is invalid/);
  assert.throws(() => resolveBookingSender(oplocId, "submitted", {
    ...config,
    FIKA_HOSPITALITY_EMAIL_AUTHENTICATED_ACCOUNTS_JSON: JSON.stringify({ "oploc:unregistered": [identity.primaryMailbox] }),
  }), /allowlist is invalid/);
});

test("malformed sender maps and inherited object keys never grant a sender or token", async () => {
  const [oplocId, identity] = Object.entries(HOSPITALITY_EMAIL_SITE_IDENTITIES)[0];
  for (const value of ["null", "[]", "false", "42", "not-json"]) {
    assert.throws(() => resolveBookingSender(oplocId, "submitted", { FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: value }), /configuration is invalid/);
  }
  for (const key of ["constructor", "__proto__", "toString"]) {
    assert.throws(() => resolveBookingSender(key, "submitted", baseEnv), /no approved sender identity/);
    let signed = false;
    await assert.rejects(workspaceGmailToken(identity.primaryMailbox, baseEnv, { signJwt: async () => { signed = true; return "never"; } }, key));
    assert.equal(signed, false);
  }
});

test("adding site sender configuration cannot bypass the staging outbound isolation gate", () => {
  for (const [oplocId, identity] of Object.entries(HOSPITALITY_EMAIL_SITE_IDENTITIES)) {
    const env = { ...baseEnv, FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify({ [oplocId]: sender(identity) }) };
    assert.equal(resolveBookingSender(oplocId, "submitted", env).oplocId, oplocId);
    assert.throws(() => resolveBookingOutbound(env));
  }
});
