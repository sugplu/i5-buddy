// Offline support. The app shell and all road data are cached at install so the app works in dead zones.
// Photos are cached as you view them (or all at once from Settings > Save photos for offline).
// The Spanish road data (data/i5.es.js, 3.1.0) is not in SHELL: Spanish mode fetches it and the rule below keeps it in
// this version's cache, like data/ask.js.
// Live data (weather.gov, Caltrans road data and camera images) is never cached here; the live module keeps its own
// last-good copy.
const VERSION = "i5b-v3.1.0"; // 3.1.0: the language layer: every word the app shows or says comes from i18n/en.json or i18n/es.json through js/i18n.js (Settings > Language, English or Español; ?lang=es; Spanish by itself only on a NEW install on a Spanish phone: a phone that used the app before keeps English and Asteria until Spanish is picked in Settings), Spanish stories from data/i5.es.js (not in SHELL; kept once fetched) in the natural Spanish voice Estrella (voice/estrella/, fetched as needed like Asteria's, its own offline cache; the device's Spanish voice for a line without clips), Spanish turn-by-turn in its own word order, Ask Buddy still English, and Settings > Stories for kids, recorded with Asteria and Estrella (privacy 2026-11-21.2). Previously 3.0.9: the share text and the guide, town and seasonal pages call I-5 Buddy free again (Joseph's call, 2026-11-20). Previously 3.0.8: rest areas are spoken without the direction Caltrans puts in their names ("Tejon Pass Rest Area", not "Tejon Pass Rest Area - Southbound"), the closure note on a rest-area row looks like the other stop notes, the 10 photos the 3.0.7 photo check took out are gone from img/, Caltrans closures read again, and the site's town pages and drive guides in Spanish (/es/town/, /es/drive/; not cached here). Previously 3.0.7: Ask Buddy answers questions about the places you pass from answers saved on the phone (data/ask.js, loaded a few seconds after start, not in SHELL), calmer turn-by-turn (arrival by straight-line distance only near the route's end, reroute backoff and "Rerouting" once per time off the route), stories, story time and Tell me more step aside for turns, chain controls and road alerts, rest areas Caltrans lists as closed are announced with the next open one (a closure counts 7 days after Caltrans was read, nameless rest stops left out), photo check (10 wrong photos removed, alt text on every photo), postcard share lines, and clearer device-voice words (never "1 miles", times in words, "7.2" and "Jr." kept whole, a turn-off's exit said once, a climb warning that never plays late), no "free" in share text or the guide pages. Previously 3.0.6: GPS no longer turns itself off mid-drive when iOS briefly reports location denied, and after a restart the drive resumes by itself when location is allowed (a real "looks stuck" report). Previously 3.0.5: full landmark stories autoplay by default, with an off switch and priority for directions/road alerts. Previously 3.0.4: smarter on the road (a heads-up says the distance as it is when spoken, a zone is described once even when GPS wobbles on its line, arrival times use the cruising speed of the last minutes) and smooth motion (tabs, sheets, buttons) (3.0.3: off I-5 the Drive card no longer counts down to a landmark from the last spot on the road (a short stop says "Off I-5 for now"; after 45 minutes or overnight, the Not on I-5 card with a closest point that follows you) (3.0.2: a calmer, less crowded design (one big Start GPS, one row of actions while driving, the hills chart and the next stops on the Ahead tab), redrawn rides (the SUV replaces the motorcycle), and only good voices in Settings (3.0.1: the strength-audit fixes (offline start on a weak signal, narration that never goes silent for good, no runaway look-ahead, the drive back after turning around, resume after a restart, Precise Location and location-off help, a demo that ends, captions with Stop and Repeat on every tab, End trip at the top, battery savers), chain controls and freeway signs from i5.dominares.org/api/chains, the App Store rating prompt and Rate row in the iPhone app (3.0.0: I-5 Buddy's own natural voice (recorded clips, the device voice as the fallback, saved for offline from Settings), Where to? with turn-by-turn directions (place search and routes through i5.dominares.org, privacy 2026-11-17.1), a more interactive 3D map (photo pins, landmark card, narrated Landmark tour, chase camera, Mountains, the real sun, mission bells, traffic), seven new games with Car Party and speed trivia, and the 3.0 "New in I-5 Buddy" card (2.6.2: fact-checked mission histories, visitor information and turn-off narration (2.6.1: the privacy notice covers the Android app from Google Play (privacy 2026-11-16.2), Android location help in support.html, and .well-known/assetlinks.json so the Android app opens without an address bar (2.6.0: the 21 California missions: a mission passport, the "You are at Mission X" card anywhere in California, mission pages with directions, turn-offs to the missions near I-5 announced at their exit, a one-time "New in I-5 Buddy" card for returning users, and in the iPhone app a daily App Store version check (privacy 2026-11-16.1) (2.5.6: the iPhone app on the App Store: Safari's App Store banner, "Get the iPhone app" in a browser on an iPhone or iPad (welcome card, Settings > About), i5.dominares.org/get, sharing the app links there, a "Get the app" section in support.html, and offline the site's other pages open as themselves (2.5.5: the logo in the road's red, white and blue ("Freeway Stripes") (2.5.4: the new logo (Sunset Stripes, original art) replaces the Interstate shield everywhere, icons made by tools/icons.py, Android maskable icon (2.5.3: the iPhone app shell support (js/native.js; nothing changes in a browser), one AI-made photo removed and photo credits cleaned (2.5.2: the privacy notice also covers the iPhone app (version 2026-11-14.2), and support.html (2.5.1: the privacy notice (privacy.html), linked from Settings > About, the feedback form and Drive; narration starts on a voice on the device; weather.gov points count from a 5-mile mark (2.5.0: live traffic, Road ahead chart, feedback, share links, rides (avatars), 3D map))))))))))))
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
