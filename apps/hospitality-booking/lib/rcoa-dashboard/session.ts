import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const COOKIE = "fika_rcoa_dashboard_session";
export const RCOA_SESSION_SECONDS = 6 * 60 * 60;
export const RCOA_COOKIE_PATH = "/rcoa/bookings";
const windowMs = 15 * 60_000;
const maxFailures = 5;
const maxKeys = 2_000;
const maxGlobalFailures = 60;
const failures = new Map<string, { count: number; expiresAt: number }>();
let global = { count: 0, expiresAt: 0 };
let blockedUntil = 0;

type SessionPayload = { exp: number; nonce: string; v: 1 };

function hashConfig() {
  const parts = (process.env.RCOA_DASHBOARD_PIN_HASH || "").trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || !/^16384$/.test(parts[1]) || parts[2] !== "8" || parts[3] !== "1" || !/^[a-f0-9]{32}$/i.test(parts[4]) || !/^[a-f0-9]{128}$/i.test(parts[5])) return null;
  return { salt: Buffer.from(parts[4], "hex"), expected: Buffer.from(parts[5], "hex") };
}
function secret() { const value = process.env.RCOA_DASHBOARD_SESSION_SECRET?.trim() || ""; return Buffer.byteLength(value) >= 32 ? value : null; }
function sign(payload: string, key: string) { return createHmac("sha256", key).update(payload).digest("base64url"); }
function requestKey(request: NextRequest) {
  const hops = (request.headers.get("x-forwarded-for") || "").split(",").map(value => value.trim()).filter(Boolean);
  return hops.at(-1) || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function scryptAsync(pin: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key as Buffer)));
}

export function createRcoaPinHash(pin: string, salt = randomBytes(16)) {
  if (!/^\d{4,12}$/.test(pin)) throw new Error("Use a 4–12 digit RCoA dashboard PIN.");
  const derived = scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function rcoaSessionReady() { return Boolean(hashConfig() && secret()); }
export async function verifyRcoaPin(pin: string) {
  const config = hashConfig();
  if (!config || !/^\d{4,12}$/.test(pin)) return false;
  const actual = await scryptAsync(pin, config.salt);
  return timingSafeEqual(actual, config.expected);
}
export function createRcoaSession() {
  const key = secret();
  if (!key) throw new Error("RCoA dashboard session signing is not configured.");
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: Math.floor(Date.now() / 1000) + RCOA_SESSION_SECONDS, nonce: randomBytes(16).toString("base64url") } satisfies SessionPayload)).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}
export function hasRcoaSession(request: NextRequest) {
  const key = secret();
  if (!key) return false;
  const token = request.cookies.get(COOKIE)?.value || "";
  const [payload, provided, extra] = token.split(".");
  if (!payload || !provided || extra) return false;
  const expected = Buffer.from(sign(payload, key));
  const signature = Buffer.from(provided);
  if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    return value.v === 1 && Number.isSafeInteger(value.exp) && value.exp > Math.floor(Date.now() / 1000) && /^[A-Za-z0-9_-]{20,}$/.test(value.nonce);
  } catch { return false; }
}
export function rcoaSessionCookie(token: string, maxAge = RCOA_SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=${RCOA_COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
export function rcoaPinAttemptRateLimited(request: NextRequest) {
  const now = Date.now();
  if (blockedUntil > now || (global.expiresAt > now && global.count >= maxGlobalFailures)) return true;
  const current = failures.get(requestKey(request));
  if (!current || current.expiresAt <= now) { if (current) failures.delete(requestKey(request)); return false; }
  return current.count >= maxFailures;
}
export function recordRcoaFailedPinAttempt(request: NextRequest) {
  const now = Date.now();
  global = global.expiresAt > now ? { count: global.count + 1, expiresAt: global.expiresAt } : { count: 1, expiresAt: now + windowMs };
  const key = requestKey(request);
  for (const [candidate, value] of failures) if (value.expiresAt <= now) failures.delete(candidate);
  if (!failures.has(key) && failures.size >= maxKeys) { blockedUntil = now + windowMs; return; }
  const current = failures.get(key);
  failures.set(key, { count: current && current.expiresAt > now ? current.count + 1 : 1, expiresAt: current && current.expiresAt > now ? current.expiresAt : now + windowMs });
}
export function clearRcoaFailedPinAttempts(request: NextRequest) { failures.delete(requestKey(request)); }
export function clearRcoaFailureBucketsForTests() { failures.clear(); global = { count: 0, expiresAt: 0 }; blockedUntil = 0; }
