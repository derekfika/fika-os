import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function scryptAsync(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => error ? reject(error) : resolve(derived as Buffer));
  });
}
export const GALLAGHER_COOKIE = "fika_gallagher_session";
export const GALLAGHER_SESSION_SECONDS = 6 * 60 * 60;
export const GALLAGHER_COOKIE_PATH = "/angel-court/gallagher";
const failureWindowMs = 15 * 60_000;
const maxFailures = 5;
const maxFailureKeys = 5000;
const failures = new Map<string, { count: number; expiresAt: number }>();
let overflowBlockedUntil = 0;
let lastFailureCleanup = 0;

type SessionPayload = { exp: number; nonce: string; v: 1 };

function pinHashConfig() {
  const value = process.env.GALLAGHER_DASHBOARD_PIN_HASH?.trim() || "";
  const parts = value.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || !/^[a-f0-9]{32,128}$/i.test(parts[4]) || !/^[a-f0-9]{128}$/i.test(parts[5])) return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![16384, 32768].includes(N) || r !== 8 || p !== 1) return null;
  return { N, r, p, salt: Buffer.from(parts[4], "hex"), expected: Buffer.from(parts[5], "hex") };
}

function sessionSecret() {
  const secret = process.env.GALLAGHER_DASHBOARD_SESSION_SECRET?.trim() || "";
  if (Buffer.byteLength(secret) < 32) return null;
  return secret;
}

export function createGallagherPinHash(pin: string, salt = randomBytes(16)) {
  if (!/^\d{4,12}$/.test(pin)) throw new Error("Use a 4–12 digit PIN.");
  const hash = scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function gallagherSessionReady() {
  return Boolean(pinHashConfig() && sessionSecret());
}

export async function verifyGallagherPin(pin: string) {
  const config = pinHashConfig();
  if (!config || !/^\d{4,12}$/.test(pin)) return false;
  const actual = await scryptAsync(pin, config.salt, config.expected.length, { N: config.N, r: config.r, p: config.p, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return timingSafeEqual(actual, config.expected);
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createGallagherSession() {
  const secret = sessionSecret();
  if (!secret) throw new Error("Gallagher dashboard session signing is not configured.");
  const payload: SessionPayload = { v: 1, exp: Math.floor(Date.now() / 1000) + GALLAGHER_SESSION_SECONDS, nonce: randomBytes(16).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function hasGallagherSession(request: NextRequest) {
  const secret = sessionSecret();
  if (!secret) return false;
  const token = request.cookies.get(GALLAGHER_COOKIE)?.value || "";
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) return false;
  const expected = Buffer.from(signature(encoded, secret));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    return payload.v === 1 && Number.isSafeInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000) && /^[A-Za-z0-9_-]{20,}$/.test(payload.nonce);
  } catch { return false; }
}

export function gallagherSessionCookie(token: string, maxAge = GALLAGHER_SESSION_SECONDS) {
  return `${GALLAGHER_COOKIE}=${token}; Path=${GALLAGHER_COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function requestKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function pinAttemptRateLimited(request: NextRequest) {
  const now = Date.now();
  if (overflowBlockedUntil > now) return true;
  const key = requestKey(request);
  const bucket = failures.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    failures.delete(key);
    return false;
  }
  return bucket.count >= maxFailures;
}

export function recordFailedPinAttempt(request: NextRequest) {
  const now = Date.now();
  const key = requestKey(request);
  if (now - lastFailureCleanup >= 60_000) {
    for (const [candidate, bucket] of failures) if (bucket.expiresAt <= now) failures.delete(candidate);
    lastFailureCleanup = now;
  }
  if (!failures.has(key) && failures.size >= maxFailureKeys) {
    overflowBlockedUntil = now + failureWindowMs;
    return;
  }
  const current = failures.get(key);
  failures.set(key, { count: (current?.expiresAt && current.expiresAt > now ? current.count : 0) + 1, expiresAt: current?.expiresAt && current.expiresAt > now ? current.expiresAt : now + failureWindowMs });
}

export function clearFailedPinAttempts(request: NextRequest) {
  failures.delete(requestKey(request));
}

export function clearFailureBucketsForTests() {
  failures.clear();
  overflowBlockedUntil = 0;
  lastFailureCleanup = 0;
}
