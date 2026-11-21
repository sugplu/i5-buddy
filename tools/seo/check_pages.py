#!/usr/bin/env python3
"""Offline checks for the generated search pages (no browser, no network): python3 tools/seo/check_pages.py

Every town and topic page exists with one canonical, one h1 and valid JSON-LD; generated text respects its limits; every
relative link resolves to a file; thin towns are noindex and out of the sitemap; sw.js precaches none of them; no page says
"our AI"; a content
link with "&" in it is escaped once. 3.0.8: every town page and drive guide has a Spanish twin under es/ (or its Spanish was
dropped on purpose), written from today's English, with hreflang pairs and links both ways, the English twin's noindex rule,
no number the English page lacks, and no tú or price ("free"/"gratuita" are fine since 3.0.9, Joseph's call)."""
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
every = [p for p, _, _ in paths] + [f'drive/{g["slug"]}/' for g in guides.GUIDES] + ["drive/", "rest-areas/"]
every += [guides.seasonal_path(g, lang) for g in guides.SEASONAL for lang in ("en", "es")]
for path in every:
    try:
        h = read(path + "index.html")
    except OSError:
        fail(f"missing {path}")
        continue
link = guides.inline("[the sign](https://dot.ca.gov/x?a=1&b=2)", "en")
if 'href="https://dot.ca.gov/x?a=1&amp;b=2"' not in link or "&amp;amp;" in link:
    fail(f"a content link with & is escaped twice: {link}")
sw = read("sw.js")
shell = sw[sw.index("const SHELL"): sw.index("const PHOTOS")]
for bad_word in ("town/", "drive/", "place/"):
    if bad_word in shell:
        fail(f"sw.js precaches {bad_word}")
if re.search(r'"(?:\./)?es/', shell):
    fail("sw.js precaches es/")
if "<!-- guides" not in sitemap or sitemap.count("<loc>") < 70:
    fail("sitemap block")

# ── The Spanish twins (3.0.8): /es/town/<slug>/, /es/drive/<slug>/ and the two hubs ─────────────────────────────────────────
# Each town page and drive guide has a Spanish twin (or its Spanish was dropped on purpose, status "dropped"); the twin is
# written from today's English and packet (the hashes in content/seo/es), has the same structure, hreflang pairs on both
# sides, the links both ways, the English twin's noindex rule and sitemap membership, no number the English page does not
# have, every exit the English page names, and none of the banned words (no "our AI", no tú, no price).
import html as _html  # noqa: E402
from html.parser import HTMLParser  # noqa: E402


class _Vis(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        self.out.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1
        self.out.append(" ")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def visible(h):
    v = _Vis()
    v.feed(h[h.index("<body>"):])
    return " ".join("".join(v.out).split())


NUM = re.compile(r"\d+(?:[.,]\d+)*")
TU = re.compile(r"(?i)\b(tú|puedes|tienes|quieres|necesitas|estás|tu|tus|contigo)\b")
ES_BANNED = re.compile(r"(?i)nuestra (?:propia )?IA|our (?:own )?AI")
ALT = re.compile(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">')
ES_DIR = os.path.join(ROOT, "content", "seo", "es")
guides.NEW_GUIDES_DATA, guides.TOWNS = r["guides"], r["towns"]
guides.TOWNS_BY_SLUG = {t["slug"]: t for t in r["towns"]}
guides.es_load(d)
entries = {("guide", g["slug"]): g for g in r["guides"]} | {("town", t["slug"]): t for t in r["towns"]}
expected = [("guide", g["slug"], f'drive/{g["slug"]}/', False) for g in guides.GUIDES]
expected += [("guide", g["slug"], f'drive/{g["slug"]}/', False) for g in r["guides"]]
expected += [("town", t["slug"], f'town/{t["slug"]}/', t["thin"]) for t in r["towns"]]
n_es = n_dropped = 0
for kind, slug, en_path, thin in expected:
    key = f"{kind}-{slug}"
    es_path = "es/" + en_path
    try:
        with open(os.path.join(ES_DIR, key + ".json"), encoding="utf-8") as f:
            c = json.load(f)
    except OSError:
        fail(f"{es_path}: no Spanish text (content/seo/es/{key}.json); run claude-power/jobs/i5_308_spanish.py")
        continue
    if c.get("status") == "dropped":
        n_dropped += 1
        if os.path.exists(os.path.join(ROOT, es_path, "index.html")):
            fail(f"{es_path}: its Spanish was dropped but the page is still there")
        continue
    if c.get("status") != "ok":
        fail(f"{es_path}: Spanish text is {c.get('status')!r}, not ok (a draft never ships)")
        continue
    packet, en = guides.es_sources(kind, slug, d, entries)
    if c.get("src", {}).get("packet") != guides.src_hash(packet) or c.get("src", {}).get("en") != guides.src_hash(en):
        fail(f"{es_path}: its Spanish was written from an older packet or English text; write it again")
    if es_path in guides.ES["missing"]:
        fail(f"{es_path}: left out, no fresh Spanish for {', '.join(guides.ES['missing'][es_path][:5])}")
        continue
    try:
        h, he = read(es_path + "index.html"), read(en_path + "index.html")
    except OSError:
        fail(f"missing {es_path}")
        continue
    n_es += 1
    url, url_en = f"{guides.SITE}/{es_path}", f"{guides.SITE}/{en_path}"
    if '<html lang="es">' not in h or h.count('rel="canonical"') != 1 or f'<link rel="canonical" href="{url}">' not in h:
        fail(f"{es_path}: lang or canonical")
    if len(re.findall(r"<h1[ >]", h)) != 1:
        fail(f"{es_path}: h1 count")
    pair = {"en": url_en, "es": url, "x-default": url_en}
    if dict(ALT.findall(h)) != pair or dict(ALT.findall(he)) != pair:
        fail(f"{es_path}: hreflang pairs {dict(ALT.findall(h))} / English {dict(ALT.findall(he))}")
    up = "../" * es_path.count("/")
    if f'<a href="{up}{en_path}" hreflang="en" lang="en">Read in English</a>' not in h:
        fail(f"{es_path}: no 'Read in English' link to its twin")
    if f'<a href="{"../" * en_path.count("/")}{es_path}" hreflang="es" lang="es">Leer en español</a>' not in he:
        fail(f"{en_path}: no 'Leer en español' link to its twin")
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
    try:
        ld = json.loads(m.group(1))
        types = {x["@type"] for x in ld}
        if "BreadcrumbList" not in types or (kind == "town" and not any(x["@type"] == "Place" and x.get("publisher") for x in ld)):
            fail(f"{es_path}: JSON-LD types {types}")
        for x in ld:
            if x["@type"] == "FAQPage":
                for q in x["mainEntity"]:
                    if guides.E(q["name"]) not in h:
                        fail(f"{es_path}: FAQ question not on the page")
    except Exception as ex:  # noqa: BLE001
        fail(f"{es_path}: JSON-LD {ex}")
    title = _html.unescape(re.search(r"<title>(.*?)</title>", h).group(1))
    meta = _html.unescape(re.search(r'<meta name="description" content="(.*?)">', h).group(1))
    if len(title) > 75 or len(meta) > 160:
        fail(f"{es_path}: title {len(title)} / meta {len(meta)} characters")
    robots = 'name="robots" content="noindex,follow"' in h
    if robots != bool(thin) or robots != ('name="robots" content="noindex,follow"' in he):
        fail(f"{es_path}: noindex={robots} but the English twin's rule is {thin}")
    if (f"<loc>{url}</loc>" in sitemap) == bool(thin):
        fail(f"{es_path}: sitemap membership")
    base = os.path.join(ROOT, es_path)
    for href in re.findall(r'href="([^"#]+)(?:#[^"]*)?"', h):
        if not re.match(r"(https?:|mailto:|tel:)", href):
            tgt = os.path.normpath(os.path.join(base, href))
            if not (os.path.isfile(tgt) or os.path.isfile(os.path.join(tgt, "index.html"))):
                fail(f"{es_path}: broken link {href}")
    ves, ven = visible(h) + " " + title + " " + meta, visible(he) + " " + _html.unescape(re.search(r"<title>(.*?)</title>", he).group(1))
    hit = ES_BANNED.search(ves) or TU.search(ves)
    if hit:
        fail(f"{es_path}: says {hit.group(0)!r} (no 'our AI', usted not tú)")
    extra = sorted(set(NUM.findall(ves)) - set(NUM.findall(ven + " " + _html.unescape(re.search(r'<meta name="description" content="(.*?)">', he).group(1)))))
    if extra:
        fail(f"{es_path}: numbers not on the English page: {extra[:8]}")
    exits = set(re.findall(r"\bExit (\d+[A-Z]?) ·", ven)) - set(re.findall(r"\bSalida (\d+[A-Z]?) ·", ves))
    if exits or len(re.findall(r"\bExit \d+[A-Z]? ·", ven)) != len(re.findall(r"\bSalida \d+[A-Z]? ·", ves)):
        fail(f"{es_path}: the landmark list differs from the English page (exits {sorted(exits)[:8]})")
    dollars = set(re.findall(r"\$[\d,.]+", ves)) - set(re.findall(r"\$[\d,.]+", ven))
    if dollars:
        fail(f"{es_path}: amounts not on the English page: {sorted(dollars)}")
for hub_es, hub_en in (("es/town/", "town/"), ("es/drive/", "drive/")):
    try:
        h, he = read(hub_es + "index.html"), read(hub_en + "index.html")
    except OSError:
        fail(f"missing {hub_es}")
        continue
    pair = {"en": f"{guides.SITE}/{hub_en}", "es": f"{guides.SITE}/{hub_es}", "x-default": f"{guides.SITE}/{hub_en}"}
    if '<html lang="es">' not in h or dict(ALT.findall(h)) != pair or dict(ALT.findall(he)) != pair or f"<loc>{guides.SITE}/{hub_es}</loc>" not in sitemap:
        fail(f"{hub_es}: lang, hreflang pairs or sitemap")
    if ES_BANNED.search(visible(h)) or TU.search(visible(h)):
        fail(f"{hub_es}: banned word")
    base = os.path.join(ROOT, hub_es)
    for href in re.findall(r'href="([^"#]+)(?:#[^"]*)?"', h):
        if not re.match(r"(https?:|mailto:|tel:)", href):
            tgt = os.path.normpath(os.path.join(base, href))
            if not (os.path.isfile(tgt) or os.path.isfile(os.path.join(tgt, "index.html"))):
                fail(f"{hub_es}: broken link {href}")
print(f"Spanish: {n_es} twins checked, {n_dropped} dropped on purpose, {len(expected)} expected")
print(f"checked {len(paths)} pages ({len(every)} for app wording); sitemap has {sitemap.count('<loc>')} URLs;", "FAIL" if bad else "ok")
for b in bad[:60]:
    print(" -", b)
sys.exit(1 if bad else 0)
