#!/usr/bin/env python3
"""Small Wikipedia helper for research (works when web search is unavailable).

  python3 tools/wiki.py search "Kettleman Hills oil"        # top 8 article titles + snippets
  python3 tools/wiki.py page "Kettleman City, California"   # intro text, coordinates, URL
  python3 tools/wiki.py full "Kettleman City, California"   # whole article as plain text (long)
  python3 tools/wiki.py coords "Title" ["Title" ...]        # just coordinates
  python3 tools/wiki.py near LAT LON [radius_m]             # articles with coordinates near a point (max 10000 m)
"""
import json, re, sys, urllib.parse, urllib.request

UA = {"User-Agent": "I5Buddy/1.0 (road trip guide research)"}
API = "https://en.wikipedia.org/w/api.php"


def call(**p):
    """GET the Wikipedia API, backing off politely when rate-limited (HTTP 429) or on network errors."""
    import random, time, urllib.error
    p.update(format="json", formatversion="2", maxlag="5")
    url = API + "?" + urllib.parse.urlencode(p)
    wait = 3.0
    for attempt in range(8):
        try:
            req = urllib.request.Request(url, headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=30))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 7:
                raise
            ra = e.headers.get("Retry-After")
            time.sleep(float(ra) if ra and ra.isdigit() else wait + random.random() * wait)
            wait = min(wait * 1.8, 60)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 7:
                raise
            time.sleep(wait)
            wait = min(wait * 1.8, 60)


def url(t):
    return "https://en.wikipedia.org/wiki/" + urllib.parse.quote(t.replace(" ", "_"))


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "search":
        r = call(action="query", list="search", srsearch=" ".join(args), srlimit=8)
        for h in r["query"]["search"]:
            print(f"- {h['title']}: {re.sub('<[^>]+>', '', h['snippet'])}")
    elif cmd in ("page", "full"):
        t = " ".join(args)
        p = dict(action="query", titles=t, prop="extracts|coordinates|info", explaintext=1, redirects=1, inprop="url")
        if cmd == "page":
            p["exintro"] = 1
        r = call(**p)["query"]["pages"][0]
        if r.get("missing"):
            sys.exit(f"missing: {t}")
        c = r.get("coordinates", [{}])[0]
        print(f"TITLE: {r['title']}\nURL: {url(r['title'])}\nCOORDS: {c.get('lat')},{c.get('lon')}\n")
        print(r.get("extract", ""))
    elif cmd == "coords":
        r = call(action="query", titles="|".join(args), prop="coordinates", redirects=1)
        for pg in r["query"]["pages"]:
            c = pg.get("coordinates", [{}])[0]
            print(f"{pg['title']}: {c.get('lat')},{c.get('lon')}")
    elif cmd == "near":
        lat, lon = args[0], args[1]
        rad = args[2] if len(args) > 2 else "5000"
        r = call(action="query", list="geosearch", gscoord=f"{lat}|{lon}", gsradius=rad, gslimit=40)
        for g in r["query"]["geosearch"]:
            print(f"- {g['title']} ({g['lat']:.4f},{g['lon']:.4f}) {int(g['dist'])} m")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
