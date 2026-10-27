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
// The server sends a small JSON payload ({ v: 1, title, body, tag, url, vehicleId }). Every push must show a notification
// (userVisibleOnly), so an unreadable payload still produces a generic one. Only same-origin /mobile/ links are ever opened.
const safeUrl = (value) => {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && url.pathname.startsWith("/mobile/") ? url.pathname + url.search : "/mobile/";
  } catch { return "/mobile/"; }
};

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const valid = data && data.v === 1 && typeof data.title === "string";
  const vehicle = valid && (data.vehicleId === "van1" || data.vehicleId === "van2") ? data.vehicleId : "van1";
  const title = valid ? String(data.title).slice(0, 120) : "FIKA Logistics";
  const options = {
    body: valid && typeof data.body === "string" ? data.body.slice(0, 240) : "You have a new notification.",
    tag: valid && typeof data.tag === "string" ? data.tag.slice(0, 64) : undefined,
    icon: `/pwa/${vehicle}-192.png`,
    badge: `/pwa/${vehicle}-192.png`,
    data: { url: safeUrl(valid ? data.url : "/mobile/") },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).pathname.startsWith("/mobile/"));
    if (open) {
      // An app window is already open: bring it forward and tell it which notification to open, without reloading it.
      try { await open.focus(); } catch { /* not focusable */ }
      open.postMessage({ type: "fika-open-notice", url: target });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
