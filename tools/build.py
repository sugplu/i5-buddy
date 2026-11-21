#!/usr/bin/env python3
"""Build data/i5.js for the app from the corridor line, travel extras and researched content.

Inputs
  tools/route-full.json      corridor line (python3 tools/route.py)
  tools/extras.json          cameras, services, rest areas, exits, outline, elevation (python3 tools/extras.py)
  tools/images.json          photo credits per place id (python3 tools/images.py), optional; alt_en / alt_es are the
                             photo's alt text (2026-11-20 photo check), null = no photo (a wrong photo is worse than none)
  tools/postcards.json       postcard lines per place id (places[].pc, at most 60 characters) and the share headline
                             templates (data key POSTCARDS), optional (claude-power/jobs/i5_postcards.py)
  tools/rest-status.json     rest-area closures from Caltrans QuickMap (REST[].status, .src, .until), optional, written by
                             tools/rest_status.py; an entry checked more than REST_STATUS_DAYS ago, or past its reopening
                             date, is ignored
  content/v2/*.json          researched places, zones, trivia (one file per stretch + *-gaps.json)
                             falls back to content/seg-*.json (California v1) when v2 is empty
                             ca-missions.json: the I-5 turn-offs to the California missions near I-5 (places with
                             "detour": {exit, road, dir, miles} and "mission": n), shipped like the other stretches
  content/missions.json      the 21 California missions (data key MISSIONS). Both mission files are copied in from
                             MISSIONS_SRC (the content agent's folder) when they exist there
  Spanish (3.1.0): the same files' *_es fields, all optional (an empty one falls back to English in the app):
    content/v2/*.json        places: name_es, text_es, more_es, spot_es, kids_es; zones: label_es, text_es, seasons_es
                             ({winter, spring, summer, fall}); trivia: q_es, choices_es (as many as choices), why_es
    content/missions.json    name_es (the mission's Spanish name), text_es, more_es, visit_es, status_es, people_es, founder_es
    content/names_es.json    the Spanish names of the two ends of the road and of the "Where to?" destinations
    tools/images.json        alt_es (what each photo shows, in Spanish)
    tools/postcards.json     lines_es (per place id, at most 60 characters) and templates_es (same placeholders)
  Kids text (3.1.0, Settings > Stories for kids): places' kids (English) and kids_es (Spanish), a story told to children
  in place of the place's text, where there is one.
  Stale text guard: an entry's es_src ({English field: src_hash of the English its Spanish was written from}) and a place's
  kids_src (src_hash of the text its kids stories were written from) leave out a Spanish or kids field whose English has
  changed since (build-report.txt names it), so a fact fixed in English never ships next to the old Spanish or kids story.
  Written by claude-power/jobs/i5_es_kids.py (Claude Opus 5.5 writes, Claude Sonnet 5.5 checks by back-translation).
Output
  data/i5.js                 window.I5DATA = {...}
  data/i5.es.js              window.I5DATA_ES = {version, lang: "es", ends, places: {id: {...}}, zones: {index: {...}},
                             trivia: {index: {...}}, missions: {n: {...}}, dests: {index: {name}}, postcards}: the Spanish
                             names and stories, laid over data/i5.js by js/i18n.js in Spanish mode (loaded only then,
                             not in sw.js SHELL). Same version as data/i5.js: the app ignores one from another build.
  tools/build-report.txt     warnings worth a human look

Run: python3 tools/build.py
"""
import difflib, glob, hashlib, json, math, os, re, sys

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
REST_STATUS_DAYS = 7  # Caltrans statuses change within days: run tools/rest_status.py right before a release
                      # (js/data.js REST_STATUS_DAYS applies the same age in the app, from each row's `checked` date)
REST_STATUSES = {"closed", "partial", "truck_only"}
# A rest stop with no real name ("Water", a radiator-water turnout on the Grapevine, and two unnamed OpenStreetMap areas
# named "Rest area" by tools/extras.py) is left out of the app (3.0.7 road test: "the next rest area on this side is
# Water"). None of them is in Caltrans' rest area list (tools/rest_status.py); tools/guides.py JUNK_REST already left them
# off the web pages.
NAMELESS_REST = re.compile(r"^(water|rest area|services)$", re.I)


def load_optional(name):
    path = os.path.join(HERE, name)
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}


def rest_with_status(rows, today):
    """REST rows with the Caltrans status overrides of tools/rest-status.json applied (matched by name, side and mile)."""
    import datetime
    over = load_optional("rest-status.json").get("overrides", [])
    out = [dict(r) for r in rows]
    for o in over:
        if o.get("status") not in REST_STATUSES or not str(o.get("src", "")).startswith("https://"):
            warn.append(f"rest status ignored (needs a closed/partial/truck_only status and a source link): {o.get('name')}")
            continue
        try:
            age = (today - datetime.date.fromisoformat(o["checked"])).days
        except (KeyError, ValueError):
            age = None
        if age is None or age > REST_STATUS_DAYS:
            warn.append(f"rest status for {o.get('name')} is older than {REST_STATUS_DAYS} days ({o.get('checked')}): ignored, run tools/rest_status.py")
            continue
        if o.get("until") and str(o["until"]) < today.isoformat():
            continue  # Caltrans' reopening date has passed
        hit = [r for r in out if r["name"] == o["name"] and r.get("side") == o.get("side") and abs(r["m"] - o["m"]) < 0.5]
        if not hit:
            warn.append(f"rest status matches no rest area: {o.get('name')} mile {o.get('m')}")
        for r in hit:
            r["status"], r["src"], r["checked"] = o["status"], o["src"], o["checked"]   # the app stops trusting it after REST_STATUS_DAYS
            for k in ("since", "until"):
                if o.get(k):
                    r[k] = o[k]
    return out

# The content agent writes the mission files here; build.py copies them into content/ when they exist (env I5_MISSIONS_SRC).
MISSIONS_SRC = os.environ.get("I5_MISSIONS_SRC", "/Volumes/sugsair/dominares/road-buddies/i5-missions")
MISSION_KEYS = ("n", "id", "name", "name_es", "lat", "lon", "founded", "founder", "people", "status", "site", "hours",
                "wiki", "text", "more", "visit", "src", "src2")


def is_translation_field(k):
    """The fields this repo adds to the content agent's entries (3.1.0): the Spanish (*_es, es_src) and the kids stories."""
    return k.endswith("_es") or k in ("es_src", "kids", "kids_src")


def carry_translations(new, old):
    """The content agent's mission files have no Spanish or kids text (3.1.0): keep this repo's on every entry that is still
    there (missions by n; places by exit and name, trivia by question, zones by their exits). An English text that changed
    is caught later by its es_src / kids_src hash, so carrying the old Spanish along never ships it."""
    def carry(a, b):
        for k, v in b.items():
            if is_translation_field(k) and k not in a:
                a[k] = v
    if isinstance(new, list) and isinstance(old, list):
        by_n = {m.get("n"): m for m in old if isinstance(m, dict)}
        for m in new:
            if isinstance(m, dict) and m.get("n") in by_n:
                carry(m, by_n[m["n"]])
    elif isinstance(new, dict) and isinstance(old, dict):
        for sec, key in (("places", lambda x: (x.get("exit"), x.get("name"))), ("trivia", lambda x: x.get("q")),
                         ("zones", lambda x: (x.get("from"), x.get("to")))):
            by_key = {key(x): x for x in old.get(sec) or [] if isinstance(x, dict)}
            for x in new.get(sec) or []:
                if isinstance(x, dict) and key(x) in by_key:
                    carry(x, by_key[key(x)])
    return new


def copy_missions():
    """Bring in the content agent's mission files (missions.json -> content/, ca-missions.json -> content/v2/), keeping the
    Spanish and kids text this repo added to them (carry_translations)."""
    for name, dest in (("missions.json", os.path.join(ROOT, "content", "missions.json")),
                       ("ca-missions.json", os.path.join(ROOT, "content", "v2", "ca-missions.json"))):
        src = os.path.join(MISSIONS_SRC, name)
        try:
            if os.path.isfile(src):
                raw = open(src, encoding="utf-8").read()
                new = json.loads(raw)  # only a file that parses
                old_raw = open(dest, encoding="utf-8").read() if os.path.exists(dest) else None
                text = raw
                if old_raw is not None:
                    try:
                        new = carry_translations(new, json.loads(old_raw))
                        text = json.dumps(new, ensure_ascii=False, indent=1) + ("\n" if raw.endswith("\n") else "")
                    except ValueError:
                        text = raw
                if text != old_raw:
                    write_safely(dest, text)
                    print(f"copied {name} from {MISSIONS_SRC}", file=sys.stderr)
        except (OSError, ValueError) as e:
            warn.append(f"could not copy {src}: {e}")


def load_missions():
    """content/missions.json -> [{n, id, name, ...}] in founding order (n), each checked; [] when there is none."""
    f = os.path.join(ROOT, "content", "missions.json")
    if not os.path.exists(f):
        return []
    try:
        d = json.load(open(f))
    except ValueError as e:
        warn.append(f"BAD JSON missions.json: {e}")
        return []
    if isinstance(d, dict) and (d.get("meta") or {}).get("placeholder"):
        warn.append("missions.json is a placeholder (built from research/missions.json); swap in the content agent's file")
    rows = d.get("missions", []) if isinstance(d, dict) else d
    out, seen = [], set()
    for m in rows if isinstance(rows, list) else []:
        try:
            n = int(m.get("n"))
            lat, lon = float(m.get("lat")), float(m.get("lon"))
        except (TypeError, ValueError, AttributeError):
            warn.append(f"mission without n or coordinates left out: {m}")
            continue
        name = str(m.get("name") or "").strip()
        if not name or n in seen or not (32 < lat < 42.1 and -124.5 < lon < -114):
            warn.append(f"mission {n} left out (no name, repeated, or outside California)")
            continue
        seen.add(n)
        q = {k: m[k] for k in MISSION_KEYS if m.get(k) not in (None, "", [])}
        q.update({"n": n, "name": name, "lat": round(lat, 5), "lon": round(lon, 5)})
        q["id"] = str(m.get("id") or slug(name))
        out.append(q)
    return sorted(out, key=lambda q: q["n"])


def detour_of(p):
    """A place's "detour" {exit, road, dir, miles}, cleaned; None when it has none or it is unusable."""
    d = p.get("detour")
    if not isinstance(d, dict):
        return None
    try:
        miles = round(float(d.get("miles")), 1)
    except (TypeError, ValueError):
        miles = None
    q = {"exit": str(d.get("exit") or p.get("exit") or "").strip(), "road": str(d.get("road") or "").strip(),
         "dir": str(d.get("dir") or "").strip().lower()}
    if miles is not None and miles >= 0:
        q["miles"] = miles
    if not q["exit"]:
        warn.append(f"detour without an exit ({p.get('name')}): left as a plain place")
        return None
    return {k: v for k, v in q.items() if v not in ("", None)}


def src_hash(v):
    """The hash of the English a Spanish or kids field was written from (claude-power/jobs/i5_es_kids.py has the same one)."""
    if not isinstance(v, str):
        v = json.dumps(v, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(v.strip().encode("utf-8")).hexdigest()[:10]


def clean_seasons(s):
    """A zone's seasonal notes as the Spanish was written from them: the filled ones, trimmed."""
    return {k: v.strip() for k, v in (s or {}).items() if k in ("winter", "spring", "summer", "fall") and isinstance(v, str) and v.strip()}


def es_current(src, en_field, en_value, what):
    """False (and a warning) when the entry's es_src says its Spanish of en_field was written from other English."""
    srcs = src.get("es_src")
    if isinstance(srcs, dict) and en_field in srcs and srcs[en_field] != src_hash(en_value):
        warn.append(f"Spanish {en_field} left out, its English changed since it was written: {what} (run claude-power/jobs/i5_es_kids.py again)")
        return False
    return True


def spanish(src, fields):
    """{app key: text} from a content entry's Spanish fields ({"text": "text_es", ...}); only filled ones, and only those
    whose English is still the English they were written from (es_src)."""
    out = {}
    what = src.get("name") or src.get("label") or src.get("q") or "?"
    for k, f in fields.items():
        v = src.get(f)
        if isinstance(v, str) and v.strip():
            en_f = f[:-3]
            if en_f != "kids" and not es_current(src, en_f, src.get(en_f) or "", what):
                continue
            out[k] = v.strip()
    return out


def kids_current(p):
    """A place's kids stories (kids, kids_es) are used only while its text is the one they were written from (kids_src)."""
    ks = p.get("kids_src")
    if ks and ks != src_hash(p.get("text") or ""):
        warn.append(f"kids stories left out, the story changed since they were written: {p.get('name')} (run claude-power/jobs/i5_es_kids.py again)")
        return False
    return True


def spanish_overlay(version, places, zones, trivia, dests, images, postcards):
    """data/i5.es.js: the Spanish names and stories, keyed so js/i18n.js can lay them over data/i5.js of this same build
    (places by id, zones and trivia by their index here, missions by number, destinations by index). Takes the _es
    fields off places, zones and trivia (data/i5.js never carries them)."""
    names = load_content_json("names_es.json")
    out = {"version": version, "lang": "es", "ends": None, "places": {}, "zones": {}, "trivia": {}, "missions": {}, "dests": {},
           "postcards": {}}
    ends = names.get("ends") if isinstance(names.get("ends"), dict) else {}
    e = {side: spanish(v, {"short": "short", "long": "long"}) for side, v in ends.items() if side in ("S", "N") and isinstance(v, dict)}
    out["ends"] = {k: v for k, v in e.items() if v} or None
    pc_es = postcards.get("lines_es", {}) if isinstance(postcards.get("lines_es"), dict) else {}
    for p in places:
        es = p.pop("_es", {})
        im = images.get(p["id"]) if p["id"] in images else images.get(p.get("wiki") or "")
        if im and isinstance(im.get("alt_es"), str) and im["alt_es"].strip() and p.get("img"):
            es["alt"] = im["alt_es"].strip()
        pc = pc_es.get(p["id"])
        if isinstance(pc, str) and 0 < len(pc.strip()) <= 60:
            es["pc"] = pc.strip()
        if es.get("kids") and not p.get("kids"):
            warn.append(f"kids_es without an English kids text: {p['id']}")
        if es:
            out["places"][p["id"]] = es
    for i, z in enumerate(zones):
        es = z.pop("_es", None)
        if es:
            out["zones"][str(i)] = es
    for i, t in enumerate(trivia):
        es = t.pop("_es", None)
        if es:
            out["trivia"][str(i)] = es
    mf = os.path.join(ROOT, "content", "missions.json")
    if os.path.exists(mf):
        try:
            d = json.load(open(mf))
            rows = d.get("missions", []) if isinstance(d, dict) else d
        except ValueError:
            rows = []
        for m in rows if isinstance(rows, list) else []:
            if not isinstance(m, dict) or m.get("n") is None:
                continue
            es = spanish(m, {"name": "name_es", "text": "text_es", "more": "more_es", "visit": "visit_es", "status": "status_es",
                             "people": "people_es", "founder": "founder_es"})
            if es:
                out["missions"][str(int(m["n"]))] = es
    dn = names.get("dests") if isinstance(names.get("dests"), dict) else {}
    for i, dd in enumerate(dests):
        v = dn.get(dd["name"])
        if isinstance(v, str) and v.strip():
            out["dests"][str(i)] = {"name": v.strip()}
    tm = postcards.get("templates_es") if isinstance(postcards.get("templates_es"), dict) else {}
    for k, v in tm.items():
        if isinstance(v, list) and v and all(isinstance(x, str) and x.strip() for x in v):
            out["postcards"][k] = [x.strip() for x in v]
    return out


def load_content_json(name):
    path = os.path.join(ROOT, "content", name)
    try:
        return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    except ValueError as e:
        warn.append(f"BAD JSON content/{name}: {e}")
        return {}


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
    postcards = load_optional("postcards.json")
    pc_lines = postcards.get("lines", {})

    copy_missions()
    missions = load_missions()
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
        det = detour_of(p)
        if det and m_exit is not None:
            m = m_exit  # a turn-off: announced at its exit, wherever the place itself is
        if m is None:
            warn.append(f"no position ({p.get('name')}, {p['_file']})")
            continue
        vis = bool(p.get("visible")) and not det
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
        kids_ok = kids_current(p)
        for k_in, k_out in (("more", "more"), ("spot", "spot"), ("months", "months"), ("src", "src"), ("src2", "src2"), ("wiki", "wiki"),
                            ("kids", "kids")):
            if p.get(k_in) and (k_in != "kids" or kids_ok):
                q[k_out] = p[k_in]
        es = spanish(p, {"name": "name_es", "text": "text_es", "more": "more_es", "spot": "spot_es", "kids": "kids_es"})
        if not kids_ok:
            es.pop("kids", None)
        if es:
            q["_es"] = es
        if isinstance(lat, (int, float)):
            q["lat"], q["lon"] = round(lat, 5), round(lon, 5)
        if det:
            q["detour"] = det
        if isinstance(p.get("mission"), int) and not isinstance(p.get("mission"), bool):
            q["mission"] = p["mission"]
        q["_file"] = p["_file"]
        places.append(q)

    # ca-missions.json places that are already in a stretch file (same name nearby, or within a mile): the stretch
    # file's place keeps its id (saved stamps/photos use it), but the reviewed turn-off supplies its narration
    # and exit position. Keeping the old narration here silently discarded the mission fact-check corrections.
    ours = [p for p in places if p["_file"] == "ca-missions.json"]
    rest = [p for p in places if p["_file"] != "ca-missions.json"]
    for p in ours:
        hit = None
        for k in rest:
            a, b = slug(k["name"]), slug(p["name"])
            close = "lat" in k and "lat" in p and math.hypot((k["lat"] - p["lat"]) * 69, (k["lon"] - p["lon"]) * 57) < 1
            if (abs(k["m"] - p["m"]) <= 6 and (a == b or difflib.SequenceMatcher(None, a, b).ratio() > 0.86)) or close:
                hit = k
                break
        if hit:
            for key in ("text", "more", "src", "src2", "wiki", "ex", "m", "side", "vis", "off", "lat", "lon", "detour", "mission"):
                if key in p:
                    hit[key] = p[key]
            # 3.1.0: the stories that come with the turn-off's narration (its kids text, and the Spanish of its text, long
            # story and kids text) replace the old place's; the name and the I-spy line stay the old place's, with their Spanish
            if "text" in p:
                hit.pop("kids", None)
                if p.get("kids"):
                    hit["kids"] = p["kids"]
                es_hit, es_p = dict(hit.get("_es") or {}), p.get("_es") or {}
                for k in ("text", "more", "kids"):
                    es_hit.pop(k, None)
                    if k in es_p:
                        es_hit[k] = es_p[k]
                if es_hit:
                    hit["_es"] = es_hit
                else:
                    hit.pop("_es", None)
            places.remove(p)
            warn.append(f"mission turn-off merged into the existing place '{hit['name']}' ({hit['_file']})")
    for p in places:
        p.pop("_file", None)

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
        # a key that is there with null means "no photo": the wiki fallback must not bring one back
        im = images.get(p["id"]) if p["id"] in images else images.get(p.get("wiki") or "")
        if im:
            # alt_es stays in images.json for the Spanish app (not built yet): the English app ships alt_en only
            p["img"] = {k: v for k, v in im.items() if k != "alt_es"}
        pc = pc_lines.get(p["id"])
        if isinstance(pc, str) and 0 < len(pc) <= 60:
            p["pc"] = pc

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
        es = spanish(z, {"label": "label_es", "text": "text_es"})
        if isinstance(z.get("seasons_es"), dict) and es_current(z, "seasons", clean_seasons(z.get("seasons")), z.get("label") or "?"):
            se = {k: v.strip() for k, v in z["seasons_es"].items() if k in ("winter", "spring", "summer", "fall") and isinstance(v, str) and v.strip()}
            if se:
                es["seasons"] = se
        if es:
            zz["_es"] = es
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
        tq = {"m": round(m, 1), "q": t["q"], "choices": t["choices"], "answer": t["answer"], "why": t.get("why", ""), "src": t.get("src")}
        es = spanish(t, {"q": "q_es", "why": "why_es"})
        ch = t.get("choices_es")
        if not es_current(t, "choices", [c.strip() for c in t["choices"]], t.get("q") or "?"):
            ch = None
        if isinstance(ch, list) and len(ch) == len(t["choices"]) and all(isinstance(c, str) and c.strip() for c in ch):
            es["choices"] = [c.strip() for c in ch]
        elif ch:
            warn.append(f"trivia choices_es left out (not one per choice): {t.get('q')}")
        if es:
            tq["_es"] = es
        trivia.append(tq)

    nums = {q["n"] for q in missions}
    for p in places:
        if "mission" in p and p["mission"] not in nums:
            warn.append(f"place '{p['name']}' names mission {p['mission']}, which is not in missions.json")
            del p["mission"]

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
    version = __import__("datetime").date.today().isoformat()
    es_out = spanish_overlay(version, places, zones, trivia, dests, images, postcards)
    out = {
        "version": version,
        "scope": SCOPE,
        "ends": {"S": {"short": "Mexico", "long": "the Mexico border"}, "N": END_NAMES[SCOPE[-1]]},
        "states": states, "route": route, "places": places, "zones": zones, "trivia": trivia, "dests": dests,
        "exits": [e for e in X["exits"] if e[1] in off],
        "services": [border_services(s) for s in X["services"] if s.get("st", "CA") in off],
        "rest": rest_with_status([r for r in X["rest"] if in_road(r.get("m")) and not NAMELESS_REST.match(str(r.get("name", "")).strip())],
                                 __import__("datetime").date.today()),
        "cams": [c for c in X["cams"] if in_road(c.get("m"))],
        "districts": X["districts"],
        "elev": elev, "passes": [p for p in X.get("passes", []) if in_road(p.get("m"))],
        "outline": [o for o in (X.get("outline") or []) if o.get("st") in keep_outline],
        "missions": missions,
        "postcards": postcards.get("templates", {}),
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    js = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    dest = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(ROOT, "data", "i5.js")
    write_safely(dest, "// Generated by tools/build.py. Do not edit by hand.\nwindow.I5DATA=" + js + ";\n")
    es_js = json.dumps(es_out, ensure_ascii=False, separators=(",", ":"))
    es_dest = sys.argv[sys.argv.index("--out-es") + 1] if "--out-es" in sys.argv else os.path.join(ROOT, "data", "i5.es.js")
    write_safely(es_dest, "// Generated by tools/build.py from the content's *_es fields. Do not edit by hand.\nwindow.I5DATA_ES=" + es_js + ";\n")
    write_safely(os.path.join(HERE, "build-report.txt"), "\n".join(warn) + "\n")
    per_state = {s["id"]: sum(1 for p in places if p["st"] == s["id"]) for s in states}
    print(f"{'v2' if v2 else 'v1'} content, scope {'+'.join(SCOPE)} (0-{end:.1f} mi): {len(places)} places {per_state}, {len(zones)} zones, {len(trivia)} trivia; "
          f"route {len(route)} pts; {len(out['cams'])} cams; {len(out['services'])} exits with services; {len(out['rest'])} rest areas; "
          f"{len(js) // 1024} KB; {len(warn)} warnings -> tools/build-report.txt")
    print(f"Spanish: {len(es_out['places'])} places, {len(es_out['zones'])} zones, {len(es_out['trivia'])} trivia, {len(es_out['missions'])} missions, "
          f"{len(es_out['dests'])} destinations; kids text {sum(1 for p in places if p.get('kids'))} (English), "
          f"{sum(1 for p in es_out['places'].values() if p.get('kids'))} (Spanish); {len(es_js) // 1024} KB -> data/i5.es.js")


if __name__ == "__main__":
    main()
