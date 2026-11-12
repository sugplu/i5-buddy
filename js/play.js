// I-5 Buddy play module: road bingo, trivia and I spy.
// Owns #view-play (the whole Play tab) and #spotCard (the I spy cards on Drive, under the next-landmark card).
// Works offline, with no position (S.m === null), with no trivia or I spy data, and without other modules.
// Store keys: "bingo" (the current card), "trivia" ({right, asked, best}), "spy" ({points, found, missed}),
// "playGame" (last game picked on the Play tab).

let api = null;

/* ---------- small, safe helpers ---------- */
function safe(fn, label) {
  return (...args) => {
    try { return fn(...args); } catch (e) { console.error(`[play] ${label || "error"}`, e); }
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
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : String(v));
    }
  }
  add(e, kids);
  return e;
}
function add(parent, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(parent, k);
    else parent.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return parent;
}
const SVGNS = "http://www.w3.org/2000/svg";
function svg(viewBox, inner, cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = inner;
  return s;
}
const shield = cls => svg("0 0 58 62", '<use href="#shield"/>', cls);
const ICON = {
  eye: '<path d="M12 5C6.5 5 2.6 9.2 1.3 12c1.3 2.8 5.2 7 10.7 7s9.4-4.2 10.7-7C21.4 9.2 17.5 5 12 5Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" fill="currentColor"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z" fill="currentColor"/>',
  mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" fill="currentColor"/>',
  check: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4-9.6 9.6Z" fill="currentColor"/>',
  cross: '<path d="M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9 4.9-4.9Z" fill="currentColor"/>',
  shuffle: '<path d="M17 3l4 4-4 4V8h-2.6l-3 3.6-1.3-1.6L13.5 6H17V3Zm0 10 4 4-4 4v-3h-3.5l-8-9.6H3V6h3.4l8 9.6H17V13ZM3 16h2.5l2.6-3.1 1.3 1.6L6.4 18H3v-2Z" fill="currentColor"/>',
  next: '<path d="M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z" fill="currentColor"/>',
};
const icon = (name, cls) => svg("0 0 24 24", ICON[name] || "", cls || "pl-ic");

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/* ---------- thin wrappers around the core (each one tolerates a missing piece) ---------- */
const S = () => api?.S || {};
const settings = () => api?.settings || {};
const D = () => api?.data || {};
function say(text, opts) { try { return api?.voice?.say?.(text, opts) || Promise.resolve(false); } catch { return Promise.resolve(false); } }
function chime(kind) { try { api?.voice?.chime?.(kind); } catch { /* no audio */ } }
function unlock() { try { api?.voice?.unlock?.(); } catch { /* no audio */ } }
function toast(t) { try { api?.ui?.toast?.(t); } catch { /* no toast */ } }
function buzz(pattern) { try { navigator.vibrate?.(pattern); } catch { /* no vibration (iOS) */ } }
const canSpeak = () => api?.voice?.available !== false;
function openPlace(p) { try { if (p) api?.ui?.placeSheet?.(p); } catch (e) { console.error("[play] placeSheet", e); } }
function store(key, fallback) { try { return api?.store ? api.store.get(key, fallback) : fallback; } catch { return fallback; } }
function save(key, value) { try { api?.store?.set?.(key, value); } catch { /* storage full or blocked */ } }
function aheadOf(m, dir, x) {
  try { if (D().aheadOf) return D().aheadOf(m, dir, x); } catch { /* fall through */ }
  return dir === "S" ? m - x : x - m;
}
function placeById(id) {
  if (typeof id !== "string") return null;
  try { if (D().placeById) return D().placeById(id) || null; } catch { /* fall through */ }
  return (Array.isArray(D().PLACES) ? D().PLACES : []).find(p => p && p.id === id) || null;
}
function sideOf(p) {
  try { return D().sideWord?.(p, S().dir) || ""; } catch { return ""; }
}
function regionName(m) {
  try { const r = D().regionAt?.(m); if (r && r.name) return r.name; } catch { /* no regions */ }
  try { const s = D().stateAt?.(m); if (s && s.name) return s.name; } catch { /* no states */ }
  return "";
}
/** "mile 309" in California, "OR mile 55" in a state that restarts the count (as on the Drive screen). */
function mileLabel(m) {
  if (m == null || !isFinite(m)) return "";
  try { const lm = D().localMile?.(m); if (lm) return `${lm.st && lm.st !== "CA" ? lm.st + " " : ""}mile ${Math.round(lm.mi)}`; } catch { /* below */ }
  return `mile ${Math.round(m)}`;
}
function seasonNow() {
  try { return D().seasonOf ? D().seasonOf(new Date()) : null; } catch { return null; }
}
const driving = () => S().mode === "gps" || S().mode === "demo";
/** Corridor mile where the road ends (the Oregon line on the California-only road); Infinity without road data. */
function roadEnd() {
  const st = Array.isArray(D().STATES) ? D().STATES : [];
  return num(D().MAX_M, num(st.length && st[st.length - 1] ? st[st.length - 1].to : NaN, Infinity));
}
/** A position on this road. (A mile saved when the app covered more of I-5, say 1300 in Washington, is none.) */
const hasPos = () => S().m != null && isFinite(S().m) && S().m >= -1 && S().m <= roadEnd() + 1;

/* ---------- speech: the games never trample the guide ----------
   voice.say({now: true}) cuts what is speaking and drops ordinary waiting lines such as landmark announcements
   (urgent prio >= 2 items like chain-control or severe-weather warnings survive and are re-queued). So a game line
   only interrupts our own speech, or silence. When anything else is speaking or waiting, it queues at prio 2: after the
   current item and any warnings already waiting, ahead of ordinary narration (prio 1). Every line carries a stable
   "play:" id (listen.js looks for that prefix) and, where it can go stale, a check(). */
const ours = id => String(id ?? "").startsWith("play:");
function voiceBusy() {
  try {
    const v = api?.voice;
    if (!v) return false;
    if (v.isSpeaking?.() && !ours(v.currentId?.())) return true;
    const q = v.queued?.();
    return Array.isArray(q) && q.some(id => !ours(id));
  } catch { return true; }
}
let sayGen = 0;
let settle = null;   // while one of our interrupted lines winds down inside voice.js
function gameSay(text, id, extra = {}) {
  const gen = ++sayGen;
  const speak = () => (gen !== sayGen ? false   // a newer game line took over
    : say(text, voiceBusy() ? { ...extra, id, prio: 2 } : { ...extra, id, now: true }));
  if (voiceBusy()) return say(text, { ...extra, id, prio: 2 });
  if (settle) return settle.then(speak);
  let playing = false;
  try { playing = !!api?.voice?.isSpeaking?.(); } catch { /* no voice */ }
  if (!playing) return Promise.resolve(speak());   // nothing playing: nothing to cut (drops only our own queued line)
  // One of our own lines is playing. voice.js finishes an interrupted item late (when the engine reports
  // "interrupted", which can come after the next item started) and then clears its `current`, losing track of what
  // is speaking. So stop ours, wait for that late finish (or half a second: iOS may never report it), then speak.
  settle = new Promise(resolve => {
    let done = false, off = null;
    const go = () => {
      if (done) return;
      done = true;
      try { off && off(); } catch { /* bus gone */ }
      setTimeout(() => { settle = null; resolve(); }, 30);
    };
    // listen first: voice.js may report the stop synchronously
    try { off = api.bus?.on?.("speaking", s => { if (!s) go(); }) || null; } catch { off = null; }
    try { api.voice.stop(); } catch { /* nothing to stop */ }
    setTimeout(go, 500);
  });
  return settle.then(speak);
}

/* Screen-reader announcements. One polite status line on Drive (inside #spotCard) and one on the Play view;
   whichever is on screen speaks. Cards themselves are not live regions (their distance ticks every GPS fix). */
const sr = { drive: null, view: null, pending: [], timer: 0 };
function announce(msg) {
  if (!msg) return;
  sr.pending.push(msg);
  clearTimeout(sr.timer);
  for (const el of [sr.drive, sr.view]) if (el) el.textContent = "";
  sr.timer = setTimeout(() => {
    const text = sr.pending.join(" ");
    sr.pending = [];
    for (const el of [sr.drive, sr.view]) if (el) el.textContent = text;
  }, 120);
}

/* ---------- road bingo: square pools ----------
   "emoji|label", "emoji|label|seasons" or "emoji|label|seasons|tags". seasons: comma list of winter, spring,
   summer, fall. tags: squares that share a tag are one sighting (a crop duster IS an airplane), so a card never
   gets two of them. A general square carries the tags of the specific ones it covers ("Snow-capped peak" vs
   "Mount Hood"). Labels stay short so they fit a 60px square on a 360px phone; "~" marks where a long word may
   break (a soft hyphen). Emoji are Unicode 9 or older so Android 8 and up draws all of them. */
const POOLS = {
  general: [
    "🚐|RV", "🚘|Out-of-state plate", "🚓|Highway patrol", "🚻|Rest area", "🌉|Bridge over a river||bridge", "🐴|Horse",
    "🏍️|Motor~cycle", "🚛|Big rig, 3 trailers", "🚌|School bus", "🐕|Dog in a car", "🚒|Fire truck", "🚲|Bikes on a car",
    "🚤|Boat on a trailer", "🦅|Hawk on a post", "🚂|Freight train||freight", "🏚️|Old barn", "💧|Water tower",
    "🌲|Fake-tree cell tower", "🇺🇸|Giant flag", "📦|Roof box on a car", "🚧|Orange cones", "🚕|Yellow car",
    "💜|Purple car", "🚗|Car towing a car", "⚡|EV charger sign", "🔟|Milepost ending in 0", "🌈|Rainbow",
    "🦌|Deer crossing sign", "⛽|Gas price sign", "🍔|Burger sign", "🚁|Heli~copter", "🏞️|Lake||lake", "🏎️|Sports car",
    "🚚|Moving truck", "✈️|Airplane||plane", "🐦|Birds on a wire", "🚙|Pickup with hay", "🚨|Car pulled over",
  ],
  socal: [
    "🌴|Palm trees", "🏄|Surf~board on a car", "🛣️|Sign with 4+ exits", "🔷|Carpool lane", "🌊|Ocean view",
    "🚆|Commuter train", "🛬|Plane landing||plane", "🌮|Taco shop", "🎢|Roller coaster", "🏟️|Stadium",
    "🏗️|Con~struction crane", "🎨|Mural", "😎|Con~vertible", "🚦|Stop-and-go traffic", "🛍️|Outlet mall",
    "🌺|Flower~ing vines", "🚢|Big ship||ship", "🌵|Cactus", "🍊|Orange tree", "🍃|Ivy on a sound wall", "🚗|Lowrider",
  ],
  westside: [
    "🛢️|Oil pumpjack", "🌳|Almond orchard", "🐂|Cattle||cattle", "🌊|Aqueduct", "🍅|Tomato truck",
    "🛩️|Crop duster||plane", "🌪️|Dust devil", "🌾|Hay bales", "🐝|Bee boxes", "🥜|Pista~chio trees", "☁️|Cotton field",
    "🍇|Vineyard", "💦|Sprin~klers on", "🚰|Farm water sign", "🚜|Tractor", "🍑|Fruit stand", "🌬️|Wind turbines",
    "🐑|Sheep", "🌿|Tumble~weed", "👃|Smelly feedlot||cattle", "🚚|Garlic truck", "🏜️|Bare brown hills", "☀️|Road mirage",
  ],
  delta: [
    "⛵|Sailboat", "🌉|Draw~bridge||bridge", "🏛️|Capitol dome", "🌽|Corn field", "🍐|Pear orchard", "🍇|Vineyard",
    "🦆|Ducks on water||duck", "🛶|Kayak", "🚢|Cargo ship||ship", "🌾|Levee road", "🌻|Sun~flowers|summer",
    "🐄|Dairy cows||cattle", "🍒|Cherry orchard", "🛫|Jet taking off||plane", "🌳|Giant oak tree", "🎣|Someone fishing",
    "🚂|Train bridge||bridge", "🕊️|Swan",
  ],
  valley: [
    "🌾|Rice field||rice", "🌻|Sun~flowers|summer", "🌰|Walnut orchard", "🕊️|White egret", "🌿|Olive trees", "🦆|Ducks||duck",
    "🍑|Peach orchard", "🌸|Prune orchard", "⛰️|Sutter Buttes", "💧|Flooded field||rice", "🛩️|Crop duster||plane",
    "🏔️|Snowy peak far off||peak,hood,rainier,baker", "🐄|Dairy cows||cattle", "🍯|Honey sign", "🌳|Almond orchard",
    "🍉|Melon stand", "🦅|Bald eagle", "🐐|Goats", "🚜|Tractor",
  ],
  shasta: [
    "🏔️|Snow-capped peak||peak,hood,rainier,baker", "🚛|Log truck", "🚂|Train in the canyon||freight", "⛓️|Chain-up area",
    "🌲|Pine forest||conifer", "🌉|Tall bridge||bridge", "🛥️|House~boat||lake", "💦|Water~fall", "🦌|Deer",
    "🚧|Runaway truck ramp", "🛑|Brake check area", "🌊|River rapids", "⛰️|Rocky spires", "🔥|Burned trees",
    "❄️|Snow on the ground|winter,spring", "⛺|Camp~ground sign", "📈|Ele~vation sign", "🦅|Osprey nest", "🌫️|Fog in the trees",
  ],
  oregon: [
    "🌲|Douglas fir||conifer", "🌉|Covered bridge sign", "🌰|Hazelnut orchard", "🌾|Grass seed field",
    "🎄|Christ~mas tree farm", "🛶|River rafters", "🍇|Vineyard", "🐑|Sheep", "🌧️|Rain", "🏈|Beaver logo",
    "🦆|Duck logo", "⛽|Gas at~tendant", "🚛|Log truck", "🏔️|Mount Hood||hood", "🍓|Marion~berry sign",
    "🔵|Blue~berry farm", "🏭|Lumber mill", "🐄|Dairy cows||cattle", "🍺|Brewery sign", "🌿|Hops on poles",
    "🦌|Elk crossing sign", "🐟|Salmon sign",
  ],
  washington: [
    "⛴️|Ferry sign", "🏔️|Mount Rainier||rainier", "🌲|Ever~green trees||conifer", "🌷|Tulip field|spring", "🌧️|Rain",
    "☕|Coffee stand", "🦅|Bald eagle", "🏙️|Space Needle", "🏗️|Port cranes", "🚇|Light rail train",
    "🌉|Double-deck bridge||bridge", "🍁|BC license plate", "🕊️|Snow geese|fall,winter", "✈️|Big jet overhead||plane",
    "🔵|Blue~berry farm", "🐄|Dairy cows||cattle", "🍎|Apple stand", "🌿|Mossy trees", "🐟|Salmon sign",
    "🌊|Puget Sound view", "🏔️|Mount Baker||baker", "🏟️|Stadium",
  ],
};
const AREA_OF_REGION = {
  sd: "socal", la: "socal", ws: "westside", dc: "delta", sv: "valley", sh: "shasta",
  rv: "oregon", um: "oregon", wv: "oregon", sw: "washington", ps: "washington", ns: "washington",
};
const AREA_NAME = {
  socal: "SoCal city", westside: "Westside farm country", delta: "Delta & Capital", valley: "Sacramento Valley",
  shasta: "Shasta mountains", oregon: "Oregon", washington: "Washington", mix: "Whole road mix",
};
const AREA_IN = {
  socal: "Southern California", westside: "Westside farm country", delta: "the Delta", valley: "the Sacramento Valley",
  shasta: "the Shasta mountains", oregon: "Oregon", washington: "Washington",
};
const AREA_ORDER = ["socal", "westside", "delta", "valley", "shasta", "oregon", "washington"];
const AREA_STATE = { socal: "CA", westside: "CA", delta: "CA", valley: "CA", shasta: "CA", oregon: "OR", washington: "WA" };
/** The bingo areas on this road, in road order: those whose passport regions are in the data (the California-only
    road has no Oregon or Washington squares; set tools/build.py back to the whole road and they come back).
    Without regions, the states in the data decide; with no road data at all, every area. */
let areaList = null;
function areas() {
  if (areaList) return areaList;
  let list = [];
  try {
    const R = Array.isArray(D().REGIONS) ? D().REGIONS : [];
    list = AREA_ORDER.filter(a => R.some(r => r && AREA_OF_REGION[r.id] === a));
    if (!list.length) {
      const sts = (Array.isArray(D().STATES) ? D().STATES : []).map(s => s && s.id);
      list = AREA_ORDER.filter(a => sts.includes(AREA_STATE[a]));
    }
  } catch { list = []; }
  return (areaList = list.length ? list : AREA_ORDER.slice());
}
/** The squares (labels as stored on a card) that fit this road: the general pool and the areas on it. */
function homeSquares() {
  return new Set(["general", ...areas()].flatMap(a => POOLS[a] || []).map(s => parseSquare(s).t));
}

function parseSquare(s) {
  const [e, t, when, tags] = String(s).split("|");
  return {
    e: e || "", t: (t || e || "").replace(/~/g, "\u00AD"),
    when: when ? when.split(",") : null,
    g: tags ? tags.split(",").map(x => x.trim()).filter(Boolean) : [],
  };
}
/** Which bingo area a corridor mile belongs to (null when unknown). */
function areaAt(m) {
  if (m == null || !isFinite(m)) return null;
  try { const r = D().regionAt?.(m); if (r && AREA_OF_REGION[r.id]) return AREA_OF_REGION[r.id]; } catch { /* below */ }
  let st = null;
  try { st = D().stateAt?.(m)?.id || null; } catch { /* below */ }
  if (st === "OR") return "oregon";
  if (st === "WA") return "washington";
  if (st === "CA") return m < 215 ? "socal" : m < 460 ? "westside" : m < 560 ? "delta" : m < 665 ? "valley" : "shasta";
  return null;
}

/* ---------- road bingo: the card ---------- */
const CENTER = 12;
const LINES = (() => {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
  L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return L;
})();
const lineName = i => (i < 5 ? `Row ${i + 1}` : i < 10 ? `${"BINGO"[i - 5]} column` : "Diagonal");

let card = null;
let B = null;          // bingo DOM refs
let winEl = null, winTimer = 0;

function validCard(c) {
  return !!c && c.v === 2 && Array.isArray(c.cells) && c.cells.length === 25 && Array.isArray(c.on) && c.on.length === 25 &&
    c.cells.every(x => x && typeof x.t === "string") && Array.isArray(c.won);
}

/** 24 unique squares: mostly from the area you're in, a few from the area the road takes you next, the rest
    from the general pool. With no position, a mix from the whole road. Never two squares for one sighting. */
function dealCard() {
  const m = hasPos() ? S().m : null, dir = S().dir === "S" ? "S" : "N";
  const season = seasonNow();
  const fits = sq => !sq.when || !season || sq.when.includes(season);
  const pool = name => shuffle((POOLS[name] || []).map(parseSquare).filter(fits));
  const area = m != null ? areaAt(m) : null;
  const picks = [], seen = new Set(), used = new Set();
  const take = (list, n) => {
    for (const sq of list) {
      if (n <= 0) break;
      if (!sq.t || seen.has(sq.t) || sq.g.some(x => used.has(x))) continue;
      seen.add(sq.t);
      for (const x of sq.g) used.add(x);
      picks.push(sq); n--;
    }
  };
  if (area) {
    take(pool(area), 14);
    const ahead = areaAt(Math.max(0, Math.min(roadEnd(), m + (dir === "S" ? -45 : 45))));   // (never past the end of the road)
    if (ahead && ahead !== area) take(pool(ahead), 3);
  } else {
    for (const a of shuffle(areas().slice())) take(pool(a), 2);
  }
  take(pool("general"), 24 - picks.length);
  for (const a of areas()) if (picks.length < 24) take(pool(a), 24 - picks.length);
  const cells = shuffle(picks.slice(0, 24)).map(sq => ({ e: sq.e, t: sq.t }));
  cells.splice(CENTER, 0, { free: true, e: "", t: "Free" });
  return {
    v: 2, area: area || "mix", m: m != null ? Math.round(m * 10) / 10 : null, at: Date.now(),
    cells, on: cells.map((_, i) => i === CENTER), won: [], full: false,
  };
}
function loadCard() {
  const c = store("bingo", null);
  if (validCard(c) && cardFits(c)) {
    card = c; card.on[CENTER] = true;
    if (tidyCard(card)) save("bingo", card);
    return;
  }
  // nothing saved yet, a card from the old version of the app, or one dealt for a stretch this road doesn't cover
  card = dealCard();
  save("bingo", card);
}
/** A saved card dealt for an area on this road (or a whole-road mix). One dealt in Oregon when the app covered it is not. */
const cardFits = c => (c.area === "mix" || areas().includes(c.area)) && (c.m == null || (isFinite(c.m) && c.m <= roadEnd() + 1));
/** Swap the unmarked squares that only belong to areas this road doesn't reach (a card saved when the app covered
    Oregon and Washington: Mount Hood on a card dealt near the Oregon line, the Space Needle in a whole-road mix) for
    squares from here. Marked squares stay: somebody saw that. True if the card changed. */
function tidyCard(c) {
  const home = homeSquares();
  const odd = c.cells.map((x, i) => (i !== CENTER && !c.on[i] && !home.has(x.t) ? i : -1)).filter(i => i >= 0);
  if (!odd.length) return false;
  const tagsOf = new Map();   // label -> the sighting tags it carries, from every pool
  for (const s of Object.values(POOLS).flat()) { const sq = parseSquare(s); if (sq.g.length) tagsOf.set(sq.t, sq.g); }
  const seen = new Set(), used = new Set();
  c.cells.forEach((x, i) => { if (odd.includes(i)) return; seen.add(x.t); for (const g of tagsOf.get(x.t) || []) used.add(g); });
  const season = seasonNow();
  const deal = name => shuffle((POOLS[name] || []).map(parseSquare).filter(sq => !sq.when || !season || sq.when.includes(season)));
  const cand = [...(areas().includes(c.area) ? deal(c.area) : []), ...deal("general"), ...shuffle(areas().slice()).flatMap(deal)];
  let changed = false;
  for (const i of odd) {
    const sq = cand.find(s => s.t && !seen.has(s.t) && !s.g.some(g => used.has(g)));
    if (!sq) continue;
    c.cells[i] = { e: sq.e, t: sq.t };
    seen.add(sq.t);
    for (const g of sq.g) used.add(g);
    changed = true;
  }
  return changed;
}
const fullLines = () => LINES.map((l, i) => (l.every(k => card.on[k]) ? i : -1)).filter(i => i >= 0);
const marked = () => card.on.filter(Boolean).length - 1;

function toggleSquare(i) {
  if (!card || i === CENTER || !card.cells[i]) return;
  card.on[i] = !card.on[i];
  const fresh = fullLines().filter(l => !card.won.includes(l));
  if (fresh.length) card.won.push(...fresh);
  const blackout = card.on.every(Boolean) && !card.full;
  if (blackout) card.full = true;
  save("bingo", card);
  renderBingo(fresh);
  if (B) B.live.textContent = `${card.cells[i].t.replace(/\u00AD/g, "")} ${card.on[i] ? "marked" : "cleared"}. ${marked()} of 24.`;
  if (blackout) celebrate("full", fresh);
  else if (fresh.length) celebrate("bingo", fresh);
}

function newCard() {
  closeWin();
  card = dealCard();
  save("bingo", card);
  const refocus = !!B && B.confirm.contains(document.activeElement);
  if (B) B.confirm.hidden = true;
  renderBingo();
  if (refocus) B.newBtn.focus({ preventScroll: true });   // the confirm box is gone; don't drop focus on <body>
}
function askNewCard() {
  if (!card || marked() === 0) return newCard();
  B.confirm.hidden = false;
  const keep = B.confirm.querySelectorAll("button")[1];   // focus the safe choice
  keep && keep.focus({ preventScroll: true });
  try { B.confirm.scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }   // the banner asks from above the card
}

function buildBingo(pane) {
  const meta = h("div", { class: "pl-bmeta" });
  const banner = h("div", { class: "pl-banner", hidden: true });
  const grid = h("div", { class: "pl-grid", role: "group", "aria-label": "Bingo card" });
  grid.addEventListener("click", safe(e => {
    const b = e.target.closest("button[data-i]");
    if (b) toggleSquare(+b.dataset.i);
  }, "bingo tap"));
  const head = h("div", { class: "pl-bhead", "aria-hidden": "true" }, [..."BINGO"].map(ch => h("span", null, ch)));
  const confirm = h("div", { class: "pl-confirm", hidden: true, role: "group", "aria-label": "Start a new card?" },
    h("p", null, "Start over with a new card? This one goes away."),
    h("div", { class: "pl-row" },
      h("button", { class: "primary", type: "button", onclick: safe(newCard, "new card") }, "New card"),
      h("button", { class: "secondary", type: "button", onclick: () => { confirm.hidden = true; B.newBtn.focus({ preventScroll: true }); } }, "Keep this one")));
  const newBtn = h("button", { class: "secondary pl-new", type: "button", onclick: safe(askNewCard, "new card") }, icon("shuffle"), "New card");
  pane.append(meta, banner, h("div", { class: "pl-card" }, head, grid), confirm,
    h("div", { class: "pl-bfoot" }, h("p", { class: "pl-how" }, "Tap a square when someone in the car spots it. Five in a row, down a column or corner to corner is a bingo."), newBtn));
  const live = h("p", { class: "pl-sr", role: "status" });
  pane.append(live);
  B = { pane, meta, banner, grid, newBtn, confirm, live };
}

function renderBingo(fresh = []) {
  if (!B) return;
  if (!card) loadCard();
  const grid = B.grid;
  if (grid.dataset.card !== String(card.at)) {
    grid.dataset.card = String(card.at);
    grid.textContent = "";
    card.cells.forEach((c, i) => {
      if (c.free) {
        grid.append(h("div", { class: "pl-sq pl-free", role: "img", "aria-label": "Free space" },
          shield("pl-free-shield"), h("span", { class: "pl-sq-t" }, "FREE")));
      } else {
        grid.append(h("button", { class: "pl-sq", type: "button", "data-i": i, "aria-pressed": "false" },
          h("span", { class: "pl-sq-e", "aria-hidden": "true" }, c.e), h("span", { class: "pl-sq-t" }, c.t)));
      }
    });
  }
  const lines = fullLines();
  const inLine = new Set(lines.flatMap(i => LINES[i]));
  const freshSet = new Set(fresh.flatMap(i => LINES[i]));
  [...grid.children].forEach((sq, i) => {
    const on = !!card.on[i];
    if (sq.tagName === "BUTTON") sq.setAttribute("aria-pressed", String(on));
    sq.classList.toggle("on", on);
    sq.classList.toggle("win", inLine.has(i));
    sq.classList.remove("fresh");
    if (freshSet.has(i)) { void sq.offsetWidth; sq.classList.add("fresh"); }
  });
  // meta line: which card, progress
  const n = marked(), bingos = lines.length;
  B.meta.textContent = "";
  B.meta.append(
    h("div", { class: "pl-area" }, h("b", null, AREA_NAME[card.area] || "Road bingo"),
      h("small", null, card.m != null ? `Dealt near ${mileLabel(card.m)}` : "Dealt before the trip")),
    h("div", { class: "pl-prog" },
      h("span", null, h("b", null, n), "/24"),
      h("span", { class: bingos ? "pl-hot" : "" }, h("b", null, bingos), bingos === 1 ? " bingo" : " bingos")));
  renderBanner();
}

/** Offer a fresh card when you have driven into a different area than the card was dealt for. */
function renderBanner() {
  if (!B || !card) return;
  const here = hasPos() ? areaAt(S().m) : null;
  const show = !!here && here !== card.area;
  const key = show ? here : "";
  if (B.banner.dataset.key === key) return;
  B.banner.dataset.key = key;
  B.banner.hidden = !show;
  B.banner.textContent = "";
  if (!show) return;
  B.banner.append(h("span", null, `You're in ${AREA_IN[here] || AREA_NAME[here]} now.`),
    h("button", { class: "link", type: "button", onclick: safe(askNewCard, "new card") }, "Deal a card for it"));
}

function closeWin() {
  clearTimeout(winTimer);
  if (winEl) { winEl.remove(); winEl = null; }
}
/** The big moment: a highway-sign BINGO over the screen, confetti, a chime and (if narration is on) one word. */
function celebrate(kind, fresh) {
  closeWin();
  const host = document.getElementById("view-play");
  if (!host) return;
  const full = kind === "full";
  const title = full ? "FULL CARD!" : "BINGO!";
  const sub = full ? "Every square on the card" : (fresh.length ? fresh.map(lineName).join(" and ") : "Five in a row");
  const conf = h("div", { class: "pl-confetti", "aria-hidden": "true" });
  const colors = ["accent", "farm", "hist", "nature", "stop", "odd", "ok", "st-wa"];
  for (let i = 0; i < 44; i++) {
    const r = () => Math.random();
    conf.append(h("i", { style: `--x:${(r() * 100).toFixed(1)}%;--dx:${((r() - 0.5) * 40).toFixed(1)}vw;--d:${(r() * 0.6).toFixed(2)}s;` +
      `--t:${(1.7 + r() * 1.3).toFixed(2)}s;--r:${Math.round(r() * 900 - 450)}deg;--c:var(--${colors[i % colors.length]});--w:${6 + Math.round(r() * 6)}px` }));
  }
  winEl = h("div", { class: "pl-win" + (full ? " full" : ""), role: "alert", onclick: closeWin },
    conf,
    h("div", { class: "pl-win-sign" },
      h("div", { class: "pl-win-top" }, shield("pl-win-shield"),
        h("span", null, full ? "ROAD BINGO" : `ROAD BINGO · ${card.won.length === 1 ? "FIRST LINE" : `LINE ${card.won.length}`}`)),
      h("b", { class: "pl-win-t" }, title),
      h("span", { class: "pl-win-s" }, sub)));
  host.append(winEl);
  winTimer = setTimeout(closeWin, full ? 3600 : 2800);
  unlock();
  chime("success");
  buzz(full ? [60, 50, 60, 50, 160] : [40, 50, 120]);
  if (settings().narr) {
    // After the chime. If the guide is talking it waits its turn, and gives up if that takes more than a few seconds.
    const t0 = Date.now();
    setTimeout(safe(() => gameSay(full ? "Full card!" : "Bingo!", "play:bingo", { check: () => Date.now() - t0 < 5000 }), "bingo say"), 600);
  }
}

/* ---------- trivia ---------- */
let T = null;                       // trivia DOM refs
const askedThisSession = new Set(); // question texts already shown this session
let cur = null;                     // {t, id, at, mode, picked, spoken, listening, related, lap}
let tscore = { right: 0, asked: 0, best: 0 };
let streak = 0;

function loadScore() {
  const s = store("trivia", null) || {};
  tscore = { right: Math.max(0, num(s.right)), asked: Math.max(0, num(s.asked)), best: Math.max(0, num(s.best)) };
  if (tscore.right > tscore.asked) tscore.asked = tscore.right;
}
const validQ = t => !!t && typeof t.q === "string" && !!t.q.trim() && Array.isArray(t.choices) &&
  t.choices.length >= 2 && t.choices.length <= LETTERS.length && Number.isInteger(t.answer) && t.answer >= 0 && t.answer < t.choices.length;
const allQs = () => (Array.isArray(D().TRIVIA) ? D().TRIVIA : []).filter(validQ);

const STOP = new Set(("the and that this with from what which when where were was who why how did does into than then about after " +
  "before over under near your they their there here have has had been many much more most some such only also just like made " +
  "make called name named first long high still year years feet miles mile today town city river road").split(" "));
const fold = s => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function words(s) {
  return new Set((fold(s).match(/[a-z]{4,}/g) || []).filter(w => !STOP.has(w)));
}
/** The landmark a question was written about: nearby, sharing the most words with the question and answer. */
function relatedPlace(t) {
  const P = D().PLACES;
  if (!Array.isArray(P) || !isFinite(t.m)) return null;
  const qw = words(`${t.q} ${t.why || ""} ${t.choices[t.answer] || ""}`);
  let best = null, bestScore = 0;
  for (const p of P) {
    if (!p || !isFinite(p.m) || Math.abs(p.m - t.m) > 4) continue;
    const pw = words(`${p.name} ${p.text || ""} ${p.more || ""}`);
    let s = 0;
    for (const w of qw) if (pw.has(w)) s++;
    for (const w of words(p.name)) if (qw.has(w)) s += 2;
    s -= Math.abs(p.m - t.m) * 0.3;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return bestScore >= 2 ? best : null;
}
const isUrl = u => typeof u === "string" && /^https?:\/\//i.test(u);
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } }
/** A stable id for a question's speech: its index in TRIVIA (or a hash of its text). */
function qid(t) {
  const i = Array.isArray(D().TRIVIA) ? D().TRIVIA.indexOf(t) : -1;
  if (i >= 0) return String(i);
  let x = 0;
  for (const ch of String(t.q)) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return "h" + (x >>> 0).toString(36);
}

/** Next question: closest to you (ahead of you first while driving), never one already asked this session. */
function pickQuestion() {
  const all = allQs();
  if (!all.length) { cur = null; return null; }
  let list = all.filter(t => !askedThisSession.has(t.q));
  let lap = false;
  if (!list.length) { askedThisSession.clear(); list = all.slice(); lap = true; }
  if (cur && list.length > 1) list = list.filter(t => t.q !== cur.t.q);
  let t;
  if (hasPos()) {
    const m = S().m, dir = S().dir;
    const score = q => {
      const qm = num(q.m, NaN);
      if (!isFinite(qm)) return 1e6;
      if (!driving()) return Math.abs(qm - m);
      const d = aheadOf(m, dir, qm);
      return d >= -1 ? Math.max(0, d) : 400 + Math.abs(d);   // behind you only once nothing is left ahead
    };
    t = list.slice().sort((a, b) => score(a) - score(b))[0];
  } else {
    t = list[Math.floor(Math.random() * list.length)];
  }
  askedThisSession.add(t.q);
  cur = { t, id: qid(t), at: hasPos() ? S().m : null, mode: S().mode, picked: null, spoken: false, listening: false, related: relatedPlace(t), lap };
  return cur;
}
/** An unanswered question that belongs somewhere else: picked (or last read aloud) more than 15 miles from here,
    or before we knew where you are; or, if nobody has heard it yet, about a place already 5 miles behind you. */
function stale(c) {
  if (!c || c.picked != null || c.listening || !hasPos()) return false;
  if (c.at == null || Math.abs(S().m - c.at) > 15) return true;
  return !c.spoken && driving() && isFinite(c.t.m) && aheadOf(S().m, S().dir, c.t.m) < -5;
}
/** Swap a stale question for the closest one. The stale one goes back in the pile. True if it changed. */
function freshen() {
  if (!stale(cur)) return false;
  askedThisSession.delete(cur.t.q);
  cur = null;
  pickQuestion();
  return true;
}

const choiceText = c => String(c == null ? "" : c).trim().replace(/[.?!:;,]+$/, "");
function questionSpeech(t) {
  return `${t.q} ${t.choices.map((c, i) => `${LETTERS[i]}: ${choiceText(c)}.`).join(" ")}`;
}
function verdict(ok, t) {
  return ok ? "That's right." : `Not quite. The answer is ${LETTERS[t.answer]}: ${choiceText(t.choices[t.answer])}.`;
}
/** Read the question on screen. tap = the passenger pressed the button (say so if it has to wait for the guide). */
function readQuestion(tap = false) {
  const q = cur;
  if (!q) return;
  unlock();
  q.spoken = true;
  if (hasPos()) q.at = S().m;   // heard here: it stays the question for the next 15 miles
  const wait = voiceBusy();
  gameSay(questionSpeech(q.t), "play:trivia:q:" + q.id, { check: () => cur === q && q.picked == null });
  if (wait && tap) toast("I'll read it right after this.");
}

function answerTrivia(i, how = "tap") {
  if (!cur || cur.picked != null) return false;
  const q = cur, t = q.t;
  if (!Number.isInteger(i) || i < 0 || i >= t.choices.length) return false;
  q.picked = i;
  q.listening = false;
  const ok = i === t.answer;
  tscore.asked++;
  if (ok) { tscore.right++; streak++; tscore.best = Math.max(tscore.best, streak); } else streak = 0;
  save("trivia", tscore);
  renderTrivia(true);
  if (q.spoken || how === "voice") {
    unlock();
    gameSay(`${verdict(ok, t)} ${t.why || ""}`.trim(), "play:trivia:a:" + q.id, { chime: ok ? "success" : false, check: () => cur === q });
  } else if (ok) {
    chime("success");
  }
  return ok;
}
function nextTrivia() {
  const wasSpoken = !!cur?.spoken;
  pickQuestion();
  renderTrivia();
  if (cur && wasSpoken) readQuestion();
  if (!T) return;
  // the new question is shorter than the answered one: bring its top back into view
  try { if (T.box.getBoundingClientRect().top < 72) (T.stats.hidden ? T.box : T.stats).scrollIntoView({ block: "start" }); } catch { /* old browsers */ }
  const h3 = T.box.querySelector(".pl-qt");
  h3 && h3.focus({ preventScroll: true });
}

/* Answer by voice, when the listen module offers it. Accepts an index, a letter, a number word or the answer text. */
const canListen = () => typeof api?.listen?.listenForAnswer === "function" && api.listen.supported !== false && !api.listen.blocked;
const SAID = [
  ["a", "ay", "eh", "alpha", "first", "one", "1"],
  ["b", "be", "bee", "bravo", "second", "two", "2"],
  ["c", "see", "sea", "si", "charlie", "third", "three", "3"],
  ["d", "dee", "delta", "fourth", "four", "4"],
  ["e", "echo", "fifth", "five", "5"],
  ["f", "foxtrot", "sixth", "six", "6"],
];
function parseAnswer(r, choices) {
  const n = choices.length;
  if (r == null) return null;
  if (typeof r === "number") return Number.isInteger(r) && r >= 0 && r < n ? r : null;
  if (typeof r === "object") {
    for (const k of ["index", "i", "answer", "choice"]) if (typeof r[k] === "number") return parseAnswer(r[k], choices);
    r = r.text ?? r.transcript ?? r.said ?? r.letter ?? "";
  }
  const clean = s => fold(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const s = clean(r);
  if (!s) return null;
  const opts = choices.map(clean);
  const exact = opts.findIndex(o => o && (s === o || ` ${s} `.includes(` ${o} `)));
  if (exact >= 0) return exact;
  const toks = s.split(" ");
  const letterAt = tok => { const i = SAID.findIndex(list => list.includes(tok)); return i >= 0 && i < n ? i : null; };
  if (toks.length <= 4) for (let k = toks.length - 1; k >= 0; k--) { const i = letterAt(toks[k]); if (i != null) return i; }
  const said = new Set(toks.filter(w => w.length >= 3));
  const hits = opts.map(o => o.split(" ").filter(w => w.length >= 3 && said.has(w)).length);
  const top = Math.max(...hits);
  if (top > 0 && hits.filter(x => x === top).length === 1) return hits.indexOf(top);
  for (let k = toks.length - 1; k >= 0; k--) { const i = letterAt(toks[k]); if (i != null) return i; }
  return null;
}
const BLOCKED = "The microphone is blocked. Tap an answer instead.";
async function voiceAnswer() {
  if (!cur || cur.picked != null || cur.listening) return;
  if (!canListen()) {   // the microphone was refused after this button was drawn
    if (api?.listen?.blocked) toast(BLOCKED);
    renderTrivia();
    return;
  }
  unlock();
  const q = cur;
  q.spoken = true;
  if (hasPos()) q.at = S().m;
  q.listening = true;
  renderTrivia();
  let res = null;
  try {
    res = await Promise.race([
      Promise.resolve(api.listen.listenForAnswer(q.t.choices.slice(), { letters: LETTERS.slice(0, q.t.choices.length), question: q.t.q })),
      new Promise(r => setTimeout(() => r(null), 15000)),
    ]);
  } catch { res = null; }
  if (cur !== q || q.picked != null) return;   // moved on while listening
  q.listening = false;
  const i = parseAnswer(res, q.t.choices);
  if (i == null) {
    renderTrivia();   // hides the voice button if the microphone is blocked now
    if (res == null && api?.listen?.blocked) toast(BLOCKED);
    // null = cancelled or not understood, and the listen module already said so; anything else we couldn't read
    else if (res != null) toast(`I didn't catch that. Say ${LETTERS.slice(0, q.t.choices.length).join(", ").replace(/, ([^,]*)$/, " or $1")}, or tap an answer.`);
    return;
  }
  answerTrivia(i, "voice");
}

function buildTrivia(pane) {
  const stats = h("div", { class: "pl-stats", "aria-label": "Trivia score" });
  const box = h("div", { class: "pl-q" });
  box.addEventListener("click", safe(e => {
    const b = e.target.closest("button[data-i]");
    if (b && !b.disabled) answerTrivia(+b.dataset.i);
  }, "trivia tap"));
  pane.append(stats, box);
  T = { pane, stats, box };
}

function renderTriviaStats() {
  const tile = (n, label, hot) => h("div", { class: "pl-stat" + (hot ? " hot" : "") }, h("b", null, n), h("span", null, label));
  const pct = tscore.asked ? Math.round(tscore.right / tscore.asked * 100) : null;
  T.stats.textContent = "";
  T.stats.append(
    tile(tscore.right, pct == null ? "right so far" : `right · ${pct}%`),
    tile(tscore.asked, "answered"),
    tile(streak, tscore.best > streak ? `in a row · best ${tscore.best}` : "in a row", streak >= 3));
}

function renderTrivia(justAnswered = false) {
  if (!T) return;
  renderTriviaStats();
  const box = T.box;
  box.textContent = "";
  if (!cur) pickQuestion();
  T.stats.hidden = !cur && !tscore.asked;
  if (!cur) {
    box.classList.add("pl-empty");
    box.append(h("p", { class: "pl-qt" }, "No trivia questions yet."),
      h("p", { class: "pl-why" }, "Questions about the road show up here as the guide grows. Bingo and I spy work anywhere."));
    return;
  }
  box.classList.remove("pl-empty");
  const t = cur.t, answered = cur.picked != null;
  // where the question is from
  let dist = "";
  if (isFinite(t.m)) {
    if (hasPos()) {
      const d = aheadOf(S().m, S().dir, t.m);
      dist = Math.abs(d) < 1 ? "Right around here" : d > 0 ? `${Math.round(d)} mi ahead` : `${Math.round(-d)} mi back`;
    } else dist = mileLabel(t.m);
  }
  const rn = isFinite(t.m) ? regionName(t.m) : "";
  box.append(h("div", { class: "pl-qmeta" },
    h("span", null, `Question ${askedThisSession.size} of ${allQs().length}`),
    h("span", { class: "pl-qwhere" }, [rn, dist].filter(Boolean).join(" · "))));
  if (cur.lap && !answered) box.append(h("p", { class: "pl-note" }, "You've seen every question this trip. Here they come again."));
  box.append(h("h3", { class: "pl-qt", tabindex: "-1" }, t.q));
  const opts = h("div", { class: "pl-opts", role: "group", "aria-label": "Answers" });
  t.choices.forEach((c, i) => {
    let state = "";
    if (answered) state = i === t.answer ? "right" : i === cur.picked ? "wrong" : "dim";
    const label = `${LETTERS[i]}. ${choiceText(c)}` + (state === "right" ? ", correct answer" : state === "wrong" ? ", your answer, wrong" : "");
    opts.append(h("button", { class: `pl-opt ${state}`, type: "button", "data-i": i, disabled: answered, "aria-label": label },
      h("span", { class: "pl-let", "aria-hidden": "true" }, LETTERS[i]),
      h("span", { class: "pl-opt-t", "aria-hidden": "true" }, choiceText(c)),
      state === "right" ? icon("check", "pl-ic pl-mark") : state === "wrong" ? icon("cross", "pl-ic pl-mark") : null));
  });
  box.append(opts);
  if (!answered) {
    const tools = h("div", { class: "pl-tools" },
      canSpeak() ? h("button", { class: "secondary pl-tool", type: "button", onclick: safe(() => readQuestion(true), "read") }, icon("speaker"), "Read it out loud") : null);
    if (canListen()) {
      tools.append(h("button", { class: "secondary pl-tool" + (cur.listening ? " pl-listening" : ""), type: "button", disabled: cur.listening,
        onclick: safe(voiceAnswer, "voice answer") }, icon("mic"), cur.listening ? "Listening…" : "Answer by voice"));
    }
    tools.append(h("button", { class: "link pl-skip", type: "button", onclick: safe(nextTrivia, "skip") }, "Skip"));
    box.append(tools);
    return;
  }
  const ok = cur.picked === t.answer;
  const fb = h("div", { class: "pl-fb " + (ok ? "ok" : "no"), role: "status" },
    h("div", { class: "pl-verdict", tabindex: "-1" }, icon(ok ? "check" : "cross", "pl-ic pl-vic"),
      h("b", null, ok ? (streak >= 3 ? `That's right. ${streak} in a row.` : "That's right.") : "Not quite.")),
    ok ? null : h("p", { class: "pl-ans" }, `The answer is ${LETTERS[t.answer]}: ${choiceText(t.choices[t.answer])}.`),
    t.why ? h("p", { class: "pl-why" }, t.why) : null);
  const src = isUrl(t.src) ? t.src : isUrl(cur.related?.src) ? cur.related.src : null;
  const links = h("p", { class: "pl-src" });
  if (src) links.append(h("span", null, "Source: ", h("a", { href: src, target: "_blank", rel: "noopener" }, hostOf(src))));
  if (cur.related) {
    const p = cur.related;
    links.append(h("button", { class: "link", type: "button", onclick: () => openPlace(p) }, `About ${p.name}`));
  }
  if (links.childNodes.length) fb.append(links);
  fb.append(h("button", { class: "primary pl-next", type: "button", onclick: safe(nextTrivia, "next") }, "Next question", icon("next")));
  box.append(fb);
  if (justAnswered) {
    const v = fb.querySelector(".pl-verdict");
    v && v.focus({ preventScroll: true });
    // bring the answer and the Next button into view (scroll-margin keeps them clear of the header and tab bar)
    try { fb.querySelector(".pl-next").scrollIntoView({ block: "nearest" }); } catch { /* old browsers */ }
  }
}

/** For voice commands and other modules: go to Play, open Trivia and read the next question aloud. */
function askTrivia() {
  try { api?.ui?.go?.("play"); } catch (e) { console.error("[play] go", e); }
  setGame("trivia");
  freshen();   // a question picked miles ago, or before GPS, gives way to the closest one
  if (!cur || cur.picked != null) pickQuestion();
  renderTrivia();
  if (cur) { readQuestion(); return true; }
  unlock();
  gameSay("I don't have any trivia questions yet.", "play:trivia:none");
  return false;
}

/* ---------- I spy ----------
   A card shows whenever the guide announces or speaks a landmark's I spy challenge (Kid mode), and, while driving,
   for every I spy landmark coming into view that the guide stays quiet about (narration off, or a category it
   skips). Several can be up at once: the one being spoken sits on top in full, earlier ones below in a compact
   form, each with its own buttons. A place pays 10 points once per trip, every trip. */
let spy = { points: 0, found: [], missed: [] };
let spots = [];               // cards on screen, top first: {p, state: "ask" | "found" | "missed", pts, timer}
const MAX_SPOTS = 3;
const trip = { shown: new Set(), answered: new Set(), scored: new Set() };   // place ids, this trip only
let movedAt = 0;              // when the cards last moved under someone's finger
let spotWrap = null;          // the cards' box inside #spotCard
let SP = null;                // I spy pane refs
let quick = null;             // {e, t, state, n}
let quickN = 0;
const quickRecent = [];

function loadSpy() {
  const s = store("spy", null) || {};
  const ids = a => (Array.isArray(a) ? [...new Set(a.filter(x => typeof x === "string"))] : []);
  spy = { points: Math.max(0, num(s.points)), found: ids(s.found), missed: ids(s.missed) };
  spy.missed = spy.missed.filter(id => !spy.found.includes(id));
}
const saveSpy = () => save("spy", spy);
const isSpot = p => !!p && typeof p.id === "string" && !!p.id && typeof p.spot === "string" && !!p.spot.trim() && !!p.vis;
/** Miles you've driven past a place (negative = still ahead). */
const behind = p => (hasPos() && isFinite(p.m) ? -aheadOf(S().m, S().dir, p.m) : 0);
function fmtMi(d) {
  try { if (D().fmtMiles && d >= 0.3) return D().fmtMiles(d); } catch { /* below */ }
  return d < 10 ? d.toFixed(1) : String(Math.round(d));
}
function spotWhere(p) {
  if (!hasPos() || !isFinite(p.m)) return "";
  const d = aheadOf(S().m, S().dir, p.m);
  const side = sideOf(p);
  const dist = d >= 0.3 ? `${fmtMi(d)} mi` : d > -0.3 ? "Now" : "Just passed";
  return [dist, side && (side === "left" ? "◀ left" : "right ▶")].filter(Boolean).join(" · ");
}

/** Put a card up for p (on top). Already up: nothing to do. */
function showSpot(p) {
  if (!settings().kid || !isSpot(p) || spots.some(s => s.p.id === p.id) || behind(p) > 1) return false;
  trip.shown.add(p.id);
  spots.unshift({ p, state: "ask", pts: 0, timer: 0 });
  while (spots.length > MAX_SPOTS) {   // too many: let the oldest go, answered ones first
    let k = spots.length - 1;
    for (let i = spots.length - 1; i > 0; i--) if (spots[i].state !== "ask") { k = i; break; }
    clearTimeout(spots[k].timer);
    spots.splice(k, 1);
  }
  renderSpots();
  const side = sideOf(p);
  announce(`I spy${side ? ` on your ${side}` : ""}: ${p.spot}`);
  return true;
}
/** The guide queued a landmark announcement (narrator.js adds the challenge to it in Kid mode). */
function onAnnounce(e) {
  if (e && e.place) showSpot(e.place);
}
/** Speech started. A challenge being read (the guide, a Play button, a voice command, a replay) gets its card on
    top, so the big card always matches what you hear. */
function onSpeaking(s) {
  if (!s || typeof s.id !== "string" || ours(s.id) || !settings().kid) return;
  const p = placeById(s.id);
  if (!isSpot(p) || !String(s.text || "").includes(p.spot)) return;
  const k = spots.findIndex(x => x.p.id === p.id);
  if (k > 0) { spots.unshift(spots.splice(k, 1)[0]); renderSpots(); }
  else if (k < 0 && !trip.answered.has(p.id)) showSpot(p);
}
/** While driving, find I spy landmarks coming into view ourselves: the guide stays quiet when narration is off,
    and about categories you turned off. Same heads-up distance as the guide. */
function scanSpots(e) {
  if (!settings().kid || !driving() || !hasPos() || S().offRoute) return;
  const P = D().PLACES;
  if (!Array.isArray(P) || !P.length) return;
  const m = S().m, dir = S().dir;
  const lead = Math.max(num(settings().lead, 2), num(S().speed) * 75 / 3600) + 0.01;
  const min = e && e.jumped ? 0 : -0.3;
  const due = [];
  for (const p of P) {
    if (!isSpot(p) || !isFinite(p.m) || trip.shown.has(p.id)) continue;
    const d = aheadOf(m, dir, p.m);
    if (d > min && d < lead) due.push({ p, d });
  }
  due.sort((a, b) => b.d - a.d);   // farthest first, so the nearest ends up on top
  for (const x of due) showSpot(x.p);
}
function removeSpot(id) {
  const k = spots.findIndex(s => s.p.id === id);
  if (k < 0) return;
  clearTimeout(spots[k].timer);
  spots.splice(k, 1);
  renderSpots();
}
function clearSpots() {
  if (!spots.length) return;
  for (const s of spots) clearTimeout(s.timer);
  spots = [];
  renderSpots();
}
function endTrip() {
  clearSpots();
  trip.shown.clear(); trip.answered.clear(); trip.scored.clear();
}
function onSpotPos(e) {
  scanSpots(e);
  if (!spots.length) return;
  // drove past it, or jumped far away from it
  const gone = s => s.state === "ask" && (behind(s.p) > 1 || (!!e?.jumped && behind(s.p) < -15));
  if (spots.some(gone)) {
    spots = spots.filter(s => { if (gone(s)) { clearTimeout(s.timer); return false; } return true; });
    renderSpots();
  } else updateSpotDistances();
}
function answerSpot(id, found) {
  const s = spots.find(x => x.p.id === id);
  if (!s || s.state !== "ask") return;
  const p = s.p;
  unlock();
  trip.answered.add(p.id);
  if (found) {
    if (!trip.scored.has(p.id)) { trip.scored.add(p.id); spy.points += 10; s.pts = 10; }
    if (!spy.found.includes(p.id)) spy.found.push(p.id);
    spy.missed = spy.missed.filter(x => x !== p.id);
    chime("success");
    buzz([30, 40, 60]);
  } else if (!spy.found.includes(p.id) && !spy.missed.includes(p.id)) {
    spy.missed.push(p.id);
  }
  saveSpy();
  s.state = found ? "found" : "missed";
  renderSpots();
  renderSpy();
  announce(found ? (s.pts ? `Found it. Plus ${s.pts}. ${spy.points} points.` : `Found it again. ${spy.points} points.`) : "Missed it. Next time.");
  clearTimeout(s.timer);
  s.timer = setTimeout(safe(() => removeSpot(p.id), "spot done"), found ? 2200 : 1300);
}

function spotCardEl(s, main) {
  const p = s.p, st = s.state;
  const name = String(p.name || "this place");
  // A tap that lands within a moment of the cards moving was aimed at something else (keyboard clicks have detail 0).
  const act = found => e => { if (e && e.detail > 0 && Date.now() - movedAt < 450) return; answerSpot(p.id, found); };
  const body = st === "ask"
    ? h("div", { class: "pl-spot-acts" },
      h("button", { class: "pl-found", type: "button", "aria-label": `Found it: ${name}`, onclick: safe(act(true), "found") }, icon("check"), "Found it"),
      h("button", { class: "pl-missed", type: "button", "aria-label": `Missed it: ${name}`, onclick: safe(act(false), "missed") }, "Missed it"))
    : h("div", { class: "pl-spot-done", tabindex: "-1" }, st === "found"
      ? [s.pts ? h("b", { class: "pl-plus" }, `+${s.pts}`) : icon("check", "pl-ic pl-again"),
        h("span", null, s.pts ? `Nice spotting. ${spy.points} points.` : `Found again. ${spy.points} points.`)]
      : h("span", null, "Next time. Keep your eyes peeled."));
  return h("section", { class: `pl-spot${main ? "" : " pl-mini"} ${p.cat || ""} ${st}`, "aria-label": `I spy: ${name}`, "data-id": p.id },
    main ? h("div", { class: "pl-spot-eye" }, icon("eye", "pl-eye")) : null,
    h("div", { class: "pl-spot-body" },
      h("div", { class: "pl-spot-k" }, h("span", null, "I spy"), h("span", { class: "pl-spot-d", "aria-hidden": "true" }, spotWhere(p))),
      h("p", { class: "pl-spot-q" }, p.spot),
      main ? h("button", { class: "pl-spot-name", type: "button", onclick: () => openPlace(p) }, name) : null),
    body);
}
/** Make a host's cards match `spots`, reusing the ones that didn't change (keeps focus and skips the animation). */
function syncSpots(host) {
  const old = new Map();
  for (const el of host.querySelectorAll(":scope > .pl-spot")) old.set(el.dataset.key, el);
  const had = new Set([...old.values()].map(el => el.dataset.id));
  const want = spots.map((s, i) => {
    const key = `${s.p.id}|${s.state}|${i ? "mini" : "main"}`;
    let el = old.get(key);
    if (el) old.delete(key);
    else {
      el = spotCardEl(s, i === 0);
      el.dataset.key = key;
      if (had.has(s.p.id)) el.classList.add("pl-still");   // the same card in a new form: no entrance
    }
    return el;
  });
  for (const el of old.values()) el.remove();
  let ref = null;
  for (let k = want.length - 1; k >= 0; k--) {
    const el = want[k];
    if (el.parentNode !== host || el.nextElementSibling !== ref) host.insertBefore(el, ref);
    ref = el;
  }
  host.hidden = !spots.length;
}
function spotHosts() { return [spotWrap, SP?.live].filter(Boolean); }
let spotOrder = "";
function renderSpots() {
  const hosts = spotHosts();
  const a = document.activeElement;
  const inCard = a && a.closest ? a.closest(".pl-spot") : null;
  const host = inCard ? hosts.find(x => x.contains(inCard)) : null;
  const id = inCard ? inCard.dataset.id : null;
  for (const x of hosts) syncSpots(x);
  // cards came, went or swapped places: buttons moved (an answer keeps its card the same height, so it doesn't count)
  const order = spots.map(s => s.p.id).join("|");
  if (order !== spotOrder) { spotOrder = order; movedAt = Date.now(); }
  updateSpotDistances();
  // the focused card was redrawn (answered) or went away: keep keyboard focus on this card, or the next one
  if (host && !host.contains(document.activeElement)) {
    const cards = [...host.querySelectorAll(":scope > .pl-spot")];
    const el = cards.find(c => c.dataset.id === id) || cards[0];
    const target = el && (el.querySelector(".pl-spot-done") || el.querySelector("button"));
    if (target) target.focus({ preventScroll: true });
  }
}
function updateSpotDistances() {
  for (const host of spotHosts()) {
    for (const el of host.querySelectorAll(":scope > .pl-spot")) {
      const s = spots.find(x => x.p.id === el.dataset.id);
      const d = el.querySelector(".pl-spot-d");
      if (!s || !d) continue;
      const t = spotWhere(s.p);
      if (d.textContent !== t) d.textContent = t;   // only when it changes: it updates on every GPS fix
    }
  }
}

/* Quick challenge: a classic "I spy" pulled from the bingo squares for where you are. Works with no data at all. */
function dealQuick() {
  const area = hasPos() ? areaAt(S().m) : null;
  const season = seasonNow();
  const fits = sq => !sq.when || !season || sq.when.includes(season);
  const from = [...(area ? POOLS[area] : []), ...POOLS.general, ...(area ? [] : areas().flatMap(a => POOLS[a]))]
    .map(parseSquare).filter(sq => fits(sq) && !quickRecent.includes(sq.t));
  const sq = from[Math.floor(Math.random() * from.length)] || parseSquare(POOLS.general[0]);
  quickRecent.push(sq.t);
  if (quickRecent.length > 12) quickRecent.shift();
  quick = { e: sq.e, t: sq.t, state: "ask", n: ++quickN };
}
function quickFound() {
  if (!quick || quick.state !== "ask") return;
  unlock();
  spy.points += 5;
  saveSpy();
  chime("success");
  buzz(30);
  quick.state = "found";
  renderSpy();
  announce(`Got it. Plus 5. ${spy.points} points.`);
  const q = quick;
  setTimeout(safe(() => { if (quick === q) { dealQuick(); renderSpy(); } }, "quick"), 1600);
}
function sayQuick() {
  const q = quick;
  if (!q) return;
  unlock();
  const wait = voiceBusy();
  gameSay(`I spy with my little eye: ${q.t.replace(/\u00AD/g, "").toLowerCase()}.`, "play:spy:quick:" + q.n,
    { check: () => quick === q && q.state === "ask" });
  if (wait) toast("I'll say it right after this.");
}
function turnOnKid() {
  const s = settings();
  s.kid = true;
  try { api?.saveSettings?.(); } catch (e) { console.error("[play] saveSettings", e); }
  toast("Kid mode is on. I spy challenges will pop up on the Drive screen.");
  renderSpy();
}

function buildSpy(pane) {
  SP = {
    pane,
    hint: h("div", { class: "pl-hint" }),
    hero: h("div", { class: "pl-spy-hero" }),
    live: h("div", { class: "pl-spots", hidden: true }),
    quick: h("div", { class: "pl-quick" }),
    list: h("div", { class: "pl-finds" }),
  };
  pane.append(SP.hint, SP.hero, SP.live, SP.quick, SP.list);
}
function renderSpy() {
  if (!SP) return;
  const kid = !!settings().kid;
  SP.hint.hidden = kid;
  SP.hint.textContent = "";
  if (!kid) {
    SP.hint.append(h("div", { class: "pl-hint-eye" }, icon("eye", "pl-eye")),
      h("div", { class: "pl-hint-tx" }, h("b", null, "I spy needs Kid mode"),
        h("p", null, "With Kid mode on, I'll point out things you can see from the car as we pass them. Spot one and tap Found it for 10 points.")),
      h("button", { class: "primary", type: "button", onclick: safe(turnOnKid, "kid mode") }, "Turn on Kid mode"));
  }
  // points (finds and misses count places on this road: one saved when the app covered Oregon isn't listed, so it isn't counted)
  const found = spy.found.map(placeById).filter(Boolean).reverse();
  SP.hero.textContent = "";
  SP.hero.append(h("div", { class: "pl-hero-eye" }, icon("eye", "pl-eye")),
    h("div", { class: "pl-hero-n" }, h("b", null, spy.points.toLocaleString()), h("span", null, spy.points === 1 ? "point" : "points")),
    h("div", { class: "pl-hero-c" },
      h("span", null, h("b", null, found.length), " found"),
      h("span", null, h("b", null, spy.missed.filter(placeById).length), " missed")));
  // quick challenge
  if (!quick) dealQuick();
  SP.quick.textContent = "";
  const done = quick.state === "found";
  SP.quick.className = "pl-quick" + (done ? " found" : "");
  SP.quick.append(
    h("div", { class: "pl-quick-k" }, h("span", null, "Quick challenge"), h("span", { class: "pl-quick-pts" }, "+5")),
    h("div", { class: "pl-quick-main" },
      h("span", { class: "pl-quick-e", "aria-hidden": "true" }, quick.e),
      h("div", null, h("small", null, "I spy with my little eye…"), h("b", null, quick.t))),
    done
      ? h("div", { class: "pl-spot-done" }, h("b", { class: "pl-plus" }, "+5"), h("span", null, "Got it. Here comes another one."))
      : h("div", { class: "pl-row" },
        h("button", { class: "pl-found", type: "button", onclick: safe(quickFound, "quick found") }, icon("check"), "Found it"),
        canSpeak() ? h("button", { class: "secondary pl-icon-btn", type: "button", "aria-label": "Say it out loud", onclick: safe(sayQuick, "say quick") }, icon("speaker")) : null,
        h("button", { class: "secondary", type: "button", onclick: safe(() => { dealQuick(); renderSpy(); }, "quick new") }, "New one")));
  // found places
  SP.list.textContent = "";
  SP.list.append(h("h3", { class: "sub" }, found.length ? `Found on the road · ${found.length}` : "Found on the road"));
  if (!found.length) {
    const any = (Array.isArray(D().PLACES) ? D().PLACES : []).some(isSpot);
    SP.list.append(h("p", { class: "pl-none" }, any
      ? "Nothing yet. When I spy something along I-5, it shows up on the Drive screen. Your finds land here."
      : "Landmark I spy challenges are on their way. Until then, try the quick challenge above."));
    return;
  }
  const ul = h("ul", { class: "pl-flist" });
  for (const p of found) {
    ul.append(h("li", null, h("button", { class: `pl-fitem ${p.cat || ""}`, type: "button", onclick: () => openPlace(p) },
      h("span", { class: "pl-fdot", "aria-hidden": "true" }),
      h("span", { class: "pl-ftx" }, h("b", null, p.name), h("small", null, [p.spot, mileLabel(p.m)].filter(Boolean).join(" · "))),
      icon("next", "pl-ic pl-chev"))));
  }
  SP.list.append(ul);
}

/* ---------- the Play view ---------- */
const GAMES = [["bingo", "Road bingo"], ["trivia", "Trivia"], ["spy", "I spy"]];
let V = null;
let game = "bingo";
let lastTab = null;
const viewVisible = () => { const v = document.getElementById("view-play"); return !!v && !v.hidden; };

function buildView() {
  const view = document.getElementById("view-play");
  if (!view) return;
  view.textContent = "";
  view.classList.add("pl-view");
  const seg = h("div", { class: "seg wide pl-seg", role: "group", "aria-label": "Choose a game" });
  const panes = {};
  for (const [id, label] of GAMES) {
    seg.append(h("button", { type: "button", "data-g": id, "aria-pressed": "false", "aria-controls": "pl-" + id, onclick: safe(() => setGame(id), "game") }, label));
    panes[id] = h("section", { class: "pl-pane", id: "pl-" + id, "aria-label": label, hidden: true });
  }
  sr.view = h("p", { class: "pl-sr", role: "status" });
  view.append(h("div", { class: "pl-head" }, h("h2", { class: "view-title" }, "Play"), h("p", { class: "pl-lede" }, "Games for everyone but the driver.")),
    seg, panes.bingo, panes.trivia, panes.spy, sr.view);
  V = { view, seg, panes };
  buildBingo(panes.bingo);
  buildTrivia(panes.trivia);
  buildSpy(panes.spy);
  const g = store("playGame", "bingo");
  setGame(GAMES.some(x => x[0] === g) ? g : "bingo", true);
}
/** #spotCard on Drive: a status line for screen readers and a box for the cards (hidden while there are none). */
function buildSpotHost() {
  const box = document.getElementById("spotCard");
  if (!box) return;
  box.textContent = "";
  box.removeAttribute("aria-live");
  box.classList.add("pl-spothost");
  sr.drive = h("p", { class: "pl-sr", role: "status" });
  spotWrap = h("div", { class: "pl-spots", hidden: true });
  box.append(sr.drive, spotWrap);
}
function setGame(id, quiet = false) {
  if (!V || !GAMES.some(x => x[0] === id)) return;
  const switching = game !== id;
  game = id;
  for (const b of V.seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.g === id));
  for (const [k, p] of Object.entries(V.panes)) p.hidden = k !== id;
  if (!quiet) save("playGame", id);
  if (id === "trivia" && switching && !quiet) freshen();
  renderGame();
}
function renderGame() {
  if (game === "trivia") renderTrivia();
  else if (game === "spy") renderSpy();
  else renderBingo();
}

/* ---------- init ---------- */
export function init(a) {
  api = a || null;
  areaList = null;   // the bingo areas come from this api's road data
  if (!api) return;
  safe(loadCard, "load bingo")();
  if (!card) { try { card = dealCard(); } catch { card = null; } }
  safe(loadScore, "load trivia")();
  safe(loadSpy, "load spy")();
  safe(buildView, "build view")();
  safe(buildSpotHost, "spot host")();
  safe(renderSpots, "render spots")();
  // iOS Safari only shows :active press states when a touch listener is around; and no double-tap zoom (CSS)
  for (const id of ["view-play", "spotCard"]) {
    try { document.getElementById(id)?.addEventListener("touchstart", () => {}, { passive: true }); } catch { /* old browsers */ }
  }

  const on = (evt, fn) => { try { api.bus?.on?.(evt, safe(fn, evt)); } catch (e) { console.error("[play] bus", e); } };
  on("tab", t => {
    const opened = t === "play" && lastTab !== "play";
    lastTab = t;
    if (t !== "play") { closeWin(); return; }
    if (opened && game === "trivia") freshen();
    renderGame();
  });
  on("pos", e => { onSpotPos(e); if (game === "bingo" && viewVisible()) renderBanner(); });
  on("place:announce", onAnnounce);
  on("speaking", onSpeaking);
  on("settings", () => {
    if (!settings().kid) clearSpots();
    if (game === "spy" && viewVisible()) renderSpy();
  });
  on("mode", m => { if (m === "off") endTrip(); });
  on("trip:end", endTrip);
  document.addEventListener("keydown", safe(e => {
    if (e.key === "Escape" && winEl) return closeWin();
    // A-D or 1-4 answers the trivia question on screen (keyboards and car remotes)
    if (e.ctrlKey || e.metaKey || e.altKey || game !== "trivia" || !viewVisible() || !cur || cur.picked != null) return;
    if (e.target && e.target.closest && e.target.closest("input, select, textarea, [contenteditable], .sheet")) return;
    const k = e.key.toLowerCase();
    const i = "abcdef".indexOf(k) >= 0 ? "abcdef".indexOf(k) : "123456".indexOf(k);
    if (i >= 0 && i < cur.t.choices.length && k.length === 1) { e.preventDefault(); answerTrivia(i); }
  }, "keys"));

  api.play = {
    askTrivia: safe(askTrivia, "askTrivia"),
    readTrivia: safe(() => {
      // a question nobody can see right now may be stale; the one on screen is the one they mean
      if ((!viewVisible() || game !== "trivia") && freshen()) renderTrivia();
      if (!cur) { pickQuestion(); renderTrivia(); }
      readQuestion();
    }, "readTrivia"),
    // i: choice index (0 = A); a letter or the answer's text also works. True only for a right answer.
    answerTrivia: safe(i => answerTrivia(Number.isInteger(i) ? i : cur ? parseAnswer(i, cur.t.choices) ?? -1 : -1, "voice") === true, "answerTrivia"),
    nextTrivia: safe(nextTrivia, "nextTrivia"),
    newBingoCard: safe(newCard, "newBingoCard"),
    open: safe(id => { api.ui?.go?.("play"); setGame(id || game); }, "open"),
    score: () => ({ trivia: { ...tscore, streak }, spy: { points: spy.points, found: spy.found.filter(placeById).length },
      bingo: card ? { marked: marked(), lines: fullLines().length, full: !!card.full } : null }),
  };
}
