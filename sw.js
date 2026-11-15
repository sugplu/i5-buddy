// Offline support. The app shell and all road data are cached at install so the app works in dead zones.
// Photos are cached as you view them (or all at once from Settings > Save photos for offline).
// Live data (weather.gov, Caltrans road data and camera images) is never cached here; the live module keeps its own
// last-good copy.
const VERSION = "i5b-v2.5.6"; // 2.5.6: the iPhone app on the App Store: Safari's App Store banner, "Get the iPhone app" in a browser on an iPhone or iPad (welcome card, Settings > About), i5.dominares.org/get, sharing the app links there, a "Get the app" section in support.html, and offline the site's other pages open as themselves (2.5.5: the logo in the road's red, white and blue ("Freeway Stripes") (2.5.4: the new logo (Sunset Stripes, original art) replaces the Interstate shield everywhere, icons made by tools/icons.py, Android maskable icon (2.5.3: the iPhone app shell support (js/native.js; nothing changes in a browser), one AI-made photo removed and photo credits cleaned (2.5.2: the privacy notice also covers the iPhone app (version 2026-11-14.2), and support.html (2.5.1: the privacy notice (privacy.html), linked from Settings > About, the feedback form and Drive; narration starts on a voice on the device; weather.gov points count from a 5-mile mark (2.5.0: live traffic, Road ahead chart, feedback, share links, rides (avatars), 3D map))))))
const SHELL = [
  "./", "index.html", "privacy.html", "app.css", "manifest.webmanifest", "data/i5.js",
  "js/main.js", "js/store.js", "js/data.js", "js/geo.js", "js/voice.js", "js/narrator.js", "js/native.js",
  "js/live.js", "js/map.js", "js/play.js", "js/trip.js", "js/listen.js",
  "js/roadahead.js", "js/feedback.js", "js/share.js", "js/ride.js", "js/map3d.js",
  "css/live.css", "css/map.css", "css/play.css", "css/trip.css", "css/listen.css",
  "css/roadahead.css", "css/feedback.css", "css/share.css", "css/ride.css", "css/map3d.css",
  "fonts/overpass.woff2", "fonts/overpass-mono.woff2",
  "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/app-store-badge.svg",
  // Not cached: icons/og-1200x630.png (the link preview, read only by other sites) and icons/screenshot-*.jpg (read only
  // by the browser's install sheet, which is online). The app never shows them, so a first install skips ~265 KB.
];
// The site's other pages, saved at install too, so they open offline as themselves: the support page and
// i5.dominares.org/get. Not in SHELL, which lists the app's own files: the iPhone app's build checks that it carries
// every file in SHELL, and it has no get/ page.
const PAGES = ["support.html", "get/"];
const PHOTOS = "i5b-photos";
// The app's own address, where an offline visit gets the app shell: "/" (or "/i5-buddy/" at the old github.io address).
const HOME = new URL("./", location).pathname;

// Each shell file is asked for with ?v=<VERSION>, so a CDN copy of the previous release (the i5.dominares.org Worker keeps
// files at the edge for a few minutes) can never end up in this release's offline cache; it is stored under its plain
// address, which is what the app asks for.
const fresh = u => u + (u.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(VERSION);
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all([...SHELL, ...PAGES].map(u =>
    fetch(new Request(fresh(u), { cache: "reload" })).then(r => (r.ok ? c.put(u, r) : null)).catch(() => {})))));
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
  if (url.pathname.includes("/api/")) return; // /api/traffic and /api/feedback are live: never cached, never served stale
  if (url.pathname.includes("/img/")) {
    // photos: cache first, then network (and remember it)
    e.respondWith(caches.open(PHOTOS).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch { return new Response("", { status: 504 }); }
    }));
    return;
  }
  // app shell, data and pages: network first (fresh when online), the saved copy when offline
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => offline(req, url)));
});

/** Offline: the saved copy of what was asked for. A page that was never saved is not answered with the app shell
    (index.html shown at get/ would look for its files in get/, and support.html would turn into the app): only the
    app's own address gets the shell; get (no slash) goes to get/ when that is saved; any other page goes to the app. */
async function offline(req, url) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode !== "navigate") return new Response("", { status: 504 });
  if (url.pathname === HOME || url.pathname === HOME + "index.html") return (await caches.match("index.html")) || new Response("", { status: 504 });
  if (!url.pathname.endsWith("/") && await caches.match(url.pathname + "/")) return Response.redirect(new URL(url.pathname + "/" + url.search, location).href, 302);
  return Response.redirect(new URL(HOME, location).href, 302);
}
