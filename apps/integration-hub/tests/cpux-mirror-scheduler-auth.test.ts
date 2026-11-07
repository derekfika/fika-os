import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { HOSPITALITY_MIRROR_SCHEDULER_AUDIENCE, hospitalityMirrorSchedulerRequestAllowed, hospitalityMirrorSchedulerServiceAccountFor } from "../lib/cpux-mirror/scheduler-auth";

const PROJECT = "fika-os-dev";
const RUNTIME = { projectId: PROJECT, mode: "staging" };
const NOW = 1_800_000_000_000;
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certs = async () => ({ key1: key.publicKey.export({ type: "spki", format: "pem" }).toString() });

function token(claims: Record<string, unknown> = {}, signingKey = key, kid = "key1") {
  const seconds = NOW / 1000;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: HOSPITALITY_MIRROR_SCHEDULER_AUDIENCE,
    email: hospitalityMirrorSchedulerServiceAccountFor(PROJECT), email_verified: true,
    iat: seconds - 10, exp: seconds + 300, ...claims,
  })).toString("base64url");
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(signingKey.privateKey).toString("base64url")}`;
}

const call = (authorization?: string, runtime = RUNTIME, certSource = certs) => hospitalityMirrorSchedulerRequestAllowed(
  { headers: { get: name => name.toLowerCase() === "authorization" ? authorization ?? null : null } },
  runtime, { certs: certSource, now: () => NOW },
);

test("accepts only a Google-signed token for the dedicated project Scheduler and fixed route audience", async () => {
  assert.equal(await call(`Bearer ${token()}`), true);
  assert.equal(await call(`Bearer ${token()}`, { projectId: "fika-os", mode: "production" }), false);
  assert.equal(await call(`Bearer ${token({ aud: "https://other.example" })}`), false);
  assert.equal(await call(`Bearer ${token({ email: "other@fika-os-dev.iam.gserviceaccount.com" })}`), false);
  assert.equal(await call(`Bearer ${token({ email_verified: false })}`), false);
  assert.equal(await call(`Bearer ${token({ exp: NOW / 1000 })}`), false);
  assert.equal(await call(`Bearer ${token({ iat: NOW / 1000 + 61 })}`), false);
  assert.equal(await call(`Bearer ${token({ nbf: NOW / 1000 + 61 })}`), false);
  assert.equal(await call(`Bearer ${token({}, otherKey)}`), false);
  assert.equal(await call(undefined), false);
  assert.equal(await call("Bearer"), false);
});

test("rejects unsupported runtime modes and unavailable Google signing certificates", async () => {
  assert.equal(await call(`Bearer ${token()}`, { projectId: "unknown", mode: "production" }), false);
  assert.equal(await call(`Bearer ${token()}`, { projectId: "fika-os", mode: "staging" }), false);
  assert.equal(await call(`Bearer ${token()}`, RUNTIME, async () => { throw new Error("offline"); }), false);
});
