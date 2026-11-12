#!/usr/bin/env python3
"""Travel data along I-5: live cameras, services by exit, rest areas, Caltrans districts, map outline, elevation.

Inputs (downloaded once, kept in the repo):
  tools/live/cctv-XX.json, cms-XX.json   Caltrans CWWP2 feeds (districts on I-5)
  tools/live/wsdot-cameras.json          WSDOT public camera list
  tools/osm/poi-{ca,or,wa}.json          OpenStreetMap gas / EV / food / lodging / rest areas near I-5
  tools/osm/passes.json                  OpenStreetMap named passes and summits near I-5 (optional)
  tools/geo/states.geojson               Natural Earth admin-1 (optional; for the map outline)
  tools/geo/elev.json                    elevation every mile (optional; made by --elevation)
Output:
  tools/extras.json

Run: python3 tools/extras.py [--elevation]
"""
import glob, json, math, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from route import Projector, hv  # noqa: E402

R = json.load(open(os.path.join(HERE, "route-full.json")))
LINE = R["line"]
P = Projector([(p[1], p[2]) for p in LINE], [p[0] for p in LINE])
EXITS = json.load(open(os.path.join(HERE, "exits.json")))


def loadj(path):
    """JSON loader that tolerates feeds with stray Latin-1 bytes."""
    try:
        return json.loads(open(path, "rb").read().decode("utf-8", errors="replace"))
    except (ValueError, OSError):
        print(f"  skipping unreadable {os.path.basename(path)}", file=sys.stderr)
        return None


def at(m):
    lo, hi = 0, len(LINE) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if LINE[mid][0] < m:
            lo = mid + 1
        else:
            hi = mid
    i = max(1, lo)
    (m0, a0, o0), (m1, a1, o1) = LINE[i - 1], LINE[i]
    t = 0 if m1 == m0 else max(0, min(1, (m - m0) / (m1 - m0)))
    return a0 + t * (a1 - a0), o0 + t * (o1 - o0)


def clean_cam_name(s):
    s = s or ""
    s = re.sub(r"\([A-Z]?\d+\)", "", s)                       # (C214)
    s = re.sub(r"^[A-Z]{2,3}-\d+-?", "", s.strip())             # KER-5-
    s = re.sub(r"^\s*(I-?5|[NS]/?B\s*5|[NS]B\s*5)\s*:?\s*", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" -:")
    s = s.title()
    for a, b in (("Sr-", "SR "), ("Sr ", "SR "), ("Us-", "US "), ("I-", "I-"), ("At ", "at "), (" Of ", " of "), (" And ", " and ")):
        s = s.replace(a, b)
    return s[:1].upper() + s[1:60]


def cameras():
    cams = []
    for f in sorted(glob.glob(os.path.join(HERE, "live", "cctv-*.json"))):
        for row in (loadj(f) or {}).get("data", []):
            c = row["cctv"]
            loc = c["location"]
            if loc.get("route") != "I-5" or c.get("inService") != "true":
                continue
            img = c["imageData"]["static"].get("currentImageURL")
            if not img:
                continue
            pr = P.project(float(loc["latitude"]), float(loc["longitude"]))
            if pr["dist"] > 0.5:
                continue
            cams.append({"m": round(pr["val"], 2), "name": clean_cam_name(loc.get("locationName")) or loc.get("nearbyPlace", ""),
                         "near": loc.get("nearbyPlace", ""), "img": img, "by": "Caltrans", "d": loc.get("district")})
    w = loadj(os.path.join(HERE, "live", "wsdot-cameras.json"))["cameras"]["items"]
    for c in w:
        if c.get("roadName") != "I-5" or not c.get("url"):
            continue
        pr = P.project(c["lat"], c["lon"])
        if pr["dist"] > 0.5:
            continue
        name = re.sub(r"^I-5 at MP [\d.]+:?\s*", "", c.get("title", "")).strip() or c.get("title", "")
        cams.append({"m": round(pr["val"], 2), "name": name[:60], "near": "", "img": c["url"], "by": "WSDOT"})
    cams.sort(key=lambda c: c["m"])
    # thin out: at most one camera per 0.4 mile
    out = []
    for c in cams:
        if out and c["m"] - out[-1]["m"] < 0.4:
            continue
        out.append(c)
    return out


def districts():
    """Corridor-mile range of each Caltrans district on I-5 (for fetching live signs and chain controls)."""
    rng = {}
    for f in sorted(glob.glob(os.path.join(HERE, "live", "c*-*.json"))):
        d = loadj(f)
        for row in (d or {}).get("data", []):
            c = row.get("cctv") or row.get("cms") or row.get("cc")
            loc = c["location"]
            if loc.get("route") != "I-5":
                continue
            pr = P.project(float(loc["latitude"]), float(loc["longitude"]))
            if pr["dist"] > 1:
                continue
            if not str(loc.get("district", "")).isdigit():
                continue
            d = loc["district"].zfill(2)
            lo, hi = rng.get(d, (1e9, -1e9))
            rng[d] = (min(lo, pr["val"]), max(hi, pr["val"]))
    return sorted([{"d": d, "from": round(a, 1), "to": round(b, 1)} for d, (a, b) in rng.items()], key=lambda x: x["from"])


BRAND_KEYS = ("brand", "name", "operator")


def label(t):
    for k in BRAND_KEYS:
        if t.get(k):
            return t[k].strip()
    return None


def services():
    by_exit = {}
    rest = []
    ex = [e for e in EXITS]
    for st in ("ca", "or", "wa"):
        p = os.path.join(HERE, "osm", f"poi-{st}.json")
        try:
            els = loadj(p)["elements"]
        except (TypeError, KeyError):
            print(f"  no services for {st}", file=sys.stderr)
            continue
        for el in els:
            t = el.get("tags", {})
            lat = el.get("lat") or el.get("center", {}).get("lat")
            lon = el.get("lon") or el.get("center", {}).get("lon")
            if lat is None:
                continue
            kind = t.get("amenity") or t.get("tourism") or t.get("highway")
            if kind in ("rest_area", "services"):
                pr = P.project(lat, lon)
                if pr["dist"] > 0.3:
                    continue
                rest.append({"m": round(pr["val"], 2), "name": t.get("name") or ("Rest area" if kind == "rest_area" else "Services"),
                             "side": pr["side"], "kind": kind,
                             "toilets": t.get("toilets") != "no", "lat": round(lat, 5), "lon": round(lon, 5)})
                continue
            # nearest exit within 1.3 mi
            best = None
            for e in ex:
                if abs(e["lat"] - lat) > 0.03 or abs(e["lon"] - lon) > 0.04:
                    continue
                d = hv((lat, lon), (e["lat"], e["lon"]))
                if d < 1.3 and (best is None or d < best[0]):
                    best = (d, e)
            if not best:
                continue
            e = best[1]
            key = (e["st"], e["ref"])
            s = by_exit.setdefault(key, {"m": e["m"], "st": e["st"], "ref": e["ref"], "fuel": {}, "ev": {}, "food": {}, "sleep": {}})
            lab = label(t)
            bucket = {"fuel": "fuel", "charging_station": "ev", "fast_food": "food", "restaurant": "food", "cafe": "food", "hotel": "sleep", "motel": "sleep"}.get(kind)
            if not bucket:
                continue
            nm = lab or {"fuel": "Gas", "ev": "EV charger", "food": "Food", "sleep": "Lodging"}[bucket]
            s[bucket][nm] = s[bucket].get(nm, 0) + 1
    out = []
    for s in sorted(by_exit.values(), key=lambda s: s["m"]):
        row = {"m": s["m"], "st": s["st"], "ref": s["ref"]}
        for b in ("fuel", "ev", "food", "sleep"):
            names = sorted(s[b].items(), key=lambda kv: (-kv[1], kv[0]))
            row[b] = [n for n, _ in names[:6]]
            row[b + "N"] = sum(s[b].values())
        out.append(row)
    # merge rest areas that are the same place (polygon + node)
    rest.sort(key=lambda r: r["m"])
    merged = []
    for r in rest:
        if merged and abs(r["m"] - merged[-1]["m"]) < 0.4 and r["side"] == merged[-1]["side"]:
            if merged[-1]["name"] in ("Rest area", "Services") and r["name"] not in ("Rest area", "Services"):
                merged[-1]["name"] = r["name"]
            continue
        merged.append(r)
    return out, merged


def exits_compact():
    out = []
    for e in sorted(EXITS, key=lambda e: e["m"]):
        d = "; ".join(e["dest"])[:90]
        out.append([round(e["m"], 2), e["st"], e["ref"], d])
    return out


def outline():
    p = os.path.join(HERE, "geo", "states.geojson")
    if not os.path.exists(p):
        return None
    g = loadj(p)
    keep = {"California": "CA", "Oregon": "OR", "Washington": "WA", "Nevada": "NV", "Idaho": "ID", "British Columbia": "BC", "Baja California": "BN", "Arizona": "AZ"}
    out = []

    def simplify(pts, tol):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        if a == b:  # closed ring: simplify each half
            mid = len(pts) // 2
            return simplify(pts[: mid + 1], tol)[:-1] + simplify(pts[mid:], tol)
        dmax, idx = 0, 0
        for i in range(1, len(pts) - 1):
            p = pts[i]
            # perpendicular distance in degrees (fine for simplification)
            num = abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0])
            den = math.hypot(b[1] - a[1], b[0] - a[0]) or 1e-12
            d = num / den
            if d > dmax:
                dmax, idx = d, i
        if dmax > tol:
            return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
        return [a, b]

    for f in g["features"]:
        nm = f["properties"].get("name")
        if nm not in keep:
            continue
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            ring = poly[0]
            if len(ring) < 20 and keep[nm] not in ("CA", "OR", "WA"):
                continue
            s = simplify([(round(x, 4), round(y, 4)) for x, y in ring], 0.02)
            if len(s) >= 4:
                out.append({"st": keep[nm], "pts": [[round(y, 3), round(x, 3)] for x, y in s]})
    return out


def elevation(fetch):
    p = os.path.join(HERE, "geo", "elev.json")
    if fetch:
        total = int(LINE[-1][0])
        pts = [at(m) for m in range(0, total + 1)]
        elev = []
        for i in range(0, len(pts), 100):
            chunk = pts[i:i + 100]
            locs = "|".join(f"{a:.5f},{o:.5f}" for a, o in chunk)
            req = urllib.request.Request("https://api.opentopodata.org/v1/srtm90m?locations=" + locs, headers={"User-Agent": "I5Buddy/1.0"})
            for attempt in range(4):
                try:
                    r = json.load(urllib.request.urlopen(req, timeout=60))
                    break
                except Exception as ex:
                    print("  elevation retry", i, ex, file=sys.stderr)
                    time.sleep(3 + attempt * 3)
            elev += [round((x["elevation"] or 0) * 3.28084) for x in r["results"]]
            time.sleep(1.2)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        json.dump(elev, open(p, "w"))
    return json.load(open(p)) if os.path.exists(p) else None


def passes():
    p = os.path.join(HERE, "osm", "passes.json")
    if not os.path.exists(p):
        return []
    out = []
    for el in json.load(open(p))["elements"]:
        t = el.get("tags", {})
        if not t.get("name") or "lat" not in el:
            continue
        pr = P.project(el["lat"], el["lon"])
        if pr["dist"] > 0.4:
            continue
        ele = t.get("ele")
        try:
            ft = round(float(re.sub(r"[^\d.]", "", ele)) * 3.28084) if ele and "ft" not in ele else (round(float(re.sub(r"[^\d.]", "", ele))) if ele else None)
        except ValueError:
            ft = None
        out.append({"m": round(pr["val"], 1), "name": t["name"], "ft": ft})
    out.sort(key=lambda x: x["m"])
    return out


def main():
    fetch = "--elevation" in sys.argv
    cams = cameras()
    svc, rest = services()
    data = {
        "cams": cams,
        "districts": districts(),
        "services": svc,
        "rest": rest,
        "exits": exits_compact(),
        "outline": outline(),
        "elev": elevation(fetch),
        "passes": passes(),
    }
    json.dump(data, open(os.path.join(HERE, "extras.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"cams {len(cams)} (CA {sum(c['by']=='Caltrans' for c in cams)}, WA {sum(c['by']=='WSDOT' for c in cams)}), districts {len(data['districts'])}, "
          f"exits w/ services {len(svc)}, rest areas {len(rest)}, exits {len(data['exits'])}, outline {len(data['outline'] or [])} rings, "
          f"elev {len(data['elev'] or [])}, passes {len(data['passes'])}")


if __name__ == "__main__":
    main()
