#!/usr/bin/env python3
"""Build data/i5.js for the app from the corridor line, travel extras and researched content.

Inputs
  tools/route-full.json      corridor line (python3 tools/route.py)
  tools/extras.json          cameras, services, rest areas, exits, outline, elevation (python3 tools/extras.py)
  tools/images.json          photo credits per place id (python3 tools/images.py), optional
  content/v2/*.json          researched places, zones, trivia (one file per stretch + *-gaps.json)
                             falls back to content/seg-*.json (California v1) when v2 is empty
Output
  data/i5.js                 window.I5DATA = {...}
  tools/build-report.txt     warnings worth a human look

Run: python3 tools/build.py
"""
import difflib, glob, json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "tools")
sys.path.insert(0, HERE)
from route import Projector  # noqa: E402

CATS = {"farm", "hist", "nature", "town", "stop", "odd"}
# States the app covers. I-5 Buddy was scoped to California on 2026-11-11. route-full.json and extras.json
# still hold Oregon and Washington, so SCOPE = ["CA", "OR", "WA"] rebuilds the whole road (it then needs
# content for those states in content/v2/, and the tests in tools/ that cover them).
SCOPE = ["CA"]
NEIGHBORS = {"CA": {"OR", "NV", "AZ"}, "OR": {"CA", "WA", "NV", "ID"}, "WA": {"OR", "ID", "BC"}}
END_NAMES = {  # what lies past the north end of the covered road
    "CA": {"short": "Oregon", "long": "the Oregon line"},
    "OR": {"short": "Washington", "long": "the Washington line"},
    "WA": {"short": "Canada", "long": "the Canadian border"},
}
DEST_LIST = [  # (label, state, exit ref) used for "Where are you headed?"
    ("Mexico border", "CA", "0"), ("San Diego", "CA", "16"), ("Oceanside", "CA", "54"), ("San Clemente", "CA", "76"),
    ("Anaheim", "CA", "109"), ("Downtown Los Angeles", "CA", "135"), ("Burbank", "CA", "146"), ("Santa Clarita", "CA", "168"),
    ("Grapevine", "CA", "215"), ("Kettleman City", "CA", "309"), ("Coalinga", "CA", "334"), ("Los Banos", "CA", "403"),
    ("Stockton", "CA", "473"), ("Sacramento", "CA", "519"), ("Williams", "CA", "577"), ("Red Bluff", "CA", "649"),
    ("Redding", "CA", "677"), ("Mount Shasta", "CA", "738"), ("Yreka", "CA", "776"), ("Ashland", "OR", "19"),
    ("Medford", "OR", "30"), ("Grants Pass", "OR", "58"), ("Roseburg", "OR", "124"), ("Eugene", "OR", "194"),
    ("Albany", "OR", "233"), ("Salem", "OR", "253"), ("Portland", "OR", "300"), ("Vancouver, WA", "WA", "1"),
    ("Longview", "WA", "36"), ("Centralia", "WA", "82"), ("Olympia", "WA", "105"), ("Tacoma", "WA", "133"),
    ("Seattle", "WA", "165"), ("Everett", "WA", "192"), ("Mount Vernon", "WA", "226"), ("Bellingham", "WA", "253"),
    ("Canadian border", "WA", "276"),
]

warn = []


def write_safely(path, text):
    """The project sits on a network drive that sometimes stalls: one big write can time out (ETIMEDOUT).
    Write a temp file in 64 KB pieces, then swap it in, retrying a few times."""
    import time
    raw = text.encode("utf-8")
    for attempt in range(6):
        tmp = path + ".tmp"
        try:
            with open(tmp, "wb") as fh:
                for i in range(0, len(raw), 65536):
                    fh.write(raw[i:i + 65536])
            os.replace(tmp, path)
            return
        except OSError as e:
            if attempt == 5:
                raise
            print(f"writing {os.path.basename(path)} failed ({e}); retrying", file=sys.stderr)
            time.sleep(5 * (attempt + 1))


# OpenStreetMap places near the San Ysidro exits include businesses across the line in Tijuana.
MEXICO_SIDE = {"Pemex", "Go", "Oxxo", "OXXO", "G500", "Hidrosina", "Hotel Catalina", "Hotel Nelson", "Hotel Pueblo Amigo"}


def border_services(s):
    """Drop names that are in Mexico from the exits right at the border (and lower the counts to match)."""
    if s.get("m", 99) > 2:
        return s
    s = dict(s)
    for kind in ("fuel", "ev", "food", "sleep"):
        names = s.get(kind) or []
        kept = [n for n in names if n not in MEXICO_SIDE]
        if len(kept) != len(names):
            s[kind] = kept
            s[kind + "N"] = max(len(kept), (s.get(kind + "N") or 0) - (len(names) - len(kept)))
    return s


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:48]


def simplify(line, tol_mi):
    """Douglas-Peucker on [m, lat, lon] (iterative), tolerance in miles."""
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        la = line[a][1]
        kx, ky = 69.17 * math.cos(math.radians(la)), 69.0
        ax, ay = line[a][2] * kx, line[a][1] * ky
        bx, by = line[b][2] * kx, line[b][1] * ky
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-12
        dmax, idx = -1, a
        for i in range(a + 1, b):
            px, py = line[i][2] * kx, line[i][1] * ky
            d = abs(dx * (ay - py) - dy * (ax - px)) / L
            if d > dmax:
                dmax, idx = d, i
        if dmax > tol_mi:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(line, keep) if k]


CA_SEGS = ["ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8"]


def load_content():
    """v2 stretch files that passed their fact-check (content/v2/logs/<id>-verify.done); for any California
    stretch without one, fall back to its v1 content. --unverified includes files still being researched."""
    files = sorted(glob.glob(os.path.join(ROOT, "content", "v2", "*.json")))
    if "--unverified" not in sys.argv:
        pending = [f for f in files if not os.path.exists(os.path.join(ROOT, "content", "v2", "logs", os.path.basename(f)[:-5] + "-verify.done"))]
        for f in pending:
            warn.append(f"not fact-checked yet, left out: {os.path.basename(f)}")
        files = [f for f in files if f not in pending]
    v2 = bool(files)
    have = {os.path.basename(f)[:-5] for f in files}
    legacy = set()
    if not v2:
        files = sorted(glob.glob(os.path.join(ROOT, "content", "seg-*.json")))
        legacy = set(files)
    else:
        for seg in CA_SEGS:
            if seg not in have:
                f = os.path.join(ROOT, "content", "v2", "existing", seg + ".json")
                if os.path.exists(f):
                    files.append(f)
                    legacy.add(f)
                    warn.append(f"using v1 content for {seg} (no v2 file yet)")
    places, zones, trivia = [], [], []
    for f in files:
        try:
            d = json.load(open(f))
        except ValueError as e:
            warn.append(f"BAD JSON {os.path.basename(f)}: {e}")
            continue
        for p in d.get("places", []):
            p["_file"] = os.path.basename(f)
            if f in legacy:  # v1: California only, "mi" = exit number
                p.setdefault("state", "CA")
                p.setdefault("exit", p.get("mi"))
            places.append(p)
        for z in d.get("zones", []):
            z.setdefault("state", "CA")
            zones.append(z)
        for t in d.get("trivia", []):
            t.setdefault("state", "CA")
            t.setdefault("exit", t.get("mi"))
            trivia.append(t)
    return places, zones, trivia, v2


def main():
    R = json.load(open(os.path.join(HERE, "route-full.json")))
    X = json.load(open(os.path.join(HERE, "extras.json")))
    states = [s for s in R["states"] if s["id"] in SCOPE]
    off = {s["id"]: s["from"] for s in states}
    end = states[-1]["to"]
    line = [p for p in R["line"] if p[0] <= end + 1e-6]
    P = Projector([(p[1], p[2]) for p in line], [p[0] for p in line])
    out_of_scope = {"places": 0, "zones": 0, "trivia": 0}
    route = simplify(line, 0.012)  # ~20 m
    route = [[round(m, 2), round(a, 5), round(o, 5)] for m, a, o in route]

    exits_by = {(e[1], e[2]): e[0] for e in X["exits"]}

    def exit_m(st, ex):
        try:
            n = float(re.match(r"[\d.]+", str(ex)).group(0))
        except (AttributeError, TypeError):
            return None
        hit = exits_by.get((st, str(ex).upper()))
        return hit if hit is not None else off.get(st, 0) + n

    images = {}
    ip = os.path.join(HERE, "images.json")
    if os.path.exists(ip):
        images = json.load(open(ip))

    raw, zones_raw, trivia_raw, v2 = load_content()
    places = []
    for p in raw:
        st = (p.get("state") or "CA").upper()
        if st not in off:
            if st in NEIGHBORS:
                out_of_scope["places"] += 1
            else:
                warn.append(f"bad state {st}: {p.get('name')}")
            continue
        cat = p.get("cat") if p.get("cat") in CATS else "odd"
        m_exit = exit_m(st, p.get("exit"))
        lat, lon = p.get("lat"), p.get("lon")
        m, side, dist = m_exit, 0, None
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            pr = P.project(lat, lon)
            if pr["val"] is None:
                warn.append(f"far from I-5 ({p.get('name')}, {p['_file']}): coords {lat},{lon}")
            else:
                dist = pr["dist"]
                side = pr["side"] if dist > 0.12 else 0
                if dist <= 4 or m_exit is None:
                    if m_exit is not None and abs(pr["val"] - m_exit) > 6:
                        warn.append(f"exit mismatch ({p.get('name')}, {p['_file']}): exit {st} {p.get('exit')} = mile {m_exit:.0f}, coords say {pr['val']:.0f}")
                    m = pr["val"]
        if m is None:
            warn.append(f"no position ({p.get('name')}, {p['_file']})")
            continue
        vis = bool(p.get("visible"))
        if vis and dist is not None and dist > 12 and cat != "nature":
            vis = False
        text = (p.get("text") or "").strip()
        if not text:
            continue
        pid = f"{st.lower()}{p.get('exit')}-{slug(p.get('name'))}"
        q = {
            "id": pid, "m": round(m, 2), "st": st, "ex": str(p.get("exit")), "name": p.get("name", "").strip(), "cat": cat,
            "side": side, "vis": vis, "text": text,
        }
        if dist is not None:
            q["off"] = round(dist, 1)
        for k_in, k_out in (("more", "more"), ("spot", "spot"), ("months", "months"), ("src", "src"), ("src2", "src2"), ("wiki", "wiki")):
            if p.get(k_in):
                q[k_out] = p[k_in]
        if isinstance(lat, (int, float)):
            q["lat"], q["lon"] = round(lat, 5), round(lon, 5)
        places.append(q)

    # de-duplicate: same slug, or near-identical names within 2 miles
    places.sort(key=lambda p: (p["m"], -len(p.get("more", ""))))
    kept = []
    for p in places:
        dup = None
        for k in kept[-40:]:
            if abs(k["m"] - p["m"]) > 3:
                continue
            a, b = slug(k["name"]), slug(p["name"])
            if a == b or difflib.SequenceMatcher(None, a, b).ratio() > 0.86:
                dup = k
                break
        if dup:
            better = p if (len(p.get("more", "")) + (50 if "lat" in p else 0)) > (len(dup.get("more", "")) + (50 if "lat" in dup else 0)) else dup
            if better is p:
                kept[kept.index(dup)] = p
            warn.append(f"duplicate dropped: '{(dup if better is p else p)['name']}' (kept '{better['name']}')")
            continue
        kept.append(p)
    places = sorted(kept, key=lambda p: p["m"])
    seen = {}
    for p in places:
        if p["id"] in seen:
            seen[p["id"]] += 1
            p["id"] += f"-{seen[p['id']]}"
        else:
            seen[p["id"]] = 1
        im = images.get(p["id"]) or images.get(p.get("wiki") or "")
        if im:
            p["img"] = im

    zones = []
    for z in zones_raw:
        st = (z.get("state") or "CA").upper()
        if st not in off:
            out_of_scope["zones"] += 1
            continue
        try:
            a = exit_m(st, z["from"])
            b = exit_m(st, z["to"])
        except KeyError:
            continue
        if a is None or b is None or b <= a:
            warn.append(f"bad zone {z.get('label')}: {z.get('from')}-{z.get('to')}")
            continue
        zz = {"from": round(a, 1), "to": round(b, 1), "label": z.get("label", "").strip(), "text": z.get("text", "").strip()}
        if z.get("seasons"):
            zz["seasons"] = {k: v for k, v in z["seasons"].items() if v}
        zones.append(zz)
    zones.sort(key=lambda z: z["from"])
    # close small gaps and trim overlaps
    for a, b in zip(zones, zones[1:]):
        if 0 < b["from"] - a["to"] <= 15:
            a["to"] = b["from"]
        elif b["from"] - a["to"] > 15:
            warn.append(f"zone gap {a['to']}-{b['from']}")
        elif b["from"] < a["to"]:
            a["to"] = b["from"]
    zones = [z for z in zones if z["to"] > z["from"]]

    trivia = []
    for t in trivia_raw:
        st = (t.get("state") or "CA").upper()
        if st not in off:
            out_of_scope["trivia"] += 1
            continue
        if not isinstance(t.get("answer"), int) or len(t.get("choices", [])) < 2 or t["answer"] >= len(t["choices"]):
            warn.append(f"bad trivia: {t.get('q')}")
            continue
        m = exit_m(st, t.get("exit"))
        if m is None:
            continue
        trivia.append({"m": round(m, 1), "q": t["q"], "choices": t["choices"], "answer": t["answer"], "why": t.get("why", ""), "src": t.get("src")})

    dests = []
    for label, st, ref in DEST_LIST:
        if st not in off:
            continue
        m = exits_by.get((st, ref))
        if m is None:
            m = off[st] + float(ref)
        dests.append({"name": label, "m": round(min(max(m, 0), end), 1)})
    if SCOPE[-1] != "WA":  # the north end of the covered road is a state line
        dests.append({"name": END_NAMES[SCOPE[-1]]["short"] + " border", "m": round(end, 1)})
    if any(out_of_scope.values()):
        warn.append("skipped outside SCOPE %s: %d places, %d zones, %d trivia" % (SCOPE, out_of_scope["places"], out_of_scope["zones"], out_of_scope["trivia"]))

    in_road = lambda m: m is not None and -0.5 <= m <= end + 0.5  # noqa: E731
    keep_outline = set(SCOPE).union(*(NEIGHBORS[s] for s in SCOPE))
    elev = (X.get("elev") or [])[: int(math.ceil(end)) + 1]
    out = {
        "version": __import__("datetime").date.today().isoformat(),
        "scope": SCOPE,
        "ends": {"S": {"short": "Mexico", "long": "the Mexico border"}, "N": END_NAMES[SCOPE[-1]]},
        "states": states, "route": route, "places": places, "zones": zones, "trivia": trivia, "dests": dests,
        "exits": [e for e in X["exits"] if e[1] in off],
        "services": [border_services(s) for s in X["services"] if s.get("st", "CA") in off],
        "rest": [r for r in X["rest"] if in_road(r.get("m"))],
        "cams": [c for c in X["cams"] if in_road(c.get("m"))],
        "districts": X["districts"],
        "elev": elev, "passes": [p for p in X.get("passes", []) if in_road(p.get("m"))],
        "outline": [o for o in (X.get("outline") or []) if o.get("st") in keep_outline],
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    js = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    dest = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(ROOT, "data", "i5.js")
    write_safely(dest, "// Generated by tools/build.py. Do not edit by hand.\nwindow.I5DATA=" + js + ";\n")
    write_safely(os.path.join(HERE, "build-report.txt"), "\n".join(warn) + "\n")
    per_state = {s["id"]: sum(1 for p in places if p["st"] == s["id"]) for s in states}
    print(f"{'v2' if v2 else 'v1'} content, scope {'+'.join(SCOPE)} (0-{end:.1f} mi): {len(places)} places {per_state}, {len(zones)} zones, {len(trivia)} trivia; "
          f"route {len(route)} pts; {len(out['cams'])} cams; {len(out['services'])} exits with services; {len(out['rest'])} rest areas; "
          f"{len(js) // 1024} KB; {len(warn)} warnings -> tools/build-report.txt")


if __name__ == "__main__":
    main()
