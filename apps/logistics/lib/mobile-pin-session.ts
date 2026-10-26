import { createHmac, createHash, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
export const MOBILE_SESSION_COOKIE = "fika_logistics_mobile_session";
export const MOBILE_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MOBILE_PIN_ATTEMPT_LIMIT = 5;
export const MOBILE_PIN_WINDOW_MS = 15 * 60 * 1000;
export type MobileVehicleId = "van1" | "van2";
export type MobilePinSession = { vehicleId: MobileVehicleId; sessionId: string; issuedAt: number; expiresAt: number };
export type MobilePinRateState = { attempts: number; windowStartedAt: number; lockedUntil: number };

function derivePinKey(pin: string, salt: Buffer, length: number) {
  return new Promise<Buffer>((resolve, reject) => scryptCallback(pin, salt, length, { N: 16384, r: 8, p: 1 }, (error, value) => error ? reject(error) : resolve(value as Buffer)));
}

function isVehicle(value: unknown): value is MobileVehicleId { return value === "van1" || value === "van2"; }
function fromB64(value: string) { return Buffer.from(value, "base64url"); }

export function assertMobileSessionSecret(secret: string | undefined) {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new Error("Logistics mobile session secret is unavailable.");
  return secret;
}

export function verifierFingerprint(verifier: string) {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export async function verifyMobilePin(pin: string, verifier: string) {
  const [algorithm, saltEncoded, expectedEncoded] = verifier.split("$");
  if (algorithm !== "scrypt" || !saltEncoded || !expectedEncoded) return false;
  const salt = fromB64(saltEncoded);
  const expected = fromB64(expectedEncoded);
  if (salt.length < 16 || expected.length !== 32) return false;
  const actual = await derivePinKey(pin, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export function signMobilePinSession(input: { vehicleId: MobileVehicleId; verifier: string; secret: string; now?: number; sessionId?: string }) {
  const now = input.now ?? Date.now();
  const payload: MobilePinSession & { verifierFingerprint: string } = {
    vehicleId: input.vehicleId,
    sessionId: input.sessionId || randomUUID(),
    issuedAt: now,
    expiresAt: now + MOBILE_SESSION_TTL_SECONDS * 1000,
    verifierFingerprint: verifierFingerprint(input.verifier),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", assertMobileSessionSecret(input.secret)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyMobilePinSession(token: string | undefined, input: { secret: string | undefined; verifiers: Partial<Record<MobileVehicleId, string | undefined>>; now?: number }): MobilePinSession | undefined {
  if (!token || token.length > 2048) return undefined;
  try {
    const [encoded, providedSignature, extra] = token.split(".");
    if (!encoded || !providedSignature || extra) return undefined;
    const expectedSignature = createHmac("sha256", assertMobileSessionSecret(input.secret)).update(encoded).digest();
    const actualSignature = fromB64(providedSignature);
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) return undefined;
    const payload = JSON.parse(fromB64(encoded).toString("utf8")) as MobilePinSession & { verifierFingerprint?: unknown };
    const now = input.now ?? Date.now();
    const verifier = isVehicle(payload.vehicleId) ? input.verifiers[payload.vehicleId] : undefined;
    if (!verifier || payload.verifierFingerprint !== verifierFingerprint(verifier)) return undefined;
    if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) || payload.issuedAt > now + 60_000 || payload.expiresAt <= now || payload.expiresAt - payload.issuedAt !== MOBILE_SESSION_TTL_SECONDS * 1000 || typeof payload.sessionId !== "string" || payload.sessionId.length < 16) return undefined;
    return { vehicleId: payload.vehicleId, sessionId: payload.sessionId, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt };
  } catch { return undefined; }
}

export function mobileCookie(token: string, secure: boolean) {
  return `${MOBILE_SESSION_COOKIE}=${token}; Path=/api/logistics; Max-Age=${MOBILE_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function clearMobileCookie(secure: boolean) {
  return `${MOBILE_SESSION_COOKIE}=; Path=/api/logistics; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function reserveMobilePinAttempt(state: MobilePinRateState | undefined, now: number): { allowed: boolean; state?: MobilePinRateState } {
  if (state?.lockedUntil && state.lockedUntil > now) return { allowed: false };
  const currentAttempts = state && now - state.windowStartedAt < MOBILE_PIN_WINDOW_MS ? state.attempts : 0;
  const nextAttempts = currentAttempts + 1;
  return {
    allowed: true,
    state: {
      attempts: nextAttempts,
      windowStartedAt: currentAttempts ? state!.windowStartedAt : now,
      lockedUntil: nextAttempts >= MOBILE_PIN_ATTEMPT_LIMIT ? now + MOBILE_PIN_WINDOW_MS : 0,
    },
  };
}
