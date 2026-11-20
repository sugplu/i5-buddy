// I-5 Buddy: the "normal GPS". Search for a place (or a stop along I-5), see the route, then get real turn-by-turn
// guidance with spoken prompts, rerouting and an arrival. I-5 Buddy's landmark narration keeps going underneath.
//
//   api.nav = {
//     state()            "idle" | "searching" | "previewing" | "navigating" | "arrived"
//     dest(), route()    the destination {name, address, lat, lon, m?, kind} and the route (see buildRoute) or null
//     search(q)          the instant LOCAL results (from the app's own data) as an array; never touches the network
//     openSearch(q?)     the full-screen "Where to?" sheet
//     preview(dest)      ask the route service for a route and show the preview; resolves the route or null
//     start(), end()     start guidance (turns GPS on if it is off) / end it and go back to the normal app
//     setProvider(p)     {search(q, pos, signal), route(from, to, heading, signal)}: tests and a later native iPhone provider
//     phraseBank()       every unit and every fixed sentence nav can ever speak: {units, sentences, count}
//     simulate({mph, x, sync}), stopSimulate()   drive along the current route with synthetic fixes (tests and demos)
//     statusText()       one line for the app's status line while navigating, else ""
//   }
//
// Events on api.bus: nav:route {route}, nav:start {route, dest}, nav:step {index, step} (the car entered step `index`),
// nav:reroute {route}, nav:arrive {dest}, nav:end {}.
//
// The server (Cloudflare Worker, i5.dominares.org): GET /api/geo/search and GET /api/geo/route (see defaultProvider).
// Privacy: nothing is sent until the person says Continue to the one-time notice (store key nav:consent). The notice, the
// search words and the position all go only to that server; a failure is always quiet and every request times out at 10 s.
//
// Voice: every spoken prompt is built from a fixed grammar (DIST, MAN, "onto", highway, "Take exit", number...) and passed
// to voice.say with `units`, the short fixed phrases whose words, joined by spaces, are the spoken text (a recorded voice
// plays one clip per unit; the browser's own voice just speaks `text`). phraseBank() lists every unit.

const FT = 1 / 5280;
const warn = (...a) => { try { console.warn("[nav]", ...a.map(x => (x && x.message) || x)); } catch {} };
const num = Number.isFinite;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const BASE = new URL("../", import.meta.url);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

let A = null, S = null, settings = null, bus = null, store = null, voice = null, data = null, geo = null, ui = null, native = null;

/* ================================================================ the phrase grammar ================================================================ */
// A prompt is: [distance] + maneuver [+ "onto" + highway] [+ "Take exit" + number [+ letter]] [+ "Then" + next maneuver].
// Units keep their exact text (capitalization and punctuation) forever: a recorded voice is rendered from them.
export const DIST = { "2mi": "In 2 miles,", "1mi": "In 1 mile,", "half": "In half a mile,", "quarter": "In a quarter mile,", "1000ft": "In 1,000 feet,", "500ft": "In 500 feet," };
const DIST_MI = { "2mi": 2, "1mi": 1, "half": 0.5, "quarter": 0.25, "1000ft": 1000 * FT, "500ft": 500 * FT };
const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const MAN = {
  "turn-right": "turn right", "turn-left": "turn left",
  "slight-right": "turn slightly right", "slight-left": "turn slightly left",
  "sharp-right": "make a sharp right", "sharp-left": "make a sharp left",
  "uturn": "make a U-turn", "keep-left": "keep left", "keep-right": "keep right",
  "exit-right": "take the exit on the right", "exit-left": "take the exit on the left",
  "merge": "merge", "straight": "continue straight",
};
const MAN_ALL = [...Object.values(MAN), ...ORD.map(o => `at the roundabout, take the ${o} exit`)];
/** The spoken maneuver (lowercase) for a step, or null when it has no fixed phrase (depart, arrive, a roundabout without a usable exit). */
export function maneuverPhrase(step) {
  if (!step) return null;
  if (step.type === "roundabout") {
    const k = Math.round(Number(step.roundabout_exit));
    return k >= 1 && k <= 6 ? `at the roundabout, take the ${ORD[k - 1]} exit` : null;
  }
  return MAN[step.type] || null;
}
const HWY_I = [5, 8, 10, 15, 40, 80, 105, 110, 205, 210, 215, 238, 280, 380, 405, 505, 580, 605, 680, 710, 780, 805, 880, 980];
const HWY_US = [6, 40, 50, 60, 66, 70, 89, 95, 97, 101, 199, 395];
const HWY_CA_MAX = 330;
/** "I-5." / "U.S. 101." / "Highway 99." from a provider ref like "I-5", "US-101", "CA-99"; null for anything else (so no wrong name is ever spoken). */
export function highwayUnit(ref) {
  const m = /^\s*(I|US|CA|SR)[\s-]*(\d{1,3})\b/i.exec(String(ref == null ? "" : ref));
  if (!m) return null;
  const k = m[1].toUpperCase(), n = +m[2];
  if (k === "I") return HWY_I.includes(n) ? `I-${n}.` : null;
  if (k === "US") return HWY_US.includes(n) ? `U.S. ${n}.` : null;
  return n >= 1 && n <= HWY_CA_MAX ? `Highway ${n}.` : null;
}
/** ["Take exit", "278."] or ["Take exit", "45", "B."] from a provider exit like "278" or "45B"; null otherwise. */
export function exitUnits(exit) {
  const m = /^\s*(\d{1,3})\s*([A-Ha-h])?(?![A-Za-z0-9])/.exec(String(exit == null ? "" : exit));
  if (!m) return null;
  const n = +m[1];
  if (n < 1 || n > 999) return null;
  return m[2] ? ["Take exit", String(n), m[2].toUpperCase() + "."] : ["Take exit", n + "."];
}
const SENT = {
  arrived: "You have arrived.", right: "Your destination is on the right.", left: "Your destination is on the left.",
  reroute: "Rerouting.", ready: "Route ready.",
  offline: "No connection. Keep going, and I'll reroute when the signal is back.", ended: "Navigation ended.",
};
/** {n: "45", letter: "B"} from a provider exit like "45B" (letter null for "278"); null otherwise. */
function exitParts(exit) {
  const m = /^\s*(\d{1,3})\s*([A-Ha-h])?(?![A-Za-z0-9])/.exec(String(exit == null ? "" : exit));
  if (!m) return null;
  const n = +m[1];
  return n >= 1 && n <= 999 ? { n: String(n), letter: m[2] ? m[2].toUpperCase() : null } : null;
}
/** The units of one maneuver prompt, the way a GPS says it. `dist`: a DIST key or null (the final prompt); `then`: the next
    maneuver step to add, or null; `prev`: the step before (a "keep" on the highway you are already on gets no "onto").
      "In 2 miles, take exit 309 onto Highway 41."   "Take exit 45 B."   "In 1 mile, keep left."   "Turn right onto I-5." */
export function promptUnits(step, dist, then, prev) {
  const man = maneuverPhrase(step);
  if (!man) return null;
  const stay = !!step.stay || (!!prev && !!prev.ref && prev.ref === step.ref && /^keep/.test(step.type));
  const hwy = stay ? null : highwayUnit(step.ref);
  const ex = /^exit/.test(step.type) ? exitParts(step.exit) : null;
  const units = [];
  if (dist) units.push(DIST[dist]);
  if (ex) {
    units.push(dist ? "take exit" : "Take exit");
    const tail = ex.letter ? [ex.n, ex.letter] : [ex.n];
    if (hwy) units.push(...tail, "onto", hwy);
    else { tail[tail.length - 1] += "."; units.push(...tail); }
  } else {
    const first = dist ? man : cap(man);
    units.push(hwy ? first : first + ".");           // a period unless "onto" follows
    if (hwy) units.push("onto", hwy);
  }
  const thenMan = then ? maneuverPhrase(then) : null;
  if (thenMan) units.push("Then", thenMan + ".");
  return units;
}
/** Every unit and every fixed sentence: the list a recorded voice is rendered from. */
export function phraseBank() {
  const set = new Set();
  Object.values(DIST).forEach(d => set.add(d));
  for (const m of MAN_ALL) { set.add(m); set.add(m + "."); set.add(cap(m)); set.add(cap(m) + "."); }
  set.add("onto"); set.add("Take exit"); set.add("take exit"); set.add("Then");
  for (const n of HWY_I) set.add(`I-${n}.`);
  for (const n of HWY_US) set.add(`U.S. ${n}.`);
  for (let n = 1; n <= HWY_CA_MAX; n++) set.add(`Highway ${n}.`);
  for (let n = 1; n <= 999; n++) { set.add(String(n)); set.add(n + "."); }
  for (const c of "ABCDEFGH") { set.add(c + "."); set.add(c); }
  const sentences = Object.values(SENT);
  sentences.forEach(s => set.add(s));
  const units = [...set];
  return { units, sentences: [...sentences], count: units.length };
}
let BANK = null;
const bank = () => BANK || (BANK = phraseBank());

/* ================================================================ small formatting helpers ================================================================ */
const fmtClock = ms => { try { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
function fmtDur(sec) {
  if (!num(sec) || sec < 0) return "";
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
/** "Now", "300 ft", "0.4 mi", "12 mi". */
function fmtDist(mi) {
  if (!num(mi)) return "";
  if (mi < 0.012) return "Now";
  if (mi < 0.1) return `${Math.max(50, Math.round(mi / FT / 50) * 50)} ft`;
  if (mi < 0.19) return `${Math.round(mi / FT / 50) * 50} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString()} mi`;
}
const fmtMi = mi => (mi < 10 ? (Math.round(mi * 10) / 10).toString() : Math.round(mi).toLocaleString()) + " mi";

/* ================================================================ the route service ================================================================ */
function apiBase() {
  let host = "";
  try { host = location.hostname; } catch {}
  return host === "i5.dominares.org" ? "" : "https://i5.dominares.org";
}
const FETCH_MS = 10000;
/** GET json with a 10 s timeout; `signal` (the caller's abort) cancels it. Rejects with Error (.words = the server's own words, .aborted, .timeout, .offline). */
async function getJson(url, signal, ms = FETCH_MS) {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, ms);
  const onAbort = () => ac.abort();
  if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener("abort", onAbort, { once: true }); }
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" }, cache: "no-store" });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok || (j && j.error)) {
      const e = new Error(j && j.error ? String(j.error) : "HTTP " + r.status);
      e.http = r.status; e.words = j && typeof j.error === "string" ? j.error : "";
      throw e;
    }
    return j;
  } catch (e) {
    if (e && !e.http) { e.aborted = !!(signal && signal.aborted); e.timeout = timedOut; e.offline = !e.aborted; }
    throw e;
  } finally { clearTimeout(timer); signal && signal.removeEventListener("abort", onAbort); }
}
export const defaultProvider = {
  name: "dominares",
  /** -> {results: [{id, name, address, lat, lon, kind, cat}], attribution} */
  search(q, pos, signal) {
    const p = new URLSearchParams({ q: String(q), limit: "8" });
    if (pos && num(pos.lat) && num(pos.lon)) { p.set("lat", pos.lat.toFixed(3)); p.set("lon", pos.lon.toFixed(3)); }
    return getJson(`${apiBase()}/api/geo/search?${p}`, signal);
  },
  /** from, to: {lat, lon}; heading: degrees or null -> {distance_mi, duration_s, geometry, steps, attribution} */
  route(from, to, heading, signal) {
    const p = new URLSearchParams({ from: `${from.lat.toFixed(5)},${from.lon.toFixed(5)}`, to: `${to.lat.toFixed(5)},${to.lon.toFixed(5)}` });
    if (num(heading)) p.set("heading", String(Math.round(((heading % 360) + 360) % 360)));
    return getJson(`${apiBase()}/api/geo/route?${p}`, signal);
  },
};
let P = defaultProvider;

const str = (v, n = 160) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
/** The server's search answer -> [{id, name, address, lat, lon, kind, cat}] (junk dropped, at most 8). Pure. */
export function cleanResults(j) {
  const list = j && Array.isArray(j.results) ? j.results : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const lat = Number(r.lat), lon = Number(r.lon);
    const name = str(r.name) || str(r.address);
    if (!name || !num(lat) || !num(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ id: str(r.id, 80) || `${lat.toFixed(5)},${lon.toFixed(5)}`, name, address: str(r.address, 200), lat, lon, kind: str(r.kind, 20) || "place", cat: str(r.cat, 60), src: "online" });
    if (out.length >= 8) break;
  }
  return out;
}

/* ================================================================ the route model ================================================================ */
const STEP_TYPES = ["depart", "straight", "turn-left", "turn-right", "slight-left", "slight-right", "sharp-left", "sharp-right", "uturn", "keep-left", "keep-right", "exit-left", "exit-right", "merge", "roundabout", "arrive"];
let routeSeq = 0;
/** The service's route -> the model the engine runs on, or null when it is not a route:
    {id, geometry [[lat,lon]..], cum[] (miles at each point), total (miles by geometry), distance_mi, duration_s, k (display scale), steps[], stepT[] (seconds at each step's start), attribution}
    where each step has start/end (miles along the geometry) besides the service's fields. Pure but for geo.miles. */
export function buildRoute(raw, miles) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.geometry)) return null;
  const geometry = [];
  for (const p of raw.geometry) {
    if (!Array.isArray(p)) continue;
    const lat = Number(p[0]), lon = Number(p[1]);
    if (num(lat) && num(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) geometry.push([lat, lon]);
  }
  if (geometry.length < 2) return null;
  const n = geometry.length, cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + miles(geometry[i - 1][0], geometry[i - 1][1], geometry[i][0], geometry[i][1]);
  const total = cum[n - 1];
  const idx = v => clamp(Math.round(Number(v)), 0, n - 1);
  const steps = [];
  let prev = 0;
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    if (!s || typeof s !== "object") continue;
    const type = STEP_TYPES.includes(s.type) ? s.type : "straight";
    let i0 = num(Number(s.i0)) && s.i0 != null ? idx(s.i0) : prev;
    if (i0 < prev) i0 = prev;
    let i1 = num(Number(s.i1)) && s.i1 != null ? idx(s.i1) : i0;
    if (i1 < i0) i1 = i0;
    if (type === "arrive") { i0 = n - 1; i1 = n - 1; }
    prev = i0;
    steps.push({
      type, text: str(s.text, 200), street: str(s.street, 80) || null, ref: str(s.ref, 30) || null, exit: s.exit != null && s.exit !== "" ? str(String(s.exit), 12) || null : null,
      toward: str(s.toward, 100) || null, roundabout_exit: num(Number(s.roundabout_exit)) && s.roundabout_exit != null ? Math.round(Number(s.roundabout_exit)) : null,
      speed_limit_mph: num(Number(s.speed_limit_mph)) && s.speed_limit_mph != null && Number(s.speed_limit_mph) > 0 ? Math.round(Number(s.speed_limit_mph)) : null,
      side: s.side === "left" || s.side === "right" ? s.side : null, stay: s.stay === true, i0, i1,
      distance_mi: num(Number(s.distance_mi)) && s.distance_mi != null ? Number(s.distance_mi) : null,
      duration_s: num(Number(s.duration_s)) && s.duration_s != null ? Number(s.duration_s) : null,
    });
  }
  if (!steps.length || steps[0].i0 > 0 && steps[0].type !== "depart") steps.unshift({ type: "depart", text: "", street: null, ref: null, exit: null, toward: null, roundabout_exit: null, speed_limit_mph: null, side: null, i0: 0, i1: steps.length ? steps[0].i0 : n - 1, distance_mi: null, duration_s: null });
  steps[0].i0 = 0;
  if (steps[steps.length - 1].type !== "arrive") steps.push({ type: "arrive", text: "", street: null, ref: null, exit: null, toward: null, roundabout_exit: null, speed_limit_mph: null, side: null, i0: n - 1, i1: n - 1, distance_mi: 0, duration_s: 0 });
  for (const s of steps) { s.start = cum[s.i0]; s.end = cum[s.i1]; }
  steps[steps.length - 1].start = total; steps[steps.length - 1].end = total;
  const dist = Number(raw.distance_mi), dur = Number(raw.duration_s);
  const distance_mi = num(dist) && dist > 0 && Math.abs(dist - total) <= Math.max(0.3, total * 0.15) ? dist : total;
  const duration_s = num(dur) && dur > 0 ? dur : total / 35 * 3600;
  // seconds at the start of each step: from the steps' own times when they add up to about the route's time, else by distance
  const have = steps.every(s => s.duration_s != null) && steps.reduce((a, s) => a + s.duration_s, 0);
  const useStepT = have && Math.abs(have - duration_s) <= duration_s * 0.35;
  const stepT = new Float64Array(steps.length);
  if (useStepT) { let t = 0; for (let k = 0; k < steps.length; k++) { stepT[k] = t; t += steps[k].duration_s; } stepT.total = t; }
  return {
    id: "r" + (++routeSeq), geometry, cum, total, distance_mi, duration_s, k: total > 0 ? distance_mi / total : 1, steps,
    stepT: useStepT ? stepT : null, stepTotal: useStepT ? stepT.total : null, attribution: str(raw.attribution, 200) || "© OpenStreetMap contributors · Geoapify",
    // speed limits along the line (the server's [geometry index, mph] where it changes), as miles along the route
    limits: Array.isArray(raw.limits) ? raw.limits.filter(x => Array.isArray(x) && num(Number(x[0])) && num(Number(x[1])) && Number(x[1]) > 0)
      .map(x => ({ at: cum[idx(x[0])], mph: Math.round(Number(x[1])) })).sort((a, b) => a.at - b.at) : null,
  };
}
/** The speed limit where you are: from the route's own list when it has one (it changes mid-step), else the step's. */
function limitAt(r, along, step) {
  const L = r && r.limits;
  if (L && L.length) { let v = null; for (const x of L) { if (x.at <= along + 0.01) v = x.mph; else break; } if (v != null) return v; }
  return step ? step.speed_limit_mph : null;
}
/** Index of the segment [i, i+1] holding `along` miles (binary search over cum). */
function segAt(route, along) {
  const c = route.cum;
  let lo = 0, hi = c.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c[mid] <= along) lo = mid; else hi = mid - 1; }
  return lo;
}
/** [lat, lon] and the bearing (degrees) at `along` miles. */
function pointAt(route, along) {
  const g = route.geometry, c = route.cum;
  along = clamp(along, 0, route.total);
  const i = segAt(route, along), a = g[i], b = g[Math.min(i + 1, g.length - 1)];
  const L = c[Math.min(i + 1, g.length - 1)] - c[i], t = L > 1e-9 ? clamp((along - c[i]) / L, 0, 1) : 0;
  return { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t, bearing: bearing(a, b), seg: i };
}
function bearing(a, b) {
  const kx = Math.cos(a[0] * Math.PI / 180);
  return (Math.atan2((b[1] - a[1]) * kx, b[0] - a[0]) * 180 / Math.PI + 360) % 360;
}
/** Where on the route is the point (lat, lon)? Looks near `hint` (miles along) first, then everywhere; the nearer point wins, with a nudge
    toward going forward. -> {seg, t, along (miles), off (meters from the line)} */
export function snapToRoute(route, lat, lon, hint = null) {
  const g = route.geometry, c = route.cum, n = g.length;
  const kx = 69.17 * Math.cos(lat * Math.PI / 180), ky = 69.0;
  const one = i => {
    const a = g[i], b = g[i + 1];
    const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
    const L = dx * dx + dy * dy;
    const t = L > 1e-12 ? clamp(-(ax * dx + ay * dy) / L, 0, 1) : 0;
    return { i, t, d: Math.hypot(ax + t * dx, ay + t * dy) };
  };
  const scan = (from, to) => { let best = null; for (let i = from; i <= to; i++) { const r = one(i); if (!best || r.d < best.d) best = r; } return best; };
  const mk = r => ({ seg: r.i, t: r.t, along: c[r.i] + r.t * (c[r.i + 1] - c[r.i]), off: r.d * 1609.34 });
  let win = null;
  if (hint != null) win = scan(segAt(route, Math.max(0, hint - 0.15)), Math.min(n - 2, segAt(route, Math.min(route.total, hint + 0.8)) + 1));
  if (win && win.d * 1609.34 <= 70) return mk(win);
  // not near where we were: look everywhere, preferring what is close to the last place (a road that doubles back)
  let best = null, bestScore = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const r = one(i);
    const along = c[i] + r.t * (c[i + 1] - c[i]);
    let score = r.d * 1609.34;
    if (hint != null) score += 5 * Math.abs(along - hint) + (along < hint - 0.05 ? 30 : 0);
    if (score < bestScore) { bestScore = score; best = r; }
  }
  if (win && (!best || win.d <= best.d + 0.02)) return mk(win);
  return mk(best || scan(0, n - 2));
}
/** Seconds left from `along` miles. By the steps' own times when the service gave them, else the route's time scaled by distance. */
function secondsLeft(route, along, curIdx) {
  if (route.stepT) {
    const s = route.steps[curIdx], next = route.steps[curIdx + 1];
    const t0 = route.stepT[curIdx], t1 = next ? route.stepT[curIdx + 1] : route.stepTotal;
    const L = (next ? next.start : route.total) - s.start;
    const f = L > 1e-9 ? clamp((along - s.start) / L, 0, 1) : 1;
    return Math.max(0, route.stepTotal - (t0 + (t1 - t0) * f));
  }
  return route.total > 0 ? route.duration_s * clamp(1 - along / route.total, 0, 1) : 0;
}
/** Miles of the route within 0.15 mile of the I-5 line (and the share of the route). Pure but for geo.locate. */
function miles_on_i5(route, locate) {
  const g = route.geometry, step = Math.max(1, Math.ceil(g.length / 1500));
  let on = 0, prev = null, prevNear = false, prevAlong = 0;
  for (let i = 0; i < g.length; i += step) {
    const j = Math.min(i, g.length - 1);
    const hit = locate(g[j][0], g[j][1]);
    const near = !!hit && hit.m != null && hit.dist <= 0.15;
    if (prev != null && near && prevNear) on += route.cum[j] - prevAlong;
    prev = j; prevNear = near; prevAlong = route.cum[j];
  }
  return on;
}

/* ================================================================ local search: the app's own data, instant ================================================================ */
const norm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** How well does the normalized name match the query? 0 = not at all. Pure. */
export function matchScore(nq, name) {
  if (!nq) return 0;
  const n = norm(name);
  if (!n) return 0;
  if (n === nq) return 100;
  if (n.startsWith(nq)) return 92;
  const toks = nq.split(" "), words = n.split(" ");
  if (toks.every(t => words.some(w => w.startsWith(t)))) return 84 - Math.min(10, words.length);
  const cq = nq.replace(/ /g, ""), cn = n.replace(/ /g, "");
  if (cq.length >= 3 && cn.includes(cq)) return 70;
  if (toks.every(t => n.includes(t))) return 55;
  return 0;
}
const KIND_ICON = { city: "🏙️", place: "📍", mission: "⛪", rest: "🚻", exit: "🛣️", fuel: "⛽", ev: "⚡", food: "🍴", sleep: "🛏️", coffee: "☕", address: "🏠", street: "🛣️", poi: "📍", home: "🏠", work: "💼" };
const COFFEE_RE = /coffee|cafe|café|starbucks|dunkin|peet|dutch bros|philz|tim hortons|caribou|scooter|espresso/i;
const CATEGORIES = [
  { id: "fuel", label: "Gas", icon: "⛽", q: "gas station", svc: "fuel" },
  { id: "ev", label: "EV charging", icon: "⚡", q: "EV charging", svc: "ev" },
  { id: "food", label: "Food", icon: "🍴", q: "restaurant", svc: "food" },
  { id: "coffee", label: "Coffee", icon: "☕", q: "coffee", svc: "food", re: COFFEE_RE },
  { id: "rest", label: "Rest areas", icon: "🚻", q: "rest area", rest: true },
  { id: "sleep", label: "Hotels", icon: "🛏️", q: "hotel", svc: "sleep" },
];
let brandIndex = null;
function brands() {
  if (brandIndex) return brandIndex;
  const idx = new Map();
  for (const s of (data && data.SERVICES) || []) {
    for (const kind of ["fuel", "food", "ev", "sleep"]) {
      for (const b of s[kind] || []) {
        const key = norm(b);
        if (key.length < 2 || /^(gas|food|lodging|ev charger|ev range|ev|charger)$/.test(key)) continue;   // the data's own placeholders
        let e = idx.get(key);
        if (!e) idx.set(key, e = { name: b, kind, exits: [] });
        e.exits.push(s);
      }
    }
  }
  return (brandIndex = idx);
}
const coordOfM = m => { try { const c = geo.coordAt(m); return c && num(c[0]) && num(c[1]) ? c : null; } catch { return null; } };
const dirNow = () => (S && S.dir === "S" ? "S" : "N");
/** Signed miles ahead of the car on I-5 (positive = ahead), or null without a position. */
function aheadMi(m) { return S && S.m != null && num(m) ? data.aheadOf(S.m, dirNow(), m) : null; }
function aheadWords(m) {
  // Off I-5, or with GPS off, the car's mile is not where you are (it can be a spot saved on an earlier trip): say how
  // far the place is from where the phone is, or nothing.
  if (S && (S.offRoute || S.mode === "off")) {
    const c = coordOfM(m);
    return S.lat != null && S.lon != null && c && S.mode !== "off" ? `${fmtMi(geo.miles(S.lat, S.lon, c[0], c[1]))} away` : "";
  }
  const d = aheadMi(m);
  if (d == null) return "";
  if (Math.abs(d) < 0.3) return "right here";
  return `${fmtMi(Math.abs(d))} ${d >= 0 ? "ahead" : "behind"}`;
}
const exitLine = (st, ref) => (data.exitName ? data.exitName(st || "CA", ref) : "Exit " + ref);
const toDest = r => ({ id: r.id, name: r.name, address: r.sub || r.address || "", lat: r.lat, lon: r.lon, m: r.m != null ? r.m : null, kind: r.kind, src: r.src || "local" });

/** Instant results from the app's own data: [{id, name, sub, kind, icon, lat, lon, m, score}], best first (at most 10). Pure but for reading S. */
export function localSearch(q, max = 10) {
  const nq = norm(q);
  if (nq.length < 1 || !data) return [];
  const out = [];
  const push = (kind, id, name, sub, lat, lon, m, score, extra) => {
    if (!num(lat) || !num(lon)) return;
    out.push({ id, name, sub, kind, icon: KIND_ICON[kind] || "📍", lat, lon, m: m != null ? m : null, score, src: "local", ...extra });
  };
  // exits: "exit 278", "ex 45b", or just a number
  const em = /^(?:exit|ex)?\s*(\d{1,3}[a-z]?)$/.exec(nq) || null;
  const wantExit = em && (/^(exit|ex)/.test(nq) || /^\d{2,3}[a-z]?$/.test(nq));
  if (wantExit) {
    const ref = em[1];
    const list = (data.EXITS || []).filter(e => String(e[2]).toLowerCase() === ref || (!/[a-z]$/.test(ref) && String(e[2]).toLowerCase().startsWith(ref) && /^[a-z]$/.test(String(e[2]).toLowerCase().slice(ref.length))));
    for (const e of list.slice(0, 4)) {
      const c = coordOfM(e[0]);
      if (c) push("exit", "exit:" + e[2], `I-5 ${exitLine(e[1], e[2])}`, [String(e[3] || "").split(";")[0], aheadWords(e[0])].filter(Boolean).join(" · "), c[0], c[1], e[0], 96);
    }
  }
  for (const d of data.DESTS || []) {
    const s = matchScore(nq, d.name);
    if (s) { const c = coordOfM(d.m); if (c) push("city", "city:" + d.name, d.name, ["On I-5", aheadWords(d.m)].filter(Boolean).join(" · "), c[0], c[1], d.m, s + 6); }
  }
  for (const p of data.PLACES || []) {
    const s = matchScore(nq, p.name);
    if (!s) continue;
    const c = num(p.lat) && num(p.lon) ? [p.lat, p.lon] : coordOfM(p.m);
    if (c) push("place", "place:" + p.id, p.name, [(data.CATS && data.CATS[p.cat]) || "Landmark", data.exitName ? data.exitName(p.st, p.ex) : "", aheadWords(p.m)].filter(Boolean).join(" · "), c[0], c[1], p.m, s);
  }
  for (const x of data.MISSIONS || []) {
    const s = Math.max(matchScore(nq, x.name), matchScore(nq, x.name_es));
    if (s && num(x.lat)) push("mission", "mission:" + x.id, x.name, "California mission", x.lat, x.lon, null, s);
  }
  for (const r of data.REST || []) {
    const s = matchScore(nq, r.name);
    if (s && num(r.lat)) push("rest", "rest:" + r.name, r.name, ["Rest area", aheadWords(r.m)].filter(Boolean).join(" · "), r.lat, r.lon, r.m, s - 4);
  }
  // exits by what their signs say ("Sand Canyon", "Kettleman")
  if (nq.length >= 4 && !wantExit) {
    let n = 0;
    for (const e of data.EXITS || []) {
      if (n >= 3) break;
      const s = matchScore(nq, String(e[3] || "").split(";").join(" "));
      if (s >= 70) { const c = coordOfM(e[0]); if (c) { n++; push("exit", "exit:" + e[2], `I-5 ${exitLine(e[1], e[2])}`, [String(e[3] || "").split(";")[0], aheadWords(e[0])].filter(Boolean).join(" · "), c[0], c[1], e[0], 50); } }
    }
  }
  // service brands at exits: "In-N-Out" -> the next exits that have one
  if (nq.length >= 3) {
    const shown = new Set();
    let n = 0;
    for (const [key, b] of brands()) {
      const s = matchScore(nq, b.name);
      if (s < 70 || n >= 6) continue;
      const exits = b.exits.map(x => ({ x, d: aheadMi(x.m) })).filter(e => e.d == null || e.d > 0.3).sort((a, c) => (a.d == null ? a.x.m : a.d) - (c.d == null ? c.x.m : c.d)).slice(0, 4);
      for (const { x, d } of exits) {
        const id = `brand:${key}:${x.ref}`;
        if (shown.has(id) || n >= 6) continue;
        shown.add(id); n++;
        const c = coordOfM(x.m);
        if (c) push("brand", id, b.name, [`Near ${exitLine(x.st, x.ref)}`, d != null ? `${fmtMi(d)} ahead` : ""].filter(Boolean).join(" · "), c[0], c[1], x.m, s - 8 - (d != null ? Math.min(10, d / 30) : 0), { icon: KIND_ICON[b.kind] || "📍" });
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}
/** Gas, EV, food, coffee, rest areas and hotels along I-5 ahead of the car: [{id, name, sub, kind, lat, lon, m}] (nearest first). */
export function categoryAhead(cat, max = 6) {
  const c = typeof cat === "string" ? CATEGORIES.find(x => x.id === cat) : cat;
  if (!c || !data || !S || S.m == null) return [];
  const dir = dirNow(), out = [];
  if (c.rest) {
    for (const r of data.restAhead(S.m, dir, max, 300)) {
      if (!num(r.lat)) continue;
      out.push({ id: "rest:" + r.name, name: r.name.replace(/\s*\((north|south)bound\)/i, ""), sub: ["Rest area", r.status === "closed" ? "closed (Caltrans)" : "", `${fmtMi(r.d)} ahead`].filter(Boolean).join(" · "), kind: "rest", icon: KIND_ICON.rest, lat: r.lat, lon: r.lon, m: r.m, src: "local" });
    }
    return out;
  }
  for (const s of data.servicesAhead(S.m, dir, c.svc, c.re ? 80 : max, 300)) {
    const names = (s[c.svc] || []).filter(b => !c.re || c.re.test(b));
    if (!names.length) continue;
    const at = coordOfM(s.m);
    if (!at) continue;
    out.push({ id: `svc:${c.id}:${s.ref}`, name: `${c.label} · ${exitLine(s.st, s.ref)}`, sub: [names.slice(0, 3).join(", "), `${fmtMi(s.d)} ahead`].join(" · "), kind: c.id === "coffee" ? "coffee" : c.svc, icon: c.icon, lat: at[0], lon: at[1], m: s.m, src: "local" });
    if (out.length >= max) break;
  }
  return out;
}

/* ================================================================ maneuver icons ================================================================ */
const head = (x, y, deg) => `<path d="M0-10 10 6H-10Z" transform="translate(${x} ${y}) rotate(${deg})" fill="currentColor"/>`;
const line = d => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
const dim = d => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" opacity=".32"/>`;
const mirror = body => `<g transform="translate(48 0) scale(-1 1)">${body}</g>`;
const ICON_BODY = {
  straight: () => line("M24 44V17") + head(24, 11, 0),
  right: () => line("M13 44V28a8 8 0 0 1 8-8H30") + head(37, 20, 90),
  slightRight: () => line("M15 44V34Q15 28 20 23L28 15") + head(32, 11, 45),
  sharpRight: () => line("M14 44V18L30 34") + head(34, 37, 135),
  uturn: () => line("M35 44V20Q35 9 24 9T13 20V30") + head(13, 36, 180),
  keepRight: () => dim("M22 44V30L12 9") + line("M22 44V30Q22 24 27 19L34 12") + head(37, 9, 45),
  exitRight: () => dim("M16 44V8") + line("M16 44V32Q16 24 24 19L35 12") + head(39, 9, 55),
  merge: () => dim("M36 44Q36 31 24 22") + line("M12 44Q12 31 24 22V15") + head(24, 11, 0),
  roundabout: () => `<circle cx="24" cy="29" r="10" fill="none" stroke="currentColor" stroke-width="5"/>` + line("M24 47V39") + line("M31 21L37 13") + head(39, 10, 40),
  arrive: () => `<path d="M24 45C24 45 9 31 9 20a15 15 0 0 1 30 0C39 31 24 45 24 45Zm0-31a6 6 0 1 0 .01 0Z" fill="currentColor" fill-rule="evenodd"/>`,
};
/** The inline <svg> markup for a step type. Uses currentColor; the left turns are the right ones mirrored. */
export function iconSvg(type) {
  const L = /left/.test(type);
  let body;
  if (type === "arrive") body = ICON_BODY.arrive();
  else if (type === "uturn") body = ICON_BODY.uturn();
  else if (type === "roundabout") body = ICON_BODY.roundabout();
  else if (type === "merge") body = ICON_BODY.merge();
  else if (/^turn-/.test(type)) body = L ? mirror(ICON_BODY.right()) : ICON_BODY.right();
  else if (/^slight-/.test(type)) body = L ? mirror(ICON_BODY.slightRight()) : ICON_BODY.slightRight();
  else if (/^sharp-/.test(type)) body = L ? mirror(ICON_BODY.sharpRight()) : ICON_BODY.sharpRight();
  else if (/^keep-/.test(type)) body = L ? mirror(ICON_BODY.keepRight()) : ICON_BODY.keepRight();
  else if (/^exit-/.test(type)) body = L ? mirror(ICON_BODY.exitRight()) : ICON_BODY.exitRight();
  else body = ICON_BODY.straight();
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" class="nav-ico">${body}</svg>`;
}
const STEP_WORD = {
  depart: "Head out", straight: "Continue straight", "turn-left": "Turn left", "turn-right": "Turn right", "slight-left": "Bear left", "slight-right": "Bear right",
  "sharp-left": "Sharp left", "sharp-right": "Sharp right", uturn: "Make a U-turn", "keep-left": "Keep left", "keep-right": "Keep right",
  "exit-left": "Take the exit on the left", "exit-right": "Take the exit on the right", merge: "Merge", roundabout: "At the roundabout", arrive: "Arrive",
};
/** The words on screen for a step: "Turn right onto Oak Street", "Take exit 278 toward Kettleman City". */
export function stepText(step, destName) {
  if (!step) return "";
  if (step.type === "arrive") return destName ? `Arrive at ${destName}` : "Arrive";
  if (/^exit-/.test(step.type) && step.exit) {
    const where = step.toward ? ` toward ${step.toward}` : step.street ? ` onto ${step.street}` : "";
    return `Take exit ${step.exit}${where}`;
  }
  if (step.text) return step.text;
  const base = step.type === "roundabout" && step.roundabout_exit ? `At the roundabout, take the ${ORD[clamp(step.roundabout_exit, 1, 6) - 1]} exit` : STEP_WORD[step.type] || "Continue";
  const onto = step.ref ? ` onto ${step.ref}` : step.street ? ` onto ${step.street}` : "";
  return base + onto;
}

/* ================================================================ state ================================================================ */
const N = {
  state: "idle",          // "idle" | "previewing" | "navigating" | "arrived"  (state() adds "searching")
  searching: false,
  dest: null, route: null, from: null,
  run: 0,                 // one per navigation: a prompt made for an earlier one never speaks
  token: 0,               // one per route request: an answer for an earlier request is ignored
  loading: false, error: null,
  // the engine
  snap: null, along: 0, stepIdx: 0, mph: null, heading: null, lastFix: null, fixes: 0, driven: 0,
  said: new Set(), plans: new Map(), lastPromptT: -1e9,
  offCount: 0, rerouting: false, lastRerouteT: -1e9, rerouteN: 0, offlineSaid: false, wantReroute: false, rctrl: null,
  startedAt: 0, startAlong: 0, arrivedAt: 0,
  muted: false, setDest: null, i5: null, log: [],
  sim: null,
};
let clockFn = () => Date.now();
const now = () => (N.sim ? N.sim.t : clockFn());
const emit = (evt, d) => { try { bus.emit(evt, d); } catch (e) { warn(evt, e); } };
const queueRender = () => { try { ui && ui.queueRender && ui.queueRender(); } catch {} };
const stored = (k, f) => { try { return store.get("nav:" + k, f); } catch { return f; } };
const keep = (k, v) => { try { store.set("nav:" + k, v); } catch {} };

/* ---------- what the person has allowed (the one-time notice), recents, Home and Work ---------- */
export const CONSENT_TEXT = "To search places and plan routes, I-5 Buddy sends what you type and your current location to Dominares' server, which asks our map data provider (Geoapify, built on OpenStreetMap). Neither keeps them.";
const consent = () => stored("consent", null);
const recents = () => { const r = stored("recent", []); return Array.isArray(r) ? r.filter(d => d && num(d.lat) && num(d.lon) && d.name).slice(0, 8) : []; };
function addRecent(d) {
  if (!d || !num(d.lat) || !num(d.lon)) return;
  const slim = { id: d.id || null, name: d.name, address: d.address || "", lat: d.lat, lon: d.lon, m: d.m != null ? d.m : null, kind: d.kind || "place" };
  const same = x => x.name === slim.name && Math.abs(x.lat - slim.lat) < 0.0006 && Math.abs(x.lon - slim.lon) < 0.0006;
  keep("recent", [slim, ...recents().filter(x => !same(x))].slice(0, 8));
}
const favs = () => { const f = stored("fav", {}); return f && typeof f === "object" ? { home: validFav(f.home), work: validFav(f.work) } : { home: null, work: null }; };
const validFav = d => (d && typeof d === "object" && d.name && num(d.lat) && num(d.lon) ? d : null);
function setFav(which, d) {
  const f = favs();
  f[which] = d ? { id: d.id || null, name: d.name, address: d.address || "", lat: d.lat, lon: d.lon, m: d.m != null ? d.m : null, kind: d.kind || "place" } : null;
  keep("fav", f);
}

/* ---------- where is the car, for a search and for a route ---------- */
function positionNow() {
  if (S && num(S.lat) && num(S.lon)) return { lat: S.lat, lon: S.lon, acc: S.accuracy };
  if (S && S.m != null) { const c = coordOfM(S.m); if (c) return { lat: c[0], lon: c[1], acc: null, onRoad: true }; }
  return null;
}
const geoSource = () => window.__I5_FAKE_GEO__ || (native && native.geolocation && native.geolocation()) || navigator.geolocation;
/** One position for planning a route when GPS has not given one: the browser's own location (asks the person), 9 s at most. */
function askPosition() {
  return new Promise(resolve => {
    let G = null;
    try { G = geoSource(); } catch {}
    if (!G || !G.getCurrentPosition) return resolve(null);
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => fin(null), 9000);
    try { G.getCurrentPosition(p => fin(p && p.coords ? { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy } : null), () => fin(null), { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 }); } catch { fin(null); }
  });
}
const isOnline = () => { try { return navigator.onLine !== false; } catch { return true; } };

/* ================================================================ the engine ================================================================ */
const hasTripDest = () => !!(A && A.trip && A.trip.setDest);
function stepIndexAt(route, along) {
  const st = route.steps;
  let lo = 0, hi = st.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid].start <= along + 0.003) lo = mid; else hi = mid - 1; }
  return lo;
}
const speakable = step => !!step && !!maneuverPhrase(step) && !(step.type === "straight" && !step.ref);

/** What the screen shows right now. */
function guideInfo() {
  const r = N.route;
  if (!r) return null;
  const steps = r.steps, cur = N.stepIdx, last = steps.length - 1;
  const nextI = Math.min(cur + 1, last);
  let show = steps[nextI], distTo = Math.max(0, show.start - N.along);
  if (cur === 0 && N.along < 0.02 && steps[0].type === "depart" && steps.length > 2) show = steps[0];   // "Head north on Main Street" until we roll
  let then = null;
  const after = steps[nextI + 1];
  if (show !== steps[0] && after && after.type !== "arrive" && after.start - steps[nextI].start <= 0.3) then = after;
  const left = Math.max(0, (r.total - N.along) * r.k), sec = secondsLeft(r, N.along, Math.min(cur, last));
  return { cur, next: steps[nextI], show, distTo, then, left, sec, arriveAt: now() + sec * 1000, limit: limitAt(r, N.along, steps[Math.min(cur, last)]), mph: N.mph, freeway: !!steps[Math.min(cur, last)].ref };
}

function statusText() {
  if (N.state === "navigating" && N.route && N.dest) {
    const g = guideInfo();
    if (!g) return "";
    const move = g.show.type === "arrive" ? stepText(g.show, N.dest.name) : g.distTo < 0.012 ? `${stepText(g.show)} now` : `${stepText(g.show)} in ${fmtDist(g.distTo)}`;
    return g.show.type === "arrive" ? move : `${move} · to ${N.dest.name}`;
  }
  if (N.state === "arrived" && N.dest) return `Arrived at ${N.dest.name}`;
  return "";
}

/** Say a navigation prompt (see the grammar at the top). o: {id, kind "adv"|"final"|"alert", now, always} */
function sayNav(text, units, o) {
  const entry = { t: now(), id: o.id, text, units: units || null, kind: o.kind, now: !!o.now };
  N.log.push(entry); if (N.log.length > 300) N.log.shift();
  if (!voice || N.muted || !text) return false;
  const level = settings.navVoice || "full";
  if (level === "off" || (level === "alerts" && o.kind === "adv")) return false;
  const run = N.run, st = o.state || "navigating";
  const opts = { id: o.id, prio: 3, now: !!o.now, check: () => N.run === run && N.state === st && !N.muted };
  if (units && !settings.navStreets) opts.units = units.slice();
  entry.spoken = true;
  try { voice.say(text, opts); } catch (e) { warn(e); }
  return true;
}

/** The stages of prompts for the maneuver that opens step n: [{stage, key, at (miles before it)}], the last one is the final prompt. */
function planFor(n) {
  let p = N.plans.get(n);
  if (p) return p;
  const r = N.route, steps = r.steps, avail = steps[n].start - steps[n - 1].start;
  const mph = N.mph || 0, freeway = mph > 45 || !!steps[n - 1].ref;
  const stages = [];
  let fin;
  if (freeway) {
    if (avail >= 2.6) stages.push({ stage: "far", key: "2mi", at: 2 });
    if (avail >= 1.4) stages.push({ stage: "mid", key: "1mi", at: 1 });
    else if (avail >= 0.8) stages.push({ stage: "mid", key: "half", at: 0.5 });
    else if (avail >= 0.45) stages.push({ stage: "mid", key: "quarter", at: 0.25 });
    fin = clamp(Math.max(mph, 55) * 7 / 3600, 0.1, 0.3);        // about 7 seconds ahead
  } else {
    fin = clamp(mph * 5 / 3600, 0.03, 0.12);                    // about 5 seconds ahead
    for (const key of ["1000ft", "500ft"]) {
      const at = DIST_MI[key];
      if (avail >= at + 0.06 && at / Math.max(mph || 25, 8) * 3600 >= 13) { stages.push({ stage: "mid", key, at }); break; }   // 15 seconds ahead or so
    }
  }
  p = stages.filter(g => g.at - fin >= 0.07);
  p.push({ stage: "final", key: null, at: fin });
  N.plans.set(n, p);
  return p;
}
function runPrompts(t) {
  const r = N.route, steps = r.steps, n = N.stepIdx + 1, step = steps[n];
  if (!step || !speakable(step)) return;
  const dist = step.start - N.along;
  if (dist < 0.004) return;
  const mph = N.mph || 0, plan = planFor(n), sid = g => `nav:${r.id}:${n}:${g.stage}`;
  const due = plan.filter(g => dist <= g.at + 0.002 && !N.said.has(sid(g)));
  if (!due.length) return;
  const g = due[due.length - 1];
  for (const e of due) if (e !== g) N.said.add(sid(e));          // an earlier stage we drove past: never said late
  if (g.stage !== "final" && g.at - dist > Math.max(0.06, mph * 12 / 3600)) { N.said.add(sid(g)); return; }
  if (t - N.lastPromptT < 8000) return;                          // never two prompts within 8 s: try again next fix
  N.said.add(sid(g));
  const nxt = steps[n + 1];
  const then = g.stage === "final" && speakable(nxt) && nxt.start - step.start <= 0.2 ? nxt : null;
  let text, units = promptUnits(step, g.key, then, steps[n - 1]);
  if (!units) return;
  text = units.join(" ");
  if (settings.navStreets && step.text) {                        // the phone's own voice says the provider's words, street names and all
    const body = g.key ? `${DIST[g.key]} ${lowerFirst(step.text)}` : step.text;
    text = /[.!?]$/.test(body) ? body : body + ".";
    if (then && then.text) text += ` Then ${lowerFirst(then.text)}${/[.!?]$/.test(then.text) ? "" : "."}`;
    units = null;
  }
  N.lastPromptT = t;
  sayNav(text, units, { id: sid(g), kind: g.stage === "final" ? "final" : "adv", now: g.stage === "final" });
}

/** One GPS reading (or a simulated one). f: {lat, lon, accuracy, speed (mph), heading (deg), t (ms), fuzzy, sim}. */
function onFix(f) {
  try { handleFix(f); } catch (e) { warn("fix", e); }
}
function handleFix(f) {
  if (N.state !== "navigating" || !N.route || !f || f.fuzzy) return;
  if (!!N.sim !== !!f.sim) return;                // while simulating only simulated fixes count (and the other way round)
  const lat = Number(f.lat), lon = Number(f.lon);
  if (!num(lat) || !num(lon)) return;
  const t = num(f.t) ? f.t : now(), r = N.route, prev = N.lastFix;
  // speed and heading: the phone's own when it gives them, else from the last two fixes
  let mph = num(f.speed) && f.speed >= 0 ? f.speed : null, hd = num(f.heading) ? f.heading : null, movedM = 0;
  if (prev) {
    const dt = (t - prev.t) / 1000;
    movedM = geo.miles(prev.lat, prev.lon, lat, lon) * 1609.34;
    if (mph == null && dt > 0.3 && dt < 30) mph = movedM / 1609.34 / (dt / 3600);
    if (hd == null && movedM >= 8) hd = bearing([prev.lat, prev.lon], [lat, lon]);
    if (movedM > 0 && movedM < 400) N.driven += movedM / 1609.34;
  }
  if (mph != null) N.mph = N.mph == null || f.speed != null ? mph : N.mph * 0.4 + mph * 0.6;
  if (hd != null && (N.mph ?? 0) > 2) N.heading = hd;
  N.lastFix = { lat, lon, t }; N.fixes++;
  const snap = snapToRoute(r, lat, lon, N.snap ? N.along : null);
  N.snap = snap; N.along = snap.along;
  const thr = clamp(Math.max(50, 1.5 * (num(f.accuracy) ? f.accuracy : 0)), 50, 150);
  const moving = (N.mph ?? 0) >= 3 || movedM >= 15;
  const onRoute = snap.off <= thr;
  // the step the car is in (never goes back)
  const k = stepIndexAt(r, N.along);
  if (k > N.stepIdx) { N.stepIdx = k; emit("nav:step", { index: k, step: r.steps[k] }); }
  // arrival: within about 40 m of the destination, or past the end of the last step
  const end = r.geometry[r.geometry.length - 1];
  if (onRoute && (N.stepIdx >= r.steps.length - 1 || (r.total - N.along) * 1609.34 <= 40 || geo.miles(lat, lon, end[0], end[1]) * 1609.34 <= 40)) { arrive(); return; }
  if (!onRoute) {
    if (moving) N.offCount++;
    if (N.offCount >= 3) { maybeReroute(lat, lon); }
  } else {
    N.offCount = 0;
    runPrompts(t);
  }
  guideUpdate();
  queueRender();
}

/* ---------- off the route: a new route from here ---------- */
function maybeReroute(lat, lon) {
  if (N.rerouting || N.state !== "navigating") return;
  const t = now();
  if (t - N.lastRerouteT < 10000) return;
  if (!isOnline()) {                                   // no connection: say so once, try again the moment it is back
    N.wantReroute = true;
    if (!N.offlineSaid) { N.offlineSaid = true; N.lastRerouteT = t; sayNav(SENT.offline, [SENT.offline], { id: `nav:${N.route.id}:offline`, kind: "alert", now: true }); }
    return;
  }
  doReroute(lat, lon);
}
async function doReroute(lat, lon) {
  if (N.rerouting || N.state !== "navigating" || !N.dest) return;
  N.rerouting = true; N.lastRerouteT = now(); N.offCount = 0; N.wantReroute = false;
  const run = N.run, n = ++N.rerouteN, ctrl = new AbortController();
  N.rctrl = ctrl;
  sayNav(SENT.reroute, [SENT.reroute], { id: `nav:reroute:${run}:${n}`, kind: "alert", now: true });
  try {
    const raw = await P.route({ lat, lon }, { lat: N.dest.lat, lon: N.dest.lon }, N.heading, ctrl.signal);
    if (N.run !== run || N.state !== "navigating") return;
    const route = buildRoute(raw, geo.miles);
    if (!route) throw new Error("no route");
    N.offlineSaid = false;
    adoptRoute(route);
    emit("nav:reroute", { route });
  } catch (e) {
    if (N.run !== run || (e && e.aborted)) return;
    N.wantReroute = true;                                // it will ask again after the next three fixes off the route (10 s apart at least)
    if (e && e.offline && !N.offlineSaid) { N.offlineSaid = true; sayNav(SENT.offline, [SENT.offline], { id: `nav:${N.route.id}:offline`, kind: "alert", now: true }); }
  } finally { N.rerouting = false; N.rctrl = null; }
}
/** Use a new route for the same destination (a reroute): the engine starts over at its beginning. */
function adoptRoute(route) {
  N.route = route; N.stepIdx = 0; N.along = 0; N.snap = null; N.startAlong = 0;
  N.said = new Set(); N.plans = new Map(); N.offCount = 0;
  if (N.sim) N.sim.along = 0;
  mapRoute();
  emit("nav:route", { route });
  guideUpdate();
  queueRender();
}

/* ---------- arrival ---------- */
function arrive() {
  if (N.state !== "navigating") return;
  const r = N.route;
  N.state = "arrived"; N.arrivedAt = now();
  haltSim();
  const side = r.steps[r.steps.length - 1].side;
  const units = [SENT.arrived].concat(side ? [SENT[side]] : []);
  sayNav(units.join(" "), units, { id: `nav:${r.id}:arrive`, kind: "alert", now: true, state: "arrived" });
  emit("nav:arrive", { dest: N.dest });
  showArrived();
  queueRender();
}

/* ---------- start and end ---------- */
function start(o = {}) {
  if (!N.route || !N.dest || (N.state !== "previewing" && N.state !== "navigating")) return false;
  if (N.state === "navigating") { openGuide(); return true; }
  try { voice && voice.unlock && voice.unlock(); } catch {}
  // navigation needs GPS: the same Start GPS as the Drive tab (a simulated drive brings its own position)
  if (o.gps !== false && A.S.mode !== "gps") { try { A.startGps && A.startGps(); } catch (e) { warn(e); } }
  N.run++;
  N.state = "navigating";
  N.snap = null; N.along = 0; N.stepIdx = 0; N.mph = null; N.heading = null; N.lastFix = null; N.fixes = 0; N.driven = 0;
  N.said = new Set(); N.plans = new Map(); N.lastPromptT = -1e9; N.offCount = 0; N.rerouting = false; N.offlineSaid = false; N.wantReroute = false; N.log = [];
  N.startedAt = now(); N.startAlong = 0; N.follow = true; N.overview = false;
  applyTripDest();
  emit("nav:start", { route: N.route, dest: N.dest });
  renderSearchPill();
  sayNav(SENT.ready, [SENT.ready], { id: `nav:${N.route.id}:ready`, kind: "alert" });
  openGuide();
  queueRender();
  return true;
}
function end() {
  const was = N.state;
  if (was === "idle") { closeSearch(); return; }
  const wasNav = was === "navigating";
  N.run++;
  try { N.rctrl && N.rctrl.abort(); N.pctrl && N.pctrl.abort(); } catch {}
  N.token++;
  stopSimulate();
  N.state = "idle"; N.loading = false; N.error = null; N.rerouting = false;
  clearTripDest();
  closeView();
  renderSearchPill(); renderSlim();
  if (wasNav) sayNav(SENT.ended, [SENT.ended], { id: `nav:end:${N.run}`, kind: "alert", now: true, state: "idle" });
  N.route = null; N.dest = null; N.snap = null;
  emit("nav:end", {});
  queueRender();
}

/* ---------- the I-5 countdown (trip.js) when the destination is on the road ---------- */
function applyTripDest() {
  N.setDest = null;
  const d = N.dest;
  if (!d || d.m == null || !data) return;
  if (!(d.m >= 0 && d.m <= data.MAX_M)) return;
  try {
    const before = A.S.dest;
    if (A.trip && A.trip.setDest) { A.trip.setDest({ name: d.name, m: d.m }); }
    else { A.S.dest = { name: d.name, m: d.m }; store.set("dest", A.S.dest); emit("dest", A.S.dest); }
    N.setDest = { name: d.name, m: d.m, before: before ? { name: before.name, m: before.m } : null };
  } catch (e) { warn(e); }
}
function clearTripDest() {
  const mine = N.setDest;
  N.setDest = null;
  if (!mine || !A) return;
  const now_ = A.S.dest;
  if (!now_ || now_.name !== mine.name || now_.m !== mine.m) return;    // the person changed it meanwhile
  try {
    if (mine.before && A.trip && A.trip.setDest) A.trip.setDest(mine.before);
    else if (A.trip && A.trip.clearDest) A.trip.clearDest();
    else { A.S.dest = null; store.del("dest"); emit("dest", null); }
  } catch (e) { warn(e); }
}

/* ================================================================ the "Where to?" pill, the search sheet, the one-time notice ================================================================ */
const $id = id => document.getElementById(id);
function slot(id, cls, tag = "div") {
  let e = $id(id);
  if (!e) { e = el(tag); e.id = id; (document.querySelector(".app") || document.body).append(e); }
  if (cls) e.classList.add(cls);
  return e;
}
const SVG_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" fill="currentColor"/></svg>';
const SVG_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 4.6 8 12l7.4 7.4 1.4-1.4L10.8 12l6-6-1.4-1.4Z" fill="currentColor"/></svg>';
const SVG_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" fill="currentColor"/></svg>';
const SVG_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8L12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const SVG_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="19" cy="12" r="1.9" fill="currentColor"/></svg>';

/* ---------- the pill on Drive ---------- */
/** Before there is a position (the welcome card): under the card, so Start GPS and Install app / Get the iPhone app stay
    above the tab bar on a short phone screen. While a drive or a demo runs (3.0.2): first in the row with Narration and
    End trip, one row of actions under the sign. With a position but nothing running: under the sign. */
function placePill() {
  const box = $id("navSearch"), sign = $id("signBoard"), card = $id("nextCard"), run = $id("runControls");
  if (!box || !sign || !card) return;
  const welcome = S.m == null;
  const running = !welcome && !!run && !!S.mode && S.mode !== "off";
  if (run) run.classList.toggle("with-nav", running);
  if (running) { if (run.firstElementChild !== box) run.prepend(box); return; }
  // with a position: under the sign, after the one-time "Pick your ride?" invitation (ride.js keeps that right under the sign)
  const invite = $id("rideInvite");
  const anchor = invite && invite.parentNode === sign.parentNode ? invite : sign;
  if (invite && invite.parentNode === sign.parentNode && invite.previousElementSibling !== sign) sign.after(invite);
  if (welcome) { if (box.previousElementSibling !== card) card.after(box); }
  else if (box.previousElementSibling !== anchor) anchor.after(box);
}
function renderSearchPill() {
  const box = $id("navSearch");
  if (!box) return;
  placePill();
  const key = N.state + ":" + (N.dest ? N.dest.name : "");
  if (box.dataset.key === key && box.firstChild) return;
  box.dataset.key = key; box.textContent = "";
  const live = (N.state === "navigating" || N.state === "arrived") && N.dest;
  const b = el("button", "nav-pill" + (live ? " live" : ""));
  b.type = "button";
  if (live) {
    b.innerHTML = '<span class="nav-pill-ic">' + iconSvg("straight") + "</span>";
    const t = el("span", "nav-pill-tx");
    t.append(el("b", null, N.state === "arrived" ? "You have arrived" : "Navigating"), el("small", null, `To ${N.dest.name}. Tap to open.`));
    b.append(t);
    b.onclick = () => { if (N.state === "navigating") openGuide(); else showArrived(); };
  } else {
    b.innerHTML = '<span class="nav-pill-ic">' + SVG_SEARCH + "</span>";
    const t = el("span", "nav-pill-tx");
    t.append(el("b", null, "Where to?"), el("small", null, "Search a place, or pick Home or Work"));
    b.append(t);
    b.onclick = () => { try { voice && voice.unlock && voice.unlock(); } catch {} openSearch(); };
  }
  box.append(b);
}

/* ---------- the one-time notice ---------- */
let consentPromise = null;
/** Resolves true when the person says Continue (stored), false on Not now. Shown over whatever is open. */
function askConsent() {
  if (consentPromise) return consentPromise;
  const root = slot("navConsent", "nav-consent");
  root.hidden = false; root.textContent = "";
  root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-labelledby", "navConsentTitle");
  const card = el("div", "nav-consent-card");
  const h = el("h2", null, "Before I look it up"); h.id = "navConsentTitle";
  const p = el("p", null, CONSENT_TEXT);
  const acts = el("div", "nav-consent-acts");
  const yes = el("button", "primary", "Continue"), no = el("button", "secondary", "Not now");
  yes.type = no.type = "button";
  acts.append(yes, no);
  card.append(h, p, acts);
  root.append(card);
  const opener = document.activeElement;
  yes.focus({ preventScroll: true });
  return (consentPromise = new Promise(resolve => {
    const done = ok => {
      keep("consent", ok ? "yes" : "no");
      root.hidden = true; root.textContent = "";
      consentPromise = null;
      try { opener && opener.focus && opener.focus({ preventScroll: true }); } catch {}
      resolve(ok);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    root.onkeydown = e => { if (e.key === "Escape") done(false); };
  }));
}

/* ---------- the sheet ---------- */
const SS = { open: false, q: "", cat: null, pickFor: null, online: [], ostate: "idle", attribution: "", seq: 0, timer: 0, ctrl: null, saving: null, opener: null, built: false };
const SH = {};
function buildSheet() {
  if (SS.built) return;
  SS.built = true;
  const root = SH.root = slot("navSheet", "nav-sheet", "aside");
  root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Where to?");
  root.textContent = "";
  const head = el("div", "nav-sh-head");
  const back = el("button", "nav-iconbtn"); back.type = "button"; back.innerHTML = SVG_BACK; back.setAttribute("aria-label", "Close search");
  back.onclick = () => closeSearch();
  const wrap = el("div", "nav-inputwrap");
  const lab = el("label", "nav-sr", "Where to?"); lab.htmlFor = "navQ";
  const input = SH.input = el("input"); input.id = "navQ"; input.type = "search"; input.placeholder = "Where to?";
  input.setAttribute("enterkeyhint", "search"); input.setAttribute("autocomplete", "off"); input.setAttribute("autocapitalize", "off"); input.setAttribute("autocorrect", "off");
  input.setAttribute("spellcheck", "false"); input.setAttribute("inputmode", "search"); input.maxLength = 120;
  const clear = SH.clear = el("button", "nav-iconbtn nav-clear"); clear.type = "button"; clear.innerHTML = SVG_CLOSE; clear.setAttribute("aria-label", "Clear"); clear.hidden = true;
  wrap.append(lab, input, clear);
  head.append(back, wrap);
  const chips = SH.chips = el("div", "nav-chips"); chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Find along the way");
  for (const c of CATEGORIES) {
    const b = el("button", "nav-chip"); b.type = "button"; b.dataset.cat = c.id; b.setAttribute("aria-pressed", "false");
    b.append(el("span", null, c.icon), document.createTextNode(c.label));
    b.firstChild.setAttribute("aria-hidden", "true");
    b.onclick = () => setCat(SS.cat === c.id ? null : c.id);
    chips.append(b);
  }
  SH.body = el("div", "nav-sh-body"); SH.body.setAttribute("aria-live", "polite");
  SH.foot = el("p", "nav-fine");
  root.append(head, chips, SH.body, SH.foot);
  input.addEventListener("input", () => { SS.q = input.value; SS.cat = null; SS.saving = null; syncChips(); onQuery(); });
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); if (SS.q.trim().length >= 3) { clearTimeout(SS.timer); runOnline(SS.q.trim()); } } });
  clear.onclick = () => { input.value = ""; SS.q = ""; SS.cat = null; syncChips(); onQuery(); input.focus(); };
  root.addEventListener("keydown", e => { if (e.key === "Escape" && !($id("navConsent") && !$id("navConsent").hidden)) closeSearch(); });
}
function syncChips() { for (const b of SH.chips.children) b.setAttribute("aria-pressed", String(b.dataset.cat === SS.cat)); SH.clear.hidden = !SS.q; }
function openSearch(q, o = {}) {
  buildSheet();
  if (N.state === "navigating") { openGuide(); return false; }
  SS.opener = document.activeElement;
  SS.open = true; SS.pickFor = o.pickFor || null; SS.cat = o.cat || null; SS.saving = null;
  SH.root.hidden = false; document.body.classList.add("nav-open");
  SH.root.setAttribute("aria-label", SS.pickFor ? `Set ${SS.pickFor === "home" ? "Home" : "Work"}` : "Where to?");
  SH.input.placeholder = SS.pickFor ? `Search for ${SS.pickFor === "home" ? "Home" : "Work"}` : "Where to?";
  SH.input.value = typeof q === "string" ? q : "";
  SS.q = SH.input.value; syncChips();
  onQuery();
  try { SH.input.focus({ preventScroll: true }); } catch {}
  return true;
}
function closeSearch() {
  if (!SS.open) return;
  SS.open = false; SS.seq++;
  clearTimeout(SS.timer);
  try { SS.ctrl && SS.ctrl.abort(); } catch {}
  SH.root.hidden = true;
  if (!viewShown()) document.body.classList.remove("nav-open");
  try { SS.opener && SS.opener.focus && SS.opener.focus({ preventScroll: true }); } catch {}
}
function setCat(id) {
  SS.cat = id; SS.q = id ? "" : SH.input.value; if (id) SH.input.value = "";
  SS.saving = null; syncChips(); onQuery();
}
function onQuery() {
  clearTimeout(SS.timer);
  try { SS.ctrl && SS.ctrl.abort(); } catch {}            // a new keystroke cancels the request for the old words
  SS.seq++;
  SS.online = []; SS.attribution = "";
  const q = SS.q.trim(), cat = SS.cat ? CATEGORIES.find(c => c.id === SS.cat) : null;
  if (cat) { SS.ostate = "wait"; SS.timer = setTimeout(() => runOnline(cat.q), 0); }
  else if (q.length >= 3) { SS.ostate = "wait"; SS.timer = setTimeout(() => runOnline(q), 350); }
  else SS.ostate = q ? "short" : "idle";
  renderSheet();
}
function searchPos() { const p = positionNow(); return p ? { lat: p.lat, lon: p.lon } : null; }
async function runOnline(term) {
  if (!SS.open) return;
  const my = SS.seq;
  if (!isOnline()) { SS.ostate = "offline"; renderSheet(); return; }
  if (consent() !== "yes") {
    if (consent() !== null) { SS.ostate = "declined"; renderSheet(); return; }
    const ok = await askConsent();
    if (my !== SS.seq || !SS.open) return;
    if (!ok) { SS.ostate = "declined"; renderSheet(); return; }
  }
  const ctrl = new AbortController();
  SS.ctrl = ctrl; SS.ostate = "loading"; renderSheet();
  try {
    const j = await P.search(term, searchPos(), ctrl.signal);
    if (my !== SS.seq) return;
    SS.online = cleanResults(j);
    SS.attribution = j && typeof j.attribution === "string" ? str(j.attribution, 200) : "© OpenStreetMap contributors · Geoapify";
    SS.ostate = SS.online.length ? "ok" : "none";
  } catch (e) {
    if (my !== SS.seq || (e && e.aborted)) return;
    SS.online = [];
    SS.ostate = e && e.offline ? "offline" : "error";
  }
  renderSheet();
}
function distFrom(r) {
  const p = positionNow();
  return p && !p.onRoad ? geo.miles(p.lat, p.lon, r.lat, r.lon) : null;
}
function rowFor(r, o = {}) {
  const li = el("li", "nav-li");
  const b = el("button", "nav-row"); b.type = "button";
  const ic = el("span", "nav-ic", r.icon || KIND_ICON[r.kind] || "📍"); ic.setAttribute("aria-hidden", "true");
  const tx = el("span", "nav-tx"); tx.append(el("b", null, r.name));
  const sub = r.sub || r.address || "";
  if (sub) tx.append(el("small", null, sub));
  b.append(ic, tx);
  const d = o.noDist ? null : distFrom(r);
  if (d != null) b.append(el("span", "nav-dist", fmtMi(d)));
  b.onclick = () => choose(r);
  li.append(b);
  if (!o.noStar) {
    const st = el("button", "nav-iconbtn nav-star"); st.type = "button"; st.innerHTML = SVG_STAR; st.setAttribute("aria-label", `Save ${r.name} as Home or Work`);
    st.setAttribute("aria-expanded", String(SS.saving === r));
    st.onclick = e => { e.stopPropagation(); SS.saving = SS.saving === r ? null : r; renderSheet(); };
    li.append(st);
    if (SS.saving === r) {
      const m = el("div", "nav-save");
      for (const [k, label] of [["home", "Set as Home"], ["work", "Set as Work"]]) {
        const sb = el("button", "secondary", label); sb.type = "button";
        sb.onclick = () => { setFav(k, toDest(r)); SS.saving = null; toastMsg(`${label.slice(7)} saved: ${r.name}`); renderSheet(); };
        m.append(sb);
      }
      li.append(m);
    }
  }
  return li;
}
const toastMsg = t => { try { ui && ui.toast && ui.toast(t); } catch {} };
function section(title, note) {
  const s = el("section", "nav-sec");
  if (title) { const h = el("h3", "sub", title); s.append(h); }
  if (note) s.append(el("p", "nav-note", note));
  return s;
}
function favButtons() {
  const f = favs(), row = el("div", "nav-favs");
  for (const [k, label] of [["home", "Home"], ["work", "Work"]]) {
    const cell = el("div", "nav-fav");
    const b = el("button", "nav-favbtn"); b.type = "button";
    b.append(el("span", null, KIND_ICON[k]), el("span", "nav-favtx", f[k] ? label : `Set ${label}`));
    b.firstChild.setAttribute("aria-hidden", "true");
    if (f[k]) { b.append(el("small", null, f[k].name)); b.onclick = () => choose({ ...f[k], src: "fav" }); }
    else b.onclick = () => openSearch("", { pickFor: k });
    cell.append(b);
    if (f[k]) {
      const m = el("button", "nav-iconbtn"); m.type = "button"; m.innerHTML = SVG_MORE; m.setAttribute("aria-label", `Change or remove ${label}`);
      m.onclick = () => { openSearch("", { pickFor: k }); };
      cell.append(m);
    }
    row.append(cell);
  }
  return row;
}
function renderSheet() {
  if (!SS.open) return;
  const body = SH.body; body.textContent = "";
  const q = SS.q.trim(), cat = SS.cat ? CATEGORIES.find(c => c.id === SS.cat) : null;
  if (SS.pickFor) {
    body.append(el("p", "nav-note", `Pick a place to save as ${SS.pickFor === "home" ? "Home" : "Work"}.`));
    if (favs()[SS.pickFor]) {
      const rm = el("button", "secondary", `Remove ${SS.pickFor === "home" ? "Home" : "Work"}`); rm.type = "button";
      rm.onclick = () => { const k = SS.pickFor; setFav(k, null); SS.pickFor = null; closeSearch(); toastMsg(`${k === "home" ? "Home" : "Work"} removed`); };
      body.append(rm);
    }
  }
  let any = false;
  if (!q && !cat) {
    if (!SS.pickFor) {
      const s = section("Home and Work"); s.append(favButtons()); body.append(s);
      const rec = recents();
      if (rec.length) {
        const sr = section("Recent"), ul = el("ul", "nav-list");
        for (const d of rec) ul.append(rowFor({ ...d, sub: d.address, icon: KIND_ICON[d.kind] || "🕘" }, { noStar: false }));
        sr.append(ul); body.append(sr);
      } else body.append(el("p", "nav-note", "Try a city on I-5, a landmark, an exit number, or a name like In-N-Out."));
      if (consent() === "no") {
        const t = section(null, "Online search is off, so you only see places along I-5 from the app.");
        const on = el("button", "link", "Turn on online search"); on.type = "button";
        on.onclick = async () => { const ok = await askConsent(); renderSheet(); if (ok && SS.q.trim().length >= 3) onQuery(); };
        t.append(on); body.append(t);
      }
    }
  } else {
    const local = cat ? categoryAhead(cat, 6) : localSearch(q);
    if (cat && S.m == null) body.append(el("p", "nav-note", "Turn on GPS to see what is coming up on I-5."));
    if (local.length) {
      any = true;
      const s = section(cat ? `${cat.label} on I-5, ahead` : "From I-5 Buddy"), ul = el("ul", "nav-list");
      for (const r of local) ul.append(rowFor(r, { noDist: true }));
      s.append(ul); body.append(s);
    }
    const st = SS.ostate;
    const on = section(st === "ok" || st === "loading" || st === "wait" ? (cat ? `${cat.label} near you · online` : "Online results") : null);
    if (st === "loading" || st === "wait") on.append(el("p", "nav-note nav-busy", "Looking…"));
    else if (st === "ok") {
      const ul = el("ul", "nav-list");
      for (const r of SS.online) ul.append(rowFor(r));
      on.append(ul);
      SH.foot.textContent = SS.attribution;
    } else if (st === "none") on.append(el("p", "nav-note", "Nothing found online for that."));
    else if (st === "offline") on.append(el("p", "nav-note", "You're offline, so these are only places along I-5 from the app."));
    else if (st === "error") on.append(el("p", "nav-note", "The place search isn't answering right now. Showing what the app knows."));
    else if (st === "declined") {
      on.append(el("p", "nav-note", "Online search is off, so these are only places along I-5 from the app."));
      const b = el("button", "link", "Turn on online search"); b.type = "button";
      b.onclick = async () => { const ok = await askConsent(); if (ok) onQuery(); else renderSheet(); };
      on.append(b);
    } else if (st === "short" && !local.length) on.append(el("p", "nav-note", "Keep typing: three letters or more searches online too."));
    if (on.childNodes.length) body.append(on);
    if (!any && st !== "ok" && st !== "loading" && st !== "wait" && !on.childNodes.length) body.append(el("p", "nav-note", "No matches yet."));
  }
  if (!SS.online.length || (!q && !cat)) SH.foot.textContent = "";
  SH.clear.hidden = !SS.q;
}
/** A result was picked: remember it, then a route preview (or, from "Set Home", just save it). */
function choose(r) {
  const d = toDest(r);
  if (SS.pickFor) {
    setFav(SS.pickFor, d);
    toastMsg(`${SS.pickFor === "home" ? "Home" : "Work"} saved: ${d.name}`);
    const again = SS.pickFor; SS.pickFor = null;
    closeSearch();
    void again;
    return;
  }
  addRecent(d);
  closeSearch();
  preview(d);
}

/* ================================================================ the full-screen view: preview, guidance, arrival ================================================================ */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const ATTRIBUTION = "© OpenStreetMap contributors · OpenFreeMap · Routes: Geoapify";
const PITCH = 55, LIB_MS = 12000;
const V = { built: false, root: null, map: null, lib: null, mapState: "idle", sceneReady: false, markers: [], car: null, gradKey: "", sketch: null, minimized: false, theme: "", opener: null, stepsOpen: false, lastIcon: "", lastShow: "" };
const viewShown = () => !!(V.root && !V.root.hidden);

function buildView() {
  if (V.built) return;
  V.built = true;
  const root = V.root = slot("navView", "nav-view", "div");
  root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Navigation"); root.tabIndex = -1;
  root.textContent = "";
  const stage = el("div", "nav-stage");
  V.mapEl = el("div", "nav-map");
  V.sketchEl = el("div", "nav-sketch");
  V.mapNote = el("p", "nav-maptext"); V.mapNote.setAttribute("role", "status");
  V.attrib = el("p", "nav-attrib", ATTRIBUTION);
  stage.append(V.mapEl, V.sketchEl, V.mapNote, V.attrib);

  // preview chrome
  const ph = V.pvHead = el("header", "nav-pv-head");
  const close = el("button", "nav-iconbtn nav-pv-x"); close.type = "button"; close.innerHTML = SVG_CLOSE; close.setAttribute("aria-label", "Close route preview");
  close.onclick = () => end();
  const who = el("div", "nav-pv-who"); V.pvName = el("b"); V.pvAddr = el("small");
  who.append(V.pvName, V.pvAddr);
  ph.append(close, who);
  const card = V.pvCard = el("section", "nav-pv-card"); card.setAttribute("aria-label", "Route summary");
  V.pvBody = el("div", "nav-pv-body");
  const acts = el("div", "nav-pv-acts");
  V.btnStart = el("button", "primary nav-start", "Start"); V.btnSteps = el("button", "secondary", "Steps"); V.btnClose = el("button", "secondary", "Close");
  for (const b of [V.btnStart, V.btnSteps, V.btnClose]) b.type = "button";
  V.btnSteps.setAttribute("aria-expanded", "false");
  V.btnStart.onclick = () => start();
  V.btnSteps.onclick = () => toggleSteps();
  V.btnClose.onclick = () => end();
  acts.append(V.btnStart, V.btnSteps, V.btnClose);
  card.append(V.pvBody, acts);
  V.stepsEl = el("section", "nav-steps"); V.stepsEl.hidden = true; V.stepsEl.setAttribute("aria-label", "Steps");

  // guidance chrome
  const bn = V.banner = el("div", "nav-banner");
  V.bnIcon = el("span", "nav-bn-ic"); V.bnIcon.setAttribute("aria-hidden", "true");
  const bt = el("div", "nav-bn-tx");
  V.bnDist = el("b", "nav-bn-dist"); V.bnText = el("span", "nav-bn-text"); V.bnThen = el("small", "nav-bn-then");
  bt.append(V.bnDist, V.bnText, V.bnThen);
  bn.append(V.bnIcon, bt);
  const gauges = V.gauges = el("div", "nav-gauges");
  V.spd = el("div", "nav-speed"); V.spdN = el("b", null, "0"); V.spd.append(V.spdN, el("small", null, "mph"));
  V.lim = el("div", "nav-limit"); V.lim.hidden = true; V.limN = el("b");
  V.lim.append(el("small", null, "SPEED"), el("small", null, "LIMIT"), V.limN);
  // HUD: the next turn, huge and mirrored, for a phone lying flat under the windshield at night; a tap anywhere ends it
  V.btnHud = el("button", "nav-hud-btn", "HUD"); V.btnHud.type = "button";
  V.btnHud.setAttribute("aria-label", "Heads-up display: show the next turn mirrored, to read in the windshield");
  V.btnHud.onclick = () => setHud(true);
  gauges.append(V.lim, V.spd, V.btnHud);
  V.recenter = el("button", "nav-recenter", "Recenter"); V.recenter.type = "button"; V.recenter.hidden = true;
  V.recenter.onclick = () => recenter();
  const bottom = V.bottom = el("section", "nav-bottom"); bottom.setAttribute("aria-label", "Trip");
  const stats = el("div", "nav-stats");
  const stat = (cls, label) => { const d = el("div", "nav-stat " + cls); const b = el("b", null, "--"); d.append(b, el("small", null, label)); stats.append(d); return b; };
  V.stArr = stat("arr", "arrive"); V.stMin = stat("min", "left"); V.stMi = stat("mi", "to go");
  const row = el("div", "nav-bottom-acts");
  const mk = (cls, label, icon, fn, text) => { const b = el("button", cls); b.type = "button"; b.setAttribute("aria-label", label); b.title = label; if (icon) b.innerHTML = icon; if (text) b.append(text); b.onclick = fn; return b; };
  V.btnEnd = mk("nav-end", "End navigation", null, () => end(), "End");
  V.btnMute = mk("nav-tool", "Mute voice prompts", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Z" fill="currentColor"/></svg>', () => setMuted(!N.muted));
  V.btnMute.setAttribute("aria-pressed", "false");
  V.btnOver = mk("nav-tool", "Route overview", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm14-10a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM6.5 15.5 9 11h4a2 2 0 0 0 0-4h-1V5h1a4 4 0 0 1 0 8H10l-1.7 3L6.5 15.5Z" fill="currentColor"/></svg>', () => toggleOverview());
  V.btnOver.setAttribute("aria-pressed", "false");
  V.btnSteps2 = mk("nav-tool", "Steps", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h10v2H4v-2Z" fill="currentColor"/></svg>', () => toggleSteps());
  V.btnApp = mk("nav-tool", "Back to the app, keep guiding", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z" fill="currentColor"/></svg>', () => minimize());
  row.append(V.btnEnd, V.btnMute, V.btnOver, V.btnSteps2, V.btnApp);
  bottom.append(stats, row);
  // arrival
  V.arrived = el("section", "nav-arrived"); V.arrived.setAttribute("aria-label", "Arrived");
  root.append(stage, ph, bn, gauges, V.recenter, card, V.stepsEl, bottom, V.arrived);
  root.addEventListener("keydown", e => { if (e.key === "Escape" && V.stepsOpen) toggleSteps(false); if (e.key === "Escape" && V.hud) setHud(false); });
  // in HUD mode the first tap anywhere only ends it (nothing under the finger is pressed)
  root.addEventListener("click", e => { if (V.hud && !(e.target && e.target.closest && e.target.closest(".nav-hud-btn"))) { e.preventDefault(); e.stopPropagation(); setHud(false); } }, true);
}
function setHud(on) {
  V.hud = !!on && V.mode === "guide";
  if (!V.root) return;
  V.root.classList.toggle("nav-hud", V.hud);
  if (V.hud) toastMsg("HUD on: lay the phone flat under the windshield. Tap anywhere to go back.");
}
function setMode(mode) {
  const was = V.mode;
  if (mode !== "guide" && V.hud) { V.hud = false; V.root && V.root.classList.remove("nav-hud"); }
  V.root.dataset.mode = mode;
  V.mode = mode;
  if (was !== mode && V.map) { try { requestAnimationFrame(() => { try { V.map && V.map.resize(); } catch {} }); } catch {} }
}
function openView(mode) {
  buildView();
  const first = V.root.hidden;
  if (first) V.opener = document.activeElement;
  V.root.hidden = false; V.minimized = false;
  document.body.classList.add("nav-open");
  setMode(mode);
  renderSlim();
  ensureMap();
  return first;
}
function closeView() {
  if (!V.built) return;
  V.root.hidden = true; V.minimized = false;
  toggleSteps(false);
  destroyMap();
  V.mode = "";
  if (!SS.open) document.body.classList.remove("nav-open");
  renderSlim();
  try { V.opener && V.opener.focus && V.opener.focus({ preventScroll: true }); } catch {}
}
function minimize() {
  if (N.state !== "navigating" || !V.built) return;
  V.root.hidden = true; V.minimized = true;
  document.body.classList.remove("nav-open");
  renderSlim();
  try { ui && ui.go && ui.go("drive"); } catch {}
  try { V.opener && V.opener.focus && V.opener.focus({ preventScroll: true }); } catch {}
}
function openGuide() {
  const wasHidden = !viewShown();
  openView("guide");
  if (N.state === "arrived") { showArrived(); return; }
  V.bottom.hidden = false;
  if (wasHidden) { N.follow = true; N.overview = false; syncTools(); }
  guideUpdate(true);
  try { V.root.focus({ preventScroll: true }); } catch {}
}
function showArrived() {
  openView("arrived");
  const a = V.arrived; a.textContent = "";
  const secs = Math.max(0, (N.arrivedAt - N.startedAt) / 1000);
  a.append(el("div", "nav-arr-ic", ""), el("h2", null, "You have arrived"), el("p", "nav-arr-dest", N.dest ? N.dest.name : ""));
  if (N.dest && N.dest.address) a.append(el("p", "nav-arr-addr", N.dest.address));
  const side = N.route && N.route.steps[N.route.steps.length - 1].side;
  if (side) a.append(el("p", "nav-arr-side", `Your destination is on the ${side}.`));
  a.append(el("p", "nav-arr-stat", `${fmtDur(Math.max(secs, 60))} on the road${N.driven > 0.05 ? ` · ${fmtMi(N.driven)}` : ""}`));
  a.firstChild.innerHTML = iconSvg("arrive");
  const done = el("button", "primary", "Done"); done.type = "button"; done.onclick = () => end();
  a.append(done);
  try { done.focus({ preventScroll: true }); } catch {}
  renderSlim(); renderSearchPill();
}

/* ---------- the slim banner: guidance keeps running while the normal app is on screen ---------- */
function renderSlim() {
  const box = $id("navBanner");
  if (!box) return;
  const show = (N.state === "navigating" || N.state === "arrived") && !viewShown() && !!N.route;
  box.hidden = !show;
  if (!show) { box.textContent = ""; box.dataset.key = ""; return; }
  const hdr = document.querySelector("header.top");
  if (hdr) box.style.top = Math.round(hdr.getBoundingClientRect().height) + "px";
  let icon, dist, text;
  if (N.state === "arrived") { icon = "arrive"; dist = "Arrived"; text = N.dest ? N.dest.name : ""; }
  else { const g = guideInfo(); icon = g.show.type; dist = fmtDist(g.distTo); text = stepText(g.show, N.dest && N.dest.name); }
  const key = icon + "|" + dist + "|" + text;
  if (box.dataset.key === key) return;
  box.dataset.key = key; box.textContent = "";
  const b = el("button", "nav-slim"); b.type = "button";
  b.setAttribute("aria-label", `Navigation: ${dist}, ${text}. Open`);
  const ic = el("span", "nav-slim-ic"); ic.innerHTML = iconSvg(icon);
  const tx = el("span", "nav-slim-tx"); tx.append(el("b", null, dist), el("span", null, text));
  b.append(ic, tx);
  b.onclick = () => (N.state === "arrived" ? showArrived() : openGuide());
  box.append(b);
}

/* ---------- the pieces of the preview ---------- */
function renderPreview() {
  const r = N.route, d = N.dest;
  V.pvName.textContent = d ? d.name : "";
  V.pvAddr.textContent = d && d.address ? d.address : "";
  const body = V.pvBody; body.textContent = "";
  V.btnStart.disabled = V.btnSteps.disabled = !r;
  if (N.loading) { body.append(el("p", "nav-pv-wait", "Finding the best route…")); setMode("loading"); return; }
  if (N.error || !r) {
    body.append(el("p", "nav-pv-err", N.error || "I couldn't plan that route."));
    const again = el("button", "secondary", "Try again"); again.type = "button"; again.onclick = () => d && preview(d);
    body.append(again);
    setMode("error");
    return;
  }
  setMode("preview");
  const sum = el("div", "nav-sum");
  sum.append(el("b", "nav-sum-time", fmtDur(r.duration_s)), el("span", "nav-sum-mi", fmtMi(r.distance_mi)));
  body.append(sum, el("p", "nav-sum-arr", `Arrive ${fmtClock(now() + r.duration_s * 1000)}`));
  const i5 = N.i5;
  if (i5 && i5.mi >= 3) body.append(el("p", "nav-sum-i5", `${i5.mi >= r.total * 0.5 ? "Mostly on" : "Includes"} I-5 (${Math.round(i5.mi)} mi)`));
  renderSteps();
  drawSketch();
  mapRoute(true);
}
function renderSteps() {
  const r = N.route, box = V.stepsEl;
  box.textContent = "";
  if (!r) return;
  const head = el("div", "nav-steps-head");
  head.append(el("b", null, "Steps"));
  const x = el("button", "nav-iconbtn"); x.type = "button"; x.innerHTML = SVG_CLOSE; x.setAttribute("aria-label", "Close the list of steps"); x.onclick = () => toggleSteps(false);
  head.append(x);
  const ol = el("ol", "nav-steplist");
  r.steps.forEach((s, i) => {
    const li = el("li", "nav-step"); li.dataset.i = i;
    const ic = el("span", "nav-step-ic"); ic.innerHTML = iconSvg(s.type === "depart" ? "straight" : s.type);
    const tx = el("span", "nav-step-tx"); tx.append(el("b", null, stepText(s, N.dest && N.dest.name)));
    const sub = [s.street && !/\b(onto|on)\b/.test(s.text || "") ? s.street : "", s.toward && !/toward/.test(s.text || "") ? `toward ${s.toward}` : ""].filter(Boolean).join(" · ");
    if (sub) tx.append(el("small", null, sub));
    const len = s.distance_mi != null ? s.distance_mi : s.end - s.start;
    li.append(ic, tx, el("span", "nav-step-d", s.type === "arrive" ? "" : fmtDist(len)));
    ol.append(li);
  });
  box.append(head, ol);
}
function toggleSteps(on) {
  const want = on == null ? !V.stepsOpen : !!on;
  V.stepsOpen = want;
  V.stepsEl.hidden = !want;
  for (const b of [V.btnSteps, V.btnSteps2]) b && b.setAttribute("aria-expanded", String(want));
  V.root.classList.toggle("steps-open", want);
  if (want) {
    renderSteps();
    const cur = V.stepsEl.querySelector(`[data-i="${N.state === "navigating" ? Math.min(N.stepIdx + 1, N.route.steps.length - 1) : 0}"]`);
    if (cur) { cur.classList.add("now"); try { cur.scrollIntoView({ block: "center" }); } catch {} }
    try { V.stepsEl.querySelector("button").focus({ preventScroll: true }); } catch {}
  }
}
function setMuted(on) {
  N.muted = !!on; keep("mute", N.muted);
  syncTools();
  if (N.muted) toastMsg("Voice prompts are muted."); else toastMsg("Voice prompts are on.");
}
function syncTools() {
  if (!V.built) return;
  V.btnMute.setAttribute("aria-pressed", String(N.muted));
  V.btnMute.setAttribute("aria-label", N.muted ? "Unmute voice prompts" : "Mute voice prompts");
  V.btnMute.classList.toggle("off", N.muted);
  V.btnOver.setAttribute("aria-pressed", String(N.overview));
  V.recenter.hidden = N.follow || N.overview || V.mode !== "guide";
}

/* ---------- guidance: what the banner, the bottom bar and the map show now ---------- */
function guideUpdate(force) {
  const g = guideInfo();
  if (!g || N.state !== "navigating") { renderSlim(); return; }
  renderSlim();
  if (!viewShown() || V.mode !== "guide") return;
  try { V.root.style.setProperty("--nav-bottom", V.bottom.offsetHeight + "px"); V.root.style.setProperty("--nav-top", V.banner.offsetHeight + "px"); } catch {}
  const text = stepText(g.show, N.dest && N.dest.name);
  V.bnDist.textContent = fmtDist(g.distTo);
  if (V.lastShow !== text) { V.lastShow = text; V.bnText.textContent = text; }
  const icon = g.show.type === "depart" ? "straight" : g.show.type;
  if (V.lastIcon !== icon) { V.lastIcon = icon; V.bnIcon.innerHTML = iconSvg(icon); V.banner.dataset.type = icon; }
  V.bnThen.textContent = g.then ? `Then ${lowerFirst(stepText(g.then))}` : "";
  V.bnThen.hidden = !g.then;
  V.stArr.textContent = fmtClock(g.arriveAt);
  V.stMin.textContent = fmtDur(g.sec);
  V.stMi.textContent = fmtMi(g.left);
  V.spdN.textContent = g.mph != null ? String(Math.round(g.mph)) : "--";
  V.lim.hidden = !g.limit;
  if (g.limit) V.limN.textContent = String(g.limit);
  syncTools();
  drawSketch();
  mapFollow(!!force);
}

/* ================================================================ the map (MapLibre, loaded only now) ================================================================ */
let libPromise = null;
function loadLib() {
  if (typeof window !== "undefined" && window.maplibregl) return Promise.resolve(window.maplibregl);
  if (libPromise) return libPromise;
  const css = el("link"); css.rel = "stylesheet"; css.href = new URL("vendor/maplibre/maplibre-gl.css", BASE).href;
  document.head.append(css);
  libPromise = new Promise((resolve, reject) => {
    const s = el("script"); s.async = true; s.src = new URL("vendor/maplibre/maplibre-gl.js", BASE).href;
    const t = setTimeout(() => { s.remove(); libPromise = null; reject(new Error("script timed out")); }, LIB_MS);
    s.onload = () => { clearTimeout(t); window.maplibregl ? resolve(window.maplibregl) : (libPromise = null, reject(new Error("no maplibregl"))); };
    s.onerror = () => { clearTimeout(t); s.remove(); libPromise = null; reject(new Error("script failed")); };
    document.head.append(s);
  });
  libPromise.catch(() => {});
  return libPromise;
}
const webglOK = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => (cs.getPropertyValue(n) || "").trim() || f;
  return { light: document.documentElement.dataset.theme === "light", bg: v("--bg", "#101412"), accent: v("--accent", "#f2c230"), accentFg: v("--accent-fg", "#1b1a10"), ok: v("--ok", "#5cc46f"), danger: v("--danger", "#e2483f"), signFg: v("--sign-fg", "#ffffff") };
}
function rgba(hex, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(242,194,48,${a})`;
  let h = m[1]; if (h.length === 3) h = [...h].map(c => c + c).join("");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;
/** The basemap is a daytime style: at night its own colours are darkened one by one (same recipe as the 3D map). */
function nightify(map) {
  let ctx = null;
  try { const c = document.createElement("canvas"); c.width = c.height = 1; ctx = c.getContext("2d", { willReadFrequently: true }); } catch {}
  if (!ctx) return;
  const cache = new Map();
  const rgbOf = s => {
    let v = cache.get(s);
    if (v) return v;
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = s; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    cache.set(s, v = [d[0], d[1], d[2], d[3] / 255]);
    return v;
  };
  const dark = s => { const [r, g, b, a] = rgbOf(s), t = 0.7, base = [12, 20, 17]; return `rgba(${[0, 1, 2].map(i => Math.round([r, g, b][i] * (1 - t) + base[i] * t)).join(",")},${Math.round(a * 1000) / 1000})`; };
  const walk = (v, f) => (typeof v === "string" && COLOR_RE.test(v) ? f(v) : Array.isArray(v) ? v.map(x => walk(x, f)) : v);
  for (const l of map.getStyle().layers || []) {
    const paint = l.paint || {};
    for (const k of Object.keys(paint)) {
      try {
        if (k === "text-color" || k === "icon-color") map.setPaintProperty(l.id, k, "#dfe8e2");
        else if (k === "text-halo-color" || k === "icon-halo-color") map.setPaintProperty(l.id, k, "#0b120f");
        else if (/-color$/.test(k)) map.setPaintProperty(l.id, k, walk(paint[k], dark));
      } catch {}
    }
    if (l.type === "raster") { try { map.setPaintProperty(l.id, "raster-brightness-max", 0.3); } catch {} }
  }
}
function routeFeature(r) { return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r ? r.geometry.map(p => [p[1], p[0]]) : [] } }; }
const mapNote = text => { if (V.mapNote) { V.mapNote.textContent = text || ""; V.mapNote.hidden = !text; } };

async function ensureMap() {
  if (V.map || V.mapState === "loading" || V.mapState === "failed" || !viewShown()) return;
  V.mapState = "loading";
  V.root.dataset.map = "loading";
  mapNote("Loading the map…");
  let settled = false, styleOk = false;
  try {
    if (typeof Object.hasOwn !== "function" || typeof [].at !== "function") throw new Error("this browser is too old for the map");
    if (!webglOK()) throw new Error("no 3D graphics");
    const lib = await loadLib();
    if (!viewShown()) { V.mapState = "idle"; return; }
    const T = tokens();
    V.theme = T.light ? "light" : "dark";
    const p = N.route ? pointAt(N.route, 0) : { lat: 36.5, lon: -119.8 };
    const map = new lib.Map({ container: V.mapEl, style: STYLE_URL, center: [p.lon, p.lat], zoom: 12, pitch: 0, bearing: 0, maxPitch: 75, minZoom: 3, attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 0, cooperativeGestures: false });
    V.map = map; V.lib = lib;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the map style did not load")), LIB_MS);
      map.on("error", e => { if (!styleOk && !settled && !(e && (e.tile || e.sourceId))) { clearTimeout(timer); settled = true; reject(new Error("the map style failed")); } });
      map.on("style.load", () => { styleOk = true; try { addScene(); } catch (e) { warn(e); } if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
      try { map.getCanvas().addEventListener("webglcontextlost", ev => { ev.preventDefault(); mapFailed("lost"); }); } catch {}
    });
    if (V.map !== map) return;
    map.on("dragstart", userMoved); map.on("rotatestart", userMoved); map.on("pitchstart", userMoved); map.on("zoomstart", userMoved);
    V.mapState = "ready";
    V.root.dataset.map = "ready";
    mapNote("");
    V.sketchEl.hidden = true;
    if (N.state === "navigating") mapFollow(true); else mapRoute(true);
  } catch (e) {
    warn(e);
    mapFailed(e);
  }
}
function mapFailed(why) {
  destroyMap();
  V.mapState = "failed";
  if (V.root) V.root.dataset.map = "failed";
  mapNote("The map isn't available, so here is a sketch of your route.");
  if (V.sketchEl) V.sketchEl.hidden = false;
  drawSketch();
}
function destroyMap() {
  const m = V.map;
  V.map = null; V.sceneReady = false; V.markers = []; V.car = null; V.gradKey = "";
  if (m) { try { m.remove(); } catch (e) { warn(e); } }
  V.mapState = "idle"; V.carOn = false;
  if (V.root) V.root.dataset.map = "";
  if (V.sketchEl) V.sketchEl.hidden = false;
}
function userMoved(e) {
  if (!e || !e.originalEvent || N.state !== "navigating") return;
  N.follow = false; N.overview = false; syncTools();
}
function addScene() {
  const map = V.map, lib = V.lib;
  if (!map || !lib) return;
  const T = tokens();
  if (!T.light) nightify(map);
  const layers = (map.getStyle().layers || []);
  const firstSymbol = (layers.find(l => l.type === "symbol") || {}).id;
  map.addSource("nav-route", { type: "geojson", lineMetrics: true, data: routeFeature(N.route) });
  const lay = { "line-cap": "round", "line-join": "round" };
  map.addLayer({ id: "nav-route-casing", type: "line", source: "nav-route", layout: lay, paint: { "line-color": T.accentFg, "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12, 18, 22] } }, firstSymbol);
  map.addLayer({ id: "nav-route-line", type: "line", source: "nav-route", layout: lay, paint: { "line-gradient": ["step", ["line-progress"], rgba(T.accent, 0.35), 0, T.accent], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 7.5, 18, 15] } }, firstSymbol);
  // 3D buildings: only when the style has the OpenMapTiles "building" layer to draw them from
  try {
    const bl = layers.find(l => l["source-layer"] === "building" && l.source);
    if (bl && !layers.some(l => l.type === "fill-extrusion")) {
      map.addLayer({ id: "nav-buildings", type: "fill-extrusion", source: bl.source, "source-layer": "building", minzoom: 14.5,
        paint: { "fill-extrusion-color": T.light ? "#d9d6cc" : "#26302b", "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 6], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0], "fill-extrusion-opacity": 0.8 } }, firstSymbol);
    }
  } catch (e) { warn(e); }
  // start, destination and the car
  const dot = (cls, html) => { const e = el("div", cls); e.innerHTML = html; return e; };
  const r = N.route;
  if (r) {
    const a = r.geometry[0], b = r.geometry[r.geometry.length - 1];
    const s = new lib.Marker({ element: dot("nav-mk-start", '<i></i>'), anchor: "center" }).setLngLat([a[1], a[0]]).addTo(map);
    const d = new lib.Marker({ element: dot("nav-mk-dest", iconSvg("arrive")), anchor: "bottom" }).setLngLat([b[1], b[0]]).addTo(map);
    V.markers = [s, d];
  }
  V.car = new lib.Marker({ element: dot("nav-mk-car", '<svg viewBox="-24 -24 48 48" aria-hidden="true"><circle r="19" class="nc-halo"/><path d="M0-15 12 12 0 6-12 12Z" class="nc-arrow"/></svg>'), rotationAlignment: "map", pitchAlignment: "map", anchor: "center" });
  V.sceneReady = true; V.gradKey = ""; V.carOn = false;
  if (N.state === "navigating") mapFollow(true); else mapRoute(true);
}
/** The route on the map (again): after a reroute, or when the preview arrives. fit: zoom to the whole route. */
function mapRoute(fit) {
  const map = V.map;
  if (!map || !V.sceneReady || !N.route) return;
  try {
    const src = map.getSource("nav-route");
    if (src) src.setData(routeFeature(N.route));
    const r = N.route, a = r.geometry[0], b = r.geometry[r.geometry.length - 1];
    if (V.markers[0]) V.markers[0].setLngLat([a[1], a[0]]);
    if (V.markers[1]) V.markers[1].setLngLat([b[1], b[0]]);
    V.gradKey = "";
    paintProgress(0);
    if (fit && N.state !== "navigating") fitRoute();
  } catch (e) { warn(e); }
}
function fitRoute(fromAlong) {
  const map = V.map, r = N.route;
  if (!map || !r) return;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  const g = r.geometry, step = Math.max(1, Math.floor(g.length / 600));
  const from = fromAlong ? segAt(r, fromAlong) : 0;
  for (let i = from; i < g.length; i += step) { const [la, lo] = g[i]; if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo; }
  const h = V.root.clientHeight || 700;
  const top = N.state === "navigating" ? 140 : 90, bottom = N.state === "navigating" ? 150 : Math.min(h * 0.5, (V.pvCard ? V.pvCard.offsetHeight : 220) + 30);
  try {
    map.setPitch(0); map.setBearing(0);
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: { top, bottom, left: 34, right: 34 }, duration: 0, maxZoom: 16 });
  } catch (e) { warn(e); }
}
function paintProgress(along) {
  const map = V.map, r = N.route;
  if (!map || !V.sceneReady || !r) return;
  const T = tokens(), f = r.total > 0 ? clamp(along / r.total, 0, 0.9999) : 0;
  const key = Math.round(f * 4000) + ":" + T.light;
  if (key === V.gradKey) return;
  V.gradKey = key;
  try { map.setPaintProperty("nav-route-line", "line-gradient", ["step", ["line-progress"], rgba(T.accent, 0.35), Math.max(f, 1e-5), T.accent]); } catch {}
}
function zoomFor(g) {
  const mph = g.mph ?? 0;
  let z = 17.3 - clamp((mph - 20) / 45, 0, 1) * 2.8;             // streets about 17, freeway about 14.5
  if (!g.freeway && g.distTo < 0.2 && g.show.type !== "arrive") z += 0.5;
  return Math.round(clamp(z, 14.3, 18) * 20) / 20;
}
function carPoint(g) {
  const r = N.route;
  if (N.snap && N.snap.off < 45) { const p = pointAt(r, N.along), ahead = pointAt(r, Math.min(r.total, N.along + 0.03)); return { lat: p.lat, lon: p.lon, bearing: (N.mph ?? 0) > 2 && N.heading != null && N.snap.off > 20 ? N.heading : (ahead.seg !== p.seg || N.along < r.total ? bearing([p.lat, p.lon], [ahead.lat, ahead.lon]) : p.bearing) }; }
  if (N.lastFix) return { lat: N.lastFix.lat, lon: N.lastFix.lon, bearing: N.heading ?? 0 };
  const p = pointAt(r, 0);
  return { lat: p.lat, lon: p.lon, bearing: p.bearing };
}
function mapFollow(jump) {
  const map = V.map;
  if (!map || !V.sceneReady || !N.route || N.state !== "navigating" || !viewShown() || V.mode !== "guide") return;
  const g = guideInfo(), p = carPoint(g);
  try {
    V.car.setLngLat([p.lon, p.lat]); V.car.setRotation(p.bearing);
    if (!V.carOn) { V.car.addTo(map); V.carOn = true; }
    paintProgress(N.along);
    if (!N.follow || N.overview) return;
    const cam = { center: [p.lon, p.lat], bearing: p.bearing, pitch: PITCH, zoom: zoomFor(g), padding: { top: Math.round(V.root.clientHeight * 0.34), bottom: 0, left: 0, right: 0 } };
    if (jump || reduced()) map.jumpTo(cam); else map.easeTo({ ...cam, duration: 900, easing: t => t });
  } catch (e) { warn(e); }
}
function recenter() {
  N.follow = true; N.overview = false; syncTools();
  try { V.map && V.map.setPadding({ top: Math.round(V.root.clientHeight * 0.34), bottom: 0, left: 0, right: 0 }); } catch {}
  mapFollow(true);
}
function toggleOverview() {
  N.overview = !N.overview;
  if (N.overview) { N.follow = false; if (V.map && V.sceneReady) { try { V.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } catch {} fitRoute(N.along); } }
  else recenter();
  syncTools();
}

/* ---------- the sketch: the route as a simple drawing when the map can't load (never a blank screen) ---------- */
function polyline(pts) { return pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(""); }
function drawSketch() {
  const box = V.sketchEl;
  if (!box || box.hidden || !N.route) return;
  const r = N.route;
  if (N.state === "navigating" && V.mode === "guide") {
    // heading-up: the car at the bottom, the next stretch of the route going up the screen
    const p = carPoint(), g = guideInfo(), th = p.bearing * Math.PI / 180, sn = Math.sin(th), cs = Math.cos(th);
    const kx = 69.17 * Math.cos(p.lat * Math.PI / 180), ky = 69.0;
    const win = clamp(0.2 + ((N.mph ?? 0) / 60) * 0.9, 0.2, 1.2), scale = 230 / win;
    const out = a => [150 + ((a[1] - p.lon) * kx * cs - (a[0] - p.lat) * ky * sn) * scale, 290 - ((a[1] - p.lon) * kx * sn + (a[0] - p.lat) * ky * cs) * scale];
    const i0 = segAt(r, Math.max(0, N.along - 0.15)), i1 = Math.min(r.geometry.length - 1, segAt(r, Math.min(r.total, N.along + win * 1.4)) + 1);
    const here = [], ahead = [];
    for (let i = i0; i <= i1; i++) (r.cum[i] < N.along ? here : ahead).push(out(r.geometry[i]));
    const behind = here.concat([[150, 290]]), front = [[150, 290]].concat(ahead);
    const key = g.show.type;
    box.innerHTML = `<svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A sketch of the road ahead"><path class="sk-behind" d="${polyline(behind)}"/><path class="sk-ahead" d="${polyline(front)}"/><path class="sk-car" d="M150 272 163 302 150 295 137 302Z" data-t="${key}"/></svg>`;
    return;
  }
  // the whole route, north up
  const g = r.geometry, step = Math.max(1, Math.floor(g.length / 400));
  const pts = [];
  for (let i = 0; i < g.length; i += step) pts.push(g[i]);
  pts.push(g[g.length - 1]);
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [la, lo] of pts) { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); }
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180), w = Math.max((maxLon - minLon) * kx, 1e-6), h = Math.max(maxLat - minLat, 1e-6);
  const s = Math.min(260 / w, 300 / h), ox = 150 - (w * s) / 2, oy = 170 + (h * s) / 2;
  const xy = a => [ox + (a[1] - minLon) * kx * s, oy - (a[0] - minLat) * s];
  const path = polyline(pts.map(xy)), a = xy(g[0]), b = xy(g[g.length - 1]);
  box.innerHTML = `<svg viewBox="0 0 300 340" preserveAspectRatio="xMidYMid meet" role="img" aria-label="A sketch of the route from where you are to ${(N.dest && N.dest.name || "your destination").replace(/[<>&"]/g, "")}"><path class="sk-ahead" d="${path}"/><circle class="sk-start" cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="7"/><path class="sk-dest" d="M${b[0].toFixed(1)} ${(b[1] + 2).toFixed(1)}c0 0-11-11-11-19a11 11 0 0 1 22 0c0 8-11 19-11 19Z"/><circle class="sk-hole" cx="${b[0].toFixed(1)}" cy="${(b[1] - 17).toFixed(1)}" r="4"/></svg>`;
}

/* ================================================================ preview: ask for a route and show it ================================================================ */
function normDest(d) {
  if (!d || typeof d !== "object") return null;
  const lat = Number(d.lat), lon = Number(d.lon);
  if (!num(lat) || !num(lon) || !d.name) return null;
  let m = d.m != null && num(Number(d.m)) ? Number(d.m) : null;
  if (m == null) { try { const h = geo.locate(lat, lon); if (h && h.m != null && h.dist <= 1.0) m = Math.round(h.m * 10) / 10; } catch {} }
  return { id: d.id || null, name: String(d.name), address: d.address ? String(d.address) : (d.sub ? String(d.sub) : ""), lat, lon, m, kind: d.kind || "place" };
}
async function preview(dest) {
  const d = normDest(typeof dest === "string" ? (localSearch(dest, 1)[0] && toDest(localSearch(dest, 1)[0])) : dest);
  if (!d) return null;
  if (N.state === "navigating") { openGuide(); return null; }
  N.run++; N.token++; N.pctrl && N.pctrl.abort();
  const my = N.token;
  closeSearch();
  N.dest = d; N.route = null; N.i5 = null; N.error = null; N.loading = true; N.state = "previewing";
  if (V.built) { V.sketchEl.textContent = ""; destroyMap(); V.mapState = "idle"; }
  openView("loading"); renderPreview(); renderSearchPill();
  emit("nav:preview", { dest: d });
  const fail = msg => { if (my !== N.token) return null; N.loading = false; N.error = msg; renderPreview(); return null; };
  // where from: GPS if it has one, else the browser's own location (asks), else the last place on I-5
  let from = positionNow();
  if (!from || from.onRoad) {
    const asked = await askPosition();
    if (my !== N.token) return null;
    if (asked) from = asked;
  }
  if (!from) return fail("I need your location to plan a route. Tap Start GPS on the Drive screen, or allow location, then try again.");
  N.from = from;
  if (consent() !== "yes") {
    const ok = await askConsent();
    if (my !== N.token) return null;
    if (!ok) {                                         // Not now: no route, but a place on I-5 still gets its countdown
      N.state = "idle"; N.dest = null; N.loading = false; closeView(); renderSearchPill();
      if (d.m != null && A.trip && A.trip.setDest && A.trip.setDest({ name: d.name, m: d.m })) toastMsg(`Heading to ${d.name}. Turn-by-turn needs the route service.`);
      else toastMsg("Turn-by-turn needs the route service. Nothing was sent.");
      return null;
    }
  }
  if (!isOnline()) return fail("You're offline, so I can't plan a route. Places along I-5 still work in the app.");
  const ctrl = N.pctrl = new AbortController();
  try {
    const hd = N.heading != null && (N.mph ?? 0) > 3 ? N.heading : (num(S.heading) ? S.heading : null);
    const raw = await P.route({ lat: from.lat, lon: from.lon }, { lat: d.lat, lon: d.lon }, hd, ctrl.signal);
    if (my !== N.token) return null;
    const route = buildRoute(raw, geo.miles);
    if (!route) return fail("I couldn't plan that route.");
    N.route = route; N.loading = false; N.error = null;
    const on = miles_on_i5(route, (la, lo) => geo.locate(la, lo));
    N.i5 = { mi: on, share: route.total > 0 ? on / route.total : 0 };
    emit("nav:route", { route });
    renderPreview();
    try { V.root.focus({ preventScroll: true }); } catch {}
    return route;
  } catch (e) {
    if (my !== N.token || (e && e.aborted)) return null;
    return fail(e && e.words ? e.words : e && e.offline ? "I couldn't reach the route service. Check the connection and try again." : "I couldn't plan that route.");
  }
}

/* ================================================================ the simulator: drive the route with synthetic fixes (tests, demos) ================================================================ */
function haltSim() { const s = N.sim; if (s) { clearInterval(s.timer); s.timer = 0; } }
function simStep() {
  const sim = N.sim;
  if (!sim) return;
  if (N.state !== "navigating" || !N.route) { haltSim(); return; }
  try {
    const r = N.route, cur = r.steps[Math.min(N.stepIdx, r.steps.length - 1)], next = r.steps[N.stepIdx + 1];
    let mph = sim.mph;
    const lim = cur.speed_limit_mph;
    if (!(cur.ref || (lim && lim >= 55))) mph = Math.min(mph, lim || 30);
    if (next && /^(turn|sharp|uturn)/.test(next.type) && next.start - sim.along < 0.05) mph = Math.min(mph, 12);
    mph = Math.max(5, mph);
    sim.t += sim.tick;
    sim.along = Math.min(r.total, sim.along + mph * sim.tick / 3600000);
    const p = pointAt(r, sim.along);
    const hit = geo.locate(p.lat, p.lon, S.m);
    const far = hit.m == null || hit.dist > 1.2;
    S.lat = p.lat; S.lon = p.lon; S.accuracy = 6; S.speed = mph; S.heading = p.bearing;
    sim.count++;
    emit("fix", { lat: p.lat, lon: p.lon, accuracy: 6, m: hit.m, dist: hit.dist, offRoute: far, speed: mph, heading: p.bearing, t: sim.t, sim: true });
    // I-5 Buddy's own position, so the landmark narration plays while the simulated car is near the road (what main.js does for GPS)
    if (A.setPosition && A.S.mode !== "off") {
      if (!far) { sim.farN = 0; A.setPosition(hit.m, { speed: mph, dir: geo.dirFromHeading(p.bearing, hit.m), offRoute: false, jumped: !sim.placed }); sim.placed = true; }
      else { sim.farN = (sim.farN || 0) + 1; if (sim.farN >= 2 && !A.S.offRoute) A.setPosition(A.S.m ?? hit.m ?? 0, { offRoute: true, jumped: true }); }
    }
  } catch (e) { warn("sim", e); haltSim(); }
}
/** Drive along the current route: {mph: cruising speed (default 55; streets are slower), x: speed-up (default 1), sync: run it all now}. */
function simulate(o = {}) {
  if (N.state === "previewing" && N.route) start({ gps: false });
  if (N.state !== "navigating" || !N.route) return false;
  let sim = N.sim;
  if (sim) {                                           // already driving: carry on (new speed, new target), same clock
    if (o.mph) sim.mph = clamp(Number(o.mph) || sim.mph, 5, 95);
    if (o.x) sim.x = Math.max(0.1, Number(o.x) || sim.x);
    if (!o.sync && !sim.timer) sim.timer = setInterval(simStep, Math.max(4, 1000 / sim.x));
  } else sim = N.sim = { t: clockFn(), along: N.snap ? N.along : 0, mph: clamp(Number(o.mph) || 55, 5, 95), x: Math.max(0.1, Number(o.x) || 1), tick: 1000, timer: 0, count: 0, placed: false, farN: 0, mode: A.S.mode, setMode: false };
  if (!sim.started) {
    sim.started = true;
    if (A.S.mode === "off") { try { A.setMode("demo"); sim.setMode = true; } catch (e) { warn(e); } }
    N.lastFix = null; N.snap = null; N.mph = null; N.lastPromptT = -1e9;
  }
  if (o.sync) {
    let guard = 0;
    const until = num(Number(o.until)) && o.until != null ? Number(o.until) : Infinity;   // stop at this many miles along the route (tests, screenshots)
    while (N.sim === sim && N.state === "navigating" && sim.along < until && guard++ < 60000) simStep();
    return { fixes: sim.count, along: sim.along };
  }
  if (!sim.timer) sim.timer = setInterval(simStep, Math.max(4, 1000 / sim.x));
  return true;
}
function stopSimulate() {
  const sim = N.sim;
  if (!sim) return;
  clearInterval(sim.timer);
  N.sim = null;
  N.lastPromptT = -1e9; N.lastRerouteT = -1e9; N.lastFix = null;
  if (sim.setMode && A && A.S.mode === "demo") { try { A.stopAll(false); } catch (e) { warn(e); } }   // the drive was a demo: it ends with it
}

/* ================================================================ Settings > Navigation ================================================================ */
function buildSettings() {
  const host = $id("settingsExtra");
  if (!host || $id("navSettings")) return;
  const wrap = el("div", "nav-set"); wrap.id = "navSettings";
  wrap.append(el("h3", "sub", "Navigation"));
  const f = el("div", "field"); f.append("Voice directions");
  const seg = el("div", "seg wide"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Voice directions");
  for (const [k, label] of [["full", "Full"], ["alerts", "Alerts only"], ["off", "Off"]]) {
    const b = el("button", null, label); b.type = "button"; b.dataset.navVoice = k;
    b.onclick = () => { settings.navVoice = k; try { A.saveSettings(); } catch {} syncSettings(); };
    seg.append(b);
  }
  const hint = el("small", "hint"); hint.id = "navVoiceHint";
  f.append(seg, hint);
  const tg = el("label", "toggle"); const cb = el("input"); cb.type = "checkbox"; cb.id = "navStreets";
  tg.append(cb, "Say street names (uses the phone's voice)");
  cb.onchange = () => { settings.navStreets = cb.checked; try { A.saveSettings(); } catch {} };
  const h2 = el("small", "hint", "Off by default: the app's own voice says turns and exits, and street names show on screen. On, the phone's voice reads every instruction in full.");
  wrap.append(f, tg, h2);
  host.append(wrap);
  syncSettings();
}
function syncSettings() {
  const w = $id("navSettings");
  if (!w) return;
  const v = settings.navVoice || "full";
  for (const b of w.querySelectorAll("[data-nav-voice]")) b.setAttribute("aria-pressed", String(b.dataset.navVoice === v));
  const hint = $id("navVoiceHint");
  if (hint) hint.textContent = { full: "Every heads-up, then the turn itself.", alerts: "Only the turn itself, and Rerouting and Arrived.", off: "No spoken directions. The screen still guides you." }[v];
  const cb = $id("navStreets"); if (cb) cb.checked = !!settings.navStreets;
}

/* ================================================================ init ================================================================ */
export function init(api) {
  try {
    A = api; S = api.S; settings = api.settings; bus = api.bus; store = api.store; voice = api.voice; data = api.data; geo = api.geo; ui = api.ui; native = api.native;
    if (!A || !S || !settings || !bus || !store || !data || !geo) { console.warn("[nav] the app did not give me what I need"); return; }
    if (!["full", "alerts", "off"].includes(settings.navVoice)) settings.navVoice = "full";
    settings.navStreets = !!settings.navStreets;
    N.muted = !!stored("mute", false);
  } catch (e) { console.error("[nav] setup failed", e); return; }
  const on = (evt, fn) => { try { bus.on(evt, (...a) => { try { fn(...a); } catch (e) { warn(evt, e); } }); } catch (e) { warn("bus " + evt, e); } };
  on("fix", onFix);
  on("pos", placePill);
  on("settings", syncSettings);
  on("mode", () => { placePill(); if (N.state === "navigating") queueRender(); });
  on("trip:end", () => { /* ending the trip (GPS) does not end navigation; the person taps End */ });
  try {
    window.addEventListener("online", () => {
      if (N.state === "navigating" && N.wantReroute && N.lastFix) { N.lastRerouteT = -1e9; doReroute(N.lastFix.lat, N.lastFix.lon); }
    });
  } catch {}
  for (const [id, cls, tag] of [["navBanner", "nav-slimbox", "div"]]) { const e = slot(id, cls, tag); e.hidden = true; }
  try { slot("navSearch", "nav-searchslot"); renderSearchPill(); } catch (e) { warn(e); }
  try { buildSettings(); } catch (e) { warn(e); }
  const safe = (name, fn) => (...a) => { try { return fn(...a); } catch (e) { warn(name, e); return undefined; } };
  A.nav = {
    state: () => (N.state === "idle" && SS.open ? "searching" : N.state),
    dest: () => (N.dest ? { ...N.dest } : null),
    route: () => N.route,
    search: q => localSearch(q).map(r => ({ ...r })),
    openSearch: safe("openSearch", openSearch),
    preview: async d => { try { return await preview(d); } catch (e) { warn("preview", e); return null; } },
    start: safe("start", start),
    end: safe("end", end),
    setProvider(p) { if (p && typeof p.search === "function" && typeof p.route === "function") { P = p; return true; } if (p == null) { P = defaultProvider; return true; } return false; },
    phraseBank: () => { const b = bank(); return { units: b.units.slice(), sentences: b.sentences.slice(), count: b.count }; },
    simulate: safe("simulate", simulate),
    stopSimulate: safe("stopSimulate", stopSimulate),
    statusText: () => { try { return statusText(); } catch { return ""; } },
    setMuted: safe("setMuted", setMuted),
    muted: () => N.muted,
    categories: () => CATEGORIES.map(c => ({ id: c.id, label: c.label })),
    categoryAhead: id => categoryAhead(id),
    favorites: favs, recents,
    consent: () => consent(),
    guide: () => { const g = guideInfo(); return g ? { distTo: g.distTo, left: g.left, sec: g.sec, step: g.show, then: g.then, along: N.along, stepIdx: N.stepIdx, mph: N.mph, limit: g.limit } : null; },
    _test: {
      log: () => N.log.map(x => ({ ...x, units: x.units && x.units.slice() })),
      setClock: fn => { clockFn = typeof fn === "function" ? fn : () => Date.now(); },
      N, SS, V,
      fix: f => { emit("fix", f); },
      buildRoute: raw => buildRoute(raw, geo.miles),
      promptUnits, maneuverPhrase, highwayUnit, exitUnits, localSearch, snapToRoute, stepText, iconSvg,
    },
  };
  // modules that drew before nav loaded (trip.js's Where to?) redraw now
  try { emit("nav:ready", {}); } catch {}
}
