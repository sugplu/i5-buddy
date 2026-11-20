#!/usr/bin/env python3
"""Offline checks for the generated search pages (no browser, no network): python3 tools/seo/check_pages.py

Every town and topic page exists with one canonical, one h1 and valid JSON-LD; generated text respects its limits; every
relative link resolves to a file; thin towns are noindex and out of the sitemap; sw.js precaches none of them; no page says
"our AI"; no page written by tools/guides.py calls the app free (the owner's rule for public app text, 3.0.7); a content
link with "&" in it is escaped once."""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import guides  # noqa: E402
from seo import spec  # noqa: E402

bad = []


def fail(msg):
    bad.append(msg)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


d = guides.load()
r = spec.build(d, guides.rest_stops, guides.JUNK_REST)
sitemap = read("sitemap.xml")
paths = [(f'drive/{g["slug"]}/', g, False) for g in r["guides"]] + [(f'town/{t["slug"]}/', t, t["thin"]) for t in r["towns"]]
paths.append(("town/", None, False))
for path, e, thin in paths:
    try:
        h = read(path + "index.html")
    except OSError:
        fail(f"missing {path}")
        continue
    url = f"{guides.SITE}/{path}"
    if h.count('rel="canonical"') != 1 or f'<link rel="canonical" href="{url}">' not in h:
        fail(f"{path}: canonical")
    if len(re.findall(r"<h1[ >]", h)) != 1:
        fail(f"{path}: h1 count")
    if "our own AI" in h or "our AI" in h:
        fail(f"{path}: says our AI")
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
    try:
        ld = json.loads(m.group(1))
        types = {x["@type"] for x in ld}
        if "BreadcrumbList" not in types:
            fail(f"{path}: no BreadcrumbList")
        if e and e["kind"] == "town" and "Place" not in types:
            fail(f"{path}: no Place")
        if e and e["kind"] == "town" and not any(x["@type"] == "Place" and x.get("publisher") for x in ld):
            fail(f"{path}: Place without publisher")
    except Exception as ex:  # noqa: BLE001
        fail(f"{path}: JSON-LD {ex}")
        ld = []
    for x in ld:
        if x["@type"] == "FAQPage":
            for q in x["mainEntity"]:
                if q["name"] not in h.replace("&#x27;", "'").replace("&quot;", '"') and guides.E(q["name"]) not in h:
                    fail(f"{path}: FAQ question not on the page")
    title = re.search(r"<title>(.*?)</title>", h).group(1)
    meta = re.search(r'<meta name="description" content="(.*?)">', h).group(1)
    import html as _h
    if len(_h.unescape(title)) > 75:
        fail(f"{path}: title {len(title)}")
    if len(_h.unescape(meta)) > 160:
        fail(f"{path}: meta {len(meta)}")
    robots = 'name="robots" content="noindex,follow"' in h
    if robots != bool(thin):
        fail(f"{path}: noindex={robots} but thin={thin}")
    in_sm = f"<loc>{url}</loc>" in sitemap
    if in_sm == bool(thin):
        fail(f"{path}: sitemap membership {in_sm} but thin={thin}")
    base = os.path.join(ROOT, path)
    for href in re.findall(r'href="([^"#]+)(?:#[^"]*)?"', h):
        if re.match(r"(https?:|mailto:|tel:)", href):
            continue
        tgt = os.path.normpath(os.path.join(base, href))
        if not (os.path.isfile(tgt) or os.path.isfile(os.path.join(tgt, "index.html"))):
            fail(f"{path}: broken link {href}")
    for href in set(re.findall(r'href="([^"]+)#([^"]+)"', h)):
        pass
# The owner's rule (nightly review 2026-11-20): public app text never calls the app free or states a price. The landmark
# stories may say "free-flowing" or "a free lunch"; what is checked is the app's own wording, in English and Spanish.
APP_FREE = re.compile(r"(?i)\bfree\s+(?:talking|narrated|road|guide|gps|iphone|app|download)\b|\b(?:it'?s|is)\s+free\b|"
                      r"\bfree\s+on\s+the\s+app\s+store|\bgratuit\w*|\bgratis\b")
every = [p for p, _, _ in paths] + [f'drive/{g["slug"]}/' for g in guides.GUIDES] + ["drive/", "rest-areas/"]
every += [guides.seasonal_path(g, lang) for g in guides.SEASONAL for lang in ("en", "es")]
for path in every:
    try:
        h = read(path + "index.html")
    except OSError:
        fail(f"missing {path}")
        continue
    hit = APP_FREE.search(h)
    if hit:
        fail(f"{path}: app text says {hit.group(0)!r} (no 'free' or price in public app text)")
link = guides.inline("[the sign](https://dot.ca.gov/x?a=1&b=2)", "en")
if 'href="https://dot.ca.gov/x?a=1&amp;b=2"' not in link or "&amp;amp;" in link:
    fail(f"a content link with & is escaped twice: {link}")
sw = read("sw.js")
shell = sw[sw.index("const SHELL"): sw.index("const PHOTOS")]
for bad_word in ("town/", "drive/", "place/"):
    if bad_word in shell:
        fail(f"sw.js precaches {bad_word}")
if "<!-- guides" not in sitemap or sitemap.count("<loc>") < 70:
    fail("sitemap block")
print(f"checked {len(paths)} pages ({len(every)} for app wording); sitemap has {sitemap.count('<loc>')} URLs;", "FAIL" if bad else "ok")
for b in bad[:60]:
    print(" -", b)
sys.exit(1 if bad else 0)
