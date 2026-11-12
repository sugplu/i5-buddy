#!/usr/bin/env python3
"""Build the I-5 corridor line (Mexico -> Canada) from OpenStreetMap data in tools/osm/.

"Corridor mile" (m) = miles from the Mexico border along northbound I-5, calibrated so that inside each
state it matches that state's exit numbers (CA exits count from Mexico, OR exits from the California line,
WA exits from the Columbia River). So m = CA exit number in California, 797.x + OR exit in Oregon, and
797.x + 308.x + WA exit in Washington.

Outputs:
  tools/route-full.json   {"states": [...], "line": [[m, lat, lon], ...]}   full resolution
  tools/exits.json        [{"st","ref","n","m","lat","lon","dest"}]

Run: python3 tools/route.py
"""
import heapq, json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
OSM = os.path.join(HERE, "osm")


def hv(a, b):
    R = 3958.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def chain_ordered(st):
    """CA and OR relations list their ways in order; join them end to end."""
    r = json.load(open(os.path.join(OSM, f"rel-{st}.json")))["elements"][0]
    ways = [m for m in r["members"] if m["type"] == "way" and m.get("geometry")]
    chain = [(g["lat"], g["lon"]) for g in ways[0]["geometry"]]
    for w in ways[1:]:
        g = [(p["lat"], p["lon"]) for p in w["geometry"]]
        if hv(chain[-1], g[-1]) < hv(chain[-1], g[0]):
            g = g[::-1]
        chain += g[1:] if hv(chain[-1], g[0]) < 1e-6 else g
    return chain


def chain_shortest(st, start, goal_fn):
    """WA's relation is out of order with express lanes mixed in; take the shortest path through it."""
    r = json.load(open(os.path.join(OSM, f"rel-{st}.json")))["elements"][0]
    ways = [m for m in r["members"] if m["type"] == "way" and m.get("geometry")]
    K = lambda p: (round(p[0], 6), round(p[1], 6))
    adj, ends = {}, []
    for w in ways:
        g = [K((p["lat"], p["lon"])) for p in w["geometry"]]
        for a, b in zip(g, g[1:]):
            d = hv(a, b)
            adj.setdefault(a, []).append((b, d))
            adj.setdefault(b, []).append((a, d))
        ends += [g[0], g[-1]]
    ends = list(set(ends))
    for i, a in enumerate(ends):
        for b in ends[i + 1:]:
            d = hv(a, b)
            if 0 < d < 0.3:
                adj[a].append((b, d * 3))
                adj[b].append((a, d * 3))
    s = min(adj, key=lambda p: hv(p, start))
    goal = goal_fn(adj)
    dist, prev, pq = {s: 0}, {}, [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == goal:
            break
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v], prev[v] = nd, u
                heapq.heappush(pq, (nd, v))
    path = [goal]
    while path[-1] != s:
        path.append(prev[path[-1]])
    return path[::-1]


def cumulative(chain):
    out, acc = [0.0], 0.0
    for a, b in zip(chain, chain[1:]):
        acc += hv(a, b)
        out.append(acc)
    return out


class Projector:
    """Nearest point on a polyline, with a coarse grid index."""

    def __init__(self, pts, vals):
        self.pts, self.vals = pts, vals
        self.grid = {}
        for i in range(len(pts) - 1):
            for p in (pts[i], pts[i + 1]):
                self.grid.setdefault((int(p[0] * 10), int(p[1] * 10)), set()).add(i)

    def project(self, lat, lon):
        kx, ky = 69.17 * math.cos(math.radians(lat)), 69.0
        best = None
        ci, cj = int(lat * 10), int(lon * 10)
        for r in (1, 3, 8, 30):
            cand = set()
            for di in range(-r, r + 1):
                for dj in range(-r, r + 1):
                    cand |= self.grid.get((ci + di, cj + dj), set())
            if cand:
                break
        for i in cand:
            (a0, o0), (a1, o1) = self.pts[i], self.pts[i + 1]
            ax, ay = (o0 - lon) * kx, (a0 - lat) * ky
            dx, dy = (o1 - o0) * kx, (a1 - a0) * ky
            L = dx * dx + dy * dy or 1e-12
            t = max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
            px, py = ax + t * dx, ay + t * dy
            d = math.hypot(px, py)
            if best is None or d < best[0]:
                # side: cross product of travel direction (northbound) with vector to the point
                cross = dx * (-py) - dy * (-px)
                best = (d, i, t, -1 if cross > 0 else 1)
        if best is None:  # nowhere near I-5
            return {"val": None, "dist": 1e9, "side": 0, "i": None}
        d, i, t, side = best
        val = self.vals[i] + t * (self.vals[i + 1] - self.vals[i])
        return {"val": val, "dist": d, "side": side, "i": i}


def load_exits(st, chain, proj):
    out = {}
    for f in (f"exits-{st}.json", f"exits-{st}s.json"):
        p = os.path.join(OSM, f)
        if not os.path.exists(p):
            continue
        els = json.load(open(p))["elements"]
        links = {}
        for w in els:
            if w["type"] == "way":
                links.setdefault(w["nodes"][0], []).append(w.get("tags", {}))
        for n in els:
            if n["type"] != "node":
                continue
            ref = (n.get("tags", {}).get("ref") or "").strip()
            m = re.match(r"^(\d+)([A-Da-d]?)$", ref.split(";")[0].strip())
            if not m:
                continue
            num = int(m.group(1))
            dests = []
            t = n.get("tags", {})
            if t.get("exit_to"):
                dests.append(t["exit_to"])
            for lt in links.get(n["id"], []):
                for k in ("destination:ref", "destination:street", "destination"):
                    if lt.get(k):
                        dests.append(lt[k].replace(";", ", "))
            pr = proj.project(n["lat"], n["lon"])
            if pr["dist"] > 0.6:
                continue  # junction belongs to another freeway's I-5 overlap or a mismatch
            key = ref.upper()
            e = out.setdefault(key, {"st": st.upper(), "ref": key, "n": num, "raw": [], "lat": n["lat"], "lon": n["lon"], "dest": []})
            e["raw"].append(pr["val"])
            for d in dests:
                if d not in e["dest"]:
                    e["dest"].append(d)
    exits = []
    for e in out.values():
        e["raw"] = sum(e["raw"]) / len(e["raw"])
        exits.append(e)
    return sorted(exits, key=lambda e: e["raw"])


def calibrate(exits, total_raw):
    """Monotonic piecewise-linear map raw-distance -> exit-number mile, using the longest consistent run."""
    pts = sorted((e["raw"], e["n"]) for e in exits)
    # longest increasing subsequence on n (keeps anchors whose order agrees with geometry)
    n = len(pts)
    best, prev = [1] * n, [-1] * n
    for i in range(n):
        for j in range(i):
            if pts[j][1] < pts[i][1] and pts[j][0] < pts[i][0] and abs((pts[i][1] - pts[j][1]) - (pts[i][0] - pts[j][0])) < 3 + 0.08 * (pts[i][0] - pts[j][0]) and best[j] + 1 > best[i]:
                best[i], prev[i] = best[j] + 1, j
    i = max(range(n), key=lambda k: best[k])
    keep = []
    while i != -1:
        keep.append(pts[i])
        i = prev[i]
    keep = keep[::-1]
    # ends: slope 1 from the first/last anchor
    a = [(0.0, keep[0][1] - keep[0][0])] if keep[0][0] > 0 else []
    z = [(total_raw, keep[-1][1] + (total_raw - keep[-1][0]))]
    anchors = a + keep + z
    if anchors[0][1] < 0:
        anchors[0] = (0.0, 0.0)

    def f(raw):
        for (r0, m0), (r1, m1) in zip(anchors, anchors[1:]):
            if raw <= r1:
                t = 0 if r1 == r0 else (raw - r0) / (r1 - r0)
                return m0 + t * (m1 - m0)
        return anchors[-1][1]

    return f, len(keep), len(pts)


def main():
    chains = {
        "ca": chain_ordered("ca"),
        "or": chain_ordered("or"),
        "wa": chain_shortest("wa", (45.6180681, -122.6750744), lambda adj: max(adj, key=lambda p: p[0])),
    }
    names = {"ca": "California", "or": "Oregon", "wa": "Washington"}
    line, states, all_exits, offset = [], [], [], 0.0
    for st in ("ca", "or", "wa"):
        chain = chains[st]
        raw = cumulative(chain)
        proj = Projector(chain, raw)
        exits = load_exits(st, chain, proj)
        f, used, total = calibrate(exits, raw[-1])
        local = [f(r) for r in raw]
        # force strictly increasing
        for k in range(1, len(local)):
            if local[k] < local[k - 1]:
                local[k] = local[k - 1]
        end_local = local[-1]
        start_m = offset
        for (lat, lon), lm in zip(chain, local):
            m = offset + lm
            if line and abs(line[-1][1] - lat) < 1e-7 and abs(line[-1][2] - lon) < 1e-7:
                continue
            line.append([round(m, 3), round(lat, 6), round(lon, 6)])
        for e in exits:
            e["m"] = round(offset + f(e["raw"]), 2)
            e["local"] = round(f(e["raw"]), 2)
            del e["raw"]
            all_exits.append(e)
        states.append({"id": st.upper(), "name": names[st], "from": round(start_m, 3), "to": round(offset + end_local, 3), "exitMax": max(e["n"] for e in exits)})
        print(f"{st}: {len(chain)} pts, {raw[-1]:.1f} geo mi, local end {end_local:.1f}, exits {len(exits)} ({used}/{total} used as anchors)")
        offset += end_local
    json.dump({"states": states, "line": line}, open(os.path.join(HERE, "route-full.json"), "w"), separators=(",", ":"))
    json.dump(all_exits, open(os.path.join(HERE, "exits.json"), "w"), ensure_ascii=False, indent=0)
    print("states", states)
    print("total corridor miles", round(offset, 1), "line pts", len(line), "exits", len(all_exits))


if __name__ == "__main__":
    main()
