#!/usr/bin/env python3
"""I-5 Buddy GPS bank: turn scenario specs into fixtures.

    python3 tools/gps_expand.py            reads tools/fixtures/gps/specs/*.json, writes tools/fixtures/gps/<name>.json
                                           and tools/fixtures/gps/index.json (the list tools/gps-bank.js runs)

A spec (written by claude-power/jobs/i5_gps_traces.py, one file per scenario family) is {"family", "scenarios": [...]}.
A scenario is {"name", "summary", "script": [ops], "expect": [checkpoints]}; see tools/gps-bank.js for the states a
checkpoint can ask about. Ops (time runs forward through them in order; t is seconds from the start):
  start                                   the driver taps Start GPS
  drive  from_mile, to_mile, mph, lateral_mi (number, or [start, end] ramp, or lateral_start_mi + lateral_end_mi; + = east of the road for a northbound car,
         - = west), acc (metres, default 10), every_s (default 5), speed_field (default true), heading "road"|"none",
         events [{at_mile, op: call_start|call_end|deny|allow}]
  hold   secs, at_mile (default: where the last op ended), lateral_mi, jitter_m (default 3), acc, every_s (default 10)
  dropout secs                            no fixes at all
  path   waypoints [[lat, lon], ...], mph, acc, every_s, heading "path"|"none"   straight legs through explicit coordinates
  fix    lat, lon, acc, speed_mph, heading   one fix, then one second
  deny / allow                            the location permission is refused / granted again (fixes are dropped while refused)
  call   secs                             a phone call: speech is paused for secs (use inside events for a call mid-drive)
  restart gap_s, resume "tap"|"auto"|"none"   the page restarts (iOS web view, discarded tab); the phone has no fixes for gap_s;
                                          tap = the driver taps Resume drive, auto = location is allowed so the app resumes by itself, none
A checkpoint is {"after_op": i, "at": "end"|"start"|0..1 (default "end"), "plus_s": 0, "state": {...}, "why": "..."}.
The fixture has the same {name, points:[{t, lat, lon, acc, speed, heading}], expect:[{at_t, state}]} shape plus events.
"""
import glob
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "fixtures", "gps")


def load_route():
    s = open(os.path.join(ROOT, "data", "i5.js"), encoding="utf-8").read()
    return json.loads(s[s.index("{"): s.rindex("}") + 1])["route"]


ROUTE = load_route()
MI_LAT = 69.0


def coord_at(m):
    lo, hi = 0, len(ROUTE) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if ROUTE[mid][0] < m:
            lo = mid + 1
        else:
            hi = mid
    i = max(1, lo)
    m0, a0, o0 = ROUTE[i - 1]
    m1, a1, o1 = ROUTE[i]
    t = 0 if m1 == m0 else max(0, min(1, (m - m0) / (m1 - m0)))
    return a0 + t * (a1 - a0), o0 + t * (o1 - o0)


def bearing_at(m):
    a, o = coord_at(m - 0.05)
    b, p = coord_at(m + 0.05)
    kx = 69.17 * math.cos(math.radians(b))
    return (math.degrees(math.atan2((p - o) * kx, (b - a) * MI_LAT)) + 360) % 360


def offset(lat, lon, brg, lateral_mi):
    """Move lateral_mi to the east (+) of a northbound car, i.e. to the right of the road's northbound bearing."""
    if not lateral_mi:
        return lat, lon
    rad = math.radians(brg + 90)
    kx = 69.17 * math.cos(math.radians(lat))
    return lat + math.cos(rad) * lateral_mi / MI_LAT, lon + math.sin(rad) * lateral_mi / kx


def ll_bearing(a, b):
    kx = 69.17 * math.cos(math.radians(b[0]))
    return (math.degrees(math.atan2((b[1] - a[1]) * kx, (b[0] - a[0]) * MI_LAT)) + 360) % 360


def miles_between(a, b):
    kx = 69.17 * math.cos(math.radians(b[0]))
    return math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * MI_LAT)


def expand(sc):
    pts, ev, marks = [], [], []   # marks[i] = (t_start, t_end) of op i
    t = 0.0
    pos = None                    # last (lat, lon) and mile
    last_mile = None
    seq = 0
    for i, op in enumerate(sc["script"]):
        kind = op["op"]
        t0 = t
        if kind == "start":
            ev.append({"t": round(t, 1), "op": "start"})
        elif kind in ("deny", "allow"):
            ev.append({"t": round(t, 1), "op": kind})
        elif kind == "call":
            ev.append({"t": round(t, 1), "op": "call_start"})
            t += float(op["secs"])
            ev.append({"t": round(t, 1), "op": "call_end"})
        elif kind == "dropout":
            t += float(op["secs"])
        elif kind == "restart":
            ev.append({"t": round(t, 1), "op": "restart", "resume": op.get("resume", "tap"), "gap_s": float(op.get("gap_s", 10))})
            t += float(op.get("gap_s", 10))
        elif kind == "fix":
            p = {"t": round(t, 1), "lat": op["lat"], "lon": op["lon"], "acc": op.get("acc", 10), "speed": round(op.get("speed_mph", 0) / 2.23694, 2)}
            hd = op.get("heading_deg", op.get("heading") if isinstance(op.get("heading"), (int, float)) else None)
            if hd is not None:
                p["heading"] = hd
            pts.append(p)
            pos = (op["lat"], op["lon"])
            t += 1
        elif kind == "drive":
            a, b, mph = float(op["from_mile"]), float(op["to_mile"]), float(op["mph"])
            every = float(op.get("every_s", 5))
            lat_m = op.get("lateral_mi", 0)
            l0, l1 = (lat_m if isinstance(lat_m, list) else [lat_m, lat_m])
            if op.get("lateral_start_mi") is not None or op.get("lateral_end_mi") is not None:
                l0, l1 = op.get("lateral_start_mi", 0), op.get("lateral_end_mi", 0)
            sgn = 1 if b >= a else -1
            total = abs(b - a)
            step = max(mph, 1) / 3600 * every
            n = max(1, int(round(total / step)))
            evs = list(op.get("events", []))
            for k in range(n + 1):
                f = k / n
                m = a + (b - a) * f
                lat, lon = coord_at(m)
                brg = bearing_at(m)
                lat, lon = offset(lat, lon, brg, (l0 or 0) + ((l1 or 0) - (l0 or 0)) * f)
                p = {"t": round(t, 1), "lat": round(lat, 6), "lon": round(lon, 6), "acc": op.get("acc", 10)}
                if op.get("speed_field", True):
                    p["speed"] = round(mph / 2.23694, 2)
                if op.get("heading", "road") == "road":
                    p["heading"] = round(brg if sgn > 0 else (brg + 180) % 360, 1)
                pts.append(p)
                while evs and ((evs[0].get("at_mile") is not None and (m - evs[0]["at_mile"]) * sgn >= 0) or (evs[0].get("at_frac") is not None and f >= evs[0]["at_frac"])):
                    e = evs.pop(0)
                    ev.append({"t": round(t, 1), "op": e["op"]})
                if k < n:
                    t += every
            for e in evs:  # events whose mile was never reached: at the end
                ev.append({"t": round(t, 1), "op": e["op"]})
            pos = (lat, lon)
            last_mile = b
            t += every
        elif kind == "hold":
            if op.get("at_mile") is not None:
                lat, lon = coord_at(float(op["at_mile"]))
                lat, lon = offset(lat, lon, bearing_at(float(op["at_mile"])), op.get("lateral_mi", 0))
            else:
                lat, lon = pos
            every = float(op.get("every_s", 10))
            jit = float(op.get("jitter_m", 3)) / 1609.0
            n = max(1, int(float(op["secs"]) / every))
            for k in range(n):
                s = math.sin(k * 2.1 + seq) * jit
                c = math.cos(k * 1.3 + seq) * jit
                kx = 69.17 * math.cos(math.radians(lat))
                pts.append({"t": round(t, 1), "lat": round(lat + s / MI_LAT, 6), "lon": round(lon + c / kx, 6), "acc": op.get("acc", 10), "speed": 0})
                t += every
            pos = (lat, lon)
            t = t0 + float(op["secs"])
        elif kind == "path":
            wps = op["waypoints"]
            mph = float(op["mph"])
            every = float(op.get("every_s", 5))
            step_mi = mph / 3600 * every
            for j in range(len(wps) - 1):
                a, b = wps[j], wps[j + 1]
                L = miles_between(a, b)
                n = max(1, int(round(L / step_mi)))
                brg = ll_bearing(a, b)
                for k in range(n + (1 if j == len(wps) - 2 else 0)):
                    f = k / n
                    p = {"t": round(t, 1), "lat": round(a[0] + (b[0] - a[0]) * f, 6), "lon": round(a[1] + (b[1] - a[1]) * f, 6), "acc": op.get("acc", 10), "speed": round(mph / 2.23694, 2)}
                    if op.get("heading", "path") == "path":
                        p["heading"] = round(brg, 1)
                    pts.append(p)
                    t += every
            pos = tuple(wps[-1])
        else:
            raise ValueError(f"{sc['name']}: unknown op {kind}")
        marks.append((t0, t))
        seq += 1
    exp = []
    for c in sc.get("expect", []):
        if "at_s" in c:
            at = float(c["at_s"])
        else:
            i = int(c["after_op"])
            if i >= len(marks):
                raise ValueError(f"{sc['name']}: checkpoint after_op {i} but only {len(marks)} ops")
            s, e = marks[i]
            w = c.get("at", "end")
            at = s if w == "start" else e if w == "end" else s + (e - s) * float(w)
            at += float(c.get("plus_s", 0))
        exp.append({"at_t": round(at, 1), "state": c["state"], "why": c.get("why", "")})
    exp.sort(key=lambda x: x["at_t"])
    return pts, ev, exp, t


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for f in sorted(glob.glob(os.path.join(OUT, "specs", "*.json"))):
        spec = json.load(open(f, encoding="utf-8"))
        for sc in spec["scenarios"]:
            pts, ev, exp, end = expand(sc)
            fx = {"name": sc["name"], "family": spec["family"], "summary": sc.get("summary", ""), "end_t": round(end + 5, 1),
                  "points": pts, "events": sorted(ev, key=lambda e: e["t"]), "expect": exp, "script": sc["script"]}
            if sc.get("triage"):
                fx["triage"] = sc["triage"]
            if sc.get("known_bug"):
                fx["known_bug"] = sc["known_bug"]
            if sc.get("known_bug_checkpoints") is not None:
                fx["known_bug_checkpoints"] = sc["known_bug_checkpoints"]
            path = os.path.join(OUT, sc["name"] + ".json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(fx, fh, separators=(",", ":"))
            index.append({"name": sc["name"], "family": spec["family"], "points": len(pts), "checks": len(exp)})
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=1)
    print(f"{len(index)} fixtures in {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
