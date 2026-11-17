// I-5 Buddy, missions module (2.6.0): the mission passport, the "You are at Mission X" visit card, the nearest
// missions and the mission page. (Adapted from the Buddy engine's js/missions.js.)
//
// main.js loads this file like the other modules. It owns #missionCard (Drive, right under the next-landmark card),
// #missionsPassport (top of the Passport view; trip.js keeps it there) and #missionSheet (made here when index.html has
// none), and it adds css/missions.css to the page when no link to it is there yet. Works offline, with no position,
// without GPS, without photos and without any other module. Works anywhere in California, also far off I-5: main.js
// sends "fix" for every GPS reading, on the road or off it.
//
// Data: data.MISSIONS, the 21 California missions in founding order: {n, id, name, name_es, lat, lon, founded, founder,
// people, status, site, hours, wiki, text, more, visit, src, src2}. n is the founding order (1 = San Diego, 1769).
// The I-5 places that lead to one carry `mission: n` and a `detour` {exit, road, dir, miles}: that is its turn-off.
// Store keys (store.js adds the app's prefix):
//   missionStamps   {"<n>": {t, how: "gps" | "self", id}}  t = when it was stamped (ms). "gps": the phone was within
//                   300 m of the mission. "self": a tap on "I visited" in the mission page (drawn differently).
//   missionWelcome  {"<n>": t}  when the welcome was last said there, so a reload or a GPS wobble mid-visit stays quiet
// Events: listens to pos, fix, mode, settings, tab, mission:near, place:sheet, place:stamp, passport:reset.
//   Emits "mission:stamp" {place, n, how} (a new stamp, or a tap stamp that GPS confirmed), "mission:unstamp" {place, n}
//   (a tap stamp taken back) and "mission:visit" {place, n} (arrived within 300 m).
// Public API: api.missions (bottom of this file).

let api = null;

const AT_M = 300;                 // meters: you are at the mission (GPS stamp, visit card, welcome)
const LEAVE_M = 600;              // meters: a visit ends this far away (GPS wobble on the grounds is not a new visit)
const NEAR_MI = 2;                // miles: "Mission X is 1.4 miles away" while you drive by
const MAX_ACC = 400;              // meters: a fix fuzzier than this can't tell that you are at a mission
const WELCOME_GAP = 4 * 3600e3;   // a second welcome at the same mission only after this long
const HINT_MS = 45e3;             // a "mission:near" from the core counts for this long
const POLL_MS = 4000;             // off the road GPS fixes emit no "pos": look at S.lat and S.lon on a timer as well
const MOVING_MPH = 3;
const MI = 1609.344;
const LIST_MI = 40;                // miles: parked or off I-5, the card lists the nearest missions when one is this close
const APP_URL = "https://i5.dominares.org/get";
const APP_NAME = "I-5 Buddy";

/* ---------- small, safe helpers ---------- */
function safe(fn, label) {
  return (...args) => {
    try { return fn(...args); } catch (e) { console.error(`[missions] ${label || "error"}`, e); }
  };
}
/** h("div", {class: "x", onclick: fn, "aria-label": "y"}, child, "text", [more]) */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), safe(v, k));
      else e.setAttribute(k, v === true ? "" : String(v));
    }
  }
  add(e, kids);
  return e;
}
function add(parent, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === "") continue;
    if (Array.isArray(k)) add(parent, k);
    else parent.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return parent;
}
const SVGNS = "http://www.w3.org/2000/svg";
const ICON = {
  bell: '<path d="M12 2.6a1 1 0 0 0-1 1v.9a6 6 0 0 0-4.8 5.9v3.5L4.5 17v1.2h15V17l-1.7-3.1v-3.5A6 6 0 0 0 13 4.5v-.9a1 1 0 0 0-1-1Zm-2.2 16.8a2.2 2.2 0 0 0 4.4 0H9.8Z" fill="currentColor"/>',
  turn: '<path d="M21.7 11.3l-9-9a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4ZM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5Z" fill="currentColor"/>',
  check: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4-9.6 9.6Z" fill="currentColor"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z" fill="currentColor"/>',
  bulb: '<path d="M9 21.5h6V20H9v1.5ZM12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2Z" fill="currentColor"/>',
  share: '<path d="M16 5.4 14.6 6.8 13 5.2V15h-2V5.2L9.4 6.8 8 5.4 12 1.4l4 4ZM18 9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3v2H6v9h12v-9h-3V9h3Z" fill="currentColor"/>',
  globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6H16a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8ZM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4ZM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3Zm.8 2H8c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16ZM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.4 6.7 8 8Zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4Zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6Zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4Z" fill="currentColor"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.6-13H11v6.1l5.2 3.1.8-1.3-4.4-2.6V7Z" fill="currentColor"/>',
  page: '<path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5ZM8 13v2h8v-2H8Zm0 4v2h5v-2H8Z" fill="currentColor"/>',
};
function icon(name, cls = "ms-ic") {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.setAttribute("class", cls);
  s.innerHTML = ICON[name] || "";
  return s;
}

const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
const str = v => (typeof v === "string" ? v.trim() : typeof v === "number" && isFinite(v) ? String(v) : "");
const httpUrl = v => (/^https?:\/\/\S+$/i.test(str(v)) ? str(v) : "");
const now = () => Date.now();
const S = () => api?.S || {};
const settings = () => api?.settings || {};
const D = () => api?.data || {};
const G = () => api?.geo || {};
function store(key, fallback) { try { return api?.store ? api.store.get(key, fallback) : fallback; } catch { return fallback; } }
function save(key, value) { try { api?.store?.set?.(key, value); } catch { /* storage full or blocked */ } }
function toast(t, ms) { try { api?.ui?.toast?.(t, ms); } catch { /* no toast */ } }
function unlock() { try { api?.voice?.unlock?.(); } catch { /* no audio */ } }
function say(text, opts) { try { return api?.voice?.say?.(text, opts) || Promise.resolve(false); } catch { return Promise.resolve(false); } }
function emit(evt, data) { try { api?.bus?.emit?.(evt, data); } catch (e) { console.error("[missions] emit " + evt, e); } }

/** What the user asked to hear (a tap). It goes first, unless the guide or another module is talking: then it waits
    its turn at prio 2, after the current line and any warning already waiting, ahead of ordinary narration. */
const ours = id => String(id ?? "").startsWith("mission:");
function userSay(text, id) {
  const v = api?.voice;
  if (!v || !text) return Promise.resolve(false);
  let busy = false;
  try {
    busy = (!!v.isSpeaking?.() && !ours(v.currentId?.())) || (Array.isArray(v.queued?.()) && v.queued().some(q => !ours(q)));
  } catch { busy = false; }
  return say(text, busy ? { id, prio: 2 } : { id, now: true });
}

const appName = () => APP_NAME;
const appUrl = () => APP_URL;

/* ---------- mission data ---------- */
let MISSIONS = [];        // [{n, p, road}] in founding order; p = the mission as a place, road = its I-5 turn-off place
let BY_N = new Map();
const MKEYS = ["name_es", "founded", "founder", "people", "status", "site", "hours"];
function setup() {
  const A = Array.isArray(D().MISSIONS) ? D().MISSIONS : [];
  const P = Array.isArray(D().PLACES) ? D().PLACES : [];
  const seen = new Set();
  const list = [];
  for (const m of A) {
    if (!m || typeof m !== "object") continue;
    const n = Number(m.n);
    if (!Number.isInteger(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    const road = P.find(q => q && (q.mission === n || (q.mission && typeof q.mission === "object" && Number(q.mission.n) === n))) || null;
    const p = { id: str(m.id) || `mission-${n}`, name: str(m.name) || `Mission ${n}`, text: str(m.text), more: str(m.more), visit: str(m.visit),
      src: httpUrl(m.src), src2: httpUrl(m.src2), wiki: str(m.wiki), mission: { n } };
    if (typeof m.lat === "number" && typeof m.lon === "number") { p.lat = m.lat; p.lon = m.lon; }
    for (const k of MKEYS) if (m[k] != null && m[k] !== "") p.mission[k] = m[k];
    if (road && road.img) p.img = road.img;
    list.push({ n, p, road });
  }
  list.sort((a, b) => a.n - b.n);
  MISSIONS = list;
  BY_N = new Map(list.map(x => [x.n, x]));
}
const TOTAL = () => MISSIONS.length;
const hasLL = p => !!p && typeof p.lat === "number" && typeof p.lon === "number" && isFinite(p.lat) && isFinite(p.lon);
/** A mission from its number, its place id, its place, or itself. */
function find(q) {
  if (q == null) return null;
  if (typeof q === "object") {
    if (q.p && BY_N.get(q.n) === q) return q;
    const n = typeof q.mission === "number" ? q.mission : Number(q.mission && q.mission.n);
    if (BY_N.has(n)) return BY_N.get(n);
    const hit = MISSIONS.find(x => x.p === q || x.road === q || (q.id && (x.p.id === q.id || (x.road && x.road.id === q.id))));
    if (hit) return hit;
    return typeof q.n === "number" && !q.m && BY_N.has(q.n) ? BY_N.get(q.n) : null;   // a data.MISSIONS entry
  }
  if (typeof q === "number" || /^\d+$/.test(String(q))) return BY_N.get(Number(q)) || null;
  return MISSIONS.find(x => x.p.id === q) || null;
}
const M = x => (x.p.mission && typeof x.p.mission === "object" ? x.p.mission : {});
const nameOf = x => str(x.p.name) || `Mission ${x.n}`;
/** "San Juan Capistrano" for the small passport stamps. */
const shortName = x => nameOf(x).replace(/^(Mission|Misi[oó]n)\s+/i, "") || nameOf(x);
function yearOf(f) {
  if (typeof f === "number" && isFinite(f)) return Math.round(f);
  const m = /\b(1[5-9]\d\d)\b/.exec(str(f));
  return m ? Number(m[1]) : null;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "1776-11-01" -> "November 1, 1776" (built by hand: Date would read it as UTC midnight, the day before in California). */
function foundedText(f) {
  const s = str(f);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const mo = Number(iso[2]), d = Number(iso[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${MONTHS[mo - 1]} ${d}, ${iso[1]}`;
  }
  return s;
}
const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
  "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth",
  "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth"];
const ordinal = n => ORD[n - 1] || `number ${n}`;
/** "the seventh of the 21 missions" (empty when the data has fewer missions than this number: a test or a partial pack). */
function rankWords(x) {
  const T = TOTAL();
  return T > 1 && x.n <= T ? `the ${ordinal(x.n)} of the ${T} missions` : "";
}
function hoursOf(x) {
  const v = M(x).hours;
  if (!v) return null;
  if (typeof v === "string") return httpUrl(v) ? { url: httpUrl(v), text: "" } : str(v) ? { url: "", text: str(v) } : null;
  if (typeof v === "object") {
    const o = { url: httpUrl(v.url), text: str(v.text || v.note) };
    return o.url || o.text ? o : null;
  }
  return null;
}
/** Mission n's turn-off on I-5: its place's exit and detour (data.detourOf), or null for a mission far from I-5. */
function turnoffOf(n) {
  const x = BY_N.get(n), r = x && x.road;
  if (!r) return null;
  let d = null;
  try { d = D().detourOf ? D().detourOf(r) : null; } catch { d = null; }
  return { m: typeof r.m === "number" && isFinite(r.m) ? r.m : null, exit: d ? d.exit : str(r.ex), road: r, detour: d };
}
/** "At exit 54, Highway 76 heads about 5 miles east to Mission San Luis Rey. The exit is 12 miles ahead." (the
    distance only while the exit is still ahead in your direction). Never "on your left": you reach it by the exit. */
function turnoffText(x) {
  const a = turnoffOf(x.n);
  if (!a) return "";
  let first = "";
  try { first = a.detour && D().detourSentence ? D().detourSentence({ ...a.road, name: nameOf(x) }) : ""; } catch { first = ""; }
  if (!first && a.exit) first = `Take exit ${a.exit} for ${nameOf(x)}.`;
  if (!first) return "";
  let ahead = null;
  try {
    const s = S();
    if (a.m != null && s.m != null && isFinite(s.m)) ahead = D().aheadOf ? D().aheadOf(s.m, s.dir, a.m) : s.dir === "S" ? s.m - a.m : a.m - s.m;
  } catch { ahead = null; }
  return ahead != null && ahead >= 0.3 ? `${first} The exit is ${fmtMi(ahead, true)} ahead.` : first;
}

/* ---------- distance ---------- */
function meters(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}
function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
function compassTo(pos, p) {
  if (!pos || !hasLL(p)) return "";
  return COMPASS[Math.round(bearing(pos.lat, pos.lon, p.lat, p.lon) / 45) % 8];
}
/** "3.2 mi" (or "3.2 miles" with words). */
function fmtMi(mi, words) {
  if (!(mi >= 0.1)) return words ? "less than a tenth of a mile" : "under 0.1 mi";
  const v = mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi);
  return `${v.toLocaleString("en-US")}${words ? (v === 1 ? " mile" : " miles") : " mi"}`;
}
function nearestList(lat, lon, n = 2, skip = null) {
  if (!(isFinite(lat) && isFinite(lon))) return [];
  return MISSIONS.filter(x => x !== skip && hasLL(x.p))
    .map(x => ({ place: x.p, miles: meters(lat, lon, x.p.lat, x.p.lon) / MI }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, Math.max(0, Math.floor(num(n, 2))));
}

/* ---------- where you are ---------- */
let roadNewer = false;   // a demo or manual position came after the last GPS fix
let lastLL = "";
/** {lat, lon, fix, live, acc}: fix = a GPS reading (live = GPS is on now; else the last fix after GPS stopped). Demo and
    manual positions are points on the road line (fix false): they never stamp and never say "You are at". */
function here() {
  const s = S();
  const ll = typeof s.lat === "number" && typeof s.lon === "number" && isFinite(s.lat) && isFinite(s.lon);
  if (s.mode === "gps") return ll ? { lat: s.lat, lon: s.lon, fix: true, live: true, acc: s.accuracy } : null;
  if (ll && !roadNewer && s.mode !== "demo" && s.mode !== "manual") return { lat: s.lat, lon: s.lon, fix: true, live: false, acc: s.accuracy };
  if (s.m != null && isFinite(s.m)) {
    try {
      const c = G().coordAt?.(s.m);
      if (c && isFinite(c[0]) && isFinite(c[1])) return { lat: c[0], lon: c[1], fix: false, live: false, acc: null };
    } catch { /* no road line */ }
  }
  return null;
}
let hint = null;   // the core's latest "mission:near": {n, mi, t}
function distM(x, pos) {
  if (pos && hasLL(x.p)) return meters(pos.lat, pos.lon, x.p.lat, x.p.lon);
  if (hint && hint.n === x.n && now() - hint.t < HINT_MS) return hint.mi * MI;
  return Infinity;
}
/** Every mission we can place, nearest first: [{x, d (meters)}]. */
function ranked(pos) {
  return MISSIONS.map(x => ({ x, d: distM(x, pos) })).filter(r => isFinite(r.d)).sort((a, b) => a.d - b.d);
}
const accOk = pos => pos.acc == null || !isFinite(pos.acc) || pos.acc <= MAX_ACC;

/* ---------- stamps ---------- */
let stamps = {};      // "<n>" -> {t, how, id}
let welcomes = {};    // "<n>" -> t
let fresh = { n: 0, t: 0 };   // the mission stamped a moment ago: its passport stamp lands with a thump
function loadState() {
  stamps = {};
  const raw = store("missionStamps", {});
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
      const how = v.how === "gps" || v.how === "self" ? v.how : null;
      if (!how) continue;
      stamps[k] = { t: num(v.t, 0), how };
      if (typeof v.id === "string") stamps[k].id = v.id;
    }
  }
  welcomes = {};
  const w = store("missionWelcome", {});
  if (w && typeof w === "object" && !Array.isArray(w)) for (const [k, v] of Object.entries(w)) if (/^\d+$/.test(k) && typeof v === "number") welcomes[k] = v;
}
const stampOf = n => stamps[String(n)] || null;
const gotCount = () => MISSIONS.filter(x => stampOf(x.n)).length;
/** Stamp a mission. "gps" also confirms a tap stamp; "self" never replaces a GPS stamp. True when something changed. */
function setStamp(x, how) {
  const k = String(x.n), old = stamps[k];
  if (how === "gps" ? old && old.how === "gps" : !!old) return false;
  stamps[k] = { t: now(), how, id: x.p.id };
  save("missionStamps", stamps);
  // its I-5 turn-off place gets its passport stamp too ("I visited" = "I went there")
  if (x.road) { try { api?.narrator?.stampSelf?.(x.road); } catch { /* no narrator */ } }
  fresh = { n: x.n, t: now() };
  emit("mission:stamp", { place: x.p, n: x.n, how });
  afterStamps();
  if (gotCount() === TOTAL() && TOTAL() > 1 && !old) toast(`All ${TOTAL()} missions are in your passport. What a journey!`, 5000);
  return true;
}
function removeSelfStamp(x) {
  const k = String(x.n);
  if (!stamps[k] || stamps[k].how !== "self") return false;
  delete stamps[k];
  save("missionStamps", stamps);
  emit("mission:unstamp", { place: x.p, n: x.n });
  afterStamps();
  return true;
}
function afterStamps() {
  safe(renderPassport, "passport")();
  safe(refreshSheet, "sheet")();
  card.key = "";   // the card shows stamps too
}
function onReset() {
  stamps = {}; welcomes = {}; fresh = { n: 0, t: 0 };
  try { api?.store?.del?.("missionStamps"); api?.store?.del?.("missionWelcome"); } catch { /* storage blocked */ }
  afterStamps();
  evaluate();
}

/* ---------- visits ---------- */
let visit = null;    // {n, since, text, lede}
function checkVisit(pos, R) {
  if (visit) {
    const x = BY_N.get(visit.n);
    if (!x) visit = null;
    else if (!pos) return;                                     // no position for now: stay where we were
    else if (pos.fix && distM(x, pos) <= LEAVE_M) return;      // still on the grounds
    else if (pos.fix && !accOk(pos)) return;                   // too fuzzy to tell (thick adobe walls): stay
    else visit = null;                                         // walked away, or a pretend position took over
  }
  if (!pos || !pos.live || !accOk(pos)) return;
  const top = R[0];
  if (top && top.d <= AT_M) startVisit(top.x);
}
function startVisit(x) {
  const stamped = setStamp(x, "gps");   // a new stamp, or a tap stamp confirmed
  const rk = rankWords(x), yr = yearOf(M(x).founded);
  const about = [rk, yr ? `founded in ${yr}` : ""].filter(Boolean).join(", ");
  const tail = stamped ? " Your passport has a new stamp." : "";
  visit = {
    n: x.n, since: now(),
    text: `Welcome to ${nameOf(x)}${about ? `, ${about}` : ""}.${tail}`,
    lede: `Welcome.${about ? ` ${about[0].toUpperCase()}${about.slice(1)}.` : ""}${tail}`,
  };
  emit("mission:visit", { place: x.p, n: x.n });
  announce(`You are at ${nameOf(x)}.${tail}`);
  welcome(x);
}
/** The short welcome, once per visit: with narration on, and not again at the same mission for a few hours. */
function welcome(x) {
  if (!settings().narr || !visit) return false;
  const k = String(x.n), last = num(welcomes[k], 0);
  if (last && now() - last < WELCOME_GAP && last <= now()) return false;
  welcomes[k] = now();
  save("missionWelcome", welcomes);
  const n = x.n;
  say(visit.text, { id: `mission:${n}:visit`, prio: 1, chime: true, check: () => !!visit && visit.n === n });
  return true;
}

/* ---------- facts (Kid mode) ---------- */
const factAt = new Map();   // n -> next fact index
let shownFact = null;       // {n, text}: the fact on screen
function facts(x) {
  const m = M(x), name = nameOf(x), out = [];
  for (const f of [].concat(m.facts || [], m.kid || [])) if (typeof f === "string" && f.trim()) out.push(f.trim());
  const yr = yearOf(m.founded), age = yr ? new Date(now()).getFullYear() - yr : 0;
  if (yr && age > 0) out.push(`${name} was founded in ${yr}. That was ${age} years ago.`);
  const rk = rankWords(x);
  if (rk) out.push(`${name} was ${rk} to be founded.`);
  const ppl = str(m.people).replace(/\s+people$/i, "");
  if (ppl) out.push(`The ${ppl} people lived on this land long before the mission was built.`);
  if (str(m.founder)) out.push(`${str(m.founder)} founded this mission.`);
  const es = str(m.name_es);
  if (es && es !== name) out.push(`In Spanish, its name is ${es}.`);
  if (str(m.status)) out.push(`What is it today? ${str(m.status).replace(/[.\s]+$/, "")}.`);
  return out;
}
function tellFact(x) {
  x = find(x);
  if (!x) return "";
  unlock();
  const F = facts(x);
  if (!F.length) return "";
  const i = num(factAt.get(x.n), 0) % F.length;
  factAt.set(x.n, i + 1);
  shownFact = { n: x.n, text: F[i] };
  for (const el of document.querySelectorAll(`.ms-fact[data-n="${x.n}"]`)) { el.textContent = F[i]; el.hidden = false; }
  userSay(F[i], `mission:${x.n}:fact`);
  return F[i];
}
/** The welcome (with and without the stamp line), the facts and the "Hear it" text of every mission, worded exactly as
    the code above says them. */
function phraseList() {
  const out = [];
  for (const x of MISSIONS) {
    const rk = rankWords(x), yr = yearOf(M(x).founded);
    const about = [rk, yr ? `founded in ${yr}` : ""].filter(Boolean).join(", ");
    for (const tail of ["", " Your passport has a new stamp."]) out.push(`Welcome to ${nameOf(x)}${about ? `, ${about}` : ""}.${tail}`);
    for (const f of facts(x)) out.push(f);
    const text = [str(x.p.visit) || str(x.p.text)].filter(Boolean).join(" ");
    if (text) out.push(`${nameOf(x)}. ${text}`);
  }
  return out;
}
function hear(x) {
  unlock();
  const p = x.p;
  const text = [str(p.visit) || str(p.text)].filter(Boolean).join(" ");
  if (text) userSay(`${nameOf(x)}. ${text}`, `mission:${x.n}:hear`);
}

/* ---------- links ---------- */
function onApple() {
  try { if (api?.native?.NATIVE) return true; } catch { /* no native module */ }
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod|Macintosh/.test(ua);   // iPadOS asking for the desktop site says Macintosh too
}
function directionsUrl(lat, lon) {
  const ll = `${Number(lat.toFixed(6))},${Number(lon.toFixed(6))}`;
  return onApple() ? `https://maps.apple.com/?daddr=${ll}` : `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
}
function dirLink(x, main) {
  if (!hasLL(x.p)) return null;
  return h("a", { class: `ms-btn${main ? " main" : ""}`, href: directionsUrl(x.p.lat, x.p.lon), target: "_blank", rel: "noopener",
    "aria-label": `Directions to ${nameOf(x)} (opens ${onApple() ? "Apple Maps" : "Google Maps"})`, "data-k": `dir:${x.n}` },
  icon("turn"), h("span", { class: "ms-btn-t" }, "Directions"));
}
function extLink(cls, href, label, text, ic, k) {
  return h("a", { class: cls, href, target: "_blank", rel: "noopener", "aria-label": label, "data-k": k }, ic ? icon(ic) : null, text);
}

/* ---------- dates ---------- */
function dayShort(t) {
  if (!(t > 1e12)) return "";
  try { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return ""; }
}
function dayLong(t) {
  if (!(t > 1e12)) return "";
  try {
    const d = new Date(t), other = d.getFullYear() !== new Date(now()).getFullYear();
    return "on " + d.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(other ? { year: "numeric" } : {}) });
  } catch { return ""; }
}
function stampWords(st) {
  if (!st) return "Not visited yet";
  return st.how === "gps" ? `Stamped by GPS${dayLong(st.t) ? " " + dayLong(st.t) : ""}` : `You marked it visited${dayLong(st.t) ? " " + dayLong(st.t) : ""}`;
}

/* ---------- shared bits of the card and the sheet ---------- */
function kicker(x, extra) {
  const st = stampOf(x.n), T = TOTAL();
  return h("div", { class: "ms-k" }, icon("bell", "ms-ic ms-bell"),
    h("span", null, x.n <= T && T > 1 ? `Mission ${x.n} of ${T}` : `Mission ${x.n}`),
    extra ? [h("span", { class: "ms-sr" }, ", "), h("span", { class: "ms-k-x" }, extra)] : null,
    st ? [h("span", { class: "ms-sr" }, ", "), h("span", { class: `ms-chip ${st.how}` }, st.how === "gps" ? icon("check", "ms-ic ms-ic-s") : null, st.how === "gps" ? "Stamped" : "Visited")] : null);
}
function factsDl(x) {
  const m = M(x), rows = [];
  const hrs = hoursOf(x);
  if (str(m.founded)) rows.push(["Founded", foundedText(m.founded)]);
  if (str(m.founder)) rows.push(["Founded by", str(m.founder)]);
  if (str(m.people)) rows.push(["Native people", str(m.people)]);
  if (str(m.status)) rows.push(["Today", str(m.status)]);
  if (hrs && hrs.text) rows.push(["Hours", hrs.text]);
  if (!rows.length) return null;
  return h("dl", { class: "ms-facts" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
}
function kidBox(x) {
  if (!settings().kid || !x || !facts(x).length) return null;
  const f = shownFact && shownFact.n === x.n ? shownFact.text : "";
  return h("div", { class: "ms-kid" },
    h("button", { class: "ms-btn ms-factbtn", type: "button", "data-k": `fact:${x.n}`, "aria-label": `Mission fact about ${nameOf(x)}`, onclick: () => tellFact(x) },
      icon("bulb"), "Mission fact"),
    h("p", { class: "ms-fact", "data-n": x.n, "aria-live": "polite", hidden: !f }, f));
}
function linksRow(x, withPage) {
  const m = M(x), hrs = hoursOf(x), site = httpUrl(m.site);
  return h("div", { class: "ms-acts" },
    withPage ? h("button", { class: "ms-btn main", type: "button", "data-k": `page:${x.n}`, onclick: e => openMission(x, e.currentTarget) }, icon("page"), "Mission page") : null,
    hrs && hrs.url ? extLink("ms-btn", hrs.url, `Visiting hours for ${nameOf(x)} (opens the mission's website)`, "Hours", "clock", `hours:${x.n}`) : null,
    site ? extLink("ms-btn", site, `${nameOf(x)} official website`, "Official site", "globe", `site:${x.n}`) : null,
    str(x.p.visit) || str(x.p.text) ? h("button", { class: "ms-btn", type: "button", "data-k": `hear:${x.n}`, "aria-label": `Hear about ${nameOf(x)}`, onclick: () => hear(x) }, icon("speaker"), "Hear it") : null);
}

/* ---------- the card on Drive (#missionCard) ---------- */
let hostEl = null, slot = null, srEl = null;
const card = { kind: "none", key: "", n: null };
let lastPos = null, lastR = [];
function ensureHost() {
  const box = document.getElementById("missionCard");
  if (!box) return null;
  if (box !== hostEl || !slot || !box.contains(slot)) {
    hostEl = box;
    box.textContent = "";
    box.classList.add("ms-host");
    srEl = h("p", { class: "ms-sr", role: "status" });
    slot = h("div", { class: "ms-slot" });
    box.append(srEl, slot);
    card.key = "";
  }
  return box;
}
let srTimer = 0;
function announce(msg) {
  if (!msg || !ensureHost()) return;
  srEl.textContent = "";
  clearTimeout(srTimer);
  srTimer = setTimeout(() => { if (srEl) srEl.textContent = msg; }, 120);
}
/** "3.2 mi northeast" for a row; "3.2 miles" (no compass) for a sentence. */
function distText(x, words) {
  const r = lastR.find(o => o.x === x);
  if (!r) return "";
  const c = words ? "" : compassTo(lastPos, x.p);
  return `${fmtMi(r.d / MI, words)}${c && r.d >= 0.1 * MI ? ` ${c}` : ""}`;
}

function evaluate() {
  if (!TOTAL()) { if (ensureHost()) hostEl.hidden = true; return; }
  const pos = here();
  if (pos && pos.live) {
    const ll = `${pos.lat},${pos.lon}`;
    if (ll !== lastLL) { lastLL = ll; roadNewer = false; }
  }
  const R = ranked(pos);
  checkVisit(pos, R);
  const s = S();
  const driving = (s.mode === "gps" || s.mode === "demo") && num(s.speed, 0) >= MOVING_MPH && !s.offRoute;
  let kind = "none", main = null;
  if (visit && BY_N.get(visit.n)) { kind = "at"; main = BY_N.get(visit.n); }
  else if (driving) { if (R[0] && R[0].d <= NEAR_MI * MI) { kind = "near"; main = R[0].x; } }
  else if (pos && R.length && R[0].d <= LIST_MI * MI) kind = "list";
  renderCard(kind, main, R, pos);
}

function renderCard(kind, main, R, pos) {
  if (!ensureHost()) return;
  lastPos = pos; lastR = R;
  const kid = settings().kid ? 1 : 0;
  const sk = x => (stampOf(x.n) || {}).how || "-";
  const top = R.slice(0, 2);
  let key = "none";
  if (kind === "at") key = `at|${main.n}|${sk(main)}|${kid}|${visit ? visit.since : 0}`;
  else if (kind === "near") key = `near|${main.n}|${sk(main)}|${kid}`;
  else if (kind === "list") key = `list|${top.map(r => `${r.x.n}:${sk(r.x)}`).join(",")}|${kid}|${gotCount()}`;
  card.kind = kind;
  card.n = main ? main.n : kind === "list" && top[0] ? top[0].x.n : null;
  if (key !== card.key) {
    card.key = key;
    const a = document.activeElement;
    const fk = a && slot.contains(a) && a.dataset ? a.dataset.k : null;
    let el = null;
    try { el = kind === "at" ? cardAt(main) : kind === "near" ? cardNear(main) : kind === "list" ? cardList(top) : null; }
    catch (e) { console.error("[missions] card", e); el = null; }
    slot.textContent = "";
    if (el) slot.append(el);
    hostEl.hidden = !el;
    if (fk) {
      const f = [...slot.querySelectorAll("[data-k]")].find(n => n.dataset.k === fk);
      if (f) f.focus({ preventScroll: true });
    }
  }
  for (const el of slot.querySelectorAll("[data-dist]")) {
    const x = BY_N.get(Number(el.dataset.dist));
    const t = x ? distText(x, el.hasAttribute("data-words")) : "";
    if (el.textContent !== t) el.textContent = t;   // only when it changes: it runs on every GPS fix
  }
}

/** You are at the mission. */
function cardAt(x) {
  const p = x.p, m = M(x);
  const next = (hasLL(p) ? nearestList(p.lat, p.lon, 1, x) : lastR.filter(r => r.x !== x).slice(0, 1).map(r => ({ place: r.x.p, miles: r.d / MI })))[0];
  const nx = next ? find(next.place) : null;
  return h("article", { class: "ms-card ms-at", "aria-labelledby": "msCardTitle", "data-n": x.n },
    kicker(x, "You are here"),
    h("h2", { id: "msCardTitle" }, `You are at ${nameOf(x)}`),
    str(m.name_es) && str(m.name_es) !== nameOf(x) ? h("p", { class: "ms-es", lang: "es" }, str(m.name_es)) : null,
    h("p", { class: "ms-lede" }, visit ? visit.lede : "Welcome."),
    str(p.visit) ? h("p", { class: "ms-visit" }, str(p.visit)) : null,
    factsDl(x),
    linksRow(x, true),
    kidBox(x),
    nx ? h("div", { class: "ms-next" },
      h("p", { class: "ms-next-k" }, "Next nearest mission"),
      h("div", { class: "ms-next-row" },
        h("div", { class: "ms-next-tt" },
          h("button", { class: "ms-name", type: "button", "data-k": `next:${nx.n}`, onclick: e => openMission(nx, e.currentTarget) }, nameOf(nx)),
          h("span", { class: "ms-meta" }, [fmtMi(next.miles), compassTo(p, nx.p)].filter(Boolean).join(" "), stampOf(nx.n) ? " · in your passport" : "")),
        dirLink(nx))) : null);
}
/** Driving by: a mission within 2 miles. */
function cardNear(x) {
  const t = turnoffText(x);
  return h("article", { class: "ms-card ms-near", "aria-labelledby": "msCardTitle", "data-n": x.n },
    kicker(x, "Nearby"),
    h("h2", { id: "msCardTitle" }, `${nameOf(x)} is `, h("span", { "data-dist": x.n, "data-words": "" }, distText(x, true)), " away"),
    t ? h("p", { class: "ms-turn" }, t) : null,
    h("div", { class: "ms-acts" }, dirLink(x, true),
      h("button", { class: "ms-btn", type: "button", "data-k": `page:${x.n}`, onclick: e => openMission(x, e.currentTarget) }, icon("page"), "Mission page")),
    kidBox(x));
}
/** Parked or off the road: the nearest two missions. */
function cardList(top) {
  const T = TOTAL(), got = gotCount();
  return h("article", { class: "ms-card ms-list", "aria-labelledby": "msCardTitle" },
    h("div", { class: "ms-k" }, icon("bell", "ms-ic ms-bell"), h("span", { id: "msCardTitle" }, top.length > 1 ? "Nearest missions" : "Nearest mission"),
      h("span", { class: "ms-sr" }, ", "), h("span", { class: "ms-k-r" }, `${got} of ${T} stamped`)),
    h("ol", { class: "ms-rows" }, top.map(r => {
      const x = r.x, st = stampOf(x.n), yr = yearOf(M(x).founded);
      return h("li", { class: `ms-row${st ? " got " + st.how : ""}` },
        h("span", { class: "ms-num", "aria-hidden": "true" }, String(x.n)),
        h("div", { class: "ms-row-tt" },
          h("button", { class: "ms-name", type: "button", "data-k": `row:${x.n}`, onclick: e => openMission(x, e.currentTarget) }, nameOf(x)),
          h("span", { class: "ms-meta" }, h("span", { "data-dist": x.n }, distText(x)),
            yr ? ` · founded ${yr}` : "", st ? ` · ${st.how === "gps" ? "stamped" : "visited"}` : "")),
        dirLink(x));
    })),
    kidBox(top[0] && top[0].x));
}

/* ---------- the passport (#missionsPassport) ---------- */
let ppRoot = null;
function stampRot(n) { return ((n * 37) % 11) - 5; }
function renderPassport() {
  const box = document.getElementById("missionsPassport");
  if (!box) return;
  box.classList.add("ms-pphost");
  if (!TOTAL()) { box.hidden = true; box.textContent = ""; return; }
  box.hidden = false;
  const a = document.activeElement;
  const fk = a && box.contains(a) && a.dataset ? a.dataset.k : null;
  const T = TOTAL(), got = gotCount(), pct = Math.round(got / T * 100);
  const bar = h("div", { class: "ms-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": T, "aria-valuenow": got,
    "aria-valuetext": `${got} of ${T}`, "aria-label": "Missions visited" }, h("i", { style: `width:${pct}%` }));
  const list = h("ol", { class: "ms-stamps" }, MISSIONS.map(x => {
    const st = stampOf(x.n), yr = yearOf(M(x).founded);
    const b = h("button", {
      class: `ms-stamp${st ? " got " + st.how : ""}${st && fresh.n === x.n && now() - fresh.t < 20e3 ? " fresh" : ""}`, type: "button", "data-k": `ms:${x.n}`,
      "aria-label": `${x.n}. ${nameOf(x)}${yr ? `, founded ${yr}` : ""}. ${stampWords(st)}.`,
      style: st && st.how === "gps" ? `--rot:${stampRot(x.n)}deg` : null,
      onclick: e => openMission(x, e.currentTarget),
    },
    h("span", { class: "ms-ring", "aria-hidden": "true" }, h("small", null, "No."), h("b", null, String(x.n)), h("small", { class: "ms-yr" }, yr ? String(yr) : "")),
    h("span", { class: "ms-nm", "aria-hidden": "true" }, shortName(x)),
    h("span", { class: "ms-when", "aria-hidden": "true" }, st ? (st.how === "gps" ? dayShort(st.t) || "Stamped" : "Visited") : ""));
    return h("li", null, b);
  }));
  const line = shareLine(got, T);
  const y0 = yearOf(M(MISSIONS[0]).founded);
  ppRoot = h("section", { class: "ms-pp", "aria-labelledby": "msPpTitle" },
    h("div", { class: "ms-pp-head" },
      h("div", { class: "ms-pp-tt" }, h("h2", { class: "ms-pp-title", id: "msPpTitle" }, "Mission passport"),
        h("p", { class: "ms-pp-sub" }, y0 ? `In founding order, starting in ${y0}.` : "In founding order.")),
      h("p", { class: "ms-pp-count" }, h("b", null, String(got)), ` of ${T}`)),
    bar, list,
    h("p", { class: "ms-legend" }, got
      ? "A solid stamp means your phone was there. A dashed one is a visit you marked yourself."
      : "Visit a mission and your phone stamps it here. Been to one before? Open it and tap I visited."),
    got ? h("div", { class: "ms-share" }, h("p", null, line),
      h("button", { class: "ms-btn", type: "button", "data-k": "share", "aria-label": "Share your mission passport", onclick: sharePassport }, icon("share"), "Share")) : null);
  box.textContent = "";
  box.append(ppRoot);
  if (fk) {
    const f = [...box.querySelectorAll("[data-k]")].find(n => n.dataset.k === fk);
    if (f) f.focus({ preventScroll: true });
  }
}
function shareLine(got, T) {
  if (got >= T && T > 1) return `I've visited all ${T} California missions.`;
  return `I've visited ${got} of the ${T} California missions.`;
}
let sharing = false;
async function sharePassport() {
  const text = `${shareLine(gotCount(), TOTAL())} My passport is in ${appName()}.`;
  const data = { title: `My mission passport`, text, url: appUrl() };
  const sh = api?.share;
  try {
    if (sh && typeof sh.shareText === "function") return await sh.shareText(data);
  } catch (e) { console.warn("[missions] share", e); }
  if (sharing) return "busy";
  if (typeof navigator.share === "function") {
    sharing = true;
    try { await navigator.share(data); return "shared"; }
    catch (e) { if (e && (e.name === "AbortError" || e.name === "InvalidStateError")) return "cancelled"; }
    finally { sharing = false; }
  }
  const all = `${text} ${data.url}`;
  let ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(all); ok = true; } } catch { ok = false; }
  toast(ok ? "Copied. Paste it in a message to share." : all, ok ? 2600 : 6000);
  return ok ? "copied" : "shown";
}

/* ---------- the mission page (#missionSheet) ---------- */
let sheetEl = null, sheetX = null, sheetOpener = null;
function ensureSheet() {
  let sh = document.getElementById("missionSheet");
  if (!sh) {
    sh = h("aside", { class: "sheet", id: "missionSheet", hidden: true, role: "dialog", "aria-modal": "true" });
    (document.querySelector(".app") || document.body).append(sh);
  }
  if (sh !== sheetEl) {
    sheetEl = sh;
    // give focus back to whatever opened the page when it closes (backdrop, Escape or Close)
    try {
      new MutationObserver(() => {
        if (!sh.hidden || !sheetOpener) return;
        const o = sheetOpener;
        sheetOpener = null;
        const a = document.activeElement;
        if (a && a !== document.body && !sh.contains(a)) return;
        let t = o.isConnected ? o : null;
        const k = o.dataset && o.dataset.k;
        if (!t && k) t = [...document.querySelectorAll("#missionCard [data-k], #missionsPassport [data-k]")].find(n => n.dataset.k === k) || null;
        if (t) t.focus({ preventScroll: true });
      }).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
    } catch { /* old browser: focus stays put */ }
  }
  return sh;
}
function closeSheet() {
  try { if (api?.ui?.closeSheet) return api.ui.closeSheet(); } catch { /* below */ }
  if (sheetEl) sheetEl.hidden = true;
  const back = document.getElementById("sheetBack");
  if (back) back.hidden = true;
}
function openMission(x, opener) {
  x = find(x);
  if (!x) return false;
  const sh = ensureSheet();
  sheetX = x;
  const a = opener && opener.focus ? opener : document.activeElement;
  fillSheet(sh, x);
  try {
    if (api?.ui?.openSheet) api.ui.openSheet(sh);
    else { sh.hidden = false; const back = document.getElementById("sheetBack"); if (back) back.hidden = false; }
  } catch (e) { console.error("[missions] openSheet", e); sh.hidden = false; }
  sheetOpener = a && a !== document.body ? a : null;   // after openSheet: it closes any open sheet first
  return true;
}
function refreshSheet() {
  if (!sheetEl || sheetEl.hidden || !sheetX) return;
  const a = document.activeElement;
  const fk = a && sheetEl.contains(a) && a.dataset ? a.dataset.k : null;
  const top = sheetEl.scrollTop;
  fillSheet(sheetEl, sheetX);
  sheetEl.scrollTop = top;
  if (fk) {
    const f = [...sheetEl.querySelectorAll("[data-k]")].find(n => n.dataset.k === fk);
    if (f) f.focus({ preventScroll: true });
  }
}
function fillSheet(sh, x) {
  const p = x.p, m = M(x), st = stampOf(x.n), yr = yearOf(m.founded);
  sh.className = "sheet ms-sheet";
  sh.setAttribute("aria-labelledby", "msSheetTitle");
  let ph = null;
  try { ph = p.img && api?.ui?.photo ? api.ui.photo(p, "full") : null; } catch { ph = null; }
  const pos = lastPos || here();
  const away = pos && hasLL(p) ? meters(pos.lat, pos.lon, p.lat, p.lon) / MI : null;
  const where = away != null && away >= 0.2 && !(visit && visit.n === x.n)
    ? `${fmtMi(away)} ${compassTo(pos, p)} of ${pos.fix ? "you" : "your spot on the road"}` : "";
  const turn = turnoffText(x);
  const hrs = hoursOf(x);
  const sh2 = api?.share && typeof api.share.sharePlace === "function" ? api.share : null;
  const visitedRow = st && st.how === "gps"
    ? h("p", { class: "ms-gpsnote" }, icon("check", "ms-ic"), stampWords(st) + ".")
    : h("div", { class: "ms-visited-row" },
      h("button", { class: `ms-btn${st ? "" : " main"} ms-visited`, type: "button", "aria-pressed": String(!!st), "data-k": "visited",
        onclick: () => toggleVisited(x) }, icon("check"), st ? "Visited" : "I visited"),
      h("span", { class: "ms-hint" }, st ? `${stampWords(st)}. Tap again to take it back.` : "Been here? Stamp it yourself."));
  sh.textContent = "";
  add(sh, [
    h("div", { class: "sheet-head" }, h("b", { id: "msSheetTitle" }, nameOf(x)),
      h("button", { class: "link", type: "button", onclick: closeSheet }, "Close")),
    ph,
    kicker(x, yr ? `Founded ${yr}` : ""),
    str(m.name_es) && str(m.name_es) !== nameOf(x) ? h("p", { class: "ms-es", lang: "es" }, str(m.name_es)) : null,
    where ? h("p", { class: "ms-where" }, where) : null,
    str(p.text) ? h("p", { class: "ms-lead" }, str(p.text)) : null,
    str(p.visit) ? h("section", { class: "ms-sec", "aria-label": "Visiting" }, h("h3", { class: "sub" }, "Visiting"), h("p", null, str(p.visit))) : null,
    factsDl(x),
    hrs && hrs.text ? h("p", { class: "ms-hint" }, "Hours change. Check the mission's own site before you go.") : null,
    turn ? h("p", { class: "ms-turn" }, turn) : null,
    visitedRow,
    h("div", { class: "ms-acts" },
      dirLink(x, false),
      hrs && hrs.url ? extLink("ms-btn", hrs.url, `Visiting hours for ${nameOf(x)} (opens the mission's website)`, "Hours", "clock", `hours:${x.n}`) : null,
      httpUrl(m.site) ? extLink("ms-btn", httpUrl(m.site), `${nameOf(x)} official website`, "Official site", "globe", `site:${x.n}`) : null,
      str(p.visit) || str(p.text) ? h("button", { class: "ms-btn", type: "button", "data-k": `hear:${x.n}`, "aria-label": `Hear about ${nameOf(x)}`, onclick: () => hear(x) }, icon("speaker"), "Hear it") : null,
      sh2 && x.road ? h("button", { class: "ms-btn", type: "button", "data-k": `share:${x.n}`, "aria-label": `Share ${nameOf(x)}`, onclick: () => sh2.sharePlace(x.road) }, icon("share"), "Share") : null),
    kidBox(x),
  ]);
}
function toggleVisited(x) {
  const st = stampOf(x.n);
  if (st && st.how === "self") {
    removeSelfStamp(x);
    toast(`Took the stamp for ${nameOf(x)} back out.`);
  } else if (!st) {
    setStamp(x, "self");
    toast(`${nameOf(x)} is in your passport. ${gotCount()} of ${TOTAL()}.`);
  }
  evaluate();
  // the page was drawn again: keep the person (and VoiceOver, and Safari, which doesn't focus a tapped button) on it
  const b = sheetEl && !sheetEl.hidden ? sheetEl.querySelector('[data-k="visited"]') : null;
  if (b) b.focus({ preventScroll: true });
}

/* ---------- events and timers ---------- */
let pollTimer = 0;
function syncPoll() {
  const want = S().mode === "gps" && document.visibilityState !== "hidden" && TOTAL() > 0;
  if (want && !pollTimer) pollTimer = setInterval(safe(evaluate, "poll"), POLL_MS);
  else if (!want && pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
}
function onNear(e) {
  const x = e && e.place ? find(e.place) : null;
  if (!x) return;
  const mi = Number(e.dist);
  hint = { n: x.n, mi: isFinite(mi) && mi >= 0 ? mi : NEAR_MI, t: now() };
  evaluate();
}
/** "I went there" on a turn-off place's sheet (main.js): its mission gets a tap stamp too. */
function onPlaceStamp(e) {
  if (!e || e.how !== "self" || !e.place) return;
  const x = find(e.place);
  if (x && !stampOf(x.n)) { setStamp(x, "self"); evaluate(); }
}
/** main.js built a place sheet: a mission gets a button to its full page. */
function onPlaceSheet(e) {
  const x = e && e.place ? find(e.place) : null;
  if (!x || !e.acts || typeof e.acts.append !== "function") return;
  e.acts.append(h("button", { class: "secondary", type: "button", onclick: ev => openMission(x, ev.currentTarget) }, "Mission page"));
}
function addStyles() {
  if (document.querySelector('link[href*="missions.css"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL("../css/missions.css", import.meta.url).href;
  document.head.append(l);
}

/* ---------- init ---------- */
export function init(a) {
  api = a || null;
  if (!api) return;
  visit = null; hint = null; roadNewer = false; lastLL = ""; shownFact = null; factAt.clear();
  card.kind = "none"; card.key = ""; card.n = null;
  safe(setup, "data")();
  safe(loadState, "load")();
  safe(addStyles, "styles")();

  const on = (evt, fn) => { try { api.bus?.on?.(evt, safe(fn, evt)); } catch (e) { console.error("[missions] bus", e); } };
  on("pos", () => {
    const md = S().mode;
    if (md === "demo" || md === "manual") roadNewer = true;
    evaluate();
  });
  on("fix", evaluate);                 // every GPS fix, when the core sends one (off the road "pos" stays quiet)
  on("mission:near", onNear);
  on("mode", md => {
    if (md === "demo" || md === "manual") roadNewer = true;
    syncPoll();
    evaluate();
  });
  on("settings", () => { card.key = ""; evaluate(); refreshSheet(); });
  on("tab", t => {
    if (t === "passport") {
      renderPassport();
      // trip.js draws the rest of the view on the same event: if that took our part out, draw it again
      setTimeout(safe(() => { const b = document.getElementById("missionsPassport"); if (b && (!ppRoot || !b.contains(ppRoot))) renderPassport(); }, "passport"), 0);
    } else if (t === "drive") evaluate();
  });
  on("passport:reset", onReset);
  on("place:sheet", onPlaceSheet);
  on("place:stamp", onPlaceStamp);
  try { document.addEventListener("visibilitychange", safe(() => { syncPoll(); if (document.visibilityState !== "hidden") evaluate(); }, "visible")); } catch { /* no document events */ }

  safe(syncPoll, "poll")();
  safe(evaluate, "first look")();
  safe(renderPassport, "passport")();

  api.missions = {
    /** The n missions nearest to a point, straight-line: [{place, miles}] (missions with coordinates only). */
    nearest: (lat, lon, n = 2) => safe(nearestList, "nearest")(Number(lat), Number(lon), n) || [],
    /** Mission places in founding order. */
    list: () => MISSIONS.map(x => x.p),
    /** {"<n>": {t, how: "gps" | "self", id}} (a copy). */
    stamps: () => JSON.parse(JSON.stringify(stamps)),
    progress: () => ({ got: gotCount(), total: TOTAL() }),
    /** Open the mission page: a number, a place id or a place. */
    open: q => !!safe(openMission, "open")(q),
    /** Mark a mission visited by hand (a voice command can use it). */
    visited: q => { const x = find(q); return x ? !!safe(setStamp, "visited")(x, "self") && (evaluate(), true) : false; },
    /** Read one short fact (Kid mode's button). Returns the text. */
    fact: q => safe(tellFact, "fact")(q ?? card.n) || "",
    directions: q => { const x = find(q); return x && hasLL(x.p) ? directionsUrl(x.p.lat, x.p.lon) : ""; },
    /** What the Drive card shows: {kind: "none" | "at" | "near" | "list", n, visit} (tests). */
    state: () => ({ kind: card.kind, n: card.n, visit: visit ? { ...visit } : null }),
    /** Look at the position now (tests; the module also looks on every pos, fix, mission:near and every 4 s on GPS). */
    check: () => safe(evaluate, "check")(),
    /** Every sentence this module can say: tools/voice/ records the natural voice's clips from this list. */
    phrases: () => safe(phraseList, "phrases")() || [],
  };
}
