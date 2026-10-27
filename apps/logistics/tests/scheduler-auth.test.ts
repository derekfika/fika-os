import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";
import { SCHEDULER_AUDIENCE, schedulerRequestAllowed, schedulerServiceAccountFor } from "../lib/scheduler-auth";

const PROJECT = "fika-os-dev";
const NOW = 1_800_000_000_000;
const pair = generateKeyPair();
const other = generateKeyPair();
function generateKeyPair() { return generateKeyPairSync("rsa", { modulusLength: 2048 }); }
const certs = async () => ({ "key-1": pair.publicKey.export({ type: "spki", format: "pem" }).toString() });

function token(claims: Record<string, unknown> = {}, options: { key?: typeof pair; kid?: string; alg?: string } = {}) {
  const seconds = NOW / 1000;
  const header = Buffer.from(JSON.stringify({ alg: options.alg ?? "RS256", kid: options.kid ?? "key-1", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: SCHEDULER_AUDIENCE, email: schedulerServiceAccountFor(PROJECT), email_verified: true, iat: seconds - 10, exp: seconds + 3000, ...claims })).toString("base64url");
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign((options.key ?? pair).privateKey).toString("base64url")}`;
}
const call = (authorization: string | undefined) => schedulerRequestAllowed({ headers: { get: (name: string) => name.toLowerCase() === "authorization" ? authorization ?? null : null } }, PROJECT, { certs, now: () => NOW });

test("a Google-signed token for this project's scheduler service account is accepted", async () => {
  assert.equal(await call(`Bearer ${token()}`), true);
});

test("everything else is refused: no header, wrong audience, other account, other project, unverified, expired, wrong signer, tampered, wrong algorithm", async () => {
  assert.equal(await call(undefined), false);
  assert.equal(await call("Bearer"), false);
  assert.equal(await call(`Bearer ${token({ aud: "https://example.com" })}`), false, "wrong audience");
  assert.equal(await call(`Bearer ${token({ email: "attacker@example.iam.gserviceaccount.com" })}`), false, "other account");
  assert.equal(await call(`Bearer ${token({ email: schedulerServiceAccountFor("fika-os-prod") })}`), false, "another project's scheduler account");
  assert.equal(await call(`Bearer ${token({ email_verified: false })}`), false);
  assert.equal(await call(`Bearer ${token({ exp: NOW / 1000 - 3600 })}`), false, "expired");
  assert.equal(await call(`Bearer ${token({ iss: "https://evil.example" })}`), false);
  assert.equal(await call(`Bearer ${token({}, { key: other })}`), false, "signed by a key Google does not publish");
  assert.equal(await call(`Bearer ${token({}, { kid: "unknown" })}`), false);
  assert.equal(await call(`Bearer ${token({}, { alg: "none" })}`), false);
  const good = token();
  const [h, p, s] = good.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), email: "attacker@x.com" })).toString("base64url");
  assert.equal(await call(`Bearer ${h}.${forged}.${s}`), false, "payload changed after signing");
});

test("an unreachable certificate source fails closed instead of throwing", async () => {
  const refused = await schedulerRequestAllowed({ headers: { get: () => `Bearer ${token()}` } }, PROJECT, { certs: async () => { throw new Error("offline"); }, now: () => NOW });
  assert.equal(refused, false);
});
