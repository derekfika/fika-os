import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { denied, driverVehicle } from "@/lib/driver-vehicle";
import { hostedRuntime } from "@/lib/runtime";
import { allowedPushEndpoint, vapidConfig } from "@/lib/push-config";
import { claimTestPush, countSubscriptions, removeSubscription, upsertSubscription } from "@/lib/driver-push-store";
import { sendToVehicle } from "@/lib/driver-push";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const base64url = /^[A-Za-z0-9_-]{8,200}$/;

/**
 * Web Push device registration for the signed-in van. The vehicle comes only from the signed PIN session; the browser
 * subscription (endpoint and keys) is stored server-side and never returned. Responses carry counts and the public VAPID key only.
 */
export async function GET(request: NextRequest) {
  try {
    const vehicleId = await driverVehicle(request);
    const vapid = vapidConfig();
    return NextResponse.json({ enabled: Boolean(vapid), publicKey: vapid?.publicKey ?? null, devices: vapid ? await countSubscriptions(vehicleId) : 0 }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (hostedRuntime()) assertSameOrigin(request);
    const vehicleId = await driverVehicle(request);
    const vapid = vapidConfig();
    if (!vapid) throw denied("Push notifications are not enabled in this environment.", "LOGISTICS_PUSH_NOT_CONFIGURED", 503);
    const body = await request.json().catch(() => null) as { action?: unknown; subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; endpoint?: unknown } | null;
    const now = new Date();
    if (body?.action === "subscribe") {
      const endpoint = body.subscription?.endpoint, p256dh = body.subscription?.keys?.p256dh, auth = body.subscription?.keys?.auth;
      if (!allowedPushEndpoint(endpoint) || typeof p256dh !== "string" || typeof auth !== "string" || !base64url.test(p256dh) || !base64url.test(auth)) throw denied("That push subscription is not valid.", "LOGISTICS_PUSH_SUBSCRIPTION_INVALID", 422);
      const saved = await upsertSubscription(vehicleId, { endpoint, p256dh, auth }, request.headers.get("user-agent") ?? "", now);
      return NextResponse.json({ ok: true, devices: saved.devices }, { headers: NO_STORE });
    }
    if (body?.action === "unsubscribe") {
      if (!allowedPushEndpoint(body.endpoint)) throw denied("That push subscription is not valid.", "LOGISTICS_PUSH_SUBSCRIPTION_INVALID", 422);
      await removeSubscription(vehicleId, body.endpoint);
      return NextResponse.json({ ok: true, devices: await countSubscriptions(vehicleId) }, { headers: NO_STORE });
    }
    if (body?.action === "test") {
      if (!await claimTestPush(vehicleId, now)) throw denied("Please wait a few seconds before sending another test.", "LOGISTICS_PUSH_TEST_RATE_LIMITED", 429);
      const label = vehicleId === "van2" ? "Van 2" : "Van 1";
      const result = await sendToVehicle(vehicleId, { v: 1, title: "Test notification", body: `Push notifications are working for ${label}.`, tag: "test", url: `/mobile/${vehicleId}`, vehicleId, priority: "normal" }, { vapid });
      return NextResponse.json({ ok: true, devices: result.devices, sent: result.sent, failed: result.failed + result.transient }, { headers: NO_STORE });
    }
    throw denied("That push action is not available.", "LOGISTICS_PUSH_ACTION_UNKNOWN", 422);
  } catch (error) {
    return errorResponse(error);
  }
}
