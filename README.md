# I-5 Buddy

A narrated road-trip buddy for all 797 miles of Interstate 5 in California, from the Mexico border at San Ysidro to the
Oregon line. It follows you by GPS and speaks up before each landmark ("In about 2 miles, on your right: …"), with a
"Tell me more" story for each one, the landscape as it changes, the season's crops, and live road info.

Live at **https://i5.dominares.org/** (made by Dominares). The Cloudflare Worker `i5-buddy` serves that address from this repo's GitHub Pages build, so a release is still just a push; the old https://sugplu.github.io/i5-buddy/ address forwards there. Worker source: `/Volumes/sugsair/dominares/i5-buddy-worker/`. It's a phone web app (PWA): open the link, add it to the home screen,
and it works offline after that. No account, no tracking; everything stays on the phone.

## What it does

- **Drive**: highway-sign display (direction, exit-mile, speed, elevation, miles to Oregon or to Mexico), the next
  landmark with a photo, live countdown and which side it's on, "What's on my left / right?", up-next list, next gas /
  EV / food / lodging / rest area, destination with ETA and "Are we there yet?".
- **Narration**: chime + spoken heads-up for each landmark (timed to your speed), landscape and seasonal notes, big
  climbs, the halfway point, story time on long empty stretches, kid I-spy challenges. Three chattiness levels.
  Drive past either end of the road (into Oregon, or into Mexico) and it says goodbye once and goes quiet.
- **Live road info** (opt-in): National Weather Service forecasts and warnings ahead, Caltrans chain controls and the
  messages on freeway signs ahead, live Caltrans cameras.
- **Ahead**: every landmark ahead with photos, filters, sources; or gas, food and rest areas ahead.
- **Map**: the whole road on a zoomable map with every landmark, camera and rest area.
- **Passport**: a stamp for every landmark you pass, regions, badges, trip log, a shareable trip card.
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
| `data/i5.js` | Generated data (route, places, zones, trivia, exits, services, cameras, elevation, map outline). Don't edit; run the build. |
| `content/v2/*.json` | Researched and fact-checked content, one file per stretch of road (+ `*-gaps.json`). Edit these. |
| `content/v2/logs/` | Fact-check change logs. |
| `img/` | Landmark photos (Wikimedia Commons, free licenses; credits in `tools/images.json` and on each photo). |
| `tools/` | Data pipeline and tests (below). |
| `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` | Offline support, install info (with two phone screenshots for Android's install sheet), icons, the link-preview picture, Overpass font (SIL OFL). |

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

The link-preview picture (what a shared link shows in Messages, Slack and so on) is `icons/og-1200x630.png`, drawn
from `tools/og-image.html` with the app's own tokens and font. After changing that page, run `python3 tools/og_image.py`
(headless Chrome) and bump `VERSION` in `sw.js`. The install screenshots `icons/screenshot-*.jpg` are captures of a demo
drive (Drive and Map tabs) at 360x780 CSS pixels, scale 1.5.

Research helpers used to write and fact-check content: `tools/wiki.py` (Wikipedia search/page/coords/near) and
`tools/where.py LAT LON` (corridor mile, state exit-mile, distance from I-5, side of the road).

"Corridor mile" = miles from the Mexico border along northbound I-5. In California it is the exit number: 0 at the
border, 797 at the Oregon line. (With more states in SCOPE, each state's exit numbers continue from the previous
state's end: Oregon adds 797, Washington adds 1105.) A place's side of the road is computed from its coordinates.

## Tests

```sh
python3 tools/run_tests.py                 # every test page in headless Chrome (serves the repo itself)
python3 tools/run_tests.py --only geometry # one of them
# or serve the folder and open a page (or headless Chrome --dump-dom):
#   /tools/test.html   geometry: GPS -> corridor mile at California exits; places past the ends are off the road (ALL PASS)
#   /tools/e2e.html    fake GPS drives: narration timing, sides, off-route, glitches, the halfway point,
#                      the end of the road at the Oregon line and at the Mexico border, demo, modules (ALL PASS)
#   /tools/test-{live,map,play,trip,listen}.html   per-module pages
```

When you change any app file, bump `VERSION` in `sw.js` so installed phones pick up the update.

## Deploy

GitHub Pages from `main` (repo root). Push to deploy; Pages rebuilds in about a minute.

## Limits

A web app only tracks you while it's open on screen (it keeps the screen awake). Narration with the phone locked, or
CarPlay / Android Auto, would need a native app. Live info needs a connection.
