#!/usr/bin/env python3
"""Rest-area closures on I-5 from Caltrans QuickMap, for tools/rest-status.json (read by tools/build.py).

Caltrans publishes the status of every safety roadside rest area in https://quickmap.dot.ca.gov/data/srra.kml
("Status: Open", "Closed due to Rest Area Work Expected to re-open 11/23/2026 11:59 PM", ...). This script reads it,
keeps the I-5 rest areas, matches each to a row of data/i5.js REST (same direction, within half a mile) and writes the
ones that are not open as overrides, with the Caltrans link, the date it was read and the reopening date when Caltrans
gives one. build.py ignores an override older than REST_STATUS_DAYS or past its reopening date, so run this right
before a release (python3 tools/rest_status.py, then python3 tools/build.py). No model and no key: one public file.
  --kml FILE   read a saved copy instead of downloading it
"""
import datetime, html, json, math, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = "https://quickmap.dot.ca.gov/data/srra.kml"
OUT = os.path.join(HERE, "rest-status.json")


def parse(kml):
    rows = []
    for p in re.findall(r"<Placemark.*?</Placemark>", kml, re.S):
        d = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(p)))
        name = re.search(r"Safety Roadside Rest Area (.*?) SRRA No", d)
        route = re.search(r"Route: (\S+)", d)
        status = re.search(r"Status: (.*?)(?: Amenities:| Information courtesy)", d)
        coord = re.search(r"<coordinates>\s*([-\d.]+),([-\d.]+)", p)
        if not (name and route and status and coord) or route.group(1) not in ("5", "I-5"):
            continue
        n = name.group(1).strip()
        side = 0 if re.search(r"Northbound & Southbound", n, re.I) else 1 if re.search(r"Northbound", n, re.I) else -1 if re.search(r"Southbound", n, re.I) else 0
        st = status.group(1).strip()
        kind = "open" if re.match(r"open\b", st, re.I) else "truck_only" if re.search(r"truck", st, re.I) else "partial" if re.search(r"partial|limited", st, re.I) else "closed" if re.match(r"closed", st, re.I) else "unknown"
        until = re.search(r"re-?open (\d{1,2})/(\d{1,2})/(\d{4})", st, re.I)
        rows.append({"name": n, "side": side, "status": kind, "text": st, "lat": float(coord.group(2)), "lon": float(coord.group(1)),
                     "until": f"{until.group(3)}-{int(until.group(1)):02d}-{int(until.group(2)):02d}" if until else ""})
    return rows


def main():
    if "--kml" in sys.argv:
        kml = open(sys.argv[sys.argv.index("--kml") + 1], encoding="utf-8").read()
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "I5Buddy-build/1.0 (rest area status for an offline road guide)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            kml = r.read().decode("utf-8")
    cal = parse(kml)
    s = open(os.path.join(ROOT, "data", "i5.js"), encoding="utf-8").read()
    rest = [r for r in json.loads(s[s.index("=") + 1: s.rstrip().rindex(";")])["rest"] if r["kind"] == "rest_area" and "lat" in r]
    today = datetime.date.today().isoformat()
    over, seen = [], set()
    for c in cal:
        near = [r for r in rest if math.hypot((r["lat"] - c["lat"]) * 69, (r["lon"] - c["lon"]) * 57) < 0.5 and (c["side"] == 0 or r["side"] in (c["side"], 0))]
        if not near:
            print("no I-5 Buddy rest area near", c["name"], file=sys.stderr)
        for r in near:
            key = (r["name"], r["side"], r["m"])
            if c["status"] == "open" or key in seen:
                continue
            seen.add(key)
            over.append({"m": r["m"], "side": r["side"], "name": r["name"], "status": c["status"], "since": "", "until": c["until"],
                         "src": URL, "checked": today, "note": f"Caltrans QuickMap: {c['name']}: {c['text']}"[:200]})
    out = {"_note": "Rest-area status overrides read by tools/build.py (REST[].status, .src, .until). Written by tools/rest_status.py "
                    "from Caltrans QuickMap's rest area file; only rest areas that are not open are listed. build.py ignores an "
                    "entry older than REST_STATUS_DAYS or past its reopening date: run tools/rest_status.py right before a release.",
           "checked": today, "source": URL, "i5_rest_areas_in_feed": len(cal),
           "overrides": sorted(over, key=lambda o: (o["m"], o["side"]))}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(cal)} I-5 rest areas in the Caltrans file, {len(over)} not open -> tools/rest-status.json")
    for o in out["overrides"]:
        print(f"  {o['status']:<9} {o['name']} (mile {o['m']}, {'N' if o['side'] == 1 else 'S' if o['side'] == -1 else 'both'}){' until ' + o['until'] if o['until'] else ''}")


if __name__ == "__main__":
    main()
