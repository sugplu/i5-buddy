#!/usr/bin/env python3
"""I-5 Buddy: the drive guides and the rest-area page, as plain HTML that search engines can read (3.0.2).

    python3 tools/guides.py            writes drive/<slug>/index.html, drive/index.html, rest-areas/index.html,
                                       town/<slug>/index.html, town/index.html, their Spanish twins under es/
                                       (3.0.8, from content/seo/es/; see "Spanish twins" below) and the guide
                                       lines of sitemap.xml

Everything on these pages comes from data/i5.js (tools/build.py): the same fact-checked landmark texts, zones,
exits, rest areas and elevations the app speaks, so a page never says something the app does not. Mileposts are
California's exit numbers (they count up from the Mexico border). Each page ends with the way to get the app.
Run it after build.py whenever the content changes, and commit the output.
"""
import datetime
import hashlib
import html
import json
import os
import re
import sys
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seo import spec, template  # noqa: E402  (tools/seo: the town pages and the 12 topic guides)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://i5.dominares.org"
TODAY = datetime.date.today().isoformat()

GUIDES = [
    {
        "slug": "los-angeles-to-san-francisco",
        "from": 135, "to": 446,
        "title": "Los Angeles to San Francisco on I-5: what you pass",
        "h1": "Los Angeles to San Francisco on I-5",
        "desc": "Driving I-5 from LA toward San Francisco? Every landmark, town and story you pass from downtown Los Angeles "
                "over the Grapevine and up the San Joaquin Valley to the I-580 turnoff, mile by mile, with exits and rest areas.",
        "lede": "The I-5 part of the drive runs about {miles} miles, from downtown Los Angeles (exit 135) over the Grapevine "
                "and up the west side of the San Joaquin Valley to exit 446, where I-580 leaves for the Bay Area over "
                "Altamont Pass. Here is what you pass on the way north, in order, with the exit and which side to look.",
        "live": ("Is the Grapevine open?", "../../grapevine/", "Live closures and chain controls over Tejon Pass."),
    },
    {
        "slug": "sacramento-to-redding",
        "from": 519, "to": 680,
        "title": "Sacramento to Redding on I-5: what you pass",
        "h1": "Sacramento to Redding on I-5",
        "desc": "Driving I-5 from Sacramento to Redding? The rice fields, river towns, buttes and stories along the "
                "Sacramento Valley, mile by mile, with exits and rest areas.",
        "lede": "From downtown Sacramento (exit 519) to Redding (exit 680) is about {miles} miles of I-5 up the "
                "Sacramento Valley. Here is what you pass on the way north, in order, with the exit and which side to look.",
        "live": None,
    },
    {
        "slug": "redding-to-oregon",
        "from": 677, "to": 797,
        "title": "Redding to Oregon on I-5: Mount Shasta and the Siskiyous",
        "h1": "Redding to Oregon on I-5: Mount Shasta and the Siskiyous",
        "desc": "Driving I-5 north from Redding to the Oregon line? Shasta Lake, the Sacramento River canyon, Mount Shasta "
                "and the Siskiyous, mile by mile, with exits, rest areas and live pass status.",
        "lede": "From Redding (exit 677) to the Oregon line is about {miles} miles of I-5 and the steepest, most scenic part "
                "of the road in California: over Shasta Lake, up the Sacramento River canyon, past Mount Shasta and into "
                "the Siskiyous. Here is what you pass on the way north, in order, with the exit and which side to look.",
        "live": ("Is I-5 open through the Siskiyous?", "../../grapevine/#siskiyous", "Live closures and chain controls through Mount Shasta and the Siskiyous."),
    },
]

# Seasonal pages: the text lives in content/guides/<file> (English and Spanish, written and fact-checked once; see
# claude-power/jobs/i5_thanksgiving.py) and is rendered here by seasonal_body(). Each has an English and a Spanish URL.
SEASONAL = [
    {
        "slug": "thanksgiving",
        "file": "content/guides/thanksgiving-2026.json",
        "hub": {"en": "Thanksgiving 2026 on I-5 in California", "es": "Thanksgiving 2026 en la I-5 en California"},
        "live": {"en": ("Is the Grapevine open?", "../../grapevine/", "Live closures and chain controls over Tejon Pass, from the CHP and Caltrans."),
                 "es": ("¿Está abierto el Grapevine?", "../../grapevine/", "Cierres y control de cadenas en vivo sobre Tejon Pass, de la CHP y Caltrans.")},
    },
]

# Page furniture by language (English is the default everywhere else in this file).
LANG = {
    "en": {"html": "en", "ld": "en-US", "locale": "en_US", "home": "I-5 Buddy", "guides": "Drive guides",
           "app_h": "Hear it as you drive",
           "app_p": "I-5 Buddy is a talking guide to I-5 in California. It follows you by GPS and tells you about each of these "
                    "places a mile or two before you reach them, which side to look, and the story behind it. No account, no ads. "
                    "Set it up before you drive. Narration is hands-free; leave the screen to passengers.",
           "app_a": "Get the iPhone app", "app_b": "Open it in your browser",
           "fine": 'Mileposts are California\'s exit numbers, which count up from the Mexico border. Every landmark lists the '
                   'source it was checked against. Made by <a href="https://dominares.org/">Dominares</a> in San Diego. Not affiliated with Caltrans or the CHP. Questions or corrections: <a href="mailto:support@dominares.org">support@dominares.org</a>.',
           "fine_s": 'Mileposts are California\'s exit numbers, which count up from the Mexico border. Stops come from I-5 Buddy\'s own '
                     'data; dates and rules link to the official page they come from. Made by <a href="https://dominares.org/">Dominares</a> '
                     'in San Diego. Not affiliated with Caltrans or the CHP. Questions or corrections: <a href="mailto:support@dominares.org">support@dominares.org</a>.',
           "sources": "Sources", "other": "Leer en español", "more": "More I-5 guides"},
    "es": {"html": "es", "ld": "es-US", "locale": "es_US", "home": "I-5 Buddy", "guides": "Guías de viaje",
           "app_h": "Escúchela mientras conduce",
           "app_p": "I-5 Buddy es una guía parlante de la I-5 en California. Lo sigue por GPS y le cuenta cada uno de estos "
                    "lugares una o dos millas antes de llegar, de qué lado mirar y la historia detrás. Sin cuenta y sin anuncios. "
                    "Configúrela antes de conducir. La narración es manos libres; deje la pantalla a los pasajeros.",
           "app_a": "Obtener la app para iPhone", "app_b": "Abrir en el navegador",
           "fine": 'Los marcadores de milla son los números de salida de California, que aumentan desde la frontera con México. Cada lugar de interés '
                   'indica la fuente con la que se verificó. Hecho por <a href="https://dominares.org/">Dominares</a> '
                   'en San Diego. Sin relación con Caltrans ni con la CHP. Preguntas o correcciones: <a href="mailto:support@dominares.org">support@dominares.org</a>.',
           "fine_s": 'Los marcadores de milla son los números de salida de California, que aumentan desde la frontera con México. Las paradas salen de los datos de '
                     'I-5 Buddy; las fechas y reglas enlazan a la página oficial de donde vienen. Hecho por <a href="https://dominares.org/">Dominares</a> '
                     'en San Diego. Sin relación con Caltrans ni con la CHP. Preguntas o correcciones: <a href="mailto:support@dominares.org">support@dominares.org</a>.',
           "sources": "Fuentes", "other": "Read in English", "more": "Más guías de la I-5"},
}

CAT = {"hist": "History", "nature": "Land & water", "town": "Towns", "odd": "Oddities", "farm": "Orchards & farms", "stop": "Good stops"}
JUNK_REST = re.compile(r"^(water|rest area|services)$", re.I)


def load():
    s = open(os.path.join(ROOT, "data", "i5.js"), encoding="utf-8").read()
    return json.loads(s[s.index("{"): s.rindex("}") + 1])


E = html.escape


def side_north(p):
    """Which side a northbound driver sees it on (js/data.js sideWord)."""
    if not p.get("side") or p.get("detour"):
        return ""
    return "right" if p["side"] == 1 else "left"


def src_label(url):
    host = urlparse(url).netloc.replace("www.", "")
    return {"en.wikipedia.org": "Wikipedia"}.get(host, host)


def first_sentences(text, n=2):
    """The first n sentences, never cut inside "magnitude 6.7", "Jr." or "U.S. 99" (tools/seo/spec.py sentences())."""
    return spec.first_sentences(text, n)


def rest_name(r):
    n = re.sub(r"\b(north|south)bound\b", "", r["name"], flags=re.I)
    n = re.sub(r"\bSafety Roadside\b", "", n)
    n = re.sub(r"\(\s*\)", "", n)
    n = n.replace("Coalinga Avenal", "Coalinga-Avenal")
    n = re.sub(r"\s*-\s*", "-", n)
    n = re.sub(r"^LT\.", "Lt.", n)
    return re.sub(r"\s{2,}", " ", n).strip(" -")


def rest_stops(d, lo, hi, kind="rest_area"):
    """Rest areas between two mileposts. Two records within 2.5 miles of each other with the same name (or a north and
    a south record) are one stop with a side for each direction. A direction is shown only when the data says it: the
    name says northbound or southbound, or there is a record on each side of the freeway. Otherwise it stays blank."""
    out = []
    for r in sorted(d["rest"], key=lambda r: r["m"]):
        if not (lo <= r["m"] <= hi) or r["kind"] != kind or JUNK_REST.match(r["name"].strip()):
            continue
        name = rest_name(r)
        dirn = "northbound" if re.search(r"northbound", r["name"], re.I) else "southbound" if re.search(r"southbound", r["name"], re.I) else ""
        prev = out[-1] if out else None
        if prev and abs(prev["m"] - r["m"]) < 2.5 and (prev["key"] == name.lower() or (prev["dir"] and dirn and prev["dir"] != dirn)):
            if (prev["dir"] and dirn and prev["dir"] != dirn) or (r.get("side") and prev["sides"] and r["side"] not in prev["sides"]):
                prev["dir"] = "both"
            if r.get("side"):
                prev["sides"].add(r["side"])
            continue
        out.append({"name": name, "key": name.lower(), "m": r["m"], "dir": dirn, "sides": {r["side"]} if r.get("side") else set(),
                    "toilets": r.get("toilets")})
    return out


STYLE = """
:root{--bg:#f4f3ef;--card:#fff;--line:#e4e2dc;--fg:#16201b;--muted:#56645c;--accent:#f0b419;--link:#8a5a00;--sign:#0b6e3f;--radius:16px;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#101412;--card:#1a201d;--line:#313b36;--fg:#e9eee9;--muted:#9fb0a6;--accent:#f2c230;--link:#f2c230;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:680px;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 48px max(16px,env(safe-area-inset-left))}
a{color:var(--link);font-weight:700;text-underline-offset:2px}
.top{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.top img{width:34px;height:34px;border-radius:8px}
.top a{color:var(--fg);text-decoration:none;font-weight:900}
nav.crumbs{font-size:.85rem;color:var(--muted);margin:4px 0 0}
nav.crumbs a{font-weight:600;color:var(--muted)}
h1{font-size:2rem;line-height:1.12;margin:16px 0 8px;letter-spacing:-.01em}
h2{font-size:1.3rem;line-height:1.2;margin:38px 0 4px}
h2 small{display:block;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.lede{font-size:1.08rem;margin:0 0 16px}
.zone{color:var(--muted);margin:4px 0 12px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
.facts div{background:var(--card);border-radius:14px;padding:12px 14px;box-shadow:0 1px 2px rgba(16,24,20,.05),0 10px 24px -14px rgba(16,24,20,.25)}
.facts b{display:block;font-size:1.35rem;line-height:1.1}
.facts span{font-size:.85rem;color:var(--muted)}
ol.places{list-style:none;padding:0;margin:0;display:grid;gap:10px}
ol.places li{background:var(--card);border-radius:14px;padding:12px 16px 14px;box-shadow:0 1px 2px rgba(16,24,20,.05),0 10px 24px -14px rgba(16,24,20,.22)}
ol.places h3{margin:2px 0 2px;font-size:1.08rem;line-height:1.25}
ol.places .where{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
ol.places p{margin:6px 0 0}
ol.places .src{font-size:.8rem;color:var(--muted)}
ol.places .src a{font-weight:600;color:var(--muted)}
.live{display:block;margin:14px 0;padding:14px 16px;border-radius:14px;border-left:6px solid var(--accent);background:var(--card);text-decoration:none;color:var(--fg)}
.live b{color:var(--link)}
table{width:100%;border-collapse:collapse;margin:8px 0 0;background:var(--card);border-radius:14px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;font-size:.95rem}
th{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
tr:last-child td{border-bottom:0}
.app{margin-top:40px;background:var(--sign);color:#fff;border-radius:var(--radius);padding:18px 20px}
.app b{font-size:1.15rem}.app p{margin:6px 0 12px}
.app a{display:inline-flex;align-items:center;min-height:46px;padding:0 18px;border-radius:99px;background:var(--accent);color:#1b1a10;text-decoration:none;margin:0 8px 8px 0}
.app a.alt{background:transparent;color:#fff;border:2px solid rgba(255,255,255,.6)}
.more{display:grid;gap:8px;margin:12px 0 0;padding:0;list-style:none}
.sec ul{padding-left:1.25em;margin:8px 0}.sec li{margin:4px 0}.sec p{margin:8px 0}.tw{overflow-x:auto}.lang{font-size:.9rem;margin:2px 0 0}
.q{font-size:1.05rem;margin:18px 0 2px}.fine{color:var(--muted);font-size:.85rem;margin-top:24px}
"""


def page(path, title, desc, body, crumbs, ld_extra=None, lang="en", alternates=None, fine=None, noindex=False, suffix=True, article=True):
    L = LANG[lang]
    url = f"{SITE}/{path}"
    depth = path.count("/")
    up = "../" * depth
    ld = ([] if not article else [
        {"@context": "https://schema.org", "@type": "Article", "headline": title, "description": desc, "url": url,
         "dateModified": TODAY, "inLanguage": L["ld"],
         "author": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"},
         "publisher": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"},
         "isPartOf": {"@type": "WebSite", "name": "I-5 Buddy", "url": SITE + "/"},
         "image": SITE + "/icons/og-1200x630.png"}]) + [
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + "/" + u} for i, (n, u) in enumerate(crumbs)]},
    ] + (ld_extra or [])
    alt_html = ""
    if alternates:  # {"en": path, "es": path, "x-default": path}: hreflang pairs (each page lists itself too)
        alt_html = "".join(f'<link rel="alternate" hreflang="{k}" href="{SITE}/{v}">\n' for k, v in alternates.items())
    crumb_html = " › ".join(f'<a href="{up}{u}">{E(n)}</a>' for n, u in crumbs[:-1]) + f" › {E(crumbs[-1][0])}"
    return f"""<!doctype html>
<html lang="{L['html']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{E(title)}{" · I-5 Buddy" if suffix else ""}</title>
<meta name="description" content="{E(desc)}">
<meta name="theme-color" content="#0b6e3f">
<meta name="author" content="Dominares">
<link rel="canonical" href="{url}">
{'<meta name="robots" content="noindex,follow">' + chr(10) if noindex else ''}{alt_html}<meta property="og:type" content="article">
<meta property="og:locale" content="{L['locale']}">
<meta property="og:site_name" content="I-5 Buddy by Dominares">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:image" content="{SITE}/icons/og-1200x630.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{SITE}/icons/og-1200x630.png">
<meta name="apple-itunes-app" content="app-id=6834991531">
<link rel="icon" href="{up}icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{up}icons/icon-180.png">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
<style>{STYLE}</style>
</head>
<body>
<main>
  <div class="top"><img src="{up}icons/icon-180.png" alt="" width="34" height="34"><a href="{up}">I-5 Buddy</a></div>
  <nav class="crumbs" aria-label="Breadcrumb">{crumb_html}</nav>
{body}
  <section class="app">
    <b>{L['app_h']}</b>
    <p>{L['app_p']}</p>
    <a href="{up}get/">{L['app_a']}</a><a class="alt" href="{up}">{L['app_b']}</a>
  </section>
  <p class="fine">{fine or L['fine']}</p>
</main>
</body>
</html>
"""


def lang_link(path, other_path, other):
    """The line under the lede that links a page to its twin in the other language ("Leer en español" on an English page,
    "Read in English" on a Spanish one), the same way the Thanksgiving page does."""
    up = "../" * path.count("/")
    return f'  <p class="lang"><a href="{up}{other_path}" hreflang="{other}" lang="{other}">{LANG["en" if other == "es" else "es"]["other"]}</a></p>'


def guide_body(d, g):
    lo, hi = g["from"], g["to"]
    miles = hi - lo
    places = sorted([p for p in d["places"] if lo <= p["m"] <= hi and not p.get("detour")], key=lambda p: p["m"])
    zones = [z for z in d["zones"] if z["to"] > lo and z["from"] < hi]
    # (no "highest point" tile: the terrain samples behind the hills chart differ by a few dozen feet from the
    # surveyed summit heights the landmark texts give, and a page should not say two numbers for one summit)
    gas = sum(1 for x in d["services"] if lo <= x["m"] <= hi and x.get("fuel"))
    rests = rest_stops(d, lo, hi)
    out = [f'  <h1>{E(g["h1"])}</h1>', f'  <p class="lede">{E(g["lede"].format(miles=miles))}</p>']
    path = f'drive/{g["slug"]}/'
    if es_ready("es/" + path):
        out.append(lang_link(path, "es/" + path, "es"))
    out.append('  <div class="facts">'
               f'<div><b>{miles} mi</b><span>of I-5, exit {lo} to {hi}</span></div>'
               f'<div><b>{len(places)}</b><span>landmarks and stories</span></div>'
               f'<div><b>{gas}</b><span>exits with gas</span></div>'
               f'<div><b>{len(rests)}</b><span>rest areas</span></div></div>')
    if g.get("live"):
        t, href, sub = g["live"]
        out.append(f'  <a class="live" href="{href}"><b>{E(t)}</b><br>{E(sub)}</a>')
    out.append('  <p>Driving south instead? Read it from the bottom up; left and right swap.</p>')
    for z in zones:
        zp = [p for p in places if z["from"] <= p["m"] < z["to"] or (p["m"] == hi and z["to"] >= hi)]
        zr = max(lo, z["from"]), min(hi, z["to"])
        out.append(f'  <h2><small>Miles {zr[0]:.0f} to {zr[1]:.0f}</small>{E(z["label"])}</h2>')
        out.append(f'  <p class="zone">{E(z["text"])}</p>')
        if not zp:
            continue
        out.append('  <ol class="places">')
        for p in zp:
            sw = side_north(p)
            where = f'Exit {E(str(p["ex"]))}' + (f" · on your {sw} going north" if sw else "") + f' · {CAT.get(p["cat"], "")}'
            src = f'<p class="src">Source: <a href="{E(p["src"])}" rel="nofollow noopener">{E(src_label(p["src"]))}</a></p>' if p.get("src") else ""
            out.append(f'    <li id="{E(p["id"])}"><span class="where">{where}</span><h3>{E(p["name"])}</h3>'
                       f'<p>{E(first_sentences(p["text"], 3))}</p>{src}</li>')
        out.append('  </ol>')
    if rests:
        out.append('  <h2>Rest areas on the way</h2>')
        out.append('  <table><thead><tr><th>Near mile</th><th>Rest area</th><th>Direction</th></tr></thead><tbody>')
        for r in rests:
            dr = {"both": "Both directions", "northbound": "Northbound", "southbound": "Southbound"}.get(r["dir"], "")
            out.append(f'    <tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{dr}</td></tr>')
        out.append('  </tbody></table>')
        out.append('  <p class="fine">Caltrans closes rest areas for repairs from time to time; '
                   '<a href="https://quickmap.dot.ca.gov/">Caltrans QuickMap</a> shows what is open.</p>')
    others = [x for x in GUIDES if x["slug"] != g["slug"]]
    out.append('  <h2>More I-5 guides</h2><ul class="more">' + "".join(
        f'<li><a href="../{x["slug"]}/">{E(x["h1"])}</a></li>' for x in others) +
        '<li><a href="../../town/">Towns on I-5 in California</a></li>'
        '<li><a href="../../rest-areas/">Every I-5 rest area in California</a></li>'
        '<li><a href="../../grapevine/">Is the Grapevine open? (live)</a></li></ul>')
    ld = [{"@context": "https://schema.org", "@type": "ItemList", "name": g["h1"], "numberOfItems": len(places),
           "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": p["name"],
                                "url": f'{SITE}/drive/{g["slug"]}/#{p["id"]}'} for i, p in enumerate(places)]}]
    return "\n".join(out), ld


# Spanish names of the three full-length guides, used only while one has no Spanish twin yet (place names as signed)
ES_TITLES = {"los-angeles-to-san-francisco": "De Los Angeles a San Francisco por la I-5",
             "sacramento-to-redding": "De Sacramento a Redding por la I-5",
             "redding-to-oregon": "De Redding a Oregon por la I-5: Mount Shasta y los Siskiyous"}
MD_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
MD_BOLD = re.compile(r"\*\*([^*]+)\*\*")
MONTHS = {"en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
          "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]}


def inline(text, lang):
    """Escape, then **bold** and [label](url). Relative links in the content are written for the English page two folders
    deep (../../grapevine/); the Spanish page is one folder deeper, so they get one more ../."""
    def link(m):
        href = html.unescape(m.group(2))  # the text was escaped first: unescape so "&" is written once as "&amp;", not "&amp;amp;"
        if href.startswith("../") and lang == "es":
            href = "../" + href
        ext = ' rel="noopener"' if href.startswith("http") else ""
        return f'<a href="{E(href, quote=True)}"{ext}>{m.group(1)}</a>'
    t = E(text, quote=False)
    t = MD_LINK.sub(link, t)
    return MD_BOLD.sub(r"<b>\1</b>", t)


def seasonal_path(g, lang):
    return ("es/" if lang == "es" else "") + f'drive/{g["slug"]}/'


def seasonal_body(g, lang):
    """Render one language of a seasonal page from its content file. Returns (body html, page data)."""
    data = json.load(open(os.path.join(ROOT, g["file"]), encoding="utf-8"))
    c = data[lang]
    L = LANG[lang]
    y, m, dd = (int(x) for x in data["updated"].split("-"))
    upd = f"Updated {MONTHS['en'][m - 1]} {dd}, {y}" if lang == "en" else f"Actualizado el {dd} de {MONTHS['es'][m - 1]} de {y}"
    other = "en" if lang == "es" else "es"
    out = [f'  <h1>{E(c["h1"])}</h1>', f'  <p class="lede">{inline(c["intro"], lang)}</p>',
           f'  <p class="lang"><a href="{"../" * seasonal_path(g, lang).count("/")}{seasonal_path(g, other)}" hreflang="{other}" lang="{other}">{L["other"]}</a>'
           f' · <span class="fine">{upd}</span></p>']
    t, href, sub = g["live"][lang]
    if lang == "es":
        href = "../" + href
    out.append(f'  <a class="live" href="{href}"><b>{E(t)}</b><br>{E(sub)}</a>')
    for sec in c["sections"]:
        out.append(f'  <section class="sec" id="{E(sec["id"])}"><h2>{E(sec["heading"])}</h2>')
        for b in sec["blocks"]:
            if b["type"] == "p":
                out.append(f'    <p>{inline(b["text"], lang)}</p>')
            elif b["type"] == "ul":
                out.append("    <ul>" + "".join(f"<li>{inline(i, lang)}</li>" for i in b["items"]) + "</ul>")
            else:
                head, rows = b["rows"][0], b["rows"][1:]
                out.append('    <div class="tw"><table><thead><tr>' + "".join(f"<th>{inline(h, lang)}</th>" for h in head) + "</tr></thead><tbody>")
                out += ["      <tr>" + "".join(f"<td>{inline(x, lang)}</td>" for x in r) + "</tr>" for r in rows]
                out.append("    </tbody></table></div>")
        out.append("  </section>")
    if c.get("sources"):
        out.append(f'  <section class="sec" id="sources"><h2>{L["sources"]}</h2><ul>' + "".join(
            f'<li><a href="{E(x["url"], quote=True)}" rel="noopener">{E(x["label"])}</a></li>' for x in c["sources"]) + "</ul></section>")
    up = "../" * (seasonal_path(g, lang).count("/"))

    def more_item(x):  # the Spanish page links the Spanish twin of a guide when there is one (3.0.8)
        if lang == "es" and es_ready(f'es/drive/{x["slug"]}/'):
            return f'<li><a href="{up}es/drive/{x["slug"]}/">{E(ES["pages"][("guide", x["slug"])]["h1"])}</a></li>'
        return f'<li><a href="{up}drive/{x["slug"]}/">{E(ES_TITLES.get(x["slug"], x["h1"]) if lang == "es" else x["h1"])}</a></li>'
    out.append(f'  <h2>{L["more"]}</h2><ul class="more">' + "".join(more_item(x) for x in GUIDES) +
        f'<li><a href="{up}rest-areas/">' + ("Every I-5 rest area in California" if lang == "en" else "Todas las áreas de descanso de la I-5 en California") + '</a></li></ul>')
    return "\n".join(out), c


def rest_body(d):
    rests = rest_stops(d, 0, 800)
    centers = [r for r in sorted(d["rest"], key=lambda r: r["m"]) if r["kind"] == "services" and not JUNK_REST.match(r["name"].strip())]
    dests = d["dests"]

    def near(m):
        best = min(dests, key=lambda x: abs(x["m"] - m))
        return best["name"]
    out = ['  <h1>I-5 rest areas in California</h1>',
           f'  <p class="lede">Every Caltrans rest area on Interstate 5 in California, south to north, from the Mexico border '
           f'to the Oregon line: {len(rests)} stops, with the milepost (the exit number) and which direction can use them. '
           f'Truck stops and travel centers follow, for when a rest area is closed or far.</p>',
           '  <p>Caltrans closes rest areas for repairs from time to time; <a href="https://quickmap.dot.ca.gov/">Caltrans '
           'QuickMap</a> shows what is open right now. Going over a mountain pass? <a href="../grapevine/">Is the Grapevine open?</a></p>',
           '  <h2>Rest areas</h2>',
           '  <table><thead><tr><th>Mile</th><th>Rest area</th><th>Direction</th><th>Near</th></tr></thead><tbody>']
    for r in rests:
        dr = {"both": "Both", "northbound": "Northbound", "southbound": "Southbound"}.get(r["dir"], "")
        out.append(f'    <tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{dr}</td><td>{E(near(r["m"]))}</td></tr>')
    out.append('  </tbody></table>')
    out.append('  <h2>Truck stops and travel centers</h2>')
    out.append('  <table><thead><tr><th>Mile</th><th>Stop</th><th>Near</th></tr></thead><tbody>')
    for r in centers:
        out.append(f'    <tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{E(near(r["m"]))}</td></tr>')
    out.append('  </tbody></table>')
    out.append('  <h2>Drive guides</h2><ul class="more">' + "".join(
        f'<li><a href="../drive/{x["slug"]}/">{E(x["h1"])}</a></li>' for x in GUIDES + NEW_GUIDES_DATA) + '<li><a href="../town/">Towns on I-5 in California</a></li></ul>')
    return "\n".join(out)


def hub_body():
    out = ['  <h1>I-5 drive guides for California</h1>',
           '  <p class="lede">What you pass on Interstate 5, mile by mile: the landmarks, towns, farms and stories, '
           'with exits, which side to look, and the rest areas on the way.</p>']
    if es_ready("es/drive/"):
        out.append(lang_link("drive/", "es/drive/", "es"))
    out.append('  <ul class="more">')
    for g in SEASONAL:
        out.append(f'    <li><a href="{g["slug"]}/">{E(g["hub"]["en"])}</a> · <a href="../es/drive/{g["slug"]}/" hreflang="es" lang="es">en español</a></li>')
    for g in GUIDES:
        out.append(f'    <li><a href="{g["slug"]}/">{E(g["h1"])}</a><br><small>{E(g["desc"])}</small></li>')
    for g in NEW_GUIDES_DATA:
        out.append(f'    <li><a href="{g["slug"]}/">{E(g["h1"])}</a></li>')
    out.append('    <li><a href="../town/">Towns on I-5 in California</a></li>')
    out.append('    <li><a href="../rest-areas/">I-5 rest areas in California</a></li>')
    out.append('    <li><a href="../grapevine/">Is the Grapevine open? Live I-5 pass status</a></li>')
    out.append('  </ul>')
    return "\n".join(out)


# ── Town pages and the 12 topic guides (tools/seo): text from content/seo/*.json, facts from tools/seo/spec.py ──────────────

SEO_FINE = ('Mileposts are California\'s exit numbers, which count up from the Mexico border. Landmark facts come from I-5 Buddy\'s own data, '
            'each checked against the source it lists. Gas, EV charger, food and lodging listings are as mapped in OpenStreetMap '
            '(&copy; OpenStreetMap contributors), not live: check a map app for what is open now. Made by <a href="https://dominares.org/">Dominares</a> '
            'in San Diego. Not affiliated with Caltrans or the CHP. Questions or corrections: <a href="mailto:support@dominares.org">support@dominares.org</a>.')


def seo_text(e):
    """Title, meta, intro and FAQ for one page: the generated text that passed the grounding check, else the template."""
    tmpl = template.town_seo(e) if e["kind"] == "town" else template.guide_seo(e)
    try:
        c = json.load(open(os.path.join(ROOT, "content", "seo", f'{e["kind"]}-{e["slug"]}.json'), encoding="utf-8"))
    except OSError:
        c = {}
    out = {k: (c.get(k) or tmpl[k]) for k in ("title", "meta", "intro")}
    out["faq"] = [x for x in (c.get("faq") or []) if x.get("q") and x.get("a")]
    out["generated"] = [k for k in ("title", "meta", "intro") if c.get(k)]
    return out


def faq_html(faq):
    if not faq:
        return "", []
    html_ = '  <h2>Questions drivers ask</h2>\n' + "".join(f'  <h3 class="q">{E(x["q"])}</h3><p>{E(x["a"])}</p>\n' for x in faq)
    ld = [{"@context": "https://schema.org", "@type": "FAQPage",
           "mainEntity": [{"@type": "Question", "name": x["q"], "acceptedAnswer": {"@type": "Answer", "text": x["a"]}} for x in faq]}]
    return html_, ld


def _names(lst, n, total):
    shown = lst[:n]
    if not shown:
        return "" if not total else f"{total}"
    return E(", ".join(shown)) + (f' <span class="src">(+{total - len(shown)} more)</span>' if total > len(shown) else "")


def svc_table(services, up, ev_only=False):
    if not services:
        return ""
    rows = []
    for s in services:
        rows.append(f'<tr><td>{E(s["ref"])}</td><td>{E(s["name"]) or "&nbsp;"}</td><td>{_names(s["fuel"], 4, s["fuelN"])}</td>'
                    f'<td>{E(", ".join(s["ev"]))}</td><td>{_names(s["food"], 4, s["foodN"])}</td><td>{_names(s["sleep"], 3, s["sleepN"])}</td></tr>')
    return ('  <div class="tw"><table><thead><tr><th>Exit</th><th>Road or town</th><th>Gas</th><th>EV charging</th><th>Food</th><th>Lodging</th></tr></thead><tbody>\n    '
            + "\n    ".join(rows) + '\n  </tbody></table></div>\n')


def rest_rows(rests):
    out = ['  <div class="tw"><table><thead><tr><th>Mile</th><th>Rest area</th><th>Direction</th></tr></thead><tbody>']
    for r in rests:
        out.append(f'    <tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{E(r["dirword"].capitalize() if r["dir"] else "Not stated in the data")}</td></tr>')
    out.append('  </tbody></table></div>')
    return "\n".join(out)


def place_li(p, up):
    sw = {1: "right", -1: "left"}.get(p["side"]) if not p["detour"] else ""
    where = f'Exit {E(p["ex"])}' + (f" · on your {sw} going north" if sw else "") + f' · {CAT.get(p["cat"], "")}'
    link = f' <a href="{up}drive/{p["story"]}/#{E(p["id"])}">Full story</a>' if p["story"] else ""
    return (f'    <li><span class="where">{where}</span><h3>{E(p["name"])}</h3><p>{E(p["text"])}{link}</p></li>')


def town_body(t, sx, up, towns_by_slug):
    a = t["anchor"]
    out = [f'  <h1>{E(t["name"])} on I-5 in California</h1>', f'  <p class="lede">{E(sx["intro"])}</p>']
    if es_ready(f'es/town/{t["slug"]}/'):
        out.append(lang_link(f'town/{t["slug"]}/', f'es/town/{t["slug"]}/', "es"))
    n_gas = sum(1 for s in t["services"] if s["fuelN"])
    n_ev = sum(1 for s in t["services"] if s["evN"])
    out.append('  <div class="facts">'
               f'<div><b>Exit {E(a["ex"])}</b><span>nearest I-5 exit to {E(t["name"])}</span></div>'
               f'<div><b>{t["n_places"]}</b><span>landmarks and stories nearby</span></div>'
               f'<div><b>{n_gas}</b><span>nearby {"exit" if n_gas == 1 else "exits"} with gas listed</span></div>'
               f'<div><b>{n_ev}</b><span>nearby {"exit" if n_ev == 1 else "exits"} with EV charging listed</span></div></div>')
    nav = []
    if t["prev"]:
        nav.append(f'<a href="{up}town/{t["prev"]["slug"]}/">&larr; {E(t["prev"]["name"])} (south)</a>')
    if t["next"]:
        nav.append(f'<a href="{up}town/{t["next"]["slug"]}/">{E(t["next"]["name"])} (north) &rarr;</a>')
    out.append('  <p class="lang">' + " &middot; ".join(nav) + '</p>')
    out.append(f'  <h2>Exits and services near {E(t["name"])}</h2>')
    if t["services"] and any(s["fuelN"] or s["evN"] or s["foodN"] or s["sleepN"] for s in t["services"]):
        out.append(f'  <p>Exits within a few miles of {E(t["name"])}, with what the data lists at each. Listings come from OpenStreetMap as mapped, not live.</p>')
        out.append(svc_table(t["services"], up).rstrip())
    else:
        out.append(f'  <p>I-5 Buddy\'s data lists no gas, EV charging, food or lodging at an exit near {E(t["name"])}. '
                   f'The exits in this stretch: {E("; ".join("exit " + x["ref"] + " " + x["name"] if x["name"] else "exit " + x["ref"] for x in t["exits"]))}.</p>')
    out.append(f'  <h2>What to see near {E(t["name"])}</h2>')
    out.append('  <ol class="places">')
    out.append(place_li(a, up).replace("<li>", f'<li id="{E(a["id"])}">', 1))
    for p in t["places"]:
        out.append(place_li(p, up))
    out.append('  </ol>')
    if t["zone"]:
        out.append(f'  <h2>{E(t["zone"]["label"])}</h2><p class="zone">{E(t["zone"]["text"])}</p>')
    out.append('  <h2>Nearest rest areas</h2>')
    rl = []
    for label, r in (("South of town", t["rest_south"]), ("North of town", t["rest_north"])):
        if r:
            rl.append(f'<li>{label}: {E(r["name"])}, mile {r["m"]:.0f}, {r["miles"]:.0f} miles from {E(t["name"])} ({E(r["dirword"])}).</li>')
    out.append('  <ul>' + "".join(rl) + '</ul>' if rl else '  <p>The data lists no rest area near here.</p>')
    out.append('  <p class="fine">Caltrans closes rest areas for repairs from time to time; <a href="https://quickmap.dot.ca.gov/">Caltrans QuickMap</a> shows what is open.</p>')
    fh, fld = faq_html(sx["faq"])
    out.append(fh.rstrip())
    guides_here = [g for g in NEW_GUIDES_DATA if g.get("covers") and any(c["slug"] == t["slug"] for c in g["covers"])]
    more = [f'<li><a href="{up}drive/{g["slug"]}/">{E(g["h1"])}</a></li>' for g in guides_here]
    for slug, lo, hi in spec.OLD_RANGES:
        if lo <= t["m"] <= hi:
            title = next(x["h1"] for x in GUIDES if x["slug"] == slug)
            more.append(f'<li><a href="{up}drive/{slug}/">{E(title)}</a></li>')
    more += [f'<li><a href="{up}town/">All towns on I-5 in California</a></li>', f'<li><a href="{up}rest-areas/">Every I-5 rest area in California</a></li>',
             f'<li><a href="{up}grapevine/">Is the Grapevine open? (live)</a></li>']
    out.append('  <h2>More on this part of I-5</h2><ul class="more">' + "".join(more) + '</ul>')
    ld = [{"@context": "https://schema.org", "@type": "Place", "name": f'{t["name"]}, California', "url": f'{SITE}/town/{t["slug"]}/',
           "description": sx["meta"], "containedInPlace": {"@type": "State", "name": "California"},
           "publisher": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"}}] + fld
    return "\n".join(out), ld


def new_guide_body(g, sx, up):
    k = g["gkind"]
    out = [f'  <h1>{E(g["h1"])}</h1>', f'  <p class="lede">{E(sx["intro"])}</p>']
    if es_ready(f'es/drive/{g["slug"]}/'):
        out.append(lang_link(f'drive/{g["slug"]}/', f'es/drive/{g["slug"]}/', "es"))
    tiles = []
    if k in ("route", "stops", "winter"):
        gas = sum(1 for s in g["services"] if s["fuelN"])
        tiles = [(f'{g["miles"]} mi', f'of I-5, exit {g["from"]} to {g["to"]}'), (str(len(g["places"])), "landmark or story" if len(g["places"]) == 1 else "landmarks and stories"),
                 (str(gas), "exit with gas listed" if gas == 1 else "exits with gas listed"),
                 (str(len(g["rests"])), ("rest area" if len(g["rests"]) == 1 else "rest areas") + ("" if k == "route" else " nearby"))]
    elif k == "ev":
        tiles = [(str(g["exits_with_ev"]), "exits with an EV charger mapped"), (str(len(g["networks"])), "charging networks named in the data"),
                 (f'{g["gaps"][0]["miles"]:.0f} mi', "longest stretch between mapped chargers")]
    elif k == "rest_gaps":
        tiles = [(str(g["n_rest"]), "Caltrans rest areas"), (str(g["n_centers"]), "truck stops and travel centers"),
                 (f'{g["longest"][0]["miles"]:.0f} mi', "longest gap between rest areas")]
    elif k == "history99":
        tiles = [(str(len(g["places"])), "I-5 Buddy landmarks that tell the Highway 99 story")]
    out.append('  <div class="facts">' + "".join(f'<div><b>{E(a)}</b><span>{E(b)}</span></div>' for a, b in tiles) + '</div>')
    if g.get("live"):
        t_, href, sub = g["live"]
        out.append(f'  <a class="live" href="{href}"><b>{E(t_)}</b><br>{E(sub)}</a>')
    if k in ("route", "stops", "winter"):
        out.append('  <p>Driving south instead? Read it from the bottom up; left and right swap.</p>')
        if g["towns"]:
            out.append('  <h2>Towns on this stretch</h2><ul class="more">' + "".join(
                f'<li><a href="{up}town/{t["slug"]}/">{E(t["name"])}</a> (exit {int(t["m"])})</li>' for t in g["towns"]) + '</ul>')
        out.append('  <h2>Exits with services</h2>')
        out.append('  <p>Gas, EV charging, food and lodging listed at each exit, as mapped in OpenStreetMap (not live).</p>')
        out.append(svc_table([s for s in g["services"] if s["fuelN"] or s["evN"] or s["foodN"] or s["sleepN"]], up).rstrip())
        if g["rests"]:
            out.append('  <h2>Rest areas</h2>')
            out.append(rest_rows(g["rests"]))
        if g.get("centers"):
            out.append('  <p>Truck stops and travel centers nearby: ' + E("; ".join(f'{c["name"]} (mile {c["m"]:.0f})' for c in g["centers"])) + '.</p>')
        for z in g["zones"]:
            zp = [p for p in g["places"] if z["from"] <= p["m"] < z["to"]]
            out.append(f'  <h2><small>Miles {max(g["from"], z["from"]):.0f} to {min(g["to"], z["to"]):.0f}</small>{E(z["label"])}</h2>')
            out.append(f'  <p class="zone">{E(z["text"])}</p>')
            if k == "winter" and z["seasons"].get("winter"):
                out.append(f'  <p><b>In winter:</b> {E(z["seasons"]["winter"])}</p>')
            if zp:
                out.append('  <ol class="places">' + "\n".join(place_li(p, up) for p in zp) + '</ol>')
    elif k == "ev":
        out.append('  <h2>Longest stretches between mapped chargers</h2>')
        out.append('  <div class="tw"><table><thead><tr><th>From</th><th>To</th><th>Miles</th></tr></thead><tbody>' + "".join(
            f'<tr><td>Exit near mile {x["from_m"]:.0f}: {E(x["from_name"])}</td><td>Exit near mile {x["to_m"]:.0f}: {E(x["to_name"])}</td><td>{x["miles"]:.0f}</td></tr>'
            for x in g["gaps"]) + '</tbody></table></div>')
        out.append('  <p>A gap here is the distance between two exits that each have a charger mapped. A charger that is not on the map does not count, and a mapped charger can be out of service: check your charging app before a long gap.</p>')
        out.append('  <h2>Every exit with an EV charger mapped</h2>')
        out.append('  <div class="tw"><table><thead><tr><th>Mile</th><th>Exit</th><th>Road or town</th><th>Networks mapped</th></tr></thead><tbody>' + "".join(
            f'<tr><td>{s["m"]:.0f}</td><td>{E(s["ref"])}</td><td>{E(s["name"])}</td><td>{E(", ".join(s["ev"]))}</td></tr>' for s in g["services"]) + '</tbody></table></div>')
    elif k == "rest_gaps":
        out.append('  <h2>The longest gaps between rest areas</h2>')
        out.append('  <div class="tw"><table><thead><tr><th>From</th><th>To</th><th>Miles</th></tr></thead><tbody>' + "".join(
            f'<tr><td>{E(x["from_name"])} (mile {x["from_m"]:.0f})</td><td>{E(x["to_name"])} (mile {x["to_m"]:.0f})</td><td>{x["miles"]:.0f}</td></tr>' for x in g["longest"]) + '</tbody></table></div>')
        out.append('  <h2>Every rest area, south to north</h2>')
        prev = None
        rows = []
        for r in g["rests"]:
            gap = "" if prev is None else f'{r["m"] - prev:.0f}'
            rows.append(f'<tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{E(r["dirword"].capitalize() if r["dir"] else "Not stated in the data")}</td><td>{gap}</td></tr>')
            prev = r["m"]
        out.append('  <div class="tw"><table><thead><tr><th>Mile</th><th>Rest area</th><th>Direction</th><th>Miles since the one before</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table></div>')
        out.append('  <h2>Truck stops and travel centers</h2><p>' + E("; ".join(f'{c["name"]} (mile {c["m"]:.0f})' for c in g["centers"])) + '.</p>')
        out.append('  <p class="fine">Caltrans closes rest areas for repairs from time to time; <a href="https://quickmap.dot.ca.gov/">Caltrans QuickMap</a> shows what is open.</p>')
    elif k == "history99":
        out.append('  <h2>The Highway 99 stories on I-5</h2><ol class="places">')
        for p in g["places"]:
            link = f' <a href="{up}drive/{p["story"]}/#{E(p["id"])}">Full story</a>' if p["story"] else ""
            out.append(f'    <li><span class="where">Exit {E(p["ex"])} · {CAT.get(p["cat"], "")}</span><h3>{E(p["name"])}</h3><p>{E(p["text99"])}{link}</p></li>')
        out.append('  </ol>')
    fh, fld = faq_html(sx["faq"])
    out.append(fh.rstrip())
    more = [f'<li><a href="{up}drive/{x["slug"]}/">{E(x["h1"])}</a></li>' for x in NEW_GUIDES_DATA if x["slug"] != g["slug"]]
    more += [f'<li><a href="{up}drive/{x["slug"]}/">{E(x["h1"])}</a></li>' for x in GUIDES]
    more += [f'<li><a href="{up}town/">All towns on I-5 in California</a></li>', f'<li><a href="{up}rest-areas/">Every I-5 rest area in California</a></li>']
    out.append('  <h2>More I-5 guides</h2><ul class="more">' + "".join(more) + '</ul>')
    ld = []
    if k in ("route", "stops", "winter") and g["places"]:
        ld.append({"@context": "https://schema.org", "@type": "ItemList", "name": g["h1"], "numberOfItems": len(g["places"]),
                   "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": p["name"]} for i, p in enumerate(g["places"])]})
    return "\n".join(out), ld + fld


def town_hub_body(towns):
    out = ['  <h1>Towns on I-5 in California</h1>',
           '  <p class="lede">The towns along Interstate 5 from the Mexico border to the Oregon line, south to north: the exit, what the data lists for gas, food and EV charging near it, the landmarks, and the nearest rest areas.</p>']
    if es_ready("es/town/"):
        out.append(lang_link("town/", "es/town/", "es"))
    out.append('  <ol class="places">')
    for t in towns:
        out.append(f'    <li><span class="where">Exit {E(t["anchor"]["ex"])}</span><h3><a href="{t["slug"]}/">{E(t["name"])}</a></h3></li>')
    out.append('  </ol>')
    out.append('  <h2>Drive guides</h2><ul class="more">' + "".join(f'<li><a href="../drive/{x["slug"]}/">{E(x["h1"])}</a></li>' for x in NEW_GUIDES_DATA + GUIDES) + '</ul>')
    return "\n".join(out)



# ── Spanish twins (3.0.8): /es/town/<slug>/, /es/drive/<slug>/, /es/town/ and /es/drive/ ─────────────────────────────────
# What was written for each page (title, description, intro, FAQ and a guide's heading) is in content/seo/es/<kind>-<slug>.json;
# the landmark and area texts the pages show are in content/seo/es/units.json, once each. Claude wrote both from the same fact
# packets and data/i5.js texts as the English pages, and a second model checked every page against its packet and its English
# twin (claude-power/jobs/i5_308_spanish.py), so a rebuild needs no model. A Spanish page is written only when its text is
# "ok" and every landmark or area text it shows is there and was written from the English that data/i5.js has now (each unit
# keeps a hash of its English). Otherwise the page is left out, its English twin gets no Spanish link or hreflang, and
# tools/seo/check_pages.py fails until the Spanish is written again. Place names stay as signed; the rest is neutral Spanish
# for California readers, addressed as usted.

ES_DIR = os.path.join(ROOT, "content", "seo", "es")
ES = {"pages": {}, "units": {"places": {}, "zones": {}}, "ready": set(), "missing": {}, "full": {}, "drafts": False}
WRITTEN = set()
CAT_ES = {"hist": "Historia", "nature": "Tierra y agua", "town": "Pueblos y ciudades", "odd": "Curiosidades", "farm": "Huertos y granjas", "stop": "Buenas paradas"}
DIRWORD_ES = {"both directions": "ambos sentidos", "northbound side": "sentido norte", "southbound side": "sentido sur",
              "direction not stated in the data": "sentido no indicado en los datos"}
LIVE_ES = {"Is the Grapevine open?": "¿Está abierto el Grapevine?", "Is I-5 open through the Siskiyous?": "¿Está abierta la I-5 en los Siskiyous?",
           "Live closures and chain controls over Tejon Pass.": "Cierres y control de cadenas en vivo sobre Tejon Pass.",
           "Live closures and chain controls over Tejon Pass, from the CHP and Caltrans.": "Cierres y control de cadenas en vivo sobre Tejon Pass, de la CHP y Caltrans.",
           "Live closures and chain controls through Mount Shasta and the Siskiyous.": "Cierres y control de cadenas en vivo en Mount Shasta y los Siskiyous."}
SEO_FINE_ES = ('Los marcadores de milla son los números de salida de California, que aumentan desde la frontera con México. Los datos de los lugares de '
               'interés vienen de I-5 Buddy, y cada uno se verificó con la fuente que cita. La gasolina, los cargadores para vehículos eléctricos, la comida '
               'y el hospedaje se muestran como aparecen en OpenStreetMap (&copy; colaboradores de OpenStreetMap), no en vivo: consulte una app de mapas '
               'para ver qué está abierto ahora. Hecho por <a href="https://dominares.org/">Dominares</a> en San Diego. Sin relación con Caltrans ni con '
               'la CHP. Preguntas o correcciones: <a href="mailto:support@dominares.org">support@dominares.org</a>.')
QUICKMAP_ES = ('  <p class="fine">Caltrans cierra áreas de descanso por reparaciones de vez en cuando; '
               '<a href="https://quickmap.dot.ca.gov/">Caltrans QuickMap</a> muestra cuáles están abiertas.</p>')
TO_REST_ES = '<a href="{up}rest-areas/" hreflang="en">Todas las áreas de descanso de la I-5 en California (en inglés)</a>'
TO_GRAPEVINE_ES = '<a href="{up}grapevine/" hreflang="en">¿Está abierto el Grapevine? (en vivo, en inglés)</a>'


def sha(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def es_path(kind, slug):
    return f"es/town/{slug}/" if kind == "town" else f"es/drive/{slug}/"


def es_ready(path):
    return path in ES["ready"]


def place_key(p):
    """What a place's Spanish was written from: its name and its first three sentences (a page shows one to three)."""
    return p["name"] + "\n" + "\n".join(spec.sentences(p["text"])[:3])


def zone_key(z):
    return f'{z["from"]:g}-{z["to"]:g}'


def millas(v):
    n = f"{v:.0f}"
    return f"{n} milla" if n == "1" else f"{n} millas"


class Tr:
    """The Spanish of the data texts on one page, from content/seo/es/units.json. A text that is missing, or that was written
    from other English than data/i5.js has now, goes in .missing (the page is then not written) and the English stands in."""

    def __init__(self):
        self.missing = []

    def _place(self, pid):
        u, f = ES["units"]["places"].get(pid), ES["full"].get(pid)
        if not u or not f or u.get("h") != sha(place_key(f)) or len(u.get("s") or []) != min(3, len(spec.sentences(f["text"]))):
            self.missing.append("place:" + pid)
            return None
        return u

    def name(self, p):
        u = self._place(p["id"])
        return u["name"] if u else p["name"]

    def text(self, p, n=None):
        """The first n sentences of a place (n: as many as the English shows here; a trimmed text says itself)."""
        u = self._place(p["id"])
        if n is None:
            n = len(spec.sentences(p["text"]))
        if not u:
            return first_sentences(p["text"], n)
        return " ".join(u["s"][:n])

    def text99(self, p):
        u = self._place(p["id"])
        if not u or u.get("h99") != sha(p["text99"]) or not u.get("text99"):
            self.missing.append("text99:" + p["id"])
            return p["text99"]
        return u["text99"]

    def _zone(self, z):
        u = ES["units"]["zones"].get(zone_key(z))
        if not u or u.get("h") != sha(z["label"] + "\n" + z["text"]):
            self.missing.append("zone:" + zone_key(z))
            return None
        return u

    def zlabel(self, z):
        u = self._zone(z)
        return u["label"] if u else z["label"]

    def ztext(self, z):
        u = self._zone(z)
        return u["text"] if u else z["text"]

    def zwinter(self, z, en):
        u = self._zone(z)
        if not u or u.get("hw") != sha(en) or not u.get("winter"):
            self.missing.append("winter:" + zone_key(z))
            return en
        return u["winter"]


def guide_link_es(slug, en_h1, up):
    """A link from a Spanish page to a guide: its Spanish twin when that is written, else the English page, marked (en inglés)."""
    if es_ready(f"es/drive/{slug}/"):
        return f'<a href="{up}es/drive/{slug}/">{E(ES["pages"][("guide", slug)]["h1"])}</a>'
    return f'<a href="{up}drive/{slug}/" hreflang="en">{E(en_h1)} (en inglés)</a>'


def town_link_es(t, up, label_html=None):
    label_html = label_html or E(t["name"])
    if es_ready(f'es/town/{t["slug"]}/'):
        return f'<a href="{up}es/town/{t["slug"]}/">{label_html}</a>'
    return f'<a href="{up}town/{t["slug"]}/" hreflang="en">{label_html} (en inglés)</a>'


def story_link_es(p, up):
    if not p["story"]:
        return ""
    if es_ready(f'es/drive/{p["story"]}/'):
        return f' <a href="{up}es/drive/{p["story"]}/#{E(p["id"])}">Historia completa</a>'
    return f' <a href="{up}drive/{p["story"]}/#{E(p["id"])}" hreflang="en">Historia completa (en inglés)</a>'


def es_place_li(p, up, tr, li_id=False):
    sw = {1: "derecha", -1: "izquierda"}.get(p["side"]) if not p["detour"] else ""
    where = f'Salida {E(p["ex"])}' + (f" · a su {sw} rumbo al norte" if sw else "") + f' · {CAT_ES.get(p["cat"], "")}'
    idattr = f' id="{E(p["id"])}"' if li_id else ""
    return f'    <li{idattr}><span class="where">{where}</span><h3>{E(tr.name(p))}</h3><p>{E(tr.text(p))}{story_link_es(p, up)}</p></li>'


def _names_es(lst, n, total):
    shown = lst[:n]
    if not shown:
        return "" if not total else f"{total}"
    return E(", ".join(shown)) + (f' <span class="src">(+{total - len(shown)} más)</span>' if total > len(shown) else "")


def es_svc_table(services):
    if not services:
        return ""
    rows = [f'<tr><td>{E(s["ref"])}</td><td>{E(s["name"]) or "&nbsp;"}</td><td>{_names_es(s["fuel"], 4, s["fuelN"])}</td>'
            f'<td>{E(", ".join(s["ev"]))}</td><td>{_names_es(s["food"], 4, s["foodN"])}</td><td>{_names_es(s["sleep"], 3, s["sleepN"])}</td></tr>' for s in services]
    return ('  <div class="tw"><table><thead><tr><th>Salida</th><th>Camino o pueblo</th><th>Gasolina</th><th>Carga eléctrica</th><th>Comida</th><th>Hospedaje</th></tr></thead><tbody>\n    '
            + "\n    ".join(rows) + '\n  </tbody></table></div>\n')


def _dir_es(r):
    return DIRWORD_ES[r["dirword"]].capitalize() if r["dir"] else "No indicado en los datos"


def es_rest_rows(rests):
    out = ['  <div class="tw"><table><thead><tr><th>Milla</th><th>Área de descanso</th><th>Sentido</th></tr></thead><tbody>']
    for r in rests:
        out.append(f'    <tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{E(_dir_es(r))}</td></tr>')
    out.append('  </tbody></table></div>')
    return "\n".join(out)


def es_faq_html(faq):
    if not faq:
        return "", []
    html_ = '  <h2>Preguntas de los conductores</h2>\n' + "".join(f'  <h3 class="q">{E(x["q"])}</h3><p>{E(x["a"])}</p>\n' for x in faq)
    ld = [{"@context": "https://schema.org", "@type": "FAQPage", "inLanguage": "es-US",
           "mainEntity": [{"@type": "Question", "name": x["q"], "acceptedAnswer": {"@type": "Answer", "text": x["a"]}} for x in faq]}]
    return html_, ld


def es_town_body(t, sx, tr):
    up = "../../../"
    a, nm, path = t["anchor"], E(t["name"]), f'es/town/{t["slug"]}/'
    out = [f'  <h1>{nm} en la I-5 en California</h1>', f'  <p class="lede">{E(sx["intro"])}</p>', lang_link(path, f'town/{t["slug"]}/', "en")]
    n_gas = sum(1 for s in t["services"] if s["fuelN"])
    n_ev = sum(1 for s in t["services"] if s["evN"])
    out.append('  <div class="facts">'
               f'<div><b>Salida {E(a["ex"])}</b><span>salida de la I-5 más cercana a {nm}</span></div>'
               f'<div><b>{t["n_places"]}</b><span>{"lugar de interés o historia cerca" if t["n_places"] == 1 else "lugares de interés e historias cerca"}</span></div>'
               f'<div><b>{n_gas}</b><span>{"salida cercana" if n_gas == 1 else "salidas cercanas"} con gasolina en los datos</span></div>'
               f'<div><b>{n_ev}</b><span>{"salida cercana" if n_ev == 1 else "salidas cercanas"} con carga para vehículos eléctricos en los datos</span></div></div>')
    nav = []
    if t["prev"]:
        nav.append(town_link_es(t["prev"], up, f'&larr; {E(t["prev"]["name"])} (al sur)'))
    if t["next"]:
        nav.append(town_link_es(t["next"], up, f'{E(t["next"]["name"])} (al norte) &rarr;'))
    out.append('  <p class="lang">' + " &middot; ".join(nav) + '</p>')
    out.append(f'  <h2>Salidas y servicios cerca de {nm}</h2>')
    if t["services"] and any(s["fuelN"] or s["evN"] or s["foodN"] or s["sleepN"] for s in t["services"]):
        out.append(f'  <p>Salidas a pocas millas de {nm}, con lo que registran los datos en cada una. Los datos vienen de OpenStreetMap tal como están en el mapa, no en vivo.</p>')
        out.append(es_svc_table(t["services"]).rstrip())
    else:
        out.append(f'  <p>Los datos de I-5 Buddy no registran gasolina, carga para vehículos eléctricos, comida ni hospedaje en una salida cerca de {nm}. '
                   f'Las salidas en este tramo: {E("; ".join("salida " + x["ref"] + " " + x["name"] if x["name"] else "salida " + x["ref"] for x in t["exits"]))}.</p>')
    out.append(f'  <h2>Qué ver cerca de {nm}</h2>')
    out.append('  <ol class="places">')
    out.append(es_place_li(a, up, tr, li_id=True))
    for p in t["places"]:
        out.append(es_place_li(p, up, tr))
    out.append('  </ol>')
    if t["zone"]:
        out.append(f'  <h2>{E(tr.zlabel(t["zone"]))}</h2><p class="zone">{E(tr.ztext(t["zone"]))}</p>')
    out.append('  <h2>Áreas de descanso más cercanas</h2>')
    rl = []
    for label, r in (("Al sur", t["rest_south"]), ("Al norte", t["rest_north"])):
        if r:
            rl.append(f'<li>{label} de {nm}: {E(r["name"])}, en la milla {r["m"]:.0f}, a {millas(r["miles"])} ({E(DIRWORD_ES[r["dirword"]])}).</li>')
    out.append('  <ul>' + "".join(rl) + '</ul>' if rl else '  <p>Los datos no registran un área de descanso cerca de aquí.</p>')
    out.append(QUICKMAP_ES)
    fh, fld = es_faq_html(sx["faq"])
    out.append(fh.rstrip())
    guides_here = [g for g in NEW_GUIDES_DATA if g.get("covers") and any(c["slug"] == t["slug"] for c in g["covers"])]
    more = [f'<li>{guide_link_es(g["slug"], g["h1"], up)}</li>' for g in guides_here]
    for slug, lo, hi in spec.OLD_RANGES:
        if lo <= t["m"] <= hi:
            more.append(f'<li>{guide_link_es(slug, next(x["h1"] for x in GUIDES if x["slug"] == slug), up)}</li>')
    more += [f'<li><a href="{up}es/town/">Todos los pueblos y ciudades de la I-5 en California</a></li>', f'<li>{TO_REST_ES.format(up=up)}</li>',
             f'<li>{TO_GRAPEVINE_ES.format(up=up)}</li>']
    out.append('  <h2>Más sobre este tramo de la I-5</h2><ul class="more">' + "".join(more) + '</ul>')
    ld = [{"@context": "https://schema.org", "@type": "Place", "name": f'{t["name"]}, California', "url": f'{SITE}/{path}',
           "description": sx["meta"], "containedInPlace": {"@type": "State", "name": "California"},
           "publisher": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"}}] + fld
    return "\n".join(out), ld


def es_new_guide_body(g, sx, tr):
    up = "../../../"
    k, path = g["gkind"], f'es/drive/{g["slug"]}/'
    out = [f'  <h1>{E(sx["h1"])}</h1>', f'  <p class="lede">{E(sx["intro"])}</p>', lang_link(path, f'drive/{g["slug"]}/', "en")]
    tiles = []
    if k in ("route", "stops", "winter"):
        gas, nr, npl = sum(1 for s in g["services"] if s["fuelN"]), len(g["rests"]), len(g["places"])
        tiles = [(f'{g["miles"]} mi', f'de la I-5, de la salida {g["from"]} a la {g["to"]}'),
                 (str(npl), "lugar de interés o historia" if npl == 1 else "lugares de interés e historias"),
                 (str(gas), "salida con gasolina en los datos" if gas == 1 else "salidas con gasolina en los datos"),
                 (str(nr), ("área de descanso" if nr == 1 else "áreas de descanso") + ("" if k == "route" else " cerca"))]
    elif k == "ev":
        tiles = [(str(g["exits_with_ev"]), "salidas con un cargador para vehículos eléctricos en el mapa"),
                 (str(len(g["networks"])), "redes de carga nombradas en los datos"),
                 (f'{g["gaps"][0]["miles"]:.0f} mi', "el tramo más largo entre cargadores en el mapa")]
    elif k == "rest_gaps":
        tiles = [(str(g["n_rest"]), "áreas de descanso de Caltrans"), (str(g["n_centers"]), "paradas de camiones y centros para viajeros"),
                 (f'{g["longest"][0]["miles"]:.0f} mi', "la distancia más larga entre áreas de descanso")]
    elif k == "history99":
        tiles = [(str(len(g["places"])), "lugares de interés de I-5 Buddy que cuentan la historia de la Highway 99")]
    out.append('  <div class="facts">' + "".join(f'<div><b>{E(a)}</b><span>{E(b)}</span></div>' for a, b in tiles) + '</div>')
    if g.get("live"):
        t_, href, sub = g["live"]
        out.append(f'  <a class="live" href="../{href}"><b>{E(LIVE_ES[t_])}</b><br>{E(LIVE_ES[sub])}</a>')
    if k in ("route", "stops", "winter"):
        out.append('  <p>¿Va hacia el sur? Lea la lista de abajo hacia arriba; la izquierda y la derecha se invierten.</p>')
        if g["towns"]:
            out.append('  <h2>Pueblos y ciudades en este tramo</h2><ul class="more">' + "".join(
                f'<li>{town_link_es(t, up)} (salida {int(t["m"])})</li>' for t in g["towns"]) + '</ul>')
        out.append('  <h2>Salidas con servicios</h2>')
        out.append('  <p>Gasolina, carga para vehículos eléctricos, comida y hospedaje en cada salida, según OpenStreetMap (no en vivo).</p>')
        out.append(es_svc_table([s for s in g["services"] if s["fuelN"] or s["evN"] or s["foodN"] or s["sleepN"]]).rstrip())
        if g["rests"]:
            out.append('  <h2>Áreas de descanso</h2>')
            out.append(es_rest_rows(g["rests"]))
        if g.get("centers"):
            out.append('  <p>Paradas de camiones y centros para viajeros cerca: ' + E("; ".join(f'{c["name"]} (milla {c["m"]:.0f})' for c in g["centers"])) + '.</p>')
        for z in g["zones"]:
            zp = [p for p in g["places"] if z["from"] <= p["m"] < z["to"]]
            out.append(f'  <h2><small>Millas {max(g["from"], z["from"]):.0f} a {min(g["to"], z["to"]):.0f}</small>{E(tr.zlabel(z))}</h2>')
            out.append(f'  <p class="zone">{E(tr.ztext(z))}</p>')
            if k == "winter" and z["seasons"].get("winter"):
                out.append(f'  <p><b>En invierno:</b> {E(tr.zwinter(z, z["seasons"]["winter"]))}</p>')
            if zp:
                out.append('  <ol class="places">' + "\n".join(es_place_li(p, up, tr) for p in zp) + '</ol>')
    elif k == "ev":
        out.append('  <h2>Los tramos más largos entre cargadores en el mapa</h2>')
        out.append('  <div class="tw"><table><thead><tr><th>Desde</th><th>Hasta</th><th>Millas</th></tr></thead><tbody>' + "".join(
            f'<tr><td>Salida cerca de la milla {x["from_m"]:.0f}: {E(x["from_name"])}</td><td>Salida cerca de la milla {x["to_m"]:.0f}: {E(x["to_name"])}</td><td>{x["miles"]:.0f}</td></tr>'
            for x in g["gaps"]) + '</tbody></table></div>')
        out.append('  <p>Aquí, un tramo es la distancia entre dos salidas que tienen un cargador en el mapa. Un cargador que no está en el mapa no cuenta, '
                   'y un cargador que está en el mapa puede estar fuera de servicio: revise su app de carga antes de un tramo largo.</p>')
        out.append('  <h2>Todas las salidas con un cargador en el mapa</h2>')
        out.append('  <div class="tw"><table><thead><tr><th>Milla</th><th>Salida</th><th>Camino o pueblo</th><th>Redes en el mapa</th></tr></thead><tbody>' + "".join(
            f'<tr><td>{s["m"]:.0f}</td><td>{E(s["ref"])}</td><td>{E(s["name"])}</td><td>{E(", ".join(s["ev"]))}</td></tr>' for s in g["services"]) + '</tbody></table></div>')
    elif k == "rest_gaps":
        out.append('  <h2>Las distancias más largas entre áreas de descanso</h2>')
        out.append('  <div class="tw"><table><thead><tr><th>Desde</th><th>Hasta</th><th>Millas</th></tr></thead><tbody>' + "".join(
            f'<tr><td>{E(x["from_name"])} (milla {x["from_m"]:.0f})</td><td>{E(x["to_name"])} (milla {x["to_m"]:.0f})</td><td>{x["miles"]:.0f}</td></tr>' for x in g["longest"]) + '</tbody></table></div>')
        out.append('  <h2>Todas las áreas de descanso, de sur a norte</h2>')
        prev = None
        rows = []
        for r in g["rests"]:
            gap = "" if prev is None else f'{r["m"] - prev:.0f}'
            rows.append(f'<tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{E(_dir_es(r))}</td><td>{gap}</td></tr>')
            prev = r["m"]
        out.append('  <div class="tw"><table><thead><tr><th>Milla</th><th>Área de descanso</th><th>Sentido</th><th>Millas desde la anterior</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table></div>')
        out.append('  <h2>Paradas de camiones y centros para viajeros</h2><p>' + E("; ".join(f'{c["name"]} (milla {c["m"]:.0f})' for c in g["centers"])) + '.</p>')
        out.append(QUICKMAP_ES)
    elif k == "history99":
        out.append('  <h2>Las historias de la Highway 99 en la I-5</h2><ol class="places">')
        for p in g["places"]:
            out.append(f'    <li><span class="where">Salida {E(p["ex"])} · {CAT_ES.get(p["cat"], "")}</span><h3>{E(tr.name(p))}</h3><p>{E(tr.text99(p))}{story_link_es(p, up)}</p></li>')
        out.append('  </ol>')
    fh, fld = es_faq_html(sx["faq"])
    out.append(fh.rstrip())
    more = [f'<li>{guide_link_es(x["slug"], x["h1"], up)}</li>' for x in NEW_GUIDES_DATA if x["slug"] != g["slug"]]
    more += [f'<li>{guide_link_es(x["slug"], x["h1"], up)}</li>' for x in GUIDES]
    more += [f'<li><a href="{up}es/town/">Todos los pueblos y ciudades de la I-5 en California</a></li>', f'<li>{TO_REST_ES.format(up=up)}</li>']
    out.append('  <h2>Más guías de la I-5</h2><ul class="more">' + "".join(more) + '</ul>')
    ld = []
    if k in ("route", "stops", "winter") and g["places"]:
        ld.append({"@context": "https://schema.org", "@type": "ItemList", "name": sx["h1"], "numberOfItems": len(g["places"]),
                   "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": tr.name(p)} for i, p in enumerate(g["places"])]})
    return "\n".join(out), ld + fld


def es_guide_body(d, g, sx, tr):
    """The Spanish twin of one of the three full-length guides (guide_body)."""
    up = "../../../"
    lo, hi = g["from"], g["to"]
    miles = hi - lo
    places = sorted([p for p in d["places"] if lo <= p["m"] <= hi and not p.get("detour")], key=lambda p: p["m"])
    zones = [z for z in d["zones"] if z["to"] > lo and z["from"] < hi]
    gas = sum(1 for x in d["services"] if lo <= x["m"] <= hi and x.get("fuel"))
    rests = rest_stops(d, lo, hi)
    path = f'es/drive/{g["slug"]}/'
    out = [f'  <h1>{E(sx["h1"])}</h1>', f'  <p class="lede">{E(sx["intro"])}</p>', lang_link(path, f'drive/{g["slug"]}/', "en")]
    out.append('  <div class="facts">'
               f'<div><b>{miles} mi</b><span>de la I-5, de la salida {lo} a la {hi}</span></div>'
               f'<div><b>{len(places)}</b><span>lugares de interés e historias</span></div>'
               f'<div><b>{gas}</b><span>salidas con gasolina</span></div>'
               f'<div><b>{len(rests)}</b><span>áreas de descanso</span></div></div>')
    if g.get("live"):
        t, href, sub = g["live"]
        out.append(f'  <a class="live" href="../{href}"><b>{E(LIVE_ES[t])}</b><br>{E(LIVE_ES[sub])}</a>')
    out.append('  <p>¿Va hacia el sur? Lea la lista de abajo hacia arriba; la izquierda y la derecha se invierten.</p>')
    for z in zones:
        zp = [p for p in places if z["from"] <= p["m"] < z["to"] or (p["m"] == hi and z["to"] >= hi)]
        zr = max(lo, z["from"]), min(hi, z["to"])
        out.append(f'  <h2><small>Millas {zr[0]:.0f} a {zr[1]:.0f}</small>{E(tr.zlabel(z))}</h2>')
        out.append(f'  <p class="zone">{E(tr.ztext(z))}</p>')
        if not zp:
            continue
        out.append('  <ol class="places">')
        for p in zp:
            sw = {"right": "derecha", "left": "izquierda"}.get(side_north(p), "")
            where = f'Salida {E(str(p["ex"]))}' + (f" · a su {sw} rumbo al norte" if sw else "") + f' · {CAT_ES.get(p["cat"], "")}'
            src = f'<p class="src">Fuente: <a href="{E(p["src"])}" rel="nofollow noopener">{E(src_label(p["src"]))}</a></p>' if p.get("src") else ""
            out.append(f'    <li id="{E(p["id"])}"><span class="where">{where}</span><h3>{E(tr.name(p))}</h3>'
                       f'<p>{E(tr.text(p, 3))}</p>{src}</li>')
        out.append('  </ol>')
    if rests:
        out.append('  <h2>Áreas de descanso en el camino</h2>')
        out.append('  <table><thead><tr><th>Cerca de la milla</th><th>Área de descanso</th><th>Sentido</th></tr></thead><tbody>')
        for r in rests:
            dr = {"both": "Ambos sentidos", "northbound": "Sentido norte", "southbound": "Sentido sur"}.get(r["dir"], "")
            out.append(f'    <tr><td>{r["m"]:.0f}</td><td>{E(r["name"])}</td><td>{dr}</td></tr>')
        out.append('  </tbody></table>')
        out.append(QUICKMAP_ES)
    others = [x for x in GUIDES if x["slug"] != g["slug"]]
    out.append('  <h2>Más guías de la I-5</h2><ul class="more">' + "".join(f'<li>{guide_link_es(x["slug"], x["h1"], up)}</li>' for x in others) +
               f'<li><a href="{up}es/town/">Pueblos y ciudades de la I-5 en California</a></li><li>{TO_REST_ES.format(up=up)}</li><li>{TO_GRAPEVINE_ES.format(up=up)}</li></ul>')
    ld = [{"@context": "https://schema.org", "@type": "ItemList", "name": sx["h1"], "numberOfItems": len(places),
           "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": tr.name(p),
                                "url": f'{SITE}/{path}#{p["id"]}'} for i, p in enumerate(places)]}]
    return "\n".join(out), ld


def es_town_hub_body(towns):
    up = "../../"
    out = ['  <h1>Pueblos y ciudades de la I-5 en California</h1>',
           '  <p class="lede">Los pueblos y ciudades a lo largo de la Interestatal 5, de la frontera con México a la línea de Oregon, de sur a norte: la salida, '
           'lo que registran los datos de gasolina, comida y carga para vehículos eléctricos cerca de cada uno, los lugares de interés y las áreas '
           'de descanso más cercanas.</p>', lang_link("es/town/", "town/", "en"), '  <ol class="places">']
    for t in towns:
        out.append(f'    <li><span class="where">Salida {E(t["anchor"]["ex"])}</span><h3>{town_link_es(t, up)}</h3></li>')
    out.append('  </ol>')
    out.append('  <h2>Guías de viaje</h2><ul class="more">' + "".join(f'<li>{guide_link_es(x["slug"], x["h1"], up)}</li>' for x in NEW_GUIDES_DATA + GUIDES) + '</ul>')
    return "\n".join(out)


def es_hub_body():
    up = "../../"
    out = ['  <h1>Guías de viaje de la I-5 en California</h1>',
           '  <p class="lede">Lo que verá en la Interestatal 5, milla por milla: los lugares de interés, los pueblos, las granjas y las historias, '
           'con las salidas, de qué lado mirar y las áreas de descanso en el camino.</p>', lang_link("es/drive/", "drive/", "en"), '  <ul class="more">']
    for g in SEASONAL:
        out.append(f'    <li><a href="{g["slug"]}/">{E(g["hub"]["es"])}</a></li>')
    for g in GUIDES:
        if es_ready(f'es/drive/{g["slug"]}/'):
            c = ES["pages"][("guide", g["slug"])]
            out.append(f'    <li><a href="{g["slug"]}/">{E(c["h1"])}</a><br><small>{E(c["meta"])}</small></li>')
        else:
            out.append(f'    <li>{guide_link_es(g["slug"], g["h1"], up)}</li>')
    for g in NEW_GUIDES_DATA:
        out.append(f'    <li>{guide_link_es(g["slug"], g["h1"], up)}</li>')
    out.append('    <li><a href="../town/">Pueblos y ciudades de la I-5 en California</a></li>')
    out.append(f'    <li>{TO_REST_ES.format(up=up)}</li>')
    out.append(f'    <li>{TO_GRAPEVINE_ES.format(up=up)}</li>')
    out.append('  </ul>')
    return "\n".join(out)


def es_body(kind, slug, d, tr):
    """The Spanish body of one page (and its extra JSON-LD), from its stored text."""
    sx = ES["pages"][(kind, slug)]
    if kind == "town":
        return es_town_body(TOWNS_BY_SLUG[slug], sx, tr)
    old = next((g for g in GUIDES if g["slug"] == slug), None)
    if old:
        return es_guide_body(d, old, sx, tr)
    return es_new_guide_body(next(g for g in NEW_GUIDES_DATA if g["slug"] == slug), sx, tr)


def es_load(d):
    """Read content/seo/es/ and work out which Spanish pages are written this time (see the note above).
    I5_ES_DRAFTS=1 also writes pages whose text is still a draft (claude-power's checker reads them before they pass)."""
    ES["drafts"] = os.environ.get("I5_ES_DRAFTS") == "1"
    try:
        with open(os.path.join(ES_DIR, "units.json"), encoding="utf-8") as f:
            ES["units"] = json.load(f)
    except OSError:
        ES["units"] = {"places": {}, "zones": {}}
    ES["full"] = {p["id"]: p for p in d["places"]}
    ES["pages"], ES["missing"] = {}, {}
    allowed = ("ok", "draft") if ES["drafts"] else ("ok",)
    keys = [("guide", g["slug"]) for g in GUIDES] + [("guide", g["slug"]) for g in NEW_GUIDES_DATA] + [("town", t["slug"]) for t in TOWNS]
    for kind, slug in keys:
        try:
            with open(os.path.join(ES_DIR, f"{kind}-{slug}.json"), encoding="utf-8") as f:
                c = json.load(f)
        except OSError:
            continue
        if c.get("status") in allowed:
            ES["pages"][(kind, slug)] = c
    # first pass, every candidate counted as written: which pages show a landmark or area text without fresh Spanish
    ES["ready"] = {es_path(k, s) for k, s in ES["pages"]} | {"es/town/", "es/drive/"}
    for kind, slug in ES["pages"]:
        tr = Tr()
        es_body(kind, slug, d, tr)
        if tr.missing:
            ES["missing"][es_path(kind, slug)] = sorted(set(tr.missing))
    ES["ready"] -= set(ES["missing"])
    for hub in ("es/town/", "es/drive/"):
        if not any(p.startswith(hub) and p != hub for p in ES["ready"]):
            ES["ready"].discard(hub)


def alternates_for(path):
    """hreflang pairs for an English page and its Spanish twin (both list the same three), or None without a twin."""
    if not es_ready("es/" + path):
        return None
    return {"en": path, "es": "es/" + path, "x-default": path}


def old_guide_packet(g, d):
    """The facts behind one of the three full-length guides' own words (their English is written by hand above)."""
    lo, hi = g["from"], g["to"]
    n = sum(1 for p in d["places"] if lo <= p["m"] <= hi and not p.get("detour"))
    return {"note": "Miles are California exit numbers counting up from the Mexico border. The English title, description and lede of this guide "
                    "were written by hand from I-5 Buddy's data; the page lists every landmark in the range below.",
            "page": "guide", "topic": g["h1"], "from_mile": lo, "to_mile": hi, "miles": hi - lo, "landmark_count": n}


def es_sources(kind, slug, d, entries):
    """(packet, English text) that the Spanish words of one page are written from. Their hashes are kept in the page's
    content/seo/es JSON (src), and tools/seo/check_pages.py fails when either has changed since."""
    from seo import packets  # here, not at the top: packets.py imports this module
    old = next((g for g in GUIDES if g["slug"] == slug), None) if kind == "guide" else None
    if old:
        en = {"title": old["title"], "meta": old["desc"], "intro": old["lede"].format(miles=old["to"] - old["from"]), "h1": old["h1"], "faq": []}
        return old_guide_packet(old, d), en
    e = entries[(kind, slug)]
    sx = seo_text(e)
    en = {"title": sx["title"], "meta": sx["meta"], "intro": sx["intro"], "faq": sx["faq"]}
    if kind == "guide":
        en["h1"] = e["h1"]
    return packets.packet(e), en


def src_hash(obj):
    return sha(json.dumps(obj, ensure_ascii=False, sort_keys=True))


NEW_GUIDES_DATA = []
TOWNS = []
TOWNS_BY_SLUG = {}


def build_seo_pages(d):
    """Write town/<slug>/, town/index.html and the 12 topic guides, and their Spanish twins. Returns the sitemap paths
    (thin towns are noindex and left out, in both languages)."""
    urls, es_urls = [], []
    for g in NEW_GUIDES_DATA:
        sx = seo_text(g)
        path = f'drive/{g["slug"]}/'
        body, ld = new_guide_body(g, sx, "../../")
        write(path + "index.html", page(path, sx["title"], sx["meta"], body, [("I-5 Buddy", ""), ("Drive guides", "drive/"), (g["h1"], path)], ld,
                                        fine=SEO_FINE, suffix=False, alternates=alternates_for(path)))
        urls.append(path)
        if es_ready("es/" + path):
            sx_es = ES["pages"][("guide", g["slug"])]
            body, ld = es_new_guide_body(g, sx_es, Tr())
            write("es/" + path + "index.html", page("es/" + path, sx_es["title"], sx_es["meta"], body,
                                                    [("I-5 Buddy", ""), ("Guías de viaje", "es/drive/"), (sx_es["h1"], "es/" + path)], ld,
                                                    lang="es", alternates=alternates_for(path), fine=SEO_FINE_ES, suffix=False))
            es_urls.append("es/" + path)
    n_thin = n_es = 0
    for t in TOWNS:
        sx = seo_text(t)
        path = f'town/{t["slug"]}/'
        body, ld = town_body(t, sx, "../../", TOWNS_BY_SLUG)
        write(path + "index.html", page(path, sx["title"], sx["meta"], body, [("I-5 Buddy", ""), ("Towns on I-5", "town/"), (t["name"], path)], ld,
                                        fine=SEO_FINE, noindex=t["thin"], suffix=False, article=False, alternates=alternates_for(path)))
        if t["thin"]:
            n_thin += 1
        else:
            urls.append(path)
        if es_ready("es/" + path):
            sx_es = ES["pages"][("town", t["slug"])]
            body, ld = es_town_body(t, sx_es, Tr())
            write("es/" + path + "index.html", page("es/" + path, sx_es["title"], sx_es["meta"], body,
                                                    [("I-5 Buddy", ""), ("Pueblos y ciudades", "es/town/"), (t["name"], "es/" + path)], ld,
                                                    lang="es", alternates=alternates_for(path), fine=SEO_FINE_ES, noindex=t["thin"], suffix=False, article=False))
            n_es += 1
            if not t["thin"]:
                es_urls.append("es/" + path)
    write("town/index.html", page("town/", "Towns on I-5 in California, south to north",
                                  "Every town along Interstate 5 in California from the Mexico border to Oregon: exits, gas, food, EV charging listed near each, landmarks and rest areas.",
                                  town_hub_body(TOWNS), [("I-5 Buddy", ""), ("Towns on I-5", "town/")], fine=SEO_FINE, alternates=alternates_for("town/")))
    urls.append("town/")
    if es_ready("es/town/"):
        write("es/town/index.html", page("es/town/", "Pueblos y ciudades de la I-5 en California, de sur a norte",
                                         "Los pueblos y ciudades a lo largo de la Interestatal 5 en California, de la frontera con México a Oregon: salidas, gasolina, comida y "
                                         "carga para vehículos eléctricos cerca de cada uno, lugares de interés y áreas de descanso.",
                                         es_town_hub_body(TOWNS), [("I-5 Buddy", ""), ("Pueblos y ciudades", "es/town/")], lang="es",
                                         alternates=alternates_for("town/"), fine=SEO_FINE_ES))
        es_urls.append("es/town/")
    print("towns:", len(TOWNS), "thin/noindex:", n_thin, "guides:", len(NEW_GUIDES_DATA), "Spanish towns:", n_es,
          "Spanish pages left out:", len(ES["missing"]))
    return urls, es_urls


def write(rel, text):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    WRITTEN.add(rel)
    print("wrote", rel, len(text), "bytes")


def prune_es():
    """Remove Spanish pages an earlier run wrote that this run did not (a page whose Spanish is gone or out of date)."""
    base = os.path.join(ROOT, "es")
    for dirpath, dirnames, filenames in os.walk(base, topdown=False):
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, "/")
            if fn == "index.html" and rel not in WRITTEN:
                os.remove(os.path.join(dirpath, fn))
                print("removed", rel)
        if dirpath != base and not os.listdir(dirpath):
            os.rmdir(dirpath)


def main():
    global NEW_GUIDES_DATA, TOWNS, TOWNS_BY_SLUG
    d = load()
    r = spec.build(d, rest_stops, JUNK_REST)
    NEW_GUIDES_DATA, TOWNS = r["guides"], r["towns"]
    TOWNS_BY_SLUG = {t["slug"]: t for t in TOWNS}
    es_load(d)
    urls = []
    seo_urls, es_seo_urls = build_seo_pages(d)
    es_urls = []
    for g in GUIDES:
        body, ld = guide_body(d, g)
        path = f'drive/{g["slug"]}/'
        write(path + "index.html", page(path, g["title"], g["desc"], body,
                                        [("I-5 Buddy", ""), ("Drive guides", "drive/"), (g["h1"], path)], ld, alternates=alternates_for(path)))
        urls.append(path)
        if es_ready("es/" + path):
            sx = ES["pages"][("guide", g["slug"])]
            body, ld = es_guide_body(d, g, sx, Tr())
            write("es/" + path + "index.html", page("es/" + path, sx["title"], sx["meta"], body,
                                                    [("I-5 Buddy", ""), ("Guías de viaje", "es/drive/"), (sx["h1"], "es/" + path)], ld,
                                                    lang="es", alternates=alternates_for(path)))
            es_urls.append("es/" + path)
    write("drive/index.html", page("drive/", "I-5 drive guides for California",
                                   "Mile-by-mile guides to Interstate 5 in California: Los Angeles to San Francisco, "
                                   "Sacramento to Redding, Redding to Oregon, and every rest area.",
                                   hub_body(), [("I-5 Buddy", ""), ("Drive guides", "drive/")], alternates=alternates_for("drive/")))
    if es_ready("es/drive/"):
        write("es/drive/index.html", page("es/drive/", "Guías de viaje de la I-5 en California",
                                          "Guías milla por milla de la Interestatal 5 en California: los pueblos, los lugares de interés, las salidas con "
                                          "servicios y las áreas de descanso, de la frontera con México a Oregon.",
                                          es_hub_body(), [("I-5 Buddy", ""), ("Guías de viaje", "es/drive/")], lang="es", alternates=alternates_for("drive/")))
        es_urls.insert(0, "es/drive/")
    for g in SEASONAL:
        alts = {"en": seasonal_path(g, "en"), "es": seasonal_path(g, "es"), "x-default": seasonal_path(g, "en")}
        for lang in ("en", "es"):
            body, c = seasonal_body(g, lang)
            path = seasonal_path(g, lang)
            if lang == "es" and es_ready("es/drive/"):   # 3.0.8: the Spanish page sits under the Spanish guide list
                crumbs = [("I-5 Buddy", ""), (LANG["es"]["guides"], "es/drive/")]
            else:
                crumbs = [("I-5 Buddy", ""), (LANG[lang]["guides"] + ("" if lang == "en" else " (en inglés)"), "drive/")]
            write(path + "index.html", page(path, c["title"], c["description"], body, crumbs + [(c["h1"], path)],
                                            lang=lang, alternates=alts, fine=LANG[lang]["fine_s"]))
            urls.append(path)
    urls.insert(0, "drive/")
    write("rest-areas/index.html", page("rest-areas/", "I-5 rest areas in California, south to north",
                                        "Every Caltrans rest area on I-5 in California from the Mexico border to Oregon, "
                                        "with mileposts, directions, and the truck stops and travel centers between them.",
                                        rest_body(d), [("I-5 Buddy", ""), ("Rest areas", "rest-areas/")]))
    urls.append("rest-areas/")
    urls += [u for u in seo_urls]
    urls += es_urls + es_seo_urls   # the Spanish twins (3.0.8), after the English pages
    prune_es()
    for path, why in sorted(ES["missing"].items()):
        print("Spanish page left out:", path, "(no fresh Spanish for", ", ".join(why[:4]) + (" ..." if len(why) > 4 else "") + ")")
    # sitemap: the guide lines live between two markers
    sm_path = os.path.join(ROOT, "sitemap.xml")
    sm = open(sm_path, encoding="utf-8").read()
    lines = "".join(f"  <url><loc>{SITE}/{u}</loc><lastmod>{TODAY}</lastmod></url>\n" for u in urls)
    block = f"  <!-- guides (tools/guides.py) -->\n{lines}  <!-- /guides -->\n"
    if "<!-- guides" in sm:
        sm = re.sub(r"  <!-- guides.*?<!-- /guides -->\n", block, sm, flags=re.S)
    else:
        sm = sm.replace("</urlset>", block + "</urlset>")
    with open(sm_path, "w", encoding="utf-8") as f:
        f.write(sm)
    print("sitemap:", len(urls), "guide urls")


if __name__ == "__main__":
    main()
