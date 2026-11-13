// I-5 Buddy: boot, GPS/demo/manual position, Drive and Ahead screens, settings, offline.
import { S, settings, saveSettings, bus, store, saveStamps } from "./store.js";
import * as data from "./data.js";
import * as geo from "./geo.js";
import { voice } from "./voice.js";
import { narrator, upcoming, announceText, tellMore, hear, look, resetTrip, markHeard } from "./narrator.js";

const {
  PLACES, CATS, MAX_M, STATES, DESTS, ENDS, SCOPE, zoneAt, stateAt, localMile, regionAt, sideWord, aheadOf, elevAt,
  servicesAhead, restAhead, exitName, fmtMiles, fmtDuration, placeById,
} = data;
// A mile saved by a version that covered more road (Oregon, Washington) is past the end now: forget it.
if (S.m != null && !(S.m >= 0 && S.m <= MAX_M + 1)) { S.m = null; store.del("m"); }

/* ---------- small UI helpers ---------- */
const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
let toastTimer;
function toast(text, ms = 2600) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
let openSheetEl = null;
function openSheet(sheet) {
  closeSheet();
  sheet.hidden = false; $("sheetBack").hidden = false; openSheetEl = sheet;
  const f = sheet.querySelector("button, select, input, a");
  f && f.focus({ preventScroll: true });
}
function closeSheet() {
  if (openSheetEl) openSheetEl.hidden = true;
  $("sheetBack").hidden = true; openSheetEl = null;
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
$("sheetBack").addEventListener("click", closeSheet);

/** A place photo with its credit. size: "hero" | "thumb" | "full". */
function photo(p, size = "hero") {
  if (!p.img) return null;
  const fig = el("figure", "photo " + size);
  const img = el("img");
  img.src = p.img.f; img.alt = p.img.alt || p.name; img.loading = "lazy"; img.decoding = "async";
  if (p.img.w && p.img.h) { img.width = p.img.w; img.height = p.img.h; }
  img.onerror = () => fig.remove();
  fig.append(img);
  if (size !== "thumb") {
    const cap = el("figcaption");
    const a = el("a", null, `Photo: ${p.img.by || "Wikimedia Commons"}${p.img.lic ? " · " + p.img.lic : ""}`);
    a.href = p.img.url || "https://commons.wikimedia.org"; a.target = "_blank"; a.rel = "noopener";
    cap.append(a); fig.append(cap);
  }
  return fig;
}

/* ---------- theme ---------- */
function applyTheme() {
  let t = settings.theme;
  if (t === "auto") {
    const [lat, lon] = S.lat != null ? [S.lat, S.lon] : S.m != null ? geo.coordAt(S.m) : [38.58, -121.49];
    t = geo.sunAltitude(lat, lon) > -4 ? "light" : "dark";
  }
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#0b6e3f" : "#111513";
}
setInterval(applyTheme, 5 * 60 * 1000);

/* ---------- position pipeline ---------- */
let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => { if (!renderQueued) return; renderQueued = false; render(); };
  requestAnimationFrame(run);
  setTimeout(run, 250); // animation frames can be throttled (low-power mode, hidden iframes)
}

/** Central place where every position update goes (GPS, demo, manual). */
function setPosition(m, { speed = null, dir = null, offRoute = false, jumped = false } = {}) {
  const prevM = S.m;
  if (dir) S.dir = dir;
  if (speed != null) S.speed = speed;
  S.m = Math.max(0, Math.min(MAX_M, m));
  S.offRoute = offRoute;
  store.set("m", S.m); store.set("dir", S.dir);
  bus.emit("pos", { m: S.m, prevM, dir: S.dir, speed: S.speed, offRoute, jumped: jumped || prevM == null });
  queueRender();
}

function setMode(mode) {
  S.mode = mode;
  bus.emit("mode", mode);
  const on = mode !== "off";
  $("startControls").hidden = on;
  $("runControls").hidden = !on;
  $("demoBar").hidden = mode !== "demo";
  if (on) requestWake(); else releaseWake();
  queueRender();
}

/* GPS */
let watchId = null, dirVotes = [], anchorM = null, lastFix = null, offCount = 0;
// The two ends of the covered road (ENDS.S = Mexico; ENDS.N = the Oregon line while the data covers California only).
// offEnd: the end we went off the road past (decided once, at the fix that took us off; the status line and the
// next card show it). endSaid: the end we said goodbye at. drove: this GPS session has had a fix on the road.
let offEnd = null, endSaid = null, drove = false;
/** Off the road past either end of the covered stretch (into Oregon, or into Mexico)? Returns ENDS.N, ENDS.S or null.
 *  Both ends are state or national borders that run east-west where I-5 crosses them, so "past" = beyond the latitude
 *  of the road's last point, with the last mile we had on the road within 3 miles of that end. */
function pastEnd() {
  const R = data.ROUTE;
  if (S.lat == null || S.m == null || !R.length) return null;
  if (S.lat > R[R.length - 1][1] && S.m > MAX_M - 3) return ENDS.N;
  if (S.lat < R[0][1] && S.m < R[0][0] + 3) return ENDS.S;
  return null;
}
/** The end of the road we are past right now, or null (only while GPS has us off the road). */
const atEnd = () => (S.mode === "gps" && S.offRoute ? offEnd : null);
function startGps() {
  voice.unlock();
  const G = window.__I5_FAKE_GEO__ || navigator.geolocation; // tests can inject a fake GPS
  if (!G) { toast("This browser can't share your location."); return; }
  stopAll(true);
  setMode("gps");
  setPill("wait", "GPS");
  $("statusText").textContent = "Finding you…";
  greet();
  watchId = G.watchPosition(onFix, err => {
    if (err.code === 1) {
      toast("Location is blocked. Allow location for this site in your browser settings.", 5000);
      stopAll();
    } else {
      $("statusText").textContent = "Waiting for a GPS signal…";
    }
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
}
function onFix(pos) {
  const c = pos.coords;
  if (c.accuracy && c.accuracy > 1500) return; // too fuzzy to place you on the road
  S.lat = c.latitude; S.lon = c.longitude; S.accuracy = c.accuracy;
  const hit = geo.locate(c.latitude, c.longitude, S.m);
  // Far from I-5: don't move the marker. Two far fixes in a row = off route (one could be a GPS glitch).
  const far = hit.m == null || hit.dist > Math.max(1.2, (c.accuracy || 0) / 1609 * 1.5);
  if (far) {
    offCount++;
    lastFix = null; anchorM = null; dirVotes = [];
    if (offCount >= 2 && !S.offRoute) {
      setPosition(S.m ?? hit.m ?? 0, { offRoute: true, jumped: true });
      offEnd = pastEnd();
      // Say goodbye once, and only after driving there (not when GPS starts up already past the end).
      if (offEnd && drove && endSaid !== offEnd && settings.narr) {
        endSaid = offEnd;
        voice.say(`That's ${offEnd.long}, the end of the road for I-5 Buddy. Thanks for riding along.`, { id: "end-of-road", prio: 2, chime: "success" });
      }
    }
    return;
  }
  drove = true; offEnd = null;
  // A fix that bounces back near the line (GPS noise) must not set up a second goodbye: forget it only once we are
  // back on the road more than 3 miles from that end.
  if (endSaid && (endSaid === ENDS.N ? hit.m < MAX_M - 3 : hit.m > data.ROUTE[0][0] + 3)) endSaid = null;
  const wasOff = offCount >= 2 || S.offRoute;
  offCount = 0;
  // speed
  let speed = c.speed != null && c.speed >= 0 ? c.speed * 2.23694 : null;
  let dtH = null;
  if (lastFix) {
    dtH = (pos.timestamp - lastFix.t) / 3.6e6;
    if (speed == null && dtH > 0) speed = geo.miles(lastFix.lat, lastFix.lon, c.latitude, c.longitude) / dtH;
  }
  lastFix = { t: pos.timestamp, lat: c.latitude, lon: c.longitude };
  // A jump bigger than you could have driven (tunnel, long GPS gap, back from a detour) is a teleport:
  // don't stamp or narrate everything in between.
  const maxDrive = dtH != null && dtH > 0 ? Math.max(3, (Math.max(speed ?? 0, 85)) * dtH * 1.5 + 1) : 3;
  const jumped = wasOff || S.m == null || Math.abs(hit.m - S.m) > maxDrive;
  if (jumped) { anchorM = null; dirVotes = []; }
  // direction: GPS heading first, else movement along the road
  let dir = null;
  if (c.heading != null && !isNaN(c.heading) && (speed ?? 0) > 6) dir = geo.dirFromHeading(c.heading, hit.m);
  if (!dir) {
    if (anchorM == null) anchorM = hit.m;
    if (Math.abs(hit.m - anchorM) > 0.15) { dir = hit.m > anchorM ? "N" : "S"; anchorM = hit.m; }
  }
  if (dir) {
    dirVotes.push(dir); if (dirVotes.length > 3) dirVotes.shift();
    dir = dirVotes.filter(d => d === dir).length >= 2 || dirVotes.length < 2 ? dir : null;
  }
  setPosition(hit.m, { speed, dir, offRoute: false, jumped });
}

/* Demo drive */
let demoTimer = null, demoX = 10;
function startDemo() {
  voice.unlock();
  stopAll(true);
  if (S.m == null || S.m < 1 || S.m > MAX_M - 1) S.m = S.dir === "N" ? 205 : Math.min(815, MAX_M - 7);
  setMode("demo");
  greet("This is a demo drive. I'll pretend we're driving so you can hear how it works.");
  let m = S.m;
  setPosition(m, { speed: 65, jumped: true });
  demoTimer = setInterval(() => {
    m += (S.dir === "N" ? 1 : -1) * 65 * demoX / 3600 * 0.5;
    if (m >= MAX_M || m <= 0) { m = Math.max(0, Math.min(MAX_M, m)); S.dir = S.dir === "N" ? "S" : "N"; }
    setPosition(m, { speed: 65 });
  }, 500);
}

function greet(extra = "") {
  voice.say(`Hi, I'm your I-5 buddy. I'll tell you about what's coming up as we drive. ${extra}`, { now: true, id: "greet", prio: 3 });
}

function stopAll(silent = false) {
  if (watchId != null) (window.__I5_FAKE_GEO__ || navigator.geolocation).clearWatch(watchId);
  clearInterval(demoTimer);
  watchId = null; demoTimer = null; dirVotes = []; anchorM = null; lastFix = null; offCount = 0;
  // A new session starts on the road until two far fixes say otherwise (otherwise a trip that ended off the road
  // would keep "off route" and never notice going off again).
  drove = false; offEnd = null; S.offRoute = false;
  if (!silent) {
    if (S.mode !== "off") bus.emit("trip:end", {});
    voice.stop();
    S.speed = null;
    setMode("off");
  }
  resetTrip();
}

/* Keep the screen awake while driving */
let wake = null;
async function requestWake() { try { if (!wake) { wake = await navigator.wakeLock?.request("screen"); wake?.addEventListener?.("release", () => { wake = null; }); } } catch { wake = null; } }
function releaseWake() { try { wake && wake.release(); } catch {} wake = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.mode !== "off") requestWake(); });

/* ---------- rendering: Drive ---------- */
function setPill(s, text) { const p = $("statusPill"); p.dataset.s = s; p.textContent = text; }
let tab = "drive";

function render() {
  const has = S.m != null;
  const st = has ? stateAt(S.m) : null;
  $("dirBadge").textContent = S.dir === "N" ? "NORTH" : "SOUTH";
  $("stateBadge").hidden = !has;
  if (has) $("stateBadge").textContent = st.id;
  if (has) {
    const lm = localMile(S.m);
    $("mile").textContent = Math.round(lm.mi);
    $("mileLabel").textContent = st.id === "CA" ? "MILE" : `${st.id} MILE`;
    const z = zoneAt(S.m);
    $("nearText").textContent = z ? z.label : regionAt(S.m).name;
    const ft = elevAt(S.m);
    $("elevText").textContent = ft != null ? `${ft.toLocaleString()} ft` : "";
    const toEnd = S.dir === "N" ? MAX_M - S.m : S.m;
    const sun = sunInfo();
    $("toEndText").textContent = (sun ? sun + " · " : "") + `${Math.round(toEnd).toLocaleString()} mi to ${S.dir === "N" ? ENDS.N.short : ENDS.S.short}`;
  } else {
    $("mile").textContent = "--";
  }
  $("speed").textContent = S.speed != null && S.mode !== "manual" && S.mode !== "off" ? Math.round(S.speed) : "--";

  if (S.mode === "gps") {
    if (S.offRoute) {
      const end = atEnd();
      setPill("off-route", end ? "THE END" : "OFF I-5");
      $("statusText").textContent = end ? `Past ${end.long}. Narration paused.` : "Not on I-5 right now. Narration paused.";
    }
    else if (has) { setPill("gps", "GPS"); $("statusText").textContent = regionAt(S.m).name; }
  } else if (S.mode === "demo") { setPill("demo", "DEMO"); $("statusText").textContent = "Demo drive · " + (has ? regionAt(S.m).name : ""); }
  else if (S.mode === "manual") { setPill("manual", "MANUAL"); $("statusText").textContent = "Milepost set by hand"; }
  else { setPill("off", "OFF"); $("statusText").textContent = has ? "Paused · " + regionAt(S.m).name : `${ENDS.S.short} to ${ENDS.N.short}`; }

  $("toggleNarr").setAttribute("aria-pressed", settings.narr);
  $("toggleNarr").textContent = settings.narr ? "Narration on" : "Narration off";
  renderRibbon(); renderNext(); renderUpNext(); renderServices();
  if (tab === "ahead") renderAhead();
}

/* sunrise / sunset on the sign, recomputed at most every 5 minutes */
let sunCache = { t: 0, ev: null }, sunSpoken = null;
function sunInfo() {
  if (S.m == null) return "";
  const now = Date.now();
  if (now - sunCache.t > 5 * 60 * 1000) {
    const [lat, lon] = S.lat != null ? [S.lat, S.lon] : geo.coordAt(S.m);
    sunCache = { t: now, ev: geo.nextSunEvent(lat, lon) };
  }
  const ev = sunCache.ev;
  if (!ev) return "";
  const mins = Math.round((ev.at - now) / 60000);
  if (mins < 0 || mins > 120) return "";
  const time = ev.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (ev.type === "sunset" && mins <= 20 && S.mode === "gps" && !S.offRoute && settings.narr && sunSpoken !== ev.at.toDateString()) {
    sunSpoken = ev.at.toDateString();
    voice.say(`The sun sets in about ${Math.max(5, Math.round(mins / 5) * 5)} minutes, at ${time}. Headlights on soon.`, { id: "sunset", prio: 0 });
  }
  return `${ev.type === "sunset" ? "Sunset" : "Sunrise"} ${time}`;
}

/* glance mode: big type, fewer extras, for a phone mounted on the dash */
function setGlance(on) {
  document.body.classList.toggle("glance", on);
  store.set("glance", on);
  $("glanceBtn").setAttribute("aria-pressed", on);
  $("glanceBtn").title = on ? "Show everything" : "Glance mode: big text only";
}

let ribbonBuilt = false;
function renderRibbon() {
  const r = $("ribbon");
  if (!ribbonBuilt) {
    r.innerHTML = "";
    const track = el("div", "track");
    for (const s of STATES) {
      const seg = el("div", "seg-" + s.id.toLowerCase());
      seg.style.left = (s.from / MAX_M * 100) + "%"; seg.style.width = ((s.to - s.from) / MAX_M * 100) + "%";
      track.append(seg);
    }
    r.append(track, el("div", "done"));
    const frag = document.createDocumentFragment();
    for (const p of PLACES) { const t = el("i", "tick"); t.style.left = (p.m / MAX_M * 100) + "%"; t.dataset.id = p.id; frag.append(t); }
    r.append(frag);
    for (const s of STATES) {
      const l = el("span", "lbl", s.id); l.style.left = ((s.from + s.to) / 2 / MAX_M * 100) + "%"; r.append(l);
    }
    r.append(el("div", "you"));
    ribbonBuilt = true;
  }
  const pct = S.m == null ? 0 : S.m / MAX_M * 100;
  const you = r.querySelector(".you");
  you.hidden = S.m == null; you.style.left = pct + "%";
  r.querySelector(".done").style.width = pct + "%";
  if (renderRibbon.stampCount !== Object.keys(S.stamps).length) {
    renderRibbon.stampCount = Object.keys(S.stamps).length;
    for (const t of r.querySelectorAll(".tick")) t.classList.toggle("got", !!S.stamps[t.dataset.id]);
  }
}

let shownNext = null;
function renderNext() {
  const card = $("nextCard");
  if (S.m == null) {
    if (shownNext === "welcome") return;
    shownNext = "welcome";
    card.className = "next welcome"; card.innerHTML = "";
    const names = STATES.map(s => s.name);
    const states = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
    const h2 = el("h2", null, `Your guide to all ${Math.round(MAX_M).toLocaleString()} miles of I-5${SCOPE.length === 1 ? " in " + STATES[0].name : ""}`);
    h2.tabIndex = -1; // takes the focus when the Install app button under it goes away (updateInstall)
    // Install app, or the iPhone tip (updateInstall), right under the headline: in a phone's browser tab, which is
    // shorter than the screen, that keeps it above the tab bar.
    const inst = el("div", "welcome-install"); inst.hidden = true;
    card.append(el("div", "meta", `${ENDS.S.short} to ${ENDS.N.short}`.toUpperCase()), h2, inst,
      el("p", null, `${PLACES.length} landmarks, orchards and stories through ${states}. Tap Start GPS on the road, or take a demo drive from the couch.`));
    const stats = el("div", "welcome-stats");
    for (const [n, l] of [[PLACES.length, "landmarks"], [data.CAMS.length, "live cameras"], [data.SERVICES.length, "exits with services"]]) {
      const s = el("div"); s.append(el("b", null, n.toLocaleString()), el("span", null, l)); stats.append(s);
    }
    card.append(stats);
    const by = el("a", "byline", "I-5 Buddy is made by Dominares · i5.dominares.org");
    by.href = "https://dominares.org/"; by.target = "_blank"; by.rel = "noopener";
    card.append(by);
    updateInstall();
    return;
  }
  // Nothing left this way, or GPS has us past an end of the road: the end-of-the-road card. (Past the end, the last
  // landmark sits right at the line, the 42nd parallel or the San Ysidro port, and would otherwise stay at "NOW".)
  const end = atEnd();
  const x = end ? null : upcoming(S.m, S.dir, null)[0];
  if (!x) {
    const e = end || (S.dir === "N" ? ENDS.N : ENDS.S);
    if (shownNext === "end:" + e.short) return;
    shownNext = "end:" + e.short;
    card.className = "next"; card.innerHTML = "";
    card.append(el("div", "meta", "END OF THE ROAD"), el("h2", null, `You made it to ${e.long}`), el("p", null, "That's every stop in this direction. Turn around for the other side of the story."));
    return;
  }
  const { p, d } = x;
  if (shownNext !== p.id) {
    shownNext = p.id;
    card.className = "next " + p.cat; card.innerHTML = "";
    const ph = photo(p, "hero"); if (ph) card.append(ph);
    const body = el("div", "next-body");
    const meta = el("div", "meta");
    meta.append(el("span", null, CATS[p.cat]), el("span", null, exitName(p.st, p.ex)));
    const count = el("div", "count");
    count.append(el("span", "n"), el("small", "unit", "mi"), el("small", "eta"), el("span", "side"));
    const acts = el("div", "acts");
    const b1 = el("button", null, "▶ Play"); b1.onclick = () => { voice.unlock(); markHeard(p.id); voice.say(announceText(p, Math.max(0, aheadOf(S.m, S.dir, p.m))), { now: true, id: p.id, chime: true }); };
    const b2 = el("button", null, "Tell me more"); b2.onclick = () => { voice.unlock(); tellMore(p); };
    const b3 = el("button", "ico"); b3.setAttribute("aria-label", "Next landmark"); b3.title = "Next landmark";
    b3.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l9-7-9-7Zm10 0h3v14h-3V5Z" fill="currentColor"/></svg>';
    b3.onclick = () => { voice.unlock(); narrator.nextOne(); };
    const b4 = el("button", "ico"); b4.setAttribute("aria-label", "Stop talking"); b4.title = "Stop talking";
    b4.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
    b4.onclick = () => voice.stop();
    acts.append(b1, b2, b3, b4);
    const h = el("h2", null, p.name);
    h.tabIndex = 0; h.onclick = () => placeSheet(p);
    body.append(meta, count, h, el("p", null, p.text), acts);
    card.append(body);
  }
  card.querySelector(".n").textContent = d < 0.3 ? "NOW" : fmtMiles(d);
  card.querySelector(".unit").hidden = d < 0.3;
  const eta = card.querySelector(".eta");
  const mins = S.speed && S.speed > 15 && S.mode !== "manual" ? d / S.speed * 60 : null;
  eta.textContent = mins != null && d >= 0.3 ? (mins < 1 ? "· under a min" : `· ${Math.round(mins)} min`) : "";
  const sw = sideWord(p, S.dir);
  card.querySelector(".side").textContent = sw ? (sw === "left" ? "◀ LEFT" : "RIGHT ▶") : "";
}
bus.on("speaking", s => {
  document.body.classList.toggle("talking", !!s);
  const c = $("nextCard");
  if (s && c && s.id === shownNext) { c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); }
});

function renderUpNext() {
  const box = $("upNext");
  if (S.m == null) { box.hidden = true; return; }
  const list = upcoming(S.m, S.dir, null).slice(1, 6);
  box.hidden = !list.length;
  const ol = $("upNextList");
  const key = list.map(x => x.p.id).join("|") + Math.round(S.m * 2);
  if (ol.dataset.key === key) return;
  ol.dataset.key = key; ol.innerHTML = "";
  for (const { p, d } of list) {
    const li = el("li", p.cat);
    li.append(el("span", "d", fmtMiles(d)));
    const b = el("span", "nm", p.name);
    const sw = sideWord(p, S.dir);
    li.append(b, el("span", "sd", sw === "left" ? "◀" : sw === "right" ? "▶" : ""));
    li.tabIndex = 0;
    li.onclick = () => placeSheet(p);
    li.onkeydown = e => { if (e.key === "Enter") placeSheet(p); };
    ol.append(li);
  }
}

function renderServices() {
  const row = $("svcRow");
  if (S.m == null) { row.hidden = true; return; }
  const key = Math.round(S.m) + S.dir;
  if (row.dataset.key === key) return;
  row.dataset.key = key;
  const g = $("svcGrid"); g.innerHTML = "";
  const items = [
    ["⛽", "Gas", servicesAhead(S.m, S.dir, "fuel", 1)[0], "fuel"],
    ["⚡", "EV charging", servicesAhead(S.m, S.dir, "ev", 1)[0], "ev"],
    ["🍴", "Food", servicesAhead(S.m, S.dir, "food", 1)[0], "food"],
    ["🛏", "Lodging", servicesAhead(S.m, S.dir, "sleep", 1)[0], "sleep"],
    ["🚻", "Rest area", restAhead(S.m, S.dir, 1)[0], "rest"],
  ];
  let any = false;
  for (const [icon, label, s, kind] of items) {
    const b = el("button", "svc-item");
    b.append(el("span", "ic", icon));
    const t = el("span", "tx");
    if (s) {
      any = true;
      t.append(el("b", null, `${Math.max(1, Math.round(s.d))} mi`), el("small", null, kind === "rest" ? s.name.replace(/\s*\((north|south)bound\)/i, "") : `${label} · ${exitName(s.st, s.ref)}`));
      if (kind !== "rest" && s[kind]?.length) t.append(el("small", "brands", s[kind].slice(0, 3).join(", ")));
    } else {
      t.append(el("b", null, "—"), el("small", null, `No ${label.toLowerCase()} listed nearby`));
    }
    b.append(t);
    b.onclick = () => { voice.unlock(); narrator.tellServices(kind); };
    g.append(b);
  }
  row.hidden = !any;
}

/* ---------- place details sheet ---------- */
function placeSheet(p) {
  const sh = $("moreSheet");
  sh.innerHTML = "";
  sh.className = "sheet place-sheet " + p.cat;
  const head = el("div", "sheet-head");
  head.append(el("b", null, p.name));
  const close = el("button", "link", "Close"); close.onclick = closeSheet; head.append(close);
  sh.append(head);
  const ph = photo(p, "full"); if (ph) sh.append(ph);
  const sw = S.m != null ? sideWord(p, S.dir) : "";
  const d = S.m != null ? aheadOf(S.m, S.dir, p.m) : null;
  sh.append(el("div", "meta", [CATS[p.cat], exitName(p.st, p.ex), sw && `on the ${sw}`, d != null && (d >= 0 ? `${fmtMiles(d)} mi ahead` : `${fmtMiles(-d)} mi behind`), S.stamps[p.id] && "stamped ✓"].filter(Boolean).join(" · ")));
  sh.append(el("p", "lead", p.text));
  if (p.more) sh.append(el("p", null, p.more));
  if (p.spot) sh.append(el("p", "spot", "I spy: " + p.spot));
  const acts = el("div", "acts");
  const h1 = el("button", "primary", "Hear it"); h1.onclick = () => { voice.unlock(); hear(p); };
  acts.append(h1);
  if (p.more) { const h2 = el("button", "secondary", "Tell me more"); h2.onclick = () => { voice.unlock(); tellMore(p); }; acts.append(h2); }
  sh.append(acts);
  const src = el("p", "fine");
  for (const u of [p.src, p.src2].filter(Boolean)) {
    const a = el("a", null, (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } })());
    a.href = u; a.target = "_blank"; a.rel = "noopener";
    src.append("Source: ", a, " ");
  }
  if (p.lat != null) {
    const a = el("a", null, "Open in Maps");
    a.href = `https://maps.apple.com/?ll=${p.lat},${p.lon}&q=${encodeURIComponent(p.name)}`; a.target = "_blank"; a.rel = "noopener";
    src.append(" · ", a);
  }
  sh.append(src);
  openSheet(sh);
}

/* ---------- Ahead tab ---------- */
const listCats = new Set(Object.keys(CATS));
let aheadMode = "places", aheadLimit = 60;
function chipRow(container, set, onChange) {
  container.innerHTML = "";
  for (const [k, v] of Object.entries(CATS)) {
    const b = el("button", "chip " + k);
    b.setAttribute("aria-pressed", set.has(k));
    b.append(el("i"), document.createTextNode(v));
    b.onclick = () => { set.has(k) ? set.delete(k) : set.add(k); b.setAttribute("aria-pressed", set.has(k)); onChange(); };
    container.append(b);
  }
}
function renderAhead() {
  const ol = $("aheadList");
  const m = S.m ?? (S.dir === "N" ? 0 : MAX_M);
  $("chips").hidden = aheadMode !== "places";
  if (aheadMode === "stops") return renderStops(ol, m);
  $("aheadTitle").textContent = S.m == null ? "Every stop, south to north" : `Coming up ${S.dir === "N" ? "northbound" : "southbound"}`;
  const items = upcoming(m, S.m == null ? "N" : S.dir, listCats);
  const key = items.length + ":" + (items[0]?.p.id || "") + ":" + aheadLimit + ":" + Math.round(m) + [...listCats].join();
  if (ol.dataset.key === key) return;
  ol.dataset.key = key; ol.innerHTML = "";
  if (!items.length) { ol.append(el("li", "empty", "Nothing ahead with these filters.")); $("aheadMore").hidden = true; return; }
  let lastState = null;
  for (const { p, d } of items.slice(0, aheadLimit)) {
    if (p.st !== lastState && STATES.length > 1) { // state headings only when the road covers more than one state
      lastState = p.st;
      const sep = el("li", "state-sep", STATES.find(s => s.id === p.st).name);
      ol.append(sep);
    }
    const li = el("li", "row " + p.cat);
    const dd = el("div", "d", d < 0.3 ? "now" : Math.round(d)); if (d >= 0.3) dd.append(el("small", null, "mi"));
    const body = el("div", "body");
    const sw = sideWord(p, S.dir);
    body.append(el("div", "m", [CATS[p.cat], exitName(p.st, p.ex), sw && (sw === "left" ? "◀ left" : "right ▶")].filter(Boolean).join(" · ")),
      el("b", null, p.name), el("p", null, p.text));
    const row = el("div", "rowacts");
    const hb = el("button", "link", "Hear it"); hb.onclick = e => { e.stopPropagation(); voice.unlock(); hear(p); };
    row.append(hb);
    if (p.more) { const mb = el("button", "link", "More"); mb.onclick = e => { e.stopPropagation(); placeSheet(p); }; row.append(mb); }
    if (S.stamps[p.id]) row.append(el("span", "got", "Stamped ✓"));
    body.append(row);
    li.append(dd, body);
    const th = photo(p, "thumb"); if (th) li.append(th);
    li.onclick = () => placeSheet(p);
    ol.append(li);
  }
  $("aheadMore").hidden = items.length <= aheadLimit;
}
function renderStops(ol, m) {
  $("aheadTitle").textContent = "Gas, food and rest ahead";
  const key = "stops:" + Math.round(m) + S.dir;
  if (ol.dataset.key === key) return;
  ol.dataset.key = key; ol.innerHTML = "";
  const dir = S.m == null ? "N" : S.dir;
  const list = (dir === "N" ? data.SERVICES : [...data.SERVICES].reverse()).map(s => ({ s, d: aheadOf(m, dir, s.m) })).filter(x => x.d > 0.2 && x.d < 200);
  const rest = restAhead(m, dir, 6, 200);
  const all = [...list.map(x => ({ ...x, kind: "svc" })), ...rest.map(r => ({ s: r, d: r.d, kind: "rest" }))].sort((a, b) => a.d - b.d).slice(0, 60);
  for (const x of all) {
    const li = el("li", "row stop-row");
    const body = el("div", "body");
    if (x.kind === "rest") {
      body.append(el("div", "m", "Rest area"), el("b", null, x.s.name.replace(/\s*\((north|south)bound\)/i, "")));
    } else {
      body.append(el("div", "m", exitName(x.s.st, x.s.ref)));
      const lines = [["⛽", "fuel"], ["⚡", "ev"], ["🍴", "food"], ["🛏", "sleep"]].filter(([, k]) => x.s[k + "N"] > 0)
        .map(([ic, k]) => `${ic} ${x.s[k].slice(0, 4).join(", ")}${x.s[k + "N"] > 4 ? ` +${x.s[k + "N"] - 4}` : ""}`);
      const ex = data.EXITS.find(e => e[1] === x.s.st && e[2] === x.s.ref);
      if (ex && ex[3]) body.append(el("b", null, ex[3].split(";")[0]));
      for (const l of lines) body.append(el("p", null, l));
    }
    li.append(dd(x.d), body);
    ol.append(li);
  }
  if (!all.length) {
    const left = dir === "N" ? MAX_M - m : m; // the data stops at the end of the road
    ol.append(el("li", "empty", left < 200 ? `No services listed between here and ${(dir === "N" ? ENDS.N : ENDS.S).long}.` : "No services listed in the next 200 miles."));
  }
  $("aheadMore").hidden = true;
  function dd(d) { const e = el("div", "d", Math.max(1, Math.round(d))); e.append(el("small", null, "mi")); return e; }
}
$("aheadMore").onclick = () => { aheadLimit += 60; renderAhead(); };
$("aheadModePlaces").onclick = () => { aheadMode = "places"; $("aheadModePlaces").setAttribute("aria-pressed", true); $("aheadModeStops").setAttribute("aria-pressed", false); $("aheadList").dataset.key = ""; renderAhead(); };
$("aheadModeStops").onclick = () => { aheadMode = "stops"; $("aheadModePlaces").setAttribute("aria-pressed", false); $("aheadModeStops").setAttribute("aria-pressed", true); $("aheadList").dataset.key = ""; renderAhead(); };
chipRow($("chips"), listCats, () => { aheadLimit = 60; renderAhead(); });

/* ---------- tabs ---------- */
function go(name) {
  tab = name;
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll(".tabs button").forEach(b => b.dataset.go === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  if (name === "ahead") { $("aheadList").dataset.key = ""; renderAhead(); }
  bus.emit("tab", name);
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));

/* ---------- controls ---------- */
$("glanceBtn").onclick = () => setGlance(!document.body.classList.contains("glance"));
setGlance(store.get("glance", false));
$("startGps").onclick = startGps;
$("startDemo").onclick = startDemo;
$("stopTrip").onclick = () => stopAll(false);
$("toggleNarr").onclick = () => { settings.narr = !settings.narr; saveSettings(); if (!settings.narr) voice.stop(); queueRender(); };
$("lookLeft").onclick = () => { voice.unlock(); look("left"); };
$("lookRight").onclick = () => { voice.unlock(); look("right"); };
document.querySelectorAll("#demoBar [data-x]").forEach(b => b.onclick = () => {
  demoX = +b.dataset.x;
  document.querySelectorAll("#demoBar [data-x]").forEach(x => x.setAttribute("aria-pressed", x === b));
});
$("demoFlip").onclick = () => { S.dir = S.dir === "N" ? "S" : "N"; resetTrip(); shownNext = null; voice.stop(); setPosition(S.m, { jumped: true }); };

/* ---------- settings ---------- */
function syncSettingsUI() {
  const sel = $("voice");
  sel.innerHTML = "";
  const vs = voice.list();
  if (!vs.length) { const o = el("option", null, "Default voice"); o.value = ""; sel.append(o); }
  for (const v of vs) { const o = el("option", null, `${v.name} (${v.lang})`); o.value = v.voiceURI; sel.append(o); }
  sel.value = settings.voice || (vs[0]?.voiceURI ?? "");
  $("rate").value = settings.rate; $("rateOut").textContent = (+settings.rate).toFixed(2).replace(/0$/, "") + "×";
  $("lead").value = settings.lead; $("leadOut").textContent = settings.lead + " mi";
  document.querySelectorAll("[data-chat]").forEach(b => b.setAttribute("aria-pressed", b.dataset.chat === settings.chat));
  $("chatHint").textContent = { low: "Only things you can see and the big history.", normal: "Every landmark in the categories you pick.", high: "Everything, plus longer stories on quiet stretches." }[settings.chat];
  $("zoneNarr").checked = settings.zoneNarr; $("chimeOn").checked = settings.chime; $("kidMode").checked = settings.kid;
  $("liveOn").checked = !!settings.live;
  document.querySelectorAll("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themeSet === settings.theme));
  $("manual").max = Math.round(MAX_M);
  $("manual").value = Math.round(S.m ?? 300); $("manualOut").textContent = S.m != null ? Math.round(S.m) : "--";
  $("manN").setAttribute("aria-pressed", S.dir === "N"); $("manS").setAttribute("aria-pressed", S.dir === "S");
}
bus.on("voices", () => { if (!$("settings").hidden) syncSettingsUI(); });
$("openSettings").onclick = () => { syncSettingsUI(); updateInstall(); openSheet($("settings")); };
$("closeSettings").onclick = closeSheet;
$("voice").onchange = e => { settings.voice = e.target.value; saveSettings(); voice.unlock(); voice.say("This is how I'll sound on the road.", { now: true }); };
$("rate").oninput = e => { settings.rate = +e.target.value; $("rateOut").textContent = settings.rate.toFixed(2).replace(/0$/, "") + "×"; saveSettings(); };
$("lead").oninput = e => { settings.lead = +e.target.value; $("leadOut").textContent = settings.lead + " mi"; saveSettings(); };
document.querySelectorAll("[data-chat]").forEach(b => b.onclick = () => { settings.chat = b.dataset.chat; saveSettings(); syncSettingsUI(); });
$("zoneNarr").onchange = e => { settings.zoneNarr = e.target.checked; saveSettings(); };
$("chimeOn").onchange = e => { settings.chime = e.target.checked; saveSettings(); if (settings.chime) voice.chime(); };
$("kidMode").onchange = e => { settings.kid = e.target.checked; saveSettings(); };
$("liveOn").onchange = e => { settings.live = e.target.checked; saveSettings(); };
document.querySelectorAll("[data-theme-set]").forEach(b => b.onclick = () => { settings.theme = b.dataset.themeSet; saveSettings(); applyTheme(); syncSettingsUI(); });
chipRow($("narrChips"), settings.cats, saveSettings);
$("manual").oninput = e => {
  if (S.mode === "gps" || S.mode === "demo") stopAll(true);
  if (S.mode !== "manual") setMode("manual");
  S.speed = null; resetTrip(); voice.stop();
  $("manualOut").textContent = e.target.value;
  setPosition(+e.target.value, { jumped: true });
};
const setDir = d => { S.dir = d; store.set("dir", d); resetTrip(); shownNext = null; syncSettingsUI(); setPosition(S.m ?? (d === "N" ? 0 : MAX_M), { jumped: true }); };
$("manN").onclick = () => setDir("N"); $("manS").onclick = () => setDir("S");
$("resetPassport").onclick = () => { $("resetConfirm").hidden = false; };
$("resetNo").onclick = () => { $("resetConfirm").hidden = true; };
$("resetYes").onclick = () => {
  S.stamps = {}; saveStamps(); bus.emit("passport:reset", {});
  $("resetConfirm").hidden = true; toast("Passport cleared"); ribbonBuilt = false; queueRender();
};
$("dataVersion").textContent = `Data version ${data.D.version}.`;

/* ---------- install ---------- */
// Chrome and Edge offer to install the app with a beforeinstallprompt event; index.html keeps it in window.__i5Install
// (it can come before this module runs). While there is one, an Install app button shows in the welcome card and in
// Settings. iPhone and iPad have no such offer, so the welcome card shows a one-line tip instead; in an app's own
// browser (Instagram, Facebook and so on) Share has no Add to Home Screen, so the tip says to open the page in Safari.
// Both go away once the app is installed or is running as the installed app. Nothing is stored or sent anywhere.
const APP_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];
let installedHere = false; // the browser said "appinstalled" in this tab, or the person accepted its install dialog
let asking = false;        // the browser's install dialog is open
const runningInstalled = () => navigator.standalone === true || APP_MODES.some(m => matchMedia(`(display-mode: ${m})`).matches);
// read when needed, not once at load (tools/e2e.html tries an iPhone and an in-app browser)
const onIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1); // iPadOS says Macintosh
const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|GSA\/|Snapchat|Pinterest|Line\/|musical_ly|TikTok|Twitter/.test(navigator.userAgent);
const ICON_INSTALL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v7.2l3.3-3.3 1.4 1.4L12 15l-5.7-5.7 1.4-1.4 3.3 3.3V4ZM5 17h2v2h10v-2h2v4H5v-4Z" fill="currentColor"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 4.2 4.2-1.4 1.4L13 6.4V15h-2V6.4L9.2 8.2 7.8 6.8 12 2.6ZM5 10h4v2H7v8h10v-8h-2v-2h4v12H5V10Z" fill="currentColor"/></svg>';
const markBusy = (b, busy) => busy ? b.setAttribute("aria-disabled", "true") : b.removeAttribute("aria-disabled");
function updateInstall() {
  const installed = installedHere || runningInstalled();
  const offer = installed ? null : window.__i5Install || null;
  const busy = asking && !installed;
  const ios = !installed && onIOS(), inApp = ios && inAppBrowser();
  const was = document.activeElement; // an Install app button with the focus, which may go away below
  const hadFocus = was && (was.id === "installApp" || !!was.closest?.(".welcome-install")) ? was : null;
  const btn = $("installApp");
  btn.hidden = !offer && !busy; markBusy(btn, busy);
  const hint = $("installHint");
  hint.textContent = installed ? "Installed on this device." : offer || busy ? "" :
    inApp ? "To install: open this page in Safari, tap Share, then Add to Home Screen." :
    ios ? "To install: tap Share, then Add to Home Screen." : "To install: open the browser menu and choose Install app or Add to Home screen.";
  hint.hidden = !hint.textContent;
  const slot = document.querySelector("#nextCard .welcome-install");
  if (slot) {
    const want = offer || busy ? "offer" : inApp ? "inapp" : ios ? "ios" : "";
    if (slot.dataset.show !== want) {
      slot.dataset.show = want; slot.innerHTML = "";
      if (want === "offer") {
        const b = el("button", "secondary install-btn"); b.type = "button";
        b.innerHTML = ICON_INSTALL; b.append("Install app"); b.onclick = installApp;
        slot.append(b);
      } else if (want === "ios") {
        const tip = el("p", "install-tip", "Tip: tap Share");
        const ic = el("span", "ic"); ic.innerHTML = ICON_SHARE;
        tip.append(ic, ", then Add to Home Screen.");
        slot.append(tip);
      } else if (want === "inapp") slot.append(el("p", "install-tip", "Tip: open this page in Safari to add it to your Home Screen."));
      slot.hidden = !want;
    }
    const b = slot.querySelector("button");
    b && markBusy(b, busy);
  }
  // The focused Install app button went away (installed, or the offer was used): keep the focus where it was, on the
  // Settings line that replaces it, or on the welcome card's headline.
  if (hadFocus && (!hadFocus.isConnected || hadFocus.hidden)) {
    const to = hadFocus.id === "installApp" ? hint : document.querySelector("#nextCard.welcome h2");
    to && to.focus({ preventScroll: true });
  }
}
async function installApp() {
  const offer = window.__i5Install;
  if (!offer || asking) return;
  window.__i5Install = null; // each offer opens the browser's install dialog once
  asking = true; updateInstall(); // the button stays (busy) while the dialog is open, so the focus stays on it
  try {
    await offer.prompt();
    if ((await offer.userChoice)?.outcome === "accepted") installedHere = true;
  } catch {}
  asking = false;
  updateInstall(); // if they said no, the browser may offer again later (i5:install)
}
$("installApp").onclick = installApp;
addEventListener("i5:install", updateInstall);
addEventListener("appinstalled", () => { installedHere = true; window.__i5Install = null; updateInstall(); toast("I-5 Buddy is installed."); });
for (const m of APP_MODES) { try { matchMedia(`(display-mode: ${m})`).addEventListener("change", updateInstall); } catch {} }
updateInstall();

/* ---------- offline photos ---------- */
$("savePhotos").onclick = async () => {
  const urls = [...new Set(PLACES.filter(p => p.img).map(p => p.img.f))];
  if (!urls.length) { toast("No photos to save yet."); return; }
  if (!("caches" in window)) { toast("This browser can't save files for offline use."); return; }
  const btn = $("savePhotos"); btn.disabled = true;
  let done = 0;
  try {
    const cache = await caches.open("i5b-photos");
    for (let i = 0; i < urls.length; i += 8) {
      await Promise.all(urls.slice(i, i + 8).map(async u => {
        try { if (!(await cache.match(u))) await cache.add(u); } catch {}
        done++;
      }));
      $("offlineText").textContent = `Saving photos… ${done} of ${urls.length}`;
    }
    $("offlineText").textContent = `All ${urls.length} photos saved for offline use.`;
  } catch {
    $("offlineText").textContent = "Couldn't save photos. Try again with a better connection.";
  }
  btn.disabled = false;
};

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then(reg => {
    const show = () => { $("updateBar").hidden = false; };
    if (reg.waiting && navigator.serviceWorker.controller) show();
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      nw && nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) show(); });
    });
    $("updateBtn").onclick = () => { userAskedUpdate = true; (reg.waiting || reg.installing)?.postMessage("skipWaiting"); };
  }).catch(() => {});
  // Reload only when the user tapped "Reload" for a new version. On the very first visit the worker also takes
  // control of the page (clients.claim), and reloading then would interrupt whatever the user just started.
  let userAskedUpdate = false, reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (userAskedUpdate && !reloaded) { reloaded = true; location.reload(); } });
}

/* ---------- modules (each is optional: if one fails, the rest still work) ---------- */
export const api = {
  S, settings, saveSettings, bus, store, voice, narrator, data, geo,
  ui: { $, el, toast, go, openSheet, closeSheet, photo, placeSheet, queueRender },
  setPosition, setMode, startDemo, startGps, stopAll,
};
window.I5BUDDY = { api, locate: geo.locate, coordAt: geo.coordAt }; // for tools/test.html and the E2E harness

applyTheme();
render();
for (const name of ["live", "map", "play", "trip", "listen"]) {
  import(`./${name}.js`).then(mod => {
    try { mod.init(api); } catch (e) { console.error(`[${name}] init failed`, e); }
  }).catch(e => console.warn(`[${name}] not loaded`, e?.message || e));
}
