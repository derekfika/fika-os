import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { assertSameOrigin } from "@/lib/csrf";
import { hostedRuntime } from "@/lib/runtime";
import { clearMobileCookie, MOBILE_SESSION_COOKIE, mobileCookie, reserveMobilePinAttempt, signMobilePinSession, verifyMobilePin, verifyMobilePinSession, type MobileVehicleId } from "@/lib/mobile-pin-session";

const RATE_LIMIT_COLLECTION = "fikaLogisticsMobilePinRateLimitsV1";
const pinVerifier = (vehicleId: MobileVehicleId) => process.env[vehicleId === "van1" ? "LOGISTICS_MOBILE_VAN1_PIN_VERIFIER" : "LOGISTICS_MOBILE_VAN2_PIN_VERIFIER"];
const isVehicle = (value: unknown): value is MobileVehicleId => value === "van1" || value === "van2";
const isSecure = () => hostedRuntime();

async function reserveAttempt(vehicleId: MobileVehicleId, now = Date.now()) {
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(vehicleId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() as { attempts?: unknown; windowStartedAt?: unknown; lockedUntil?: unknown } | undefined;
    const transition = reserveMobilePinAttempt(current ? { attempts: Number(current.attempts) || 0, windowStartedAt: Number(current.windowStartedAt) || 0, lockedUntil: Number(current.lockedUntil) || 0 } : undefined, now);
    if (transition.allowed && transition.state) transaction.set(ref, { ...transition.state, updatedAt: now });
    return transition.allowed;
  });
}

async function clearAttempts(vehicleId: MobileVehicleId) {
  await db.collection(RATE_LIMIT_COLLECTION).doc(vehicleId).delete();
}

function sameOrigin(request: NextRequest) {
  if (hostedRuntime()) assertSameOrigin(request);
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(MOBILE_SESSION_COOKIE)?.value;
  const expectedVehicle = request.nextUrl.searchParams.get("vehicle");
  const session = verifyMobilePinSession(token, {
    secret: process.env.LOGISTICS_MOBILE_SESSION_SECRET,
    verifiers: { van1: pinVerifier("van1"), van2: pinVerifier("van2") },
  });
  if (!session) return NextResponse.json({ error: { code: "LOGISTICS_MOBILE_SESSION_REQUIRED", message: "Enter the vehicle PIN to continue." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (expectedVehicle && expectedVehicle !== session.vehicleId) return NextResponse.json({ error: { code: "LOGISTICS_MOBILE_VEHICLE_DENIED", message: "This session is for a different vehicle." } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ vehicleId: session.vehicleId, expiresAt: session.expiresAt }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const body = await request.json().catch(() => null) as { vehicleId?: unknown; pin?: unknown } | null;
    if (!body || !isVehicle(body.vehicleId) || typeof body.pin !== "string" || !/^\d{6,12}$/.test(body.pin)) return NextResponse.json({ error: { code: "LOGISTICS_MOBILE_PIN_INVALID", message: "Enter the vehicle PIN." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const vehicleId = body.vehicleId;
    const verifier = pinVerifier(vehicleId);
    const sessionSecret = process.env.LOGISTICS_MOBILE_SESSION_SECRET;
    if (!verifier || !sessionSecret) return NextResponse.json({ error: { code: "LOGISTICS_MOBILE_AUTH_NOT_CONFIGURED", message: "Vehicle sign-in is not configured." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const allowed = await reserveAttempt(vehicleId).catch(() => { throw Object.assign(new Error("Vehicle sign-in is temporarily unavailable."), { status: 503 }); });
    if (!allowed) return NextResponse.json({ error: { code: "LOGISTICS_MOBILE_PIN_RATE_LIMITED", message: "Too many attempts. Wait 15 minutes before trying again." } }, { status: 429, headers: { "Cache-Control": "no-store" } });
    if (!await verifyMobilePin(body.pin, verifier)) return NextResponse.json({ error: { code: "LOGISTICS_MOBILE_PIN_INVALID", message: "The vehicle PIN is not valid." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
    await clearAttempts(vehicleId).catch(() => { throw Object.assign(new Error("Vehicle sign-in is temporarily unavailable."), { status: 503 }); });
    const token = signMobilePinSession({ vehicleId, verifier, secret: sessionSecret });
    const session = verifyMobilePinSession(token, { secret: sessionSecret, verifiers: { [vehicleId]: verifier } });
    if (!session) throw new Error("Vehicle session could not be established.");
    return NextResponse.json({ vehicleId, expiresAt: session.expiresAt }, { headers: { "Cache-Control": "no-store", "Set-Cookie": mobileCookie(token, isSecure()) } });
  } catch (error) {
    const status = (error as { status?: number }).status || 403;
    return NextResponse.json({ error: { code: status === 503 ? "LOGISTICS_MOBILE_AUTH_UNAVAILABLE" : "LOGISTICS_MOBILE_ORIGIN_REQUIRED", message: status === 503 ? "Vehicle sign-in is temporarily unavailable." : "A same-origin sign-in request is required." } }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: NextRequest) {
  try { sameOrigin(request); }
  catch { return NextResponse.json({ error: { code: "LOGISTICS_MOBILE_ORIGIN_REQUIRED", message: "A same-origin request is required." } }, { status: 403, headers: { "Cache-Control": "no-store", "Set-Cookie": clearMobileCookie(isSecure()) } }); }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": clearMobileCookie(isSecure()) } });
}
