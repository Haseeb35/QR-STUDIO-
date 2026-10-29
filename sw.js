// Offline support: precache the app shell, then serve from cache and refresh in the background.
// Bump VERSION whenever the file list changes.
const VERSION = "qr-studio-v7";

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/prefs.js",
  "js/payloads.js",
  "js/security.js",
  "js/render.js",
  "js/batch.js",
  "js/background.js",
  "js/motion.js",
  "js/inspect.js",
  "js/app.js",
  "vendor/qrcode.min.js",
  "vendor/jsQR.js",
  "vendor/jszip.min.js",
  "fonts/instrument-sans-latin.woff2",
  "fonts/jetbrains-mono-latin.woff2",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Everything the app needs is same-origin; never cache or proxy anything else.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // Share links carry state in the hash, so every navigation maps to the cached page.
      const key = request.mode === "navigate" ? "index.html" : request;
      const cached = await cache.match(key, { ignoreSearch: request.mode === "navigate" });
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") cache.put(key, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
