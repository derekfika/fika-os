import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { HANDOFF_SCHEDULER_AUDIENCE, schedulerRequestAllowed, schedulerServiceAccountFor, STANDING_ORDER_SCHEDULER_AUDIENCE } from "../lib/scheduler-auth";

const PROJECT = "fika-os-dev";
const RUNTIME = { projectId: PROJECT, mode: "staging" };
const NOW = 1_800_000_000_000;
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certs = async () => ({ "key-1": key.publicKey.export({ type: "spki", format: "pem" }).toString() });

function token(claims: Record<string, unknown> = {}, signingKey = key, kid = "key-1", alg = "RS256") {
  const seconds = NOW / 1000;
  const header = Buffer.from(JSON.stringify({ alg, kid, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: STANDING_ORDER_SCHEDULER_AUDIENCE,
    email: schedulerServiceAccountFor(PROJECT), email_verified: true,
    iat: seconds - 10, exp: seconds + 300, ...claims,
  })).toString("base64url");
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(signingKey.privateKey).toString("base64url")}`;
}

const call = (authorization: string | undefined, runtime = RUNTIME, audience = STANDING_ORDER_SCHEDULER_AUDIENCE, certSource = certs) =>
  schedulerRequestAllowed(
    { headers: { get: name => name.toLowerCase() === "authorization" ? authorization ?? null : null } },
    runtime,
    audience,
    { certs: certSource, now: () => NOW },
  );

test("accepts a Google-signed token for the exact environment identity and endpoint audience", async () => {
  assert.equal(await call(`Bearer ${token()}`), true);
  assert.equal(await call(`Bearer ${token({}, key, "key-1")}`, { projectId: "fika-os", mode: "production" }), false, "a staging token cannot authenticate to production");
  assert.equal(await call(`Bearer ${token()}`, RUNTIME, HANDOFF_SCHEDULER_AUDIENCE), false, "audiences are endpoint-specific");
  assert.equal(await call(`Bearer ${token({ aud: HANDOFF_SCHEDULER_AUDIENCE })}`, RUNTIME, HANDOFF_SCHEDULER_AUDIENCE), true);
});

test("rejects absent, malformed, wrong-issuer, wrong-audience, wrong-identity, expired and future tokens", async () => {
  assert.equal(await call(undefined), false);
  assert.equal(await call("Bearer"), false);
  assert.equal(await call(`Bearer ${token({ iss: "https://attacker.example" })}`), false);
  assert.equal(await call(`Bearer ${token({ aud: "https://example.com" })}`), false);
  assert.equal(await call(`Bearer ${token({ email: "other@fika-os-dev.iam.gserviceaccount.com" })}`), false);
  assert.equal(await call(`Bearer ${token({ email: schedulerServiceAccountFor("fika-os") })}`), false);
  assert.equal(await call(`Bearer ${token({ email_verified: false })}`), false);
  assert.equal(await call(`Bearer ${token({ exp: NOW / 1000 })}`), false);
  assert.equal(await call(`Bearer ${token({ iat: NOW / 1000 + 61 })}`), false);
  assert.equal(await call(`Bearer ${token({ nbf: NOW / 1000 + 61 })}`), false);
});

test("rejects unsupported projects, environment mismatches, unknown keys, signatures and algorithms", async () => {
  assert.equal(await call(`Bearer ${token()}`, { projectId: "fika-os-local", mode: "local" }), false);
  assert.equal(await call(`Bearer ${token()}`, { projectId: "fika-os", mode: "staging" }), false);
  assert.equal(await call(`Bearer ${token({}, otherKey)}`), false);
  assert.equal(await call(`Bearer ${token({}, key, "unknown")}`), false);
  assert.equal(await call(`Bearer ${token({}, key, "key-1", "none")}`), false);
  const [header, payload] = token().split(".");
  assert.equal(await call(`Bearer ${header}.${Buffer.from(JSON.stringify({ email: "attacker@example.com" })).toString("base64url")}.AA`), false);
});

test("fails closed when Google's signing certificates cannot be read", async () => {
  assert.equal(await call(`Bearer ${token()}`, RUNTIME, STANDING_ORDER_SCHEDULER_AUDIENCE, async () => { throw new Error("offline"); }), false);
});
