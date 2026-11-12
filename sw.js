// Offline support. The app shell and all road data are cached at install so the app works in dead zones.
// Photos are cached as you view them (or all at once from Settings > Save photos for offline).
// Live data (weather.gov, Caltrans road data and camera images) is never cached here; the live module keeps its own
// last-good copy.
const VERSION = "i5b-v2.2.3"; // 2.2.3: repeated stories merged or trimmed across the whole road
const SHELL = [
  "./", "index.html", "app.css", "manifest.webmanifest", "data/i5.js",
  "js/main.js", "js/store.js", "js/data.js", "js/geo.js", "js/voice.js", "js/narrator.js",
  "js/live.js", "js/map.js", "js/play.js", "js/trip.js", "js/listen.js",
  "css/live.css", "css/map.css", "css/play.css", "css/trip.css", "css/listen.css",
  "fonts/overpass.woff2", "fonts/overpass-mono.woff2",
  "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
];
const PHOTOS = "i5b-photos";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== PHOTOS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // live data and camera images go straight to the network
  if (url.pathname.includes("/img/")) {
    // photos: cache first, then network (and remember it)
    e.respondWith(caches.open(PHOTOS).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch { return new Response("", { status: 504 }); }
    }));
    return;
  }
  // app shell and data: network first (fresh when online), cache when offline
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? caches.match("index.html") : new Response("", { status: 504 }))));
});
