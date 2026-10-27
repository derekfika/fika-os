export type PushState = "unsupported" | "needs-install" | "blocked" | "unavailable" | "off" | "on";

const ENDPOINT = "/api/logistics/driver-notifications/push";

type PushEnvironment = { supported: boolean; ios: boolean; standalone: boolean; permission: NotificationPermission | "unsupported" };

export function detectPush(): PushEnvironment {
  if (typeof window === "undefined") return { supported: false, ios: false, standalone: false, permission: "unsupported" };
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { supported, ios, standalone, permission: "Notification" in window ? Notification.permission : "unsupported" };
}

/** iPhone only delivers web push to an installed Home Screen app, so a plain Safari tab is told how to install it. */
export function pushStateFor(environment: PushEnvironment, serverEnabled: boolean, subscribed: boolean): PushState {
  if (environment.ios && !environment.standalone) return "needs-install";
  if (!environment.supported) return "unsupported";
  if (!serverEnabled) return "unavailable";
  if (environment.permission === "denied") return "blocked";
  return environment.permission === "granted" && subscribed ? "on" : "off";
}

const toKey = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.ready;
}

async function serverInfo(headers: HeadersInit): Promise<{ enabled: boolean; publicKey: string | null }> {
  const response = await fetch(ENDPOINT, { cache: "no-store", headers });
  const body = await response.json().catch(() => null) as { enabled?: boolean; publicKey?: string | null } | null;
  if (!response.ok || !body) throw new Error("Notification settings could not be loaded.");
  return { enabled: Boolean(body.enabled), publicKey: body.publicKey ?? null };
}

async function post(headers: HeadersInit, body: unknown) {
  const response = await fetch(ENDPOINT, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const parsed = await response.json().catch(() => null) as { error?: { message?: string }; [key: string]: unknown } | null;
  if (!response.ok) throw new Error(parsed?.error?.message || "That notification action failed.");
  return parsed ?? {};
}

/** The current state of this device, without prompting for anything. */
export async function loadPushState(headers: HeadersInit): Promise<PushState> {
  const environment = detectPush();
  if (environment.ios && !environment.standalone) return "needs-install";
  if (!environment.supported) return "unsupported";
  const info = await serverInfo(headers).catch(() => ({ enabled: false, publicKey: null }));
  const subscription = environment.permission === "granted" ? await (await registration()).pushManager.getSubscription() : null;
  return pushStateFor(environment, info.enabled, Boolean(subscription));
}

/** Must be called from a tap: the permission prompt is only allowed in response to a user gesture. */
export async function enablePush(headers: HeadersInit): Promise<PushState> {
  const environment = detectPush();
  if (environment.ios && !environment.standalone) return "needs-install";
  if (!environment.supported) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const info = await serverInfo(headers);
  if (!info.enabled || !info.publicKey) return "unavailable";
  const reg = await registration();
  const subscription = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(info.publicKey) });
  await post(headers, { action: "subscribe", subscription: subscription.toJSON() });
  return "on";
}

export async function disablePush(headers: HeadersInit): Promise<PushState> {
  const reg = await registration();
  const subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    await post(headers, { action: "unsubscribe", endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
  }
  return "off";
}

export async function sendTestPush(headers: HeadersInit): Promise<{ devices: number; sent: number; failed: number }> {
  const result = await post(headers, { action: "test" });
  return { devices: Number(result.devices ?? 0), sent: Number(result.sent ?? 0), failed: Number(result.failed ?? 0) };
}

/**
 * On app open, if this device already allowed notifications, keep the server's record fresh (the browser may have rotated the
 * subscription, or the same phone may have been used for the other van). Never prompts and never throws.
 */
export async function syncPush(headers: HeadersInit): Promise<void> {
  try {
    const environment = detectPush();
    if (!environment.supported || environment.permission !== "granted") return;
    const info = await serverInfo(headers);
    if (!info.enabled || !info.publicKey) return;
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(info.publicKey) });
    await post(headers, { action: "subscribe", subscription: subscription.toJSON() });
  } catch {
    // Push is an enhancement; the inbox keeps working.
  }
}
