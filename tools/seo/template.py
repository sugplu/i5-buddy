"""Template text for a page whose generated title, meta, intro or FAQ item did not pass the grounding check.
Built only from the same facts as the page (tools/seo/spec.py), so it is always supported."""


def _clip(s, n):
    s = " ".join(s.split())
    if len(s) <= n:
        return s
    s = s[: n - 1].rsplit(" ", 1)[0].rstrip(",;:- ")
    return s if s.endswith((".", "!", "?")) else s + "."


def _ex_word(e):
    return f"exit {e['anchor']['ex']}"


def town_seo(t):
    a = t["anchor"]
    title = _clip(f"{t['name']}, California on I-5: exits, services and stops", 60)
    n_fuel = sum(1 for s in t["services"] if s["fuelN"])
    parts = [f"{t['name']} is near exit {a['ex']} on I-5 in California (mile {t['m']:.0f} from the Mexico border)."]
    if n_fuel:
        parts.append(f"{n_fuel} nearby exit{'s' if n_fuel != 1 else ''} with gas listed, plus food and lodging where the data has them.")
    parts.append("Landmarks and the nearest rest areas too.")
    meta = _clip(" ".join(parts), 155)
    intro = (f"{t['name']} sits at about mile {t['m']:.0f} of I-5 in California, near exit {a['ex']}. "
             f"{a['text']} Below are the exits, services, landmarks and nearest rest areas around it.")
    return {"title": title, "meta": meta, "intro": intro, "faq": []}


def guide_seo(g):
    title = _clip(g["seed"], 60)
    lo, hi = g["from"], g["to"]
    meta = _clip(f"{g['h1']}: the exits, stops, rest areas and landmarks, from I-5 Buddy's own data, with mileposts as California exit numbers.", 155)
    intro = (f"{g['h1']}. Everything on this page comes from I-5 Buddy's own data: California exit numbers "
             f"(which count up from the Mexico border), the stops listed at each exit, the rest areas and the landmarks you pass.")
    return {"title": title, "meta": meta, "intro": intro, "faq": []}
