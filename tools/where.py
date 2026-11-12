#!/usr/bin/env python3
"""Where is a point relative to I-5?

  python3 tools/where.py LAT LON [LAT LON ...]

Prints the corridor mile, the state + exit-number mile, distance from the freeway, and which side it is on
(RIGHT/LEFT for a driver heading NORTH; flip it for southbound). Uses tools/route-full.json (run route.py first).
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from route import Projector  # noqa: E402

D = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "route-full.json")))
line = D["line"]
P = Projector([(p[1], p[2]) for p in line], [p[0] for p in line])


def where(lat, lon):
    r = P.project(lat, lon)
    m = r["val"]
    st = next(s for s in D["states"] if m <= s["to"] + 1e-6 or s is D["states"][-1])
    return {"m": round(m, 1), "state": st["id"], "exit_mile": round(m - st["from"], 1), "dist_mi": round(r["dist"], 2),
            "side_nb": "RIGHT" if r["side"] == 1 else "LEFT"}


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 2 or len(a) % 2:
        sys.exit(__doc__)
    for i in range(0, len(a), 2):
        w = where(float(a[i]), float(a[i + 1]))
        print(f"{a[i]},{a[i+1]} -> corridor mile {w['m']} | {w['state']} exit-mile {w['exit_mile']} | {w['dist_mi']} mi from I-5 | {w['side_nb']} side when driving north ({'LEFT' if w['side_nb']=='RIGHT' else 'RIGHT'} southbound)")
