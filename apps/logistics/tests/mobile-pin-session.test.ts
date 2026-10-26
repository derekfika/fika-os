import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import test from "node:test";
import { MOBILE_PIN_ATTEMPT_LIMIT, MOBILE_PIN_WINDOW_MS, MOBILE_SESSION_TTL_SECONDS, reserveMobilePinAttempt, signMobilePinSession, verifierFingerprint, verifyMobilePin, verifyMobilePinSession } from "../lib/mobile-pin-session";

const secret = "test-only-session-secret-long-enough-32-bytes";

async function verifierFor(pin: string) {
  const salt = randomBytes(16);
  const hash = await new Promise<Buffer>((resolve, reject) => scryptCallback(pin, salt, 32, { N: 16384, r: 8, p: 1 }, (error, value) => error ? reject(error) : resolve(value as Buffer)));
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

test("PIN verifier accepts the configured PIN and rejects incorrect or malformed verifier values", async () => {
  const verifier = await verifierFor("482901");
  assert.equal(await verifyMobilePin("482901", verifier), true);
  assert.equal(await verifyMobilePin("482902", verifier), false);
  assert.equal(await verifyMobilePin("482901", "plaintext-secret"), false);
});

test("vehicle PIN session is signed, short-lived, tamper evident, and invalidated by PIN rotation", async () => {
  const verifier = await verifierFor("482901");
  const token = signMobilePinSession({ vehicleId: "van1", verifier, secret, now: 1_800_000_000_000, sessionId: "test-mobile-session-0001" });
  const verifiers = { van1: verifier, van2: await verifierFor("999999") };
  assert.deepEqual(verifyMobilePinSession(token, { secret, verifiers, now: 1_800_000_000_000 }), {
    vehicleId: "van1", sessionId: "test-mobile-session-0001", issuedAt: 1_800_000_000_000, expiresAt: 1_800_000_000_000 + MOBILE_SESSION_TTL_SECONDS * 1000,
  });
  assert.equal(verifyMobilePinSession(`${token}x`, { secret, verifiers, now: 1_800_000_000_000 }), undefined);
  assert.equal(verifyMobilePinSession(token, { secret: `${secret}rotated`, verifiers, now: 1_800_000_000_000 }), undefined);
  assert.equal(verifyMobilePinSession(token, { secret, verifiers: { van1: await verifierFor("111111") }, now: 1_800_000_000_000 }), undefined);
  assert.equal(verifyMobilePinSession(token, { secret, verifiers, now: 1_800_000_000_000 + MOBILE_SESSION_TTL_SECONDS * 1000 }), undefined);
  assert.equal(verifierFingerprint(verifier), verifierFingerprint(verifier));
});

test("PIN attempt limiter allows five tries, locks the vehicle for 15 minutes, then opens a fresh window", () => {
  const now = 1_800_000_000_000;
  let state: ReturnType<typeof reserveMobilePinAttempt>["state"];
  for (let attempt = 1; attempt <= MOBILE_PIN_ATTEMPT_LIMIT; attempt++) {
    const transition = reserveMobilePinAttempt(state, now + attempt);
    assert.equal(transition.allowed, true);
    state = transition.state;
  }
  assert.equal(reserveMobilePinAttempt(state, now + MOBILE_PIN_ATTEMPT_LIMIT + 1).allowed, false);
  const nextWindow = reserveMobilePinAttempt(state, now + MOBILE_PIN_WINDOW_MS + MOBILE_PIN_ATTEMPT_LIMIT + 2);
  assert.equal(nextWindow.allowed, true);
  assert.equal(nextWindow.state?.attempts, 1);
});
