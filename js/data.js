// Read-only road data (window.I5DATA from data/i5.js) plus helpers about the road.
// "m" everywhere = corridor mile: miles from the Mexico border along I-5 (0 to MAX_M).
// The app covers the states in D.scope (California only since 2026-11-11: MAX_M is about 797, the Oregon line);
// the code still handles more states if tools/build.py is told to include them.
export const D = window.I5DATA;
export const MAX_M = D.states[D.states.length - 1].to;
export const SCOPE = D.scope || D.states.map(s => s.id);
/** What lies past each end of the covered road: ENDS.N.short = "Oregon", ENDS.N.long = "the Oregon line". */
export const ENDS = D.ends || { S: { short: "Mexico", long: "the Mexico border" }, N: { short: "Canada", long: "the Canadian border" } };
export const PLACES = [...D.places].sort((a, b) => a.m - b.m);
export const ZONES = D.zones;
export const TRIVIA = D.trivia;
export const STATES = D.states;
export const DESTS = D.dests;
export const EXITS = D.exits;          // [m, st, ref, destinations]
export const SERVICES = D.services;    // [{m, st, ref, fuel[], fuelN, ev[], evN, food[], foodN, sleep[], sleepN}]
export const REST = D.rest;            // [{m, name, side, kind, toilets}]
export const CAMS = D.cams;            // [{m, name, near, img, by, d?}]
export const DISTRICTS = D.districts;  // Caltrans districts [{d, from, to}]
export const ELEV = D.elev;            // feet at each whole corridor mile
export const OUTLINE = D.outline;      // [{st, pts: [[lat, lon], ...]}]
export const ROUTE = D.route;          // [[m, lat, lon], ...]

export const CATS = { farm: "Orchards & farms", hist: "History", nature: "Land & water", town: "Towns", stop: "Good stops", odd: "Oddities" };
export const CAT_ICON = { farm: "🌱", hist: "🏛", nature: "⛰", town: "🏘", stop: "☕", odd: "✨" };

// Regions for the passport. They follow the road, not county lines. Miles count from the start of each
// state's own exit numbers (null = to the end of that state); only states in the data are used.
const REGION_LIST = [
  ["sd", "San Diego & Orange County", "CA", 0, 130],
  ["la", "Los Angeles & the Grapevine", "CA", 130, 215],
  ["ws", "The Westside", "CA", 215, 460],
  ["dc", "Delta & Capital", "CA", 460, 560],
  ["sv", "Sacramento Valley", "CA", 560, 665],
  ["sh", "Shasta Country", "CA", 665, null],
  ["rv", "Siskiyous & Rogue Valley", "OR", 0, 100],
  ["um", "Umpqua & the Calapooyas", "OR", 100, 200],
  ["wv", "Willamette Valley", "OR", 200, null],
  ["sw", "Southwest Washington", "WA", 0, 100],
  ["ps", "Puget Sound", "WA", 100, 190],
  ["ns", "North Sound & Skagit", "WA", 190, null],
];
export const REGIONS = REGION_LIST.filter(r => STATES.some(s => s.id === r[2])).map(([id, name, st, a, b]) => {
  const s = STATES.find(x => x.id === st);
  return { id, name, st, from: s.from + a, to: b == null ? s.to : Math.min(s.from + b, s.to) };
});
REGIONS[REGIONS.length - 1].to = MAX_M + 0.01;  // the last region runs to the very end of the road

const byId = new Map(PLACES.map(p => [p.id, p]));
export const placeById = id => byId.get(id);

export function stateAt(m) {
  return STATES.find(s => m < s.to) || STATES[STATES.length - 1];
}
/** {st, mi} where mi is the mile in that state's own exit numbering. */
export function localMile(m) {
  const s = stateAt(m);
  return { st: s.id, mi: Math.max(0, m - s.from) };
}
export function regionAt(m) {
  return REGIONS.find(r => m >= r.from && m < r.to) || REGIONS[REGIONS.length - 1];
}
export function zoneAt(m) {
  return ZONES.find(z => m >= z.from && m < z.to) || null;
}
export function seasonOf(date = new Date()) {
  const mo = date.getMonth(); // 0-11
  return mo <= 1 || mo === 11 ? "winter" : mo <= 4 ? "spring" : mo <= 7 ? "summer" : "fall";
}
/** Signed miles from position m to x in the direction of travel (positive = still ahead). */
export function aheadOf(m, dir, x) { return dir === "N" ? x - m : m - x; }

/** "left" | "right" | "" for a place, given the direction of travel. side: 1 = right when northbound. */
export function sideWord(p, dir) {
  if (!p || !p.side) return "";
  return (dir === "N") === (p.side === 1) ? "right" : "left";
}
export function elevAt(m) {
  if (!ELEV || !ELEV.length) return null;
  const i = Math.max(0, Math.min(ELEV.length - 1, Math.floor(m)));
  const j = Math.min(ELEV.length - 1, i + 1), t = m - i;
  return Math.round(ELEV[i] + (ELEV[j] - ELEV[i]) * Math.max(0, Math.min(1, t)));
}
/** Highest point within `span` miles ahead, if it is a real climb. */
export function summitAhead(m, dir, span = 40) {
  if (!ELEV || !ELEV.length) return null;
  let best = null;
  for (let k = 1; k <= span; k++) {
    const x = Math.round(dir === "N" ? m + k : m - k);
    if (x < 0 || x >= ELEV.length) break;
    if (!best || ELEV[x] > best.ft) best = { m: x, ft: ELEV[x] };
  }
  const here = elevAt(m);
  return best && best.ft - here > 600 ? best : null;
}
export function nearestExit(m) {
  let best = null;
  for (const e of EXITS) if (!best || Math.abs(e[0] - m) < Math.abs(best[0] - m)) best = e;
  return best;
}
/** Next exits ahead that have a given service: kind = "fuel" | "ev" | "food" | "sleep". */
export function servicesAhead(m, dir, kind, n = 3, max = 120) {
  const out = [];
  const list = dir === "N" ? SERVICES : [...SERVICES].reverse();
  for (const s of list) {
    const d = aheadOf(m, dir, s.m);
    if (d < 0.3 || d > max) continue;
    if (s[kind + "N"] > 0) out.push({ ...s, d });
    if (out.length >= n) break;
  }
  return out;
}
/** Rest areas that serve your direction of travel (side 1 = northbound side). */
export function restAhead(m, dir, n = 2, max = 150) {
  const out = [];
  const list = dir === "N" ? REST : [...REST].reverse();
  for (const r of list) {
    const d = aheadOf(m, dir, r.m);
    if (d < 0.3 || d > max) continue;
    const serves = !r.side || (dir === "N" ? r.side === 1 : r.side === -1) || /both|NB.*SB|north.*south/i.test(r.name);
    if (!serves || r.kind !== "rest_area") continue;
    out.push({ ...r, d });
    if (out.length >= n) break;
  }
  return out;
}
export function camsAhead(m, dir, n = 3, max = 60) {
  const out = [];
  const list = dir === "N" ? CAMS : [...CAMS].reverse();
  for (const c of list) {
    const d = aheadOf(m, dir, c.m);
    if (d < -0.2 || d > max) continue;
    out.push({ ...c, d });
    if (out.length >= n) break;
  }
  return out;
}
/** "Exit 309" inside California, "OR exit 55" elsewhere (states restart numbering). */
export function exitName(st, ref) {
  return st === "CA" ? `Exit ${ref}` : `${st} exit ${ref}`;
}
export function fmtMiles(d) {
  if (d < 0.3) return "now";
  if (d < 10) return d.toFixed(1);
  return String(Math.round(d));
}
export function fmtDuration(hours) {
  if (!isFinite(hours) || hours <= 0) return "";
  const h = Math.floor(hours), min = Math.round((hours - h) * 60);
  return h ? `${h} h ${String(min).padStart(2, "0")} min` : `${min} min`;
}
