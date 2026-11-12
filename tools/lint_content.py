#!/usr/bin/env python3
"""Check content/v2/*.json against the writing and data rules. Prints problems; exit code 1 if any are errors.

Run: python3 tools/lint_content.py [--fix-dashes]
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRECTIONAL = re.compile(r"\b(on (?:your|the) (?:left|right)|to your (?:left|right)|behind you|coming up|you just passed|as you (?:climb|descend|head|drive north|drive south)|northbound|southbound|up ahead|straight ahead)\b", re.I)
HYPE = re.compile(r"\b(amazing|stunning|breathtaking|iconic|nestled|boasts|hidden gem|must-see|fun fact)\b", re.I)
DASH = re.compile(r"[—–]|\s-\s")
CATS = {"farm", "hist", "nature", "town", "stop", "odd"}
LIMITS = {"text": 85, "more": 170, "spot": 18}


def words(s):
    return len(re.findall(r"\S+", s or ""))


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
        for t in d.get("trivia", []):
            tag = f"{name} · trivia '{(t.get('q') or '')[:50]}'"
            ch = t.get("choices") or []
            if len(ch) != 4 or not isinstance(t.get("answer"), int) or not 0 <= t["answer"] < len(ch):
                print(f"ERROR {tag}: needs 4 choices and a valid answer index")
                errors += 1
            if len(set(c.strip().lower() for c in ch)) != len(ch):
                print(f"ERROR {tag}: duplicate choices")
                errors += 1
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
