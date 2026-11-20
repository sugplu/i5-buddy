#!/usr/bin/env python3
"""Ask Buddy: build data/ask.js (the offline answers) from content/ask.json, and check them.

content/ask.json  {key: [{q, alts, a, quote, kind}, ...]} for every place (its id), stretch of road ("z:<from>") and
                  mission (its id). Written by claude-power/jobs/i5_ask.py (Claude Sonnet 5.5 wrote the questions and
                  answers from the app's own text only; Claude Opus 5.5 checked every answer against that text and
                  failures were dropped, never rewritten). Edit it by hand if an answer is wrong; then run this.
data/ask.js       window.I5ASK, loaded on demand by js/listen.js (NOT in sw.js SHELL, so the all-or-nothing install
                  stays the same size; the service worker keeps it once it has been fetched).

Every build checks each answer again against the CURRENT data/i5.js text, so a story edit that removes a fact also
removes the answers that used it:
  - quote: the supporting words must still be in that place's text (or its facts: exit, miles off the freeway...);
  - numbers: every number in the answer must be in that text;
  - words the app never says: "free", prices, tickets, phone numbers, web addresses, left/right directions.
Run:  python3 tools/ask.py            (writes data/ask.js, prints counts)
      python3 tools/ask.py --check    (only checks: exit 1 when data/ask.js is stale or an answer fails)
"""
import json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "content", "ask.json")
OUT = os.path.join(REPO, "data", "ask.js")
CAT = {"farm": "orchards and farms", "hist": "history", "nature": "land and water", "town": "town", "stop": "good stop", "odd": "oddity"}
MONTHS = "January February March April May June July August September October November December".split()


def load_data():
    s = open(os.path.join(REPO, "data", "i5.js"), encoding="utf-8").read()
    return json.loads(s[s.index("{"): s.rindex("}") + 1])


def zone_key(z):
    f = z["from"]
    return "z:" + (str(int(f)) if float(f).is_integer() else str(f))


def sources(d):
    """{key: (kind, name, text the answers may use)}. The same FACTS + SOURCE the writer and the checker saw."""
    out = {}
    mis = {m["n"]: m for m in d.get("missions", [])}
    for p in d["places"]:
        f = [f"Name: {p['name']}", f"Kind: {CAT.get(p['cat'], p['cat'])}"]
        if p.get("ex"):
            f.append(f"Exit: {p['ex']}")
        if p.get("off") is not None:
            f.append(f"Miles off the freeway: {p['off']}" if p["off"] else "Right at the freeway")
        if p.get("detour"):
            t = p["detour"]
            f.append(f"Turn-off: exit {t['exit']}, then {t['road']} {t['dir']} about {t['miles']} miles")
        if p.get("months"):
            f.append("Best months: " + ", ".join(MONTHS[i - 1] for i in p["months"]))
        if p.get("spot"):
            f.append(f"How to spot it: {p['spot']}")
        if p.get("mission") and p["mission"] in mis:
            f.append(f"This is California mission number {p['mission']} in founding order")
        out[p["id"]] = ("place", p["name"], "\n".join(f) + "\n\n" + p["text"] + ("\n\n" + p["more"] if p.get("more") else ""))
    for z in d["zones"]:
        t = z["text"] + "".join(f"\n\nIn {k}: {v}" for k, v in (z.get("seasons") or {}).items())
        out[zone_key(z)] = ("zone", z["label"], f"Stretch of I-5: {z['label']}\n\n" + t)
    for m in d.get("missions", []):
        f = [f"Name: {m['name']}", f"Spanish name: {m['name_es']}", f"Mission number {m['n']} of 21 in founding order", f"Founded: {m['founded']}",
             f"Founded by: {m['founder']}", f"Native people of this land: {m['people']}", f"Today: {m['status']}"]
        out[m["id"]] = ("mission", m["name"], "\n".join(f) + "\n\n" + m["text"] + "\n\n" + m.get("more", "") + "\n\nVisiting: " + m.get("visit", ""))
    return out


def norm(s):
    s = str(s).lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("—", " ").replace("–", "-").replace("-", " ")
    s = re.sub(r"[^a-z0-9'.,%$ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip(" .,")


MONTH_NUM = {m.lower(): i + 1 for i, m in enumerate(MONTHS)}


def numbers(s):
    """Numbers as written in digits: '1,500' -> '1500', '2.25' -> '2.25', '19th' -> '19' (not the 5 of I-5)."""
    s = re.sub(r"\b(?:I-5|I 5|Interstate 5)\b", " ", s)
    return {n.replace(",", "").rstrip(".,") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", s)} - {""}


def src_numbers(s):
    ns = numbers(s)
    # an ISO date in the facts ("Founded: 1771-09-08") also says its day and year
    for y, mo, dd in re.findall(r"(\d{4})-(\d{2})-(\d{2})", s):
        ns.update({y, str(int(mo)), str(int(dd))})
    return ns | {n.rstrip("0").rstrip(".") for n in ns if "." in n}


# What a visitor would pay or be let in for (historic dollar figures in the stories are facts and stay), contact
# details, and sides of the road (they depend on the direction of travel).
BANNED = re.compile(r"\b(?:is|are|it's|for|always|totally) free\b|\bfree (?:admission|entry|parking|to (?:visit|enter|see|get in))\b|"
                    r"\bfree of charge\b|\badmission\b|\bentry fee|\bfees? (?:is|are|of)\b|\b(?:costs?|charges?) \$|\$\d+(?:\.\d\d)? "
                    r"(?:a|per) (?:person|car|adult|child|ticket)\b|\bby phone\b|\bphone number\b|\bcall ahead\b|https?:|www\.|"
                    r"\.(?:com|org|gov)\b|\b(?:on|to) your (?:left|right)\b|\b(?:turn|exit|ramp|it) is on the (?:left|right)\b|"
                    r"\b(?:left|right)[- ]hand side\b", re.I)


def check_one(qa, src_text):
    """'' when the answer passes, else why it fails."""
    a, q, quote = qa.get("a", ""), qa.get("q", ""), qa.get("quote", "")
    if not a or not q:
        return "empty"
    if len(a) > 280 or len(q) > 100:
        return "too long"
    if BANNED.search(a) or BANNED.search(q):
        return "banned words"
    ns = norm(src_text)
    if not quote or norm(quote) not in ns:
        return "quote not in the source"
    have = src_numbers(src_text)
    extra = [n for n in numbers(a) if n not in have and n.rstrip("0").rstrip(".") not in have]
    if extra:
        return "number not in the source: " + ", ".join(sorted(extra))
    return ""


def clean_alts(alts, q):
    seen, out = {norm(q)}, []
    for x in alts or []:
        x = str(x).strip()
        if x and norm(x) not in seen and len(x) <= 100:
            seen.add(norm(x)); out.append(x)
    return out[:4]


def shell_size():
    """The service worker's all-or-nothing install (sw.js SHELL): data/ask.js must stay out of it. Returns an error
    string or ''; prints the sizes."""
    sw = open(os.path.join(REPO, "sw.js"), encoding="utf-8").read()
    body = sw[sw.index("const SHELL = ["): sw.index("];", sw.index("const SHELL = ["))]
    files = re.findall(r'"([^"]+)"', body)
    total, missing = 0, []
    for f in files:
        p = os.path.join(REPO, "index.html" if f == "./" else f)
        if os.path.exists(p):
            total += os.path.getsize(p)
        else:
            missing.append(f)
    ask = os.path.getsize(OUT) if os.path.exists(OUT) else 0
    print(f"  service worker install (sw.js SHELL): {len(files)} files, {total:,} bytes; data/ask.js {ask:,} bytes loaded on demand, not in it")
    if "data/ask.js" in files:
        return "data/ask.js is in sw.js SHELL: the install would grow by its size; it is meant to load on demand"
    if missing:
        return "SHELL lists missing files: " + ", ".join(missing)
    return ""


def build(check_only=False):
    d = load_data()
    srcs = sources(d)
    ask = json.load(open(SRC, encoding="utf-8"))
    ents, dropped, stale = {}, [], []
    for key, qas in ask.items():
        if key not in srcs:
            stale.append(key)
            continue
        kind, name, text = srcs[key]
        keep = []
        for qa in qas:
            why = check_one(qa, text)
            if why:
                dropped.append((key, qa.get("q"), why))
                continue
            keep.append([qa["q"].strip(), qa["a"].strip(), "|".join(clean_alts(qa.get("alts"), qa["q"])), qa.get("kind", "other")])
        if keep:
            e = {"n": name, "k": kind[0], "q": keep}
            ents[key] = e
    # a mission's place on I-5 (a turn-off) also answers with the mission's questions
    for p in d["places"]:
        if p.get("mission") and p["id"] in ents:
            m = next((m for m in d.get("missions", []) if m["n"] == p["mission"]), None)
            if m and m["id"] in ents:
                ents[p["id"]]["l"] = m["id"]
    nq = sum(len(e["q"]) for e in ents.values())
    data = {"v": d.get("version", ""), "n": nq, "e": ents}
    body = ("// Generated by tools/ask.py from content/ask.json. Do not edit by hand.\n"
            "// Ask Buddy: questions passengers ask about each place, stretch and mission, answered only from the app's own\n"
            "// text (written by Claude Sonnet 5.5, checked by Claude Opus 5.5 and by tools/ask.py). Loaded on demand by js/listen.js.\n"
            "window.I5ASK=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    by_kind = {}
    for k, e in ents.items():
        by_kind.setdefault(e["k"], []).append(len(e["q"]))
    missing = [k for k in srcs if k not in ents]
    print(f"Ask Buddy: {nq} answers for {len(ents)} of {len(srcs)} places, stretches and missions; {len(dropped)} dropped by the"
          f" checks, {len(stale)} keys no longer in the data, {len(missing)} with no answers; {len(body.encode()):,} bytes")
    for k, v in sorted(by_kind.items()):
        hist = {n: v.count(n) for n in sorted(set(v))}
        print(f"  {dict(p='places', z='stretches', m='missions')[k]}: {len(v)}, answers each {hist}")
    for x in dropped[:40]:
        print("  dropped:", x)
    bad = shell_size()
    if bad:
        print(bad)
        return 1
    if check_only:
        cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if cur != body:
            print("data/ask.js is stale: run python3 tools/ask.py")
            return 1
        return 0
    open(OUT, "w", encoding="utf-8").write(body)
    return 0


if __name__ == "__main__":
    sys.exit(build("--check" in sys.argv))
