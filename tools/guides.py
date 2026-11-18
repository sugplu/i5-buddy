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
.fine{color:var(--muted);font-size:.85rem;margin-top:24px}
"""


def page(path, title, desc, body, crumbs, ld_extra=None):
    url = f"{SITE}/{path}"
    depth = path.count("/")
    up = "../" * depth
    ld = [
        {"@context": "https://schema.org", "@type": "Article", "headline": title, "description": desc, "url": url,
         "dateModified": TODAY, "inLanguage": "en-US",
         "author": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"},
         "publisher": {"@type": "Organization", "name": "Dominares", "url": "https://dominares.org/"},
         "isPartOf": {"@type": "WebSite", "name": "I-5 Buddy", "url": SITE + "/"},
         "image": SITE + "/icons/og-1200x630.png"},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + "/" + u} for i, (n, u) in enumerate(crumbs)]},
    ] + (ld_extra or [])
    crumb_html = " › ".join(f'<a href="{up}{u}">{E(n)}</a>' for n, u in crumbs[:-1]) + f" › {E(crumbs[-1][0])}"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{E(title)} · I-5 Buddy</title>
<meta name="description" content="{E(desc)}">
<meta name="theme-color" content="#0b6e3f">
<meta name="author" content="Dominares">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
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
    <b>Hear it as you drive</b>
    <p>I-5 Buddy is a free talking guide to I-5 in California. It follows you by GPS and tells you about each of these
      places a mile or two before you reach them, which side to look, and the story behind it. No account, no ads.</p>
    <a href="{up}get/">Get the free iPhone app</a><a class="alt" href="{up}">Open it in your browser</a>
  </section>
  <p class="fine">Mileposts are California's exit numbers, which count up from the Mexico border. Every landmark lists the
    source it was checked against. Made by <a href="https://dominares.org/">Dominares</a> in San Diego. Not affiliated with
    Caltrans or the CHP. Questions or corrections: <a href="mailto:support@dominares.org">support@dominares.org</a>.</p>
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
