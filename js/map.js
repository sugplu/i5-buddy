// I-5 Buddy: the whole road on one interactive map. Module contract: ARCHITECTURE.md.
// Owns #view-map (built the first time the Map tab opens) and exposes api.map for other modules.
//
// Why it stays smooth with ~1,000 landmarks on a phone:
// - All geography lives in one <g> that pans and zooms with a single transform. Nothing is re-rendered.
// - Landmark dots are tiny round-capped strokes with vector-effect: non-scaling-stroke, so they keep the same
//   size on screen at every zoom without any DOM work.
// - Labels, camera and rest-area glyphs and the "you" marker carry a counter-scale (1 / zoom). They are only
//   rewritten when the zoom changes or new ones come into view, and labels that would collide are hidden.
// - While you drive, nothing animates on its own: at road speeds a GPS fix moves the marker a fraction of a pixel,
//   so each fix costs at most one small redraw (none when the move is too small to see). Only a fast demo glides.

const NS = "http://www.w3.org/2000/svg";
const U = 100;                    // world units per degree of latitude
const ZMIN = 1, ZMAX = 60;
// The states the road data covers (data.STATES: just California since 2026-11-11). They are tinted, named and framed;
// every other outline (Oregon, Nevada, Arizona...) is a neighbour, drawn plainly as context.
let MAIN = [];
const CAT_KEYS = ["farm", "hist", "nature", "town", "stop", "odd"];
const DEFAULT_CATS = { farm: "Orchards & farms", hist: "History", nature: "Land & water", town: "Towns", stop: "Good stops", odd: "Oddities" };
// Spots for the state names, inland and clear of the road: [lat, lon, rotation]. The first one that does not
// collide with the road or a big city label wins; rotation "nv" follows California's diagonal border with Nevada.
// Oregon and Washington are only named when the data covers them.
const STATE_SPOTS = {
  CA: [[36.1, -117.95, "nv"], [36.55, -118.45, "nv"], [35.7, -117.5, "nv"], [37.6, -119.6, "nv"], [35.4, -116.9, "nv"]],
  OR: [[43.85, -119.35, 0], [43.3, -119.4, 0], [44.4, -119.2, 0], [42.6, -119.4, 0], [43.6, -118.6, 0]],
  WA: [[46.95, -119.6, 0], [47.25, -119.1, 0], [46.5, -119.2, 0], [47.9, -119.4, 0], [47.4, -118.4, 0], [47.0, -118.6, 0], [48.55, -119.5, 0]],
};
// The ocean name tries these spots (all open water) after every city label is placed, so it never pushes one aside.
// Spots outside the area the map can show are skipped (the far-west ones only fit a map that reaches up the coast).
// The last two sit off Southern California, below the city names that line the coast on narrow phones.
const OCEAN_SPOTS = [[39.2, -126.3], [39.3, -127.1], [37.3, -125.4], [41.4, -127.0], [35.6, -123.9], [43.3, -127.3], [33.3, -121.8], [32.4, -120.6]];
// City label sizes. Names are only drawn when they are in data.DESTS, so the Oregon and Washington ones wait for a
// build that covers those states.
const BIG = new Set(["San Diego", "Los Angeles", "Sacramento", "Portland", "Seattle"]);
const MID = new Set(["Anaheim", "Stockton", "Redding", "Medford", "Eugene", "Salem", "Tacoma", "Olympia", "Bellingham", "Vancouver, WA"]);
// Land we have no outline for (Mexico, Utah, Montana and on), so the ocean tint shows only where the ocean is.
// The west edge follows the Baja coast and the top of the Gulf of California, then runs inland under the states.
const BEYOND = [
  [32.534, -117.124], [32.45, -117.1], [32.36, -117.065], [32.25, -116.97], [32.1, -116.88], [31.95, -116.76], [31.86, -116.64],
  [31.74, -116.78], [31.55, -116.68], [31.3, -116.42], [30.9, -116.33], [30, -115.85], [30, -114.62], [30.35, -114.64],
  [31.02, -114.83], [31.5, -114.87], [31.82, -114.78], [31.69, -114.5], [31.5, -113.95], [31.3, -113.55], [30.6, -113.0],
  [30, -112.75], [20, -105], [20, -60], [75, -60], [75, -116.5], [33.2, -116.5],
];
const PREFS_KEY = "map";
const LABEL_PX_PER_MILE = 2.2;    // place names appear once a mile is this many pixels long
const MAX_PLACE_LABELS = 60;
const GLIDE_MIN_PX = 1.5;         // the marker glides only when a position update moves it at least this far on screen
const GLIDE_FRAME_MS = 30;        // ... and then at about 30 frames a second
const MAP_GAP = 12;               // room between the bottom of the map and the tab bar

let api = null;
let built = false, onScreen = false;
let viewEl, headEl, mapEl, svg, world, sumEl, cardEl, liveEl, scaleEl, scaleBar, scaleTxt, zInBtn, zOutBtn, followBtn, chipsEl;
const L = {};                       // svg layers
let ROUTE = [], RXY = [], PLACES = [], PTS = [], CAMS = [], RESTS = [], CITIES = [], PLACE_ORDER = [], SINGLES = [], STATE_NAMES = [];
let CATS = DEFAULT_CATS, CAT_ICON = {}, MAXM = 0;
let LAT_N = 50, LON_W = -125, KX = 0.76, WW = 1000, WH = 1800;
// z = zoom (1 = whole road), cx/cy = world point at the center, s0 = pixels per world unit at zoom 1,
// ox/oy = the center of the whole-road view (the road fits above the location buttons, which keep BOTTOM px).
const V = { z: 1, cx: 500, cy: 900, W: 0, H: 0, s0: 1, ox: 500, oy: 900, ready: false };
const BOTTOM = 58;
const prefs = { places: true, cams: false, rest: true, follow: false };
let sel = null, you = null, destM = null;
let youShown = null, youAnim = null, lastPosAt = 0, posGap = 500; // where the marker is drawn while it glides to `you`
let youDrawn = null;               // what the marker's DOM shows now, so sub-pixel moves cost nothing
let rideFace = null;               // which way the ride (ride.js) faces on the map: "right" or "left"
const three = { on: false, busy: false, host: null, btn: null, mod: null, note: null, noteTimer: 0 }; // the 3D terrain view (map3d.js)
const youAt = () => youShown || you;
let raf = 0, lastK = 0, motion = null, cityBoxes = [];
let camG = null, restG = null, labelG = null;
let speakingId = null;
let dotsDirty = false, dotsRaf = 0, dotsTimer = 0; // passport stamps arrive in bursts; the dots redraw once per frame
let camLoad = null, camResume = null;              // the camera picture loading now; one cut short by leaving the tab

/* ---------- small helpers ---------- */
const num = Number.isFinite;
const warn = e => { try { console.warn("[map]", e && e.message ? e.message : e); } catch {} };
function safe(fn) { return function (...args) { try { return fn.apply(this, args); } catch (e) { warn(e); } }; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function sv(tag, attrs) { const e = document.createElementNS(NS, tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function button(cls, opts = {}) {
  const b = el("button", cls);
  b.type = "button";
  if (opts.html) b.innerHTML = opts.html;
  if (opts.text) b.append(opts.text);
  if (opts.label) b.setAttribute("aria-label", opts.label);
  if (opts.title) b.title = opts.title;
  if (opts.onClick) b.addEventListener("click", safe(opts.onClick));
  return b;
}
const r2 = v => Math.round(v * 100) / 100;
const X = lon => (lon - LON_W) * KX * U;
const Y = lat => (LAT_N - lat) * U;
const kNow = () => V.z * V.s0;
const clampZ = z => Math.max(ZMIN, Math.min(ZMAX, num(z) ? z : 1));
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const S = () => (api && api.S) || {};
const dfn = (name, fb) => (api && api.data && typeof api.data[name] === "function" ? api.data[name] : fb);
const aheadOf = (m, dir, x) => dfn("aheadOf", (a, d, b) => (d === "N" ? b - a : a - b))(m, dir, x);
const fmtMiles = d => dfn("fmtMiles", v => (v < 10 ? v.toFixed(1) : String(Math.round(v))))(d);
const catClass = c => (CAT_KEYS.includes(c) ? c : "");
function toast(t) { try { api.ui && api.ui.toast && api.ui.toast(t); } catch {} }
/** Rest-area names come from OpenStreetMap in many shapes; drop the direction words (the card says it) and noise. */
function cleanRest(name) {
  const n = String(name || "").replace(/\(historical\)\s*/i, "").replace(/\s*[-–]?\s*\(?\b(north|south)bound\b\)?/gi, "")
    .replace(/\s+\b[NS]B\b\s*$/, "").replace(/\s{2,}/g, " ").trim();
  return /^(water|rest ?area|)$/i.test(n) ? "" : n;
}
function nearestCity(m) {
  let best = null;
  for (const c of CITIES) if (!best || Math.abs(c.m - m) < Math.abs(best.m - m)) best = c;
  return best && Math.abs(best.m - m) < 60 ? best.name : "";
}
const restServes = (r, dir) => !r.side || (dir === "N" ? r.side === 1 : r.side === -1) || /both|NB.*SB|north.*south/i.test(r.name || "");

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v14h-2zM5 11h14v2H5z" fill="currentColor"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z" fill="currentColor"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H7.4l3.3 3.3-1.4 1.4L6 7.4V10H4V4Zm10 0h6v6h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H14V4ZM4 14h2v2.6l3.3-3.3 1.4 1.4L7.4 18H10v2H4v-6Zm14 2.6V14h2v6h-6v-2h2.6l-3.3-3.3 1.4-1.4 3.3 3.3Z" fill="currentColor"/></svg>',
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2h2v3.07A7 7 0 0 1 18.93 11H22v2h-3.07A7 7 0 0 1 13 18.93V22h-2v-3.07A7 7 0 0 1 5.07 13H2v-2h3.07A7 7 0 0 1 11 5.07V2Zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" fill="currentColor"/></svg>',
  follow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.8 20.5 12 16.8l7.2 3.7L12 2.5Z" fill="currentColor"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3V9Zm12.5 3A4.5 4.5 0 0 0 14 8.6v6.8a4.5 4.5 0 0 0 1.5-3.4ZM14 3.7v2.1a6.8 6.8 0 0 1 0 12.4v2.1a8.8 8.8 0 0 0 0-16.6Z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  north: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 6.5 7 8-1.6 1.4L12 9.8l-5.4 6.1L5 14.5l7-8Z" fill="currentColor"/></svg>',
  south: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 17.5-7-8 1.6-1.4 5.4 6.1 5.4-6.1L19 9.5l-7 8Z" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" fill="currentColor"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4l-2.35 2.35Z" fill="currentColor"/></svg>',
  dots: '<svg viewBox="0 0 20 16" aria-hidden="true"><circle cx="4.5" cy="10.5" r="3.4" style="fill:var(--farm)"/><circle cx="10" cy="5" r="3.4" style="fill:var(--hist)"/><circle cx="15.5" cy="10.5" r="3.4" style="fill:var(--nature)"/></svg>',
};
// Glyph shapes, drawn around (0, 0) in screen pixels. Shared by the map markers, chips and legend.
const CAM_BODY = "M-5 -4h1.5l1.3-2.3h4.4L3.5 -4H5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z";
const CAM_SVG = `<path class="mp-cam-b" d="${CAM_BODY}"/><circle class="mp-cam-l" cx="0" cy="0.6" r="2.5"/>`;
const REST_SVG = '<rect class="mp-rest-b" x="-7" y="-7" width="14" height="14" rx="3.2"/>' +
  '<circle class="mp-rest-f" cx="-2.6" cy="-3.3" r="1.35"/><path class="mp-rest-f" d="M-3.9 -1.6h2.6v6.1h-2.6z"/>' +
  '<circle class="mp-rest-f" cx="2.6" cy="-3.3" r="1.35"/><path class="mp-rest-f" d="M2.6 -1.7 4.7 2.7H.5Z M1.9 2.6h1.4v1.9H1.9z"/>';
const glyphIcon = (inner, vb = "-8 -8 16 16") => `<svg class="mp-glyph" viewBox="${vb}" aria-hidden="true">${inner}</svg>`;

/* ---------- module entry ---------- */
export function init(a) {
  api = a || {};
  try {
    readPrefs();
    const on = (evt, fn) => { try { if (api.bus && api.bus.on) api.bus.on(evt, safe(fn)); } catch (e) { warn(e); } };
    on("tab", t => (t === "map" ? show() : hide()));
    on("pos", onPos);
    on("mode", () => { if (built) { drawYou(); refreshCardBits(); } });
    on("place:stamp", onStamps);
    on("passport:reset", onStamps);
    on("dest", () => { if (built) updateYou(); }); // set or cleared on the Drive tab or by voice
    on("settings", onSettings);
    on("ride", onRide);               // ride.js: a new vehicle, colour, badge or name
    on("ride:state", onRide);         // ... or it fell asleep / woke up
    on("speaking", s => { speakingId = s && s.id ? s.id : null; refreshHearButton(); });
    api.map = publicApi();
    const v = document.getElementById("view-map");
    if (v && !v.hidden) show(); // the Map tab was opened before this module finished loading
  } catch (e) { warn(e); }
}

function readPrefs() {
  try {
    const p = api.store && api.store.get ? api.store.get(PREFS_KEY, null) : null;
    if (p && typeof p === "object") for (const k of Object.keys(prefs)) if (typeof p[k] === "boolean") prefs[k] = p[k];
  } catch {}
}
function savePrefs() { try { api.store && api.store.set && api.store.set(PREFS_KEY, { ...prefs }); } catch {} }

function publicApi() {
  return {
    /** Switch to the Map tab. */
    open: safe(() => { if (api.ui && api.ui.go) api.ui.go("map"); else show(); }),
    /** Open the map on a landmark (object or id) and show its card. */
    showPlace: safe(p => {
      openMap();
      const id = p && typeof p === "object" ? p.id : p;
      const i = PTS.findIndex(x => x.p.id === id);
      if (i >= 0) { selectIdx("place", i, { fly: Math.max(V.z, 9) }); }
    }),
    /** Open the map centered on a corridor mile. */
    showMile: safe((m, z = 10) => {
      openMap();
      const c = coordAt(m);
      if (!c) return;
      if (prefs.follow) setFollow(false, true); // or the next GPS fix would pull the view back to you
      flyTo(X(c[1]), Y(c[0]), clampZ(z));
    }),
    wholeRoad: safe(() => wholeRoad()),
    nearMe: safe(() => nearMe()),
    zoomBy: safe(f => zoomBy(f)),
    setLayer: safe((name, on) => setLayer(name, on)),
    setFollow: safe(on => setFollow(!!on)),
    select: safe((type, item) => {
      const list = listFor(type);
      const i = list.findIndex(x => x.item === item || (x.item && item && x.item.id != null && x.item.id === item.id));
      if (i >= 0) selectIdx(type, i, { center: true });
    }),
    clear: safe(() => select(null)),
    /** Measure and draw again right now (after the container changed size, for example). */
    redraw: safe(() => { if (!built || !onScreen) return; fitHeight(); measure(); flushDots(); lastK = 0; render(); }),
    get view() { return { z: V.z, cx: V.cx, cy: V.cy, W: V.W, H: V.H }; },
    get layers() { return { places: prefs.places, cams: prefs.cams, rest: prefs.rest }; },
    get follow() { return prefs.follow; },
    /** The 3D terrain view: open it, close it (back to the 2D map), or ask whether it is showing. */
    open3d: safe(() => open3d()),
    close3d: safe(() => close3d()),
    get is3d() { return three.on; },
    get selected() { return sel ? { type: sel.type, item: sel.item || null, m: sel.m } : null; },
  };
}
function openMap() {
  if (!onScreen) { if (api.ui && api.ui.go) api.ui.go("map"); else show(); }
}

/* ---------- data and projection ---------- */
function coordAt(m) {
  if (!num(m) || ROUTE.length < 2) return null;
  try {
    const c = api.geo && api.geo.coordAt ? api.geo.coordAt(m) : null;
    if (c && num(c[0]) && num(c[1])) return c;
  } catch {}
  let lo = 0, hi = ROUTE.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ROUTE[mid][0] < m) lo = mid + 1; else hi = mid; }
  const i = Math.max(1, lo), a = ROUTE[i - 1], b = ROUTE[i];
  const t = b[0] === a[0] ? 0 : Math.max(0, Math.min(1, (m - a[0]) / (b[0] - a[0])));
  return [a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

function loadData() {
  const d = (api && api.data) || {};
  const arr = v => (Array.isArray(v) ? v : []);
  ROUTE = arr(d.ROUTE).filter(r => Array.isArray(r) && num(r[0]) && num(r[1]) && num(r[2]));
  MAXM = num(d.MAX_M) ? d.MAX_M : ROUTE.length ? ROUTE[ROUTE.length - 1][0] : 0;
  CATS = d.CATS && typeof d.CATS === "object" ? d.CATS : DEFAULT_CATS;
  CAT_ICON = d.CAT_ICON && typeof d.CAT_ICON === "object" ? d.CAT_ICON : {};
  const ids = arr(d.STATES).map(s => (s && s.id != null ? String(s.id) : "")).filter(Boolean);
  MAIN = ids.length ? ids : arr(d.SCOPE).map(String);

  // Equirectangular projection over the road and the states it covers, plus a margin; x scaled by cos(mid-latitude).
  // Framing the covered states (not only the road) keeps all of California in the whole-road view: the road alone
  // would leave its desert corner by Nevada and Arizona off the edge, out of reach.
  let a0 = Infinity, a1 = -Infinity, o0 = Infinity, o1 = -Infinity;
  const grow = (la, lo) => { if (!num(la) || !num(lo)) return; a0 = Math.min(a0, la); a1 = Math.max(a1, la); o0 = Math.min(o0, lo); o1 = Math.max(o1, lo); };
  for (const r of ROUTE) grow(r[1], r[2]);
  for (const o of arr(d.OUTLINE)) if (o && MAIN.includes(o.st)) for (const p of arr(o.pts)) if (Array.isArray(p)) grow(p[0], p[1]);
  if (!(a1 - a0 > 0.2) || !(o1 - o0 > 0.02)) { a0 = 32.5; a1 = 42; o0 = -124.4; o1 = -114.1; } // no data: California
  const pad = Math.max(0.6, (a1 - a0) * 0.06);
  KX = Math.cos((a0 + a1) / 2 * Math.PI / 180);
  LAT_N = a1 + pad;
  LON_W = o0 - pad / KX;
  WW = ((o1 - o0) * KX + 2 * pad) * U;
  WH = (a1 - a0 + 2 * pad) * U;

  RXY = ROUTE.map(r => ({ m: r[0], x: X(r[2]), y: Y(r[1]) }));

  PLACES = arr(d.PLACES).filter(p => p && typeof p === "object" && p.id != null);
  PTS = [];
  for (const p of PLACES) {
    const c = num(p.lat) && num(p.lon) ? [p.lat, p.lon] : coordAt(p.m);
    if (!c) continue;
    PTS.push({ item: p, p, m: num(p.m) ? p.m : 0, x: X(c[1]), y: Y(c[0]), label: shorten(p.name), w: 0 });
  }
  PTS.sort((a, b) => a.m - b.m);
  // Place names compete for room at high zoom: things you can see from the road first, then the rest in road order.
  PLACE_ORDER = PTS.map((_, i) => i).sort((i, j) => (PTS[j].p.vis ? 1 : 0) - (PTS[i].p.vis ? 1 : 0) || i - j);

  CAMS = [];
  for (const c of arr(d.CAMS)) {
    if (!c || typeof c !== "object") continue;
    const ll = num(c.lat) && num(c.lon) ? [c.lat, c.lon] : coordAt(c.m);
    if (ll) CAMS.push({ item: c, m: num(c.m) ? c.m : 0, x: X(ll[1]), y: Y(ll[0]) });
  }
  CAMS.sort((a, b) => a.m - b.m);

  RESTS = [];
  for (const r of arr(d.REST)) {
    if (!r || typeof r !== "object" || r.kind !== "rest_area") continue;
    const ll = num(r.lat) && num(r.lon) ? [r.lat, r.lon] : coordAt(r.m);
    if (ll) RESTS.push({ item: r, m: num(r.m) ? r.m : 0, x: X(ll[1]), y: Y(ll[0]) });
  }
  RESTS.sort((a, b) => a.m - b.m);

  CITIES = [];
  for (const c of arr(d.DESTS)) {
    if (!c || !num(c.m) || /border/i.test(c.name || "") || c.m < 0.5 || c.m > MAXM - 0.5) continue;
    const ll = coordAt(c.m);
    if (!ll) continue;
    const name = String(c.name || "").replace(/^Downtown\s+/i, "");
    const rank = BIG.has(name) ? 0 : MID.has(name) ? 1 : 2;
    CITIES.push({ name, m: c.m, x: X(ll[1]), y: Y(ll[0]), rank, fs: rank === 0 ? 12.5 : 11.5, wt: rank === 2 ? 700 : 800, w: 0, side: null });
  }
  CITIES.sort((a, b) => a.rank - b.rank || a.m - b.m);
}
function shorten(name) {
  const s = String(name || "");
  return s.length > 30 ? s.slice(0, 28).trim() + "…" : s;
}
/** The map's name for screen readers, from the data: "Map of I-5 in California, from the Mexico border to the Oregon line". */
function mapLabel() {
  const d = (api && api.data) || {};
  const states = Array.isArray(d.STATES) ? d.STATES.filter(s => s && s.name) : [];
  const ends = d.ENDS && d.ENDS.S && d.ENDS.N && d.ENDS.S.long && d.ENDS.N.long ? d.ENDS : null;
  const span = ends ? `from ${ends.S.long} to ${ends.N.long}` : "";
  if (states.length === 1) return `Map of I-5 in ${states[0].name}${span ? ", " + span : ""}`;
  return `Map of I-5${span ? " " + span : ""}`;
}
const listFor = type => (type === "place" ? PTS : type === "cam" ? CAMS : type === "rest" ? RESTS : []);

/* ---------- text widths (for label collisions) ---------- */
let ctx2d = null;
const widths = new Map();
function textW(t, fs, wt) {
  const key = wt + "|" + fs + "|" + t;
  let w = widths.get(key);
  if (w != null) return w;
  try {
    ctx2d = ctx2d || document.createElement("canvas").getContext("2d");
    ctx2d.font = `${wt} ${fs}px Overpass, system-ui, -apple-system, "Segoe UI", sans-serif`;
    w = ctx2d.measureText(t).width;
  } catch { w = 0; }
  if (!(w > 0)) w = t.length * fs * 0.56;
  widths.set(key, w);
  return w;
}
// State and ocean names: font size and letter spacing (em) as in map.css, plus the compact style used when the map is
// too small for the full one (narrow phones at the whole-road view).
const ST_FS = 11.5, ST_TRACK = 0.24, ST_FS_C = 10, ST_TRACK_C = 0.08;
const SEA_FS = 10.5, SEA_TRACK = 0.45, SEA_FS_C = 9.5, SEA_TRACK_C = 0.25;
const stW = (t, fs, tr) => textW(t, fs, 900) + fs * tr * (t.length - 1);
function measureLabels() {
  for (const c of CITIES) c.w = textW(c.name, c.fs, c.wt);
  for (const s of STATE_NAMES) {
    s.w = stW(s.name, ST_FS, ST_TRACK);
    s.wc = stW(s.name, ST_FS_C, ST_TRACK_C);
    s.wa = stW(s.abbr, ST_FS, ST_TRACK);
  }
  for (const s of SINGLES) {
    s.w = Math.max(...s.lines.map(t => textW(t, SEA_FS, 800) + SEA_FS * SEA_TRACK * t.length));
    s.wc = Math.max(...s.lines.map(t => textW(t, SEA_FS_C, 800) + SEA_FS_C * SEA_TRACK_C * t.length));
  }
  for (const P of PTS) P.w = 0; // measured lazily
}

/* ---------- building the view ---------- */
function build() {
  if (built) return true;
  viewEl = document.getElementById("view-map");
  if (!viewEl) return false;
  loadData();
  viewEl.textContent = "";
  viewEl.classList.add("mp-view");

  const head = headEl = el("div", "view-head mp-head");
  // rounded like the Drive tab's "all 797 miles of I-5 in California"
  head.append(el("h2", "view-title", MAXM > 0 ? `${Math.round(MAXM).toLocaleString("en-US")} miles of I-5` : "I-5"), sumEl = el("p", "mp-sum"));

  chipsEl = el("div", "mp-layers");
  chipsEl.setAttribute("role", "group");
  chipsEl.setAttribute("aria-label", "Show on the map");
  const chipDefs = [
    ["places", "Landmarks", ICON.dots, true],
    ["cams", "Cameras", glyphIcon(CAM_SVG), CAMS.length > 0],
    ["rest", "Rest areas", glyphIcon(REST_SVG), RESTS.length > 0],
  ];
  for (const [key, text, icon, has] of chipDefs) {
    if (!has) continue;
    const b = button("chip mp-chip", { html: icon, text, onClick: () => setLayer(key, !prefs[key]) });
    b.dataset.layer = key;
    b.setAttribute("aria-pressed", String(!!prefs[key]));
    chipsEl.append(b);
  }

  mapEl = el("div", "mp-map");
  mapEl.tabIndex = 0;
  mapEl.setAttribute("role", "group");
  mapEl.setAttribute("aria-roledescription", "map");
  mapEl.setAttribute("aria-label", mapLabel());
  mapEl.setAttribute("aria-describedby", "mpHelp");
  const help = el("p", "mp-sr", "Drag to move and pinch to zoom. With a keyboard, use the arrow keys to move, plus and minus to zoom, and 0 for the whole road. The card below the map steps through landmarks one by one.");
  help.id = "mpHelp";
  buildSvg();
  measureLabels();
  mapEl.append(svg, help, buildControls());

  cardEl = el("div", "mp-cardbox");
  liveEl = el("p", "mp-sr");
  liveEl.setAttribute("aria-live", "polite");

  viewEl.append(head, chipsEl, mapEl, cardEl, buildLegend(), liveEl);
  wireMap();
  built = true;
  updateSummary();
  updateYou();
  applyLayers();
  renderCard();
  try { document.fonts && document.fonts.ready && document.fonts.ready.then(safe(() => { widths.clear(); measureLabels(); lastK = 0; requestRender(); })); } catch {}
  return true;
}

function ringD(pts) {
  let d = "";
  for (const p of pts) {
    if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) continue;
    d += (d ? "L" : "M") + Math.round(X(p[1]) * 10) / 10 + " " + Math.round(Y(p[0]) * 10) / 10;
  }
  return d ? d + "Z" : "";
}

function buildSvg() {
  svg = sv("svg", { class: "mp-svg", "aria-hidden": "true", focusable: "false" });
  world = sv("g", { class: "mp-world" });
  svg.append(world);

  // ocean, graticule, land
  world.append(sv("rect", { class: "mp-ocean", x: -15000, y: -15000, width: 30000 + WW, height: 30000 + WH }));
  let g = "";
  for (let la = 20; la <= 60; la += 2) g += `M${r2(X(-170))} ${r2(Y(la))}H${r2(X(-80))}`;
  for (let lo = -170; lo <= -80; lo += 2) g += `M${r2(X(lo))} ${r2(Y(62))}V${r2(Y(18))}`;
  world.append(sv("path", { class: "mp-grat", d: g }));
  world.append(sv("path", { class: "mp-beyond", d: ringD(BEYOND) }));

  const outline = Array.isArray(api.data && api.data.OUTLINE) ? api.data.OUTLINE : [];
  const byState = new Map();
  for (const o of outline) {
    if (!o || !Array.isArray(o.pts) || o.pts.length < 3) continue;
    const d = ringD(o.pts);
    if (!d) continue;
    const st = String(o.st || "");
    byState.set(st, (byState.get(st) || "") + d);
  }
  let nbr = "";
  for (const [st, d] of byState) if (!MAIN.includes(st)) nbr += d;
  if (nbr) world.append(sv("path", { class: "mp-nbr", d: nbr }));
  for (const st of MAIN) {
    const d = byState.get(st);
    if (!d) continue;
    world.append(sv("path", { class: "mp-land", d }), sv("path", { class: "mp-tint st-" + st.toLowerCase(), d }));
  }

  // state and ocean names (constant size; faded out when zoomed in)
  SINGLES = [];
  L.names = sv("g", { class: "mp-names" });
  world.append(L.names);
  STATE_NAMES = [];
  const nvAngle = Math.atan2(4 * U, 5.37 * KX * U) * 180 / Math.PI; // CA-NV border: (39, -120) to (35, -114.63)
  for (const st of MAIN) {
    if (!STATE_SPOTS[st] || !byState.has(st)) continue;
    const name = String(((api.data && Array.isArray(api.data.STATES) && api.data.STATES.find(s => s && s.id === st)) || {}).name || st).toUpperCase();
    const gEl = sv("g", { class: "mp-stname", display: "none" });
    const t = sv("text", { "text-anchor": "middle", dy: "0.35em" });
    t.textContent = name;
    gEl.append(t);
    L.names.append(gEl);
    const spots = STATE_SPOTS[st].map(([la, lo, r]) => ({ x: X(lo), y: Y(la), rot: r === "nv" ? nvAngle : r }));
    STATE_NAMES.push({ el: gEl, t, name, abbr: st, spots, w: 0, wc: 0, wa: 0, spot: null, style: "full", drawn: null, shown: null });
  }
  if (byState.size || ROUTE.length) {
    const gEl = sv("g", { class: "mp-seaname", display: "none" });
    const lines = ["PACIFIC", "OCEAN"];
    const t1 = sv("text", { "text-anchor": "middle", y: "-3" }), t2 = sv("text", { "text-anchor": "middle", y: "12" });
    t1.textContent = lines[0]; t2.textContent = lines[1];
    gEl.append(t1, t2);
    L.names.append(gEl);
    // top and bottom of the two lines around the anchor, in screen pixels
    SINGLES.push({ el: gEl, lines, spots: OCEAN_SPOTS.map(([la, lo]) => ({ x: X(lo), y: Y(la) })), top: -12, bottom: 15, w: 0, wc: 0, maxZ: 3.2, spot: null, compact: false, shown: false });
  }

  // the road: two soft glow strokes, the green line and a dashed yellow center line
  if (RXY.length > 1) {
    let d = "";
    for (let i = 0; i < RXY.length; i++) d += (i ? "L" : "M") + r2(RXY[i].x) + " " + r2(RXY[i].y);
    const rg = sv("g", { class: "mp-route" });
    for (const c of ["mp-glow1", "mp-glow2", "mp-road", "mp-center"]) rg.append(sv("path", { class: c, d }));
    world.append(rg);
  }

  L.rest = sv("g", { class: "mp-rests" });
  L.cams = sv("g", { class: "mp-cams" });
  L.dots = sv("g", { class: "mp-dots" });
  L.sel = sv("g", { class: "mp-sel", display: "none" });
  L.sel.append(sv("circle", { class: "mp-sel-h", r: 11 }), sv("circle", { class: "mp-sel-r", r: 11 }));
  L.labels = sv("g", { class: "mp-plabels" });
  L.cities = sv("g", { class: "mp-cities" });
  L.dest = sv("g", { class: "mp-dest", display: "none" });
  L.dest.innerHTML = '<path class="mp-dest-pole" d="M0 0V-19"/><path class="mp-dest-flag" d="M0 -19h11l-3 4 3 4H0Z"/><circle class="mp-dest-base" r="3"/>';
  L.you = sv("g", { class: "mp-you", display: "none" });
  L.you.innerHTML = '<circle class="mp-you-pulse" r="10"/><circle class="mp-you-shadow" r="11.5"/>' +
    '<g class="mp-you-dir"><path d="M0 -22 7.4 -10.6 0 -13.6 -7.4 -10.6Z"/></g><circle class="mp-you-core" r="7.5"/>' +
    '<g class="mp-ride" display="none"><g class="mp-ride-rot"><g class="mp-ride-art"></g></g></g>'; // the ride, when ride.js is loaded
  L.youDir = L.you.querySelector(".mp-you-dir");
  L.ride = L.you.querySelector(".mp-ride");
  L.rideRot = L.you.querySelector(".mp-ride-rot");
  L.rideArt = L.you.querySelector(".mp-ride-art");
  world.append(L.rest, L.cams, L.dots, L.sel, L.labels, L.cities, L.dest, L.you);

  for (const c of CITIES) {
    const gEl = sv("g", { class: "mp-city r" + c.rank, display: "none" });
    const t = sv("text", { x: 7, dy: "0.35em" });
    t.textContent = c.name;
    gEl.append(sv("circle", { r: c.rank === 0 ? 3.4 : 2.8 }), t);
    L.cities.append(gEl);
    c.el = gEl; c.t = t; c.shownSide = null;
  }
  // far out, cameras and rest areas are small squares on the road; closer in they become full glyphs
  const miniD = list => list.map(it => "M" + r2(it.x) + " " + r2(it.y) + "h.01").join("");
  const mini = (cls, list) => {
    const g = sv("g", { class: "mp-mini " + cls, display: "none" });
    if (list.length) g.append(sv("path", { class: "mp-mini-h", d: miniD(list) }), sv("path", { class: "mp-mini-f", d: miniD(list) }));
    return g;
  };
  L.restMini = mini("rest", RESTS);
  L.camMini = mini("cam", CAMS);
  L.rest.before(L.restMini);
  L.cams.before(L.camMini);
  camG = glyphLayer(L.cams, CAMS, 20, 1.7, L.camMini, () => { const e = sv("g", { class: "mp-cam" }); e.innerHTML = CAM_SVG; return e; });
  restG = glyphLayer(L.rest, RESTS, 22, 0.9, L.restMini, () => { const e = sv("g", { class: "mp-rest" }); e.innerHTML = REST_SVG; return e; });
  labelG = { shown: new Map(), free: [], win: null, k: 0, selKey: null };
  buildDots();
}

/** Landmark dots: one path per category and stamp state, each dot a tiny round-capped stroke. */
function buildDots() {
  if (!L.dots) return;
  const stamps = S().stamps || {};
  const parts = new Map();
  let halo = "";
  for (const P of PTS) {
    const seg = "M" + r2(P.x) + " " + r2(P.y) + "h.01";
    halo += seg;
    const key = (stamps[P.p.id] ? "s" : "u") + (catClass(P.p.cat) || "x");
    parts.set(key, (parts.get(key) || "") + seg);
  }
  L.dots.textContent = "";
  if (!halo) return;
  L.dots.append(sv("path", { class: "mp-halo", d: halo }));
  for (const stampedPass of ["u", "s"]) {
    for (const [key, d] of parts) {
      if (key[0] !== stampedPass) continue;
      const cat = key.slice(1);
      L.dots.append(sv("path", { class: `mp-dot ${cat === "x" ? "other" : cat}${stampedPass === "u" ? " un" : ""}`, d }));
    }
  }
}

function buildControls() {
  const box = el("div", "mp-ctls");
  const zoom = el("div", "mp-zoom");
  zInBtn = button("mp-zb", { html: ICON.plus, label: "Zoom in", title: "Zoom in", onClick: () => zoomBy(2) });
  zOutBtn = button("mp-zb", { html: ICON.minus, label: "Zoom out", title: "Zoom out", onClick: () => zoomBy(0.5) });
  const fit = button("mp-zb", { html: ICON.fit, label: "Whole road", title: "Whole road", onClick: () => wholeRoad() });
  zoom.append(zInBtn, zOutBtn, fit);
  three.btn = button("mp-zb mp-3dbtn", { text: "3D", label: "3D terrain map", title: "3D terrain map", onClick: () => toggle3d() });
  three.btn.setAttribute("aria-pressed", "false");
  zoom.append(three.btn);

  const loc = el("div", "mp-loc");
  const near = button("mp-pill", { html: ICON.locate, text: "Near me", onClick: () => nearMe() });
  followBtn = button("mp-pill", { html: ICON.follow, text: "Follow me", onClick: () => setFollow(!prefs.follow) });
  followBtn.setAttribute("aria-pressed", String(prefs.follow));
  loc.append(near, followBtn);

  scaleEl = el("div", "mp-scale");
  scaleEl.setAttribute("aria-hidden", "true");
  scaleTxt = el("span", null, "");
  scaleBar = el("i");
  scaleEl.append(scaleTxt, scaleBar);
  box.append(scaleEl, zoom, loc);
  return box;
}

function buildLegend() {
  const ul = el("ul", "mp-legend");
  ul.setAttribute("aria-label", "Map key");
  const keys = Object.keys(CATS).filter(k => CAT_KEYS.includes(k));
  for (const k of keys) { const li = el("li", k); li.append(el("i", "mp-k-dot"), String(CATS[k])); ul.append(li); }
  if (PTS.length) {
    const faded = el("li", "mp-k-faded");
    faded.append(el("i", "mp-k-dot"), "Faded: not stamped yet");
    ul.append(faded);
  }
  if (CAMS.length) { const li = el("li"); li.innerHTML = glyphIcon(CAM_SVG); li.append("Live camera"); ul.append(li); }
  if (RESTS.length) { const li = el("li"); li.innerHTML = glyphIcon(REST_SVG); li.append("Rest area"); ul.append(li); }
  const me = el("li");
  me.innerHTML = '<svg class="mp-glyph" viewBox="-10 -10 20 20" aria-hidden="true"><circle class="mp-you-core" r="6.5"/></svg>';
  me.append("You");
  L.legendYou = me;
  ul.append(me);
  setTimeout(safe(updateLegendYou), 0);
  return ul;
}

/* ---------- showing / hiding ---------- */
function show() {
  if (!build()) return;
  onScreen = true;
  fitHeight();
  if (measure()) {
    updateYou(false);
    youShown = you && { x: you.x, y: you.y };
    if (prefs.follow && you) { V.cx = you.x; V.cy = you.y; V.z = Math.max(V.z, 8); clampView(); }
    lastK = 0;
    render();
  }
  flushDots();
  refreshCardBits();
  // a camera picture that was still loading when you left the tab
  const r = camResume;
  camResume = null;
  if (r && r.fig.isConnected && sel && sel.type === "cam" && sel.item === r.c) loadCam(r.fig, r.c, r.fresh);
}
function hide() {
  onScreen = false;
  close3d();            // the 3D map is removed when you leave the Map tab (memory, battery)
  motion = null;
  youAnim = null;
  if (you) youShown = { x: you.x, y: you.y };
  cancelCam(true); // stop downloading a camera picture nobody is looking at
}

/**
 * Keep the whole map, with its Near me / Follow me pills, above the tab bar when the tab opens. CSS sizes it from the
 * small viewport (100svh: browser toolbars showing); this supplies the real room above the map (header, title that
 * may wrap, chips) plus the tab bar, and a viewport height for browsers without svh (iOS 15.0-15.3, Chrome < 108).
 */
let svhOK = null;
function fitHeight() {
  if (!mapEl || !onScreen) return;
  try {
    const de = document.documentElement;
    const tabs = document.querySelector(".tabs");
    const tabH = tabs ? tabs.getBoundingClientRect().height : 0;
    const top = mapEl.getBoundingClientRect().top + (window.pageYOffset || de.scrollTop || 0);
    const above = Math.max(0, Math.round(top + tabH + MAP_GAP));
    if (num(above) && mapEl._above !== above) { mapEl._above = above; mapEl.style.setProperty("--mp-above", above + "px"); }
    if (svhOK == null) svhOK = !!(window.CSS && CSS.supports && CSS.supports("height", "100svh"));
    if (!svhOK) {
      const vv = window.visualViewport;
      if (vv && vv.scale > 1.05) return; // pinch-zoomed: the viewport numbers say nothing about the toolbars
      // documentElement.clientHeight is the layout viewport with the toolbars showing; innerHeight as a cross-check
      const h = Math.min(de.clientHeight || Infinity, window.innerHeight || Infinity);
      if (num(h) && h > 200 && mapEl._vh !== h) {
        mapEl._vh = h;
        mapEl.style.setProperty("--mp-vh", h / 100 + "px");
        mapEl.classList.add("mp-vh");
      }
    }
  } catch (e) { warn(e); }
}
function measure() {
  if (!svg) return false;
  const r = svg.getBoundingClientRect();
  if (!(r.width > 20 && r.height > 20)) return false;
  const changed = r.width !== V.W || r.height !== V.H;
  V.W = r.width; V.H = r.height;
  const room = Math.max(V.H * 0.6, V.H - BOTTOM);
  V.s0 = Math.min(V.W / WW, room / WH);
  V.ox = WW / 2;
  V.oy = WH / 2 + (V.H - room) / 2 / V.s0;
  if (!V.ready) { V.ready = true; V.cx = V.ox; V.cy = V.oy; V.z = 1; }
  if (changed) lastK = 0;
  clampView();
  return true;
}
function onResize() {
  if (!built || !onScreen) return;
  fitHeight();
  if (measure()) render();
}

/* ---------- view math ---------- */
function clampView() {
  V.z = clampZ(V.z);
  if (!V.W) return;
  const k = kNow();
  const ex = V.W / V.s0 / 2, ey = V.H / V.s0 / 2;  // half the area the whole-road view shows
  const hw = V.W / k / 2, hh = V.H / k / 2;
  const mx = V.ox, my = V.oy;
  V.cx = Math.max(mx - ex + hw, Math.min(mx + ex - hw, num(V.cx) ? V.cx : mx));
  V.cy = Math.max(my - ey + hh, Math.min(my + ey - hh, num(V.cy) ? V.cy : my));
}
function clampedCenter(cx, cy, z) {
  const save = [V.cx, V.cy, V.z];
  V.cx = cx; V.cy = cy; V.z = z; clampView();
  const out = [V.cx, V.cy];
  [V.cx, V.cy, V.z] = save;
  return out;
}
function toWorld(sx, sy) { const k = kNow(); return [(sx - V.W / 2) / k + V.cx, (sy - V.H / 2) / k + V.cy]; }
function toScreen(x, y) { const k = kNow(); return [(x - V.cx) * k + V.W / 2, (y - V.cy) * k + V.H / 2]; }

function requestRender() {
  if (raf || !onScreen) return;
  raf = requestAnimationFrame(safe(() => { raf = 0; render(); }));
}

function render() {
  if (!built || !V.W) return;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  const k = kNow(), inv = 1 / k;
  world.setAttribute("transform", `matrix(${k} 0 0 ${k} ${V.W / 2 - V.cx * k} ${V.H / 2 - V.cy * k})`);
  const zoomed = k !== lastK;
  const hw = V.W / 2 / k, hh = V.H / 2 / k;
  const view = [V.cx - hw, V.cy - hh, V.cx + hw, V.cy + hh];
  if (zoomed) {
    lastK = k;
    layoutLabels(k);
    for (const c of CITIES) {
      if (!c.side) { if (c.shownSide !== "") { c.el.setAttribute("display", "none"); c.shownSide = ""; } continue; }
      if (c.shownSide !== c.side) {
        c.el.removeAttribute("display");
        c.t.setAttribute("x", c.side === "r" ? 7 : -7);
        c.t.setAttribute("text-anchor", c.side === "r" ? "start" : "end");
        c.shownSide = c.side;
      }
      c.el.setAttribute("transform", `translate(${r2(c.x)} ${r2(c.y)}) scale(${inv})`);
    }
    for (const s of STATE_NAMES) {
      if (!s.spot) { if (s.shown !== "") { s.el.setAttribute("display", "none"); s.shown = ""; } continue; }
      s.el.removeAttribute("display");
      if (s.drawn !== s.style) {
        s.drawn = s.style;
        s.el.classList.toggle("compact", s.style === "compact");
        s.t.textContent = s.style === "abbr" ? s.abbr : s.name;
      }
      const rot = s.style === "abbr" ? 0 : Math.round(s.spot.rot * 10) / 10;
      s.el.setAttribute("transform", `translate(${r2(s.spot.x)} ${r2(s.spot.y)}) scale(${inv}) rotate(${rot})`);
      s.el.style.opacity = String(Math.max(0, Math.min(1, (4.5 - V.z) / 2)));
      s.shown = "y";
    }
    for (const s of SINGLES) {
      if (!s.spot) { if (s.shown) { s.el.setAttribute("display", "none"); s.shown = false; } continue; }
      s.el.removeAttribute("display");
      s.el.classList.toggle("compact", s.compact);
      s.el.setAttribute("transform", `translate(${r2(s.spot.x)} ${r2(s.spot.y)}) scale(${inv})`);
      s.el.style.opacity = String(Math.max(0, Math.min(1, (s.maxZ - V.z) / (s.maxZ * 0.45))));
      s.shown = true;
    }
    drawYou(); drawSel(); drawDest();
  }
  updateGlyphs(camG, k, view, zoomed, prefs.cams);
  updateGlyphs(restG, k, view, zoomed, prefs.rest);
  updatePlaceLabels(k, view, zoomed);
  updateScale(k);
  updateZoomButtons();
}

/* ---------- labels ---------- */
const hitBox = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
function layoutLabels(k) {
  // Boxes in "zoomed world" pixels (world * k): independent of panning, so labels never flicker while you drag.
  const boxes = [];
  const pad = 2;
  const placeCity = c => {
    const ax = c.x * k, ay = c.y * k, h = c.fs + 3, w = c.w || textW(c.name, c.fs, c.wt);
    const dot = [ax - 4, ay - 4, ax + 4, ay + 4];
    const right = [ax + 6 - pad, ay - h / 2 - pad, ax + 8 + w + pad, ay + h / 2 + pad];
    const left = [ax - 8 - w - pad, ay - h / 2 - pad, ax - 6 + pad, ay + h / 2 + pad];
    c.side = null;
    if (boxes.some(b => hitBox(b, dot))) return;
    if (!boxes.some(b => hitBox(b, right))) c.side = "r";
    else if (!boxes.some(b => hitBox(b, left))) c.side = "l";
    if (c.side) boxes.push(dot, c.side === "r" ? right : left);
  };
  for (const c of CITIES) if (c.rank === 0) placeCity(c);
  // State and ocean names only go where the map can show them: inside the whole-road view (the map never pans past it).
  const ex = V.W / V.s0 / 2, ey = V.H / V.s0 / 2;
  const area = [(V.ox - ex) * k, (V.oy - ey) * k, (V.ox + ex) * k, (V.oy + ey) * k];
  const inArea = b => b[0] >= area[0] && b[1] >= area[1] && b[2] <= area[2] && b[3] <= area[3];
  // State names: every covered state gets the first spot that fits. If one does not fit anywhere, they all step down
  // together, so they always match: a smaller, tighter style that may sit closer to the road (narrow phones), then the
  // short names (CA), as on the Drive tab's ribbon (very small maps).
  const placeStates = (style, margin) => {
    const added = [];
    let all = true;
    for (const s of STATE_NAMES) {
      s.spot = null; s.style = style;
      for (const sp of s.spots) {
        const parts = stateBoxes(s, sp, k, style);
        if (!parts.every(inArea) || parts.some(b => boxes.some(x => hitBox(x, b)) || added.some(x => hitBox(x, b))) || nearRoad(parts, k, margin)) continue;
        s.spot = sp;
        added.push(...parts);
        break;
      }
      if (!s.spot) all = false;
    }
    return { all, added };
  };
  if (V.z <= 4.5) {
    let st = placeStates("full", 9);
    if (!st.all) st = placeStates("compact", 4);
    if (!st.all) st = placeStates("abbr", 4);
    boxes.push(...st.added);
  } else for (const s of STATE_NAMES) s.spot = null;
  for (const c of CITIES) if (c.rank > 0) placeCity(c);
  // The ocean name comes last, so it never pushes a city aside: the first open-water spot that is clear, in the full
  // style and then the compact one, or none.
  for (const s of SINGLES) {
    s.spot = null; s.compact = false;
    if (V.z > s.maxZ) continue;
    for (const compact of [false, true]) {
      const w = (compact ? s.wc : s.w) || 84, sc = compact ? SEA_FS_C / SEA_FS : 1;
      for (const sp of s.spots) {
        const b = [sp.x * k - w / 2 - pad, sp.y * k + s.top * sc - pad, sp.x * k + w / 2 + pad, sp.y * k + s.bottom * sc + pad];
        if (!inArea(b) || boxes.some(x => hitBox(x, b))) continue;
        s.spot = sp; s.compact = compact;
        boxes.push(b);
        break;
      }
      if (s.spot) break;
    }
  }
  cityBoxes = boxes;
}
/** A (possibly rotated) state name as a row of small boxes along its baseline. style: "full" | "compact" | "abbr". */
function stateBoxes(s, sp, k, style) {
  const rot = style === "abbr" ? 0 : sp.rot;
  const out = [], a = rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const fs = style === "compact" ? ST_FS_C : ST_FS;
  const half = (style === "compact" ? s.wc : style === "abbr" ? s.wa : s.w) / 2, cx = sp.x * k, cy = sp.y * k, r = fs * 0.62;
  const ry = rot ? r : fs * 0.5; // level capitals reach about 0.35em above and below the middle
  for (let t = -half; t <= half + 0.1; t += fs * 0.8) out.push([cx + t * ca - r, cy + t * sa - ry, cx + t * ca + r, cy + t * sa + ry]);
  return out;
}
/** Does a label (as boxes) come within `m` pixels of the road? m = 9 clears the road and its glow. */
function nearRoad(parts, k, m = 9) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of parts) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  for (let i = 0; i < RXY.length - 1; i++) {
    const px = RXY[i].x * k, py = RXY[i].y * k, qx = RXY[i + 1].x * k, qy = RXY[i + 1].y * k;
    if (Math.max(px, qx) < x0 - m || Math.min(px, qx) > x1 + m || Math.max(py, qy) < y0 - m || Math.min(py, qy) > y1 + m) continue;
    const n = Math.max(1, Math.min(60, Math.ceil(Math.hypot(qx - px, qy - py) / m)));
    for (let j = 0; j <= n; j++) {
      const ix = px + (qx - px) * j / n, iy = py + (qy - py) * j / n, ib = [ix - m, iy - m, ix + m, iy + m];
      if (parts.some(b => hitBox(b, ib))) return true;
    }
  }
  return false;
}

function updatePlaceLabels(k, view, zoomed) {
  const G = labelG;
  if (!G) return;
  const on = prefs.places && k * U / 69 >= LABEL_PX_PER_MILE;
  if (!on) {
    for (const e of G.shown.values()) { e.setAttribute("display", "none"); G.free.push(e); }
    G.shown.clear(); G.win = null;
    return;
  }
  const selKey = sel && sel.type === "place" ? sel.idx : null;
  if (!zoomed && G.win && G.selKey === selKey && view[0] >= G.win[0] && view[1] >= G.win[1] && view[2] <= G.win[2] && view[3] <= G.win[3]) return;
  const pw = (view[2] - view[0]) * 0.5, ph = (view[3] - view[1]) * 0.5;
  const win = [view[0] - pw, view[1] - ph, view[2] + pw, view[3] + ph];
  G.win = win; G.selKey = selKey;
  const boxes = cityBoxes.slice();
  const want = new Map();
  const order = selKey != null ? [selKey, ...PLACE_ORDER] : PLACE_ORDER;
  for (const i of order) {
    if (want.size >= MAX_PLACE_LABELS) break;
    if (want.has(i)) continue;
    const P = PTS[i];
    if (!P || P.x < win[0] || P.x > win[2] || P.y < win[1] || P.y > win[3]) continue;
    if (!P.w) P.w = textW(P.label, 11, 700);
    const pw = i === selKey ? textW(P.label, 11, 900) : P.w;
    const ax = P.x * k, ay = P.y * k, h = 13;
    const r = [ax + 7, ay - h / 2, ax + 9 + pw, ay + h / 2], l = [ax - 9 - pw, ay - h / 2, ax - 7, ay + h / 2];
    for (const [b, side] of P.p.side === -1 ? [[l, "l"], [r, "r"]] : [[r, "r"], [l, "l"]]) {
      if (boxes.some(x => hitBox(x, b))) continue;
      boxes.push(b); want.set(i, side);
      break;
    }
  }
  for (const [i, e] of G.shown) if (!want.has(i)) { e.setAttribute("display", "none"); G.free.push(e); G.shown.delete(i); }
  const inv = 1 / k;
  for (const [i, side] of want) {
    const P = PTS[i];
    let e = G.shown.get(i), fresh = false;
    if (!e) {
      e = G.free.pop();
      if (!e) { e = sv("g", { class: "mp-plabel" }); e.append(sv("text", { dy: "0.35em" })); L.labels.append(e); }
      e.removeAttribute("display");
      e.firstChild.textContent = P.label;
      e.classList.toggle("is-sel", i === selKey);
      G.shown.set(i, e);
      fresh = true;
    } else e.classList.toggle("is-sel", i === selKey);
    if (fresh || e._side !== side) {
      e._side = side;
      e.firstChild.setAttribute("x", side === "r" ? 8 : -8);
      e.firstChild.setAttribute("text-anchor", side === "r" ? "start" : "end");
    }
    if (fresh || zoomed) e.setAttribute("transform", `translate(${r2(P.x)} ${r2(P.y)}) scale(${inv})`);
  }
}

/* ---------- camera and rest-area glyphs (thinned at low zoom, pooled, counter-scaled) ---------- */
function glyphLayer(group, items, gap, lod, miniEl, make) {
  return { group, items, gap, lod, miniEl, make, shown: new Map(), free: [], thin: [], thinK: 0, win: null, mini: false };
}
function updateGlyphs(G, k, view, zoomed, on) {
  if (!G) return;
  const mini = on && k * U / 69 < G.lod; // pixels per mile below the level of detail: small squares instead
  if (mini !== G.mini || zoomed) { if (mini) G.miniEl.removeAttribute("display"); else G.miniEl.setAttribute("display", "none"); }
  G.mini = mini;
  if (!on || mini || !G.items.length) {
    if (G.shown.size) { for (const e of G.shown.values()) { e.setAttribute("display", "none"); G.free.push(e); } G.shown.clear(); }
    G.win = null;
    return;
  }
  if (G.thinK !== k) {
    // keep one glyph per `gap` pixels along the road so the low zooms stay readable
    const min = G.gap / k, min2 = min * min;
    const keep = [];
    let lx = -1e9, ly = -1e9;
    G.items.forEach((it, i) => {
      const dx = it.x - lx, dy = it.y - ly;
      if (dx * dx + dy * dy >= min2) { keep.push(i); lx = it.x; ly = it.y; }
    });
    G.thin = keep; G.thinK = k; G.win = null;
  }
  if (!zoomed && G.win && view[0] >= G.win[0] && view[1] >= G.win[1] && view[2] <= G.win[2] && view[3] <= G.win[3]) return;
  const pw = (view[2] - view[0]) * 0.5, ph = (view[3] - view[1]) * 0.5;
  const win = [view[0] - pw, view[1] - ph, view[2] + pw, view[3] + ph];
  G.win = win;
  const want = new Set();
  for (const i of G.thin) { const it = G.items[i]; if (it.x >= win[0] && it.x <= win[2] && it.y >= win[1] && it.y <= win[3]) want.add(i); }
  for (const [i, e] of G.shown) if (!want.has(i)) { e.setAttribute("display", "none"); G.free.push(e); G.shown.delete(i); }
  const inv = 1 / k;
  for (const i of want) {
    let e = G.shown.get(i), fresh = false;
    if (!e) {
      e = G.free.pop() || G.group.appendChild(G.make());
      e.removeAttribute("display");
      G.shown.set(i, e);
      fresh = true;
    }
    if (fresh || zoomed) e.setAttribute("transform", `translate(${r2(G.items[i].x)} ${r2(G.items[i].y)}) scale(${inv})`);
  }
}

/* ---------- scale bar and zoom buttons ---------- */
let scaleKey = "";
function updateScale(k) {
  if (!scaleEl) return;
  const latC = LAT_N - V.cy / U;
  const pxPerMile = k * U * KX / (69.17 * Math.max(0.2, Math.cos(latC * Math.PI / 180)));
  const target = 84 / pxPerMile;
  let mi = 0.5;
  for (const n of [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]) if (n <= target) mi = n;
  const w = Math.round(mi * pxPerMile);
  const key = mi + ":" + w;
  if (key === scaleKey) return;
  scaleKey = key;
  scaleBar.style.width = w + "px";
  scaleTxt.textContent = `${mi} mi`;
}
function updateZoomButtons() {
  if (!zInBtn) return;
  const inD = V.z >= ZMAX - 1e-6, outD = V.z <= ZMIN + 1e-6;
  if (zInBtn.disabled !== inD) zInBtn.disabled = inD;
  if (zOutBtn.disabled !== outD) zOutBtn.disabled = outD;
}

/* ---------- you, your destination and the selection ---------- */
function updateYou(draw = true) {
  const st = S();
  const m = st.m;
  const c = m != null ? coordAt(m) : null;
  if (!c) { you = null; }
  else {
    let ang = 0;
    const a = coordAt(Math.max(0, m - 0.8)), b = coordAt(Math.min(MAXM, m + 0.8));
    if (a && b) {
      const dx = X(b[1]) - X(a[1]), dy = Y(b[0]) - Y(a[0]);
      if (dx || dy) ang = Math.atan2(dx, -dy) * 180 / Math.PI;
    }
    if (st.dir === "S") ang += 180;
    you = { x: X(c[1]), y: Y(c[0]), ang, m };
  }
  const dm = st.dest && num(st.dest.m) ? st.dest.m : null;
  if (dm !== destM) { destM = dm; drawDest(); }
  if (draw) drawYou();
}
/** The ride (ride.js) as the marker: which way it faces, how far it tilts, and whether it is moving or asleep.
    Never assumes ride.js loaded: null means "draw the plain marker". The art is a side view, so it never turns upside
    down: it faces left or right by the heading and only tilts a little (nose up when heading north). */
function rideBits() {
  const ra = api && api.ride;
  if (!you || !ra || typeof ra.svg !== "function" || typeof ra.get !== "function") return null;
  const st = S();
  let h = null;
  if (st.mode === "gps" && num(st.heading)) h = st.heading;
  if (h == null) {
    try { const b = api.geo && api.geo.bearingAt ? api.geo.bearingAt(you.m) : null; if (num(b)) h = (b + (st.dir === "S" ? 180 : 0)) % 360; } catch {}
  }
  if (h == null) h = ((you.ang % 360) + 360) % 360;
  const rad = h * Math.PI / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
  rideFace = Math.abs(dx) > 0.25 ? (dx > 0 ? "right" : "left") : (st.dir === "S" ? "left" : "right");
  const along = rideFace === "right" ? Math.max(0, dx) : Math.max(0, -dx);
  let tilt = Math.atan2(dy, along) * 180 / Math.PI;     // -90 (north) .. 90 (south) for a right-facing ride
  if (rideFace === "left") tilt = -tilt;
  tilt = Math.round(tilt * 0.45 * 2) / 2;
  let state = "idle";
  try { if (typeof ra.state === "function") state = ra.state(); } catch {}
  let key = "";
  try { key = JSON.stringify(ra.get()) + rideFace; } catch {}
  return { ra, face: rideFace, tilt, state, key };
}
/** Draw the marker where it is shown. Moves under a third of a pixel are skipped: they cost a repaint and show nothing. */
function drawYou() {
  if (!L.you) return;
  if (!you) { if (youDrawn !== false) { L.you.setAttribute("display", "none"); youDrawn = false; } return; }
  const st = S(), at = youShown || you, k = kNow();
  const ang = Math.round(you.ang * 10) / 10, live = st.mode === "gps" || st.mode === "demo", lost = !!st.offRoute;
  const rb = rideBits(), rk = rb ? rb.key : "", tilt = rb ? rb.tilt : 0, rs = rb ? rb.state : "";
  const d = youDrawn;
  if (d && d.k === k && d.live === live && d.lost === lost && Math.abs(d.ang - ang) < 0.5 && d.rk === rk && d.tilt === tilt && d.rs === rs &&
    Math.abs(at.x - d.x) * k < 0.3 && Math.abs(at.y - d.y) * k < 0.3) return;
  L.you.removeAttribute("display");
  L.you.setAttribute("transform", `translate(${r2(at.x)} ${r2(at.y)}) scale(${1 / k})`);
  if (!d || d.ang !== ang) L.youDir.setAttribute("transform", `rotate(${ang})`);
  if (!d || d.live !== live) L.you.classList.toggle("live", live);
  if (!d || d.lost !== lost) L.you.classList.toggle("lost", lost);
  if (!d || d.rk !== rk) {
    L.you.classList.toggle("has-ride", !!rb);
    if (rb) {
      L.ride.removeAttribute("display");
      try { L.rideArt.innerHTML = `<g transform="translate(-23 -21)">${rb.ra.svg({ markup: true, size: 46, facing: rb.face })}</g>`; } catch (e) { warn(e); }
    } else { L.ride.setAttribute("display", "none"); L.rideArt.textContent = ""; }
  }
  if (rb && (!d || d.tilt !== tilt)) L.rideRot.setAttribute("transform", `rotate(${tilt})`);
  if (!d || d.rs !== rs) for (const c of ["moving", "idle", "sleepy"]) L.you.classList.toggle("ride-" + c, rs === c);
  youDrawn = { x: at.x, y: at.y, k, ang, live, lost, rk, tilt, rs };
}
/** The ride changed, or woke up or fell asleep: redraw the marker and the legend's "You". */
function onRide() {
  if (!built) return;
  updateLegendYou();
  drawYou();
}
function updateLegendYou() {
  if (!L.legendYou) return;
  const ra = api && api.ride;
  const old = L.legendYou.firstElementChild;
  if (!old) return;
  if (ra && typeof ra.svg === "function") {
    old.replaceWith(ra.svg({ size: 30, zz: false }));
  }
}
/** Run the "here you are" pulse again (it runs a few times when tracking starts or the map opens, then rests). */
function pingYou() {
  try {
    const p = L.you && L.you.querySelector(".mp-you-pulse");
    if (p && p.getAnimations) for (const a of p.getAnimations()) { a.cancel(); a.play(); }
  } catch {}
}
function drawDest() {
  if (!L.dest) return;
  const c = destM != null ? coordAt(destM) : null;
  if (!c) { L.dest.setAttribute("display", "none"); return; }
  L.dest.removeAttribute("display");
  L.dest.setAttribute("transform", `translate(${r2(X(c[1]))} ${r2(Y(c[0]))}) scale(${1 / kNow()})`);
}
function drawSel() {
  if (!L.sel) return;
  if (!sel) { L.sel.setAttribute("display", "none"); return; }
  L.sel.removeAttribute("display");
  const r = sel.type === "place" ? 9 : sel.type === "road" ? 7 : 12.5;
  for (const c of L.sel.children) c.setAttribute("r", r);
  L.sel.setAttribute("transform", `translate(${r2(sel.x)} ${r2(sel.y)}) scale(${1 / kNow()})`);
}

/* ---------- interaction: pan, pinch, wheel, taps, keys ---------- */
const ptrs = new Map();
let gest = null, rect0 = null, lastTap = null, revealTimer = 0, deselTimer = 0;

function wireMap() {
  svg.addEventListener("pointerdown", safe(onDown));
  svg.addEventListener("pointermove", safe(onMove));
  svg.addEventListener("pointerup", safe(onUp));
  svg.addEventListener("pointercancel", safe(onCancel));
  svg.addEventListener("wheel", safe(onWheel), { passive: false });
  svg.addEventListener("contextmenu", e => e.preventDefault());
  // iOS Safari: keep two-finger gestures on the map from zooming the whole page
  for (const t of ["gesturestart", "gesturechange"]) mapEl.addEventListener(t, e => e.preventDefault());
  mapEl.addEventListener("keydown", safe(onKey));
  try {
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(safe(onResize));
      ro.observe(mapEl);
      if (headEl) ro.observe(headEl); // the title or the stamp count wraps: the map moves down, so it must get shorter
    } else window.addEventListener("resize", safe(onResize));
  } catch { window.addEventListener("resize", safe(onResize)); }
}

function stopMotion() { motion = null; }

function onDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  stopMotion();
  if (e.pointerType === "mouse") { e.preventDefault(); try { mapEl.focus({ preventScroll: true }); } catch {} }
  try { svg.setPointerCapture(e.pointerId); } catch {}
  rect0 = svg.getBoundingClientRect();
  const p = { x: e.clientX - rect0.left, y: e.clientY - rect0.top, touch: e.pointerType !== "mouse" };
  ptrs.set(e.pointerId, p);
  const now = performance.now();
  if (ptrs.size === 1) {
    gest = { kind: "pan", x0: p.x, y0: p.y, cx0: V.cx, cy0: V.cy, moved: false, noTap: false, t0: now, samples: [[now, p.x, p.y]], touch: p.touch, twoTap: null };
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    gest = { kind: "pinch", d0: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)), z0: V.z, mx0: mx, my0: my, w: toWorld(mx, my), moved: false, t0: now };
  }
  svg.classList.add("grabbing");
}

function onMove(e) {
  const p = ptrs.get(e.pointerId);
  if (!p || !gest || !rect0) return;
  p.x = e.clientX - rect0.left; p.y = e.clientY - rect0.top;
  if (gest.kind === "pan") {
    const dx = p.x - gest.x0, dy = p.y - gest.y0;
    if (!gest.moved) {
      if (Math.hypot(dx, dy) < (gest.touch ? 9 : 4)) return;
      gest.moved = true;
      if (prefs.follow) setFollow(false, true);
    }
    const k = kNow();
    V.cx = gest.cx0 - dx / k; V.cy = gest.cy0 - dy / k;
    clampView();
    const now = performance.now();
    gest.samples.push([now, p.x, p.y]);
    while (gest.samples.length > 2 && now - gest.samples[0][0] > 110) gest.samples.shift();
    requestRender();
  } else if (gest.kind === "pinch") {
    const it = [...ptrs.values()];
    const a = it[0], b = it[1];
    if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (!gest.moved) {
      if (Math.abs(d - gest.d0) < 8 && Math.hypot(mx - gest.mx0, my - gest.my0) < 8) return;
      gest.moved = true;
    }
    V.z = clampZ(gest.z0 * d / gest.d0);
    const k = kNow();
    if (prefs.follow && you) { V.cx = youAt().x; V.cy = youAt().y; }
    else { V.cx = gest.w[0] - (mx - V.W / 2) / k; V.cy = gest.w[1] - (my - V.H / 2) / k; }
    clampView();
    requestRender();
  }
}

function onUp(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  try { svg.releasePointerCapture(e.pointerId); } catch {}
  const now = performance.now();
  if (gest && gest.kind === "pinch") {
    const quick = !gest.moved && now - gest.t0 < 380;
    if (ptrs.size >= 2) {
      // a third finger lifted: carry on pinching with the two that are left
      const [a, b] = [...ptrs.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      gest = { kind: "pinch", d0: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)), z0: V.z, mx0: mx, my0: my, w: toWorld(mx, my), moved: true, t0: gest.t0 };
    } else if (ptrs.size === 1) {
      // one finger left: keep panning with it, and remember a possible two-finger tap
      const [q] = ptrs.values();
      gest = { kind: "pan", x0: q.x, y0: q.y, cx0: V.cx, cy0: V.cy, moved: false, noTap: true, t0: gest.t0, samples: [], touch: true, twoTap: quick ? [gest.mx0, gest.my0] : null };
    } else gest = null;
  } else if (gest && gest.kind === "pan" && ptrs.size === 0) {
    if (gest.twoTap && !gest.moved && now - gest.t0 < 500) {
      // two-finger tap zooms out; with Follow me on it keeps you in the middle instead of the spot between the fingers
      if (prefs.follow && you) zoomBy(0.5); else zoomAround(gest.twoTap[0], gest.twoTap[1], V.z / 2, 280);
    } else if (!gest.moved && !gest.noTap && now - gest.t0 < 700) onTap(p.x, p.y, gest.touch);
    else if (gest.moved) fling(gest.samples);
    gest = null;
  }
  if (!ptrs.size) svg.classList.remove("grabbing");
}
function onCancel(e) {
  ptrs.delete(e.pointerId);
  if (!ptrs.size) { gest = null; svg.classList.remove("grabbing"); }
}

function onWheel(e) {
  e.preventDefault();
  stopMotion();
  const r = svg.getBoundingClientRect();
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  const f = Math.exp(-Math.max(-300, Math.min(300, dy)) * (e.ctrlKey ? 0.012 : 0.0025));
  const z = clampZ(V.z * f);
  if (z === V.z) return;
  if (prefs.follow && you) { V.z = z; V.cx = youAt().x; V.cy = youAt().y; clampView(); requestRender(); return; }
  zoomAround(e.clientX - r.left, e.clientY - r.top, z, 0);
}

function onKey(e) {
  if (e.target !== mapEl || e.altKey || e.metaKey || e.ctrlKey || three.on) return;
  const step = 0.2;
  switch (e.key) {
    case "ArrowLeft": panBy(-V.W * step, 0); break;
    case "ArrowRight": panBy(V.W * step, 0); break;
    case "ArrowUp": panBy(0, -V.H * step); break;
    case "ArrowDown": panBy(0, V.H * step); break;
    case "+": case "=": zoomBy(2); break;
    case "-": case "_": zoomBy(0.5); break;
    case "0": wholeRoad(); break;
    case "Escape": if (!sel) return; select(null); break;
    default: return;
  }
  e.preventDefault();
}

function onTap(x, y, touch) {
  const now = performance.now();
  if (lastTap && now - lastTap.t < 330 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
    lastTap = null;
    clearTimeout(revealTimer);
    clearTimeout(deselTimer); // a double-tap zooms; it does not close the card you were reading
    if (prefs.follow && you) zoomBy(2); else zoomAround(x, y, V.z * 2, 300);
    return;
  }
  lastTap = { t: now, x, y };
  clearTimeout(deselTimer);
  const hit = hitTest(x, y, touch ? 24 : 13);
  if (hit) { select(hit); scheduleReveal(); return; }
  const road = roadHit(x, y, touch ? 16 : 9);
  if (road) { select(road); scheduleReveal(); return; }
  // An empty tap closes the card, but only once it is clearly not the first half of a double-tap.
  if (sel) { const was = sel; deselTimer = setTimeout(safe(() => { if (sel === was) select(null); }), 340); }
}

function hitTest(sx, sy, radius) {
  const [wx, wy] = toWorld(sx, sy);
  const k = kNow();
  let best = null, bd = radius * radius;
  const consider = (type, list, i) => {
    const it = list[i];
    const dx = (it.x - wx) * k, dy = (it.y - wy) * k, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = { type, idx: i }; }
  };
  if (prefs.rest && restG) for (const i of restG.mini ? RESTS.keys() : restG.shown.keys()) consider("rest", RESTS, i);
  if (prefs.cams && camG) for (const i of camG.mini ? CAMS.keys() : camG.shown.keys()) consider("cam", CAMS, i);
  if (prefs.places) {
    // dots sit on top: give them a small edge so a dot beats a glyph right under it
    const keep = bd;
    bd = Math.min(bd * 1.35, radius * radius);
    const before = best;
    for (let i = 0; i < PTS.length; i++) consider("place", PTS, i);
    if (best === before) bd = keep;
  }
  if (!best) return null;
  const it = listFor(best.type)[best.idx];
  return { type: best.type, idx: best.idx, item: it.item, x: it.x, y: it.y, m: it.m };
}

function roadHit(sx, sy, radius) {
  if (RXY.length < 2) return null;
  const [wx, wy] = toWorld(sx, sy);
  const k = kNow(), lim = radius / k;
  let best = null, bd = lim * lim;
  for (let i = 0; i < RXY.length - 1; i++) {
    const a = RXY[i], b = RXY[i + 1];
    if (Math.min(a.x, b.x) - lim > wx || Math.max(a.x, b.x) + lim < wx || Math.min(a.y, b.y) - lim > wy || Math.max(a.y, b.y) + lim < wy) continue;
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / L2));
    const px = a.x + t * dx, py = a.y + t * dy, d = (px - wx) ** 2 + (py - wy) ** 2;
    if (d < bd) { bd = d; best = { type: "road", m: a.m + t * (b.m - a.m), x: px, y: py }; }
  }
  return best;
}

function scheduleReveal() {
  clearTimeout(revealTimer);
  revealTimer = setTimeout(safe(() => {
    const c = cardEl && cardEl.firstElementChild;
    if (!c || !onScreen) return;
    const r = c.getBoundingClientRect();
    const tabs = document.querySelector(".tabs");
    const bottom = (window.innerHeight || 0) - (tabs ? tabs.getBoundingClientRect().height : 70);
    if (r.top > bottom - 56) c.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }), 340);
}

/* ---------- motion ---------- */
function animate(fn, ms, tag = "", zTarget = null) {
  const token = { tag, zTarget };
  motion = token;
  if (!ms || reducedMotion() || !onScreen) { fn(1); clampView(); render(); motion = null; return; }
  const t0 = performance.now();
  const step = safe(now => {
    if (motion !== token) return;
    const t = Math.min(1, (now - t0) / ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    fn(e);
    clampView();
    render();
    if (t < 1) requestAnimationFrame(step); else motion = null;
  });
  requestAnimationFrame(step);
}

/** Smooth zoom-and-pan (van Wijk and Nuij), like a camera pulling back, gliding over, then diving in. */
function flyTo(cx, cy, z, maxMs = 1100) {
  if (!V.W) { V.cx = cx; V.cy = cy; V.z = clampZ(z); clampView(); return; }
  const z1 = clampZ(z);
  const [tx, ty] = clampedCenter(cx, cy, z1);
  const w0 = V.W / kNow(), w1 = V.W / (z1 * V.s0);
  const ux0 = V.cx, uy0 = V.cy, dx = tx - ux0, dy = ty - uy0, d2 = dx * dx + dy * dy;
  const rho = Math.SQRT2;
  let path, S0;
  if (d2 < 1e-9) {
    S0 = Math.log(w1 / w0) / rho;
    path = t => [ux0, uy0, w0 * Math.exp(rho * t * S0)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1), b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S0 = (r1 - r0) / rho;
    path = t => {
      const s = t * S0, u = w0 / (2 * d1) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, w0 * Math.cosh(r0) / Math.cosh(rho * s + r0)];
    };
  }
  const ms = Math.max(280, Math.min(maxMs, Math.abs(S0) * 1000 * 0.55));
  animate(e => {
    const [x, y, w] = e >= 1 ? [tx, ty, w1] : path(e);
    V.z = e >= 1 ? z1 : clampZ(V.W / (w * V.s0)); V.cx = x; V.cy = y;
  }, ms, "fly");
}

function zoomAround(sx, sy, z, ms = 260) {
  const z1 = clampZ(z), z0 = V.z;
  if (Math.abs(z1 - z0) < 1e-6) return;
  const [wx, wy] = toWorld(sx, sy);
  animate(e => {
    V.z = e >= 1 ? z1 : z0 * Math.pow(z1 / z0, e);
    const k = kNow();
    V.cx = wx - (sx - V.W / 2) / k; V.cy = wy - (sy - V.H / 2) / k;
  }, ms, "zoom", z1);
}
/** The zoom we are heading to: the target of a zoom still in progress, or the current one. */
const zoomGoal = () => (motion && motion.zTarget != null ? motion.zTarget : V.z);

function fling(samples) {
  if (reducedMotion() || !samples || samples.length < 2) return;
  const a = samples[0], b = samples[samples.length - 1], now = performance.now();
  if (now - b[0] > 90 || b[0] - a[0] < 12) return; // the finger rested before lifting
  let vx = (b[1] - a[1]) / (b[0] - a[0]), vy = (b[2] - a[2]) / (b[0] - a[0]);
  const sp = Math.hypot(vx, vy);
  if (sp < 0.25) return;
  if (sp > 3.5) { vx *= 3.5 / sp; vy *= 3.5 / sp; }
  const token = {};
  motion = token;
  let t = now;
  const step = safe(ts => {
    if (motion !== token) return;
    const dt = Math.min(40, Math.max(1, ts - t));
    t = ts;
    const k = kNow(), ox = V.cx, oy = V.cy;
    V.cx -= vx * dt / k; V.cy -= vy * dt / k;
    clampView();
    if (Math.abs(V.cx - (ox - vx * dt / k)) > 1e-6) vx = 0;
    if (Math.abs(V.cy - (oy - vy * dt / k)) > 1e-6) vy = 0;
    const f = Math.exp(-dt / 320);
    vx *= f; vy *= f;
    render();
    if (Math.hypot(vx, vy) > 0.02) requestAnimationFrame(step); else motion = null;
  });
  requestAnimationFrame(step);
}

function panBy(dx, dy) {
  if (prefs.follow) setFollow(false, true);
  const k = kNow();
  const x0 = V.cx, y0 = V.cy, x1 = x0 + dx / k, y1 = y0 + dy / k;
  animate(e => { V.cx = x0 + (x1 - x0) * e; V.cy = y0 + (y1 - y0) * e; }, 200);
}
function zoomBy(f) {
  if (!V.W) return;
  const goal = zoomGoal(); // quick presses add up even while a zoom is still animating
  if (prefs.follow && you) flyToFollow(goal * f);
  else zoomAround(V.W / 2, V.H / 2, goal * f, 260);
}
function flyToFollow(z) {
  if (!you) return;
  const z0 = V.z, z1 = clampZ(z), x0 = V.cx, y0 = V.cy;
  animate(e => { const at = youAt(); V.z = e >= 1 ? z1 : z0 * Math.pow(z1 / z0, e); V.cx = x0 + (at.x - x0) * e; V.cy = y0 + (at.y - y0) * e; }, 300, "zoom", z1);
}
function wholeRoad() {
  setFollow(false, true);
  flyTo(V.ox, V.oy, 1, 900);
}
function nearMe() {
  updateYou();
  if (!you) { toast("No position yet. Start GPS or a demo drive on the Drive tab."); return; }
  flyTo(you.x, you.y, Math.max(V.z, 12));
  pingYou();
}
function setFollow(on, quiet) {
  prefs.follow = !!on;
  savePrefs();
  if (followBtn) followBtn.setAttribute("aria-pressed", String(prefs.follow));
  if (!prefs.follow || quiet) return;
  updateYou();
  if (you) { flyTo(you.x, you.y, Math.max(V.z, 10)); pingYou(); }
  else toast("The map will follow you once GPS or a demo drive is running.");
}
function ensureVisible(x, y, z) {
  const [sx, sy] = toScreen(x, y);
  const mx = V.W * 0.14, my = V.H * 0.14;
  const zz = z != null ? clampZ(z) : V.z;
  if (zz === V.z && sx > mx && sx < V.W - mx && sy > my && sy < V.H - my) return;
  if (prefs.follow) setFollow(false, true);
  flyTo(x, y, zz, 700);
}

/* ---------- the 3D terrain view ---------- */
/** The 3D button: open the 3D map (MapLibre, loaded only now) or go back to 2D. */
function toggle3d() { if (three.on || three.busy) close3d(); else open3d(); }
const NOTE_3D = "The 3D map needs a connection and 3D graphics. Here\u2019s the regular map.";
async function open3d() {
  if (three.on || three.busy || !built || !mapEl) return false;
  three.busy = true; three.on = true;
  mapEl.classList.add("mp-3d-on");
  if (three.btn) three.btn.setAttribute("aria-pressed", "true");
  clearNote();
  const host = three.host = el("div", "mp-3d-host");
  mapEl.append(host);
  let ok = false;
  try {
    const mod = three.mod = three.mod || await import("./map3d.js");
    if (three.host !== host) { try { mod.close(); } catch {} return false; } // closed (tab left, or 2D tapped) while loading
    ok = !!(await mod.open(api, host, { onExit: reason => { if (three.host === host) { close3d(); if (reason !== "user") showNote(NOTE_3D); } } }));
  } catch (e) { warn(e); ok = false; }
  three.busy = false;
  if (three.host !== host) return false;
  if (!ok) { close3d(); showNote(NOTE_3D); return false; }
  return true;
}
/** Back to the 2D map: the MapLibre map is removed (map.remove()) so it stops using memory and battery. */
function close3d() {
  if (!three.on && !three.host) return;
  three.on = false;
  const host = three.host;
  three.host = null;
  try { if (three.mod) three.mod.close(); } catch (e) { warn(e); }
  if (host) host.remove();
  if (mapEl) mapEl.classList.remove("mp-3d-on");
  if (three.btn) three.btn.setAttribute("aria-pressed", "false");
  if (onScreen) { lastK = 0; render(); }
}
function showNote(text) {
  clearNote();
  if (!mapEl) return;
  const n = three.note = el("p", "mp-3d-note", text);
  n.setAttribute("role", "status");
  mapEl.append(n);
  three.noteTimer = setTimeout(safe(clearNote), 9000);
}
function clearNote() {
  clearTimeout(three.noteTimer);
  if (three.note) { three.note.remove(); three.note = null; }
}

/* ---------- live updates from the app ---------- */
function onPos(e) {
  const from = youShown;
  const now = performance.now();
  if (lastPosAt) posGap = Math.max(250, Math.min(1500, now - lastPosAt));
  lastPosAt = now;
  updateYou(false);
  if (!you) { youShown = null; youAnim = null; drawYou(); return; }
  const to = { x: you.x, y: you.y };
  const live = built && onScreen && V.W > 0;
  // How far the marker moves on screen. At road speeds a GPS fix moves it a fraction of a pixel (65 mph at 1 Hz is
  // under 0.1 px at street zoom), so there is nothing to animate: it jumps, with one small redraw per fix at most.
  const px = from ? Math.hypot(to.x - from.x, to.y - from.y) * kNow() : Infinity;
  if (!live || (e && e.jumped) || px < GLIDE_MIN_PX || px > 300 || reducedMotion()) {
    youShown = to; youAnim = null;
    if (live) { followYou(); refreshCardBits(); } else if (onScreen) drawYou(); // hidden: show() draws it
    return;
  }
  // A step you can see (the fast demo): glide over the time until the next update, at about 30 frames a second.
  const token = {}, t0 = now, dur = posGap;
  let last = -1e9;
  youAnim = token;
  const step = safe(ts => {
    if (youAnim !== token || !onScreen) return;
    const t = Math.max(0, Math.min(1, (ts - t0) / dur));
    if (t < 1 && ts - last < GLIDE_FRAME_MS) { requestAnimationFrame(step); return; }
    last = ts;
    youShown = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    followYou();
    if (t < 1) requestAnimationFrame(step); else youAnim = null;
  });
  requestAnimationFrame(step);
  refreshCardBits();
}
/** Draw the marker; with Follow me on, keep the view centered on it, skipping recenters smaller than half a pixel. */
function followYou() {
  const at = youAt();
  if (at && prefs.follow && V.W && !(motion && motion.tag === "fly")) {
    const [cx, cy] = clampedCenter(at.x, at.y, V.z);
    const k = kNow();
    if (Math.abs(cx - V.cx) * k >= 0.5 || Math.abs(cy - V.cy) * k >= 0.5) { V.cx = cx; V.cy = cy; render(); }
  }
  drawYou();
}
/** Passport stamps come in bursts (one event per place after a GPS gap): redraw the dots once, and only on screen. */
function onStamps() {
  if (!built) return;
  dotsDirty = true;
  if (!onScreen || dotsRaf) return;
  dotsRaf = requestAnimationFrame(safe(flushDots));
  clearTimeout(dotsTimer);
  dotsTimer = setTimeout(safe(flushDots), 250); // animation frames can be throttled (low-power mode, hidden iframes)
}
function flushDots() {
  if (dotsRaf) { cancelAnimationFrame(dotsRaf); dotsRaf = 0; }
  clearTimeout(dotsTimer); dotsTimer = 0;
  if (!dotsDirty || !built) return;
  dotsDirty = false;
  buildDots();
  updateSummary();
  if (sel && sel.type === "place") refreshCardBits();
}
function onSettings() {
  if (!built) return;
  // live road info was just turned on: load the picture of a selected camera
  const st = api.settings || {};
  if (st.live === true && sel && sel.type === "cam") {
    const fig = cardEl.querySelector(".mp-live.consent");
    if (fig) loadCam(fig, sel.item, false);
  }
}

function setLayer(name, on) {
  if (!(name in prefs) || name === "follow") return;
  prefs[name] = !!on;
  savePrefs();
  if (!built) return;
  applyLayers();
  if (sel && ((sel.type === "place" && !prefs.places) || (sel.type === "cam" && !prefs.cams) || (sel.type === "rest" && !prefs.rest))) select(null);
  lastK = 0;
  render();
}
function applyLayers() {
  if (chipsEl) for (const b of chipsEl.querySelectorAll("[data-layer]")) b.setAttribute("aria-pressed", String(!!prefs[b.dataset.layer]));
  if (L.dots) { if (prefs.places) L.dots.removeAttribute("display"); else L.dots.setAttribute("display", "none"); }
}

function updateSummary() {
  if (!sumEl) return;
  const stamps = S().stamps || {};
  const n = PLACES.length;
  let got = 0;
  for (const p of PLACES) if (stamps[p.id]) got++;
  sumEl.textContent = n ? `${n.toLocaleString("en-US")} landmark${n === 1 ? "" : "s"} · ${got.toLocaleString("en-US")} stamped` : "Landmarks are on their way";
}

/* ---------- selection and the card under the map ---------- */
function selectIdx(type, i, opts = {}) {
  const list = listFor(type);
  const it = list[i];
  if (!it) return;
  select({ type, idx: i, item: it.item, x: it.x, y: it.y, m: it.m });
  if (opts.fly) {
    if (prefs.follow) setFollow(false, true); // or the next GPS fix would pull the view back to you
    flyTo(it.x, it.y, opts.fly, 900);
  } else if (opts.center) ensureVisible(it.x, it.y);
}
function select(s) {
  sel = s || null;
  drawSel();
  if (labelG) labelG.win = null;
  requestRender();
  renderCard();
  if (liveEl) {
    const n = cardEl.querySelector(".mp-name"), m = cardEl.querySelector(".mp-meta");
    liveEl.textContent = sel && n ? `${n.textContent}. ${m ? m.textContent : ""}` : "";
  }
}

let whereEl = null, hearBtn = null, hintKey = "";
function renderCard() {
  if (!cardEl) return;
  whereEl = null; hearBtn = null;
  cancelCam(false); camResume = null; // the old card's camera picture, if still loading, is no longer wanted
  cardEl.textContent = "";
  let card;
  try {
    card = !sel ? hintCard() : sel.type === "place" ? placeCard(sel.item) : sel.type === "cam" ? camCard(sel.item) : sel.type === "rest" ? restCard(sel.item) : roadCard(sel);
  } catch (e) { warn(e); card = hintCard(); }
  cardEl.append(card);
  refreshCardBits();
}

function cardTop(card, icon, meta, name) {
  const top = el("div", "mp-top");
  const head = el("div", "mp-headtxt");
  head.append(el("div", "mp-meta", meta), el("h3", "mp-name", name));
  whereEl = el("div", "mp-where");
  head.append(whereEl);
  const close = button("mp-x", {
    html: ICON.close, label: "Close",
    onClick: () => {
      select(null);
      // the button just vanished with its card: keep keyboard and switch users where they were
      try { (cardEl.querySelector(".mp-next") || mapEl).focus({ preventScroll: true }); } catch {}
    },
  });
  if (icon) top.append(icon);
  top.append(head, close);
  card.append(top);
}

function placeCard(p) {
  const card = el("article", "mp-card " + catClass(p.cat));
  const icon = () => { const e = el("div", "mp-ph", CAT_ICON[p.cat] || "📍"); e.setAttribute("aria-hidden", "true"); return e; };
  let thumb = null;
  try { thumb = api.ui && api.ui.photo ? api.ui.photo(p, "thumb") : null; } catch { thumb = null; }
  if (thumb) {
    // Offline and not saved yet (common in I-5 dead zones): main.js drops the photo; show the category icon instead.
    const img = thumb.querySelector ? thumb.querySelector("img") : null, fig = thumb;
    if (img) img.addEventListener("error", safe(() => {
      const top = card.querySelector(".mp-top");
      if (!top || top.querySelector(".mp-ph")) return;
      if (fig.parentNode === top) fig.replaceWith(icon()); else top.prepend(icon());
    }));
  } else thumb = icon();
  let exit = "";
  if (p.ex != null && p.ex !== "") exit = dfn("exitName", (st, ref) => `Exit ${ref}`)(p.st, p.ex);
  cardTop(card, thumb, [CATS[p.cat] || "Landmark", exit].filter(Boolean).join(" · "), p.name || "Landmark");
  if (p.text) card.append(el("p", "mp-text", p.text));
  const acts = el("div", "mp-acts");
  hearBtn = button("mp-btn mp-go", {
    onClick: () => {
      if (speakingId === "hear:" + p.id) { try { api.voice && api.voice.stop && api.voice.stop(); } catch {} return; }
      try { api.voice && api.voice.unlock && api.voice.unlock(); } catch {}
      if (api.narrator && api.narrator.hear) api.narrator.hear(p);
    },
  });
  hearBtn.dataset.pid = p.id;
  if (api.narrator && typeof api.narrator.hear === "function") acts.append(hearBtn);
  if (api.ui && api.ui.placeSheet) acts.append(button("mp-btn", { text: "More", onClick: () => api.ui.placeSheet(p) }));
  acts.append(stepButtons("place", "landmark"));
  card.append(acts);
  refreshHearButton();
  return card;
}

function camCard(c) {
  const card = el("article", "mp-card mp-camcard");
  const icon = el("div", "mp-ph mp-ph-cam");
  icon.innerHTML = glyphIcon(CAM_SVG);
  const by = c.by ? String(c.by) : "Live camera";
  const meta = ["Live camera", c.d ? `${by} district ${String(c.d).replace(/^0/, "")}` : by].join(" · ");
  cardTop(card, icon, meta, c.name || "Camera");
  const fig = el("figure", "mp-live");
  card.append(fig);
  if (!c.img) {
    fig.classList.add("none");
    fig.append(el("p", "mp-note", "No picture for this camera."));
  } else if ((api.settings || {}).live === true) {
    loadCam(fig, c, false);
  } else {
    fig.classList.add("consent");
    const p = el("p", "mp-note", `The picture comes straight from ${by}. Live road info is off, so nothing loads until you ask.`);
    const b = button("mp-btn mp-go", { text: "Show live picture", onClick: () => loadCam(fig, c, false) });
    fig.append(p, b);
  }
  const acts = el("div", "mp-acts");
  acts.append(stepButtons("cam", "camera"));
  card.append(acts);
  return card;
}

/**
 * Stop the camera picture that is still downloading, if any (only the card on screen should use mobile data).
 * keep: remember it, so it starts again when the Map tab comes back.
 */
function cancelCam(keep) {
  const ld = camLoad;
  if (!ld) return;
  camLoad = null;
  clearTimeout(ld.timer);
  ld.img.onload = ld.img.onerror = null;
  try { ld.img.removeAttribute("src"); } catch {} // aborts the request
  if (keep) camResume = { fig: ld.fig, c: ld.c, fresh: ld.fresh };
}
function loadCam(fig, c, fresh) {
  if (!fig || !c || !c.img) return;
  cancelCam(false); camResume = null;
  fig.className = "mp-live loading";
  fig.textContent = "";
  const img = el("img");
  img.alt = `Live view from the ${c.name || "road"} camera`;
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  const cap = el("figcaption", "mp-cap", "Loading the camera…");
  fig.append(img, cap);
  const ld = { img, fig, c, fresh, timer: 0 };
  const fail = safe(() => {
    if (camLoad !== ld) return;
    cancelCam(false);
    fig.className = "mp-live none";
    fig.textContent = "";
    fig.append(el("p", "mp-note", "This camera isn't sending a picture right now."), button("mp-btn", { html: ICON.refresh, text: "Try again", onClick: () => loadCam(fig, c, true) }));
  });
  img.onload = safe(() => {
    if (camLoad !== ld) return;
    clearTimeout(ld.timer);
    camLoad = null; // done: nothing left to cancel, and the picture stays
    fig.className = "mp-live";
    let t = "";
    try { t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch {}
    cap.textContent = "";
    cap.append(`${c.by || "Camera"} · loaded ${t}`.trim());
    cap.append(button("mp-btn mp-refresh", { html: ICON.refresh, text: "Refresh", onClick: () => loadCam(fig, c, true) }));
  });
  img.onerror = fail;
  ld.timer = setTimeout(fail, 12000);
  camLoad = ld;
  let url = String(c.img);
  if (fresh) url += (url.includes("?") ? "&" : "?") + "t=" + Date.now();
  img.src = url;
}

function restCard(r) {
  const card = el("article", "mp-card mp-restcard");
  const icon = el("div", "mp-ph mp-ph-rest");
  icon.innerHTML = glyphIcon(REST_SVG);
  const both = !r.side || /both|NB.*SB|north.*south/i.test(r.name || "");
  const side = both ? "Both directions" : r.side === 1 ? "Northbound side" : "Southbound side";
  const city = nearestCity(r.m);
  const name = cleanRest(r.name) || (city ? `Rest area near ${city}` : "Rest area");
  cardTop(card, icon, ["Rest area", side].join(" · "), name);
  const facts = [];
  if (r.toilets) facts.push("Restrooms");
  if (/closed/i.test(r.name || "")) facts.push("Listed as closed");
  if (city && !name.includes(city)) facts.push(`Near ${city}`);
  if (facts.length) card.append(el("p", "mp-text mp-facts", facts.join(" · ")));
  const acts = el("div", "mp-acts");
  acts.append(stepButtons("rest", "rest area"));
  card.append(acts);
  return card;
}

function roadCard(s) {
  const card = el("article", "mp-card mp-roadcard");
  const m = s.m;
  const d = api.data || {};
  let st = null, lm = null, zone = null, region = null, ft = null;
  try { st = d.stateAt ? d.stateAt(m) : null; } catch {}
  try { lm = d.localMile ? d.localMile(m) : null; } catch {}
  try { zone = d.zoneAt ? d.zoneAt(m) : null; } catch {}
  try { region = d.regionAt ? d.regionAt(m) : null; } catch {}
  try { ft = d.elevAt ? d.elevAt(m) : null; } catch {}
  const icon = el("div", "mp-ph mp-ph-road");
  icon.innerHTML = '<svg viewBox="0 0 58 62" aria-hidden="true"><use href="#shield"/></svg>';
  const meta = [st && st.name ? st.name : "", lm ? `Mile ${Math.round(lm.mi)}` : `Mile ${Math.round(m)}`, num(ft) ? `${ft.toLocaleString("en-US")} ft` : ""].filter(Boolean).join(" · ");
  cardTop(card, icon, meta, (zone && zone.label) || (region && region.name) || "Interstate 5");
  if (zone && zone.text) card.append(el("p", "mp-text", zone.text));
  const acts = el("div", "mp-acts");
  if (PTS.length) {
    acts.append(button("mp-btn", {
      text: "Nearest landmark",
      onClick: () => {
        let bi = 0, bd = Infinity;
        PTS.forEach((P, i) => { const dd = Math.abs(P.m - m); if (dd < bd) { bd = dd; bi = i; } });
        if (!prefs.places) setLayer("places", true);
        selectIdx("place", bi, { center: true });
        focusInCard(".mp-go");
      },
    }));
  }
  card.append(acts);
  return card;
}

function hintCard() {
  const box = el("div", "mp-hint");
  box.append(el("p", null, "Tap a dot for its story, or tap the road to see that stretch. Drag to move. Pinch, scroll or double-tap to zoom."));
  const nx = nextUp();
  hintKey = nx ? nx.i + ":" + Math.round(nx.d) : "";
  if (nx) {
    const P = PTS[nx.i];
    const b = button("mp-btn mp-next " + catClass(P.p.cat), {
      onClick: () => { if (!prefs.places) setLayer("places", true); selectIdx("place", nx.i, { fly: Math.max(V.z, 9) }); focusInCard(".mp-go"); },
    });
    b.append(el("i", "mp-k-dot"), el("span", "mp-next-l", "Next up"), el("b", null, P.p.name || "Landmark"), el("span", "mp-next-d", nx.d < 0.3 ? "now" : `${fmtMiles(nx.d)} mi`));
    box.append(b);
  }
  return box;
}
function nextUp() {
  const st = S();
  if (st.m == null || !PTS.length) return null;
  let best = null;
  PTS.forEach((P, i) => {
    const d = aheadOf(st.m, st.dir, P.m);
    if (d > -0.2 && (!best || d < best.d)) best = { i, d: Math.max(0, d) };
  });
  return best;
}

function stepButtons(type, noun) {
  const list = listFor(type);
  const wrap = el("div", "mp-step");
  const i = sel ? sel.idx : -1;
  const south = button("mp-icon", { html: ICON.south, label: `Next ${noun} to the south`, title: `Next ${noun} south`, onClick: () => stepSel(-1) });
  const north = button("mp-icon", { html: ICON.north, label: `Next ${noun} to the north`, title: `Next ${noun} north`, onClick: () => stepSel(1) });
  south.dataset.step = "-1"; north.dataset.step = "1";
  south.disabled = !(i > 0);
  north.disabled = !(i >= 0 && i < list.length - 1);
  wrap.append(south, north);
  return wrap;
}
function stepSel(dir) {
  if (!sel || sel.idx == null) return;
  const j = sel.idx + dir;
  if (j < 0 || j >= listFor(sel.type).length) return;
  selectIdx(sel.type, j, { center: true });
  focusInCard(`[data-step="${dir}"]`, dir > 0 ? `[data-step="-1"]` : `[data-step="1"]`);
}
function focusInCard(sel1, sel2) {
  try {
    const b = cardEl.querySelector(sel1);
    const target = b && !b.disabled ? b : sel2 ? cardEl.querySelector(sel2) : null;
    if (target) target.focus({ preventScroll: true });
  } catch {}
}

/** Things on the card that change while you drive: distance, side, stamp, the "next up" hint. */
function refreshCardBits() {
  if (!cardEl) return;
  if (!sel) {
    const nx = nextUp();
    const key = nx ? nx.i + ":" + Math.round(nx.d) : "";
    if (key !== hintKey) {
      const hadFocus = cardEl.contains(document.activeElement);
      cardEl.textContent = "";
      cardEl.append(hintCard());
      if (hadFocus) focusInCard(".mp-next");
    }
    return;
  }
  if (!whereEl) return;
  const st = S();
  const parts = [];
  let stamped = false;
  if (st.m != null && num(sel.m)) {
    const d = aheadOf(st.m, st.dir, sel.m);
    parts.push(Math.abs(d) < 0.3 ? "Right here" : d > 0 ? `${fmtMiles(d)} mi ahead` : `${fmtMiles(-d)} mi behind`);
    if (sel.type === "place" && d > -0.3) {
      const sw = dfn("sideWord", () => "")(sel.item, st.dir);
      if (sw) parts.push(`on your ${sw}`);
    }
  }
  if (sel.type === "cam" && sel.item && sel.item.near) parts.unshift(`Near ${sel.item.near}`);
  if (sel.type === "rest" && sel.item && st.m != null) parts.push(restServes(sel.item, st.dir) ? "on your side" : "across the freeway");
  if (sel.type === "place" && sel.item && (st.stamps || {})[sel.item.id]) stamped = true;
  const text = parts.join(" · ");
  if (whereEl._t !== text + stamped) {
    whereEl._t = text + stamped;
    whereEl.textContent = text;
    if (stamped) { if (text) whereEl.append(" · "); whereEl.append(el("span", "mp-got", "Stamped ✓")); }
    whereEl.hidden = !text && !stamped;
  }
}

function refreshHearButton() {
  if (!hearBtn) return;
  const on = speakingId != null && speakingId === "hear:" + hearBtn.dataset.pid;
  if (hearBtn._on === on) return;
  hearBtn._on = on;
  hearBtn.innerHTML = on ? ICON.stop : ICON.speaker;
  hearBtn.append(on ? "Stop" : "Hear it");
  // Everything spoken is on screen too: the whole story opens while it is read, and stays open to finish reading.
  const card = hearBtn.closest ? hearBtn.closest(".mp-card") : null;
  if (on && card && !card.classList.contains("is-open")) { card.classList.add("is-open"); revealBottom(card); }
}
/** Scroll just enough to show the bottom of the card above the tab bar, never pushing its top under the header. */
function revealBottom(c) {
  if (!c || !onScreen) return;
  const r = c.getBoundingClientRect();
  const tabs = document.querySelector(".tabs"), top = document.querySelector(".top");
  const room = (window.innerHeight || 0) - (tabs ? tabs.getBoundingClientRect().height : 70) - 10;
  const roof = (top ? top.getBoundingClientRect().bottom : 60) + 10;
  const dy = Math.min(r.bottom - room, r.top - roof);
  if (dy > 2) window.scrollBy({ top: dy, behavior: reducedMotion() ? "auto" : "smooth" });
}
