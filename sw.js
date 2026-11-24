// Offline support. The app shell and all road data are cached at install so the app works in dead zones.
// Photos are cached as you view them (or all at once from Settings > Save photos for offline).
// The Spanish road data (data/i5.es.js, 3.1.0) is not in SHELL: Spanish mode fetches it and the rule below keeps it in
// this version's cache, like data/ask.js.
// Live data (weather.gov, Caltrans road data and camera images) is never cached here; the live module keeps its own
// last-good copy.
const VERSION = "i5b-v3.1.2"; // App feel: launch screen, no dark flash by day, sheets slide away, pressed states.
const SHELL = [
  "./", "index.html", "privacy.html", "app.css", "manifest.webmanifest", "data/i5.js",
  "js/main.js", "js/store.js", "js/i18n.js", "i18n/en.json", "i18n/es.json", "js/data.js", "js/geo.js", "js/voice.js", "js/narrator.js", "js/native.js",
  "js/live.js", "js/map.js", "js/play.js", "js/trip.js", "js/listen.js",
  "js/games/kit.js", "js/games/lines.js", "js/games/party.js", "js/games/speed.js", "js/games/plates.js", "js/games/higher.js",
  "js/games/where.js", "js/games/wyr.js", "js/games/hunt.js", "js/games/alpha.js", "js/games/cows.js",
  "js/roadahead.js", "js/feedback.js", "js/share.js", "js/ride.js", "js/map3d.js", "js/missions.js", "js/nav.js", "js/review.js",
  "css/live.css", "css/map.css", "css/play.css", "css/trip.css", "css/listen.css",
  "css/roadahead.css", "css/feedback.css", "css/share.css", "css/ride.css", "css/map3d.css", "css/missions.css", "css/nav.css",
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
// The natural voice (3.0): voice/<id>/<k[:2]>/<k>.m4a clips never change (a clip's name is its text's hash), so they are
// served from this cache first and kept across releases; voice/<id>/index.json (the clip list) is network first.
// Nothing here is saved at install: clips are saved as they are first played, or all at once from Settings > Offline.
// One cache per voice (3.1.0): "i5b-voice-asteria" (English, the name it always had) and "i5b-voice-estrella" (Spanish),
// the names js/voice.js saves into; the kids stories' clips are in the same sets, fetched only when they are played.
const VOICE = "i5b-voice-";
const VOICES = ["asteria", "estrella"].map(v => VOICE + v);   // any other voice cache (an old one) is cleared on activate
const voiceCache = path => { const m = /\/voice\/([a-z0-9-]+)\//.exec(path); return VOICE + (m ? m[1] : "asteria"); };
// The app's own address, where an offline visit gets the app shell: "/" (or "/i5-buddy/" at the old github.io address).
const HOME = new URL("./", location).pathname;

// Each shell file is asked for with ?v=<VERSION>, so a CDN copy of the previous release (the i5.dominares.org Worker keeps
// files at the edge for a few minutes) can never end up in this release's offline cache; it is stored under its plain
// address, which is what the app asks for.
const fresh = u => u + (u.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(VERSION);
// Install is all or nothing for the app's own files (3.0.1): if any of them fails to download (a weak signal, a server
// error), the install fails and the browser keeps the old worker with its complete copy, and tries again later. Before,
// a missing data/i5.js was skipped, the update went ahead, and the app could not start offline afterwards. The site's
// other pages (PAGES) stay best-effort. A file that came through is kept, so the next try fetches only what is missing.
const getFresh = u => fetch(new Request(fresh(u), { cache: "reload" })).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r; });
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await Promise.all(SHELL.map(async u => { if (await c.match(u)) return; await c.put(u, await getFresh(u)); }));
    await Promise.all(PAGES.map(u => getFresh(u).then(r => c.put(u, r)).catch(() => {})));
  }));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== PHOTOS && !VOICES.includes(k)).map(k => caches.delete(k))))
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
      // at most 8 s: on a hung connection the photo gives up (main.js then removes its empty frame) instead of
      // leaving a blank box on the card for the rest of the drive
      try { const r = await fetchWithin(req, 8000); if (r.ok) c.put(req, r.clone()); return r; } catch { return new Response("", { status: 504 }); }
    }));
    return;
  }
  if (url.pathname.includes("/voice/")) {
    e.respondWith(caches.open(voiceCache(url.pathname)).then(async c => {
      if (url.pathname.endsWith(".m4a")) {
        // a clip: cache first, then network (and remember it)
        const hit = await c.match(req, { ignoreSearch: true });
        if (hit) return hit;
        try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch { return new Response("", { status: 504 }); }
      }
      // the clip list: network first, the saved copy offline
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
      catch { return (await c.match(req, { ignoreSearch: true })) || new Response("", { status: 504 }); }
    }));
    return;
  }
  // App shell, data and pages: this version's saved copy first (3.0.1). Every launch used to wait on the network even
  // though everything was saved: on one bar of signal the installed app took 25 s to show anything, and on a hotspot
  // with no service it never did. New releases still arrive: the browser checks sw.js on each visit, the new worker
  // saves the new files, and the "A new version is ready" bar reloads into them. Read from this version's own cache
  // (not every cache), so a page never mixes in files from a release that is still waiting.
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok) { c.put(req, r.clone()).catch(() => {}); return r; }
      // a server error (a 503 from the host, say) never replaces something saved; a real "not found" stays one
      return r.status >= 500 ? (await offline(req, url, r)) || r : r;
    } catch { return (await offline(req, url)) || new Response("", { status: 504 }); }
  })());
});

/** fetch() that gives up after ms (a hung connection never answers at all). */
function fetchWithin(req, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(req, { signal: ac.signal }).finally(() => clearTimeout(t));
}

/** Offline: the saved copy of what was asked for. A page that was never saved is not answered with the app shell
    (index.html shown at get/ would look for its files in get/, and support.html would turn into the app): only the
    app's own address gets the shell; get (no slash) goes to get/ when that is saved; any other page goes to the app. */
async function offline(req, url, failed = null) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode !== "navigate") return failed || new Response("", { status: 504 });
  if (url.pathname === HOME || url.pathname === HOME + "index.html") return (await caches.match("index.html")) || new Response("", { status: 504 });
  if (!url.pathname.endsWith("/") && await caches.match(url.pathname + "/")) return Response.redirect(new URL(url.pathname + "/" + url.search, location).href, 302);
  return Response.redirect(new URL(HOME, location).href, 302);
}
