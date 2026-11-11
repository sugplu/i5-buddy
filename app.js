/* I-5 Buddy. Plain JS, no build step. Data comes from data/i5.js (window.I5DATA). */
(() => {
"use strict";
const D = window.I5DATA;
const MAX_MI = D.route[D.route.length - 1][0];
const CATS = {farm:"Orchards & farms", hist:"History", nature:"Land & water", town:"Towns", stop:"Good stops", odd:"Oddities"};
const REGIONS = [
  {from:0,   to:130, name:"San Diego & Orange County", short:"SAN DIEGO"},
  {from:130, to:210, name:"Los Angeles & the Grapevine", short:"L.A."},
  {from:210, to:460, name:"The Westside", short:"WESTSIDE"},
  {from:460, to:560, name:"Delta & Capital", short:"SAC"},
  {from:560, to:665, name:"Sacramento Valley", short:"VALLEY"},
  {from:665, to:798, name:"Shasta Country", short:"SHASTA"},
];
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- saved state ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("i5b:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("i5b:" + k, JSON.stringify(v)); } catch {} },
};
const S = {
  mode: "off",          // off | gps | demo | manual
  mile: store.get("mile", null),
  dir: store.get("dir", "N"),
  speed: null,          // mph
  offRoute: false,
  narr: store.get("narr", true),
  zoneNarr: store.get("zoneNarr", true),
  narrCats: new Set(store.get("narrCats", Object.keys(CATS))),
  listCats: new Set(Object.keys(CATS)),
  rate: store.get("rate", 1),
  lead: store.get("lead", 2),
  voiceURI: store.get("voice", ""),
  stamps: store.get("stamps", {}),   // id -> timestamp
  heard: new Set(),                  // ids announced this trip
  zone: null,
  demoX: 10,
};
const placesBy = [...D.places].sort((a, b) => a.mi - b.mi);
for (const p of placesBy) p.mi = +p.mi;

/* ---------- geometry: lat/lon -> milepost ---------- */
const R = D.route; // [[mi, lat, lon], ...]
function locate(lat, lon) {
  const kx = 69.17 * Math.cos(lat * Math.PI / 180), ky = 69.0;
  let best = {dist: Infinity, mile: null};
  for (let i = 0; i < R.length - 1; i++) {
    const [m0, a0, o0] = R[i], [m1, a1, o1] = R[i + 1];
    const ax = (o0 - lon) * kx, ay = (a0 - lat) * ky, bx = (o1 - lon) * kx, by = (a1 - lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9;
    const t = clamp(-(ax * dx + ay * dy) / L, 0, 1);
    const px = ax + t * dx, py = ay + t * dy, dist = Math.hypot(px, py);
    if (dist < best.dist) best = {dist, mile: m0 + t * (m1 - m0)};
  }
  return best;
}
function coordAt(mile) { // for demo drive
  for (let i = 0; i < R.length - 1; i++) {
    if (mile <= R[i + 1][0]) {
      const [m0, a0, o0] = R[i], [m1, a1, o1] = R[i + 1], t = clamp((mile - m0) / ((m1 - m0) || 1), 0, 1);
      return [a0 + t * (a1 - a0), o0 + t * (o1 - o0)];
    }
  }
  const l = R[R.length - 1]; return [l[1], l[2]];
}

/* ---------- helpers about the road ---------- */
const ahead = p => S.dir === "N" ? p.mi - S.mile : S.mile - p.mi;
function sideWord(p) {
  if (!p.side) return "";
  const right = (S.dir === "N") === (p.side === "E");
  return right ? "right" : "left";
}
function zoneAt(m) { return D.zones.find(z => m >= z.from && m < z.to) || null; }
function regionAt(m) { return REGIONS.find(r => m >= r.from && m < r.to) || REGIONS[REGIONS.length - 1]; }
function nearestPlace(m) { return placesBy.reduce((a, b) => Math.abs(b.mi - m) < Math.abs(a.mi - m) ? b : a); }
function upcoming(cats) {
  return placesBy.filter(p => cats.has(p.cat)).map(p => ({p, d: ahead(p)})).filter(x => x.d > -0.5).sort((a, b) => a.d - b.d);
}

/* ---------- voice ---------- */
const synth = window.speechSynthesis;
let voices = [], queue = [], speaking = false;
function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices().filter(v => /^en/i.test(v.lang));
  const sel = $("voice"); sel.innerHTML = "";
  const rank = v => (/(premium|enhanced|natural|neural)/i.test(v.name) ? 0 : /(samantha|ava|allison|google us english|aaron|nicky)/i.test(v.name) ? 1 : /en-US/i.test(v.lang) ? 2 : 3);
  voices.sort((a, b) => rank(a) - rank(b));
  for (const v of voices) { const o = el("option", null, `${v.name} (${v.lang})`); o.value = v.voiceURI; sel.append(o); }
  if (!S.voiceURI && voices[0]) S.voiceURI = voices[0].voiceURI;
  sel.value = S.voiceURI;
}
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
function say(text, opts = {}) {
  if (!synth) return;
  if (opts.now) { queue = []; synth.cancel(); speaking = false; }
  queue.push({text, id: opts.id, check: opts.check});
  pump();
}
function pump() {
  if (speaking || !queue.length) return;
  const item = queue.shift();
  if (item.check && !item.check()) return pump();     // stale (already passed) -> skip
  const u = new SpeechSynthesisUtterance(item.text);
  const v = voices.find(v => v.voiceURI === S.voiceURI); if (v) u.voice = v;
  u.rate = S.rate; u.lang = v ? v.lang : "en-US";
  speaking = true;
  const done = () => { speaking = false; setTimeout(pump, 350); };
  u.onend = done; u.onerror = done;
  synth.speak(u);
}
function stopTalking() { queue = []; speaking = false; synth && synth.cancel(); }

function announceText(p, d) {
  const side = sideWord(p);
  const where = side ? (p.visible === false ? `off to your ${side}` : `on your ${side}`) : (p.visible === false ? "nearby" : "");
  let lead;
  if (d < 0.4) lead = where ? `Right now, ${where}` : "Right about here";
  else { const n = d < 1.5 ? "a mile" : `${Math.round(d)} miles`; lead = `In about ${n}${where ? ", " + where : ""}`; }
  return `${lead}: ${p.name}. ${p.text}`;
}

/* ---------- the trip loop ---------- */
let lastMile = null, lastTime = null;
function update(mile, {speed = null, offRoute = false} = {}) {
  const now = Date.now();
  if (lastMile != null && Math.abs(mile - lastMile) > 0.12) {
    S.dir = mile > lastMile ? "N" : "S";
    if (speed == null && lastTime) speed = Math.abs(mile - lastMile) / ((now - lastTime) / 3.6e6);
    lastMile = mile; lastTime = now;
  } else if (lastMile == null) { lastMile = mile; lastTime = now; }
  if (speed != null) S.speed = speed;
  const prev = S.mile;
  S.mile = clamp(mile, 0, MAX_MI); S.offRoute = offRoute;
  store.set("mile", S.mile); store.set("dir", S.dir);
  if (!offRoute && S.mode !== "off") { stampPassed(prev); narrate(); }
  render();
}
function stampPassed(prev) {
  if (prev == null) return;
  const lo = Math.min(prev, S.mile) - 0.3, hi = Math.max(prev, S.mile) + 0.3;
  if (hi - lo > 30) return; // a jump (manual move), not a drive
  let fresh = 0;
  for (const p of placesBy) if (p.mi >= lo && p.mi <= hi && !S.stamps[p.id]) { S.stamps[p.id] = Date.now(); fresh++; }
  if (fresh) { store.set("stamps", S.stamps); toast(fresh === 1 ? "Passport stamp collected" : `${fresh} passport stamps collected`); }
}
function narrate() {
  if (!S.narr) return;
  const z = zoneAt(S.mile);
  if (z && z !== S.zone) {
    const first = S.zone === null; S.zone = z;
    if (S.zoneNarr && !first) say(`Now passing: ${z.label}. ${z.text}`);
  }
  const lead = Math.max(S.lead, S.speed ? S.speed * 1.2 / 60 : 0); // at least ~70 seconds of warning
  for (const {p, d} of upcoming(S.narrCats)) {
    if (d > lead) break;
    if (S.heard.has(p.id)) continue;
    S.heard.add(p.id);
    say(announceText(p, d), {id: p.id, check: () => ahead(p) > -1});
    flashNext();
  }
}

/* GPS */
let watchId = null;
function startGps() {
  if (!("geolocation" in navigator)) { toast("This phone doesn't share its location with web apps."); return; }
  stopTrip(true);
  S.mode = "gps"; setPill("wait", "GPS"); $("statusText").textContent = "Finding you…";
  greet();
  watchId = navigator.geolocation.watchPosition(pos => {
    const {latitude, longitude, speed} = pos.coords;
    const hit = locate(latitude, longitude);
    const off = hit.dist > 2.5;
    update(hit.mile, {speed: speed != null && speed >= 0 ? speed * 2.23694 : null, offRoute: off});
  }, err => {
    setPill("off", "OFF");
    $("statusText").textContent = err.code === 1 ? "Location is blocked. Allow it in your browser settings." : "Can't get a GPS fix yet.";
    if (err.code === 1) stopTrip();
  }, {enableHighAccuracy: true, maximumAge: 4000, timeout: 30000});
  running(true);
}

/* Demo drive */
let demoTimer = null;
function startDemo() {
  stopTrip(true);
  S.mode = "demo";
  if (S.mile == null) S.mile = 215;
  lastMile = null;
  greet("This is a demo drive. I'll pretend we're driving so you can hear how it works.");
  let m = S.mile;
  demoTimer = setInterval(() => {
    const mph = 65 * S.demoX;
    m += (S.dir === "N" ? 1 : -1) * mph / 3600 * 0.5;
    if (m >= MAX_MI || m <= 0) { m = clamp(m, 0, MAX_MI); S.dir = S.dir === "N" ? "S" : "N"; }
    lastMile = null; // direction comes from the demo, not inferred
    update(m, {speed: 65});
  }, 500);
  running(true);
}
function greet(extra) {
  say(`Hi, I'm your I-5 buddy. I'll tell you about what's coming up as we drive. ${extra || ""}`, {now: true});
  requestWake();
}
function stopTrip(silent) {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  clearInterval(demoTimer); watchId = null; demoTimer = null;
  if (!silent) { stopTalking(); S.mode = "off"; running(false); render(); }
  S.heard.clear(); S.zone = null; lastMile = null;
  releaseWake();
}
function running(on) {
  $("startControls").hidden = on; $("runControls").hidden = !on; $("demoBar").hidden = !(on && S.mode === "demo");
}

/* Keep the screen on while driving */
let wake = null;
async function requestWake() { try { wake = await navigator.wakeLock?.request("screen"); } catch {} }
function releaseWake() { try { wake && wake.release(); } catch {} wake = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.mode !== "off" && !wake) requestWake(); });

/* ---------- rendering ---------- */
function setPill(s, t) { const p = $("statusPill"); p.dataset.s = s; p.textContent = t; }
let tab = "drive";
function render() {
  const has = S.mile != null;
  $("dirBadge").textContent = S.dir === "N" ? "NORTH" : "SOUTH";
  $("mile").textContent = has ? Math.round(S.mile) : "--";
  $("speed").textContent = S.speed != null && S.mode !== "manual" ? Math.round(S.speed) : "--";
  if (has) {
    const z = zoneAt(S.mile);
    $("nearText").textContent = z ? z.label : regionAt(S.mile).name;
  }
  if (S.mode === "gps") {
    if (S.offRoute) { setPill("off-route", "OFF I-5"); $("statusText").textContent = "You're not on I-5 right now"; }
    else { setPill("gps", "GPS"); $("statusText").textContent = regionAt(S.mile).name; }
  } else if (S.mode === "demo") { setPill("demo", "DEMO"); $("statusText").textContent = "Demo drive · " + regionAt(S.mile).name; }
  else if (S.mode === "manual") { setPill("manual", "MANUAL"); $("statusText").textContent = "Milepost set by hand"; }
  else { setPill("off", "OFF"); $("statusText").textContent = has ? "Paused" : "Not tracking yet"; }
  renderRibbon(); renderZone(); renderNext();
  $("toggleNarr").setAttribute("aria-pressed", S.narr); $("toggleNarr").textContent = S.narr ? "Narration on" : "Narration off";
  if (tab === "ahead") renderAhead();
  if (tab === "map") renderMapYou();
}

let ribbonBuilt = false;
function renderRibbon() {
  const r = $("ribbon");
  if (!ribbonBuilt) {
    r.innerHTML = '<div class="track"></div><div class="done"></div>';
    for (const p of placesBy) { const t = el("div", "tick"); t.style.left = (p.mi / MAX_MI * 100) + "%"; t.dataset.id = p.id; r.append(t); }
    for (const [mi, name] of [[0, "MEX"], [130, "L.A."], [519, "SAC"], [677, "REDDING"], [797, "OR"]]) {
      const l = el("div", "lbl", name); l.style.left = clamp(mi / MAX_MI * 100, 4, 96) + "%"; r.append(l);
    }
    r.append(el("div", "you"));
    ribbonBuilt = true;
  }
  const pct = S.mile == null ? 0 : S.mile / MAX_MI * 100;
  r.querySelector(".you").style.left = pct + "%";
  r.querySelector(".you").hidden = S.mile == null;
  r.querySelector(".done").style.width = pct + "%";
  for (const t of r.querySelectorAll(".tick")) t.classList.toggle("got", !!S.stamps[t.dataset.id]);
}
function renderZone() {
  const z = S.mile != null ? zoneAt(S.mile) : null;
  $("zone").hidden = !z;
  if (z) { $("zoneLabel").textContent = z.label; $("zoneText").textContent = z.text; }
}
let shownNext = null;
function renderNext() {
  const card = $("nextCard");
  if (S.mile == null) {
    card.className = "next"; card.innerHTML = "";
    card.append(el("div", "meta", "WELCOME"), el("h2", null, "Your guide to all 797 miles of I-5 in California"),
      el("p", null, `${placesBy.length} landmarks, orchards and stories between Mexico and Oregon. Tap Start GPS when you're on the road, or try a demo drive from the couch.`));
    return;
  }
  const list = upcoming(S.listCats.size ? S.listCats : new Set(Object.keys(CATS)));
  const x = list[0];
  if (!x) { card.className = "next"; card.innerHTML = ""; card.append(el("div", "meta", "END OF THE ROAD"), el("h2", null, S.dir === "N" ? "Welcome to Oregon" : "Welcome to the border"), el("p", null, "That's every stop in this direction.")); return; }
  const {p, d} = x;
  if (shownNext !== p.id) {
    shownNext = p.id;
    card.className = "next " + p.cat; card.innerHTML = "";
    const meta = el("div", "meta"); meta.append(el("span", null, CATS[p.cat]), el("span", null, "EXIT " + p.mi));
    const count = el("div", "count"); const n = el("span", "n"); count.append(n, el("small", null, "mi"), el("span", "side"));
    const acts = el("div", "acts");
    const play = el("button", null, "Play"); play.onclick = () => say(announceText(p, ahead(p)), {now: true});
    const more = el("button", null, "Next one"); more.onclick = () => { S.heard.add(p.id); const nx = list[1]; if (nx) say(announceText(nx.p, nx.d), {now: true}); };
    const stopb = el("button", null, "Quiet"); stopb.onclick = stopTalking;
    acts.append(play, more, stopb);
    card.append(meta, count, el("h2", null, p.name), el("p", null, p.text), acts);
  }
  card.querySelector(".n").textContent = d < 0.4 ? "NOW" : d < 10 ? d.toFixed(1) : Math.round(d);
  card.querySelector(".count small").hidden = d < 0.4;
  const sw = sideWord(p);
  card.querySelector(".side").textContent = sw ? (sw === "left" ? "◀ LEFT" : "RIGHT ▶") : "";
}
function flashNext() { const c = $("nextCard"); c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); }

function look(which) {
  if (S.mile == null) { toast("Start GPS or a demo drive first."); return; }
  const cands = placesBy.filter(p => sideWord(p) === which).map(p => ({p, d: ahead(p)})).filter(x => x.d > -3 && x.d < 8)
    .sort((a, b) => (Math.abs(a.d) - (a.p.visible ? 2 : 0)) - (Math.abs(b.d) - (b.p.visible ? 2 : 0)));
  const z = zoneAt(S.mile);
  if (!cands.length) { say(z ? `On your ${which} right now: ${z.label}. ${z.text}` : `Nothing I know about on your ${which} for the next few miles.`, {now: true}); return; }
  const {p, d} = cands[0];
  const where = d < -0.3 ? `Just behind us on your ${which}` : d < 0.5 ? `Right there on your ${which}` : `About ${Math.max(1, Math.round(d))} mile${Math.round(d) > 1 ? "s" : ""} ahead on your ${which}`;
  say(`${where}: ${p.name}. ${p.text}`, {now: true});
}

/* ---------- Ahead tab ---------- */
function chipRow(container, set, onChange) {
  container.innerHTML = "";
  for (const [k, v] of Object.entries(CATS)) {
    const b = el("button", "chip " + k); b.setAttribute("aria-pressed", set.has(k));
    b.append(el("i"), document.createTextNode(v));
    b.onclick = () => { set.has(k) ? set.delete(k) : set.add(k); b.setAttribute("aria-pressed", set.has(k)); onChange(); };
    container.append(b);
  }
}
function renderAhead() {
  const ol = $("aheadList"); ol.innerHTML = "";
  const m = S.mile ?? (S.dir === "N" ? 0 : MAX_MI);
  $("aheadTitle").textContent = S.mile == null ? "All stops, south to north" : `Coming up ${S.dir === "N" ? "northbound" : "southbound"}`;
  const items = placesBy.filter(p => S.listCats.has(p.cat)).map(p => ({p, d: S.dir === "N" ? p.mi - m : m - p.mi})).filter(x => x.d > -0.5).sort((a, b) => a.d - b.d);
  if (!items.length) { ol.append(el("li", "empty", "Nothing ahead with these filters.")); return; }
  for (const {p, d} of items) {
    const li = el("li", p.cat);
    const dd = el("div", "d", d < 0.5 ? "now" : Math.round(d)); if (d >= 0.5) dd.append(el("small", null, "mi"));
    const body = el("div", "body");
    const sw = sideWord(p);
    body.append(el("div", "m", [CATS[p.cat], "exit " + p.mi, sw && (sw === "left" ? "on left" : "on right")].filter(Boolean).join(" · ")),
      el("b", null, p.name), el("p", null, p.text));
    const row = el("div", "row");
    const hear = el("button", "link", "Hear it"); hear.onclick = () => say(`${p.name}. ${p.text}`, {now: true});
    row.append(hear);
    if (S.stamps[p.id]) row.append(el("span", "got", "Stamped"));
    if (p.src) { const a = el("a", null, "Source"); a.href = p.src; a.target = "_blank"; a.rel = "noopener"; row.append(a); }
    body.append(row);
    li.append(dd, body); ol.append(li);
  }
}

/* ---------- Map ---------- */
const CITIES = [[0, "Mexico"], [16, "San Diego"], [77, "Irvine"], [135, "Los Angeles"], [215, "Grapevine"], [309, "Kettleman City"], [403, "Los Banos"], [473, "Stockton"], [519, "Sacramento"], [649, "Red Bluff"], [677, "Redding"], [738, "Mt. Shasta"], [797, "Oregon"]];
let mapBuilt = false, mapProj = null, mapSel = null, mapZ = 1, mapVB = null;
function mapView() {
  if (!mapBuilt) return;
  const svg = $("map"), [W, H] = mapVB;
  svg.style.setProperty("--z", mapZ);
  if (mapZ === 1) { svg.setAttribute("viewBox", `0 0 ${W} ${H}`); return; }
  const focus = mapSel ? mapSel.mi : S.mile != null ? S.mile : 400;
  const [cx, cy] = mapProj(...coordAt(focus));
  const w = W / mapZ, h = H / mapZ;
  svg.setAttribute("viewBox", `${(cx - w / 2).toFixed(1)} ${(cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
}
function renderMap() {
  const svg = $("map"), NS = "http://www.w3.org/2000/svg";
  const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  if (!mapBuilt) {
    const lats = R.map(r => r[1]), lons = R.map(r => r[2]);
    const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
    const k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
    const H = 1000, W = Math.round((lo1 - lo0) * k / (la1 - la0) * H), pad = 120;
    mapProj = (la, lo) => [pad + (lo - lo0) * k / (la1 - la0) * H, 40 + (la1 - la) / (la1 - la0) * H];
    mapVB = [W + pad * 2, H + 80];
    svg.setAttribute("viewBox", `0 0 ${mapVB[0]} ${mapVB[1]}`);
    document.querySelectorAll(".zoom [data-z]").forEach(b => b.onclick = () => {
      mapZ = +b.dataset.z; document.querySelectorAll(".zoom [data-z]").forEach(x => x.setAttribute("aria-pressed", x === b)); mapView();
    });
    const pts = R.map(r => mapProj(r[1], r[2]).map(v => v.toFixed(1)).join(",")).join(" ");
    svg.append(mk("polyline", {points: pts, class: "road-glow"}), mk("polyline", {points: pts, class: "road"}), mk("polyline", {points: pts, class: "road-dash"}));
    for (const [mi, name] of CITIES) {
      const [x, y] = mapProj(...coordAt(mi));
      const g = mk("g", {class: "city"});
      g.append(mk("circle", {cx: x, cy: y, r: 6}));
      const right = mi < 200 || mi > 640;
      const t = mk("text", {x: right ? x + 14 : x - 14, y: y + 5, "text-anchor": right ? "start" : "end"}); t.textContent = name;
      g.append(t); svg.append(g);
    }
    const dots = mk("g", {id: "mapDots"});
    for (const p of placesBy) {
      const [x, y] = mapProj(...coordAt(p.mi));
      const off = p.side === "E" ? 9 : p.side === "W" ? -9 : 0;
      const c = mk("circle", {cx: x + off, cy: y, r: 5.5, class: "dot " + p.cat, "data-id": p.id, tabindex: 0});
      c.addEventListener("click", () => selectMapPlace(p));
      c.addEventListener("keydown", e => { if (e.key === "Enter") selectMapPlace(p); });
      dots.append(c);
    }
    svg.append(dots);
    const you = mk("g", {id: "mapYou"});
    you.append(mk("circle", {r: 22, class: "you-pulse"}), mk("circle", {r: 10, class: "you-dot"}));
    svg.append(you);
    const lg = $("legend");
    for (const [k2, v] of Object.entries(CATS)) { const s2 = el("span", "chip " + k2); s2.append(el("i"), document.createTextNode(v)); lg.append(s2); }
    mapBuilt = true;
  }
  for (const c of svg.querySelectorAll(".dot")) c.classList.toggle("got", !!S.stamps[c.dataset.id]);
  const got = placesBy.filter(p => S.stamps[p.id]).length;
  $("mapLede").textContent = `${placesBy.length} stops · ${got} stamped · tap a dot`;
  renderMapYou();
}
function renderMapYou() {
  if (!mapBuilt) return;
  const y = $("mapYou");
  y.style.display = S.mile == null ? "none" : "";
  if (S.mile != null) { const [px, py] = mapProj(...coordAt(S.mile)); y.setAttribute("transform", `translate(${px.toFixed(1)} ${py.toFixed(1)}) scale(${(1 / Math.sqrt(mapZ)).toFixed(3)})`); }
  if (mapZ > 1 && !mapSel) mapView();
}
function selectMapPlace(p) {
  mapSel = p;
  for (const c of $("map").querySelectorAll(".dot")) c.classList.toggle("sel", c.dataset.id === p.id);
  const card = $("mapCard"); card.hidden = false; card.className = "map-card " + p.cat; card.innerHTML = "";
  const close = el("button", "x", "×"); close.setAttribute("aria-label", "Close"); close.onclick = () => { card.hidden = true; mapSel = null; for (const c of $("map").querySelectorAll(".dot.sel")) c.classList.remove("sel"); mapView(); };
  if (mapZ > 1) mapView();
  const hear = el("button", "link", "Hear it"); hear.onclick = () => say(`${p.name}. ${p.text}`, {now: true});
  card.append(close, el("div", "m", `${CATS[p.cat]} · exit ${p.mi}${S.stamps[p.id] ? " · stamped" : ""}`), el("b", null, p.name), el("p", null, p.text), hear);
}

/* ---------- Passport ---------- */
function renderPassport() {
  const got = placesBy.filter(p => S.stamps[p.id]).length;
  $("passportLede").textContent = got ? `${got} of ${placesBy.length} stamps. You collect one every time you drive past a landmark.` : `You'll collect a stamp each time you drive past one of the ${placesBy.length} landmarks. Start GPS or a demo drive to begin.`;
  const b = $("badges"); b.innerHTML = "";
  for (const r of REGIONS) {
    const ps = placesBy.filter(p => p.mi >= r.from && p.mi < r.to), g = ps.filter(p => S.stamps[p.id]).length;
    const pct = ps.length ? Math.round(g / ps.length * 100) : 0;
    const c = el("div", "badge" + (pct === 100 ? " done" : ""));
    const bar = el("div", "bar"), fill = el("i"); fill.style.width = pct + "%"; bar.append(fill);
    c.append(el("b", null, r.name), bar, el("small", null, `${g}/${ps.length} · exits ${r.from}–${Math.min(r.to, MAX_MI)}`));
    b.append(c);
  }
  const s = $("stamps"); s.innerHTML = "";
  const order = [...placesBy].sort((a, b) => (S.stamps[b.id] ? 1 : 0) - (S.stamps[a.id] ? 1 : 0) || a.mi - b.mi);
  for (const p of order) {
    const st = el("div", "stamp " + p.cat + (S.stamps[p.id] ? " got" : ""));
    st.style.setProperty("--r", ((p.mi * 37) % 17 - 8) + "deg");
    const inner = el("div"); inner.append(el("span", "n", p.mi), document.createTextNode(p.name));
    st.append(inner); st.title = p.name; s.append(st);
  }
}

/* ---------- Bingo ---------- */
const BINGO = ["Oil pumpjack","Almond orchard","Cattle","Tomato truck","Hay bales","Aqueduct","Dust devil","Crop duster","Fruit stand","Wind turbine","Freight train","Snowy peak","Hawk on a post","Sheep","Cotton field","Rice field","Pistachio trees","Water sign","Tumbleweed","Vineyard","Irrigation sprinkler","Bee boxes","Big rig with 3 trailers","Tractor","Chain-up area","Cal Fire truck","Horse","Rest area","Highway patrol","Bridge over a river","RV","Out-of-state plate","Bus","Lake","Farm stand sign","Exit with only a gas station"];
let bingo = store.get("bingo", null);
function newBingo() {
  const pool = [...BINGO].sort(() => Math.random() - .5).slice(0, 24);
  pool.splice(12, 0, "FREE: I-5 shield");
  bingo = {cells: pool, on: pool.map((_, i) => i === 12)}; store.set("bingo", bingo); renderBingo();
}
function bingoLines() {
  const L = []; for (let i = 0; i < 5; i++) { L.push([0,1,2,3,4].map(j => i*5+j)); L.push([0,1,2,3,4].map(j => j*5+i)); }
  L.push([0,6,12,18,24], [4,8,12,16,20]); return L.filter(l => l.every(i => bingo.on[i]));
}
function renderBingo(check) {
  if (!bingo) return newBingo();
  const g = $("bingo"); g.innerHTML = "";
  const lines = bingoLines(), inLine = new Set(lines.flat());
  bingo.cells.forEach((c, i) => {
    const b = el("button", (i === 12 ? "free " : "") + (inLine.has(i) ? "line" : ""), i === 12 ? "I-5 FREE" : c);
    b.setAttribute("aria-pressed", bingo.on[i]);
    if (i !== 12) b.onclick = () => { const before = bingoLines().length; bingo.on[i] = !bingo.on[i]; store.set("bingo", bingo); renderBingo(); if (bingoLines().length > before) celebrate(); };
    g.append(b);
  });
}
function celebrate() { const w = $("bingoWin"); w.hidden = false; say("Bingo!", {now: true}); setTimeout(() => w.hidden = true, 1800); }

/* ---------- Trivia ---------- */
let tScore = store.get("trivia", {right: 0, asked: 0}), tCur = null, tSeen = new Set();
function pickQuestion() {
  const all = D.trivia.map((t, i) => ({...t, i})).filter(t => !tSeen.has(t.i));
  if (!all.length) { tSeen.clear(); return pickQuestion(); }
  if (S.mile != null) all.sort((a, b) => Math.abs(a.mi - S.mile) - Math.abs(b.mi - S.mile) + (Math.random() - .5) * 60);
  else all.sort(() => Math.random() - .5);
  tCur = all[0]; tSeen.add(tCur.i);
}
function renderTrivia() {
  $("triviaScore").textContent = `${tScore.right} right of ${tScore.asked}`;
  if (!D.trivia.length) { $("quiz").textContent = "No questions yet."; return; }
  if (!tCur) pickQuestion();
  const q = $("quiz"); q.innerHTML = "";
  const t = tCur;
  q.append(el("div", "m", `Near exit ${t.mi} · ${regionAt(t.mi).name}`), el("h3", null, t.q));
  const read = el("button", "link", "Read it out loud");
  read.onclick = () => say(`${t.q} ${t.choices.map((c, i) => `${"ABCD"[i]}: ${c}.`).join(" ")}`, {now: true});
  q.append(read);
  let answered = false;
  t.choices.forEach((c, i) => {
    const b = el("button", "opt", `${"ABCD"[i]}. ${c}`);
    b.onclick = () => {
      if (answered) return; answered = true;
      tScore.asked++; if (i === t.answer) tScore.right++; store.set("trivia", tScore);
      [...q.querySelectorAll(".opt")].forEach((o, j) => o.classList.add(j === t.answer ? "right" : j === i ? "wrong" : "x"));
      $("triviaScore").textContent = `${tScore.right} right of ${tScore.asked}`;
      const why = el("p", "why", (i === t.answer ? "Right! " : "Not quite. ") + (t.why || ""));
      const nx = el("button", "primary", "Next question"); nx.onclick = () => { pickQuestion(); renderTrivia(); };
      q.append(why, nx);
      say((i === t.answer ? "Right! " : `Not quite, it's ${t.choices[t.answer]}. `) + (t.why || ""), {now: true});
    };
    q.append(b);
  });
}

/* ---------- toast ---------- */
let toastT;
function toast(t) { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => e.hidden = true, 2600); }

/* ---------- wiring ---------- */
function go(name) {
  tab = name;
  document.querySelectorAll(".view").forEach(v => v.hidden = v.dataset.view !== name);
  document.querySelectorAll(".tabs button").forEach(b => b.dataset.go === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  if (name === "ahead") renderAhead();
  if (name === "passport") renderPassport();
  if (name === "map") renderMap();
  if (name === "play") { renderBingo(); renderTrivia(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => go(b.dataset.go));
$("startGps").onclick = startGps;
$("startDemo").onclick = startDemo;
$("stopTrip").onclick = () => stopTrip(false);
$("toggleNarr").onclick = () => { S.narr = !S.narr; store.set("narr", S.narr); if (!S.narr) stopTalking(); render(); };
$("lookLeft").onclick = () => look("left");
$("lookRight").onclick = () => look("right");
document.querySelectorAll("#demoBar [data-x]").forEach(b => b.onclick = () => { S.demoX = +b.dataset.x; document.querySelectorAll("#demoBar [data-x]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
$("demoFlip").onclick = () => { S.dir = S.dir === "N" ? "S" : "N"; S.heard.clear(); shownNext = null; render(); };
chipRow($("chips"), S.listCats, () => { shownNext = null; renderAhead(); renderNext(); });
chipRow($("narrChips"), S.narrCats, () => store.set("narrCats", [...S.narrCats]));

$("tabBingo").onclick = () => { $("tabBingo").setAttribute("aria-pressed", true); $("tabTrivia").setAttribute("aria-pressed", false); $("bingoPane").hidden = false; $("triviaPane").hidden = true; };
$("tabTrivia").onclick = () => { $("tabBingo").setAttribute("aria-pressed", false); $("tabTrivia").setAttribute("aria-pressed", true); $("bingoPane").hidden = true; $("triviaPane").hidden = false; renderTrivia(); };
$("newBingo").onclick = newBingo;

/* settings */
const openS = () => { $("settings").hidden = false; $("sheetBack").hidden = false; $("manual").value = Math.round(S.mile ?? 300); $("manualOut").textContent = S.mile != null ? Math.round(S.mile) : "--"; };
const closeS = () => { $("settings").hidden = true; $("sheetBack").hidden = true; };
$("openSettings").onclick = openS; $("closeSettings").onclick = closeS; $("sheetBack").onclick = closeS;
$("voice").onchange = e => { S.voiceURI = e.target.value; store.set("voice", S.voiceURI); say("This is how I'll sound.", {now: true}); };
$("rate").value = S.rate; $("rateOut").textContent = S.rate.toFixed(2).replace(/0$/, "") + "×";
$("rate").oninput = e => { S.rate = +e.target.value; store.set("rate", S.rate); $("rateOut").textContent = S.rate.toFixed(2).replace(/0$/, "") + "×"; };
$("lead").value = S.lead; $("leadOut").textContent = S.lead + " mi";
$("lead").oninput = e => { S.lead = +e.target.value; store.set("lead", S.lead); $("leadOut").textContent = S.lead + " mi"; };
$("zoneNarr").checked = S.zoneNarr; $("zoneNarr").onchange = e => { S.zoneNarr = e.target.checked; store.set("zoneNarr", S.zoneNarr); };
$("manual").oninput = e => {
  if (S.mode === "gps" || S.mode === "demo") stopTrip(true);
  S.mode = "manual"; running(true); $("demoBar").hidden = true; S.speed = null; lastMile = null; S.heard.clear();
  S.mile = +e.target.value; $("manualOut").textContent = S.mile; store.set("mile", S.mile); shownNext = null; render();
};
const setDir = d => { S.dir = d; store.set("dir", d); S.heard.clear(); shownNext = null; $("manN").setAttribute("aria-pressed", d === "N"); $("manS").setAttribute("aria-pressed", d === "S"); render(); };
$("manN").onclick = () => setDir("N"); $("manS").onclick = () => setDir("S");
$("manN").setAttribute("aria-pressed", S.dir === "N"); $("manS").setAttribute("aria-pressed", S.dir === "S");
$("resetPassport").onclick = () => $("resetConfirm").hidden = false;
$("resetNo").onclick = () => $("resetConfirm").hidden = true;
$("resetYes").onclick = () => { S.stamps = {}; store.set("stamps", {}); $("resetConfirm").hidden = true; toast("Passport cleared"); render(); };

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
$("installHint").textContent = standalone ? "Installed on this phone. Works offline." :
  /iphone|ipad/i.test(navigator.userAgent) ? "Install it: tap Share, then Add to Home Screen. It works offline once installed." :
  "Install it: open your browser menu and choose Install app or Add to Home screen. It works offline once installed.";

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});

render();
window.I5BUDDY = {locate, coordAt}; // used by tools/test.html
})();
