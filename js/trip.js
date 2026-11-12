// I-5 Buddy, trip module: where you're headed, the trip log, badges, the Passport screen and a share card.
//
// Owns #destStrip (Drive), #view-passport, two sheets appended to .app ("Where to?" and "Share my trip")
// and a few rows in #settingsExtra. Public API: api.trip (bottom of this file).
//
// Store keys (store.js adds the "i5b:" prefix):
//   dest       the destination {name, m}, mirrored in S.dest (store.js reads it at boot)
//   trips      finished trips, newest first, at most 30
//   badges     {badgeId: time unlocked} (badges this road doesn't offer, earned when the app covered more of I-5, are kept)
//   coverage   miles of road ever driven with GPS (bit k = corridor mile k to k + 1), as a base64 bitset (about 140
//              characters for California; bits past the end of this road, from a version that covered more, are kept)
//   tripCur    the trip in progress, saved every few seconds so a closed tab can pick it up again
//   tripStats  lifetime totals that outlive the 30-trip log {count, demo, miles, demoMiles, best, states, since}
//   destFrom   corridor mile where the countdown to the destination started (progress bar)
//   destDone   {name, m, t, miles, start, stamps} once we arrived
//   tripPrefs  {sayBadges}

const APP_URL = "https://sugplu.github.io/i5-buddy/";
const KEEP = 30;               // trips kept in the log
const RESUME_MS = 45 * 60e3;   // a trip cut off by a closed tab resumes if you start again within this long
const STEP = 0.05;             // miles: smaller moves are GPS jitter, not driving
const SHOW_STAMPS = 24, SHOW_TRIPS = 5;
const SVGNS = "http://www.w3.org/2000/svg";

let A = null, S = null, settings = null, bus = null, store = null, voice = null, D = null, ui = null;
let PLACES = [], STATES = [], REGIONS = [], DESTS = [], MAX_M = 0, NBITS = 1;
// what lies past each end of the road (data.ENDS): {S: {short: "Mexico", long: "the Mexico border"}, N: {short: "Oregon", ...}}
let ENDS = { S: { short: "Mexico", long: "the Mexico border" }, N: { short: "Canada", long: "the Canadian border" } };
const regionPlaces = new Map();  // region id -> places in it (road order)
let DEFS = [];
const DEF = new Map();

let badges = {}, stats = null, prefs = { sayBadges: true };
let coverage = null, covCount = 0, covDirty = false;
let cur = null, curBits = null, anchor = null, anchorT = 0, lastSave = 0;
let destFrom = null, destDone = null, celebrating = false, knownDest = "";

/* ---------- small helpers ---------- */
const $id = id => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, onClick, label) {
  const b = el("button", cls, text);
  b.type = "button";
  if (label) b.setAttribute("aria-label", label);
  if (onClick) b.addEventListener("click", safe("click", onClick));
  return b;
}
function svg(paths, cls = "trip-ic", stroke = false) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", cls);
  for (const d of [].concat(paths)) {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    if (stroke) { p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2.4"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); }
    else p.setAttribute("fill", "currentColor");
    s.append(p);
  }
  return s;
}
const ICON = {
  pin: () => svg("M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Z"),
  x: () => svg("M6 6l12 12M18 6 6 18", "trip-ic", true),
  check: () => svg("M5 12.5l4.5 4.5L19 7.5", "trip-ic", true),
  share: () => svg(["M12 3v12", "M7.5 7.5 12 3l4.5 4.5", "M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"], "trip-ic", true),
  copy: () => svg(["M9 9h10v12H9z", "M5 15V3h10"], "trip-ic", true),
  turn: () => svg(["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"], "trip-ic", true),
};
const sr = text => el("span", "trip-sr", text);   // read by screen readers only
/** Parts separated by a dot; screen readers hear a comma instead. Overpass draws "·" (U+00B7) with zero advance
    width, so it can't be spaced evenly; the separator is a small bullet (U+2022, even side bearings) sized and
    raised in trip.css to look like a middle dot. A line may break after a dot, never before it. */
function dotted(tag, cls, parts) {
  const e = el(tag, cls);
  parts.filter(Boolean).forEach((t, i) => {
    if (i) { const d = el("span", "trip-dot", "•"); d.setAttribute("aria-hidden", "true"); e.append(sr(", "), d, document.createElement("wbr")); }
    e.append(typeof t === "string" ? el("span", null, t) : t);
  });
  return e;
}

const warned = new Set();
function warn(where, e) {
  const k = where + ":" + (e && e.message);
  if (warned.has(k)) return;
  warned.add(k);
  console.warn("[trip] " + where, e);
}
/** Wrap a handler so it can never throw into the app. */
function safe(where, fn) { return (...a) => { try { return fn(...a); } catch (e) { warn(where, e); } }; }

let clock = () => Date.now();
const now = () => clock();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const num = (x, f = 0) => (typeof x === "number" && isFinite(x) ? x : f);
const fmtInt = n => Math.round(num(n)).toLocaleString("en-US");
const fmtMi = d => (d < 9.95 ? (Math.round(d * 10) / 10).toFixed(1) : fmtInt(d));
const plural = (n, one, many) => `${fmtInt(n)} ${Math.round(n) === 1 ? one : many || one + "s"}`;
/** "6 h 20 min". Rounds to whole minutes first so it never says "3 h 60 min". */
function dur(hours) {
  const mins = Math.round(num(hours) * 60);
  if (mins <= 0) return "";
  let s = "";
  try { s = D.fmtDuration ? D.fmtDuration(mins / 60) : ""; } catch {}
  if (s) return s;
  const h = Math.floor(mins / 60), mn = mins % 60;
  return h ? `${h} h ${String(mn).padStart(2, "0")} min` : `${mn} min`;
}
const fmtDay = (t, year) => new Date(t).toLocaleDateString("en-US", year ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
const fmtLong = t => new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
/** "California", "California and Oregon", "California, Oregon and Washington". */
const andList = xs => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);

/* ---------- road data, with fallbacks so missing pieces never throw ---------- */
/** On the road this version covers? Miles saved by a version that covered more of I-5 (a trip in Washington) are not. */
const onRoad = m => typeof m === "number" && isFinite(m) && m >= -1 && m <= MAX_M + 1;
/** Where we are, or null (no position yet, or a stale mile past the end of the road). */
const posM = () => (onRoad(S.m) ? S.m : null);
const stName = st => String(st.name || st.id);
/** "I-5 in California" on a one-state road, "I-5" on the whole road. */
const roadName = () => (STATES.length === 1 ? `I-5 in ${stName(STATES[0])}` : "I-5");
/** "Mexico to Oregon": end to end. */
const endToEnd = () => `${ENDS.S.short} to ${ENDS.N.short}`;
/** Does state st cover corridor miles a to b? (A badge for a stretch of road only shows when the road has it.) */
const reaches = (st, a, b) => STATES.some(s => s.id === st && s.from <= a && s.to >= b);
function stateOf(m) {
  try { if (D.stateAt) return D.stateAt(m) || {}; } catch {}
  return STATES.find(s => m < s.to) || STATES[STATES.length - 1] || {};
}
function regionOf(m) {
  if (!onRoad(m)) return null;   // no mile, or one past the end of this road: no region rather than the last one
  try { if (D.regionAt) return D.regionAt(m) || null; } catch {}
  return REGIONS.find(r => m >= r.from && m < r.to) || REGIONS[REGIONS.length - 1] || null;
}
/** The passport region of a place: by corridor mile, but always one in the place's own state
    (a California landmark at the state line stays in a California region). */
function regionForPlace(p) {
  const r = regionOf(p.m);
  if (!r || !p.st || r.st === p.st) return r;
  let best = null, bd = Infinity;
  for (const x of REGIONS) {
    if (x.st !== p.st) continue;
    const d = p.m < x.from ? x.from - p.m : p.m >= x.to ? p.m - x.to : 0;
    if (d < bd) { bd = d; best = x; }
  }
  return best || r;
}
function placeById(id) {
  try { if (D.placeById) return D.placeById(id) || null; } catch {}
  return PLACES.find(p => p.id === id) || null;
}
function mileWords(m) {
  let lm = null;
  try { lm = D.localMile ? D.localMile(m) : null; } catch {}
  if (!lm) return `mile ${Math.round(m)}`;
  return lm.st === "CA" ? `mile ${Math.round(lm.mi)}` : `${lm.st} mile ${Math.round(lm.mi)}`;
}
const stLow = id => String(id || "").toLowerCase();
/** A destination we can count down to: {name, m} on this road (not, say, Seattle saved when the app covered Washington). */
function validDest(d) {
  return d && typeof d === "object" && typeof d.name === "string" && d.name && onRoad(d.m) ? d : null;
}
const destKey = d => (d ? `${d.name}@${Math.round(d.m * 10)}` : "");
function stamps() { return S.stamps && typeof S.stamps === "object" ? S.stamps : {}; }
function stampCount() { const s = stamps(); let n = 0; for (const p of PLACES) if (s[p.id]) n++; return n; }

/** Landmarks between here and there, the same way narrator.howFar counts them. */
function landmarksTo(m, destM) {
  const d = Math.abs(destM - m), dir = destM >= m ? "N" : "S";
  try { if (A.narrator && A.narrator.upcoming) return A.narrator.upcoming(m, dir, settings.cats, d).length; } catch {}
  const cats = settings.cats instanceof Set ? settings.cats : null;
  return PLACES.filter(p => (!cats || cats.has(p.cat)) && (dir === "N" ? p.m - m : m - p.m) > -0.5 && (dir === "N" ? p.m - m : m - p.m) < d).length;
}

/* ---------- whole miles driven: a tiny bitset ---------- */
const bitsNew = () => new Uint8Array(Math.ceil(NBITS / 8));
/** keepAll: also keep the bytes for miles past the end of this road (coverage saved when the app covered more of
    I-5), so they are written back unchanged and count again if the road is ever extended. */
function bitsFrom(str, keepAll) {
  let bin = "";
  try { bin = atob(String(str || "")); } catch {}
  const b = keepAll && bin.length > Math.ceil(NBITS / 8) ? new Uint8Array(bin.length) : bitsNew();
  for (let i = 0; i < Math.min(bin.length, b.length); i++) b[i] = bin.charCodeAt(i);
  return b;
}
function bitsTo(b) { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
const bitHas = (b, k) => k >= 0 && k < NBITS && !!(b[k >> 3] & (1 << (k & 7)));
function bitSet(b, k) { if (k < 0 || k >= NBITS || bitHas(b, k)) return false; b[k >> 3] |= 1 << (k & 7); return true; }
/** Miles of this road only (the last byte, and kept bytes, can hold bits for miles past its end). */
function bitCount(b) { let n = 0; for (let k = 0; k < NBITS; k++) if (bitHas(b, k)) n++; return n; }
/** Mark every mile of road driven between a and c, where mile k is the stretch from k to k + 1 (so 128 to 312 is
    184 miles, the same as the trip's own count, not 185 mileposts). Returns how many were new. */
function markMiles(b, a, c) {
  let fresh = 0;
  const lo = Math.floor(clamp(Math.min(a, c), 0, MAX_M)), hi = Math.max(lo + 1, Math.ceil(clamp(Math.max(a, c), 0, MAX_M)));
  for (let k = lo; k < hi; k++) if (bitSet(b, k)) fresh++;
  return fresh;
}
const spans = (b, from, to) => { for (let k = from; k < to; k++) if (!bitHas(b, k)) return false; return true; };
function runs(b) {
  const out = [];
  let start = -1;
  for (let k = 0; k <= NBITS; k++) {
    const on = k < NBITS && bitHas(b, k);
    if (on && start < 0) start = k;
    if (!on && start >= 0) { out.push([start, Math.min(k, MAX_M)]); start = -1; }
  }
  return out;
}

/* ---------- badges ---------- */
const COLLECT = [1, 10, 50, 100, 250, 500];
const SUMMIT = [800, 804];   // Siskiyou Summit, corridor miles (OR miles 3 to 7)
const REGION_ICON = { sd: "🌊", la: "🎬", ws: "🐄", dc: "🏛️", sv: "🌾", sh: "🏔️", rv: "🍐", um: "🌲", wv: "🌰", sw: "🌋", ps: "⛴️", ns: "🌷" };
const GROUPS = [
  ["collect", "Stamp collector", ""],
  ["road", "On the road", "Road badges count real GPS drives, not demo drives."],
  ["region", "Regions", "Collect every stamp in a region."],
  ["games", "Games", ""],
];

function buildDefs() {
  const total = PLACES.length;
  const list = [];
  for (const n of COLLECT) {
    list.push({
      id: n === 1 ? "first" : "stamps-" + n, group: "collect", glyph: String(n),
      name: n === 1 ? "First stamp" : `${n} stamps`,
      hint: n === 1 ? "Drive past any landmark" : total >= n ? `Collect ${n} stamps` : `Collect ${n} stamps. The road has ${total} so far.`,
      prog: () => ({ v: stampCount(), max: n }),
    });
  }
  // Road badges follow the road in the data: one that needs a stretch, or a number of states, this road doesn't have
  // is left out (not shown, not counted). Set tools/build.py back to the whole road and they all come back.
  const half = MAX_M / 2, road = [];
  if (reaches("CA", 205, 215)) road.push({ id: "grapevine", group: "road", icon: "🍇", name: "Over the Grapevine", hint: "Drive the Grapevine, CA miles 205 to 215" });
  if (reaches("OR", SUMMIT[0], SUMMIT[1])) {
    let ft = null;
    try { const E = D.ELEV || []; ft = Math.max(...E.slice(SUMMIT[0], SUMMIT[1] + 1).filter(x => typeof x === "number")); if (!isFinite(ft)) ft = null; } catch {}
    road.push({ id: "summit", group: "road", icon: "⛰️", name: "Highest point on I-5", hint: `Cross Siskiyou Summit${ft ? `, ${ft.toLocaleString("en-US")} ft` : ""}, OR miles 3 to 7` });
  }
  if (STATES.length >= 2) road.push({ id: "state-line", group: "road", icon: "🪧", name: "State line", hint: "Drive across a state line" });
  road.push({ id: "halfway", group: "road", glyph: "½", name: "Halfway there", hint: `Cross the middle of ${roadName()}, ${mileWords(half)}` });
  if (STATES.length >= 3) {
    road.push({ id: "three-states", group: "road", icon: "🗺️", name: STATES.length === 3 ? "Three-state run" : `${STATES.length}-state run`,
      hint: `Drive in ${andList(STATES.map(stName))}`,
      prog: () => ({ v: stats.states.filter(s => STATES.some(x => x.id === s)).length, max: STATES.length, unit: "states" }) });
  }
  road.push(
    { id: "century", group: "road", icon: "💯", name: "Century", hint: "Drive 100 miles in one trip", prog: () => ({ v: Math.min(100, bestTrip()), max: 100, text: `Best: ${fmtInt(bestTrip())} mi` }) },
    { id: "long-haul", group: "road", icon: "🚚", name: "Long haul", hint: "Drive 500 miles in one trip", prog: () => ({ v: Math.min(500, bestTrip()), max: 500, text: `Best: ${fmtInt(bestTrip())} mi` }) },
    { id: "border-to-border", group: "road", icon: "🏁", name: "Border to border", hint: `Drive 95% of ${roadName()}, ${endToEnd()}`,
      prog: () => ({ v: covCount, max: Math.ceil(NBITS * 0.95), text: `${pct(covCount / NBITS)} driven` }) },
    { id: "night-owl", group: "road", icon: "🦉", name: "Night owl", hint: "Drive 30 minutes between 10 pm and 4 am" },
    { id: "early-bird", group: "road", icon: "🌅", name: "Early bird", hint: "Drive 10 minutes between 5 and 7 am" },
  );
  list.push(...road);
  for (const r of REGIONS) {
    const n = (regionPlaces.get(r.id) || []).length;
    if (!n) continue; // no landmarks there yet: nothing to complete
    list.push({ id: "region-" + r.id, group: "region", icon: REGION_ICON[r.id] || "📍", st: r.st, name: r.name,
      hint: `Collect all ${n} stamps here`, prog: () => ({ v: regionGot(r.id), max: n }) });
  }
  list.push({ id: "trivia-whiz", group: "games", icon: "🧠", name: "Trivia whiz", hint: "Get 10 trivia questions right", prog: () => ({ v: Math.min(10, triviaRight()), max: 10 }) });
  DEFS = list;
  DEF.clear();
  for (const d of list) DEF.set(d.id, d);
}
const pct = x => { const p = clamp(x, 0, 1) * 100; return (p > 0 && p < 1 ? p.toFixed(1) : Math.round(p)) + "%"; };
const regionGot = id => { const s = stamps(); return (regionPlaces.get(id) || []).filter(p => s[p.id]).length; };
function bestTrip() { return Math.max(num(stats && stats.best), cur && cur.mode === "gps" ? cur.miles : 0); }
const earnedCount = () => DEFS.filter(d => badges[d.id]).length;

/** Right trivia answers from store "trivia" (play.js). Accepts a number, {right|correct|score: n}, or answer lists/maps. */
function countRight(t, depth = 0) {
  if (t == null || depth > 3) return 0;
  if (typeof t === "number") return isFinite(t) ? Math.max(0, t) : 0;
  if (typeof t === "boolean") return t ? 1 : 0;
  if (Array.isArray(t)) return t.filter(x => x === true || (x && typeof x === "object" && (x.ok === true || x.right === true || x.correct === true))).length;
  if (typeof t === "object") {
    for (const k of ["right", "correct", "score", "rightCount", "correctCount", "wins"]) if (typeof t[k] === "number" && isFinite(t[k])) return Math.max(0, t[k]);
    for (const k of ["answers", "answered", "history", "log", "results"]) if (t[k] && typeof t[k] === "object") { const n = countRight(Array.isArray(t[k]) ? t[k] : Object.values(t[k]), depth + 1); if (n) return n; }
    const vals = Object.values(t);
    if (vals.length && vals.every(v => typeof v === "boolean" || (v && typeof v === "object"))) return countRight(vals, depth + 1);
  }
  return 0;
}
const triviaRight = () => countRight(store.get("trivia", null));

function unlock(ids, mode = "full") {
  const fresh = [];
  for (const id of ids) if (DEF.has(id) && !badges[id] && !fresh.includes(id)) fresh.push(id);
  if (!fresh.length) return;
  const t = now();
  for (const id of fresh) badges[id] = t;
  store.set("badges", badges);
  for (const id of fresh) bus.emit("badge", { id, name: DEF.get(id).name });
  if (mode !== "silent") celebrate(fresh, mode === "toast");
}

function celebrate(ids, toastOnly) {
  const names = ids.map(id => DEF.get(id).name);
  const list = andList(names);
  toast(ids.length === 1 ? `New badge: ${names[0]}!` : `${ids.length} new badges: ${list}!`, 4200);
  if (toastOnly) return;
  const talk = settings.narr && prefs.sayBadges !== false && voice.available !== false;
  const text = ids.length === 1 ? `New badge: ${list}.` : `${ids.length} new badges: ${list}.`;
  const t0 = now();
  const opts = { id: "badge:" + ids.join(","), prio: 0, check: () => now() - t0 < 180e3 };
  if (!busy()) chime("success").then(() => { if (talk) say(text, opts); });
  else if (talk) say(text, { ...opts, chime: "success" });   // waits its turn behind landmarks, chime included
  else whenQuiet(() => chime("success"));
}
/** Voice calls that cope with a missing or partial voice module. */
function say(text, opts) {
  try { if (voice && typeof voice.say === "function") return Promise.resolve(voice.say(text, opts)).catch(() => false); } catch (e) { warn("say", e); }
  return Promise.resolve(false);
}
function chime(kind) {
  try { if (voice && typeof voice.chime === "function") return Promise.resolve(voice.chime(kind)).catch(() => {}); } catch (e) { warn("chime", e); }
  return Promise.resolve();
}
function busy() {
  try { return !!((voice.isSpeaking && voice.isSpeaking()) || (voice.queued && voice.queued().length)); } catch { return false; }
}
function whenQuiet(fn, tries = 0) {
  if (!busy()) return fn();
  if (tries < 120) setTimeout(() => whenQuiet(fn, tries + 1), 1000);
}
function toast(text, ms) { try { ui && ui.toast && ui.toast(text, ms); } catch {} }

function checkCollect(mode) {
  const n = stampCount(), ids = [];
  for (const k of COLLECT) if (n >= k) ids.push(k === 1 ? "first" : "stamps-" + k);
  for (const r of REGIONS) { const list = regionPlaces.get(r.id) || []; if (list.length && regionGot(r.id) === list.length) ids.push("region-" + r.id); }
  unlock(ids, mode);
}
function checkTrivia(mode) { if (triviaRight() >= 10) unlock(["trivia-whiz"], mode); }

/* ---------- lifetime totals ---------- */
function loadTrips() {
  const t = store.get("trips", []);
  return Array.isArray(t) ? t.filter(x => x && typeof x === "object" && isFinite(x.start)) : [];
}
function freshStats() { return { count: 0, demo: 0, miles: 0, demoMiles: 0, best: 0, states: [], since: 0 }; }
function addToStats(st, t) {
  st.count++;
  const mi = num(t.miles);
  if (t.demo || t.mode === "demo") { st.demo++; st.demoMiles += mi; }
  else {
    st.miles += mi; st.best = Math.max(st.best, mi);
    for (const x of Array.isArray(t.states) ? t.states : []) if (typeof x === "string" && !st.states.includes(x)) st.states.push(x);
  }
  if (!st.since || t.start < st.since) st.since = t.start;
}
function loadStats() {
  const s = store.get("tripStats", null);
  if (s && typeof s === "object") {
    return { count: num(s.count), demo: num(s.demo), miles: num(s.miles), demoMiles: num(s.demoMiles), best: num(s.best),
      states: Array.isArray(s.states) ? s.states.filter(x => typeof x === "string") : [], since: num(s.since) };
  }
  const st = freshStats();
  for (const t of loadTrips().slice().reverse()) addToStats(st, t);
  return st;
}
const milesDriven = () => num(stats.miles) + (cur && cur.mode === "gps" ? cur.miles : 0);
const tripCount = () => num(stats.count) + (cur ? 1 : 0);

/* ---------- the trip log ---------- */
function newTrip(mode) {
  const t = now();
  return { id: "t" + t.toString(36), start: t, end: null, mode, demo: mode === "demo", startM: null, lastM: null, miles: 0,
    stamps: [], states: [], maxSpeed: 0, nightMinutes: 0, earlyMinutes: 0, updated: t, away: null, arrived: null };
}
function cleanTrip(o) {
  const mode = o.mode === "demo" ? "demo" : "gps";
  return { ...newTrip(mode), ...o, mode, demo: mode === "demo", miles: num(o.miles), maxSpeed: num(o.maxSpeed),
    nightMinutes: num(o.nightMinutes), earlyMinutes: num(o.earlyMinutes),
    startM: typeof o.startM === "number" ? o.startM : null, lastM: typeof o.lastM === "number" ? o.lastM : null,
    stamps: Array.isArray(o.stamps) ? o.stamps.filter(x => typeof x === "string") : [],
    states: Array.isArray(o.states) ? o.states.filter(x => typeof x === "string") : [] };
}
/** The trip a closed tab left behind (still in "tripCur"), or null. */
function leftover() {
  const o = store.get("tripCur", null);
  if (!o || typeof o !== "object" || !isFinite(o.start)) { if (o) store.del("tripCur"); return null; }
  if (cur && o.id === cur.id) return null;
  return o;
}
/** Close out a leftover trip if it is too old to resume (or always, with force). */
function settleLeftover(force) {
  const o = leftover();
  if (!o) return;
  if (!force && now() - num(o.updated, o.start) < RESUME_MS) return;
  store.del("tripCur");
  saveTrip(cleanTrip(o));
}

function startTrip(mode) {
  if (cur && cur.mode === mode) return;
  if (cur) endTrip();
  const o = leftover();
  if (o && o.mode === mode && now() - num(o.updated, o.start) < RESUME_MS) {
    cur = cleanTrip(o);                      // pick the trip back up after a closed tab
    curBits = bitsFrom(o.bits);
    delete cur.bits;
    anchor = cur.lastM; anchorT = num(cur.updated, now());
  } else {
    if (o) { store.del("tripCur"); saveTrip(cleanTrip(o)); }
    cur = newTrip(mode);
    curBits = bitsNew(); anchor = null; anchorT = 0;
  }
  persist(true);
  refresh();
}

function endTrip() {
  if (!cur) return;
  const t = cur;
  cur = null; curBits = null; anchor = null;
  t.end = now(); t.updated = t.end;
  store.del("tripCur");
  saveTrip(t);
  flushCoverage();
  refresh();
}

function saveTrip(t) {
  const rec = { id: t.id, start: t.start, end: t.end || t.updated || t.start, mode: t.mode, demo: t.mode === "demo",
    startM: t.startM, lastM: t.lastM, miles: Math.round(num(t.miles) * 10) / 10, stamps: [...new Set(t.stamps || [])],
    states: [...new Set(t.states || [])], maxSpeed: Math.round(num(t.maxSpeed)), nightMinutes: Math.round(num(t.nightMinutes)) };
  if (t.arrived && t.arrivedName) rec.dest = t.arrivedName;
  if (rec.miles < 0.1 && !rec.stamps.length) return false; // started and stopped without going anywhere
  const list = loadTrips().filter(x => x.id !== rec.id);
  list.push(rec);
  list.sort((a, b) => b.start - a.start);
  store.set("trips", list.slice(0, KEEP));
  addToStats(stats, rec);
  store.set("tripStats", stats);
  return true;
}

function persist(force) {
  if (!cur) return;
  const t = now();
  if (!force && t - lastSave < 10e3) return;
  lastSave = t;
  cur.updated = t;
  store.set("tripCur", { ...cur, bits: bitsTo(curBits) });
  flushCoverage();
  store.set("tripStats", stats);
}
function flushCoverage() { if (covDirty) { covDirty = false; store.set("coverage", bitsTo(coverage)); } }

function onMode(mode) {
  if (mode === "gps" || mode === "demo") startTrip(mode);
  else if (cur) endTrip();       // "off" or "manual": the drive is over
  queueStrip();
}

function onPos(e) {
  if (!cur || !e || typeof e.m !== "number" || !isFinite(e.m)) return queueStrip();
  const m = e.m, t = now();
  if (e.offRoute) { anchor = null; return queueStrip(); }   // not on I-5: count nothing until we're back
  if (cur.startM == null) cur.startM = m;
  cur.lastM = m;
  const st = stateOf(m).id;
  if (st && !cur.states.includes(st)) cur.states.push(st);
  if (S.dest && destFrom == null) setDestFrom(cur.startM);
  if (!e.jumped && typeof e.speed === "number" && isFinite(e.speed)) cur.maxSpeed = Math.max(cur.maxSpeed, Math.min(e.speed, 130));
  syncDest();
  const dest = validDest(S.dest), key = destKey(dest);
  const wasAway = !!dest && cur.away === key;            // away before this fix: a trip that starts at the destination never "arrives" there
  destCheck(m, !!e.jumped);
  if (e.jumped || anchor == null) { anchor = m; anchorT = t; persist(); return queueStrip(); }

  const dm = Math.abs(m - anchor);
  if (dm < STEP) return queueStrip();                    // jitter while parked
  const dtH = Math.max(0, t - anchorT) / 3.6e6;
  const plausible = cur.mode === "demo" ? dm <= 5 : dm <= 0.25 + dtH * 100;
  if (!plausible) { anchor = m; anchorT = t; return queueStrip(); } // a teleport the core did not flag

  const a = anchor;
  cur.miles += dm;
  markMiles(curBits, a, m);
  // Driving time. Fixes can be minutes apart (locked screen, app in the background): count the gap as driving
  // up to the time these miles take at 20 mph, so a long stop between two fixes still isn't driving time.
  const ms = Math.min(t - anchorT, Math.max(120e3, dm / 20 * 3.6e6));
  clockMinutes(t - ms, t);
  anchor = m; anchorT = t;
  // A long gap between fixes can carry us right past the destination: arrive if this stretch crossed it.
  if (wasAway && cur.arrived !== key && !(destDone && destKey(destDone) === key) && (a - dest.m) * (m - dest.m) <= 0) arrive(dest, key);
  if (cur.mode === "gps") roadChecks(a, m);
  persist();
  queueStrip();
  if (ppVisible() && t - ppPosAt > 15e3) { ppPosAt = t; markPassport(); }   // live miles, at most every 15 s
}

/** Add the driving time from t0 to t1 to the Night owl (10 pm to 4 am) and Early bird (5 to 7 am) counts,
    split at each local hour so a long stretch only counts the part that fell in those hours. */
function clockMinutes(t0, t1) {
  for (let x = t0, guard = 0; x < t1 && guard < 200; guard++) {
    const d = new Date(x), h = d.getHours();
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h + 1).getTime();
    const end = Math.min(t1, next > x ? next : x + 3600e3);   // (daylight saving can make "the next hour" odd)
    if (h >= 22 || h < 4) cur.nightMinutes += (end - x) / 60e3;
    else if (h >= 5 && h < 7) cur.earlyMinutes += (end - x) / 60e3;
    x = end;
  }
}

/** Driving badges, from real GPS movement between a and b only. */
function roadChecks(a, b) {
  const fresh = markMiles(coverage, a, b);
  if (fresh) { covCount += fresh; covDirty = true; }
  const ids = [];
  const sa = stateOf(a).id, sb = stateOf(b).id;
  for (const s of [sa, sb]) if (s && !stats.states.includes(s)) stats.states.push(s);
  if (sa && sb && sa !== sb) ids.push("state-line");
  if (STATES.length >= 3 && STATES.every(s => stats.states.includes(s.id))) ids.push("three-states");
  const half = MAX_M / 2;
  if ((a - half) * (b - half) <= 0 && a !== b) ids.push("halfway");
  if (spans(curBits, 205, 215)) ids.push("grapevine");
  if (spans(curBits, SUMMIT[0], SUMMIT[1])) ids.push("summit");   // (unlock() skips badges this road doesn't offer)
  if (cur.miles >= 100) ids.push("century");
  if (cur.miles >= 500) ids.push("long-haul");
  if (covCount >= Math.ceil(NBITS * 0.95)) ids.push("border-to-border");
  if (cur.nightMinutes >= 30) ids.push("night-owl");
  if (cur.earlyMinutes >= 10) ids.push("early-bird");
  unlock(ids);
}

function onStamp(e) {
  const p = e && e.place;
  if (!p || typeof p.id !== "string") return;
  if (cur && !cur.stamps.includes(p.id)) { cur.stamps.push(p.id); persist(); }
  checkCollect("full");
  markPassport();
}

function onReset() {
  store.del("trips"); store.del("badges"); store.del("coverage"); store.del("tripStats"); store.del("tripCur");
  badges = {}; stats = freshStats();
  coverage = bitsNew(); covCount = 0; covDirty = false;
  if (cur) {                                  // keep tracking, but as a fresh trip from here
    const mode = cur.mode;
    cur = newTrip(mode); curBits = bitsNew(); anchor = null;
    persist(true);
  }
  ppFilter = null; ppAllStamps = false; ppAllTrips = false;
  refresh();
}

/* ---------- destination ---------- */
function setDestFrom(m) {
  destFrom = typeof m === "number" && isFinite(m) ? m : null;
  if (destFrom == null) store.del("destFrom"); else store.set("destFrom", destFrom);
}
/** Another module (a voice command) may set S.dest directly: start its countdown the way setDest would. */
function syncDest() {
  const k = destKey(validDest(S.dest));
  if (k === knownDest) return;
  knownDest = k;
  setDestFrom(k && cur && cur.startM != null ? cur.startM : null);
  if (destDone && destKey(destDone) !== k) { destDone = null; store.del("destDone"); }
  celebrating = false;
  if (cur) { cur.away = null; cur.arrived = null; }
}
function setDest(d) {
  d = validDest(d);
  if (!d) return false;
  S.dest = { name: d.name, m: d.m };
  knownDest = destKey(S.dest);
  store.set("dest", S.dest);
  setDestFrom(cur && cur.startM != null ? cur.startM : null);   // progress counts from the start of the trip (set at the next start if none is running)
  destDone = null; store.del("destDone"); celebrating = false;
  if (cur) { cur.away = null; cur.arrived = null; }
  bus.emit("dest", S.dest);
  renderStrip();
  return true;
}
function clearDest() {
  S.dest = null;
  knownDest = "";
  store.del("dest"); setDestFrom(null);
  destDone = null; store.del("destDone"); celebrating = false;
  bus.emit("dest", null);
  renderStrip();
}
function findDest(q) {
  if (validDest(q)) return q;
  const s = String(q || "").trim().toLowerCase();
  if (!s) return null;
  return DESTS.find(d => d.name.toLowerCase() === s) || DESTS.find(d => d.name.toLowerCase().startsWith(s)) || DESTS.find(d => d.name.toLowerCase().includes(s)) || null;
}

/** Arrival: within a mile while driving, after having been away from it on this trip. */
function destCheck(m, jumped) {
  syncDest();
  const dest = validDest(S.dest);
  if (!dest || !cur) return;
  const key = destKey(dest);
  if (cur.arrived === key || (destDone && destKey(destDone) === key)) return;
  const d = Math.abs(dest.m - m);
  if (d > 1.5) cur.away = key;
  else if (d <= 1 && cur.away === key && !jumped) arrive(dest, key);
}
function arrive(dest, key) {
  cur.arrived = key; cur.arrivedName = dest.name;
  destDone = { name: dest.name, m: dest.m, t: now(), miles: Math.round(cur.miles * 10) / 10, start: cur.start, stamps: cur.stamps.length, demo: cur.mode === "demo" };
  store.set("destDone", destDone);
  celebrating = true;
  persist(true);
  toast(`We made it to ${dest.name}!`, 5000);
  if (settings.narr && voice.available !== false) say(`We made it to ${dest.name}.`, { id: "arrive:" + key, prio: 2, chime: "success" });
  else chime("success");
  bus.emit("trip:arrive", { dest: { name: dest.name, m: dest.m } });
  renderStrip();
}

/* ---------- Drive: the destination strip ---------- */
/** Run fn once on the next frame, or after 250 ms if frames are throttled (hidden iframe, headless, low power). */
function batch(fn) {
  let done = false;
  const run = () => { if (done) return; done = true; fn(); };
  try { requestAnimationFrame(run); } catch {}
  setTimeout(run, 250);
}
let stripKey = "", stripQueued = false;
function queueStrip() {
  if (stripQueued) return;
  stripQueued = true;
  batch(() => { stripQueued = false; safe("strip", renderStrip)(); });
}
function stripState() {
  const dest = validDest(S.dest);
  if (!dest) return "none";
  if (destDone && destKey(destDone) === destKey(dest)) return celebrating ? "party" : "done";
  return "go";
}
function renderStrip() {
  const box = $id("destStrip");
  if (!box) return;
  syncDest();
  const state = stripState(), dest = validDest(S.dest);
  const key = state + "|" + destKey(dest);
  if (key !== stripKey || !box.firstChild) {
    stripKey = key;
    box.textContent = "";
    box.append(state === "none" ? buildWhere() : state === "party" ? buildParty(dest) : state === "done" ? buildDone(dest) : buildGo(dest));
  }
  if (state === "go") updateGo(box, dest);
}

function buildWhere() {
  const b = btn("trip-where", null, e => openDest(e.currentTarget));
  const ic = el("span", "trip-where-ic"); ic.append(ICON.pin());
  const tx = el("span", "trip-where-tx");
  tx.append(el("b", null, "Where to?"), el("small", null, "Miles, time and landmarks to go"));
  b.append(ic, tx, el("span", "trip-chev", "›"));
  b.lastChild.setAttribute("aria-hidden", "true");
  return b;
}

function signRow(small, name, onName, right) {
  const row = el("div", "trip-sign");
  const nm = onName ? btn("trip-sign-name", null, onName, `${small} ${name}. Change destination`) : el("div", "trip-sign-name");
  nm.append(el("small", null, small), el("b", null, name));
  row.append(nm);
  if (right) row.append(right);
  return row;
}

function buildGo(dest) {
  const sec = el("section", "trip-dest");
  sec.setAttribute("aria-label", "Destination");
  const mi = el("div", "trip-sign-mi");
  mi.append(el("b", "n", "--"), el("small", null, "mi"));
  const row = signRow("To", dest.name, e => openDest(e.currentTarget), mi);
  row.append(btn("trip-x", null, clearDest, "Clear destination"));
  row.lastChild.append(ICON.x());
  const body = el("div", "trip-dest-body");
  const line = el("p", "trip-line");
  line.append(el("span", "trip-eta"), el("span", "trip-lm"));
  const warnRow = el("p", "trip-behind");
  warnRow.append(ICON.turn(), el("span"));
  warnRow.hidden = true;
  const prog = el("div", "trip-prog");
  const bar = el("div", "trip-bar");
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-label", `Progress to ${dest.name}`);
  bar.append(el("i"));
  prog.append(bar, el("span", "trip-pct"));
  const yet = btn("trip-yet", null, onYet);
  yet.append(el("span", null, "Are we"), el("span", null, " there yet?"));
  body.append(line, warnRow, prog, yet);
  sec.append(row, body);
  return sec;
}

function updateGo(box, dest) {
  const q = s => box.querySelector(s);
  const n = q(".trip-sign-mi .n"), eta = q(".trip-eta"), lm = q(".trip-lm"), warnRow = q(".trip-behind"), prog = q(".trip-prog");
  if (!n) return;
  const m = posM();
  const sec = q(".trip-dest");
  if (m == null) {
    n.textContent = "--";
    eta.textContent = `${mileWords(dest.m)} of I-5`;
    lm.textContent = "Start GPS or a demo drive to count down";
    warnRow.hidden = true; prog.hidden = true;
    sec.classList.remove("behind");
    return;
  }
  const d = Math.abs(dest.m - m);
  const driving = S.mode === "gps" || S.mode === "demo";
  const ahead = S.dir === "S" ? m - dest.m : dest.m - m;
  const settled = S.mode === "demo" || (cur && cur.miles > 0.3);
  const behind = driving && settled && ahead < -1;
  const mph = typeof S.speed === "number" && S.speed > 25 ? S.speed : 62;
  n.textContent = d < 0.95 ? "0" : fmtMi(d);
  if (d <= 1) {
    eta.textContent = `You're at ${dest.name}`;
    lm.textContent = "";
  } else {
    const time = dur(d / mph);
    eta.textContent = time ? `about ${time}` : "";
    const k = landmarksTo(m, dest.m);
    lm.textContent = k ? `${plural(k, "landmark")} to go` : "No landmarks on the way";
  }
  sec.classList.toggle("behind", behind);
  warnRow.hidden = !behind;
  warnRow.lastChild.textContent = behind ? `${dest.name} is behind us, ${fmtMi(d)} mi to the ${dest.m > m ? "north" : "south"}. Turn around when it's easy.` : "";
  const total = destFrom == null ? 0 : Math.abs(dest.m - destFrom);
  const p = total >= 1 ? clamp((total - d) / total, 0, 1) : 0;
  prog.hidden = total < 1 || behind;
  q(".trip-bar i").style.width = (p * 100).toFixed(1) + "%";
  q(".trip-bar").setAttribute("aria-valuenow", String(Math.round(p * 100)));
  q(".trip-pct").textContent = Math.round(p * 100) + "%";
}

function onYet() {
  try { if (typeof voice.unlock === "function") voice.unlock(); } catch {}
  const dest = validDest(S.dest);
  let spoken = false;
  try { if (A.narrator && A.narrator.howFar) { A.narrator.howFar(); spoken = voice.available !== false && typeof voice.say === "function"; } } catch (err) { warn("howFar", err); }
  if (!spoken && dest) {
    const d = posM() == null ? null : Math.abs(dest.m - posM());
    toast(d == null ? `${dest.name} is at ${mileWords(dest.m)} of I-5.` : d < 1 ? `We're there. This is ${dest.name}.` : `${dest.name} is about ${fmtInt(d)} miles away.`, 3500);
  }
  const box = $id("destStrip");
  const card = box && box.querySelector(".trip-dest");
  if (card) { card.classList.remove("pulse"); void card.offsetWidth; card.classList.add("pulse"); }
}

function buildParty(dest) {
  const sec = el("section", "trip-dest trip-party");
  sec.setAttribute("aria-label", `We made it to ${dest.name}`);
  const conf = el("div", "trip-confetti");
  conf.setAttribute("aria-hidden", "true");
  const colors = ["--accent", "--farm", "--hist", "--nature", "--stop", "--odd", "--st-or", "--st-wa"];
  for (let i = 0; i < 26; i++) {
    const c = el("i");
    c.style.left = (3 + (i * 37) % 94) + "%";
    c.style.setProperty("--c", `var(${colors[i % colors.length]})`);
    c.style.setProperty("--dx", ((i * 53) % 90 - 45) + "px");
    c.style.setProperty("--r", ((i * 97) % 720 - 360) + "deg");
    c.style.animationDelay = ((i * 71) % 600) + "ms";
    conf.append(c);
  }
  const party = el("span", "trip-party-ic", "🎉");
  party.setAttribute("aria-hidden", "true");
  const row = signRow("We made it to", dest.name, null, party);
  row.append(btn("trip-x", null, () => { celebrating = false; renderStrip(); }, "Close the celebration"));
  row.lastChild.append(ICON.x());
  const body = el("div", "trip-dest-body trip-party-body");
  const dd = destDone || {};
  const bits = [];
  if (num(dd.miles) >= 0.1) bits.push(`${fmtMi(dd.miles)} mi ${dd.demo ? "on this demo drive" : "this trip"}`);
  if (dd.start) { const time = dur((num(dd.t, now()) - dd.start) / 3.6e6); if (time) bits.push(time); }
  if (num(dd.stamps)) bits.push(plural(dd.stamps, "stamp"));
  body.append(bits.length ? dotted("p", "trip-line trip-party-line", bits) : el("p", "trip-line", "Nice driving."));
  const acts = el("div", "trip-acts");
  const sh = btn("primary trip-share-btn", null, e => openShare("trip", e.currentTarget));
  sh.append(ICON.share(), document.createTextNode("Share my trip"));
  acts.append(sh, btn("secondary", "Where to next?", e => openDest(e.currentTarget)));
  body.append(acts);
  sec.append(conf, row, body);
  return sec;
}

function buildDone(dest) {
  const wrap = el("div", "trip-done");
  const b = btn("trip-where trip-where-done", null, e => openDest(e.currentTarget));
  const ic = el("span", "trip-where-ic"); ic.append(ICON.check());
  const tx = el("span", "trip-where-tx");
  tx.append(el("b", null, `Made it to ${dest.name}`), el("small", null, "Where to next?"));
  b.append(ic, tx, el("span", "trip-chev", "›"));
  b.lastChild.setAttribute("aria-hidden", "true");
  const x = btn("trip-x trip-done-x", null, clearDest, "Clear destination");
  x.append(ICON.x());
  wrap.append(b, x);
  return wrap;
}

/* ---------- sheets ---------- */
function makeSheet(id, title) {
  const sh = el("aside", "sheet trip-sheet");
  sh.id = id; sh.hidden = true;
  sh.setAttribute("role", "dialog"); sh.setAttribute("aria-modal", "true"); sh.setAttribute("aria-labelledby", id + "Title");
  const head = el("div", "sheet-head");
  const h = el("b", null, title); h.id = id + "Title";
  head.append(h, btn("link", "Close", closeSheet));
  sh.append(head);
  (document.querySelector(".app") || document.body).append(sh);
  // give focus back to whatever opened the sheet when it closes (backdrop, Escape or Close)
  try {
    new MutationObserver(() => {
      if (!sh.hidden || !sh._opener) return;
      const o = sh._opener, home = sh._home;
      sh._opener = null; sh._home = null;
      const a = document.activeElement;
      if (a && a !== document.body && !sh.contains(a)) return;
      let t = o.isConnected ? o : null;            // the opener may have been rebuilt meanwhile
      const k = o.dataset && o.dataset.k;
      if (!t && k) t = [...document.querySelectorAll("[data-k]")].find(x => x.dataset.k === k) || null;
      if (!t && home && home.isConnected) t = home.querySelector("button");
      if (t) t.focus({ preventScroll: true });
    }).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
  } catch {}
  return sh;
}
function showSheet(sh, opener) {
  sh._opener = opener && opener.focus ? opener : null;
  sh._home = opener && opener.closest ? opener.closest("#destStrip, #view-passport") : null;
  if (ui && ui.openSheet) ui.openSheet(sh);
  else { sh.hidden = false; const back = $id("sheetBack"); if (back) back.hidden = false; }
}
function closeSheet() {
  if (ui && ui.closeSheet) return ui.closeSheet();
  for (const id of ["tripDestSheet", "tripShareSheet"]) { const s = $id(id); if (s) s.hidden = true; }
  const back = $id("sheetBack"); if (back) back.hidden = true;
}

let destSheet = null;
function openDest(opener) {
  if (!destSheet) {
    destSheet = makeSheet("tripDestSheet", "Where to?");
    destSheet.classList.add("trip-dsheet");
    destSheet.append(el("p", "trip-lede", "Pick a stop. I'll count down the miles, the time and the landmarks on the way."), el("div", "trip-dlist"));
  }
  fillDestSheet();
  showSheet(destSheet, opener);
  const here = destSheet.querySelector(".trip-here, .trip-dopt.at");
  if (here) try { here.scrollIntoView({ block: "center" }); } catch {}
}

function fillDestSheet() {
  const box = destSheet.querySelector(".trip-dlist");
  box.textContent = "";
  const list = DESTS.slice().sort((a, b) => a.m - b.m);
  if (!list.length) { box.append(el("p", "trip-empty", "No destinations in this version of the road data.")); return; }
  const here = posM();
  const mph = typeof S.speed === "number" && S.speed > 25 ? S.speed : 62;
  const curKey = destKey(validDest(S.dest));
  const hereSt = here == null ? null : stateOf(here).id;
  const groups = STATES.map(s => ({ s, items: list.filter(d => stateOf(d.m).id === s.id) })).filter(g => g.items.length);
  const orphans = list.filter(d => !groups.some(g => g.items.includes(d)));
  if (orphans.length) groups.push({ s: { id: "", name: "Other" }, items: orphans });
  for (const g of groups) {
    const sec = el("section", "trip-dgroup trip-st-" + stLow(g.s.id));
    const h = el("h3", "trip-dstate");
    h.append(el("i"), el("span", null, g.s.name));
    sec.append(h);
    const ul = el("ul", "trip-dopts");
    let placed = here == null || g.s.id !== hereSt;
    const marker = () => {
      const li = el("li", "trip-here");
      li.append(el("i"), dotted("span", null, ["You're here", mileWords(here)]));
      return li;
    };
    for (const d of g.items) {
      const dist = here == null ? null : Math.abs(d.m - here);
      if (!placed && dist > 1 && d.m > here) { ul.append(marker()); placed = true; }
      if (!placed && dist != null && dist <= 1) placed = true;
      const li = el("li");
      const isCur = destKey(d) === curKey;
      const b = btn("trip-dopt" + (dist != null && dist <= 1 ? " at" : ""), null, () => { setDest(d); closeSheet(); toast(`Heading to ${d.name}`); });
      b.setAttribute("aria-pressed", String(isCur));
      const nm = el("span", "nm", d.name);
      const meta = el("span", "meta");
      if (dist == null) meta.append(el("small", null, mileWords(d.m)));
      else if (dist <= 1) meta.append(el("b", null, "You're here"));
      else {
        meta.append(el("b", null, `${fmtInt(dist)} mi`), dotted("small", null, [d.m > here ? "north" : "south", dur(dist / mph)]));
      }
      b.append(nm, meta);
      if (isCur) { const c = el("span", "trip-dcheck"); c.append(ICON.check()); b.append(c); }
      li.append(b);
      ul.append(li);
    }
    if (!placed) ul.append(marker());
    sec.append(ul);
    box.append(sec);
  }
  if (validDest(S.dest)) {
    box.append(btn("secondary trip-dclear", "No destination", () => { clearDest(); closeSheet(); }));
  }
}

/* ---------- Passport ---------- */
let ppQueued = false, ppDirty = true, ppFilter = null, ppAllStamps = false, ppAllTrips = false, ppPosAt = 0, ppTouchAt = 0;
function ppVisible() { const v = $id("view-passport"); return !!v && !v.hidden; }
function markPassport() { ppDirty = true; if (ppVisible()) queuePassport(); }
function queuePassport() {
  if (ppQueued) return;
  ppQueued = true;
  const go = () => {
    // don't swap the screen out from under a finger: wait until the tap is over
    if (Date.now() - ppTouchAt < 700) return setTimeout(go, 400);
    ppQueued = false;
    if (ppVisible()) safe("passport", renderPassport)();
  };
  batch(go);
}
function refresh() { queueStrip(); markPassport(); }

function renderPassport() {
  const view = $id("view-passport");
  if (!view) return;
  ppDirty = false;
  const a = document.activeElement;
  const focusKey = a && view.contains(a) && a.dataset ? a.dataset.k : null;
  const root = el("div", "pp");
  for (const part of [ppCover, ppRegions, ppBadges, ppStamps, ppTrips]) {
    try { const n = part(); if (n) root.append(n); } catch (e) { warn("passport " + part.name, e); }
  }
  view.textContent = "";
  view.append(root);
  if (focusKey) {
    const f = [...view.querySelectorAll("[data-k]")].find(x => x.dataset.k === focusKey);
    if (f) f.focus({ preventScroll: true });
  }
}

/** Scroll the page so `target` starts just below the app's sticky top bar (scrollIntoView would tuck it underneath). */
function scrollUnderTopBar(target, smooth) {
  if (!target) return;
  try {
    const top = document.querySelector("header.top");
    let cover = 0;
    if (top) {
      const cs = getComputedStyle(top);
      if (cs.position === "sticky" || cs.position === "fixed") cover = (parseFloat(cs.top) || 0) + top.offsetHeight;
    }
    const y = Math.max(0, target.getBoundingClientRect().top + window.scrollY - cover - 8);
    const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: y, behavior: smooth && !still ? "smooth" : "auto" });
  } catch (e) { warn("scroll", e); }
}

function secHead(title, note) {
  const h = el("div", "pp-head");
  h.append(el("h3", "sub", title));
  if (note) h.append(el("span", "pp-head-note", note));
  return h;
}
/** A small progress bar. With a label it is a named progressbar; without one it is decoration that screen readers
    skip, for bars whose value is already in the text beside them (an unnamed progressbar reads as a bare "58%"). */
function bar(p, label) {
  const b = el("div", "pp-bar");
  if (label) {
    b.setAttribute("role", "progressbar"); b.setAttribute("aria-valuemin", "0"); b.setAttribute("aria-valuemax", "100");
    b.setAttribute("aria-valuenow", String(Math.round(clamp(p, 0, 1) * 100)));
    b.setAttribute("aria-label", label);
  } else b.setAttribute("aria-hidden", "true");
  const i = el("i"); i.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + "%";
  b.append(i);
  return b;
}

function shieldSvg(cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 58 62"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(SVGNS, "use");
  u.setAttribute("href", "#shield");
  s.append(u);
  return s;
}

function sinceTime() {
  let t = num(stats.since) || 0;
  const s = stamps();
  for (const k in s) if (typeof s[k] === "number" && s[k] > 1e12 && (!t || s[k] < t)) t = s[k];
  if (cur && (!t || cur.start < t)) t = cur.start;
  return t;
}

function ppCover() {
  const sec = el("header", "pp-cover");
  const top = el("div", "pp-cover-top");
  const tt = el("div", "pp-cover-tt");
  const since = sinceTime();
  tt.append(el("h2", "pp-title", "I-5 Passport"), el("p", "pp-since", since ? `Collecting since ${fmtDay(since, true)}` : `${endToEnd()}, one stamp at a time`));
  top.append(shieldSvg("pp-shield"), tt);
  sec.append(top);

  // the stats read like a highway distance sign
  const n = stampCount(), N = PLACES.length;
  const dl = el("dl", "pp-dist");
  const demoN = num(stats.demo) + (cur && cur.mode === "demo" ? 1 : 0);
  const rows = [
    ["Stamps", fmtInt(n), N ? `of ${fmtInt(N)}` : ""],
    ["Miles driven", fmtInt(milesDriven()), ""],
    ["Trips", fmtInt(tripCount()), demoN ? `${fmtInt(demoN)} demo` : ""],
    ["Badges", fmtInt(earnedCount()), `of ${DEFS.length}`],
  ];
  for (const [label, v, sub] of rows) {
    const r = el("div", "pp-dist-row");
    const dd = el("dd");
    dd.append(el("b", null, v));
    if (sub) dd.append(el("small", null, sub));
    r.append(el("dt", null, label), dd);
    dl.append(r);
  }
  sec.append(dl);

  // the road, with what you've driven
  const cov = el("div", "pp-cov");
  cov.append(roadRibbon());
  cov.append(covCount ? dotted("p", "pp-cov-txt", [`${pct(covCount / NBITS)} of ${roadName()} driven`, `${fmtInt(covCount)} of ${fmtInt(NBITS)} miles`])
    : el("p", "pp-cov-txt", "Drive with GPS to fill in the road"));
  sec.append(cov);

  const has = n || tripCount() || earnedCount();
  if (has) {
    const acts = el("div", "pp-cover-acts");
    const sh = btn("pp-btn pp-btn-main", null, e => openShare(null, e.currentTarget));
    sh.dataset.k = "share";
    sh.append(ICON.share(), document.createTextNode("Share my trip"));
    const cp = btn("pp-btn", null, () => copySummary(defaultKind()));
    cp.dataset.k = "copy";
    cp.append(ICON.copy(), document.createTextNode("Copy summary"));
    acts.append(sh, cp);
    sec.append(acts);
  }
  return sec;
}

function roadRibbon() {
  const W = Math.max(1, MAX_M);
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", `0 0 ${W} 14`); s.setAttribute("preserveAspectRatio", "none");
  s.setAttribute("class", "pp-rib"); s.setAttribute("aria-hidden", "true");
  const rect = (x, y, w, h, cls) => {
    const r = document.createElementNS(SVGNS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", Math.max(0, w)); r.setAttribute("height", h); r.setAttribute("class", cls);
    s.append(r);
  };
  rect(0, 4, W, 6, "bg");
  for (const st of STATES) rect(st.from, 4, st.to - st.from, 6, "st pp-st-" + stLow(st.id));
  for (const [a, b] of runs(coverage)) rect(a, 2, Math.max(b - a, W / 300), 10, "run");
  const wrap = el("div", "pp-rib-wrap");
  wrap.append(s);
  const labels = el("div", "pp-rib-lbl");
  labels.setAttribute("aria-hidden", "true");
  for (const r of ribbonLabels()) {
    const l = el("span", r.align === "left" ? "l" : r.align === "right" ? "r" : null, r.text);
    l.style.left = (r.x * 100).toFixed(2) + "%";
    labels.append(l);
  }
  wrap.append(labels);
  return wrap;
}
/** The words under the road ribbon (Passport cover and share card), as {text, x: 0..1 along the road, align}.
    Several states: each state's id under its stretch. One state: its name, with what lies past each end
    ("MEXICO", "CALIFORNIA", "OREGON"). */
function ribbonLabels() {
  const W = Math.max(1, MAX_M);
  const mid = st => clamp((st.from + st.to) / 2 / W, 0, 1);
  if (STATES.length !== 1) return STATES.map(st => ({ text: st.id, x: mid(st), align: "center" }));
  return [
    { text: ENDS.S.short.toUpperCase(), x: 0, align: "left" },
    { text: stName(STATES[0]).toUpperCase(), x: mid(STATES[0]), align: "center" },
    { text: ENDS.N.short.toUpperCase(), x: 1, align: "right" },
  ];
}

function ppRegions() {
  if (!REGIONS.length) return null;
  const sec = el("section", "pp-sec");
  const s = stamps();
  sec.append(secHead("Regions", "Tap one to see its stamps"));
  for (const st of STATES) {
    const regs = REGIONS.filter(r => r.st === st.id);
    if (!regs.length) continue;
    let tot = 0, got = 0;
    for (const r of regs) { const l = regionPlaces.get(r.id) || []; tot += l.length; got += l.filter(p => s[p.id]).length; }
    const grp = el("div", "pp-state pp-st-" + stLow(st.id));
    const h = el("h4", "pp-state-h");
    h.append(el("i"), el("span", null, st.name), el("small", null, tot ? `${fmtInt(got)} of ${fmtInt(tot)} stamps` : "No landmarks here yet"));
    grp.append(h);
    if (!tot) {
      const ul = el("ul", "pp-soon");
      for (const r of regs) ul.append(el("li", null, r.name));
      grp.append(ul);
      sec.append(grp);
      continue;
    }
    const grid = el("div", "pp-regions");
    for (const r of regs) {
      const list = regionPlaces.get(r.id) || [];
      const g = list.filter(p => s[p.id]).length;
      const done = list.length > 0 && g === list.length;
      const b = btn("pp-region" + (done ? " done" : "") + (list.length ? "" : " empty"), null, () => {
        ppFilter = ppFilter === r.id ? null : r.id;
        renderPassport();
        if (ppFilter) scrollUnderTopBar($id("ppStamps"), true);
      }, list.length ? `${r.name}, ${g} of ${list.length} stamps` : `${r.name}, no landmarks yet`);
      b.dataset.k = "region:" + r.id;
      b.setAttribute("aria-pressed", String(ppFilter === r.id));
      if (!list.length) b.disabled = true;
      const meta = el("span", "pp-region-meta");
      meta.append(el("span", "ct", list.length ? `${g} of ${list.length}` : "No landmarks yet"));
      if (done) { const m = el("span", "pp-region-medal", REGION_ICON[r.id] || "✓"); m.setAttribute("aria-hidden", "true"); meta.append(m); }
      b.append(el("b", "nm", r.name), meta, bar(list.length ? g / list.length : 0));   // the button's label carries the count
      grid.append(b);
    }
    grp.append(grid);
    sec.append(grp);
  }
  return sec;
}

function ppBadges() {
  const sec = el("section", "pp-sec");
  sec.append(secHead("Badges", `${earnedCount()} of ${DEFS.length}`));
  for (const [gid, label, note] of GROUPS) {
    const items = DEFS.filter(d => d.group === gid);
    if (!items.length) continue;
    const grp = el("div", "pp-bgroup");
    const h = el("h4", "pp-bgroup-h", label);
    grp.append(h);
    if (note) grp.append(el("p", "pp-note", note));
    const ul = el("ul", "pp-badges");
    for (const d of items) {
      const at = badges[d.id];
      const li = el("li", `pp-badge pp-g-${d.group}${d.st ? " pp-st-" + stLow(d.st) : ""} ${at ? "on" : "off"}`);
      const medal = el("span", "pp-medal");
      medal.setAttribute("aria-hidden", "true");
      medal.append(d.glyph ? el("b", "glyph" + (d.glyph.length > 2 ? " long" : ""), d.glyph) : el("span", "emo", d.icon));
      li.append(medal, el("b", "nm", d.name));
      if (at) {
        li.append(el("small", "when", fmtDay(at, true)));
      } else {
        li.append(sr("Locked. "), el("small", "how", d.hint));
        let p = null;
        try { p = d.prog ? d.prog() : null; } catch {}
        if (p && p.max && p.v > 0) {
          const pr = el("span", "pp-bprog");
          pr.append(bar(p.v / p.max), el("small", null, p.text || `${fmtInt(p.v)} of ${fmtInt(p.max)}${p.unit ? " " + p.unit : ""}`));   // the text says it; the bar is decoration
          li.append(pr);
        }
      }
      ul.append(li);
    }
    grp.append(ul);
    sec.append(grp);
  }
  return sec;
}

function stampRot(id) {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 15) + 15) % 15 - 7;
}
const CAT_ICON = () => D.CAT_ICON || {};
const CAT_NAME = () => D.CATS || {};

function ppStamps() {
  const sec = el("section", "pp-sec pp-stamps-sec");
  sec.id = "ppStamps";
  const s = stamps();
  const region = ppFilter ? REGIONS.find(r => r.id === ppFilter) : null;
  if (ppFilter && !region) ppFilter = null;
  const list = region ? regionPlaces.get(region.id) || [] : PLACES;
  const got = list.filter(p => s[p.id]).sort((a, b) => num(s[b.id]) - num(s[a.id]) || a.m - b.m);
  const todo = list.filter(p => !s[p.id]);
  const all = got.concat(todo);
  sec.append(secHead("Stamps", list.length ? `${got.length} of ${list.length}` : ""));
  if (region) {
    const f = el("div", "pp-filter");
    const chip = btn("pp-chip", null, () => { ppFilter = null; renderPassport(); }, `Showing ${region.name}. Show every region`);
    chip.dataset.k = "filter";
    chip.append(el("span", null, region.name), ICON.x());
    f.append(chip);
    sec.append(f);
  }
  if (!all.length) {
    sec.append(el("p", "pp-empty", "No landmarks in the road data yet."));
    return sec;
  }
  if (!got.length && !region) sec.append(el("p", "pp-empty", "Every landmark you drive past stamps your passport. Here is what's waiting for you."));
  const limit = region || ppAllStamps ? all.length : SHOW_STAMPS;
  const ul = el("ul", "pp-stamps");
  for (const p of all.slice(0, limit)) ul.append(stampEl(p, s[p.id]));
  sec.append(ul);
  if (all.length > limit) {
    const more = btn("secondary pp-more", `Show all ${fmtInt(all.length)} stamps`, () => { ppAllStamps = true; renderPassport(); });
    more.dataset.k = "stamps-more";
    sec.append(more);
  } else if (!region && ppAllStamps && all.length > SHOW_STAMPS) {
    const less = btn("secondary pp-more", "Show fewer", () => {
      ppAllStamps = false; renderPassport();
      scrollUnderTopBar($id("ppStamps"), false);
    });
    less.dataset.k = "stamps-more";
    sec.append(less);
  }
  return sec;
}

function stampEl(p, at) {
  const li = el("li");
  const b = btn(`pp-stamp ${p.cat || ""}${at ? " got" : ""}`, null, () => { if (ui && ui.placeSheet) ui.placeSheet(p); });
  b.dataset.k = "stamp:" + p.id;
  if (at) b.style.setProperty("--rot", stampRot(p.id) + "deg");
  const ring = el("span", "ring");
  ring.setAttribute("aria-hidden", "true");
  ring.append(el("small", "ex-l", p.st && p.st !== "CA" ? `${p.st} EXIT` : "EXIT"), el("b", "ex" + (String(p.ex || "").length > 3 ? " long" : ""), p.ex != null ? String(p.ex) : "--"));
  ring.append(el("small", "dt", at && typeof at === "number" && at > 1e12 ? fmtDay(at).toUpperCase() : at ? "✓" : CAT_ICON()[p.cat] || ""));
  b.append(ring, el("span", "nm", p.name));
  let exitTxt = "";
  try { exitTxt = D.exitName ? D.exitName(p.st, p.ex) : `Exit ${p.ex}`; } catch {}
  b.setAttribute("aria-label", `${p.name}, ${CAT_NAME()[p.cat] || ""}, ${exitTxt}. ${at ? (typeof at === "number" && at > 1e12 ? `Stamped ${fmtDay(at, true)}` : "Stamped") : "Not stamped yet"}`);
  li.append(b);
  return li;
}

function ppTrips() {
  const sec = el("section", "pp-sec");
  const trips = loadTrips();
  const rows = [];
  if (cur) rows.push({ ...cur, live: true });
  else { const o = leftover(); if (o) rows.push({ ...cleanTrip(o), paused: true }); }
  rows.push(...trips);
  sec.append(secHead("Recent trips", trips.length ? `${trips.length} saved on this phone` : ""));
  if (!rows.length) {
    const box = el("div", "pp-empty-card");
    box.append(el("p", null, "No trips yet. Tap Start GPS on the Drive screen when you hit the road, and each drive shows up here with its miles and stamps."));
    const go = btn("secondary", "Go to Drive", () => ui && ui.go && ui.go("drive"));
    go.dataset.k = "go-drive";
    box.append(go);
    sec.append(box);
    return sec;
  }
  const ol = el("ol", "pp-trips");
  const limit = ppAllTrips ? rows.length : SHOW_TRIPS;
  for (const t of rows.slice(0, limit)) ol.append(tripRow(t));
  sec.append(ol);
  if (rows.length > SHOW_TRIPS) {
    const more = btn("secondary pp-more", ppAllTrips ? "Show fewer" : `Show all ${rows.length} trips`, () => { ppAllTrips = !ppAllTrips; renderPassport(); });
    more.dataset.k = "trips-more";
    sec.append(more);
  }
  return sec;
}

function tripRow(t) {
  const demo = t.demo || t.mode === "demo";
  const li = el("li", "pp-trip" + (demo ? " demo" : "") + (t.live ? " live" : ""));
  const date = el("div", "pp-tdate");
  date.setAttribute("aria-hidden", "true");
  if (t.live) date.append(el("small", null, "NOW"), el("b", "live-dot"));
  else {
    const d = new Date(t.start);
    date.append(el("small", null, d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()), el("b", null, String(d.getDate())));
  }
  const body = el("div", "pp-tbody");
  // (a trip saved when the app covered more of I-5 can start or end past this road: it has no region there)
  const from = regionOf(t.startM), to = regionOf(t.lastM);
  const route = el("p", "pp-troute");
  route.append(sr(t.live ? "Trip in progress. " : `${fmtLong(t.start)}. `));
  if (from && to && from.id !== to.id) {
    route.append(el("span", null, from.name));
    const arr = el("span", "pp-arrow", " → "); arr.setAttribute("aria-hidden", "true");
    route.append(arr, sr(" to "), el("span", null, to.name));
  } else route.append(el("span", null, (from || to) ? (from || to).name : "On I-5"));
  const parts = [`${fmtMi(num(t.miles))} mi`];
  const end = t.live ? now() : num(t.end, t.start);
  const time = dur((end - t.start) / 3.6e6);
  if (time && end - t.start >= 60e3) parts.push(time);
  const sn = (t.stamps || []).length;
  parts.push(plural(sn, "stamp"));
  if (t.dest) parts.push(`made it to ${t.dest}`);
  body.append(route, dotted("p", "pp-tmeta", parts));
  li.append(date, body);
  if (demo || t.live || t.paused) {
    const tag = el("span", "pp-tag" + (t.live ? " live" : ""), t.live ? (demo ? "Demo now" : "Driving") : t.paused ? "Paused" : "Demo");
    li.append(tag);
  }
  return li;
}

/* ---------- share card ---------- */
function latestTrip() {
  if (cur) return { ...cur, live: true };
  const o = leftover();
  if (o) return cleanTrip(o);
  return loadTrips()[0] || null;
}
const defaultKind = () => (latestTrip() ? "trip" : "all");

function topRegions(ids) {
  const counts = new Map();
  for (const id of ids) { const p = placeById(id); const r = p && regionForPlace(p); if (r) counts.set(r.id, (counts.get(r.id) || 0) + 1); }
  return [...counts].map(([id, n]) => ({ r: REGIONS.find(x => x.id === id), n, of: (regionPlaces.get(id) || []).length }))
    .filter(x => x.r).sort((a, b) => b.n - a.n || a.r.from - b.r.from).slice(0, 3);
}

function cardData(kind) {
  const t = kind === "trip" ? latestTrip() : null;
  const earned = DEFS.filter(d => badges[d.id]).sort((a, b) => badges[b.id] - badges[a.id]);
  if (t) {
    const from = regionOf(t.startM), to = regionOf(t.lastM);
    const end = t.live ? now() : num(t.end, t.start);
    const fresh = earned.filter(d => badges[d.id] >= t.start && badges[d.id] <= end + 1000);
    const title = from && to && from.id !== to.id ? [from.name, "to " + to.name] : [(from || to) ? (from || to).name : "Interstate 5"];
    const dest = t.dest || (t.arrived && t.arrivedName) || null;
    const demo = t.mode === "demo" || !!t.demo;
    const showNew = fresh.length > 0;   // no new badges on this trip: show the collection instead of a zero
    return { kind: "trip", demo, kicker: demo ? "MY I-5 DEMO DRIVE" : dest ? `MY I-5 TRIP TO ${dest.toUpperCase()}` : "MY I-5 TRIP",
      title, date: t.start, miles: num(t.miles), stamps: (t.stamps || []).length,
      badges: showNew ? fresh.length : earned.length, newBadges: fresh.length,
      labels: ["MILES", "STAMPS", showNew ? (fresh.length === 1 ? "NEW BADGE" : "NEW BADGES") : earned.length === 1 ? "BADGE" : "BADGES"],
      subs: [demo ? "demo drive" : "this trip", "this trip", showNew ? "this trip" : `of ${DEFS.length}`],
      top: topRegions(t.stamps || []), range: onRoad(t.startM) || onRoad(t.lastM) ? [t.startM, t.lastM].filter(x => typeof x === "number" && isFinite(x)) : null,
      ticks: (t.stamps || []).map(id => placeById(id)).filter(Boolean).map(p => p.m), at: onRoad(t.lastM) ? t.lastM : null, medals: showNew ? fresh : [] };
  }
  const s = stamps();
  const ids = PLACES.filter(p => s[p.id]).map(p => p.id);
  return { kind: "all", kicker: "MY I-5 PASSPORT", title: [endToEnd()], date: now(), miles: milesDriven(), stamps: ids.length,
    badges: earned.length, labels: ["MILES", "STAMPS", earned.length === 1 ? "BADGE" : "BADGES"], subs: ["driven", `of ${fmtInt(PLACES.length)}`, `of ${DEFS.length}`],
    top: topRegions(ids), runs: runs(coverage), ticks: PLACES.filter(p => s[p.id]).map(p => p.m), at: posM(), medals: earned };
}

function summaryText(kind) {
  const c = cardData(kind || defaultKind());
  const top = c.top.length ? ` Top regions: ${c.top.map(x => `${x.r.name} (${x.n})`).join(", ")}.` : "";
  if (c.kind === "trip") {
    const what = c.demo ? "My I-5 Buddy demo drive" : "My I-5 trip";
    const route = c.title.length > 1 ? `, ${c.title[0]} ${c.title[1]}` : c.title[0] !== "Interstate 5" ? `, ${c.title[0]}` : "";
    return `${what} on ${fmtDay(c.date, true)}: ${fmtMi(c.miles)} miles${route}. ${plural(c.stamps, "landmark stamp")}${c.newBadges ? ` and ${plural(c.newBadges, "new badge")}` : ""}.${top} ${APP_URL}`;
  }
  return `My I-5 passport: ${fmtInt(c.miles)} miles driven, ${fmtInt(c.stamps)} of ${fmtInt(PLACES.length)} landmark stamps and ${plural(c.badges, "badge")}.${top} ${APP_URL}`;
}

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => (cs.getPropertyValue(n) || "").trim() || f;
  const shieldFills = [...document.querySelectorAll("#shield path")].map(p => p.getAttribute("fill"));
  return {
    bg: v("--bg", "#101412"), surface: v("--surface", "#1a201d"), surface2: v("--surface-2", "#232b27"), line: v("--line", "#313b36"),
    fg: v("--fg", "#eef2ee"), fg2: v("--fg-2", "#cfd8d2"), muted: v("--muted", "#93a198"), sign: v("--sign", "#0b6e3f"), signFg: v("--sign-fg", "#ffffff"),
    accent: v("--accent", "#f2c230"), accentFg: v("--accent-fg", "#1b1a10"), link: v("--link", "#f2c230"), stop: v("--stop", "#b496ec"),
    shieldWhite: shieldFills[0] || "#ffffff", shieldRed: shieldFills[1] || v("--danger", "#c8202f"), shieldBlue: shieldFills[2] || v("--shield", "#1f4aa8"),
    st: { CA: v("--st-ca", "#f2c230"), OR: v("--st-or", "#5cc46f"), WA: v("--st-wa", "#52bdd0") },
    display: v("--display", "system-ui, sans-serif"), mono: v("--mono", "ui-monospace, monospace"),
  };
}

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/** Letter-spaced text (canvas letterSpacing is too new for iOS 15). */
function spaced(g, text, x, y, sp, align = "left") {
  const chars = [...String(text)];
  const ws = chars.map(c => g.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + sp * Math.max(0, chars.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const keep = g.textAlign;
  g.textAlign = "left";
  chars.forEach((c, i) => { g.fillText(c, cx, y); cx += ws[i] + sp; });
  g.textAlign = keep;
  return total;
}
function wrapLines(g, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean), out = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (!line || g.measureText(t).width <= maxW) line = t; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}
function fitText(g, text, weight, family, size, maxW, min = 20) {
  for (; size > min; size -= 4) { g.font = `${weight} ${size}px ${family}`; if (g.measureText(text).width <= maxW) break; }
  return size;
}
function drawShield(g, x, y, h, T) {
  const s = h / 62;
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath(); g.moveTo(4, 4); g.quadraticCurveTo(29, 0, 54, 4); g.quadraticCurveTo(58, 36, 29, 60); g.quadraticCurveTo(0, 36, 4, 4); g.closePath();
  g.fillStyle = T.shieldWhite; g.fill();
  g.beginPath(); g.moveTo(7, 7); g.quadraticCurveTo(29, 3.5, 51, 7); g.lineTo(51.6, 17); g.lineTo(6.4, 17); g.closePath();
  g.fillStyle = T.shieldRed; g.fill();
  g.beginPath(); g.moveTo(6.4, 19); g.lineTo(51.6, 19); g.quadraticCurveTo(52, 38, 29, 56); g.quadraticCurveTo(6, 38, 6.4, 19); g.closePath();
  g.fillStyle = T.shieldBlue; g.fill();
  g.fillStyle = T.shieldWhite; g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.font = `800 7px ${T.display}`; g.fillText("INTERSTATE", 29, 14.6);
  g.font = `900 27px ${T.display}`; g.fillText("5", 29, 47);
  g.restore();
}

async function fontsReady() {
  try {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.race([
      Promise.all(['900 64px "Overpass"', '700 64px "Overpass"', '700 40px "Overpass Mono"'].map(f => document.fonts.load(f).catch(() => null))),
      new Promise(r => setTimeout(r, 1500)),
    ]);
  } catch {}
}

/** The 1080 x 1350 share card: sign, road ribbon, three big numbers, top regions, badges, address. */
function drawCard(kind) {
  const W = 1080, H = 1350, T = tokens(), C = cardData(kind);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  if (!g) return null;
  const F = T.display, MONO = T.mono, M = 48, rx = M, rw = W - 2 * M;
  g.textBaseline = "alphabetic";
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);

  // the green sign: shield on the left, kicker + title + date on the right, centered as a block
  const sy = M, sh = 396;
  rr(g, M, sy, rw, sh, 40); g.fillStyle = T.sign; g.fill();
  rr(g, M + 16, sy + 16, rw - 32, sh - 32, 28); g.strokeStyle = T.signFg; g.lineWidth = 7; g.stroke();
  const shH = 216, shW = shH * 58 / 62;
  drawShield(g, M + 62, sy + (sh - shH) / 2, shH, T);
  const tx = M + 62 + shW + 46, tw = M + rw - 60 - tx;
  let kSize = 30;
  for (; kSize > 18; kSize -= 2) { g.font = `800 ${kSize}px ${F}`; if (spacedWidth(g, C.kicker, 5) <= tw) break; }
  let kick = C.kicker;
  while (kick.length > 4 && spacedWidth(g, kick, 5) > tw) kick = kick.slice(0, -2).trimEnd() + "…";
  // the largest size that keeps each part of the title on one line; otherwise wrap
  let size = 72, lines = [];
  for (size = 72; size >= 54; size -= 2) {
    g.font = `900 ${size}px ${F}`;
    if (C.title.length * size * 1.06 <= 220 && C.title.every(t => g.measureText(t).width <= tw)) { lines = C.title.slice(); break; }
  }
  if (!lines.length) {
    for (size = 64; size >= 40; size -= 4) {
      g.font = `900 ${size}px ${F}`;
      lines = [].concat(...C.title.map(t => wrapLines(g, t, tw)));
      if (lines.length <= 3 && lines.length * size * 1.06 <= 220 && lines.every(l => g.measureText(l).width <= tw)) break;
    }
  }
  lines = lines.slice(0, 3);
  const lineH = Math.round(size * 1.06), dH = 32;
  const blockH = kSize + 20 + lines.length * lineH + 16 + dH;
  const top = sy + (sh - blockH) / 2;
  g.fillStyle = T.signFg; g.textAlign = "left";
  g.globalAlpha = 0.86; g.font = `800 ${kSize}px ${F}`;
  spaced(g, kick, tx, top + kSize * 0.76, 5);
  g.globalAlpha = 1; g.font = `900 ${size}px ${F}`;
  lines.forEach((l, i) => g.fillText(l, tx, top + kSize + 20 + size * 0.8 + i * lineH));
  g.globalAlpha = 0.9; g.font = `700 ${dH}px ${F}`;
  g.fillText(fmtLong(C.date), tx, top + kSize + 20 + lines.length * lineH + 16 + dH * 0.8);
  g.globalAlpha = 1;

  // the blocks under the sign, stacked with the spare height spread evenly between them
  const rows = C.top.length, medals = C.medals.slice(0, 7);
  const blocks = [["ribbon", 88], ["numbers", 240], ["regions", rows ? 112 + rows * 74 : 200]];
  const footH = 40, room = H - M - (sy + sh) - footH;
  const used = () => blocks.reduce((a, b) => a + b[1], 0);
  if (medals.length && room - used() - 124 >= 5 * 20) blocks.push(["medals", 124]);
  const gap = (room - used()) / (blocks.length + 1);
  let y = sy + sh + gap;
  const at = {};
  for (const [name, h] of blocks) { at[name] = y; y += h + gap; }

  // road ribbon: the states on this road, what was driven, the stamps, and where we are
  const ry = at.ribbon + 20, rh = 24, X = m => rx + clamp(m / Math.max(1, MAX_M), 0, 1) * rw;
  g.save();
  rr(g, rx, ry, rw, rh, rh / 2); g.clip();
  g.fillStyle = T.surface2; g.fillRect(rx, ry, rw, rh);
  for (const st of STATES) { g.globalAlpha = 0.42; g.fillStyle = T.st[st.id] || T.muted; g.fillRect(X(st.from), ry, X(st.to) - X(st.from), rh); }
  g.globalAlpha = 1; g.fillStyle = T.fg;
  if (C.range) { const a = Math.min(...C.range), b = Math.max(...C.range); g.fillRect(X(a), ry, Math.max(6, X(b) - X(a)), rh); }
  for (const [a, b] of C.runs || []) g.fillRect(X(a), ry, Math.max(4, X(b) - X(a)), rh);
  g.restore();
  g.fillStyle = T.link;
  for (const m of C.ticks || []) g.fillRect(Math.round(X(m)) - 2, ry - 18, 4, 12);
  if (C.kind === "trip" && C.at != null) {
    g.beginPath(); g.arc(X(C.at), ry + rh / 2, 19, 0, Math.PI * 2);
    g.fillStyle = T.accent; g.fill(); g.lineWidth = 7; g.strokeStyle = T.fg; g.stroke();
  }
  g.font = `800 26px ${F}`; g.fillStyle = T.muted;
  for (const l of ribbonLabels()) spaced(g, l.text, rx + l.x * rw, ry + rh + 42, 4, l.align);

  // three big numbers
  const ny = at.numbers, cw = rw / 3;
  const vals = [C.kind === "trip" ? fmtMi(C.miles) : fmtInt(C.miles), fmtInt(C.stamps), fmtInt(C.badges)];
  g.strokeStyle = T.line; g.lineWidth = 3;
  for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(rx + cw * i, ny + 14); g.lineTo(rx + cw * i, ny + 236); g.stroke(); }
  vals.forEach((v, i) => {
    const cx = rx + cw * i + cw / 2;
    g.textAlign = "center"; g.fillStyle = T.fg;
    const s = fitText(g, v, 900, F, 150, cw - 48, 60);
    g.font = `900 ${s}px ${F}`;
    g.fillText(v, cx, ny + 138);
    g.font = `800 28px ${F}`; g.fillStyle = T.link;
    spaced(g, C.labels[i], cx, ny + 192, 4, "center");
    g.font = `600 26px ${F}`; g.fillStyle = T.muted;
    g.fillText(C.subs[i], cx, ny + 230);
  });

  // top regions (or a line about the road)
  const py = at.regions, ph = blocks.find(b => b[0] === "regions")[1];
  rr(g, rx, py, rw, ph, 32); g.fillStyle = T.surface; g.fill();
  g.textAlign = "left"; g.font = `800 26px ${F}`; g.fillStyle = T.muted;
  spaced(g, rows ? (rows === 1 ? "TOP REGION" : "TOP REGIONS") : "THE ROAD", rx + 44, py + 58, 4);
  if (rows) {
    C.top.forEach((x, i) => {
      const yy = py + 124 + i * 74;
      g.textAlign = "left"; g.fillStyle = T.fg; g.font = `800 36px ${F}`;
      let name = x.r.name;
      while (name.length > 4 && g.measureText(name).width > rw - 88 - 210) name = name.slice(0, -2).trimEnd() + "…";
      g.fillText(name, rx + 44, yy);
      g.textAlign = "right"; g.font = `700 32px ${MONO}`; g.fillStyle = T.muted;
      g.fillText(x.of ? `${x.n} of ${x.of}` : String(x.n), rx + rw - 44, yy);
      const by = yy + 18, bw = rw - 88;
      rr(g, rx + 44, by, bw, 10, 5); g.fillStyle = T.surface2; g.fill();
      rr(g, rx + 44, by, Math.max(10, bw * clamp(x.of ? x.n / x.of : 1, 0, 1)), 10, 5); g.fillStyle = T.st[x.r.st] || T.accent; g.fill();
    });
  } else {
    g.fillStyle = T.fg; g.font = `800 42px ${F}`;
    const msg = C.kind === "trip" ? "Every landmark you pass on I-5 earns a passport stamp." : `${fmtInt(PLACES.length)} landmarks and stories, ${endToEnd()}.`;
    wrapLines(g, msg, rw - 88).slice(0, 2).forEach((l, i) => g.fillText(l, rx + 44, py + 124 + i * 54));
  }

  // badge medallions
  if (at.medals != null) {
    const d = 100, n = medals.length, step = Math.min(132, rw / n), x0 = rx + rw / 2 - (step * (n - 1)) / 2, cy = at.medals + 62;
    medals.forEach((b, i) => {
      const cx = x0 + i * step;
      const ring = b.group === "road" ? T.sign : b.group === "region" ? T.st[b.st] || T.accent : b.group === "games" ? T.stop : T.accent;
      g.beginPath(); g.arc(cx, cy, d / 2 + 7, 0, Math.PI * 2); g.fillStyle = ring; g.fill();
      g.beginPath(); g.arc(cx, cy, d / 2 + 2, 0, Math.PI * 2); g.fillStyle = T.bg; g.fill();
      g.beginPath(); g.arc(cx, cy, d / 2 - 3, 0, Math.PI * 2); g.fillStyle = ring; g.fill();
      g.textAlign = "center";
      if (b.glyph) {
        g.fillStyle = b.group === "road" ? T.signFg : T.accentFg;
        g.font = `900 ${b.glyph.length > 2 ? 34 : 44}px ${F}`;
        g.fillText(b.glyph, cx, cy + (b.glyph.length > 2 ? 12 : 15));
      } else {
        g.font = `48px ${F}`;
        g.fillText(b.icon, cx, cy + 17);
      }
    });
  }

  // footer: the app's address and name
  const fy = H - M - 6;
  g.textAlign = "left"; g.fillStyle = T.link;
  const us = fitText(g, APP_URL, 700, MONO, 32, rw - 290, 20);
  g.font = `700 ${us}px ${MONO}`;
  g.fillText(APP_URL, rx, fy);
  g.textAlign = "right"; g.fillStyle = T.fg; g.font = `900 36px ${F}`;
  g.fillText("I-5 Buddy", rx + rw, fy);
  return cv;
}
function spacedWidth(g, text, sp) {
  const chars = [...String(text)];
  return chars.reduce((a, c) => a + g.measureText(c).width, 0) + sp * Math.max(0, chars.length - 1);
}

let shareSheet = null, shareKind = "trip", shareBlob = null, shareFile = null, shareUrl = null, shareSeq = 0;
function openShare(kind, opener) {
  if (!shareSheet) buildShareSheet();
  const hasTrip = !!latestTrip();
  shareKind = kind === "all" || !hasTrip ? "all" : kind === "trip" ? "trip" : defaultKind();
  const seg = shareSheet.querySelector(".trip-share-seg");
  seg.hidden = !hasTrip;
  for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.kind === shareKind));
  sharing = 0;   // a share promise that never settled must not lock the button for good
  showSheet(shareSheet, opener);
  renderShare();
}
function buildShareSheet() {
  shareSheet = makeSheet("tripShareSheet", "Share my trip");
  shareSheet.classList.add("trip-ssheet");
  const seg = el("div", "seg wide trip-share-seg");
  seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "What the card shows");
  for (const [k, label] of [["trip", "Latest trip"], ["all", "All time"]]) {
    const b = btn(null, label, () => { shareKind = k; for (const x of seg.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b)); renderShare(); });
    b.dataset.kind = k;
    seg.append(b);
  }
  const fig = el("figure", "trip-card busy");
  fig.append(el("figcaption", "trip-card-wait", "Drawing your card…"));
  const acts = el("div", "trip-share-acts");
  const go = btn("primary trip-share-go", null, doShare);
  go.append(ICON.share(), el("span", null, "Share picture"));
  go.disabled = true;
  const cp = btn("secondary", null, () => copySummary(shareKind));
  cp.append(ICON.copy(), document.createTextNode("Copy summary"));
  acts.append(go, cp);
  const txt = el("p", "trip-share-txt");
  shareSheet.append(seg, fig, acts, txt, el("p", "hint trip-share-hint", "The picture is made on your phone. Nothing is uploaded unless you share it."));
}
async function renderShare() {
  const seq = ++shareSeq;
  const fig = shareSheet.querySelector(".trip-card"), go = shareSheet.querySelector(".trip-share-go"), cap = fig.querySelector("figcaption");
  const text = summaryText(shareKind);
  fig.classList.add("busy"); go.disabled = true; shareBlob = null; shareFile = null;
  cap.textContent = "Drawing your card…";
  shareSheet.querySelector(".trip-share-txt").textContent = text;
  await fontsReady();
  if (seq !== shareSeq) return;
  let cv = null;
  try { cv = drawCard(shareKind); } catch (e) { warn("card", e); }
  if (!cv) { cap.textContent = "This browser can't draw the card. Copy the summary instead."; return; }
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", "Share card. " + text);
  const old = fig.querySelector("canvas");
  if (old) old.replaceWith(cv); else fig.prepend(cv);
  fig.classList.remove("busy");            // the preview shows now; the PNG for sharing is made in the background
  const blob = await new Promise(res => { try { cv.toBlob(res, "image/png"); } catch { res(null); } });
  if (seq !== shareSeq) return;
  if (!blob) { go.lastChild.textContent = "Can't save picture"; return; }
  if (shareUrl) try { URL.revokeObjectURL(shareUrl); } catch {}
  shareBlob = blob; shareUrl = URL.createObjectURL(blob);
  const name = `i5-buddy-${shareKind === "trip" ? "trip" : "passport"}-${new Date(now()).toISOString().slice(0, 10)}.png`;
  try { shareFile = new File([blob], name, { type: "image/png" }); } catch { shareFile = null; }
  let canFiles = false;
  try { canFiles = !!(shareFile && navigator.share && navigator.canShare && navigator.canShare({ files: [shareFile] })); } catch {}
  go.lastChild.textContent = canFiles ? "Share picture" : "Save picture";
  go.dataset.mode = canFiles ? "share" : "save";
  go.disabled = false;
}
let sharing = 0, shareTok = 0;   // sharing: the token of the system share a tap opened, while it is still open
function doShare() {
  if (!shareBlob || sharing) return;   // a second tap while the system share sheet is opening
  const text = summaryText(shareKind);
  if (shareSheet.querySelector(".trip-share-go").dataset.mode === "share") {
    try {
      const tok = sharing = ++shareTok;
      Promise.resolve(navigator.share({ files: [shareFile], title: "My I-5 trip", text }))
        // AbortError: the person closed the share sheet. InvalidStateError: a share was already open.
        // Anything else means this browser could not share the file, so save it instead.
        .catch(e => { if (!e || (e.name !== "AbortError" && e.name !== "InvalidStateError")) download(); })
        .finally(() => { if (sharing === tok) sharing = 0; });
      return;
    } catch { sharing = 0; }
  }
  download();
}
function download() {
  if (!shareUrl) return;
  const a = el("a");
  a.href = shareUrl;
  a.download = shareFile ? shareFile.name : "i5-buddy.png";
  a.rel = "noopener";
  a.hidden = true;
  (shareSheet || document.body).append(a);
  a.click();
  setTimeout(() => a.remove(), 0);
  toast("Picture saved");
}
async function copySummary(kind) {
  const text = summaryText(kind);
  let ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch {}
  if (!ok) {
    try {
      const ta = el("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.className = "trip-sr";
      (shareSheet && !shareSheet.hidden ? shareSheet : $id("view-passport") || document.body).append(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      ok = document.execCommand("copy");
      ta.remove();
    } catch {}
  }
  toast(ok ? "Summary copied" : "Couldn't copy. Long-press the text in Share my trip to copy it.", 3200);
  if (!ok && !(shareSheet && !shareSheet.hidden)) openShare(kind);
}

/* ---------- settings rows ---------- */
function buildSettings() {
  const box = $id("settingsExtra");
  if (!box || box.querySelector(".trip-settings")) return;
  const wrap = el("div", "trip-settings");
  wrap.append(el("h3", "sub", "Trips and badges"));
  const lab = el("label", "toggle");
  const cb = el("input");
  cb.type = "checkbox"; cb.id = "tripSayBadges"; cb.checked = prefs.sayBadges !== false;
  cb.addEventListener("change", safe("pref", () => { prefs.sayBadges = cb.checked; store.set("tripPrefs", prefs); }));
  lab.append(cb, document.createTextNode(" Say new badges out loud (when narration is on)"));
  wrap.append(lab, el("small", "hint", "Your last 30 trips, badges and the miles you've driven stay on this phone. Clear passport below erases them too."));
  box.append(wrap);
}

/* ---------- init ---------- */
function loadState() {
  const b = store.get("badges", {});
  badges = b && typeof b === "object" && !Array.isArray(b) ? Object.fromEntries(Object.entries(b).filter(([, v]) => typeof v === "number")) : {};
  stats = loadStats();
  coverage = bitsFrom(store.get("coverage", ""), true);
  covCount = bitCount(coverage);
  const p = store.get("tripPrefs", null);
  if (p && typeof p === "object") prefs = { ...prefs, ...p };
  const f = store.get("destFrom", null);
  destFrom = onRoad(f) ? f : null;
  const dd = store.get("destDone", null);
  destDone = validDest(dd) ? dd : null;
  // not a destination on this road (say Seattle, saved when the app covered Washington): forget it
  if (S.dest && !validDest(S.dest)) { S.dest = null; store.del("dest"); }
  knownDest = destKey(validDest(S.dest));   // the saved destination keeps its saved countdown start
}

function setupData() {
  D = A.data || {};
  STATES = Array.isArray(D.STATES) ? D.STATES.filter(s => s && s.id) : [];
  MAX_M = num(D.MAX_M, STATES.length ? num(STATES[STATES.length - 1].to) : 0);
  NBITS = Math.max(1, Math.ceil(MAX_M));   // one bit per mile of road: k to k + 1 (the last one may be short)
  const end = (x, short, long) => ({ short: x && typeof x.short === "string" && x.short ? x.short : short,
    long: x && typeof x.long === "string" && x.long ? x.long : long });
  const E = D.ENDS && typeof D.ENDS === "object" ? D.ENDS : {};
  ENDS = { S: end(E.S, "Mexico", "the Mexico border"), N: end(E.N, "Canada", "the Canadian border") };
  PLACES = Array.isArray(D.PLACES) ? D.PLACES.filter(p => p && typeof p.id === "string" && typeof p.m === "number") : [];
  REGIONS = Array.isArray(D.REGIONS) ? D.REGIONS.filter(r => r && r.id) : [];
  DESTS = Array.isArray(D.DESTS) ? D.DESTS.filter(validDest) : [];   // (after MAX_M: validDest checks the mile is on the road)
  regionPlaces.clear();
  for (const r of REGIONS) regionPlaces.set(r.id, []);
  for (const p of PLACES) { const r = regionForPlace(p); if (r && regionPlaces.has(r.id)) regionPlaces.get(r.id).push(p); }
}

export function init(api) {
  try {
    A = api || {};
    S = A.S || { mode: "off", m: null, dir: "N", stamps: {}, dest: null };
    settings = A.settings || { narr: false, cats: null };
    bus = A.bus || { on() { return () => {}; }, emit() {} };
    store = A.store || { get: (k, f) => f, set() {}, del() {} };
    voice = A.voice || { say: () => Promise.resolve(false), chime: () => Promise.resolve(), unlock() {}, isSpeaking: () => false, queued: () => [], available: false };
    ui = A.ui || null;
    setupData();
    buildDefs();
    loadState();
  } catch (e) { console.error("[trip] setup failed", e); return; }

  const on = (evt, fn) => { try { bus.on(evt, safe(evt, fn)); } catch (e) { warn("bus " + evt, e); } };
  on("mode", onMode);
  on("pos", onPos);
  on("trip:end", () => endTrip());
  on("place:stamp", onStamp);
  on("passport:reset", onReset);
  on("badge", () => markPassport());
  on("settings", () => queueStrip());
  on("dest", () => { syncDest(); queueStrip(); });
  on("tab", name => {
    checkTrivia("full");          // play.js keeps the score in store "trivia"; the badge pops once you leave the game
    if (name === "passport") { settleLeftover(false); renderPassport(); }
    else if (name === "drive") queueStrip();
  });

  const steps = [
    () => settleLeftover(false),
    () => checkCollect("toast"),   // stamps collected before badges existed: catch up quietly
    () => checkTrivia("toast"),
    () => renderStrip(),
    () => buildSettings(),
    () => { if (S.mode === "gps" || S.mode === "demo") startTrip(S.mode); },
    () => { if (ppVisible()) renderPassport(); },
    () => {
      const v = $id("view-passport");
      if (v) v.addEventListener("pointerdown", () => { ppTouchAt = Date.now(); }, { passive: true });
    },
    () => {
      const save = safe("save", () => { if (cur) persist(true); flushCoverage(); });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });
      window.addEventListener("pagehide", save);
    },
  ];
  for (const s of steps) { try { s(); } catch (e) { warn("init", e); } }

  A.trip = {
    openDest: () => safe("openDest", openDest)(),
    setDest: q => safe("setDest", () => setDest(findDest(q)))() || false,
    clearDest: () => safe("clearDest", clearDest)(),
    current: () => (cur ? JSON.parse(JSON.stringify(cur)) : null),
    trips: () => loadTrips(),
    badges: () => Object.fromEntries(DEFS.filter(d => badges[d.id]).map(d => [d.id, badges[d.id]])),   // the ones this road offers
    badgeList: () => DEFS.map(d => ({ id: d.id, name: d.name, group: d.group, hint: d.hint, at: badges[d.id] || null })),
    coverage: () => ({ miles: covCount, of: NBITS }),
    summary: kind => safe("summary", summaryText)(kind),
    share: kind => safe("share", openShare)(kind),
    card: async kind => { await fontsReady(); const cv = drawCard(kind || defaultKind()); return cv ? new Promise(r => cv.toBlob(r, "image/png")) : null; },
    setClock: fn => { clock = typeof fn === "function" ? fn : () => Date.now(); }, // tests only
  };
}
