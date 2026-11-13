// I-5 Buddy live road info (module). Owns #liveAlerts (top of Drive), #liveBlock (lower Drive) and its own sheet.
//
//   Weather ahead   National Weather Service forecasts about 25 and 90 corridor miles ahead.
//   Weather alerts  NWS active alerts about 10, 50 and 120 miles ahead; each warning is spoken once (its updates,
//                   which get new ids, stay quiet unless the event changes, e.g. to a Blizzard Warning).
//   Chain controls  Caltrans feeds for districts in the next 150 miles; spoken once per area and direction, again
//                   when the level goes up or for a separate area more than 30 mi past the last checkpoint.
//   Freeway signs   Caltrans changeable message signs; the next one within 40 miles, read aloud within 3
//                   (only from data under 15 minutes old: an old copy is shown with its age, never read as current).
//   Traffic         California Highway Patrol incidents and Caltrans lane closures, one list for all of I-5 from
//                   i5.dominares.org every 2 minutes (see the traffic section): cards in the alerts strip, a "Traffic ahead"
//                   list, one spoken heads-up per crash or closure that comes within about 10 miles. Never part of the
//                   weather/Caltrans refresh below, so it cannot make "Live info unavailable" appear.
//   Cameras         Live JPEGs from the road data (data.CAMS: Caltrans in California, WSDOT if Washington is in the
//                   data); a TripCheck link near Oregon, only when Oregon is in data.STATES.
// Sources and fine print name only the agencies the road data really has (Caltrans for a California-only build).
//
// Opt-in through settings.live (null = ask once, false = off, true = on). Every fetch has a 12 s timeout,
// failures stay quiet, and the last good data stays on screen with its age (also across reloads).
// Nothing renders and nothing is fetched until the app knows the corridor mile.
// A spoken item counts as said once it starts playing: if a later "now" utterance or Stop drops it from the
// queue first, it is queued again (a few seconds later, or 30 s after Stop).

const WX_AHEAD = [25, 90];            // forecast points, corridor miles ahead
const ALERT_AHEAD = [10, 50, 120];    // alert query points
const CC_RANGE = 150;                 // chain controls this far ahead
const CMS_RANGE = 40;                 // the next freeway sign within this
const CMS_SAY = 3;                    // read the sign aloud within this
const CAM_N = 3, CAM_RANGE = 60;      // cameras in the strip
const OR_LINK_RANGE = 60;             // show the TripCheck link when Oregon is this close
const MOVE_MI = 5;                    // refresh after moving this far...
const MAX_AGE = 10 * 60e3;            // ...or after this long
const MIN_GAP = 2 * 60e3;             // never more than one network refresh per 2 minutes
const TIMEOUT = 12e3;                 // every fetch
const TICK = 30e3;                    // age labels, expiry, the 10-minute rule
const CAM_EVERY = 60e3;               // camera images
const POINTS_TTL = 7 * 864e5;         // weather.gov /points lookups (localStorage)
const FC_TTL = 30 * 60e3;             // forecasts (memory)
const SAID_TTL = 12 * 3600e3;         // spoken ids are remembered this long (and cleared when a trip ends)
const SPEAK_FRESH = 20 * 60e3;        // only speak chain controls and warnings from data this fresh
const SIGN_FRESH = 15 * 60e3;         // only read a freeway sign aloud by itself from data this fresh
const RETRY_SOON = 3e3;               // an item another "now" item pushed out of the queue: queue it again after this
const RETRY_LATER = 30e3;             // ...pushed out by Stop (nothing else speaking): after this
const QUIET_START = 800;              // no automatic speech this soon after a mode change (the greeting goes first)
const AREA_GAP = 30;                  // chain-control checkpoints farther apart than this are separate areas
const STALE = 10 * 60e3;              // older than this, say how old it is (Caltrans, alerts)
const WX_STALE = FC_TTL + MAX_AGE;    // forecasts come from a 30-minute cache; older than this, say how old
const KEEP = { wx: 3 * 3600e3, cc: 2 * 3600e3, cms: 3600e3 }; // last good data stays on screen this long
const NO_I5_SKIP = 24 * 3600e3;       // a chain-control feed with no I-5 points is skipped for a day
const BAD_FEED_SKIP = 20 * 60e3;      // a feed that answers 5xx or garbage is skipped for a while
const PAD = 20;                       // district ranges in the data are approximate at their edges
const NEAR_ROAD = 2.5;                // farther than this from the I-5 line is not on I-5
const ALERT_RX = /Winter Storm|Blizzard|Ice Storm|High Wind|Dense Fog|Flash Flood|Excessive Heat|Extreme Heat|Extreme Cold|Red Flag|Winter Weather|Wind Advisory|Dust|Freezing Fog|Freezing Rain|Dense Smoke|Snow Squall|Avalanche|Flood Warning/i;
const NWS = "https://api.weather.gov";
const CALTRANS = "https://cwwp2.dot.ca.gov/data";
const TRIPCHECK = "https://tripcheck.com";
const QUICKMAP = "https://quickmap.dot.ca.gov/";
const R_LEVELS = {
  1: "R-1: chains or traction devices on the drive axle, unless you have four-wheel or all-wheel drive or snow tires.",
  2: "R-2: chains or traction devices on all vehicles, except four-wheel or all-wheel drive with snow tires on all four wheels.",
  3: "R-3: chains or traction devices on all vehicles, no exceptions.",
};

/* ---------- module state ---------- */
let api = null, S = null, settings = null, bus = null, store = null, voice = null, data = {}, geo = {}, ui = {};
let $alerts = null, $block = null;
let tab = "drive";
let on = false, gen = 0;                       // gen bumps when live is switched off; late answers are dropped
const inflight = new Set();                    // AbortControllers of running fetches
let fetchM = null, fetchDir = null, fetchT = 0; // where and when the last refresh started (cadence)
let netT = 0, schedAt = 0;                     // when the last network refresh started (2-minute rule); next timer
let busy = false, again = false, force = false, fails = 0, okT = 0, tried = false;
let before = null;                             // {netT, tried} from before the refresh in flight (undone if it is dropped)
let netOk = 0, netFail = 0;                    // per refresh
// per source: when it last answered, and whether the last check got no answer at all (weather: at no point)
const src = { wx: { ok: 0, err: false }, al: { ok: 0, err: false }, ct: { ok: 0, err: false } };
let waiters = [];
let wx = [];                                   // [{m, lat, lon, city, st, url, periods, t}]
let alerts = [];                               // [{id, event, sev, kind, area, onset, until, headline, desc, instr, sender, refs, ms, t}]
let cc = {}, cms = {};                         // district -> {t, items}
const fc = new Map();                          // forecast url -> {t, periods}
let said = {}, skip = {};
let area = {};                                 // dir -> {lv, from, end, t}: the chain-control area announced, per direction
let retryAt = {};                              // speech key -> time: dropped from the queue before it started; try again then
const pending = new Set();                     // speech keys queued in voice.js that have not started yet
let posOk = false;                             // a position arrived since the mode changed (GPS start: no fix yet)
let quietUntil = 0;                            // no automatic speech before this (the greeting goes first)
let expanded = false;
const T = { tick: 0, cam: 0, sched: 0, sheet: 0, talk: 0 };
let camT = 0, io = null;
const onScreen = new WeakSet();
let dom = null, asked = null, sheet = null, sheetCam = null;

/* ---------- small helpers ---------- */
const now = () => Date.now();
/** The end of the road in the data (the Oregon line for a California-only build). Without it, nothing is clamped. */
function maxM() {
  if (Number.isFinite(data.MAX_M)) return data.MAX_M;
  const st = Array.isArray(data.STATES) ? data.STATES[data.STATES.length - 1] : null;
  return st && Number.isFinite(st.to) ? st.to : Infinity;
}
const clampM = m => Math.max(0, Math.min(maxM(), m));
const ahead = (m, dir, x) => (dir === "N" ? x - m : m - x);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function warn(e) { try { console.warn("[live]", (e && e.message) || e); } catch {} }
function safe(fn) { return (...a) => { try { return fn(...a); } catch (e) { warn(e); } }; }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, onclick) {
  const b = el("button", cls, text);
  b.type = "button";
  if (onclick) b.addEventListener("click", safe(onclick));
  return b;
}
function link(cls, text, href) {
  const a = el("a", cls, text);
  a.href = href; a.target = "_blank"; a.rel = "noopener";
  return a;
}
const ICONS = {
  warn: "M12 2.6 1.4 20.8h21.2L12 2.6Zm-1.1 6.6h2.2v6.1h-2.2V9.2Zm0 7.7h2.2v2.2h-2.2v-2.2Z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.1 4.9h2.2v2.2h-2.2V6.9Zm0 4h2.2v6.2h-2.2v-6.2Z",
  crash: "M12 1.5l2.4 4.6 5.1-1.2-1.3 5.1 4.8 2.3-4.8 2.3 1.3 5.1-5.1-1.2L12 22.5l-2.4-4.6-5.1 1.2 1.3-5.1L1 12l4.8-2.3-1.3-5.1 5.1 1.2L12 1.5Zm-1 6.5v5h2V8h-2Zm0 6.5v2h2v-2h-2Z",
  closure: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM6.5 10.8h11v2.4h-11v-2.4Z",
  cone: "M12 2.5 9.2 11h5.6L12 2.5ZM8.6 12.8 7.4 16.5h9.2l-1.2-3.7H8.6ZM4.5 18l-.7 3.5h16.4l-.7-3.5H4.5Z",
  chain: "M9.2 14.8a1 1 0 0 1 0-1.4l4.2-4.2a1 1 0 1 1 1.4 1.4l-4.2 4.2a1 1 0 0 1-1.4 0Zm-2.1 6a4.5 4.5 0 0 1-3.2-7.7l2.5-2.5a1 1 0 1 1 1.4 1.4l-2.5 2.5a2.5 2.5 0 0 0 3.5 3.5l2.5-2.5a1 1 0 1 1 1.4 1.4l-2.5 2.5a4.5 4.5 0 0 1-3.1 1.4Zm9-6.8a1 1 0 0 1-.7-1.7l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-2.5 2.5a1 1 0 1 1-1.4-1.4L13 4.9a4.5 4.5 0 0 1 6.4 6.4l-2.5 2.5a1 1 0 0 1-.8.2Z",
};
/** A decorative bit (emoji, chevron, dot) that screen readers should skip. */
function deco(tag, cls, text) { const e = el(tag, cls, text); e.setAttribute("aria-hidden", "true"); return e; }
function icon(kind) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", ICONS[kind] || ICONS.info); p.setAttribute("fill", "currentColor"); p.setAttribute("fill-rule", "evenodd");
  s.append(p);
  return s;
}
function fmtMi(d) { return d < 10 ? d.toFixed(1) : String(Math.round(d)); }
function aboutMi(d) { return d < 3 ? "right around here" : `in about ${Math.round(d)} mi`; }
function ago(t) {
  const s = (now() - t) / 1000;
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min ago` : `${h} h ago`;
}
/** The same, for speech: "25 minutes", "an hour and 5 minutes". */
function agoSaid(t) {
  const m = Math.max(1, Math.round((now() - t) / 60e3)), h = Math.floor(m / 60), r = m % 60;
  const mins = n => `${n} minute${n === 1 ? "" : "s"}`;
  if (!h) return mins(m);
  return `${h === 1 ? "an hour" : h + " hours"}${r ? " and " + mins(r) : ""}`;
}
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function clock(d) {
  let h = d.getHours();
  const mi = d.getMinutes(), ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return mi ? `${h}:${String(mi).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
}
function dayDiff(d) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 864e5);
}
/** "7 PM", "Wed 7 PM", "11/16 7 PM" */
function when(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const dd = dayDiff(d);
  if (dd === 0) return clock(d);
  if (dd > 0 && dd < 7) return `${DAY[d.getDay()]} ${clock(d)}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${clock(d)}`;
}
/** "7 PM today", "4 AM tomorrow", "4 AM Wednesday" */
function whenSaid(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const dd = dayDiff(d);
  if (dd === 0) return `${clock(d)} today`;
  if (dd === 1) return `${clock(d)} tomorrow`;
  if (dd > 1 && dd < 7) return `${clock(d)} ${DAY_LONG[d.getDay()]}`;
  return `${clock(d)} on ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

/* ---------- network ---------- */
async function getText(url) {
  const ac = new AbortController();
  inflight.add(ac);
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    const buf = await r.arrayBuffer();
    netOk++;
    return decode(buf);
  } catch (e) {
    netFail++;
    throw e;
  } finally {
    clearTimeout(timer);
    inflight.delete(ac);
  }
}
/** Some Caltrans feeds carry Latin-1 bytes: try strict UTF-8 first, then Windows-1252. */
function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch {}
  try { return new TextDecoder("windows-1252").decode(buf); } catch {}
  return new TextDecoder().decode(buf);
}
async function getJSON(url, retries = 0) {
  try {
    return JSON.parse(await getText(url));
  } catch (e) {
    // weather.gov answers a stray 500/503 now and then; one quick retry usually works
    if (retries > 0 && e && e.status >= 500 && on) { await sleep(1500); return getJSON(url, retries - 1); }
    throw e;
  }
}
function abortAll() { for (const ac of inflight) { try { ac.abort(); } catch {} } inflight.clear(); }
const ll = x => String(+(+x).toFixed(4)); // 4 decimals max (weather.gov redirects longer ones)

/* ---------- weather ---------- */
/** Corridor miles `list` ahead of m, clamped to the road, minus near-duplicates (the end of the road). */
function targets(m, dir, list, minSep) {
  const out = [];
  for (const a of list) {
    const t = clampM(dir === "N" ? m + a : m - a);
    if (!out.some(x => Math.abs(x - t) < minSep)) out.push(t);
  }
  return out;
}
async function getPoint(lat, lon) {
  const key = lat.toFixed(1) + "," + lon.toFixed(1);
  const cache = store.get("live:pts", {}) || {};
  const hit = cache[key];
  if (hit && hit.f && now() - hit.t < POINTS_TTL) return hit;
  const j = await getJSON(`${NWS}/points/${ll(lat)},${ll(lon)}`, 1);
  const p = (j && j.properties) || {};
  const rl = (p.relativeLocation && p.relativeLocation.properties) || {};
  if (!p.forecast) return null;
  const v = { f: String(p.forecast), c: String(rl.city || ""), s: String(rl.state || ""), t: now() };
  const fresh = Object.entries(cache).filter(([, x]) => x && now() - x.t < POINTS_TTL).sort((a, b) => b[1].t - a[1].t).slice(0, 300);
  const next = Object.fromEntries(fresh);
  next[key] = v;
  store.set("live:pts", next);
  return v;
}
function toF(t) {
  if (t && typeof t === "object") return /degC/i.test(t.unitCode || "") && t.value != null ? Math.round(t.value * 9 / 5 + 32) : t.value;
  return t;
}
async function getForecast(url) {
  const hit = fc.get(url);
  if (hit && now() - hit.t < FC_TTL) return hit;
  const j = await getJSON(url, 1);
  const periods = ((j && j.properties && j.properties.periods) || []).slice(0, 8).map(p => ({
    name: String(p.name || ""), start: p.startTime || null, end: p.endTime || null, day: p.isDaytime !== false,
    temp: toF(p.temperature), unit: typeof p.temperature === "object" ? "F" : String(p.temperatureUnit || "F"),
    short: String(p.shortForecast || ""), wind: String(p.windSpeed || ""), windDir: String(p.windDirection || ""),
    pop: p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value != null ? p.probabilityOfPrecipitation.value : null,
    detail: String(p.detailedForecast || ""),
  }));
  if (!periods.length) throw new Error("no forecast periods");
  const v = { t: now(), periods };
  for (const [k, x] of fc) if (now() - x.t > FC_TTL) fc.delete(k); // a long drive passes hundreds of grid points
  fc.set(url, v);
  return v;
}
async function loadWeather(m, dir, g) {
  const ts = targets(m, dir, WX_AHEAD, 12);
  const res = await Promise.allSettled(ts.map(async tm => {
    const [lat, lon] = geo.coordAt(tm);
    const pt = await getPoint(lat, lon);
    if (!pt) return null; // outside weather.gov coverage
    const f = await getForecast(pt.f);
    return { m: tm, lat, lon, city: pt.c, st: pt.s, url: pt.f, periods: f.periods, t: f.t };
  }));
  if (g !== gen) return;
  const next = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") { if (r.value) next.push(r.value); return; }
    const old = wx.find(w => Math.abs(w.m - ts[i]) < 15 && now() - w.t < KEEP.wx); // keep the last good one
    if (old) next.push(old);
  });
  wx = next;
  const okN = res.filter(r => r.status === "fulfilled").length;   // (outside coverage is an answer too)
  if (okN) src.wx.ok = now();
  src.wx.err = res.length > 0 && !okN;
}
function periodsNow(w, n = 2) {
  const t = now();
  return (w.periods || []).filter(p => !p.end || Date.parse(p.end) > t).slice(0, n);
}
function wxVisible() {
  if (S.m == null) return [];
  const t = now();
  return wx.map(w => ({ ...w, d: ahead(S.m, S.dir, w.m) }))
    .filter(w => w.d > -3 && w.d < 160 && t - w.t < KEEP.wx && periodsNow(w).length)
    .sort((a, b) => a.d - b.d);
}
function wxIcon(short, day) {
  const s = String(short || "").toLowerCase().split(" then ")[0];
  if (/thunder|t-storm/.test(s)) return "⛈️";
  if (/snow|blizzard|flurr|sleet|ice|freezing/.test(s)) return "🌨️";
  if (/rain|shower|drizzle/.test(s)) return "🌧️";
  if (/fog|haze|smoke|dust|mist/.test(s)) return "🌫️";
  if (/cloudy|overcast/.test(s) && !/partly/.test(s)) return "☁️";
  if (/partly|mostly sunny/.test(s)) return day ? "⛅" : "☁️";
  if (/sunny|clear|fair/.test(s)) return day ? "☀️" : "🌙";
  if (/wind|breez|blust|gust/.test(s)) return "💨";
  return day ? "⛅" : "🌙";
}
function windText(p) {
  return p.wind ? `${p.windDir ? p.windDir + " " : ""}${p.wind}` : "";
}
const lower = s => String(s || "").toLowerCase();
function periodSaid(p, first) {
  return `${lower(p.name)}, ${p.temp}${first ? " degrees" : ""} and ${lower(p.short)}`;
}

/* ---------- weather alerts ---------- */
function parseAlert(f) {
  const p = f && f.properties;
  if (!p) return null;
  if (p.status && p.status !== "Actual") return null;
  if (p.messageType === "Cancel") return null;
  const event = String(p.event || "");
  const sev = String(p.severity || "");
  if (!(sev === "Severe" || sev === "Extreme" || ALERT_RX.test(event))) return null;
  const until = p.ends || p.expires || null;
  if (until && Date.parse(until) < now()) return null;
  const nh = p.parameters && p.parameters.NWSheadline && p.parameters.NWSheadline[0];
  // an update ("Update") gets a new id and lists the earlier ones here
  const refs = (Array.isArray(p.references) ? p.references : []).map(r => r && String(r.identifier || "")).filter(Boolean);
  return {
    id: String(p.id || f.id || event + "|" + p.areaDesc + "|" + until),
    event, sev, kind: /warning/i.test(event) || sev === "Extreme" ? "warn" : "adv",
    area: String(p.areaDesc || ""), onset: p.onset || p.effective || null, until,
    headline: String(nh || p.headline || ""), desc: String(p.description || ""), instr: String(p.instruction || ""),
    sender: String(p.senderName || "National Weather Service"), refs, ms: [], t: now(),
  };
}
async function loadAlerts(m, dir, g) {
  const ts = targets(m, dir, ALERT_AHEAD, 5);
  const res = await Promise.allSettled(ts.map(tm => {
    const [lat, lon] = geo.coordAt(tm);
    return getJSON(`${NWS}/alerts/active?point=${ll(lat)},${ll(lon)}`);
  }));
  if (g !== gen) return;
  const found = new Map();
  let ok = 0, fail = 0;
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { fail++; return; }
    ok++;
    for (const f of (r.value && r.value.features) || []) {
      const a = parseAlert(f);
      if (!a) continue;
      const prev = found.get(a.id);
      if (prev) { if (!prev.ms.includes(ts[i])) prev.ms.push(ts[i]); } else { a.ms = [ts[i]]; found.set(a.id, a); }
    }
  });
  if (!ok) { if (fail) src.al.err = true; return; } // keep the last good list
  src.al.ok = now(); src.al.err = false;
  let next = [...found.values()];
  if (fail) next = next.concat(alerts.filter(a => !found.has(a.id) && alertLive(a))); // can't re-check those yet
  // one row per event and area, even when two offices or updates carry it
  const seen = new Set();
  alerts = next.filter(a => { const k = a.event + "|" + a.area; if (seen.has(k)) return false; seen.add(k); return true; });
}
const alertLive = a => !a.until || Date.parse(a.until) > now();
const alertD = a => Math.min(...a.ms.map(x => Math.abs(ahead(S.m, S.dir, x))));
function alertsVisible() {
  if (S.m == null) return [];
  return alerts.filter(a => alertLive(a) && a.ms.some(x => { const d = ahead(S.m, S.dir, x); return d > -15 && d < 160; }))
    .sort((a, b) => (a.kind === "warn" ? 0 : 1) - (b.kind === "warn" ? 0 : 1) || alertD(a) - alertD(b));
}
function areaList(area) { return String(area || "").split(/;\s*/).map(s => s.trim()).filter(Boolean); }
function areaSaid(area) {
  const a = areaList(area);
  if (a.length <= 1) return a[0] || "the road ahead";
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a[0]}, ${a[1]} and nearby areas`;
}
const sameDay = (x, y) => { const a = new Date(x), b = new Date(y); return a.toDateString() === b.toDateString(); };
function alertWhen(a) {
  const start = a.onset && Date.parse(a.onset) > now() + 15 * 60e3 ? when(a.onset) : "";
  const end = a.until ? (start && sameDay(a.onset, a.until) ? clock(new Date(a.until)) : when(a.until)) : "";
  if (start && end) return `${start} to ${end}`;
  if (start) return `from ${start}`;
  return end ? `until ${end}` : "";
}
function alertWhenSaid(a) {
  const start = a.onset && Date.parse(a.onset) > now() + 15 * 60e3 ? whenSaid(a.onset) : "";
  const end = a.until ? (start && sameDay(a.onset, a.until) ? clock(new Date(a.until)) : whenSaid(a.until)) : "";
  if (start && end) return `from ${start} until ${end}`;
  if (start) return `starting ${start}`;
  return end ? `until ${end}` : "";
}
/** NWS headlines often come in capitals: "WINTER STORM WARNING IN EFFECT UNTIL 10 AM PST WEDNESDAY". */
function sentence(s) {
  s = clean(s);
  if (/[a-z]/.test(s)) return s;
  const names = new Set([...DAY_LONG, ...MONTH].map(x => x.toLowerCase()));
  s = s.toLowerCase().replace(/\b[a-z]+\b/g, w => (names.has(w) ? w[0].toUpperCase() + w.slice(1) : /^(am|pm|pst|pdt|nws)$/.test(w) ? w.toUpperCase() : w));
  s = s.replace(/\bi-(\d)/g, "I-$1");
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");
}
function alertLine(a) {
  const w = alertWhenSaid(a);
  return `Weather alert ahead. ${a.event} for ${areaSaid(a.area)}${w ? ", " + w : ""}.`;
}
/** NWS descriptions come as "* WHAT...text" blocks; turn them into labeled paragraphs. */
function alertSections(desc) {
  const out = [];
  for (const block of String(desc || "").split(/\n\s*\n/)) {
    const b = block.replace(/\s*\n\s*/g, " ").trim();
    if (!b) continue;
    const m = /^\*\s*([A-Z][A-Z /]+?)\.\.\.\s*(.*)$/.exec(b);
    if (m) out.push([m[1].charAt(0) + m[1].slice(1).toLowerCase(), m[2]]);
    else out.push(["", b.replace(/^\.\.\.|\.\.\.$/g, "")]);
  }
  return out;
}

/* ---------- Caltrans: chain controls and changeable message signs ---------- */
function districtsNear(m, dir, range) {
  const lo = dir === "N" ? m : m - range, hi = dir === "N" ? m + range : m;
  return (data.DISTRICTS || []).filter(d => d && d.d != null && d.from - PAD <= hi && d.to + PAD >= lo).map(d => String(d.d));
}
function ctUrl(d, kind) {
  const n = parseInt(d, 10), nn = String(n).padStart(2, "0");
  return kind === "cc" ? `${CALTRANS}/d${n}/cc/ccStatusD${nn}.json` : `${CALTRANS}/d${n}/cms/cmsStatusD${nn}.json`;
}
async function feed(url) {
  let s;
  try { s = await getText(url); } catch (e) {
    if (e && e.status >= 500) skip[url] = now() + BAD_FEED_SKIP;
    throw e;
  }
  try { return JSON.parse(s); } catch (e) { skip[url] = now() + BAD_FEED_SKIP; throw e; }
}
function dirOf(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v.startsWith("north")) return "N";
  if (v.startsWith("south")) return "S";
  if (!v || v === "*" || v.startsWith("both")) return "";
  return "X"; // east/west: not a direction of I-5 travel
}
const isTrue = v => /^true$/i.test(String(v).trim());
/** Snap a feed item to I-5. Returns the corridor mile, or null when it is not really on I-5. */
function place(lat, lon) {
  const a = +lat, o = +lon;
  if (!isFinite(a) || !isFinite(o) || (!a && !o) || typeof geo.locate !== "function") return null;
  const hit = geo.locate(a, o);
  return hit && hit.m != null && hit.dist <= NEAR_ROAD ? hit.m : null;
}
function parseCC(j) {
  let i5 = 0;
  const items = [];
  for (const row of (j && j.data) || []) {
    const c = row && row.cc;
    const L = c && c.location;
    if (!L || String(L.route).trim() !== "I-5") continue;
    i5++;
    if (!isTrue(c.inService)) continue;
    const sd = c.statusData || {};
    const lv = /^R-?\s*([123])\b/i.exec(String(sd.status || "").trim());
    if (!lv) continue; // R-0, or something malformed
    const dir = dirOf(L.direction);
    if (dir === "X") continue;
    const m = place(L.latitude, L.longitude);
    if (m == null) continue;
    items.push({
      id: String(c.index || `${L.latitude},${L.longitude}`), m, dir, level: +lv[1], status: "R-" + lv[1],
      desc: String(sd.statusDescription || "").trim(), place: String(L.nearbyPlace || "").trim(), name: String(L.locationName || "").trim(),
    });
  }
  return { i5, items };
}
const clean = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
function signLines(ph, pre) {
  if (!ph) return [];
  const a = [1, 2, 3].map(i => clean(ph[pre + "Line" + i]));
  return a.some(Boolean) ? a : [];
}
function parseCMS(j) {
  const items = [];
  for (const row of (j && j.data) || []) {
    const c = row && row.cms;
    const L = c && c.location;
    if (!L || String(L.route).trim() !== "I-5" || !isTrue(c.inService)) continue;
    const msg = c.message || {};
    if (!msg.display || /^blank$/i.test(String(msg.display).trim())) continue;
    const p1 = signLines(msg.phase1, "phase1"), p2 = signLines(msg.phase2, "phase2");
    if (!p1.length && !p2.length) continue;
    const dir = dirOf(L.direction);
    if (dir === "X") continue;
    const m = place(L.latitude, L.longitude);
    if (m == null) continue;
    items.push({ id: String(c.index || L.locationName), m, dir, p1: p1.length ? p1 : p2, p2: p1.length ? p2 : [], name: clean(L.locationName), place: clean(L.nearbyPlace) });
  }
  return { items };
}
async function loadCaltrans(m, dir, g) {
  const jobs = [];
  let near = 0;
  for (const [kind, range] of [["cc", CC_RANGE], ["cms", CMS_RANGE]]) {
    for (const d of districtsNear(m, dir, range)) {
      near++;
      const url = ctUrl(d, kind);
      if (skip[url] && skip[url] > now()) continue;
      jobs.push(feed(url).then(j => ({ d, kind, url, j })));
    }
  }
  if (!near) src.ct.err = false;          // no California on the road ahead: nothing to ask
  if (!jobs.length) return;
  const res = await Promise.allSettled(jobs);
  if (g !== gen) return;
  const okN = res.filter(r => r.status === "fulfilled").length;
  if (okN) src.ct.ok = now();
  src.ct.err = !okN;
  for (const r of res) {
    if (r.status !== "fulfilled") continue;
    const { d, kind, url, j } = r.value;
    if (kind === "cc") {
      const p = parseCC(j);
      cc[d] = { t: now(), items: p.items };
      if (!p.i5) skip[url] = now() + NO_I5_SKIP;
    } else {
      cms[d] = { t: now(), items: parseCMS(j).items };
    }
  }
  for (const k of Object.keys(skip)) if (!(skip[k] > now())) delete skip[k];
  store.set("live:skip", skip);
}
/** All active checkpoints ahead in your direction, nearest first. */
function chainItems() {
  if (S.m == null) return [];
  const t = now(), all = [];
  for (const d of Object.keys(cc)) {
    const f = cc[d];
    if (!f || !Array.isArray(f.items) || t - f.t > KEEP.cc) continue;
    for (const it of f.items) {
      if (!it || (it.dir && it.dir !== S.dir)) continue;
      const dd = ahead(S.m, S.dir, it.m);
      if (!isFinite(dd) || dd < -0.3 || dd > CC_RANGE) continue;
      all.push({ ...it, d: Math.max(0, dd), t: f.t });
    }
  }
  return all.sort((a, b) => a.d - b.d);
}
/** Checkpoints come in clusters. by "level": one per chain level (the strip and speech);
    by "place": one per town and level (the details sheet). Each keeps its nearest checkpoint. */
function chainsAhead(by = "level") {
  const groups = [], byKey = new Map();
  for (const it of chainItems()) {
    const k = by === "level" ? it.status : (it.place || it.name) + "|" + it.status;
    if (byKey.has(k)) { byKey.get(k).n++; continue; }
    const grp = { ...it, k, n: 1 };
    byKey.set(k, grp); groups.push(grp);
  }
  return groups;
}
function chainWhere(g) { return g.place || cleanLoc(g.name, "") || "the road ahead"; }
function chainTitle(g) {
  return `Chain controls ${g.status} near ${chainWhere(g)}, ${g.d < 0.3 ? "starting here" : fmtMi(g.d) + " mi ahead"}`;
}
/** Spoken chain controls: the nearest level first, then any other level further on, then what it means. */
function chainLine(g, rest = []) {
  const where = chainWhere(g);
  const lead = g.d < 1 ? `Chain controls, ${g.status}, start right about here, near ${where}.` : `Chain controls ahead. ${g.status} near ${where}, in about ${Math.max(1, Math.round(g.d))} miles.`;
  const then = rest.map(x => `Then ${x.status} near ${chainWhere(x)}, in about ${Math.max(1, Math.round(x.d))} miles.`).join(" ");
  // "R-2" can come out as "R minus 2" in some voices
  return [lead, then, g.desc || R_LEVELS[g.level] || ""].filter(Boolean).join(" ").replace(/\bR-([0-3])\b/g, "R $1");
}
function nextSign() {
  if (S.m == null) return null;
  const t = now();
  let best = null;
  for (const d of Object.keys(cms)) {
    const f = cms[d];
    if (!f || !Array.isArray(f.items) || t - f.t > KEEP.cms) continue;
    for (const it of f.items) {
      if (!it || (it.dir && it.dir !== S.dir)) continue;
      const dd = ahead(S.m, S.dir, it.m);
      if (!isFinite(dd) || dd < -0.15 || dd > CMS_RANGE || !Array.isArray(it.p1)) continue;
      if (!best || dd < best.d) best = { ...it, d: Math.max(0, dd), t: f.t };
    }
  }
  return best;
}
const signText = s => [...(s.p1 || []), ...(s.p2 || [])].filter(Boolean).join(" ");
const signKey = s => signText(s).toUpperCase().replace(/\s+/g, " ");
const TRAVEL_RX = /\bMIN(UTE)?S?\b/i;
const ALARM_RX = /CLOS|CRASH|ACCIDENT|COLLISION|INCIDENT|STOP|SLOW|DELAY|ALERT|AMBER|SILVER|CHAIN|SNOW|ICE|FOG|SMOKE|WIND|DETOUR|LANE|WORK|CONSTRUCT|EXPECT|HAZARD|FIRE|FLOOD|DEBRIS|DUST|VISIB|EMERGENCY|EVAC|TUNE|RADIO|AM\s*\d|CARRY|CAUTION|REDUCE|BLOCK/i;
function isTravelTime(s) { const t = signText(s); return TRAVEL_RX.test(t) && !ALARM_RX.test(t); }

/** Freeway-sign and camera names are messy ("008-SB 5 JNO CARMEL MTN RD UC", "I-5 @ MP 107.8: Lilly Rd"):
    make them readable. Signs drop parentheticals ("(NC)"); cameras keep them ("Pacific Ave (Olympia)"). */
const KEEP_CAPS = new Set(["SR", "US", "NE", "NW", "SE", "SW", "MP", "CMS", "VMS", "UPRR", "BNSF", "II", "III"]);
const DIRS = { N: "north", S: "south", E: "east", W: "west" };
function titleCase(s) {
  return s.toLowerCase().replace(/[a-z][a-z'.]*/g, w => (KEEP_CAPS.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
}
function cleanLoc(name, near, keepParens = false) {
  let s = clean(name);
  s = s.replace(/^(CMS\s*)?#?\d+[A-Z]?\s*-\s*/i, "");                 // "CMS 90 - ", "057 - ", "008-"
  s = s.replace(/^\(C\s*\d+\)\s*/i, "");                               // "(C 011) "
  s = s.replace(/\s+[A-Z]?\d+(\.\d+)?\s+[NSEW]\s?5\s*$/i, "");       // " 38.72 S5"
  s = s.replace(/\s+-\s+[^-]+$/, "");                                // " - Redding" (the town is shown on its own)
  for (let i = 0; i < 3; i++) {                                     // leading road, direction and milepost words
    s = s.replace(/^(I|Hwy|Highway|Interstate)[\s-]*5\b\s*(at\b|@|:)?\s*/i, "")
      .replace(/^[NSEW]\/?B\b\.?[\/\s]*((I-?)?5\b)?\s*/i, "")
      .replace(/^(at\s+|@\s*)?(MP\s*)?\d+(\.\d+)?\s*:\s*/i, "");
  }
  s = s.replace(/[\s,]+[NSEW]\/?B\.?$/i, "");                         // trailing ", SB" / " N/B"
  if (!keepParens) s = s.replace(/\([^)]*\)/g, "");                   // "(NC)"
  s = s.replace(/\b(UC|OC|POC)\b\.?/gi, "").replace(/\b(UP|OH|IC)\b\.?/g, ""); // under/over crossings
  s = s.replace(/^So\s+(?=[A-Z])/, "South of ");                     // "So Cannon Rd"
  if (!/[a-z]/.test(s) && s.replace(/[^A-Z]/g, "").length > 4) s = titleCase(s);
  s = s.replace(/\bJ([NSEW])O\b/gi, (_, c) => "just " + DIRS[c.toUpperCase()] + " of");
  s = s.replace(/\b([NSEW])\/O\b/gi, (_, c) => DIRS[c.toUpperCase()] + " of");
  s = s.replace(/\s*@\s*/g, " at ").replace(/\s*\.\s*$/, "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(at|of)\s+/i, "").replace(/\bat (just|north|south)\b/i, "$1").trim();
  return s || clean(near);
}
function signWhere(s) {
  const loc = cleanLoc(s.name, s.place);
  const near = clean(s.place);
  const both = near && !loc.toLowerCase().includes(near.toLowerCase()) ? `${loc}, ${near}` : loc;
  return /^(just |north |south |east |west )/i.test(both) ? both : `at ${both}`;
}
/** Read a sign the way a person would ("SR-78 2 MIN" -> "state route 78, 2 minutes"). */
const SAY = [
  [/\b(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])\b/g, (_, mo, d) => `${MONTH[+mo - 1]} ${+d}`],
  [/(\d)\s*(AM|PM)\b/gi, "$1 $2"],
  [/(\d\s*[AP]M)\s*-\s*(\d)/gi, "$1 to $2"],
  [/\b([NSEW])-(\d+)\b/g, (_, c, n) => `${{ N: "northbound", S: "southbound", E: "eastbound", W: "westbound" }[c]} ${n}`],
  [/\bJ([NS])O\b/g, (_, c) => (c === "N" ? "just north of" : "just south of")],
  [/\b([NSEW])\/O\b/g, (_, c) => `${{ N: "north", S: "south", E: "east", W: "west" }[c]} of`],
  [/\bSR-?\s*(\d+)/g, "state route $1"], [/\bUS-?\s*(\d+)/g, "U.S. $1"], [/\bI-\s*(\d+)/g, "I $1"], [/\bRTE\b/g, "route"],
  [/\bMINS?\b/g, "minutes"], [/\bHWY\b/g, "highway"], [/\bFWY\b/g, "freeway"], [/\bBLVD\b/g, "boulevard"],
  [/\bAVE\b/g, "avenue"], [/\bRD\b/g, "road"], [/\bST\b/g, "street"], [/\bLNS\b/g, "lanes"], [/\bLN\b/g, "lane"],
  [/\bRT\b/g, "right"], [/\b(LT|LFT)\b/g, "left"], [/\bNB\b/g, "northbound"], [/\bSB\b/g, "southbound"],
  [/\bEB\b/g, "eastbound"], [/\bWB\b/g, "westbound"], [/\bCLSD\b/g, "closed"], [/\bTRAF\b/g, "traffic"],
  [/\bALT\b/g, "alternate"], [/\bMI\b/g, "miles"], [/>\s*(\d+)/g, "more than $1"], [/<\s*(\d+)/g, "less than $1"],
  [/&/g, " and "], [/@/g, " at "], [/\.{2,}/g, " "],
];
const VERB_RX = /^(USE|TUNE|EXPECT|CARRY|SLOW|REDUCE|PREPARE|PLAN|AVOID|MERGE|KEEP|STAY|BUCKLE|CHECK|DRIVE|CALL|REPORT|WATCH|MOVE|LEAVE|DO NOT|DON'T|NO |ALL |CHAINS|TRUCKS|BE |SEEK|FOLLOW|DETOUR|EXIT|LEFT|RIGHT)/;
function sayOne(l) {
  let s = l.toUpperCase();
  for (const [rx, to] of SAY) s = s.replace(rx, to);
  return s.toLowerCase().replace(/\b(am|pm)\b/g, x => x.toUpperCase()).replace(/\bi (\d)/g, "I $1").replace(/\br-?\s?([0-3])\b/g, "R $1")
    .replace(/\bu\.s\./g, "U.S.").replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december) (\d)/g, (_, mo, d) => mo[0].toUpperCase() + mo.slice(1) + " " + d)
    .replace(/\s+/g, " ").trim();
}
function sayLines(lines) {
  const ls = lines.map(clean).filter(Boolean);
  const hdr = ls.findIndex(l => /MINUTES TO|TRAVEL TIME/i.test(l));
  if (hdr >= 0 || (ls.some(l => TRAVEL_RX.test(l)) && ls.every(l => TRAVEL_RX.test(l) || /\d$/.test(l)))) {
    // travel times: "RTE 405 17" under "MINUTES TO:", or "SR-78 2 MIN" -> "state route 78, 2 minutes"
    const rows = ls.filter((_, i) => i !== hdr).map(l => sayOne(l.replace(/^(.*?\S)\s+(>?\s*\d+)\s*(MIN(UTE)?S?)?\s*$/i, "$1, $2 MIN")));
    return (hdr >= 0 ? "travel times: " : "") + rows.join("; ");
  }
  let out = "";
  ls.forEach((l, i) => { out += (i ? (VERB_RX.test(l.toUpperCase()) ? ". " : " ") : "") + sayOne(l); });
  return out;
}
function signSpeech(s) {
  const pages = [s.p1, s.p2].filter(p => p && p.some(Boolean)).map(sayLines).filter(Boolean);
  return pages.join(". ").replace(/\s+([,.;])/g, "$1").replace(/\.\./g, ".") + ".";
}
/** A sign read aloud: "The freeway sign ahead says: ...", or for an old copy (no signal for a while)
    "As of 40 minutes ago, the freeway sign ahead said: ..." (what: the words after "the"). */
function signLine(s, what) {
  if (s.t && now() - s.t > STALE) return `As of ${agoSaid(s.t)} ago, the ${what} said: ${signSpeech(s)}`;
  return `The ${what} says: ${signSpeech(s)}`;
}
/** "right here", "about a mile ahead", "about 12 miles ahead" */
function aheadSaid(d) { return d < 0.3 ? "right here" : d < 1.5 ? "about a mile ahead" : `about ${Math.round(d)} miles ahead`; }

/* ---------- cameras ---------- */
function camsNow(n = CAM_N, range = CAM_RANGE) {
  if (S.m == null || typeof data.camsAhead !== "function") return [];
  try { return (data.camsAhead(S.m, S.dir, n, range) || []).filter(c => c && c.img); } catch { return []; }
}
function camSrc(url, t = now()) {
  return url + (url.includes("?") ? "&" : "?") + "t=" + Math.floor(t / CAM_EVERY);
}
/** Camera names from the feeds can be raw ("59 - Sb I-5 S/O Peltier Road"): tidy them like sign locations. */
function camName(c) {
  const raw = clean(c.name).replace(/([\s_]+[TB]|\s+(Top|Bottom))$/i, ""); // top or bottom camera of a pair
  const n = (cleanLoc(raw, "", true) || raw || "Camera").replace(/(\d)(St|Nd|Rd|Th)\b/g, (_, d, x) => d + x.toLowerCase());
  return n.charAt(0).toUpperCase() + n.slice(1);
}
/** Oregon's stretch of the road, when the data covers it (not in a California-only build). */
function oregon() {
  const or = Array.isArray(data.STATES) ? data.STATES.find(s => s && s.id === "OR") : null;
  return or && Number.isFinite(or.from) && Number.isFinite(or.to) ? or : null;
}
function oregonAhead() {
  const or = oregon();
  if (!or || S.m == null) return false;
  const lo = S.dir === "N" ? S.m : S.m - OR_LINK_RANGE, hi = S.dir === "N" ? S.m + OR_LINK_RANGE : S.m;
  return or.from <= hi && or.to >= lo;
}
/** Who the road data and camera pictures come from, read from the data: ["Caltrans"] for California, plus "WSDOT"
    when Washington's cameras are in it. Chain controls and freeway signs are Caltrans feeds (data.DISTRICTS). */
function agencies() {
  const out = [];
  const add = s => { s = clean(s); if (s && !out.includes(s)) out.push(s); };
  if (Array.isArray(data.DISTRICTS) && data.DISTRICTS.length) add("Caltrans");
  if (Array.isArray(data.CAMS)) for (const c of data.CAMS) if (c) add(c.by);
  return out;
}
/** "A", "A and B", "A, B and C" */
function andList(a) { return a.length < 2 ? a[0] || "" : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`; }
/** Reload a camera image without a blank flash: fetch the new frame first, then swap. li._t = when it last loaded. */
function reloadImg(img, url, box, li) {
  if (!img || !url) return;
  const pre = new Image();
  pre.onload = () => { img.src = pre.src; box && box.classList.remove("off"); if (li) li._t = now(); };
  pre.onerror = () => { box && box.classList.add("off"); };
  pre.src = url + (url.includes("?") ? "&" : "?") + "t=" + now();
}
const saveData = () => !!(navigator.connection && navigator.connection.saveData);
function refreshCams(forceIt) {
  if (!on || !dom || tab !== "drive" || document.hidden || saveData()) return;
  if (!forceIt && now() - camT < CAM_EVERY - 5e3) return;
  camT = now();
  for (const li of dom.camList.children) {
    if (io && !onScreen.has(li)) continue; // only the cameras you can see (the rest reload when they come into view)
    const b = li.querySelector(".lv-cam"), img = li.querySelector("img");
    if (img && img.getAttribute("src")) reloadImg(img, li.dataset.k, b, li);
  }
}
function syncCamTimer() {
  const want = on && !document.hidden && tab === "drive" && dom && !dom.camSec.hidden;
  if (want && !T.cam) T.cam = setInterval(safe(() => refreshCams(false)), CAM_EVERY);
  if (!want && T.cam) { clearInterval(T.cam); T.cam = 0; }
}

/* ---------- traffic (CHP incidents and Caltrans lane closures, from i5.dominares.org) ---------- */
// One list for all of California's I-5, fetched on its own 2-minute rhythm (not part of the weather and Caltrans
// refresh above, so its failures never touch "Live info unavailable"). The request carries no location: the phone
// snaps each incident to the road and keeps the ones ahead. A failure is quiet; the last good list stays, marked old.
const TR_EVERY = 2 * 60e3;       // fetch this often while live info is on and the page is visible
const TR_TIMEOUT = 10e3;
const TR_OLD = 15 * 60e3;        // older than this: say so, and never speak from it
const TR_KEEP = 60 * 60e3;       // a saved copy older than this is dropped at start
const TR_ROAD = 0.5;             // an incident farther than this from the I-5 line is not on I-5
const TR_BACK = 0.3;             // just passed still counts as "right here"
const TR_RANGE = 60;             // the list covers this many miles ahead
const TR_SPEAK = 10;             // a crash or closure is announced once it is this close
const TR_STRIP = 2;              // cards in the alerts strip
const TR_ROWS = 6;               // rows in the list before "Show more"
const TR_KINDS = ["crash", "closure", "hazard", "lane", "other"];
const TR_SRC = { chp: "CHP", caltrans: "Caltrans" };
const TR_SRC_LONG = { chp: "California Highway Patrol", caltrans: "Caltrans" };
let tr = { items: [], updated: 0, fetched: 0, sources: { chp: false, caltrans: false }, chpT: 0, err: false, tried: false };
let trBusy = false, trAt = 0, trExpanded = false;

function trUrl() {
  let host = "";
  try { host = location.hostname; } catch {}
  return host === "i5.dominares.org" ? "/api/traffic" : "https://i5.dominares.org/api/traffic";
}
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
/** The server's JSON -> {updated (ms or 0), sources, items}, or null when it is not a traffic answer. Pure. */
function parseTraffic(j) {
  if (!j || typeof j !== "object" || !Array.isArray(j.incidents)) return null;
  const items = [], seen = new Set();
  for (const r of j.incidents.slice(0, 600)) {
    if (!r || typeof r !== "object") continue;
    const lat = +r.lat, lon = +r.lon, id = clip(r.id, 80);
    if (!id || r.lat == null || r.lon == null || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || seen.has(id)) continue;
    seen.add(id);
    const kind = TR_KINDS.includes(r.kind) ? r.kind : "other";
    const src = r.source === "chp" || r.source === "caltrans" ? r.source : /^caltrans:/.test(id) ? "caltrans" : "chp";
    const st = r.started ? Date.parse(r.started) : NaN;
    items.push({ id, source: src, kind, title: clip(r.title, 80) || ({ crash: "Crash", closure: "Road closed", lane: "Lane closed", hazard: "Hazard" }[kind] || "Traffic incident"),
      detail: clip(r.detail, 220), lat, lon, started: isFinite(st) ? st : null, dir: r.dir === "N" || r.dir === "S" ? r.dir : null, until: clip(r.until, 60) });
  }
  const up = j.updated ? Date.parse(j.updated) : NaN;
  const s = j.sources && typeof j.sources === "object" ? j.sources : {};
  return { updated: isFinite(up) ? up : 0, sources: { chp: s.chp === true, caltrans: s.caltrans === true }, items };
}
/** Keep what lies on I-5 (within TR_ROAD of the line), give it a corridor mile, and fold the same event reported
    twice (same place, kind, direction and words) into one entry that remembers every id. */
function snapTraffic(items) {
  const out = [], byKey = new Map();
  for (const it of items) {
    let r = null;
    try { r = geo.locate(it.lat, it.lon, null); } catch {}
    if (!r || r.m == null || !(r.dist <= TR_ROAD)) continue;
    const key = [it.kind, it.dir, it.title, it.detail, it.lat.toFixed(4), it.lon.toFixed(4)].join("|");
    const prev = byKey.get(key);
    if (prev) { prev.ids.push(it.id); continue; }
    const o = { ...it, m: r.m, ids: [it.id] };
    byKey.set(key, o); out.push(o);
  }
  return out;
}
const trT = () => (tr.updated ? Math.min(tr.updated, tr.fetched || tr.updated) : tr.fetched) || 0;
const trHave = () => tr.fetched > 0;
const trOld = () => trHave() && now() - trT() > TR_OLD;
const trSources = () => Object.keys(TR_SRC).filter(k => tr.sources[k]);
// CHP is the only source of crashes. When an answer says CHP is not answering, the CHP items from the last good answer
// stay (for up to TR_KEEP), each marked old and aged from that CHP answer (tr.chpT), never from the list's own time.
const chpKept = it => it.source === "chp" && !tr.sources.chp;
const itOld = it => trOld() || chpKept(it);
const itT = it => (chpKept(it) && tr.chpT ? tr.chpT : trT());
const trOffline = () => navigator.onLine === false;
const isRamp = it => /ramp/i.test(it.title);
const isSevere = it => it.kind === "crash" || (it.kind === "closure" && !isRamp(it));
const dirWords = dir => (dir === "N" ? "Northbound lanes" : dir === "S" ? "Southbound lanes" : "Both directions");
/** Incidents on the road for the driver: ahead (from just behind to TR_RANGE miles), in their direction, nearest first. */
function trAhead(range = TR_RANGE) {
  if (S.m == null) return [];
  return tr.items.map(it => ({ ...it, d: ahead(S.m, S.dir, it.m) }))
    .filter(it => it.d >= -TR_BACK && it.d <= range && (!it.dir || it.dir === S.dir)).sort((a, b) => a.d - b.d);
}
function trWords(d) { return d < 0.5 ? "right here" : d < 1.5 ? "1 mi ahead" : `${Math.round(d)} mi ahead`; }
function trKindIcon(it) { return it.kind === "crash" ? "crash" : it.kind === "closure" ? "closure" : it.kind === "lane" ? "cone" : it.kind === "hazard" ? "warn" : "info"; }
function trStripList(list) { return list.filter(it => it.kind !== "other" && !(it.kind === "closure" && isRamp(it))).slice(0, TR_STRIP); }
function trSub(it) {
  return [itOld(it) && `As of ${ago(itT(it))}`, it.detail, it.until && `until ${it.until}`].filter(Boolean).join(" · ");
}
/** What to say once a crash or closure is close: the nearest one that has not been announced, and the ones right
    behind it (a work zone often has half a dozen ramp and lane closures within a mile or two: one sentence). */
function trSpeech(first, more) {
  const what = first.kind === "crash" ? "crash" : clip(first.title, 40).toLowerCase();
  const where = first.d < 0.5 ? "just ahead" : `ahead, ${first.d < 1.5 ? "in about a mile" : `in about ${Math.round(first.d)} miles`}`;
  return `Heads up: ${what} ${where}${more > 0 ? `, and ${more} more incident${more === 1 ? "" : "s"} close by` : ""}.`;
}
function talkTraffic(list) {
  if (!trHave() || trOld()) return;
  const cand = list.filter(it => isSevere(it) && !itOld(it) && it.d >= 0 && it.d <= TR_SPEAK && !it.ids.some(i => wasSaid("traffic:" + i)));
  if (!cand.length) return;
  const first = cand[0], group = cand.filter(x => x.d - first.d <= 2);
  const key = "traffic:" + first.id, text = trSpeech(first, group.length - 1);
  speak(key, text, { id: key, prio: 2 }, () => {
    const t = now();
    for (const g of group) for (const i of g.ids) said["traffic:" + i] = t;
    saveSaid();
    try { ui.toast && ui.toast(text, 5000); } catch {}
  });
}

/* network */
async function loadTraffic(g) {
  const ac = new AbortController();
  inflight.add(ac);
  const timer = setTimeout(() => ac.abort(), TR_TIMEOUT);
  try {
    const r = await fetch(trUrl(), { signal: ac.signal, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const p = parseTraffic(await r.json());
    if (!p) throw new Error("not a traffic answer");
    if (g !== gen) return false;
    const fetched = now(), items = snapTraffic(p.items);
    // CHP answered: this is its time. CHP did not: keep its earlier items (if they are not too old) and its earlier time.
    const chpT = p.sources.chp ? (p.updated ? Math.min(p.updated, fetched) : fetched) : tr.chpT;
    if (!p.sources.chp && chpT && fetched - chpT < TR_KEEP) {
      const have = new Set(items.flatMap(i => i.ids));
      for (const it of tr.items) if (it.source === "chp" && !it.ids.some(i => have.has(i))) items.push(it);
    }
    tr = { items, updated: p.updated, fetched, sources: p.sources, chpT, err: false, tried: true };
    store.set("live:traffic", { v: 1, updated: tr.updated, fetched: tr.fetched, sources: tr.sources, chpT: tr.chpT, items: tr.items });
    return true;
  } catch {
    if (g === gen) { tr.err = true; tr.tried = true; }
    return false;
  } finally {
    clearTimeout(timer);
    inflight.delete(ac);
  }
}
function maybeTraffic() {
  if (!on || S.m == null || document.hidden || trBusy || trOffline()) return;
  if (now() - trAt < TR_EVERY) return;
  doTraffic();
}
async function doTraffic() {
  trBusy = true; trAt = now();
  const g = gen;
  let ok = false;
  try { ok = await loadTraffic(g); } catch { ok = false; }
  trBusy = false;
  if (g !== gen || !on) return;
  safe(render)();
  if (ok) { try { bus.emit("traffic", trafficEvent()); } catch (e) { warn(e); } }
}
function trafficEvent() {
  return { incidents: trList(), updated: tr.updated ? new Date(tr.updated).toISOString() : tr.fetched ? new Date(tr.fetched).toISOString() : null, sources: { ...tr.sources } };
}
/** Every incident on the corridor with its mile `m` and, when the position is known, `d` (miles ahead in your direction);
    `old` says it is not current (the list is old, or it is a CHP item kept while CHP is not answering) and `asOf` is when
    it was last confirmed (ms). */
function trList() {
  return tr.items.map(it => ({ ...it, ids: it.ids.slice(), d: S && S.m != null ? ahead(S.m, S.dir, it.m) : null, old: itOld(it), asOf: itT(it) || null }));
}
function loadTrafficSnap() {
  const s = store.get("live:traffic", null);
  if (!s || s.v !== 1 || !Array.isArray(s.items) || !(now() - s.fetched < TR_KEEP)) return;
  const items = s.items.filter(it => it && typeof it.id === "string" && isFinite(it.m) && Array.isArray(it.ids) && TR_KINDS.includes(it.kind));
  const src = s.sources && typeof s.sources === "object" ? s.sources : {};
  const chpOk = src.chp === true, upd = +s.updated || 0, fet = +s.fetched || 0;
  const chpT = chpOk ? (upd ? Math.min(upd, fet) : fet) : (+s.chpT || 0);
  const keep = chpOk || (chpT > 0 && now() - chpT < TR_KEEP);       // CHP items kept from long ago are not shown as news
  tr = { items: keep ? items : items.filter(it => it.source !== "chp"), updated: upd, fetched: fet, sources: { chp: chpOk, caltrans: src.caltrans === true }, chpT, err: false, tried: false };
}

/* rendering: the lower block's "Traffic ahead" list */
function trRow(it) {
  const b = btn("lv-tr-row", "", () => trafficSheet(b.dataset.k));
  const ic = el("span", "lv-tr-ic");
  const tx = el("span", "lv-tr-tx");
  const top = el("span", "lv-tr-top");
  top.append(el("b"), el("span", "lv-tr-d"));
  tx.append(top, el("small", "lv-tr-sub"));
  b.append(ic, tx, deco("span", "lv-chev", "›"));
  return b;
}
function trUpdate(n, it) {
  n.className = "lv-tr-row " + (isSevere(it) ? "warn" : "adv") + (itOld(it) ? " old" : "");
  n.dataset.k = it.id;
  const ic = n.firstChild, tx = n.children[1];
  const k = trKindIcon(it);
  if (ic.dataset.ic !== k) { ic.dataset.ic = k; ic.replaceChildren(icon(k)); }
  const set = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  set(tx.firstChild.firstChild, it.title);
  set(tx.firstChild.lastChild, it.d < 0.5 ? "here" : fmtMi(it.d) + " mi");
  const sub = [chpKept(it) && `As of ${ago(itT(it))}`, dirWords(it.dir), it.detail, it.until && `until ${it.until}`].filter(Boolean).join(" · ");
  set(tx.lastChild, sub);
  n.setAttribute("aria-label", `${it.title}, ${trWords(it.d)}. ${sub}`);
}
function renderTraffic(list) {
  const sec = dom.trSec;
  const have = trHave(), good = have && trSources().length > 0;
  const off = trOffline(), old = trOld();
  const chpDown = good && !tr.sources.chp;      // Caltrans answered, CHP (the only source of crashes) did not
  let msg = "", src = "";
  if (!have) {
    // never answered: say nothing while the first request is out, a plain note when it failed or there is no signal
    msg = off ? "Traffic needs a connection." : tr.err ? "Traffic isn't available right now. I'll try again in a couple of minutes." : "";
    sec.hidden = !msg;
    dom.trList.replaceChildren(); dom.trMore.hidden = true; dom.trSrc.hidden = true;
    if (dom.trMsg.textContent !== msg) dom.trMsg.textContent = msg;
    dom.trMsg.hidden = !msg;
    return;
  }
  sec.hidden = false;
  const names = trSources().map(k => TR_SRC[k]);
  if (!good) msg = "The traffic sources aren't answering right now.";
  else if (chpDown) {
    // never "no crashes": without CHP nothing is known about crashes
    msg = list.some(it => it.source === "chp") ? `Crash reports (CHP) aren't answering right now, so anything from CHP here is older.${old ? "" : " Caltrans closures are current."}`
      : `Crash reports (CHP) aren't answering right now. Only Caltrans closures are shown${list.length ? "." : `, and none are reported ahead for ${TR_RANGE} miles.`}`;
  } else if (!list.length) msg = old ? `Traffic hasn't updated for ${ago(trT()).replace(" ago", "")}, so this may be out of date.` : `No crashes or closures reported ahead for ${TR_RANGE} miles.`;
  if (off && list.length && !chpDown) msg = "";
  src = good ? `Traffic: ${names.join(" · ")} · updated ${ago(trT())}${old ? " (old)" : ""}` : "";
  if (off) src = `Traffic needs a connection. ${good ? `Showing the list from ${ago(trT())}.` : ""}`.trim();
  if (old && list.length && !off) src += " · this list may be out of date";
  const shown = list.length > TR_ROWS && !trExpanded ? list.slice(0, TR_ROWS - 1) : list;
  sync(dom.trList, shown.map(it => ({ ...it, k: it.id })), trRow, trUpdate);
  dom.trList.hidden = !shown.length;
  dom.trList.classList.toggle("old", old);
  dom.trMore.hidden = list.length <= TR_ROWS;
  if (!dom.trMore.hidden) {
    dom.trMore.textContent = trExpanded ? "Show fewer" : `Show ${list.length - shown.length} more`;
    dom.trMore.setAttribute("aria-expanded", String(trExpanded));
  }
  if (dom.trMsg.textContent !== msg) dom.trMsg.textContent = msg;
  dom.trMsg.hidden = !msg;
  dom.trMsg.classList.toggle("old", old);
  if (dom.trSrc.textContent !== src) dom.trSrc.textContent = src;
  dom.trSrc.hidden = !src;
}
function trafficSheet(id) {
  const it = trAhead(1e3).find(x => x.id === id);
  if (!it) return;
  showSheet(it.title, (sh) => {
    sh.append(...[
      el("p", "lv-sh-title", it.d < 0.5 ? "Right here" : it.d < 1.5 ? "About a mile ahead" : `About ${Math.round(it.d)} miles ahead`),
      el("p", "lv-sh-meta", dirWords(it.dir)),
      it.detail && el("p", "lv-sh-lead", it.detail),
      it.until && el("p", "lv-sh-lead", `Expected until ${it.until}.`),
      it.started && el("p", "lv-sh-meta", `Reported ${when(new Date(it.started).toISOString())}.`),
      el("p", "lv-sh-meta", chpKept(it) ? `Source: ${TR_SRC_LONG.chp}, which isn't answering right now. This report is from ${ago(itT(it))}.` : `Source: ${TR_SRC_LONG[it.source] || "California Highway Patrol"}. Traffic updated ${ago(trT())}.`),
    ].filter(Boolean));
  });
}

/** Forecast points the live module already has, for the Road ahead chart (no extra weather requests). */
function weatherAlong() {
  try {
    if (settings.live !== true || S.m == null) return [];
    return wxVisible().map(w => {
      const p = periodsNow(w, 1)[0];
      const tempF = p && p.temp != null ? (/C/i.test(p.unit) ? Math.round(p.temp * 9 / 5 + 32) : +p.temp) : null;
      const e = wxIcon(p && p.short, !p || p.day);
      return { m: w.m, d: w.d, city: w.city, tempF, short: p ? p.short : "", icon: e, emoji: e, t: w.t };
    });
  } catch (e) { warn(e); return []; }
}

/* ---------- speech ---------- */
// Only a chain control, a warning or the sign you are passing is spoken without being asked, and each only once.
// "Once" starts when it actually plays: voice.say() resolves false without playing when a later now:true item
// (the greeting at Start GPS and Demo drive, Play, Tell me more, a voice command) clears the queue, or on Stop.
function canTalk() {
  return !!(settings.narr && S.mode !== "off" && !S.offRoute && voice && typeof voice.say === "function" && voice.available !== false);
}
const wasSaid = k => now() - (+said[k] || 0) < SAID_TTL;
/** Something is queued in voice.js but nothing has started yet (it starts on the next tick). */
function aboutToSpeak() {
  try { return !(voice.isSpeaking && voice.isSpeaking()) && !!(voice.queued && voice.queued().length); } catch { return false; }
}
/** Queue a spoken item. onStart runs when it begins to play (that is when it counts as said). */
function speak(key, text, opts, onStart) {
  if (!text || pending.has(key) || (retryAt[key] || 0) > now()) return;
  pending.add(key);
  let started = false, p = null;
  try {
    p = voice.say(text, { ...opts, onstart: () => {
      started = true; delete retryAt[key];
      try { onStart && onStart(); } catch (e) { warn(e); }
    } });
  } catch (e) { warn(e); }
  Promise.resolve(p).catch(() => false).then(() => {
    pending.delete(key);
    if (started) return;
    // Dropped before it began. If something else now holds the voice, a "now" item took over: queue this again
    // right behind it. If nothing does, Stop was pressed (or it went stale in the queue): leave a pause first.
    let held = false;
    try { held = !!((voice.isSpeaking && voice.isSpeaking()) || (voice.queued && voice.queued().length)); } catch {}
    retryAt[key] = now() + (held ? RETRY_SOON : RETRY_LATER);
    talkLater(retryAt[key] - now());
  });
}
/** Look again at what to say once a retry is due (pos events and the 30-s tick would get there later). */
function talkLater(ms) {
  if (!on || document.hidden) return;
  const at = now() + ms;
  if (T.talk && T.talkAt <= at) return;
  clearTimeout(T.talk);
  T.talkAt = at;
  T.talk = setTimeout(() => { T.talk = 0; T.talkAt = 0; if (on) safe(render)(); }, ms + 50);
}
function saveSaid() {
  const t = now();
  for (const k of Object.keys(said)) if (!(t - said[k] < SAID_TTL)) delete said[k];
  store.set("live:said", said);
  for (const d of Object.keys(area)) if (!(t - area[d].t < SAID_TTL)) delete area[d];
  store.set("live:area", area);
}
function talk(jumped, groups, list, sign) {
  if (!on || !posOk || !canTalk()) return;
  // Start GPS and Demo drive greet the driver right after the mode changes. Let the greeting take the voice first,
  // or a chain control (prio 3) would jump ahead of it in the queue: while it waits to start, hold back a moment.
  if (now() < quietUntil && aboutToSpeak()) { talkLater(Math.min(150, quietUntil - now())); return; }
  talkChains(groups);
  talkAlerts(list);
  talkSign(jumped, sign);
  talkTraffic(trAhead());
}

/** Every active checkpoint for a direction, in travel order, behind you too (they tie an area together). */
function chainsAll(dir) {
  const t = now(), out = [];
  for (const d of Object.keys(cc)) {
    const f = cc[d];
    if (!f || !Array.isArray(f.items) || t - f.t > KEEP.cc) continue;
    for (const it of f.items) if (it && isFinite(it.m) && (!it.dir || it.dir === dir)) out.push(it);
  }
  return out.sort((a, b) => (dir === "N" ? a.m - b.m : b.m - a.m));
}
/** Stretch an area over the checkpoints that follow on from its end with gaps of AREA_GAP or less. */
function growArea(a, dir) {
  for (const it of chainsAll(dir)) {
    const gap = ahead(a.end, dir, it.m);
    if (gap > 0 && gap <= AREA_GAP) a.end = it.m;
  }
  return a;
}
/** The highest level in the run of checkpoints that starts at mile m0 (gaps of AREA_GAP or less). */
function levelFrom(m0, dir) {
  let end = m0, lv = 0;
  for (const it of chainsAll(dir)) {
    if (ahead(m0, dir, it.m) < -0.3) continue;
    if (ahead(end, dir, it.m) > AREA_GAP) break;
    if (ahead(end, dir, it.m) > 0) end = it.m;
    lv = Math.max(lv, +it.level || 0);
  }
  return lv;
}
/** Chain controls: once per area and direction (an area is a run of checkpoints with gaps under 30 mi). Again only
    when the level goes up there, or for a separate area. Passing checkpoints in the next town is not news. */
function talkChains(groups) {
  const g = groups[0];
  if (!g || !(now() - g.t < SPEAK_FRESH)) return;
  const dir = S.dir;
  const a = area[dir] && now() - area[dir].t < SAID_TTL ? growArea(area[dir], dir) : null;
  const fresh = !a || ahead(a.end, dir, g.m) > AREA_GAP;
  const lv = levelFrom(g.m, dir);
  if (!fresh && lv <= a.lv) return;
  speak("cc:" + dir, chainLine(g, groups.slice(1)), { id: "cc:" + dir, prio: 3, chime: "alert", check: () => on }, () => {
    const cur = area[dir];
    const same = cur && now() - cur.t < SAID_TTL && ahead(cur.end, dir, g.m) <= AREA_GAP;
    area[dir] = growArea({ lv: Math.max(lv, same ? cur.lv : 0), from: same ? cur.from : g.m, end: same ? cur.end : g.m, t: now() }, dir);
    saveSaid();
  });
}
/** Keys that mark a warning as said: its id, and its event in its area. Both carry the event, so an update with a
    new id stays quiet while an upgrade (Winter Storm Warning to Blizzard Warning) is news. */
function alertKeys(a) { return [`wx:${a.event}#${a.id}`, `wx:${a.event}|${a.area}`]; }
function talkAlerts(list) {
  for (const a of list) {
    if (a.kind !== "warn" || !(now() - a.t < SPEAK_FRESH)) continue;
    const keys = alertKeys(a);
    if (keys.some(wasSaid)) continue;
    if ((a.refs || []).some(r => wasSaid(`wx:${a.event}#${r}`))) {
      const t = now(); for (const k of keys) said[k] = t;        // an update of one already spoken: remember, stay quiet
      saveSaid();
      continue;
    }
    speak(keys[0], alertLine(a), { id: a.id, prio: 2, chime: "alert", check: () => on && alertLive(a) }, () => {
      const t = now(); for (const k of keys) said[k] = t;
      saveSaid();
    });
  }
}
/** The sign is read only while really driving past it (not when the milepost is moved by hand), and only from a
    recent copy: in a dead zone the copy on screen may be an hour old. */
function talkSign(jumped, sign) {
  const driving = S.mode === "gps" || S.mode === "demo";
  if (!driving || jumped || !sign || sign.d > CMS_SAY || !(now() - sign.t < SIGN_FRESH)) return;
  if (isTravelTime(sign) && settings.chat !== "high") return;
  const k = "cms:" + signKey(sign), m = sign.m;
  if (wasSaid(k)) return;
  speak(k, signLine(sign, "freeway sign ahead"), {
    id: k, prio: 1, chime: true, check: () => on && S.m != null && ahead(S.m, S.dir, m) > -0.3,
  }, () => { said[k] = now(); saveSaid(); });
}

/* ---------- cadence ---------- */
function gapNow() { return fails ? Math.min(MAX_AGE, MIN_GAP * 2 ** (fails - 1)) : MIN_GAP; }
function isDue() {
  if (force || fetchM == null || fails) return true;
  return Math.abs(S.m - fetchM) > MOVE_MI || S.dir !== fetchDir || now() - fetchT > MAX_AGE;
}
/** Milliseconds until the next refresh may go out. One the user asked for (force) waits only for the 2-minute
    rule; the automatic ones back off after failures (2, 4, 8, 10 minutes). */
function waitLeft() { return netT + (force ? MIN_GAP : gapNow()) - now(); }
function maybeRefresh() {
  if (!on || S.m == null || document.hidden) return;
  if (!isDue()) return;
  if (navigator.onLine === false) { if (!tried) { tried = true; fails = Math.max(1, fails); render(); } return; }
  const wait = waitLeft();
  if (wait > 0) { schedule(wait); return; }
  doRefresh();
}
/** One timer for the next refresh; an earlier time replaces a later one (Try again during a long backoff). */
function schedule(ms) {
  const at = now() + Math.max(500, ms + 50);
  if (T.sched && schedAt <= at) return;
  clearTimeout(T.sched);
  schedAt = at;
  T.sched = setTimeout(() => { T.sched = 0; schedAt = 0; safe(maybeRefresh)(); }, at - now());
}
function flushWaiters(v) { const w = waiters; waiters = []; for (const r of w) { try { r(v); } catch {} } }
async function doRefresh() {
  if (busy) { again = true; return; }
  before = { netT, tried };
  busy = true; tried = true; force = false;
  const g = gen, m = S.m, dir = S.dir;
  netT = fetchT = now(); fetchM = m; fetchDir = dir;
  netOk = 0; netFail = 0;
  render();
  try {
    await Promise.allSettled([loadWeather(m, dir, g), loadAlerts(m, dir, g), loadCaltrans(m, dir, g)]);
  } catch (e) { warn(e); }
  busy = false;
  if (g !== gen) { flushWaiters(false); if (again && on) { again = false; maybeRefresh(); } return; }
  const ok = netOk > 0 || netFail === 0;
  if (ok) { okT = now(); fails = 0; } else fails++;
  saveSnap();
  render();
  try { bus.emit("live:update", snapshot()); } catch {}
  flushWaiters(ok);
  if (again) { again = false; maybeRefresh(); }
}

/** Public: check now (or as soon as the 2-minute rule allows). Resolves true when fresh data arrived. */
function refresh() {
  try {
    if (settings.live !== true || S.m == null) return Promise.resolve(false);
    if (!on) onSettings(); // turned on without the "settings" event
    force = true;
    const p = new Promise(r => waiters.push(r));
    if (busy) { again = true; return p; }
    const wait = waitLeft();
    if (wait > 0 || document.hidden || navigator.onLine === false) {
      if (!document.hidden && navigator.onLine !== false) schedule(wait);
      return p;
    }
    doRefresh();
    return p;
  } catch (e) { warn(e); return Promise.resolve(false); }
}
/** "a few seconds", "about a minute", "about 2 minutes" */
function soonText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 20 ? "a few seconds" : s < 90 ? "about a minute" : `about ${Math.round(s / 60)} minutes`;
}

/* ---------- last good copy (survives reloads in dead zones) ---------- */
function saveSnap() {
  store.set("live:snap", { v: 1, okT, wx: wx.map(w => ({ ...w, periods: (w.periods || []).slice(0, 6) })), alerts, cc, cms });
}
function loadSnap() {
  const s = store.get("live:snap", null);
  if (!s || s.v !== 1) return;
  const t = now();
  const fresh = (o, keep) => {
    const out = {};
    for (const d of Object.keys(o || {})) if (o[d] && Array.isArray(o[d].items) && t - o[d].t < keep) out[d] = o[d];
    return out;
  };
  wx = (Array.isArray(s.wx) ? s.wx : []).filter(w => w && isFinite(w.m) && Array.isArray(w.periods) && t - w.t < KEEP.wx);
  alerts = (Array.isArray(s.alerts) ? s.alerts : []).filter(a => a && a.id && Array.isArray(a.ms) && alertLive(a));
  cc = fresh(s.cc, KEEP.cc);
  cms = fresh(s.cms, KEEP.cms);
  okT = +s.okT || 0;
}

/* ---------- rendering ---------- */
/** Keep a container's children in step with items, reusing nodes by key (images and focus survive). */
function sync(box, items, make, update) {
  const old = new Map();
  for (const n of [...box.children]) old.set(n.dataset.k, n);
  let prev = null;
  for (const it of items) {
    let n = old.get(it.k);
    if (n) old.delete(it.k); else { n = make(it); n.dataset.k = it.k; }
    update(n, it);
    const want = prev ? prev.nextSibling : box.firstChild;
    if (n !== want) box.insertBefore(n, want);
    prev = n;
  }
  for (const n of old.values()) { if (io) io.unobserve(n); n.remove(); }
}
function clearAll() {
  if ($alerts) { if ($alerts.firstChild) $alerts.replaceChildren(); $alerts.hidden = true; }
  if ($block) { if ($block.firstChild) $block.replaceChildren(); $block.hidden = true; }
  if (io) { io.disconnect(); io = null; }
  dom = null; asked = null;
  syncCamTimer();
}
function render(jumped = false) {
  if (!$alerts || !$block) return;
  if (S.m == null || settings.live === false || (settings.live !== true && settings.live != null)) { clearAll(); return; }
  if (settings.live !== true) { renderAsk(); return; }
  if (asked) { asked = null; $block.replaceChildren(); }
  const groups = chainsAhead(), list = alertsVisible(), sign = nextSign();
  const tlist = trAhead();
  renderAlerts(groups, list, tlist);
  renderBlock(sign, tlist);
  syncCamTimer();
  talk(jumped, groups, list, sign);
}

/* opt-in card */
function renderAsk() {
  if ($alerts.firstChild) $alerts.replaceChildren();
  $alerts.hidden = true;
  if (asked && asked.isConnected) return;
  if (io) { io.disconnect(); io = null; }
  dom = null;
  const card = el("section", "lv-ask");
  card.setAttribute("aria-labelledby", "lvAskTitle");
  const h = el("h3", null, "Live road info");
  h.id = "lvAskTitle";
  const feats = el("ul", "lv-feats");
  feats.setAttribute("aria-label", "Includes");
  for (const [ic, t] of [["🚧", "Crashes and closures"], ["🌦️", "Weather ahead"], ["⛓️", "Chain controls"], ["🛣️", "Freeway signs"], ["📷", "Live cameras"]]) {
    const li = el("li"); li.append(deco("span", "lv-feat-ic", ic), document.createTextNode(t)); feats.append(li);
  }
  const acts = el("div", "lv-ask-acts");
  acts.append(
    btn("primary", "Turn on", () => {
      voice && voice.unlock && voice.unlock(); // iOS: lets a warning found by the first check be spoken
      settings.live = true;
      if (api.saveSettings) api.saveSettings(); else onSettings();
      // the card (and this button) is gone: put focus on the new block and say what happened
      ui.toast && ui.toast("Live road info is on. Checking the road ahead.");
      focusBlock();
    }),
    btn("secondary", "Not now", () => {
      const back = focusableBefore($block);
      settings.live = false;
      if (api.saveSettings) api.saveSettings(); else onSettings();
      ui.toast && ui.toast("Okay. You can turn it on later in Settings.");
      if (back) { try { back.focus({ preventScroll: true }); } catch {} }
    }),
  );
  // the fine print names every server the module talks to, from the road data (no WSDOT without Washington)
  const ag = agencies();
  card.append(el("div", "lv-ask-top", "OPTIONAL · USES A LITTLE DATA"), h,
    el("p", null, "Crashes and closures from the California Highway Patrol and Caltrans, weather forecasts from the National Weather Service, chain controls and freeway signs, and live cameras on the road ahead."),
    feats, acts,
    el("p", "lv-fine", ["Points on the road ahead go to weather.gov.", ag.length && `Road data and camera images load from ${andList(ag)} servers.`, "Crashes and closures come as one list for all of I-5 from i5.dominares.org, so that request never says where you are.", "Change it any time in Settings."].filter(Boolean).join(" ")));
  $block.replaceChildren(card);
  $block.hidden = false;
  asked = card;
}
/** Focus the first heading of the live block (after Turn on replaced the card), or its status line. */
function focusBlock() {
  if (!dom || !$block || $block.hidden) return;
  const h = [...$block.querySelectorAll(".lv-sec")].filter(s => !s.hidden).map(s => s.querySelector("h3"))[0] || dom.footState;
  if (!h) return;
  h.tabIndex = -1;
  try { h.focus({ preventScroll: true }); } catch {}
}
/** The last control on the page before `node` that can take focus (where focus goes when the card disappears). */
function focusableBefore(node) {
  if (!node) return null;
  const all = document.querySelectorAll("button, a[href], input, select, textarea, [tabindex]");
  let best = null;
  for (const e of all) {
    if (node.contains(e) || !(e.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (e.disabled || e.tabIndex < 0 || e.closest("[hidden], [inert]") || !e.getClientRects().length) continue;
    best = e;
  }
  return best;
}

/* alerts strip (#liveAlerts) */
function renderAlerts(groups, list, tlist = []) {
  const rows = [];                   // order: chain controls, warnings, crashes and closures, advisories, other traffic
  const tail = [];                   // advisories and calmer traffic go after the red items
  if (groups.length) {
    // one row for chain controls: the nearest level, then any other level further on
    const g = groups[0], rest = groups.slice(1);
    rows.push({
      k: "cc", kind: groups.some(x => x.level >= 2) ? "warn" : "adv", ic: "chain", title: chainTitle(g), open: chainSheet,
      sub: [now() - g.t > STALE && `As of ${ago(g.t)}`, ...rest.map(x => `Then ${x.status} near ${chainWhere(x)}, ${fmtMi(x.d)} mi`), g.desc || R_LEVELS[g.level]].filter(Boolean).join(". "),
    });
  }
  const trRows = trStripList(tlist).map(it => ({ k: "tr:" + it.id, kind: isSevere(it) ? "warn" : "adv", ic: trKindIcon(it), title: `${it.title}, ${trWords(it.d)}`, sub: trSub(it), open: () => trafficSheet(it.id) }));
  const wxRows = list.map(a => {
    const sub = [now() - a.t > STALE && `As of ${ago(a.t)}`, alertWhen(a), areaList(a.area).join("; ")];
    return { k: "wx:" + a.id, kind: a.kind, ic: a.kind === "warn" ? "warn" : "info", title: a.event, sub: sub.filter(Boolean).join(" · "), open: () => alertSheet(a.id) };
  });
  rows.push(...wxRows.filter(r => r.kind === "warn"), ...trRows.filter(r => r.kind === "warn"));
  tail.push(...wxRows.filter(r => r.kind !== "warn"), ...trRows.filter(r => r.kind !== "warn"));
  rows.push(...tail);
  if (!rows.length) { if ($alerts.firstChild) $alerts.replaceChildren(); $alerts.hidden = true; expanded = false; return; }
  $alerts.hidden = false;
  let box = $alerts.firstElementChild;
  if (!box || !box.classList.contains("lv-alerts")) {
    box = el("div", "lv-alerts");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Road and weather alerts ahead");
    $alerts.replaceChildren(box);
  }
  // more than three rows: show two, but never hide a red one (a warning, a crash, a closure, a chain control level 2)
  const keep = stripKeep(rows.map(r => r.kind));
  const items = keep < rows.length && !expanded ? rows.slice(0, keep) : rows.slice();
  if (keep < rows.length) items.push({ k: "more", more: true, n: rows.length - keep });
  sync(box, items, makeRow, updateRow);
}
/** How many alert rows show before "Show N more", given every row's kind in order ("warn" is red). At least two, and
    never fewer than up to the LAST red row (a yellow chain control can come first, and every row can be red); one row
    alone behind the button saves nothing, so that shows all. Pure. */
function stripKeep(kinds) {
  const lastRed = kinds.reduce((n, k, i) => (k === "warn" ? i + 1 : n), 0);
  let keep = Math.max(2, lastRed);
  if (keep >= kinds.length - 1) keep = kinds.length;
  return keep;
}
function makeRow(it) {
  if (it.more) {
    const b = btn("lv-more", "", () => { expanded = !expanded; render(); });
    return b;
  }
  const b = btn("lv-al", "", () => b._open && b._open());
  const ic = el("span", "lv-al-ic");
  const tx = el("span", "lv-al-tx");
  tx.append(el("b"), el("small"));
  b.append(ic, tx, deco("span", "lv-chev", "›"));
  return b;
}
function updateRow(n, it) {
  if (it.more) {
    n.textContent = expanded ? "Show fewer" : `Show ${it.n} more`;
    n.setAttribute("aria-expanded", String(expanded));
    return;
  }
  n.className = "lv-al " + it.kind;
  n._open = it.open;
  const ic = n.firstChild;
  if (ic.dataset.ic !== it.ic) { ic.dataset.ic = it.ic; ic.replaceChildren(icon(it.ic)); }
  const [b, sm] = n.children[1].children;
  if (b.textContent !== it.title) b.textContent = it.title;
  if (sm.textContent !== (it.sub || "")) sm.textContent = it.sub || "";
}

/* lower block (#liveBlock) */
function section(cls, title, action) {
  const sec = el("section", "lv-sec " + cls);
  const head = el("div", "lv-head");
  const h = el("h3", "sub", title);
  head.append(h);
  if (action) head.append(action);
  sec.append(head);
  return sec;
}
function buildBlock() {
  dom = {};
  const root = el("div", "lv");
  // traffic: CHP incidents and Caltrans closures ahead
  dom.trSec = section("lv-trsec", "Traffic ahead");
  dom.trSec.hidden = true;
  dom.trList = el("div", "lv-tr");
  dom.trList.setAttribute("role", "group");          // the children are plain buttons, so not a "list" (it would promise listitems)
  dom.trList.setAttribute("aria-label", "Traffic ahead");
  dom.trMore = btn("lv-more", "", () => { trExpanded = !trExpanded; render(); });
  dom.trMore.hidden = true;
  dom.trMsg = el("p", "lv-trmsg");
  dom.trMsg.hidden = true;
  dom.trSrc = el("p", "lv-trsrc");
  dom.trSrc.hidden = true;
  dom.trSec.append(dom.trList, dom.trMore, dom.trMsg, dom.trSrc);
  // freeway sign
  dom.signSec = section("lv-signsec", "Freeway sign ahead", btn("lv-link", "Hear it", () => {
    const s = nextSign(); if (!s || !voice) return;
    voice.unlock && voice.unlock();
    voice.say(signLine(s, `freeway sign ${signWhere(s)}`), { now: true, id: "live:sign" });
  }));
  dom.signBody = el("div", "lv-signbody");
  dom.signSec.append(dom.signBody);
  // weather
  dom.wxSec = section("lv-wxsec", "Weather ahead", btn("lv-link", "Hear it", () => {
    if (!voice) return;
    voice.unlock && voice.unlock();
    voice.say(weatherText(), { now: true, id: "live:wx" });
  }));
  dom.wxBody = el("div", "lv-wx");
  dom.wxSec.append(dom.wxBody);
  // cameras
  dom.camSec = section("lv-camsec", "Cameras ahead");
  dom.camList = el("ul", "lv-cams");
  dom.camList.setAttribute("aria-label", "Live cameras ahead");
  dom.camSec.append(dom.camList);
  dom.tc = null;               // Oregon has no cameras in the data: a link to TripCheck, only when Oregon is covered
  if (oregon()) { dom.tc = link("lv-link lv-tc", "Oregon road cameras on TripCheck", TRIPCHECK); dom.tc.hidden = true; dom.camSec.append(dom.tc); }
  // footer
  dom.foot = el("div", "lv-foot");
  dom.footText = el("span", "lv-foot-tx");
  dom.footState = el("b");
  dom.footAge = el("small");
  dom.footText.append(dom.footState, dom.footAge);
  dom.footBtn = btn("lv-link", "Refresh", () => {
    if (busy) return;
    const say = t => ui.toast && ui.toast(t);
    if (navigator.onLine === false) { say("You're offline. I'll check as soon as there's a signal."); refresh(); return; }
    force = true;                                  // asked for: only the 2-minute rule, no backoff
    const wait = waitLeft();
    if (wait > 0) say(fails ? `Tried a moment ago. I'll try again in ${soonText(wait)}.` : `Just checked. I'll look again in ${soonText(wait)}.`);
    refresh();
    render();
  });
  dom.foot.append(dom.footText, dom.footBtn);
  dom.src = el("p", "lv-src", `Sources: ${["National Weather Service", ...agencies()].join(", ")}.`);
  root.append(dom.trSec, dom.signSec, dom.wxSec, dom.camSec, dom.foot, dom.src);
  $block.replaceChildren(root);
  if ("IntersectionObserver" in window) {
    try { io = new IntersectionObserver(safe(camsSeen), { rootMargin: "120px" }); } catch { io = null; }
  }
}
/** IntersectionObserver: track which cameras are on screen. One that comes back into view with a frame older than
    a minute (it was not reloaded while off screen) gets a fresh one at once, not at the next minute tick. */
function camsSeen(entries) {
  for (const e of entries || []) {
    const li = e && e.target;
    if (!li) continue;
    if (!e.isIntersecting) { onScreen.delete(li); continue; }
    onScreen.add(li);
    if (!on || !li.isConnected || document.hidden || saveData() || tab !== "drive") continue;
    if (!li._t || now() - li._t <= CAM_EVERY) continue;   // never loaded (lazy: it loads now), or still fresh
    const b = li.querySelector(".lv-cam"), img = li.querySelector("img");
    if (img && img.getAttribute("src")) reloadImg(img, li.dataset.k, b, li);
  }
}
function renderBlock(sign, tlist = []) {
  if (!dom || !dom.signSec.isConnected) buildBlock();
  $block.hidden = false;
  renderTraffic(tlist);
  renderSign(sign);
  renderWx();
  renderCams();
  renderFoot();
}
function renderSign(s) {
  if (!s) { dom.signSec.hidden = true; dom.signKey = ""; return; }
  dom.signSec.hidden = false;
  const key = s.id + "|" + signKey(s) + "|" + (s.p2 || []).join("/");
  if (key !== dom.signKey) {
    dom.signKey = key;
    const pages = [s.p1, s.p2].filter(p => p && p.some(Boolean));
    const fig = el("figure", "lv-cms");
    const face = el("div", "lv-cms-face");
    face.dataset.pages = String(pages.length);
    face.setAttribute("role", "img");
    face.setAttribute("aria-label", "Sign reads: " + pages.map(p => p.filter(Boolean).join(" ")).join(". Then: "));
    pages.forEach((p, i) => {
      const pg = el("div", "lv-cms-pg");
      pg.setAttribute("aria-hidden", "true");
      if (i) pg.dataset.p = "2";
      for (const line of p) pg.append(el("span", null, line || " "));
      face.append(pg);
    });
    const cap = el("figcaption", "lv-cms-cap");
    dom.signWhere = el("span");
    cap.append(dom.signWhere);
    fig.append(el("div", "lv-cms-box"), cap);
    fig.firstChild.append(face);
    dom.signBody.replaceChildren(fig);
  }
  const w = signWhere(s);
  const t = `${w.charAt(0).toUpperCase() + w.slice(1)} · ${s.d < 0.3 ? "now" : fmtMi(s.d) + " mi"}${now() - s.t > STALE ? ` · as of ${ago(s.t)}` : ""}`;
  if (dom.signWhere.textContent !== t) dom.signWhere.textContent = t;
}
function renderWx() {
  const pts = wxVisible();
  if (!pts.length) {
    // nothing to show: say why while checking, or when weather.gov failed at every point (a quiet note, no alarm)
    const msg = busy && !wx.length ? "Checking the weather ahead…"
      : src.wx.err && tried ? "The weather service isn't answering right now. I'll try again in a few minutes." : "";
    dom.wxSec.hidden = !msg;
    if (!msg) dom.wxKey = "";
    else if (dom.wxKey !== msg) { dom.wxKey = msg; dom.wxBody.replaceChildren(el("p", "lv-wait", msg)); }
    return;
  }
  dom.wxSec.hidden = false;
  const key = pts.map(w => w.url + ":" + w.t + ":" + periodsNow(w).map(p => p.name).join(",")).join("|");
  const rebuilt = key !== dom.wxKey;
  if (rebuilt) {
    dom.wxKey = key;
    dom.wxBody.replaceChildren(...pts.map(w => {
      const b = btn("lv-wxpt", "", () => wxSheet(w.url));
      b.dataset.k = w.url;
      const where = el("span", "lv-wx-d");
      const city = el("b", "lv-wx-city", w.city ? `Near ${w.city}${w.st ? ", " + w.st : ""}` : "On the road ahead");
      b.append(where, city);
      for (const p of periodsNow(w)) {
        const row = el("span", "lv-per");
        const top = el("span", "lv-per-top");
        top.append(deco("span", "lv-per-ic", wxIcon(p.short, p.day)), el("span", "lv-per-t", p.temp != null ? `${p.temp}°${p.unit}` : "--"));
        row.append(el("span", "lv-per-n", p.name), top, el("span", "lv-per-s", p.short));
        const bits = [windText(p) && "Wind " + windText(p), p.pop >= 20 && `💧\u00a0${p.pop}%`].filter(Boolean);
        if (bits.length) {
          const x = el("span", "lv-per-x"); // pieces wrap between, never inside
          bits.forEach((t, i) => { if (i) x.append(" · "); x.append(el("span", null, t)); });
          row.append(x);
        }
        b.append(row);
      }
      b.append(el("span", "lv-wx-age"));   // "As of 2 h ago" when weather.gov has not answered for a while
      return b;
    }));
  }
  for (const b of dom.wxBody.children) {
    const w = pts.find(x => x.url === b.dataset.k);
    const d = b.querySelector(".lv-wx-d"), ag = b.querySelector(".lv-wx-age");
    if (w && d) { const t = aboutMi(w.d).replace(/^in about/, "In about").replace(/^right/, "Right"); if (d.textContent !== t) d.textContent = t; }
    if (w && ag) {
      const t = now() - w.t > WX_STALE ? `As of ${ago(w.t)}` : "";
      if (ag.textContent !== t) ag.textContent = t;
      ag.hidden = !t;
    }
  }
  if (rebuilt) { alignWx(); requestAnimationFrame(safe(alignWx)); } // and again once fonts and layout settle
}
/** Side-by-side weather cards: line up matching rows (place, then each period) so the columns read across.
    The age line is left out: it sits under the last period of the card it belongs to. */
function alignWx() {
  if (!dom || !dom.wxBody || !dom.wxBody.isConnected) return;
  const cards = [...dom.wxBody.children];
  if (!cards.length || !cards[0].offsetWidth) return; // not on screen (another tab): try again when it is
  for (const c of cards) for (const k of c.children) k.style.minHeight = "";
  if (cards.length < 2 || Math.abs(cards[0].offsetTop - cards[1].offsetTop) > 2) return; // stacked: nothing to align
  const rows = cards.map(c => [...c.children].filter(k => !k.classList.contains("lv-wx-age")));
  const n = Math.min(...rows.map(r => r.length));
  for (let i = 0; i < n; i++) {
    const h = Math.max(...rows.map(r => r[i].offsetHeight));
    for (const r of rows) r[i].style.minHeight = h + "px";
  }
}
function renderCams() {
  const list = camsNow();
  const orNear = !!dom.tc && oregonAhead();
  if (!list.length && !orNear) { dom.camSec.hidden = true; return; }
  dom.camSec.hidden = false;
  dom.camList.hidden = !list.length;
  if (dom.tc) dom.tc.hidden = !orNear;
  sync(dom.camList, list.map(c => ({ ...c, k: c.img })), makeCam, updateCam);
}
function makeCam(c) {
  const li = el("li");
  const b = btn("lv-cam", "", () => camSheet(c.img));
  const box = el("span", "lv-cam-img");
  const img = el("img");
  img.alt = `Live camera: ${camName(c)}`;
  img.loading = "lazy"; img.decoding = "async"; img.width = 320; img.height = 240;
  img.onerror = () => b.classList.add("off");
  img.onload = () => { b.classList.remove("off"); li._t = now(); };
  img.src = camSrc(c.img);
  box.append(img, el("span", "lv-cam-off", "Camera offline"));
  const tx = el("span", "lv-cam-tx");
  const sm = el("small");
  sm.append(deco("i", "lv-dot"), el("span"));
  tx.append(el("b", null, camName(c)), sm);
  b.append(box, tx);
  li.append(b);
  if (io) io.observe(li);
  return li;
}
function updateCam(li, c) {
  const sm = li.querySelector("small > span");
  const t = `${c.d < 0.3 ? "Here" : fmtMi(c.d) + " mi"}${c.near ? " · " + c.near : ""} · ${c.by || "Live"}`;
  if (sm && sm.textContent !== t) sm.textContent = t;
}
/** The oldest forecast on screen, if it is old enough to mention (the rest of the block carries its own ages). */
function oldWx() {
  const ts = wxVisible().map(w => w.t).filter(t => now() - t > WX_STALE);
  return ts.length ? Math.min(...ts) : 0;
}
function renderFoot() {
  // "Updated" is the last refresh that brought anything; a part that did not come with it is named
  const ow = oldWx();
  // a source that did not answer and has nothing on screen: "no chain controls" must not look like a fact
  const silent = fails ? [] : [src.al.err && !alertsVisible().length && "NWS alerts", src.ct.err && !chainItems().length && !nextSign() && "Caltrans"].filter(Boolean);
  const parts = [okT && `Updated ${ago(okT)}`, ow && `Weather from ${ago(ow)}`, silent.length && `No answer from ${silent.join(" or ")}`].filter(Boolean);
  const bad = !!fails || (tried && !okT && !busy && !T.sched);
  const t = bad ? "Live info unavailable right now" : !okT && (busy || T.sched) ? "Checking the road ahead…" : "Live road info";
  if (dom.footState.textContent !== t) dom.footState.textContent = t;
  if (dom.footAge.textContent !== parts.join(" · ")) {           // pieces wrap between, never inside
    dom.footAge.replaceChildren();
    parts.forEach((p, i) => { if (i) dom.footAge.append(" · "); dom.footAge.append(el("span", null, p)); });
  }
  dom.footAge.hidden = !parts.length;
  dom.foot.classList.toggle("bad", bad);
  dom.foot.classList.toggle("part", !bad && !!(ow || silent.length));     // amber dot: some of it is not current
  dom.footBtn.textContent = busy ? "Checking…" : fails ? "Try again" : "Refresh";
  dom.footBtn.disabled = busy;
}

/* ---------- sheet (cameras, alerts, chain controls, forecast) ---------- */
function ensureSheet() {
  if (sheet && sheet.isConnected) return sheet;
  sheet = el("aside", "sheet lv-sheet");
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Live road info");
  (document.querySelector(".app") || document.body).append(sheet);
  return sheet;
}
function showSheet(title, fill) {
  const sh = ensureSheet();
  stopSheetTimer();
  sheetCam = null;
  sh.replaceChildren();
  sh.setAttribute("aria-label", title);
  const head = el("div", "sheet-head");
  const hb = el("b", null, title);
  head.append(hb, btn("link lv-close", "Close", () => (ui.closeSheet ? ui.closeSheet() : (sh.hidden = true))));
  sh.append(head);
  fill(sh, hb);
  if (ui.openSheet) ui.openSheet(sh); else sh.hidden = false;
}
function stopSheetTimer() { if (T.sheet) { clearInterval(T.sheet); T.sheet = 0; } }
/** While the camera sheet is open (and the page visible), refresh its image every minute. */
function startSheetTimer() {
  if (T.sheet) return;
  T.sheet = setInterval(safe(() => {
    if (!sheet || sheet.hidden || !sheetCam) { stopSheetTimer(); sheetCam = null; return; }
    if (!document.hidden) reloadImg(sheetCam.img, sheetCam.url, sheetCam.fig);
  }), CAM_EVERY);
}

function camSheet(imgUrl) {
  let list = camsNow(12, 120);
  if (!list.some(c => c.img === imgUrl)) {
    const c = (data.CAMS || []).find(x => x.img === imgUrl);
    if (c) list = [{ ...c, d: ahead(S.m, S.dir, c.m) }, ...list];
  }
  if (!list.length) return;
  let i = Math.max(0, list.findIndex(c => c.img === imgUrl));
  showSheet("Live camera", (sh, hb) => {
    const fig = el("figure", "lv-big");
    const img = el("img");
    img.decoding = "async";
    const off = el("span", "lv-cam-off", "Camera offline");
    fig.append(img, off);
    const name = el("h2", "lv-sh-title");
    const meta = el("p", "lv-sh-meta lv-cam-meta");
    const metaText = el("span");
    meta.append(deco("i", "lv-dot"), metaText);
    const nav = el("div", "lv-nav");
    const prev = btn("secondary", "◀ Closer", () => { if (i > 0) { i--; show(); } });
    const count = el("span", "lv-count");
    const next = btn("secondary", "Farther ▶", () => { if (i < list.length - 1) { i++; show(); } });
    nav.append(prev, count, next);
    const note = el("p", "lv-fine", "The image refreshes every minute while this is open.");
    sh.append(name, fig, meta, nav, note);
    img.onerror = () => fig.classList.add("off");
    img.onload = () => fig.classList.remove("off");
    function show() {
      const c = list[i];
      hb.textContent = c.by ? `${clean(c.by)} camera` : "Live camera";
      name.textContent = camName(c);
      fig.classList.remove("off");
      img.alt = `Live camera: ${camName(c)}`;
      img.src = camSrc(c.img);
      sheetCam = { img, fig, url: c.img };
      const d = S.m != null ? ahead(S.m, S.dir, c.m) : null;
      metaText.textContent = [`Live image from ${c.by || "the state DOT"}`, c.near, d != null && (d < 0.3 ? (d < -0.3 ? `${fmtMi(-d)} mi behind` : "right here") : `${fmtMi(d)} mi ahead`)].filter(Boolean).join(" · ");
      count.textContent = `${i + 1} of ${list.length}`;
      prev.disabled = i === 0; next.disabled = i === list.length - 1;
    }
    show();
  });
  startSheetTimer();
}
function alertSheet(id) {
  const a = alerts.find(x => x.id === id);
  if (!a) return;
  showSheet("Weather alert", sh => {
    const box = el("div", "lv-sh-alert " + a.kind);
    box.append(el("h2", "lv-sh-title", a.event));
    const meta = el("p", "lv-sh-meta", [alertWhen(a), a.sender].filter(Boolean).join(" · "));
    box.append(meta);
    sh.append(box);
    if (a.headline) sh.append(el("p", "lv-sh-lead", sentence(a.headline)));
    const dl = el("dl", "lv-dl");
    const add = (k, v) => { if (!v) return; dl.append(el("dt", null, k), el("dd", null, v)); };
    add("Where", areaList(a.area).join("; "));
    for (const [k, v] of alertSections(a.desc)) { if (/^where$/i.test(k)) continue; add(k || "Details", v); }
    add("What to do", a.instr.replace(/\s*\n\s*/g, " ").trim());
    sh.append(dl);
    const acts = el("div", "lv-acts");
    acts.append(btn("primary", "Hear it", () => {
      if (!voice) return;
      voice.unlock && voice.unlock();
      const what = (alertSections(a.desc).find(([k]) => /^what$/i.test(k)) || [])[1];
      voice.say(`${alertLine(a)}${what ? " " + what : ""}`, { now: true, id: "live:alert" });
    }));
    const [lat, lon] = geo.coordAt ? geo.coordAt(a.ms[0]) : [null, null];
    if (lat != null) acts.append(link("lv-link", "Details at weather.gov", `https://forecast.weather.gov/MapClick.php?lat=${ll(lat)}&lon=${ll(lon)}`));
    sh.append(acts);
  });
}
function chainSheet() {
  const groups = chainsAhead("place");
  showSheet("Chain controls", sh => {
    if (!groups.length) { sh.append(el("p", "lv-sh-lead", "No chain controls ahead right now.")); return; }
    sh.append(el("p", "lv-sh-lead", "Caltrans has chain controls in effect on I-5 ahead of you. Have chains or traction devices ready before the checkpoint."));
    const ol = el("ol", "lv-chains");
    for (const g of groups) {
      const li = el("li", g.level >= 2 ? "warn" : "adv");
      const top = el("div", "lv-ch-top");
      top.append(el("span", "lv-ch-lv", g.status), el("b", null, `Near ${chainWhere(g)}`), el("span", "lv-ch-d", g.d < 0.3 ? "here" : `${fmtMi(g.d)} mi`));
      li.append(top);
      if (g.name && g.name !== g.place) li.append(el("small", null, g.name));
      if (g.desc) li.append(el("p", null, g.desc));
      ol.append(li);
    }
    sh.append(ol);
    const lv = el("div", "lv-levels");
    lv.append(el("h3", "sub", "What the levels mean"));
    for (const k of [1, 2, 3]) lv.append(el("p", null, R_LEVELS[k]));
    sh.append(lv);
    const acts = el("div", "lv-acts");
    acts.append(btn("primary", "Hear it", () => {
      if (!voice) return;
      voice.unlock && voice.unlock();
      const lv = chainsAhead("level");
      if (lv.length) voice.say(chainLine(lv[0], lv.slice(1)), { now: true, id: "live:chains" });
    }), link("lv-link", "Caltrans QuickMap", QUICKMAP));
    sh.append(acts);
    sh.append(el("p", "lv-fine", `From Caltrans, updated ${ago(Math.min(...groups.map(g => g.t || now())))}.`));
  });
}
function wxSheet(url) {
  const w = wx.find(x => x.url === url);
  if (!w) return;
  showSheet(w.city ? `Weather near ${w.city}` : "Weather ahead", sh => {
    const d = S.m != null ? ahead(S.m, S.dir, w.m) : null;
    sh.append(el("p", "lv-sh-meta", [w.city && `${w.city}${w.st ? ", " + w.st : ""}`, d != null && aboutMi(Math.max(0, d)), `National Weather Service · updated ${ago(w.t)}`].filter(Boolean).join(" · ")));
    const ol = el("ol", "lv-fc");
    for (const p of periodsNow(w, 6)) {
      const li = el("li");
      const top = el("div", "lv-fc-top");
      top.append(deco("span", "lv-per-ic", wxIcon(p.short, p.day)), el("b", null, p.name), el("span", "lv-per-t", p.temp != null ? `${p.temp}°${p.unit}` : ""));
      li.append(top, el("p", null, p.detail || p.short));
      ol.append(li);
    }
    sh.append(ol);
    const acts = el("div", "lv-acts");
    acts.append(link("lv-link", "Full forecast at weather.gov", `https://forecast.weather.gov/MapClick.php?lat=${ll(w.lat)}&lon=${ll(w.lon)}`));
    sh.append(acts);
  });
}

/* ---------- speakable summaries (voice commands) ---------- */
function weatherText() {
  try {
    if (settings.live !== true) return "Live road info is off. You can turn it on in Settings, under Live road info.";
    if (S.m == null) return "Start GPS or a demo drive first, then I can check the weather ahead.";
    const pts = wxVisible();
    if (!pts.length) {
      refresh();
      return fails || (src.wx.err && !busy) ? "I can't reach the weather service right now. I'll keep trying." : "I'm still checking the weather ahead. Ask me again in a minute.";
    }
    const parts = pts.map(w => {
      const per = periodsNow(w);
      const where = `${w.city ? "Near " + w.city : "On the road"}, ${w.d < 3 ? "right around here" : `in about ${Math.round(w.d)} miles`}`;
      return `${where}: ${per.map((p, i) => periodSaid(p, i === 0)).join("; ")}.`;
    });
    const warnings = alertsVisible().filter(a => a.kind === "warn");
    if (warnings.length) parts.push(`Heads up: ${warnings.length === 1 ? `a ${warnings[0].event} covers` : `${warnings.length} weather warnings cover`} part of the road ahead.`);
    const oldest = Math.min(...pts.map(w => w.t));
    if (now() - oldest > WX_STALE) parts.push(`That forecast is from ${agoSaid(oldest)} ago.`);
    return "Weather ahead. " + parts.join(" ");
  } catch (e) { warn(e); return "I don't have the weather ahead right now."; }
}
function alertsText() {
  try {
    if (settings.live !== true || S.m == null) return weatherText();
    const list = alertsVisible(), groups = chainsAhead();
    // say "none" only for what was really checked: not for a source that did not answer, and chain controls
    // come from Caltrans only (nothing outside California, when the data covers more than California)
    const caNear = districtsNear(S.m, S.dir, CC_RANGE).length > 0;
    const ccKnown = caNear && !src.ct.err, alKnown = !src.al.err;
    if (!list.length && !groups.length && ccKnown && alKnown) return "No chain controls or weather warnings on the road ahead right now.";
    const out = [];
    if (groups.length) out.push((now() - groups[0].t > STALE ? `As of ${agoSaid(groups[0].t)} ago: ` : "") + chainLine(groups[0], groups.slice(1)));
    out.push(...list.slice(0, 3).map(alertLine));
    if (!list.length) out.push(alKnown ? "No weather warnings on the road ahead right now." : "I can't reach the weather service right now, so I can't check for warnings.");
    if (!groups.length) out.push(ccKnown ? "No chain controls on the road ahead right now." : caNear ? "I can't reach Caltrans right now, so I can't check chain controls." : "I only get chain controls for California roads.");
    return out.join(" ");
  } catch (e) { warn(e); return "I don't have road alerts right now."; }
}
function roadText() {
  try {
    if (settings.live !== true || S.m == null) return weatherText();
    const out = [alertsText()];
    const s = nextSign();
    if (s) out.push(signLine(s, `next freeway sign, ${aheadSaid(s.d)},`));
    return out.join(" ");
  } catch (e) { warn(e); return "I don't have road info right now."; }
}
function signTextSaid() {
  try {
    const s = settings.live === true ? nextSign() : null;
    return s ? signLine(s, `next freeway sign, ${aheadSaid(s.d)},`) : "No freeway signs with a message on the road ahead.";
  } catch (e) { warn(e); return "I don't have the freeway signs right now."; }
}
/** Plain data for other modules (a map could plot chain controls and the next sign). */
function snapshot() {
  try {
    if (settings.live !== true || S.m == null) return { updated: null, failing: false, weather: [], alerts: [], chains: [], sign: null };
    const s = nextSign();
    return {
      updated: okT || null, failing: !!fails,
      weather: wxVisible().map(w => ({ m: w.m, d: w.d, city: w.city, st: w.st, t: w.t, periods: periodsNow(w).map(p => ({ name: p.name, temp: p.temp, unit: p.unit, short: p.short })) })),
      alerts: alertsVisible().map(a => ({ id: a.id, event: a.event, kind: a.kind, area: a.area, onset: a.onset, until: a.until, ms: a.ms.slice() })),
      chains: chainItems().map(c => ({ m: c.m, d: c.d, dir: c.dir, status: c.status, level: c.level, place: c.place, name: c.name, t: c.t })),
      sign: s ? { m: s.m, d: s.d, lines: [...s.p1, ...s.p2].filter(Boolean), where: signWhere(s), t: s.t } : null,
    };
  } catch (e) { warn(e); return { updated: null, failing: true, weather: [], alerts: [], chains: [], sign: null }; }
}
/** Traffic state for other modules and tests. */
function trafficInfo() {
  return { have: trHave(), updated: trT() || null, old: trOld(), offline: trOffline(), err: tr.err, busy: trBusy, sources: { ...tr.sources }, n: tr.items.length };
}
function status() {
  return {
    on, m: S && S.m, dir: S && S.dir, busy, fails, okT, netT, fetchM, tried, src: JSON.parse(JSON.stringify(src)),
    traffic: { n: tr.items.length, have: trHave(), err: tr.err, busy: trBusy, at: trAt, t: trT(), sources: { ...tr.sources } },
    wx: wx.length, alerts: alerts.length, chains: S && S.m != null ? chainsAhead().length : 0,
    sign: S && S.m != null ? !!nextSign() : false, cc: Object.keys(cc), cms: Object.keys(cms), skip: Object.keys(skip),
    area: JSON.parse(JSON.stringify(area)), pending: [...pending], retry: Object.keys(retryAt).filter(k => retryAt[k] > now()),
    timers: { tick: !!T.tick, cam: !!T.cam, sched: !!T.sched, sheet: !!T.sheet, talk: !!T.talk },
  };
}

/* ---------- events ---------- */
function onPos(p) {
  if (S.m == null) return;
  posOk = true;
  render(!!(p && p.jumped));
  maybeRefresh();
  maybeTraffic();
}
/** A new mode: wait for a position before saying anything (Start GPS keeps the last session's mile until the
    first fix), and give items that a Stop pushed back a fresh start. */
function onMode(mode) {
  posOk = false;
  if (mode !== "off") { retryAt = {}; clearTimeout(T.talk); T.talk = 0; T.talkAt = 0; quietUntil = now() + QUIET_START; }
  render();
}
function onSettings() {
  const want = settings.live === true;
  if (want && !on) {
    on = true;
    force = true;                     // check now (or at the 2-minute mark), whatever the cadence says
    retryAt = {};
    trAt = 0;
    startTimers(); maybeRefresh(); maybeTraffic();
  } else if (!want && on) {
    on = false; gen++;
    // the refresh in flight is dropped: it does not count toward the cadence or the 2-minute rule
    if (busy && before) { netT = before.netT; tried = before.tried; }
    fetchM = null;
    abortAll(); stopTimers(); stopSheetTimer();
    flushWaiters(false);
    if (sheet && !sheet.hidden && ui.closeSheet) ui.closeSheet();
  }
  render();
}
function onTab(name) {
  tab = String(name || "");
  syncCamTimer();
  if (tab === "drive") { refreshCams(false); requestAnimationFrame(safe(alignWx)); }
}
function startTimers() {
  if (T.tick || document.hidden) return;
  T.tick = setInterval(safe(() => { render(); maybeRefresh(); maybeTraffic(); }), TICK);
}
function stopTimers() {
  if (T.tick) { clearInterval(T.tick); T.tick = 0; }
  if (T.sched) { clearTimeout(T.sched); T.sched = 0; schedAt = 0; }
  if (T.cam) { clearInterval(T.cam); T.cam = 0; }
  if (T.talk) { clearTimeout(T.talk); T.talk = 0; T.talkAt = 0; }
}
function onVisibility() {
  if (document.hidden) { stopTimers(); stopSheetTimer(); return; }
  if (!on) return;
  startTimers();
  render();
  maybeRefresh();
  maybeTraffic();
  refreshCams(false);
  if (sheet && !sheet.hidden && sheetCam) { reloadImg(sheetCam.img, sheetCam.url, sheetCam.fig); startSheetTimer(); }
}

export function init(a) {
  try {
    api = a || {};
    S = api.S; settings = api.settings; bus = api.bus;
    store = api.store || { get: (k, f) => f, set() {}, del() {} };
    voice = api.voice || null; data = api.data || {}; geo = api.geo || {}; ui = api.ui || {};
    if (!S || !settings || !bus) return;
    $alerts = document.getElementById("liveAlerts");
    $block = document.getElementById("liveBlock");
    const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {}); // storage may hold anything
    said = obj(store.get("live:said", {}));
    skip = obj(store.get("live:skip", {}));
    area = {};
    for (const [d, a] of Object.entries(obj(store.get("live:area", {})))) {
      if ((d === "N" || d === "S") && a && [a.lv, a.from, a.end, a.t].every(x => typeof x === "number" && isFinite(x)) && now() - a.t < SAID_TTL) area[d] = a;
    }
    try { loadSnap(); } catch (e) { warn(e); }
    try { loadTrafficSnap(); } catch (e) { warn(e); }
    api.live = { weatherText, refresh, alertsText, roadText, signText: signTextSaid, snapshot, status, weatherAlong,
      traffic: () => trList(), trafficInfo };
    bus.on("pos", safe(onPos));
    bus.on("settings", safe(onSettings));
    bus.on("tab", safe(onTab));
    bus.on("mode", safe(onMode));
    bus.on("trip:end", safe(() => { said = {}; area = {}; retryAt = {}; saveSaid(); })); // a new trip hears active warnings again
    document.addEventListener("visibilitychange", safe(onVisibility));
    window.addEventListener("online", safe(() => { if (on) { fails = Math.min(fails, 1); trAt = 0; maybeRefresh(); maybeTraffic(); render(); } }));
    window.addEventListener("offline", safe(() => { if (on) render(); }));
    let rz = 0;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(safe(alignWx), 150); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(safe(alignWx)).catch(() => {});
    onSettings();
  } catch (e) { warn(e); }
}

// Pure helpers, exported for tools/test-live.html (plus camsSeen, the IntersectionObserver callback, which headless
// test runs cannot always trigger by scrolling).
export const _test = { stripKeep, parseTraffic, snapTraffic, trSpeech, trUrl, cleanLoc, signWhere, signSpeech, signLine, isTravelTime, parseCC, parseCMS, parseAlert, alertSections, wxIcon, when, whenSaid, targets, districtsNear, ctUrl, areaSaid, decode, sentence, camName, soonText, aheadSaid, agencies, andList,
  camsSeen: entries => safe(camsSeen)(entries), camOnScreen: li => onScreen.has(li) };
