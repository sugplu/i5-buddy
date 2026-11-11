# I-5 Buddy

A road-trip buddy for Interstate 5 in California, from the Mexico border to Oregon (exits 0 to 797).
It follows you by GPS and speaks up before each landmark ("In about 2 miles, on your right…").

It's a phone web app (PWA): open the link, add it to the home screen, and it works offline after that.
There's no server, no account, no tracking. Everything stays on the phone.

## What it does

- **Drive**: your milepost, direction and speed on a highway-sign display; the next landmark with a live countdown and which side it's on; "What's on my left / right?" buttons; narration of each landmark and of the landscape as it changes.
- **Ahead**: every stop still ahead in your direction, with category filters, a "Hear it" button and the source for each fact.
- **Passport**: a stamp for every landmark you drive past, with progress for each region of the state.
- **Play**: road bingo (36 Westside-flavored squares) and trivia that favors questions about where you are.
- **Demo drive**: pretends to drive at 1×, 10× or 40× so you can try it from the couch.
- **Settings**: voice, speaking speed, heads-up distance, which categories to narrate, and setting the milepost by hand.

## How location works

`tools/anchors.json` holds the latitude and longitude of every numbered I-5 exit in California, taken from
OpenStreetMap exit nodes (California exit numbers are miles from the border). The app snaps your GPS position
to that line and reads off the milepost. More than 2.5 miles from the line means "off I-5" and narration pauses.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `app.css`, `app.js` | The app. Plain HTML/CSS/JS, no build step, no dependencies. |
| `data/i5.js` | Generated data (route + places + zones + trivia). Don't edit; run the build. |
| `content/seg-*.json` | The researched content, one file per stretch of road. Edit these. |
| `tools/build.py` | Builds `data/i5.js` from the anchors and content. |
| `tools/anchors.json`, `tools/osm-junctions.json` | Exit locations from OpenStreetMap (ODbL). |
| `tools/test.html` | GPS milepost tests. `tools/harness.html` shows three phone-sized views side by side. |
| `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` | Offline support, install info, icons, Overpass font (SIL OFL). |

## Run it locally

```sh
python3 tools/build.py                       # after editing content/
python3 -m http.server 8765 --bind 127.0.0.1 # then open http://127.0.0.1:8765
```

Run the tests by opening `http://127.0.0.1:8765/tools/test.html` (should say ALL PASS).
When you change any app file, bump `VERSION` in `sw.js` so installed phones pick up the update.

## Putting it on a phone

GPS in a browser only works over HTTPS, so it has to be hosted (any static host works: GitHub Pages,
Cloudflare Pages, Netlify). Then on the phone: open the link, then Share > Add to Home Screen (iPhone) or
Install app (Android).

Limits of a web app: it only tracks you while it's open on screen (it keeps the screen awake for that).
Narration with the phone locked, or with CarPlay / Android Auto, would need a native app later.

## Content rules

Every place has a `src` URL. Facts were checked against those sources when written; mileposts are the
nearest exit number. Text is written to be spoken: short, plain, specific.
