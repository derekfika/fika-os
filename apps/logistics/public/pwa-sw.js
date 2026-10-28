// FIKA Logistics driver service worker. It caches only the app shell and static assets.
// Operational data, API responses, navigations and anything carrying a session are never cached,
// so a driver can never see a stale run as if it were current.
const VERSION = "fika-logistics-driver-v1";
const SHELL = `${VERSION}-shell`;
const PRECACHE = [
  "/pwa/offline.html",
  "/pwa/manifest-van1.webmanifest",
  "/pwa/manifest-van2.webmanifest",
  "/pwa/van1-192.png",
  "/pwa/van1-512.png",
  "/pwa/van1-maskable-512.png",
  "/pwa/van1-apple-touch-180.png",
  "/pwa/van2-192.png",
  "/pwa/van2-512.png",
  "/pwa/van2-maskable-512.png",
  "/pwa/van2-apple-touch-180.png",
  "/brand-assets/logos/fika_logo_white_png.png",
];
const STATIC_PREFIXES = ["/_next/static/", "/pwa/", "/brand-assets/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("fika-logistics-driver-") && key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never intercept or cache operational API responses, which carry session and planner data.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations always go to the network. Only the static offline page is ever served from cache.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/pwa/offline.html")));
    return;
  }

  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});

// ---- Web Push -------------------------------------------------------------------------------------------------------------
// Each van registers this worker at its own scope (/mobile/van1 or /mobile/van2), inside that van's installed-app scope, so Android
// attributes its notifications to that app. The van is taken from this worker's own registration scope, never from the payload: a
// payload for the other van is shown generically and never opens into this app. A legacy worker at /mobile/ (before per-van scopes)
// still delivers until its subscription is migrated; for that worker alone the payload's van is used, and opening is still limited
// to that van's own windows.
const scopeVehicle = () => {
  const match = /\/mobile\/(van[12])\/?$/.exec(new URL(self.registration.scope).pathname);
  return match ? match[1] : undefined;
};
const validVan = (value) => (value === "van1" || value === "van2" ? value : undefined);
const targetFor = (data) => {
  const own = scopeVehicle();
  if (own) return { vehicle: own, trusted: data.vehicleId === own };
  return { vehicle: validVan(data.vehicleId) || "van1", trusted: true };
};
const ownUrl = (vehicle, value) => {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && url.pathname.startsWith(`/mobile/${vehicle}`) ? url.pathname + url.search : `/mobile/${vehicle}`;
  } catch { return `/mobile/${vehicle}`; }
};

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const valid = Boolean(data && data.v === 1 && typeof data.title === "string");
  const { vehicle, trusted } = targetFor(valid ? data : {});
  const show = valid && trusted;
  const options = {
    body: show && typeof data.body === "string" ? data.body.slice(0, 240) : "You have a new notification.",
    tag: show && typeof data.tag === "string" ? data.tag.slice(0, 64) : undefined,
    icon: `/pwa/${vehicle}-192.png`,
    badge: `/pwa/${vehicle}-192.png`,
    data: { url: ownUrl(vehicle, show ? data.url : `/mobile/${vehicle}`), vehicle },
  };
  event.waitUntil(self.registration.showNotification(show ? String(data.title).slice(0, 120) : "FIKA Logistics", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const vehicle = validVan(event.notification.data && event.notification.data.vehicle) || scopeVehicle() || "van1";
  const target = ownUrl(vehicle, event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    // Only this van's own windows: never focus or message another van's app window.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: false });
    const open = windows.find((client) => new URL(client.url).pathname.startsWith(`/mobile/${vehicle}`));
    if (open) {
      try { await open.focus(); } catch { /* not focusable */ }
      open.postMessage({ type: "fika-open-notice", url: target });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
