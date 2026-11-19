# I-5 Buddy

A narrated road-trip buddy for all 797 miles of Interstate 5 in California, from the Mexico border at San Ysidro to the
Oregon line. It follows you by GPS and speaks up before each landmark ("In about 2 miles, on your right: …"), with a
"Tell me more" story for each one, the landscape as it changes, the season's crops, and live road info.

Live at **https://i5.dominares.org/** (made by Dominares). The Cloudflare Worker `i5-buddy` serves that address from this repo's GitHub Pages build, so a release is still just a push; the old https://sugplu.github.io/i5-buddy/ address forwards there. Worker source: `/Volumes/sugsair/dominares/i5-buddy-worker/`. It's a phone web app (PWA): open the link, add it to the home screen,
and it works offline after that. The same app is on the App Store for iPhone (https://apps.apple.com/us/app/i-5-buddy/id6834991531,
since 2026-11-15; the Capacitor project is `/Volumes/sugsair/dominares/i5-buddy-ios/`). The one link to share is
**https://i5.dominares.org/get**: an iPhone or iPad goes straight to the App Store; Android phones and computers get a
short page that opens the web app. No account, no ads, no analytics or tracking scripts, no cookies. Trips, stamps and
settings stay on the phone. What does leave it (the ordinary requests to load the app, opt-in live road info, the 3D map's
map pictures, the browser's own speech services, and feedback you choose to send) is listed in the privacy notice,
[`privacy.html`](privacy.html) (https://i5.dominares.org/privacy.html).

## 3.0.1: the strength-audit fixes, chain controls from the Worker, the Grapevine page

The fixes from the 2026-11-15 strength audit (`/Volumes/sugsair/dominares/i5-buddy-quality/2026-11-15-strength-audit/`),
each checked by `tools/test-audit.html` (50 checks) or the module test named:

- **Offline (sw.js).** The app's files come from this version's saved copy first (a weak signal no longer means a blank
  screen for 25 s or forever); install is all or nothing for the app's own files, so a failed download keeps the old,
  complete version; a server error never replaces a saved file; photos give up after 8 s. Save photos counts only what
  was saved and asks the browser to keep the offline copy (`navigator.storage.persist`); the installed app on Wi-Fi
  saves them once by itself. (`tools/test-getapp.html`, site.)
- **Narration.** A watchdog in `js/voice.js` moves on when the speech engine loses an "end" (one lost event used to
  silence the rest of the drive). A speed is worked out from two positions only over 3+ s between accurate fixes and
  never above 100 mph, the look-ahead is capped at the setting plus 2 miles, and fixes worse than 250 m stamp nothing and
  vote no direction. Places are remembered per direction, so the drive back after turning around is narrated. A parked
  start waits for the direction before announcing anything. High chattiness tells stories after 5 quiet miles or 4
  quiet minutes. More than about 200 m past either end of the road counts as past it (the San Ysidro border line).
- **First run and errors.** GPS started away from I-5 shows "Not on I-5 yet" with Take a demo drive and Stop GPS, and
  saves no made-up mile; Precise Location off and location refused get cards that stay, with Open Settings in the iPhone
  app; no fix for 15 s shows "--" mph and GPS? instead of a live-looking sign. The demo ends by itself (about 4 minutes,
  6 landmarks or the end of the road), drives at real speed while it talks, and stamps nothing. A drive cut off by a
  restart (a discarded tab, iOS restarting the web view, Reload for an update) is offered back for 45 minutes with
  Resume drive. End trip and Narration sit at the top while a drive runs; the update bar waits until GPS is off.
- **Everywhere.** Captions of what is said, with Repeat and Stop, above the tab bar on every tab. Help (support.html),
  Send feedback and the version in About; feedback email optional and tagged web, pwa, android or ios. After End trip of
  a real drive: Trip saved, with Share my trip and Tell a friend. Shared trip text links to /get.
- **Battery.** The 3D map no longer re-animates on every fix (no frame for invisible moves); the ride's animations and
  the Road ahead ping play a few times, then rest; the ribbon dot has no transition; the chime's audio context sleeps
  when idle; the screen stays on only in GPS and demo mode, and may sleep after 20 minutes stopped or 10 minutes far
  from I-5.
- **iPhone app (`js/review.js`, native.js).** Apple's own rating prompt at a quiet moment after a good trip (rules in
  review.js; never from a button, once per version, 120 days apart, 2 a year), a Rate I-5 Buddy row in About, other audio
  turned down while it talks (`AudioDuck`), Open Settings for location. Landscape layout for dash mounts.
- **Chain controls and signs from `/api/chains`** (Worker): every district in one answer of a few KB instead of up to
  400 KB per refresh from Caltrans; the feeds stay the fallback (`tools/test-live.html` chainsapi). A full closure on the
  Grapevine or in the Siskiyous shows in the strip from 150 miles away (trafficpass).
- **`grapevine/`**: the public page "Is the Grapevine open?" (live from `/api/traffic` and `/api/chains`), in the
  sitemap and linked from Settings > Live road info.

## 3.0: a real voice, directions, a 3D tour and more games

- **Natural voice.** Every line the app can say (8,241 units: landmarks at every distance and side, stories, zones,
  missions, games, navigation's phrase bank) was recorded once in the voice "Asteria" (Deepgram Aura-2 on our Cloudflare
  account, ~$15 once; Joseph picked it by ear after rejecting the open Kokoro voice as "ai and fake") into
  `voice/asteria/<k[:2]>/<k>.m4a` (AAC, 24 kHz mono; `index.json` lists them).
  `js/voice.js` cuts each line into units (`speechUnits`), names them (`unitKey`, cyrb53) and plays the joined clips;
  anything without clips is read by the device voice as before. Re-record after any text change:
  `python3 tools/voice/collect.py` (lists every unit with the app's own functions, silently in headless Chrome), then
  `~/Dominares/tts/.venv/bin/python tools/voice/make.py` on the Pro with the local sampler running
  (`npx wrangler@4.160.0 dev --port 8790` in a folder with tools/voice/make.py's sampler; records only the missing clips).
  `voice/asteria/stream.txt` lists the clips only the long stories use: the iPhone app leaves them out and downloads them.
- **Where to? (js/nav.js).** Place search (the app's own places first, then `/api/geo/search` on the Worker, Geoapify),
  route preview, turn-by-turn guidance with a fixed phrase grammar in the natural voice, rerouting, arrival. One-time
  notice before anything is sent (privacy.html, Directions). Tests: `tools/test-nav.html` (search, route, drive).
- **3D map (js/map3d.js).** Photo pins, a landmark card, a narrated Landmark tour, orbit, chase camera, Mountains,
  the real sun, mission bells, live traffic pins, a compass. Manual screenshots with real tiles: `tools/shot-3d.html`.
- **Games (js/play.js, js/games/).** Plate Hunt, Higher or Lower, Where Is This?, Would You Rather, Scavenger Hunt,
  Alphabet, Cow Count, Car Party scoreboard and speed trivia, besides bingo, trivia and I spy. Tests: `tools/test-games.html`.

## 2.6.2 mission corrections

The mission histories and visitor information include the 2026-11-16 fact-check corrections. The build now uses the
reviewed mission narration when merging a turn-off into an existing landmark, and places it at the turn-off exit.
Existing landmark IDs stay stable for saved stamps, photos and share links. The road still has 377 landmarks,
21 missions, 68 zones and 101 trivia questions.

Run `python3 tools/test_mission_build.py` for the build regression checks (no network, browser or audio needed),
`python3 tools/lint_content.py` for content lint, and `python3 tools/run_tests.py` for the silent browser suite.

## Automatic landmark stories (3.0.5)

After Start GPS, each landmark introduction continues into its full story automatically. Settings > Narration >
Play full landmark stories automatically is on by default; turn it off for short introductions. Category and
chattiness choices still select which places are announced. Stop and Repeat remain available in captions, and
navigation instructions or urgent road alerts interrupt a long automatic story.

## What it does

- **Drive**: highway-sign display (direction, exit-mile, speed, elevation, miles to Oregon or to Mexico), the next
  landmark with a photo, live countdown and which side it's on, "What's on my left / right?", up-next list, next gas /
  EV / food / lodging / rest area, destination with ETA and "Are we there yet?".
- **Narration**: chime + spoken heads-up for each landmark (timed to your speed), landscape and seasonal notes, big
  climbs, the halfway point, story time on long empty stretches, kid I-spy challenges. Three chattiness levels.
  Drive past either end of the road (into Oregon, or into Mexico) and it says goodbye once and goes quiet.
- **Live road info** (opt-in): crashes, closures and hazards ahead from the California Highway Patrol and Caltrans lane
  closures (one spoken heads-up for a crash or closure when it is about 10 miles away), National Weather Service
  forecasts and warnings ahead, Caltrans chain controls and the messages on freeway signs ahead, live Caltrans cameras.
- **Road ahead**: a glanceable chart on the Ahead tab (Drive until 3.0.2) of the hills in front of you (next 50 miles, or all the way to your
  destination; the whole road before a trip): steepness colors, grade %, the highest point, forecast and traffic markers,
  and big numbers for the climb, the top and the steepest grade.
- **Share and feedback**: a share button in the top bar (the phone's share sheet, or copy the link / invite a friend by
  text or email; it shares i5.dominares.org/get), a Share button on every landmark, links like `i5.dominares.org/#place=<id>` that open one landmark, and
  "Send feedback" in Settings (name, email, message) that goes to the Dominares team.
- **Ahead**: every landmark ahead with photos, filters, sources; or gas, food and rest areas ahead.
- **Map**: the whole road on a zoomable map with every landmark, camera and rest area. **3D**: a tilted terrain map (hills,
  hillshade, sky) that follows your car, with landmark pins you can tap and a "Fly the road" button that glides the
  camera along the next 30 miles. It loads map pictures from OpenFreeMap and AWS terrain tiles only while it is open,
  and falls back to the regular map when there is no connection or no 3D graphics.
- **Your ride**: pick one of eight hand-drawn vehicles (compact car, camper van, pickup, convertible, motorhome,
  SUV (the motorcycle until 3.0.2), EV hatchback, family bus) in eight colours, with a driver badge (an emoji or two letters) and a nickname.
  It rides on the Drive sign (bouncing while you drive, dozing when parked), as your marker on the map, and on the
  passport and its share card. Settings > Display > Your ride, or tap it on the sign.
- **Passport**: a stamp for every landmark you pass, regions, badges, trip log, a shareable trip card.
- **The California missions** (2.6.0): all 21 missions in a mission passport at the top of the Passport tab (a stamp
  when GPS gets within 300 m, or "I visited"), a "You are at Mission X" card on Drive anywhere in California (also far
  from I-5), the nearest missions with Directions (Apple Maps on Apple devices, else Google Maps), a page for each
  mission, and Kid mode facts. The missions a few miles off I-5 are turn-offs: announced at their exit ("At exit 54,
  Highway 76 heads about 5 miles east to Mission San Luis Rey."), shown as "Detour: 5 mi east at exit 54A", and stamped
  only when you get there (or tap "I went there"). People who used the app before see a one-time "New in I-5 Buddy"
  card; the iPhone app also checks the App Store once a day and says when an update is ready.
- **Play**: road bingo tuned to the region, trivia about the road, I-spy scores.
- **Voice commands** (where the browser supports it): "what's on my left", "tell me more", "next gas", "how far to Redding".

## Scope: California only

Since 2026-11-11 the app covers I-5 in California only. The scope is one line in `tools/build.py`:
`SCOPE = ["CA"]`. The app never hard-codes it: it reads the road from the data (`data.SCOPE`, `STATES`, `MAX_M`, and
`ENDS`, the names of what lies past each end: "the Mexico border" and "the Oregon line"), so the sign, the welcome
card, the halfway line, the end-of-road goodbye and the tests all follow the data.

To bring Oregon and Washington back, set `SCOPE = ["CA", "OR", "WA"]` and run `python3 tools/build.py`. The road line,
exits, services, rest areas and cameras for all three states are still in `tools/route-full.json` and
`tools/extras.json`; the build skips content outside the scope (see `tools/build-report.txt`), and Oregon content
still sits in `content/v2/`. With three states the north end becomes the Canadian border and the state-line welcomes
and the state headings in the Ahead list come back by themselves; modules hide anything that needs a state the data
doesn't cover (a three-state badge, Oregon or Washington road links and cameras), so those return too.
`tools/test.html` and `tools/e2e.html` work with either scope; the other test pages may need Oregon and Washington
cases again.

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module contract, data shapes and events.

| Path | What it is |
| --- | --- |
| `index.html`, `app.css`, `js/`, `css/` | The app. Plain HTML/CSS/ES modules, no build step, no dependencies. |
| `get/index.html` | i5.dominares.org/get, the link for posts, QR codes and shared invitations: iPhone and iPad straight to the App Store; Android a short page (Google Play is coming, the web app today); computers the App Store badge, the web app and a QR code of the link. Cached with the app shell (sw.js `PAGES`). |
| `support.html` | The support page (the App Store listing's Support URL): help, contact, and "Get the app". Cached with the app shell. |
| `privacy.html` | The privacy notice (a standalone page on `app.css`, cached with the app shell), linked from Settings > About, the feedback form, the welcome card and the last line of Drive. When a change makes the app send or store something new, update it with a new effective date and version. |
| `data/i5.js` | Generated data (route, places, zones, trivia, exits, services, cameras, elevation, map outline). Don't edit; run the build. |
| `content/v2/*.json` | Researched and fact-checked content, one file per stretch of road (+ `*-gaps.json`). Edit these. |
| `content/v2/logs/` | Fact-check change logs. |
| `content/missions.json`, `content/v2/ca-missions.json` | The 21 missions (data key `MISSIONS`) and the I-5 turn-offs to the ones near I-5 (places with `detour` and `mission`). `tools/build.py` copies both in from the content agent's folder (`I5_MISSIONS_SRC`, default `/Volumes/sugsair/dominares/road-buddies/i5-missions`) when they exist there. |
| `img/` | Landmark photos (Wikimedia Commons, free licenses; credits in `tools/images.json` and on each photo). |
| `tools/` | Data pipeline and tests (below). |
| `vendor/maplibre/` | MapLibre GL JS 5.24.0 (BSD-3-Clause; `maplibre-gl.js`, `.css`, `LICENSE.txt`, `VERSION`), loaded only when the 3D map is opened and never cached with the app shell. To update: download the `maplibre-gl-<version>.tgz` from the npm registry and copy those three files from `dist/` (and the license), then update `VERSION`. |
| `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` | Offline support, install info (with two phone screenshots for Android's install sheet, and the iPhone app in `related_applications`), the logo (`icons/app-icon.svg`) and the icons made from it, the link-preview picture, Apple's App Store badge (`icons/app-store-badge.svg`, unmodified), Overpass font (SIL OFL). |

## Data pipeline

```sh
# 1. raw downloads (not committed; only needed to rebuild the road itself). These cover the whole of I-5;
#    build.py keeps the states in SCOPE.
#    tools/osm/rel-{ca,or,wa}.json      OSM route relations 2313084, 2326065, 94043 (out geom)
#    tools/osm/exits-{ca,or,wa}[s].json OSM motorway_junction nodes + ramp destinations (both directions)
#    tools/osm/poi-{ca,or,wa}.json      OSM fuel, EV, food, lodging, rest areas near I-5
#    tools/live/*.json                  Caltrans CWWP2 cctv/cms/cc feeds (and a WSDOT camera list, used only with WA)
#    tools/geo/states.geojson           Natural Earth 50m admin-1
python3 tools/route.py            # -> tools/route-full.json, tools/exits.json (corridor line calibrated to exit numbers)
python3 tools/extras.py           # -> tools/extras.json (cameras, services, rest areas, outline; --elevation refetches elevation)
python3 tools/build.py            # -> data/i5.js for the states in SCOPE (+ tools/build-report.txt with warnings)
python3 tools/images.py           # -> img/*.jpg + tools/images.json (then run build.py again)
```

The logo is one drawing, `icons/app-icon.svg` (a full-bleed 1024 square, original art; the iPhone app's App Store icon
is the same file). `python3 tools/icons.py` makes every icon from it: `icons/icon.svg` (the rounded tile used as the
favicon and as the logo inside the app), `icon-512/192.png`, the apple-touch `icon-180.png` and the Android
`icon-maskable-512.png` (from `icons/app-icon-maskable.svg`, the same drawing shrunk into the safe circle). Then
re-render the link preview and bump `VERSION` in `sw.js`. Never use a highway route shield: the Interstate shield is
a registered trademark of AASHTO (the app used it until 2.5.3). The logo may use the road's red, white and blue,
but never a shield shape or a red band over blue.

The link-preview picture (what a shared link shows in Messages, Slack and so on) is `icons/og-1200x630.png`, drawn
from `tools/og-image.html` with the app's own tokens and font. After changing that page, run `python3 tools/og_image.py`
(headless Chrome) and bump `VERSION` in `sw.js`. The install screenshots `icons/screenshot-*.jpg` (540x1170, listed in
the manifest) come from `python3 tools/manifest_shots.py`: a demo drive, Drive and Map tabs, on a 390x845 screen at
18/13 scale. The script names the stops and checks that the header fits and the map marker covers no label.

Research helpers used to write and fact-check content: `tools/wiki.py` (Wikipedia search/page/coords/near) and
`tools/where.py LAT LON` (corridor mile, state exit-mile, distance from I-5, side of the road).

"Corridor mile" = miles from the Mexico border along northbound I-5. In California it is the exit number: 0 at the
border, 797 at the Oregon line. (With more states in SCOPE, each state's exit numbers continue from the previous
state's end: Oregon adds 797, Washington adds 1105.) A place's side of the road is computed from its coordinates.

## Tests

```sh
python3 tools/run_tests.py                 # every test page in headless Chrome (serves the repo itself)
python3 tools/run_tests.py --only geometry # one of them
python3 tools/run_tests.py -j 4            # four pages at a time
# Silent: Chrome runs muted with no audio output, every test page sets window.__BUDDY_SILENT__ and loads the app with
# ?silent=1 (js/voice.js then uses a fake speech engine that records what would be said), and run_tests.py refuses to
# run a page without that hook. After a run: pmset -g assertions | grep -A2 BuiltInSpeakerDevice lists no Chrome.
# or serve the folder and open a page (or headless Chrome --dump-dom):
#   /tools/test.html   geometry: GPS -> corridor mile at California exits; places past the ends are off the road (ALL PASS)
#   /tools/e2e.html    fake GPS drives: narration timing, sides, off-route, glitches, the halfway point,
#                      the end of the road at the Oregon line and at the Mexico border, demo, modules (ALL PASS)
#   /tools/test-{live,map,play,trip,listen,ride}.html   per-module pages (test-map also covers the ride marker and the 3D fallback)
#   /tools/test-missions.html   the missions module on synthetic data (passport, visit, nearest, kid, sheet, layout)
#   /tools/test-getapp.html?s=app|get|site   "Get the iPhone app" by browser, i5.dominares.org/get, store tags, sw.js offline pages
```

When you change any app file, bump `VERSION` in `sw.js` so installed phones pick up the update.

## Deploy

GitHub Pages from `main` (repo root). Push to deploy; Pages rebuilds in about a minute.

## Limits

A web app only tracks you while it's open on screen (it keeps the screen awake). Narration with the phone locked, or
CarPlay / Android Auto, would need a native app. Live info needs a connection.
