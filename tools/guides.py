#!/usr/bin/env python3
"""I-5 Buddy: the drive guides and the rest-area page, as plain HTML that search engines can read (3.0.2).

    python3 tools/guides.py            writes drive/<slug>/index.html, drive/index.html, rest-areas/index.html
                                       and the guide lines of sitemap.xml

Everything on these pages comes from data/i5.js (tools/build.py): the same fact-checked landmark texts, zones,
exits, rest areas and elevations the app speaks, so a page never says something the app does not. Mileposts are
California's exit numbers (they count up from the Mexico border). Each page ends with the way to get the app.
Run it after build.py whenever the content changes, and commit the output.
"""
import datetime
import html
import json
import os
import re
from urllib.parse import urlparse

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
        "lede": "From Redding (exit 680) to the Oregon line is about {miles} miles of I-5 and the steepest, most scenic part "
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
           "app_p": "I-5 Buddy is a free talking guide to I-5 in California. It follows you by GPS and tells you about each of these "
                    "places a mile or two before you reach them, which side to look, and the story behind it. No account, no ads.",
           "app_a": "Get the free iPhone app", "app_b": "Open it in your browser",
           "fine": 'Mileposts are California\'s exit numbers, which count up from the Mexico border. Every landmark lists the '
                   'source it was checked against. Made by <a href="https://dominares.org/">Dominares</a> in San Diego. Not affiliated with Caltrans or the CHP. Questions or corrections: <a href="mailto:support@dominares.org">support@dominares.org</a>.',
           "fine_s": 'Mileposts are California\'s exit numbers, which count up from the Mexico border. Stops come from I-5 Buddy\'s own '
                     'data; dates and rules link to the official page they come from. Made by <a href="https://dominares.org/">Dominares</a> '
                     'in San Diego. Not affiliated with Caltrans or the CHP. Questions or corrections: <a href="mailto:support@dominares.org">support@dominares.org</a>.',
           "sources": "Sources", "other": "Leer en español", "more": "More I-5 guides"},
    "es": {"html": "es", "ld": "es-US", "locale": "es_US", "home": "I-5 Buddy", "guides": "Guías de viaje",
           "app_h": "Escúchela mientras conduce",
           "app_p": "I-5 Buddy es una guía parlante y gratuita de la I-5 en California. Lo sigue por GPS y le cuenta cada uno de estos "
                    "lugares una o dos millas antes de llegar, de qué lado mirar y la historia detrás. Sin cuenta y sin anuncios.",
           "app_a": "Obtener la app gratis para iPhone", "app_b": "Abrir en el navegador",
           "fine": 'Los marcadores de milla son los números de salida de California, que aumentan desde la frontera con México. Hecho por <a href="https://dominares.org/">Dominares</a> '
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
    parts = re.findall(r"[^.!?]+[.!?]+[\"')\]]*\s*|[^.!?]+$", text)
    return "".join(parts[:n]).strip()


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
.fine{color:var(--muted);font-size:.85rem;margin-top:24px}
"""


def page(path, title, desc, body, crumbs, ld_extra=None, lang="en", alternates=None, fine=None):
    L = LANG[lang]
    url = f"{SITE}/{path}"
    depth = path.count("/")
    up = "../" * depth
    ld = [
        {"@context": "https://schema.org", "@type": "Article", "headline": title, "description": desc, "url": url,
         "dateModified": TODAY, "inLanguage": L["ld"],
         "author": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"},
         "publisher": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"},
         "isPartOf": {"@type": "WebSite", "name": "I-5 Buddy", "url": SITE + "/"},
         "image": SITE + "/icons/og-1200x630.png"},
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
<title>{E(title)} · I-5 Buddy</title>
<meta name="description" content="{E(desc)}">
<meta name="theme-color" content="#0b6e3f">
<meta name="author" content="Dominares">
<link rel="canonical" href="{url}">
{alt_html}<meta property="og:type" content="article">
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
        '<li><a href="../../rest-areas/">Every I-5 rest area in California</a></li>'
        '<li><a href="../../grapevine/">Is the Grapevine open? (live)</a></li></ul>')
    ld = [{"@context": "https://schema.org", "@type": "ItemList", "name": g["h1"], "numberOfItems": len(places),
           "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": p["name"],
                                "url": f'{SITE}/drive/{g["slug"]}/#{p["id"]}'} for i, p in enumerate(places)]}]
    return "\n".join(out), ld


ES_TITLES = {"los-angeles-to-san-francisco": "De Los Ángeles a San Francisco por la I-5",
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
        href = m.group(2)
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
    out.append(f'  <h2>{L["more"]}</h2><ul class="more">' + "".join(
        f'<li><a href="{up}drive/{x["slug"]}/">{E(ES_TITLES.get(x["slug"], x["h1"]) if lang == "es" else x["h1"])}</a></li>' for x in GUIDES) +
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
        f'<li><a href="../drive/{x["slug"]}/">{E(x["h1"])}</a></li>' for x in GUIDES) + '</ul>')
    return "\n".join(out)


def hub_body():
    out = ['  <h1>I-5 drive guides for California</h1>',
           '  <p class="lede">What you pass on Interstate 5, mile by mile: the landmarks, towns, farms and stories, '
           'with exits, which side to look, and the rest areas on the way.</p>', '  <ul class="more">']
    for g in SEASONAL:
        out.append(f'    <li><a href="{g["slug"]}/">{E(g["hub"]["en"])}</a> · <a href="../es/drive/{g["slug"]}/" hreflang="es" lang="es">en español</a></li>')
    for g in GUIDES:
        out.append(f'    <li><a href="{g["slug"]}/">{E(g["h1"])}</a><br><small>{E(g["desc"])}</small></li>')
    out.append('    <li><a href="../rest-areas/">I-5 rest areas in California</a></li>')
    out.append('    <li><a href="../grapevine/">Is the Grapevine open? Live I-5 pass status</a></li>')
    out.append('  </ul>')
    return "\n".join(out)


def write(rel, text):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote", rel, len(text), "bytes")


def main():
    d = load()
    urls = []
    for g in GUIDES:
        body, ld = guide_body(d, g)
        path = f'drive/{g["slug"]}/'
        write(path + "index.html", page(path, g["title"], g["desc"], body,
                                        [("I-5 Buddy", ""), ("Drive guides", "drive/"), (g["h1"], path)], ld))
        urls.append(path)
    write("drive/index.html", page("drive/", "I-5 drive guides for California",
                                   "Mile-by-mile guides to Interstate 5 in California: Los Angeles to San Francisco, "
                                   "Sacramento to Redding, Redding to Oregon, and every rest area.",
                                   hub_body(), [("I-5 Buddy", ""), ("Drive guides", "drive/")]))
    for g in SEASONAL:
        alts = {"en": seasonal_path(g, "en"), "es": seasonal_path(g, "es"), "x-default": seasonal_path(g, "en")}
        for lang in ("en", "es"):
            body, c = seasonal_body(g, lang)
            path = seasonal_path(g, lang)
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
