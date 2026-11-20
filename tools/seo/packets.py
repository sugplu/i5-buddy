#!/usr/bin/env python3
"""Build the writer packets (one JSON per page) from data/i5.js only.

    python3 tools/seo/packets.py OUTDIR     writes OUTDIR/<kind>-<slug>.json for every town and guide

A packet holds only facts the page itself shows (tools/seo/spec.py); the writer may use nothing else.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import guides  # noqa: E402
from seo import spec  # noqa: E402


def _svc(s):
    o = {"exit": s["ref"], "exit_name": s["name"], "mile": s["m"]}
    if s["fuelN"]:
        o["gas_brands"] = s["fuel"][:5]
        o["gas_stations"] = s["fuelN"]
    if s["evN"]:
        o["ev_charger_networks"] = s["ev"]
    if s["foodN"]:
        o["food_examples"] = s["food"][:5]
        o["food_places"] = s["foodN"]
    if s["sleepN"]:
        o["lodging_examples"] = s["sleep"][:4]
        o["lodging_places"] = s["sleepN"]
    return o


def _rest(r):
    return None if not r else {"name": r["name"], "mile": r["m"], "miles_from_here": r["miles"], "direction": r["dirword"]}


def _pl(p):
    return {"name": p["name"], "exit": p["ex"], "mile": p["m"], "side_going_north": {1: "right", -1: "left"}.get(p["side"], "not stated"), "fact": p["text"]}


def packet(e):
    base = {"note": "Miles are California exit numbers counting up from the Mexico border. Data from I-5 Buddy (landmark texts checked against cited sources; "
                    "gas, EV, food and lodging from OpenStreetMap, as mapped, not live)."}
    if e["kind"] == "town":
        a = e["anchor"]
        return {**base, "page": "town", "town": e["name"], "main_landmark": {"name": a["name"], "exit": a["ex"], "mile": a["m"], "fact": a["text"]},
                "area": e["zone"] and {"name": e["zone"]["label"], "description": spec.first_sentences(e["zone"]["text"], 2)},
                "exits_nearby": [{"exit": x["ref"], "name": x["name"]} for x in e["exits"]],
                "services_at_exits": [_svc(s) for s in e["services"]],
                "other_landmarks_nearby": [_pl(p) for p in e["places"][:10]],
                "nearest_rest_area_south_of_town": _rest(e["rest_south"]), "nearest_rest_area_north_of_town": _rest(e["rest_north"]),
                "next_town_south": e["prev"] and e["prev"]["name"], "next_town_north": e["next"] and e["next"]["name"]}
    out = {**base, "page": "guide", "title_seed": e["seed"], "topic": e["h1"], "kind": e["gkind"], "from_mile": e["from"], "to_mile": e["to"]}
    if e.get("zones"):
        out["areas"] = [{"name": z["label"], "miles": f'{z["from"]:.0f}-{z["to"]:.0f}', "description": spec.first_sentences(z["text"], 1),
                         **({"seasons": z["seasons"]} if e["gkind"] == "winter" and z["seasons"] else {})} for z in e["zones"]]
    k = e["gkind"]
    if e.get("places"):
        n = 12 if k == "route" else 14
        if k == "history99":
            out["landmarks_that_mention_highway_99"] = [{"name": p["name"], "exit": p["ex"], "mile": p["m"], "fact": p["text99"]} for p in e["places"]]
        else:
            step = max(1, len(e["places"]) // n)
            out["landmarks_sample"] = [_pl(p) for p in e["places"][::step][:n]]
            out["landmark_count"] = len(e["places"])
    if k == "ev":
        out["exits_with_a_mapped_ev_charger"] = e["exits_with_ev"]
        out["exits_with_any_service_listed"] = e["exits_total"]
        out["charger_networks_named_in_data"] = e["networks"]
        out["longest_stretches_between_mapped_chargers"] = e["gaps"]
        out["example_exits"] = [_svc(s) for s in e["services"][:: max(1, len(e["services"]) // 14)][:14]]
    elif k == "rest_gaps":
        out["rest_areas"] = [{"name": r["name"], "mile": r["m"], "direction": r["dirword"]} for r in e["rests"]]
        out["travel_centers_truck_stops"] = [{"name": r["name"], "mile": r["m"]} for r in e["centers"]]
        out["longest_gaps_between_rest_areas"] = e["longest"]
    else:
        sv = e.get("services") or []
        if len(sv) > 25:
            sv = sorted(sv, key=lambda s: -(s["fuelN"] + s["evN"] * 2))[:25]
            sv.sort(key=lambda s: s["m"])
        out["services_at_exits"] = [_svc(s) for s in sv]
        out["exits_with_gas_in_range"] = sum(1 for s in (e.get("services") or []) if s["fuelN"])
        out["exits_with_ev_in_range"] = sum(1 for s in (e.get("services") or []) if s["evN"])
        if e.get("rests") is not None:
            out["rest_areas"] = [{"name": r["name"], "mile": r["m"], "direction": r["dirword"]} for r in e["rests"]]
        if e.get("centers"):
            out["travel_centers_truck_stops"] = [{"name": r["name"], "mile": r["m"]} for r in e["centers"]]
        out["towns_covered"] = [t["name"] for t in e.get("towns", [])][:15]
    return out


def entries():
    d = guides.load()
    r = spec.build(d, guides.rest_stops, guides.JUNK_REST)
    return r["guides"] + r["towns"]


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    tot = 0
    for e in entries():
        p = packet(e)
        s = json.dumps(p, ensure_ascii=False, indent=1)
        open(os.path.join(out, f'{e["kind"]}-{e["slug"]}.json'), "w", encoding="utf-8").write(s)
        tot += len(s)
        print(e["kind"], e["slug"], len(s))
    print("total chars", tot, "~tokens", tot // 4)


if __name__ == "__main__":
    main()
