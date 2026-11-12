#!/usr/bin/env python3
"""Photos for places: freely licensed Wikimedia images with credits.

Reads data/i5.js (run tools/build.py first), finds each place's Wikipedia article (place.wiki, or the
Wikipedia URL in src/src2), asks Wikipedia for the article's free lead image, checks its license on
Commons, downloads a 640px-wide JPEG to img/<id>.jpg and records the credit in tools/images.json.
Then run tools/build.py again to attach the photos.

Skips maps, seals, flags, logos and non-free files. Re-running only fetches what's missing.

Run: python3 tools/images.py [--limit N]
"""
import html, json, os, re, subprocess, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "images.json")
IMG = os.path.join(ROOT, "img")
UA = {"User-Agent": "I5Buddy/1.0 (road trip guide; photo credits shown in app)"}
API = "https://en.wikipedia.org/w/api.php"
BAD_FILE = re.compile(r"(map|locator|location|_loc_|seal|flag|logo|coat[_ ]of[_ ]arms|signature|diagram|chart|icon|banner|\.svg$|\.gif$|\.tif)", re.I)
OK_LIC = re.compile(r"^(cc[- ]by|cc0|public domain|pd\b|pd-)", re.I)


def call(**p):
    """Wikipedia API GET with polite backoff on 429/5xx."""
    import random, urllib.error
    p.update(format="json", formatversion="2", maxlag="5")
    url = API + "?" + urllib.parse.urlencode(p)
    wait = 4.0
    for attempt in range(10):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 9:
                raise
            ra = e.headers.get("Retry-After")
            time.sleep(float(ra) if ra and ra.isdigit() else wait + random.random() * wait)
            wait = min(wait * 1.7, 90)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 9:
                raise
            time.sleep(wait)
            wait = min(wait * 1.7, 90)


def title_of(p):
    if p.get("wiki"):
        return p["wiki"]
    for u in (p.get("src"), p.get("src2")):
        if u and "wikipedia.org/wiki/" in u:
            return urllib.parse.unquote(u.split("/wiki/", 1)[1].split("#")[0]).replace("_", " ")
    return None


def strip(s):
    s = re.sub(r"<[^>]+>", "", html.unescape(s or "")).strip()
    return re.sub(r"\s+", " ", s)


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 10 ** 9
    src = sys.argv[sys.argv.index("--data") + 1] if "--data" in sys.argv else os.path.join(ROOT, "data", "i5.js")
    js = open(src).read()
    data = json.loads(js[js.index("=") + 1: js.rstrip().rindex(";")])
    places = data["places"]
    done = json.load(open(OUT)) if os.path.exists(OUT) else {}
    os.makedirs(IMG, exist_ok=True)

    todo = [p for p in places if p["id"] not in done and title_of(p)]
    print(f"{len(places)} places, {len(done)} already have photos/decisions, {len(todo)} to try")
    titles = sorted({title_of(p) for p in todo})
    # 1) lead images for all titles, 40 at a time
    lead = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        r = call(action="query", titles="|".join(chunk), prop="pageimages", piprop="name", pilicense="free", redirects=1)
        norm = {n["from"]: n["to"] for n in r["query"].get("normalized", [])}
        redir = {n["from"]: n["to"] for n in r["query"].get("redirects", [])}
        by_title = {pg["title"]: pg.get("pageimage") for pg in r["query"]["pages"]}
        for t in chunk:
            t2 = redir.get(norm.get(t, t), norm.get(t, t))
            lead[t] = by_title.get(t2)
        time.sleep(0.5)
    files = sorted({f for f in lead.values() if f and not BAD_FILE.search(f)})
    print(f"{sum(1 for v in lead.values() if v)} articles have a free lead image; {len(files)} usable files")
    # 2) license + thumbnail URL per file, 25 at a time
    meta = {}
    for i in range(0, len(files), 25):
        chunk = files[i:i + 25]
        r = call(action="query", titles="|".join("File:" + f for f in chunk), prop="imageinfo",
                 iiprop="url|size|extmetadata", iiurlwidth=800, iiextmetadatafilter="LicenseShortName|Artist|Credit|ObjectName|ImageDescription")
        for pg in r["query"]["pages"]:
            ii = (pg.get("imageinfo") or [None])[0]
            if not ii:
                continue
            em = ii.get("extmetadata", {})
            lic = strip(em.get("LicenseShortName", {}).get("value"))
            if not OK_LIC.search(lic):
                continue
            artist = strip(em.get("Artist", {}).get("value")) or strip(em.get("Credit", {}).get("value")) or "Wikimedia Commons"
            half = len(artist) // 2
            if len(artist) % 2 == 0 and artist[:half] == artist[half:]:
                artist = artist[:half]  # "Unknown authorUnknown author"
            artist = re.sub(r"^(Unknown author)+$", "Unknown author", artist)
            name = pg["title"].split(":", 1)[1]
            meta[name.replace(" ", "_")] = meta[name] = {
                "thumb": ii.get("thumburl") or ii.get("url"), "w": ii.get("thumbwidth"), "h": ii.get("thumbheight"),
                "page": ii.get("descriptionurl"), "lic": lic.replace("Public domain", "Public domain"), "by": artist[:70],
                "alt": strip(em.get("ObjectName", {}).get("value"))[:120],
            }
        time.sleep(0.5)
    # 3) download
    n = 0
    for p in todo:
        if n >= limit:
            break
        f = lead.get(title_of(p))
        m = meta.get(f) or meta.get((f or "").replace("_", " "))
        if not f or not m or not m["thumb"]:
            done[p["id"]] = None
            continue
        dest = os.path.join(IMG, p["id"] + ".jpg")
        try:
            req = urllib.request.Request(m["thumb"], headers=UA)
            raw = urllib.request.urlopen(req, timeout=60).read()
            tmp = dest + ".src"
            open(tmp, "wb").write(raw)
            # normalise to a ~720px JPEG at quality 72 (sips ships with macOS)
            subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "60", "--resampleWidth", "640", tmp, "--out", dest],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.remove(tmp)
            w, h = m["w"] or 720, m["h"] or 480
            if w and w != 640:
                h, w = round(h * 640 / w), 640
            done[p["id"]] = {"f": f"img/{p['id']}.jpg", "w": w, "h": h, "by": m["by"], "lic": m["lic"], "url": m["page"], "alt": m["alt"] or p["name"]}
            n += 1
            if n % 25 == 0:
                print(f"  {n} photos", flush=True)
                json.dump(done, open(OUT, "w"), ensure_ascii=False, indent=0)
            time.sleep(0.25)
        except Exception as e:  # noqa: BLE001
            print(f"  failed {p['id']}: {e}", file=sys.stderr)
    json.dump(done, open(OUT, "w"), ensure_ascii=False, indent=0)
    have = sum(1 for v in done.values() if v)
    size = sum(os.path.getsize(os.path.join(IMG, x)) for x in os.listdir(IMG)) // 1024
    print(f"downloaded {n} new; {have} places have photos; img/ is {size} KB")


if __name__ == "__main__":
    main()
