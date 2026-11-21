#!/usr/bin/env python3
"""Check content/v2/*.json against the writing and data rules. Prints problems; exit code 1 if any are errors.

The Spanish (*_es) and kids fields (3.1.0) are checked too: a Spanish field without its English, a direction-dependent side
("a su izquierda") in Spanish or in a kids story, the wrong number of trivia choices are errors; stale text (its
English changed since it was written: tools/build.py leaves it out), tú forms, exclamation marks the English lacks, long or
scary-sounding kids stories are warnings.

Run: python3 tools/lint_content.py [--fix-dashes]
"""
import glob, hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRECTIONAL = re.compile(r"\b(on (?:your|the) (?:left|right)|to your (?:left|right)|behind you|coming up|you just passed|as you (?:climb|descend|head|drive north|drive south)|northbound|southbound|up ahead|straight ahead)\b", re.I)
HYPE = re.compile(r"\b(amazing|stunning|breathtaking|iconic|nestled|boasts|hidden gem|must-see|fun fact)\b", re.I)
DASH = re.compile(r"[—–]|\s-\s")
CATS = {"farm", "hist", "nature", "town", "stop", "odd"}
LIMITS = {"text": 85, "more": 170, "spot": 18}
# 3.1.0: Spanish and kids text
SIDE_ES = re.compile(r"\b(a (?:su|tu) (?:izquierda|derecha)|de su lado (?:izquierdo|derecho)|detrás de usted|acaba de pasar)\b", re.I)  # "on your left": the app adds the side; "dio vuelta a la izquierda" in a story is fine
TU_ES = re.compile(r"\b(tú|tu|tus|te|ti|contigo|puedes|tienes|quieres|mira|busca|fíjate|oye)\b", re.I)
SCARY = re.compile(r"\b(kill\w*|murder\w*|massacre\w*|dead|death|died|blood\w*|shot|shoot\w*|ghost\w*|crash\w*|drown\w*|corpse\w*|"
                   r"muert[eoa]s?|murió|murieron|mataron|asesin\w*|masacre|sangre|fantasma\w*|choque|ahog\w*)\b", re.I)
KIDS_WORDS = 90


def src_hash(v):
    """tools/build.py src_hash: the hash of the English a Spanish or kids field was written from."""
    if not isinstance(v, str):
        v = json.dumps(v, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(v.strip().encode("utf-8")).hexdigest()[:10]


def words(s):
    return len(re.findall(r"\S+", s or ""))


def lint_spanish(tag, p, fields):
    """(errors, warnings) for one entry's Spanish fields ({Spanish field: English field})."""
    errors = warns = 0
    srcs = p.get("es_src") if isinstance(p.get("es_src"), dict) else {}
    for f, en_f in fields.items():
        v = p.get(f)
        if v in (None, "", [], {}):
            continue
        en = p.get(en_f)
        if en in (None, "", [], {}):
            print(f"ERROR {tag}: {f} without English {en_f}")
            errors += 1
            continue
        cur = en if en_f != "seasons" else {k: s.strip() for k, s in en.items() if k in ("winter", "spring", "summer", "fall") and isinstance(s, str) and s.strip()}
        if en_f in srcs and srcs[en_f] != src_hash([c.strip() for c in cur] if isinstance(cur, list) else cur):
            print(f"WARN  {tag}: {f} is out of date (its English changed; tools/build.py leaves it out)")
            warns += 1
        for s in (v if isinstance(v, list) else list(v.values()) if isinstance(v, dict) else [v]):
            m = SIDE_ES.search(s)
            if m:
                print(f"ERROR {tag}: direction-dependent wording in {f}: '{m.group(0)}'")
                errors += 1
            m = TU_ES.search(s)
            if m:
                print(f"WARN  {tag}: tú form in {f}: '{m.group(0)}'")
                warns += 1
            if "!" in s and "!" not in json.dumps(en):
                print(f"WARN  {tag}: exclamation mark in {f}")
                warns += 1
    return errors, warns


def lint_kids(tag, p):
    """(errors, warnings) for a place's kids stories (kids, kids_es)."""
    errors = warns = 0
    if p.get("kids_es") and not p.get("kids"):
        print(f"WARN  {tag}: kids_es without an English kids story")
        warns += 1
    if (p.get("kids") or p.get("kids_es")) and p.get("kids_src") and p["kids_src"] != src_hash(p.get("text") or ""):
        print(f"WARN  {tag}: kids stories are out of date (the story changed; tools/build.py leaves them out)")
        warns += 1
    for f in ("kids", "kids_es"):
        v = p.get(f) or ""
        if not v:
            continue
        if words(v) > KIDS_WORDS:
            print(f"WARN  {tag}: {f} is {words(v)} words (keep kids stories under {KIDS_WORDS})")
            warns += 1
        m = (DIRECTIONAL if f == "kids" else SIDE_ES).search(v)  # the side said to the listener (the app adds it); "left behind" is fine
        if m:
            print(f"ERROR {tag}: direction-dependent wording in {f}: '{m.group(0)}'")
            errors += 1
        m = SCARY.search(v)
        if m:
            print(f"WARN  {tag}: scary-sounding word in {f}: '{m.group(0)}'")
            warns += 1
        if v.count("!") > 1:
            print(f"WARN  {tag}: more than one exclamation mark in {f}")
            warns += 1
        if f == "kids_es":
            m = TU_ES.search(v)
            if m:
                print(f"WARN  {tag}: tú form in kids_es (it speaks to the kids as ustedes): '{m.group(0)}'")
                warns += 1
    return errors, warns


def main():
    fix = "--fix-dashes" in sys.argv
    errors = warns = 0
    for f in sorted(glob.glob(os.path.join(ROOT, "content", "v2", "*.json"))):
        name = os.path.basename(f)
        try:
            d = json.load(open(f))
        except ValueError as e:
            print(f"ERROR {name}: invalid JSON: {e}")
            errors += 1
            continue
        changed = False
        for p in d.get("places", []):
            tag = f"{name} · {p.get('name')}"
            for k in ("state", "exit", "name", "cat", "text", "src"):
                if p.get(k) in (None, ""):
                    print(f"ERROR {tag}: missing {k}")
                    errors += 1
            if p.get("cat") not in CATS:
                print(f"ERROR {tag}: bad cat {p.get('cat')}")
                errors += 1
            if p.get("state") not in ("CA", "OR", "WA"):
                print(f"ERROR {tag}: bad state {p.get('state')}")
                errors += 1
            for k, lim in LIMITS.items():
                n = words(p.get(k))
                if n > lim * 1.15:
                    print(f"WARN  {tag}: {k} is {n} words (limit {lim})")
                    warns += 1
            for k in ("text", "more", "spot"):
                v = p.get(k) or ""
                m = DIRECTIONAL.search(v)
                if m:
                    print(f"ERROR {tag}: direction-dependent wording in {k}: '{m.group(0)}'")
                    errors += 1
                m = HYPE.search(v)
                if m:
                    print(f"WARN  {tag}: hype word in {k}: '{m.group(0)}'")
                    warns += 1
                if "!" in v:
                    print(f"WARN  {tag}: exclamation mark in {k}")
                    warns += 1
                if DASH.search(v):
                    if fix:
                        p[k] = re.sub(r"\s*[—]\s*", ", ", re.sub(r"(\d)–(\d)", r"\1 to \2", v)).replace("–", "-")
                        changed = True
                    else:
                        print(f"WARN  {tag}: dash in {k}")
                        warns += 1
            if p.get("spot") and not p.get("visible"):
                print(f"WARN  {tag}: spot prompt on a place marked not visible")
                warns += 1
            if p.get("lat") is not None and not (32 < p["lat"] < 49.1 and -125 < p["lon"] < -116):
                print(f"ERROR {tag}: coordinates outside the I-5 corridor: {p.get('lat')},{p.get('lon')}")
                errors += 1
            e, w = lint_spanish(tag, p, {"name_es": "name", "text_es": "text", "more_es": "more", "spot_es": "spot"})
            e2, w2 = lint_kids(tag, p)
            errors, warns = errors + e + e2, warns + w + w2
        for t in d.get("trivia", []):
            tag = f"{name} · trivia '{(t.get('q') or '')[:50]}'"
            ch = t.get("choices") or []
            if len(ch) != 4 or not isinstance(t.get("answer"), int) or not 0 <= t["answer"] < len(ch):
                print(f"ERROR {tag}: needs 4 choices and a valid answer index")
                errors += 1
            if len(set(c.strip().lower() for c in ch)) != len(ch):
                print(f"ERROR {tag}: duplicate choices")
                errors += 1
            if t.get("choices_es") and len(t["choices_es"]) != len(ch):
                print(f"ERROR {tag}: choices_es has {len(t['choices_es'])} choices for {len(ch)}")
                errors += 1
            e, w = lint_spanish(tag, t, {"q_es": "q", "choices_es": "choices", "why_es": "why"})
            errors, warns = errors + e, warns + w
        for z in d.get("zones", []):
            e, w = lint_spanish(f"{name} · zone '{z.get('label')}'", z, {"label_es": "label", "text_es": "text", "seasons_es": "seasons"})
            errors, warns = errors + e, warns + w
        zs = sorted(d.get("zones", []), key=lambda z: (z.get("state", ""), z.get("from", 0)))
        for a, b in zip(zs, zs[1:]):
            if a.get("state") == b.get("state") and a.get("to") != b.get("from"):
                print(f"WARN  {name}: zone seam {a.get('label')} ends {a.get('to')}, next starts {b.get('from')}")
                warns += 1
        if changed:
            json.dump(d, open(f, "w"), ensure_ascii=False, indent=1)
    print(f"{errors} errors, {warns} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
