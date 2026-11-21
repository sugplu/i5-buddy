#!/usr/bin/env python3
"""Where each key of i18n/en.json is used, for whoever writes i18n/es.json (3.1.0).

    python3 tools/i18n_context.py [--out FILE]      (default: print JSON to stdout)

For every key: its English words, whether the app speaks it (a line that can reach voice.say: js/narrator.js, the nav
prompts, live heads-ups, game lines) or only shows it, and each place it is used (file:line and that line of code,
trimmed), so the {placeholders} and the words around them can be read in place. index.html keys say which element
they mark. Nothing here is needed at runtime; tools/test-i18n.html?s=keys checks the dictionaries themselves.
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = re.compile(r'(?<![\w$.])(?:i18n\.)?(?:t|en)\(\s*"([a-z0-9_]+(?:\.[a-z0-9_]+)+)"')
SPOKEN = re.compile(r"\bsay\(|announce\(|\bspeak\(|units\.push|voice\.|gameSay|autoSay|put\(")


def main():
    en = json.load(open(os.path.join(ROOT, "i18n", "en.json"), encoding="utf-8"))
    out = {k: {"en": v, "spoken": False, "used": []} for k, v in en.items()}
    files = sorted(glob.glob(os.path.join(ROOT, "js", "*.js")) + glob.glob(os.path.join(ROOT, "js", "games", "*.js")))
    for f in files:
        rel = os.path.relpath(f, ROOT)
        lines = open(f, encoding="utf-8").read().split("\n")
        for i, line in enumerate(lines, 1):
            for m in KEY.finditer(line):
                k = m.group(1)
                if k not in out:
                    continue
                code = line.strip()
                if len(code) > 220:
                    a = max(0, m.start() - 90)
                    code = ("…" if a else "") + line[a:a + 220].strip() + "…"
                out[k]["used"].append(f"{rel}:{i}: {code}")
                near = " ".join(lines[max(0, i - 3):i + 1])
                if rel == "js/narrator.js" or SPOKEN.search(near):
                    out[k]["spoken"] = True
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read().split("\n")
    for i, line in enumerate(html, 1):
        for m in re.finditer(r'data-i18n(?:-html)?="([^"]+)"|data-i18n-attr="([^"]+)"', line):
            keys = [m.group(1)] if m.group(1) else [p.split(":", 1)[1].strip() for p in m.group(2).split(";")]
            for k in keys:
                if k in out:
                    tag = re.search(r"<(\w+)[^<]*$", line[:m.start()])
                    out[k]["used"].append(f"index.html:{i}: <{tag.group(1) if tag else '?'}> {line.strip()[:200]}")
    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    if "--out" in sys.argv:
        open(sys.argv[sys.argv.index("--out") + 1], "w", encoding="utf-8").write(text)
        print(f"{len(out)} keys, {sum(1 for v in out.values() if v['spoken'])} spoken", file=sys.stderr)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
