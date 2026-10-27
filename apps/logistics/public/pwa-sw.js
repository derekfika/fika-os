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
