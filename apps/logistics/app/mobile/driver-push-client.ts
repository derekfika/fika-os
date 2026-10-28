export type PushState = "unsupported" | "needs-install" | "blocked" | "unavailable" | "off" | "on";

const ENDPOINT = "/api/logistics/driver-notifications/push";
/** The legacy shared worker (before per-van scopes). Its subscription is migrated, never used for new registrations. */
const LEGACY_SCOPE = "/mobile/";

type PushEnvironment = { supported: boolean; ios: boolean; standalone: boolean; permission: NotificationPermission | "unsupported" };
type Vehicle = "van1" | "van2";

export function detectPush(): PushEnvironment {
  if (typeof window === "undefined") return { supported: false, ios: false, standalone: false, permission: "unsupported" };
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { supported, ios, standalone, permission: "Notification" in window ? Notification.permission : "unsupported" };
}

/** iPhone only delivers web push to an installed Home Screen app, so a Safari tab is told how to install it. */
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

function headerValue(headers: HeadersInit, name: string): string | undefined {
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === name)?.[1];
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name) ?? undefined;
  return Object.entries(headers as Record<string, string>).find(([key]) => key.toLowerCase() === name)?.[1];
}

/** The van this app is for. The server still decides from the signed PIN session; this only picks which worker to use. */
export function vehicleOf(headers: HeadersInit): Vehicle | undefined {
  const value = headerValue(headers, "x-fika-logistics-vehicle");
  return value === "van1" || value === "van2" ? value : undefined;
}

/** This van's own worker, registered on app load by PwaRegister. Android attributes its notifications to this van's installed app. */
async function vanRegistration(vehicle: Vehicle) {
  return navigator.serviceWorker.getRegistration(`/mobile/${vehicle}`);
}

async function ensureVanRegistration(vehicle: Vehicle): Promise<ServiceWorkerRegistration> {
  const existing = await vanRegistration(vehicle);
  if (existing) return existing;
  await navigator.serviceWorker.register("/pwa-sw.js", { scope: `/mobile/${vehicle}` });
  await navigator.serviceWorker.ready;
  const registered = await vanRegistration(vehicle);
  if (!registered) throw new Error("Notifications could not be set up on this phone. Please try again.");
  return registered;
}

/** The endpoint of the legacy shared subscription on this device, if one exists, so the server can migrate it. */
async function legacyEndpoint(): Promise<string | undefined> {
  const registration = await navigator.serviceWorker.getRegistration(LEGACY_SCOPE);
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint;
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

/**
 * Register this phone's van worker with the server. A legacy shared subscription on the phone is passed as `replaces`; the server
 * retires it only after the new endpoint has been verified with a real push.
 */
async function registerDevice(headers: HeadersInit, vehicle: Vehicle, publicKey: string) {
  const registration = await ensureVanRegistration(vehicle);
  const subscription = (await registration.pushManager.getSubscription())
    ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  const legacy = await legacyEndpoint();
  const result = await post(headers, {
    action: "subscribe",
    scope: vehicle,
    subscription: subscription.toJSON(),
    ...(legacy && legacy !== subscription.endpoint ? { replaces: legacy } : {}),
  });
  return { verified: result.verified === true };
}

/** The current state of this device, without prompting for anything. */
export async function loadPushState(headers: HeadersInit): Promise<PushState> {
  const environment = detectPush();
  if (environment.ios && !environment.standalone) return "needs-install";
  if (!environment.supported) return "unsupported";
  const info = await serverInfo(headers).catch(() => ({ enabled: false, publicKey: null }));
  const vehicle = vehicleOf(headers);
  const registration = vehicle && environment.permission === "granted" ? await vanRegistration(vehicle) : undefined;
  const subscription = await registration?.pushManager.getSubscription();
  return pushStateFor(environment, info.enabled, Boolean(subscription));
}

/** Must be called from a tap: the permission prompt is only allowed in response to a user gesture. */
export async function enablePush(headers: HeadersInit): Promise<PushState> {
  const environment = detectPush();
  if (environment.ios && !environment.standalone) return "needs-install";
  if (!environment.supported) return "unsupported";
  const vehicle = vehicleOf(headers);
  if (!vehicle) throw new Error("Notifications are only available from a van's own app.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const info = await serverInfo(headers);
  if (!info.enabled || !info.publicKey) return "unavailable";
  const result = await registerDevice(headers, vehicle, info.publicKey);
  if (!result.verified) throw new Error("We could not confirm notifications on this phone yet. Please try again.");
  return "on";
}

export async function disablePush(headers: HeadersInit): Promise<PushState> {
  const vehicle = vehicleOf(headers);
  const registration = vehicle ? await vanRegistration(vehicle) : undefined;
  const subscription = await registration?.pushManager.getSubscription();
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
 * On app open, if this phone already allowed notifications, keep its registration current (the browser may have rotated the
 * subscription, or a legacy subscription is still waiting to be migrated). Never prompts and never throws.
 */
export async function syncPush(headers: HeadersInit): Promise<void> {
  try {
    const environment = detectPush();
    const vehicle = vehicleOf(headers);
    if (!environment.supported || environment.permission !== "granted" || !vehicle) return;
    const info = await serverInfo(headers);
    if (!info.enabled || !info.publicKey) return;
    await registerDevice(headers, vehicle, info.publicKey);
  } catch {
    // Push is an enhancement; the inbox keeps working.
  }
}
