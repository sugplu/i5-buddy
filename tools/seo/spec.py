"""I-5 Buddy search pages: which towns and route/topic guides exist and the facts behind each one.

Everything here is computed from data/i5.js (via tools/guides.py load()), so a page never says anything the app does not.
build(d) returns {"towns": [...], "guides": [...]}; tools/seo/packets.py trims each entry into the packet the writer sees,
and tools/guides.py renders the same entries into HTML. Mileposts are California exit numbers (count up from the border).
"""
import re

# Town pages: one per "town" landmark in the data. The key is the landmark's name in data/i5.js, the value the town.
TOWN_NAMES = {
    "National City's royal ranch": "National City", "Encinitas, the little oaks": "Encinitas", "Carlsbad's mineral water": "Carlsbad",
    "Oceanside and its pier": "Oceanside", "Spanish Village by the Sea": "San Clemente", "Santa Ana, the county seat": "Santa Ana",
    "Anaheim's German vineyards": "Anaheim", "La Mirada's olive ranch": "La Mirada", "Downtown Los Angeles skyline": "Downtown Los Angeles",
    "Burbank, the Media Capital": "Burbank", "Sun Valley's thorny name": "Sun Valley", "Pacoima, Ritchie Valens' hometown": "Pacoima",
    "Gorman and its wildflowers": "Gorman", "Taft, once called Moron": "Taft", "The Buttonwillow tree": "Buttonwillow",
    "Lost Hills": "Lost Hills", "Alpaugh and Atwell's Island": "Alpaugh", "Avenal, the oat field": "Avenal", "Huron, harvest town": "Huron",
    "Coalinga and the Iron Zoo": "Coalinga", "Mendota, cantaloupe town": "Mendota", "Los Banos, the baths": "Los Banos",
    "Santa Nella's name": "Santa Nella", "Gustine": "Gustine", "Newman and Orestimba Creek": "Newman", "Patterson, the Paris plan": "Patterson",
    "Diablo Grande": "Diablo Grande", "Vernalis": "Vernalis", "Banta": "Banta", "Tracy, the railroad town": "Tracy",
    "Manteca, a dairy town named lard": "Manteca", "Lathrop, born of a quarrel": "Lathrop", "Stockton, once Tuleburg": "Stockton",
    "Lodi, wine and root beer": "Lodi", "Elk Grove": "Elk Grove", "Freeport, a town born of taxes": "Freeport",
    "Sacramento, the state capital": "Sacramento", "Knights Landing": "Knights Landing", "Woodland, City of Trees": "Woodland",
    "Yolo, place of rushes": "Yolo", "Zamora, cut by the highways": "Zamora", "Dunnigan, once Antelope": "Dunnigan",
    "Tacitus Arbuckle's town": "Arbuckle", "Colusa and Korusi": "Colusa", "Willows, the cattle stop": "Willows", "Corning, olive town": "Corning",
    "Tehama, the first county seat": "Tehama", "Gerber, the railroad stop": "Gerber", "Red Bluff, head of navigation": "Red Bluff",
    "Cottonwood, the halfway town": "Cottonwood", "Anderson, a railroad town": "Anderson", "Redding, once Poverty Flats": "Redding",
    "Shasta Lake, the dam towns": "Shasta Lake", "Lakehead, top of the lake": "Lakehead", "Dunsmuir, the railroad town": "Dunsmuir",
    "McCloud, a company town": "McCloud", "Mount Shasta City": "Mount Shasta", "Weed, a windy lumber town": "Weed",
    "Gazelle's antelope name": "Gazelle", "Yreka, the gold town": "Yreka", "Hilt, the border town": "Hilt",
}
MAX_RADIUS = 4.0  # miles each side of the town's landmark that count as "near this town"

# The 12 route and topic guides. kind: route (zones + landmarks + exits), stops (exits and services), ev, rest_gaps, history99, winter.
GUIDE_SPECS = [
    {"slug": "san-diego-to-los-angeles", "kind": "route", "from": 16, "to": 135, "h1": "San Diego to Los Angeles on I-5",
     "seed": "San Diego to Los Angeles on I-5: exits, stops and what you pass", "live": None},
    {"slug": "los-angeles-to-bakersfield", "kind": "route", "from": 135, "to": 257, "h1": "Los Angeles to Bakersfield on I-5 over the Grapevine",
     "seed": "Los Angeles to Bakersfield on I-5: over the Grapevine, exit by exit",
     "live": ("Is the Grapevine open?", "../../grapevine/", "Live closures and chain controls over Tejon Pass.")},
    {"slug": "bakersfield-to-sacramento", "kind": "route", "from": 257, "to": 519, "h1": "Bakersfield to Sacramento on I-5 via Kettleman City",
     "seed": "Bakersfield to Sacramento on I-5 via Kettleman City: stops and exits", "live": None},
    {"slug": "sacramento-to-stockton", "kind": "route", "from": 473, "to": 519, "h1": "Sacramento to Stockton on I-5",
     "seed": "Sacramento to Stockton on I-5: exits and what you pass", "live": None},
    {"slug": "redding-to-mount-shasta-and-weed", "kind": "route", "from": 677, "to": 757, "h1": "Redding to Mount Shasta and Weed on I-5",
     "seed": "Redding to Mount Shasta and Weed on I-5: exits and what you pass",
     "live": ("Is I-5 open through the Siskiyous?", "../../grapevine/#siskiyous", "Live closures and chain controls through Mount Shasta and the Siskiyous.")},
    {"slug": "ev-charging", "kind": "ev", "from": 0, "to": 797, "h1": "EV charging on I-5 in California",
     "seed": "EV charging on I-5 in California: the exits where a charger is mapped", "live": None, "time_sensitive": True},
    {"slug": "kettleman-city-stop", "kind": "stops", "from": 296, "to": 322, "h1": "The Kettleman City stop on I-5",
     "seed": "Kettleman City on I-5: exit 309 gas, food and the nearest rest areas", "live": None},
    {"slug": "buttonwillow-lost-hills-coalinga", "kind": "stops", "from": 255, "to": 340, "h1": "Buttonwillow, Lost Hills and Coalinga stops on I-5",
     "seed": "Buttonwillow, Lost Hills and Coalinga on I-5: gas, food and rest areas", "live": None},
    {"slug": "i-5-and-highway-99", "kind": "history99", "from": 0, "to": 797, "h1": "I-5 and Highway 99 in California",
     "seed": "I-5 and Highway 99 in California: the old road and the new", "live": None},
    {"slug": "grapevine-winter-driving", "kind": "winter", "from": 176, "to": 221, "h1": "Grapevine winter driving on I-5",
     "seed": "Grapevine winter driving on I-5: Tejon Pass, Fort Tejon and Gorman", "time_sensitive": True,
     "live": ("Is the Grapevine open?", "../../grapevine/", "Live closures and chain controls over Tejon Pass, from the CHP and Caltrans.")},
    {"slug": "rest-area-gaps", "kind": "rest_gaps", "from": 0, "to": 797, "h1": "I-5 rest areas in California, north and south: how far between stops",
     "seed": "I-5 rest areas in California: how far apart they are, north and south", "live": None},
    {"slug": "sacramento-river-canyon", "kind": "route", "from": 688, "to": 740, "h1": "The Sacramento River canyon on I-5",
     "seed": "The Sacramento River canyon on I-5: Shasta Lake to Dunsmuir", "live": None},
]

# The older, full-length guides (tools/guides.py GUIDES): a landmark inside their range has its full story there.
OLD_RANGES = [("los-angeles-to-san-francisco", 135, 446), ("sacramento-to-redding", 519, 680), ("redding-to-oregon", 677, 797)]


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def full_story(place):
    for slug, lo, hi in OLD_RANGES:
        if lo <= place["m"] <= hi:
            return slug
    return None


ABBREV = {"jr", "sr", "st", "mt", "mr", "mrs", "ms", "dr", "ft", "no", "co", "inc", "vs", "lt", "gen", "capt", "col", "hwy", "ave", "blvd", "rd", "u.s", "u.s.a", "e.g", "i.e", "etc", "a.m", "p.m", "ca", "calif", "gov", "sen", "rep", "pres", "prof", "mt"}


def sentences(text):
    """Split at . ! ? followed by space and a capital letter or quote, never after an abbreviation, an initial or initials, or
    a digit ("magnitude 6.7", "Jr.", "St. Louis", "U.S. 99", "B.F. Sisk Dam": the Santa Nella page showed "West of the
    freeway, B.F." as a whole sentence until 3.0.8)."""
    out, start = [], 0
    for m in re.finditer(r"[.!?][\"')\]]*\s+(?=[A-Z\"\u201c(])", text):
        head = text[start:m.start()]
        last = re.findall(r"[\w.]+$", head)
        tok = last[0].lower().rstrip(".") if last else ""
        if tok in ABBREV or re.fullmatch(r"[a-z](?:\.[a-z])*", tok):  # an initial, or initials ("B.F. Sisk Dam", 3.0.8)
            continue
        out.append(text[start:m.end()].strip())
        start = m.end()
    if text[start:].strip():
        out.append(text[start:].strip())
    return out


def first_sentences(text, n=2):
    return " ".join(sentences(text)[:n])


def _place(p, n=1):
    return {"id": p["id"], "name": p["name"], "ex": str(p["ex"]), "m": round(p["m"], 1), "cat": p["cat"], "side": p.get("side") or 0,
            "detour": bool(p.get("detour")), "text": first_sentences(p["text"], n), "src": p.get("src") or "", "story": full_story(p)}


def _service(s, exit_names):
    return {"ref": s["ref"], "m": round(s["m"], 1), "name": exit_names.get(s["ref"], ""), "fuel": s.get("fuel") or [], "fuelN": s.get("fuelN") or 0,
            "ev": s.get("ev") or [], "evN": s.get("evN") or 0, "food": (s.get("food") or [])[:8], "foodN": s.get("foodN") or 0,
            "sleep": (s.get("sleep") or [])[:6], "sleepN": s.get("sleepN") or 0}


def _rest_entries(d, rest_stops):
    return rest_stops(d, 0, 800)


def _dir_word(r):
    return {"both": "both directions", "northbound": "northbound side", "southbound": "southbound side"}.get(r["dir"], "direction not stated in the data")


def build(d, rest_stops, junk_rest):
    ca_exits = [e for e in d["exits"] if e[1] == "CA"]
    exit_names = {e[2]: e[3] for e in ca_exits}
    services = [_service(s, exit_names) for s in d["services"] if s["st"] == "CA"]
    rests = [{"name": r["name"], "m": round(r["m"], 1), "dir": r["dir"], "dirword": _dir_word(r)} for r in rest_stops(d, 0, 800)]
    centers = [{"name": r["name"], "m": round(r["m"], 1)} for r in sorted(d["rest"], key=lambda r: r["m"])
               if r["kind"] == "services" and not junk_rest.match(r["name"].strip())]
    places_all = [p for p in d["places"] if p["st"] == "CA"]

    def rests_in(lo, hi):
        return [r for r in rests if lo <= r["m"] <= hi]

    def svc_in(lo, hi):
        return [s for s in services if lo <= s["m"] <= hi]

    def places_in(lo, hi, n=1, skip_detour=False):
        return [_place(p, n) for p in sorted(places_all, key=lambda p: p["m"]) if lo <= p["m"] <= hi and not (skip_detour and p.get("detour"))]

    def zones_in(lo, hi):
        return [{"label": z["label"], "from": z["from"], "to": z["to"], "text": z["text"], "seasons": z.get("seasons") or {}}
                for z in d["zones"] if z["to"] > lo and z["from"] < hi]

    def nearest_rest(m):
        south = [r for r in rests if r["m"] <= m]
        north = [r for r in rests if r["m"] > m]
        s = max(south, key=lambda r: r["m"]) if south else None
        n = min(north, key=lambda r: r["m"]) if north else None
        return ({**s, "miles": round(m - s["m"], 1)} if s else None, {**n, "miles": round(n["m"] - m, 1)} if n else None)

    # ---- towns ----
    anchors = sorted(((p["m"], p, TOWN_NAMES[p["name"]]) for p in places_all if p["name"] in TOWN_NAMES), key=lambda t: t[0])
    towns = []
    for i, (m, p, name) in enumerate(anchors):
        prev_m = anchors[i - 1][0] if i else None
        next_m = anchors[i + 1][0] if i + 1 < len(anchors) else None
        rl = min(MAX_RADIUS, (m - prev_m) / 2) if prev_m is not None else MAX_RADIUS
        rr = min(MAX_RADIUS, (next_m - m) / 2) if next_m is not None else MAX_RADIUS
        lo, hi = max(0.0, m - rl), min(800.0, m + rr)
        sv = svc_in(lo, hi)
        pl = [x for x in places_in(lo, hi, 1) if x["id"] != p["id"]]
        zone = next((z for z in zones_in(m, m + 0.01)), None)
        rs, rn = nearest_rest(m)
        any_svc = any(s["fuelN"] or s["evN"] or s["foodN"] or s["sleepN"] for s in sv)
        count_places = len(pl) + 1
        towns.append({
            "kind": "town", "slug": slugify(name), "name": name, "m": round(m, 1), "window": [round(lo, 1), round(hi, 1)],
            "anchor": _place(p, 2), "anchor_more": first_sentences(p.get("more", ""), 2), "zone": zone, "places": pl[:14], "services": sv,
            "exits": [{"ref": e[2], "m": e[0], "name": e[3]} for e in ca_exits if lo <= e[0] <= hi],
            "rest_south": rs, "rest_north": rn, "thin": count_places < 2 and not any_svc, "n_places": count_places,
            "prev": None, "next": None,
        })
    for i, t in enumerate(towns):
        if i:
            t["prev"] = {"slug": towns[i - 1]["slug"], "name": towns[i - 1]["name"], "m": towns[i - 1]["m"]}
        if i + 1 < len(towns):
            t["next"] = {"slug": towns[i + 1]["slug"], "name": towns[i + 1]["name"], "m": towns[i + 1]["m"]}

    # ---- guides ----
    def covering(lo, hi, limit=6):
        return [t for t in towns if lo <= t["m"] <= hi][:limit]

    guides = []
    for sp in GUIDE_SPECS:
        lo, hi, kind = sp["from"], sp["to"], sp["kind"]
        g = {"kind": "guide", "gkind": kind, "slug": sp["slug"], "h1": sp["h1"], "seed": sp["seed"], "from": lo, "to": hi, "live": sp.get("live"),
             "time_sensitive": bool(sp.get("time_sensitive")), "miles": hi - lo}
        g["towns"] = [{"slug": t["slug"], "name": t["name"], "m": t["m"]} for t in towns if lo <= t["m"] <= hi] if kind in ("route", "stops", "winter") else []
        if kind == "route":
            g["zones"] = zones_in(lo, hi)
            g["places"] = places_in(lo, hi, 1, skip_detour=True)
            g["services"] = [s for s in svc_in(lo, hi) if s["fuelN"] or s["evN"] or s["foodN"]]
            g["rests"] = rests_in(lo, hi)
        elif kind == "stops":
            g["zones"] = zones_in(lo, hi)
            g["places"] = places_in(lo, hi, 1, skip_detour=True)
            g["services"] = svc_in(lo, hi)
            g["rests"] = rests_in(lo - 20, hi + 20)
            g["centers"] = [c for c in centers if lo - 8 <= c["m"] <= hi + 8]
        elif kind == "winter":
            g["zones"] = zones_in(lo, hi)
            g["places"] = places_in(lo, hi, 1, skip_detour=True)
            g["services"] = svc_in(lo - 12, hi + 12)
            g["rests"] = rests_in(lo - 30, hi + 30)
        elif kind == "ev":
            ev = [s for s in services if s["evN"]]
            g["services"] = ev
            gaps = []
            for a, b in zip(ev, ev[1:]):
                gaps.append({"from_m": a["m"], "to_m": b["m"], "miles": round(b["m"] - a["m"], 1), "from_name": a["name"], "to_name": b["name"]})
            g["gaps"] = sorted(gaps, key=lambda x: -x["miles"])[:8]
            g["exits_with_ev"] = len(ev)
            g["exits_total"] = len(services)
            g["networks"] = sorted({n for s in ev for n in s["ev"]})
        elif kind == "rest_gaps":
            g["rests"] = rests
            g["centers"] = centers
            gaps = [{"from_m": a["m"], "to_m": b["m"], "miles": round(b["m"] - a["m"], 1), "from_name": a["name"], "to_name": b["name"]}
                    for a, b in zip(rests, rests[1:])]
            g["gaps"] = gaps
            g["longest"] = sorted(gaps, key=lambda x: -x["miles"])[:6]
            g["n_rest"] = len(rests)
            g["n_centers"] = len(centers)
        elif kind == "history99":
            hits = []
            for p in sorted(places_all, key=lambda p: p["m"]):
                t = p["text"] + " " + p.get("more", "")
                if re.search(r"\b(Highway|U\.?S\.?|State Route|Route|Hwy\.?) ?99\b|\bUS 99\b", t):
                    q = _place(p, 1)
                    sents = re.findall(r"[^.!?]*\b(?:Highway|U\.S\.|US|Route|State Route) ?99\b[^.!?]*[.!?]", t)
                    q["text99"] = " ".join(s.strip() for s in sents[:2]) or q["text"]
                    hits.append(q)
            g["places"] = hits
        g["covers"] = covering(lo, hi) if kind in ("route", "stops", "winter") else []
        guides.append(g)
    return {"towns": towns, "guides": guides}
