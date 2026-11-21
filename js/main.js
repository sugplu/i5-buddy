// I-5 Buddy: boot, GPS/demo/manual position, Drive and Ahead screens, settings, offline.
import { S, settings, saveSettings, bus, store, saveStamps, RETURNING } from "./store.js";
import * as data from "./data.js";
import * as geo from "./geo.js";
import { voice } from "./voice.js";
import { narrator, upcoming, announceText, tellMore, hear, look, resetTrip, markHeard, stampNear, stampSelf } from "./narrator.js";
import * as native from "./native.js";

const {
  PLACES, CATS, MAX_M, STATES, DESTS, ENDS, SCOPE, zoneAt, stateAt, localMile, regionAt, sideWord, aheadOf, elevAt,
  servicesAhead, restAhead, restName, exitName, fmtMiles, fmtDuration, placeById, detourShort, MISSIONS,
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
/* ---------- notices on Drive (3.0.1): what happened and what to do, until it no longer applies ---------- */
const notices = new Map(); // key -> {title, text, acts: [[label, fn]]}
function showNotice(key, n) { notices.set(key, n); drawNotices(); }
function hideNotice(key) { if (notices.delete(key)) drawNotices(); }
function drawNotices() {
  const box = $("driveNotice");
  if (!box) return;
  box.textContent = "";
  for (const [key, n] of notices) {
    const card = el("div", "notice notice-" + key);
    card.setAttribute("role", "status");
    card.append(el("b", null, n.title), el("p", null, n.text));
    if (n.acts && n.acts.length) {
      const row = el("div", "acts");
      for (const [label, fn] of n.acts) { const b = el("button", "secondary", label); b.type = "button"; b.onclick = fn; row.append(b); }
      card.append(row);
    }
    box.append(card);
  }
  box.hidden = !notices.size;
}

/* ---------- captions (3.0.1): what I-5 Buddy says, on screen on every tab, with Stop and Repeat ---------- */
let capHide = 0;
bus.on("speaking", s => {
  const box = $("caption");
  if (!box) return;
  clearTimeout(capHide);
  if (s && s.text) { $("captionText").textContent = s.text; box.hidden = false; document.body.classList.add("captioned"); }
  else capHide = setTimeout(() => { box.hidden = true; document.body.classList.remove("captioned"); }, 2500);
});
// the iPhone app turns other audio down while I-5 Buddy talks, and back up a moment after (not between two lines)
let duckT = 0;
bus.on("speaking", s => { clearTimeout(duckT); if (s) native.duck(true); else duckT = setTimeout(() => { if (!voice.isSpeaking()) native.duck(false); }, 1200); });
$("captionStop").onclick = () => { voice.stop(); clearTimeout(capHide); $("caption").hidden = true; document.body.classList.remove("captioned"); };
$("captionRepeat").onclick = () => { voice.unlock(); voice.repeat(); };

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
// The iPhone app: its own styles, its pages (privacy.html) in a sheet inside the app, About without links to other
// products. Nothing happens in a browser.
native.init({ store, toast, openSheet, closeSheet });

// a Caltrans rest-area status from tools/rest-status.json (data.REST[].status)
const REST_NOTE = { closed: "Closed, Caltrans says", partial: "Partly closed, Caltrans says", truck_only: "Trucks only, Caltrans says" };

/** A place photo with its credit. size: "hero" | "thumb" | "full". */
function photo(p, size = "hero") {
  if (!p.img) return null;
  const fig = el("figure", "photo " + size);
  const img = el("img");
  // alt (3.0.7): what the photo shows (alt_en from the 2026-11-20 photo check, tools/images.json); without it alt="",
  // because the Wikimedia titles used before read like file names ("Angelstadiummarch2019")
  img.src = p.img.f; img.alt = p.img.alt_en || ""; img.loading = "lazy"; img.decoding = "async";
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
  native.statusBar(t); // the iPhone app: status bar text that stays readable on this theme (no-op in a browser)
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
// The cruising speed for arrival times (3.0.4): an average of the last couple of minutes of driving over 20 mph, so a
// slow patch or one fast fix doesn't swing "about 3 h 13 min" by half an hour. S.speed stays the speed right now.
let cruiseN = 0;
function setPosition(m, { speed = null, dir = null, offRoute = false, jumped = false, save = true } = {}) {
  const prevM = S.m;
  if (dir) S.dir = dir;
  if (speed != null) S.speed = speed;
  if (speed != null && !jumped && !offRoute && speed > 20 && speed <= MAX_MPH) {
    cruiseN++;
    S.cruise = S.cruise == null ? speed : S.cruise + (speed - S.cruise) * Math.max(1 / 120, 1 / cruiseN);
  }
  S.m = Math.max(0, Math.min(MAX_M, m));
  S.offRoute = offRoute;
  // save: false = the closest point on I-5 to someone who hasn't been on it yet (GPS started at home): shown, not kept,
  // so the next launch doesn't open at a made-up spot on the road
  if (save) { store.set("m", S.m); store.set("dir", S.dir); }
  bus.emit("pos", { m: S.m, prevM, dir: S.dir, speed: S.speed, offRoute, jumped: jumped || prevM == null });
  queueRender();
}

function setMode(mode) {
  S.mode = mode;
  bus.emit("mode", mode);
  native.onMode(mode); // the iPhone app: the safety line on top of Drive while GPS runs
  const on = mode !== "off";
  $("startControls").hidden = on;
  $("runControls").hidden = !on;
  $("stopTrip").textContent = mode === "demo" ? "End demo" : "End trip";
  $("demoBar").hidden = mode !== "demo";
  // the screen stays on only while something moves: GPS or the demo (3.0.1; moving the milepost by hand used to hold it
  // on with nothing going on)
  if (mode === "gps" || mode === "demo") requestWake(); else releaseWake();
  if (on) { hideNotice("denied"); hideNotice("demo-done"); hideNotice("trip-saved"); }
  if (mode !== "gps") hideNotice("precise");
  bus.emit("mode:after", mode);
  queueRender();
}

/* GPS */
let watchId = null, dirVotes = [], anchorM = null, lastFix = null, offCount = 0;
// 3.0.1, from the long-drive audit:
const MAX_MPH = 100;          // the fastest a car is assumed to go (jump check, speeds worked out from two positions)
const COARSE_M = 250;         // a fix less accurate than this places you, but stamps nothing and votes no direction
const STALE_MS = 15e3;        // no usable fix for this long: the sign stops showing a live-looking speed
const NOT_ON_I5_MS = 10 * 60e3; // GPS on and never on I-5 for this long: the screen may sleep again
const STILL_MS = 20 * 60e3;   // stopped this long with GPS on: the screen may sleep again
const NEW_TRIP_MS = 3 * 3600e3; // a gap this long between fixes starts the narration over
// Off I-5 this long after the last fix on it, the drive is over: a gas stop or a meal keeps the last mile on the road;
// a day somewhere else does not (3.0.2, a real report: the card said "3.2 mi, Wheeler Ridge" all day, off I-5).
const DETOUR_MS = 45 * 60e3;
const RESUME_MS = 45 * 60e3;  // a drive cut off by a reload (the page or web view restarted) can be resumed this long
let lastGoodT = 0, fuzzyN = 0, gpsStartT = 0, lastAnyFixT = 0, stillSince = 0, driveSavedT = 0;
// The two ends of the covered road (ENDS.S = Mexico; ENDS.N = the Oregon line while the data covers California only).
// offEnd: the end we went off the road past (decided once, at the fix that took us off; the status line and the
// next card show it). endSaid: the end we said goodbye at. drove: this GPS session has had a fix on the road.
let offEnd = null, endSaid = null, drove = false, lastOnRouteFixT = 0;
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
// Tests can inject a fake GPS; the iPhone app uses the phone's own location service (native.js), else the browser's.
const geoSource = () => window.__I5_FAKE_GEO__ || native.geolocation() || navigator.geolocation;
function startGps() {
  if (native.safetyFirst(startGps)) return; // the iPhone app's first Start GPS: the safety line in a sheet first
  voice.unlock();
  const G = geoSource();
  if (!G) { toast("This browser can't share your location."); return; }
  const resuming = S.resumable;
  stopAll(true);
  S.resumable = false;
  hideNotice("resume");
  $("startGps").textContent = "Start GPS";
  setMode("gps");
  setPill("wait", "GPS");
  $("statusText").textContent = "Finding you…";
  // the direction is unknown until the car moves (3.0.1): the one saved is from the last trip
  S.dirSure = false;
  gpsStartT = lastGoodT = Date.now(); fuzzyN = 0; stillSince = 0; S.gpsStale = false; driveSavedT = 0;
  if (!resuming) greet();
  gpsGotFix = false; deniedSince = 0;
  watchGps();
}
// 3.0.6 (a real report, "looks stuck"): in the middle of a drive iOS can report "location denied" for a moment (the app
// coming back from the background, location services restarting). That used to END the drive: GPS off, "Paused", until
// someone tapped Start GPS at 70 mph. Now only a refusal before the first fix ends it; mid-drive the drive stays on,
// the sign says it is waiting, and GPS is asked again every few seconds (the way out shows after 2 minutes of refusals).
let gpsGotFix = false, deniedSince = 0, rewatchTimer = 0;
function watchGps() {
  const G = geoSource();
  if (!G || S.mode !== "gps") return;
  if (watchId != null) { try { G.clearWatch(watchId); } catch {} }
  clearTimeout(rewatchTimer);
  watchId = G.watchPosition(pos => { gpsGotFix = true; deniedSince = 0; hideNotice("denied"); onFix(pos); }, err => {
    if (err.code === 1 && !gpsGotFix) {
      // a card that stays, with the way out (3.0.1): the toast used to vanish after 5 s and leave a dead end
      stopAll();
      showDenied(err);
      return;
    }
    $("statusText").textContent = "Waiting for a GPS signal…";
    if (err.code === 1) {
      if (!deniedSince) deniedSince = Date.now();
      else if (Date.now() - deniedSince > 120e3) showDenied(err);
      S.gpsStale = true; queueRender();
      rewatchTimer = setTimeout(watchGps, 5000);
    }
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
}
/** Location refused or turned off: what happened and what to do, until the person does something. */
function showDenied(err) {
  bus.emit("trouble", { why: "location" });
  const acts = [];
  if (native.NATIVE) acts.push(["Open Settings", () => native.openSettings()]);
  acts.push(["Take a demo drive", () => { hideNotice("denied"); startDemo(); }]);
  if (api.feedback && api.feedback.open) acts.push(["Send feedback", () => api.feedback.open()]);
  showNotice("denied", {
    title: native.NATIVE ? "Location is off for I-5 Buddy" : "Location is blocked",
    text: native.NATIVE ? native.locationOffText(err) : "Allow location for this site in your browser's settings, then tap Start GPS again. Or take a demo drive to hear how it works.",
    acts,
  });
}
function onFix(pos) {
  const c = pos.coords;
  if (c.accuracy && c.accuracy > 1500) { // too fuzzy to place you on the road
    bus.emit("fix", { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, m: null, dist: null, offRoute: !!S.offRoute, fuzzy: true });
    // Two in a row: almost always Precise Location turned off for the app (iPhone) or the site. Say so (3.0.1); before,
    // the app waited for a GPS signal forever without a word.
    if (++fuzzyN >= 2) showPrecise(c.accuracy);
    return;
  }
  fuzzyN = 0; hideNotice("precise");
  lastGoodT = Date.now();
  if (S.gpsStale) { S.gpsStale = false; queueRender(); }
  // a long gap (the phone sat in the car overnight with the app open): a new trip for the narration
  if (lastAnyFixT && pos.timestamp - lastAnyFixT > NEW_TRIP_MS) { resetTrip(); S.dirSure = false; drove = false; }
  lastAnyFixT = pos.timestamp;
  S.lat = c.latitude; S.lon = c.longitude; S.accuracy = c.accuracy;
  const hit = geo.locate(c.latitude, c.longitude, S.m);
  // Far from I-5: don't move the marker. Two far fixes in a row = off route (one could be a GPS glitch). Past either end
  // of the road by more than about 200 m counts as off it too (3.0.1): in the border line at San Ysidro the car is
  // still in Mexico, though within the on-road radius of the road's first point.
  const R = data.ROUTE, LAT_200M = 0.0018;
  const pastLine = R.length > 1 && (c.latitude < R[0][1] - LAT_200M || c.latitude > R[R.length - 1][1] + LAT_200M);
  const far = hit.m == null || pastLine || hit.dist > Math.max(1.2, (c.accuracy || 0) / 1609 * 1.5);
  // A turn-off place (a mission a few miles off I-5) is stamped when GPS really gets there, on I-5 or off it.
  stampNear(c.latitude, c.longitude, c.accuracy);
  // Every fix goes to the modules, also off I-5 (js/missions.js: the visit card at a mission far from the road).
  const mis = nearMission(c.latitude, c.longitude);
  const wasNear = S.nearMission;
  S.nearMission = mis;
  bus.emit("fix", { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy ?? null, m: hit.m, dist: hit.dist, offRoute: far,
    speed: c.speed != null && c.speed >= 0 ? c.speed * 2.23694 : null, heading: c.heading != null && !isNaN(c.heading) ? c.heading : null, t: pos.timestamp }); // speed (mph) and heading (deg) are for js/nav.js
  if (mis) bus.emit("mission:near", { place: mis.place, n: mis.place.n, dist: mis.dist, offRoute: far });
  S.offDist = far && hit.m != null && isFinite(hit.dist) ? hit.dist : null;   // miles from I-5 while off it (status line, Where to?)
  if (far) {
    offCount++;
    // the drive on I-5 is over after DETOUR_MS off it: from here on it is "not on I-5", with the closest point
    if (drove && pos.timestamp - lastOnRouteFixT > DETOUR_MS) drove = false;
    lastFix = null; anchorM = null; dirVotes = [];
    // GPS on, never on I-5 for 10 minutes, and no directions running: let the screen sleep (it can be left at home)
    if (!drove && S.mode === "gps" && Date.now() - gpsStartT > NOT_ON_I5_MS && !(api.nav && api.nav.statusText && api.nav.statusText())) releaseWake();
    if (offCount >= 2 && !S.offRoute) {
      // Off I-5 after driving on it this session: keep the last mile on the road (a detour, a gas stop). Off I-5 since
      // the app opened: the saved spot is from an earlier trip (2026-11-17: someone on I-15 near Lake Elsinore was told
      // she was at the Grapevine, where she had left I-5 the day before), so use the closest point on I-5 instead,
      // shown but not saved (3.0.1). Nowhere near I-5 (no road within about 170 miles): no spot at all, never mile 0.
      // past an end of the road: the marker sits on that end (the border line, the Oregon line)
      const endM = pastLine ? (c.latitude < R[0][1] ? R[0][0] : MAX_M) : null;
      if (drove) setPosition(endM ?? S.m ?? hit.m ?? 0, { offRoute: true, jumped: true });
      else if (hit.m != null) setPosition(hit.m, { offRoute: true, jumped: true, save: false });
      else { S.offRoute = true; bus.emit("pos", { m: S.m, prevM: S.m, dir: S.dir, speed: S.speed, offRoute: true, jumped: true }); queueRender(); }
      offEnd = pastEnd();
      // Say goodbye once, and only after driving there (not when GPS starts up already past the end).
      if (offEnd && drove && endSaid !== offEnd && settings.narr) {
        endSaid = offEnd;
        voice.say(`That's ${offEnd.long}, the end of the road for I-5 Buddy. Thanks for riding along.`, { id: "end-of-road", prio: 2, chime: "success" });
      }
    } else if (S.offRoute && !drove && !pastLine && hit.m != null && (S.m == null || Math.abs(hit.m - S.m) > 1)) {
      // off I-5 and not on a detour: the closest point follows you (it was set once and then stood still)
      setPosition(hit.m, { offRoute: true, jumped: true, save: false });
      if (mis) offEnd = null;
    } else if (S.offRoute && (mis || wasNear)) { if (mis) offEnd = null; queueRender(); } // "Near Mission ..." follows you
    else if (S.offRoute) queueRender();
    return;
  }
  if (!drove) requestWake(); // back on: the screen stays on again (it may have been let go while far from I-5)
  drove = true; offEnd = null; lastOnRouteFixT = pos.timestamp;
  // A fix that bounces back near the line (GPS noise) must not set up a second goodbye: forget it only once we are
  // back on the road more than 3 miles from that end.
  if (endSaid && (endSaid === ENDS.N ? hit.m < MAX_M - 3 : hit.m > data.ROUTE[0][0] + 3)) endSaid = null;
  const wasOff = offCount >= 2 || S.offRoute;
  offCount = 0;
  // A fix less accurate than about 250 m (a Wi-Fi or cell fix) moves the marker, but stamps nothing, votes no direction
  // and leaves the speed alone (3.0.1).
  const coarse = (c.accuracy || 0) > COARSE_M;
  // speed: the phone's own, else worked out from two positions, but only over 3 s or more between two accurate fixes
  // and never above 100 mph. (One fix without a speed, an iPhone's cell fix right after a dropout, used to turn into a
  // made-up speed of hundreds of mph and pull up to 180 miles of landmarks into one announcement.)
  let speed = c.speed != null && c.speed >= 0 ? c.speed * 2.23694 : null;
  let dtH = null;
  if (lastFix) {
    dtH = (pos.timestamp - lastFix.t) / 3.6e6;
    if (speed == null && dtH * 3600 >= 3 && !coarse && lastFix.acc != null && lastFix.acc <= 50 && (c.accuracy ?? Infinity) <= 50) {
      speed = Math.min(MAX_MPH, geo.miles(lastFix.lat, lastFix.lon, c.latitude, c.longitude) / dtH);
    }
  }
  lastFix = { t: pos.timestamp, lat: c.latitude, lon: c.longitude, acc: c.accuracy ?? null };
  // A jump bigger than you could have driven (tunnel, long GPS gap, back from a detour) is a teleport:
  // don't stamp or narrate everything in between. The top speed here is fixed, never a speed from the fix itself.
  const maxDrive = dtH != null && dtH > 0 ? Math.max(3, MAX_MPH * dtH * 1.5 + 1) : 3;
  const teleport = wasOff || S.m == null || Math.abs(hit.m - S.m) > maxDrive;
  const jumped = teleport || coarse;
  if (teleport) { anchorM = null; dirVotes = []; }
  // direction: GPS heading first, else movement along the road; "sure" once a heading at speed or two movements agree
  let dir = null, sure = false;
  if (!coarse) {
    if (c.heading != null && !isNaN(c.heading) && (speed ?? 0) > 6) { dir = geo.dirFromHeading(c.heading, hit.m); sure = !!dir; }
    if (!dir) {
      if (anchorM == null) anchorM = hit.m;
      if (Math.abs(hit.m - anchorM) > 0.15) { dir = hit.m > anchorM ? "N" : "S"; anchorM = hit.m; }
    }
    if (dir) {
      dirVotes.push(dir); if (dirVotes.length > 3) dirVotes.shift();
      const agree = dirVotes.filter(d => d === dir).length;
      if (agree >= 2) sure = true;
      dir = agree >= 2 || dirVotes.length < 2 ? dir : null;
    }
  }
  if (sure) S.dirSure = true;
  // a long stop (traffic, a meal with the phone on the dash): after 20 minutes the screen may sleep; moving again wakes it
  const sp = coarse ? null : speed;
  if (sp != null && sp < 3) { if (!stillSince) stillSince = Date.now(); else if (Date.now() - stillSince > STILL_MS) releaseWake(); }
  else if (sp != null && sp > 5) { if (stillSince && Date.now() - stillSince > STILL_MS) requestWake(); stillSince = 0; }
  // a drive in progress survives a reload (the web view restarting, a discarded tab): see resumeOffer()
  if (Date.now() - driveSavedT > 30e3) { driveSavedT = Date.now(); store.set("drive", { t: driveSavedT }); }
  setPosition(hit.m, { speed: coarse ? null : speed, dir, offRoute: false, jumped });
}

/** End trip of a real drive (10+ miles, 3+ stamps): what it came to, and a quiet way to share it (3.0.1). */
function tripSaved() {
  try {
    const t = api.trip && api.trip.trips && api.trip.trips()[0];
    if (!t || t.demo || !(Date.now() - (t.end || 0) < 10e3) || !(t.miles >= 10) || !((t.stamps || []).length >= 3)) return;
    const acts = [["Share my trip", () => api.trip.share("trip")]];
    if (api.share && api.share.shareApp) acts.push(["Tell a friend", () => api.share.shareApp()]);
    showNotice("trip-saved", { title: "Trip saved", text: `${Math.round(t.miles)} miles and ${t.stamps.length} landmark stamps. It's in your passport.`, acts });
  } catch {}
}
/** Precise Location is off (fixes of several kilometres): what to do about it, until a good fix arrives. */
function showPrecise(accuracy) {
  bus.emit("trouble", { why: "precise" });
  const km = Math.max(1, Math.round((accuracy || 0) / 1000));
  showNotice("precise", {
    title: "Turn on Precise Location",
    text: native.NATIVE
      ? `Your location is only accurate to about ${km} km, too rough to find you on I-5. In the Settings app, open I-5 Buddy (under Apps), tap Location and turn on Precise Location.`
      : `Your location is only accurate to about ${km} km, too rough to find you on I-5. Turn on precise location for this browser in your phone's settings.`,
    acts: native.NATIVE ? [["Open Settings", () => native.openSettings()]] : [],
  });
}

/* Demo drive */
// 3.0.1 (first-run audit): the demo ends by itself after about 4 minutes or 6 landmarks, and at the end of the road
// (it used to turn around without a word and talk until the battery ran out); while I-5 Buddy talks, or has more to say,
// the pretend car slows to real speed, so "in about 2 miles" is still true when it is said.
const DEMO_MS = 4 * 60e3, DEMO_PLACES = 6;
let demoTimer = null, demoX = 10, demoStartT = 0, demoHeard = new Set();
function startDemo() {
  voice.unlock();
  stopAll(true);
  S.resumable = false; hideNotice("resume"); $("startGps").textContent = "Start GPS";
  if (S.m == null || S.m < 1 || S.m > MAX_M - 1) S.m = S.dir === "N" ? 205 : Math.min(815, MAX_M - 7);
  setMode("demo");
  greet("This is a demo drive. I'll pretend we're driving so you can hear how it works.");
  let m = S.m;
  demoStartT = Date.now(); demoHeard = new Set();
  setPosition(m, { speed: 65, jumped: true, save: false });
  demoTimer = setInterval(() => {
    const busy = voice.isSpeaking() || voice.queued().length;
    if (!busy && (Date.now() - demoStartT > DEMO_MS || demoHeard.size >= DEMO_PLACES)) return endDemo();
    const f = busy ? Math.min(demoX, 1) : demoX;
    m += (S.dir === "N" ? 1 : -1) * 65 * f / 3600 * 0.5;
    if (m >= MAX_M || m <= 0) { m = Math.max(0, Math.min(MAX_M, m)); setPosition(m, { speed: 65, save: false }); return endDemo(); }
    setPosition(m, { speed: 65, save: false });
  }, 500);
}
bus.on("speaking", s => { if (s && S.mode === "demo" && s.id && placeById(s.id)) demoHeard.add(s.id); });
/** The demo is over: stop, and say what to do for real. */
function endDemo() {
  if (S.mode !== "demo") return;
  stopAll();
  const acts = [["Start GPS", () => { hideNotice("demo-done"); startGps(); }]];
  if (api.share && api.share.shareApp) acts.push(["Tell a friend", () => api.share.shareApp()]);
  showNotice("demo-done", { title: "That's the demo", text: "That's how it sounds on the road. Tap Start GPS before you pull out on I-5, and I'll do this for real.", acts });
  bus.emit("demo:end", { ms: Date.now() - demoStartT, places: demoHeard.size });
}

/* A mission within 2 miles of a GPS fix ({place: the data.MISSIONS entry, dist in miles}, nearest first), else null.
   Off I-5 near a mission the status line says "Near Mission ..." instead of "Not on I-5 right now". */
function nearMission(lat, lon) {
  let best = null;
  for (const x of MISSIONS) {
    if (!x || typeof x.lat !== "number" || typeof x.lon !== "number") continue;
    const d = geo.miles(lat, lon, x.lat, x.lon);
    if (d <= 2 && (!best || d < best.dist)) best = { place: x, dist: Math.round(d * 100) / 100 };
  }
  return best;
}

function greet(extra = "") {
  voice.say(`Hi, I'm your I-5 buddy. I'll tell you about what's coming up as we drive. ${extra}`, { now: true, id: "greet", prio: 3 });
}

function stopAll(silent = false) {
  if (watchId != null) geoSource().clearWatch(watchId);
  clearInterval(demoTimer);
  watchId = null; demoTimer = null; dirVotes = []; anchorM = null; lastFix = null; offCount = 0;
  // A new session starts on the road until two far fixes say otherwise (otherwise a trip that ended off the road
  // would keep "off route" and never notice going off again).
  drove = false; offEnd = null; S.offRoute = false; S.nearMission = null; S.gpsStale = false; S.dirSure = undefined;
  S.cruise = null; cruiseN = 0;
  fuzzyN = 0; stillSince = 0;
  hideNotice("precise");
  if (!silent) {
    const was = S.mode;
    if (S.mode !== "off") bus.emit("trip:end", { mode: S.mode, speed: S.speed });
    if (was === "gps") tripSaved();
    voice.stop();
    S.speed = null;
    store.del("drive"); // ended on purpose: nothing to resume
    setMode("off");
  }
  resetTrip();
}

/* Keep the screen awake while driving */
let wake = null, wakeWanted = false, wakeAsking = false;
// One request at a time, and a lock that arrives after the drive ended (End trip, or location refused before the
// first fix, while the request was on its way) is let go at once: it used to be kept, and the screen stayed on with
// nothing running (code review 2026-11-20).
async function requestWake() {
  wakeWanted = true;
  if (native.NATIVE && await native.keepAwake(true)) return;
  if (wake || wakeAsking) return;
  wakeAsking = true;
  try {
    const s = await navigator.wakeLock?.request("screen");
    if (!s) return;
    if (!wakeWanted || wake) { try { s.release(); } catch {} return; }
    wake = s;
    s.addEventListener?.("release", () => { if (wake === s) wake = null; });
  } catch {} finally { wakeAsking = false; }
}
function releaseWake() { wakeWanted = false; if (native.NATIVE) native.keepAwake(false); try { wake && wake.release(); } catch {} wake = null; }
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
  if (wakeWanted && (S.mode === "gps" || S.mode === "demo")) requestWake();
  // back after a minute or more away during a drive: say why it went quiet (it can't talk in the background)
  if (S.mode === "gps" && hiddenAt && Date.now() - hiddenAt > 60e3) toast("I was quiet while I-5 Buddy wasn't on screen. Keep it open while you drive.", 6000);
  hiddenAt = 0;
});
// GPS on, but no usable fix for 15 s: the sign stops showing a speed and an ETA that look live (3.0.1)
setInterval(() => {
  if (S.mode === "gps" && lastGoodT && !S.gpsStale && Date.now() - lastGoodT > STALE_MS) { S.gpsStale = true; queueRender(); if (drove) bus.emit("trouble", { why: "gps lost" }); }
}, 5000);

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
  $("speed").textContent = S.speed != null && S.mode !== "manual" && S.mode !== "off" && !S.gpsStale ? Math.round(S.speed) : "--";

  if (S.mode === "gps") {
    if (S.offRoute && S.nearMission) { setPill("gps", "GPS"); $("statusText").textContent = `Near ${S.nearMission.place.name}`; }
    else if (S.offRoute) {
      const end = atEnd();
      setPill("off-route", end ? "THE END" : "OFF I-5");
      // short enough for the header on a small phone (3.0.1: the longer line was cut to "Not on I-5 ri…")
      $("statusText").textContent = end ? `Past ${end.long}`
        : S.offDist != null && S.offDist >= 2 ? `Not on I-5 · ${Math.round(S.offDist)} mi away` : "Not on I-5 right now";
    }
    else if (has) { setPill("gps", "GPS"); $("statusText").textContent = regionAt(S.m).name; }
    if (S.gpsStale && !S.offRoute) { setPill("wait", "GPS?"); $("statusText").textContent = "Waiting for a GPS signal…"; }
  } else if (S.mode === "demo") { setPill("demo", "DEMO"); $("statusText").textContent = has ? regionAt(S.m).name : "Demo drive"; } // the DEMO pill says it (3.0.2)
  else if (S.mode === "manual") { setPill("manual", "MANUAL"); $("statusText").textContent = "Milepost set by hand"; }
  else { setPill("off", "OFF"); $("statusText").textContent = has ? "Paused · " + regionAt(S.m).name : `${ENDS.S.short} to ${ENDS.N.short}`; }
  // js/nav.js: while it guides, the status line says where to and the next turn (also off I-5, where narration is paused)
  const navLine = S.mode !== "off" && api.nav && api.nav.statusText ? api.nav.statusText() : "";
  if (navLine) { setPill("gps", "NAV"); $("statusText").textContent = navLine; }

  $("toggleNarr").setAttribute("aria-pressed", settings.narr);
  $("toggleNarr").setAttribute("aria-label", "Narration"); // one name; aria-pressed carries on and off
  $("toggleNarr").textContent = settings.narr ? "Narration on" : "Narration off";
  renderRibbon(); renderNext(); renderUpNext(); renderServices();
  // 3.0.2: with no position yet, "What's on my left/right?" has nothing to answer, so Drive leaves it out; the link to
  // the Ahead tab (hills, gas and food, what's next) shows once there is a road ahead to show
  document.querySelector("#view-drive .look").hidden = S.m == null;
  $("aheadLink").hidden = S.m == null;
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
/** GPS is on, but this session has never been on I-5 (started at home, in town): say so plainly, with the way to a demo
    and the way out (3.0.1; before, the sign showed a made-up mile, or mile 0, and the app went quiet). */
function notOnI5Card(card) {
  const mi = S.offDist != null && isFinite(S.offDist) ? Math.round(S.offDist) : null;
  const key = "noti5:" + (mi == null ? "far" : mi >= 2 ? mi : "near");
  if (shownNext === key) return;
  shownNext = key;
  card.className = "next not-on-i5"; card.innerHTML = "";
  const body = el("div", "next-body");
  body.append(el("div", "meta", "NOT ON I-5 YET"), el("h2", null, "I'll start talking on I-5"),
    el("p", null, `${mi == null ? "You're far from I-5 in California." : mi >= 2 ? `You're about ${mi} miles from I-5.` : "You're close to I-5."} Once you're on it, between ${ENDS.S.long} and ${ENDS.N.long}, I'll tell you about the places you pass.`));
  const acts = el("div", "acts");
  const demo = el("button", "secondary", "Take a demo drive"); demo.type = "button"; demo.onclick = startDemo;
  const stop = el("button", "secondary", "Stop GPS"); stop.type = "button"; stop.onclick = () => stopAll(false);
  acts.append(demo, stop);
  body.append(acts);
  card.append(body);
}
/** Off I-5 on a short detour (a gas stop, a meal): narration waits at the mile where you left the road. */
function offI5Card(card) {
  const left = S.m != null ? Math.round(S.m) : null;
  const key = "offi5:" + left;
  if (shownNext === key) return;
  shownNext = key;
  card.className = "next not-on-i5"; card.innerHTML = "";
  const body = el("div", "next-body");
  const where = left != null ? `You left I-5 near ${regionAt(S.m).name}, around mile ${left}.` : "You left I-5.";
  body.append(el("div", "meta", "OFF I-5 FOR NOW"), el("h2", null, "Paused until you're back on I-5"),
    el("p", null, `${where} When you're back on it, I'll pick up where we left off.`));
  const acts = el("div", "acts");
  const stop = el("button", "secondary", "End trip"); stop.type = "button"; stop.onclick = () => stopAll(false);
  acts.append(stop);
  body.append(acts);
  card.append(body);
}
function renderNext() {
  const card = $("nextCard");
  // Off I-5 with GPS on, the card never counts down to a landmark from the last spot on the road (3.0.2): on a short
  // detour it says it is paused there; otherwise it is the Not on I-5 card with the closest point.
  if (S.mode === "gps" && S.offRoute && !S.nearMission && !atEnd()) return drove ? offI5Card(card) : notOnI5Card(card);
  if (S.m == null) {
    if (shownNext === "welcome") return;
    shownNext = "welcome";
    card.className = "next welcome"; card.innerHTML = "";
    const names = STATES.map(s => s.name);
    const states = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
    const h2 = el("h2", null, `Your guide to all ${Math.round(MAX_M).toLocaleString()} miles of I-5${SCOPE.length === 1 ? " in " + STATES[0].name : ""}`);
    h2.tabIndex = -1; // takes the focus when the Install app button under it goes away (updateInstall)
    // Install app, or on an iPhone or iPad "Get the iPhone app" (updateInstall), right under the headline: in a phone's
    // browser tab, which is shorter than the screen, that keeps it above the tab bar.
    const inst = el("div", "welcome-install"); inst.hidden = true;
    card.append(el("div", "meta", `${ENDS.S.short} to ${ENDS.N.short}`.toUpperCase()), h2, inst,
      el("p", null, `${PLACES.length} landmarks, orchards and stories through ${states}. ${native.NATIVE ? "Tap Start GPS before you pull out" : "Tap Start GPS on the road"}, or take a demo drive from the couch.`));
    // (3.0.2: the three number boxes under the text are gone; the line above already says how many landmarks)
    // the byline, and beside it a link that says Privacy on the first screen (privacy.html in a new tab, as in About);
    // short enough that both stay on one line on a 360 px phone
    // in the iPhone app the byline is plain words: dominares.org sells developer tools, nothing to do with the app
    const by = native.NATIVE ? el("span", "byline", "Made by Dominares") : el("a", "byline", "Made by Dominares · i5.dominares.org");
    if (!native.NATIVE) { by.href = "https://dominares.org/"; by.target = "_blank"; by.rel = "noopener"; }
    const pv = el("a", "byline", "Privacy");
    pv.href = "privacy.html"; pv.target = "_blank"; pv.rel = "noopener";
    const dot = el("span", null, "·"); dot.setAttribute("aria-hidden", "true");
    const row = el("div", "byline-row"); row.append(by, dot, pv);
    card.append(row);
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
    card.className = "next end-of-road"; card.innerHTML = "";
    const body = el("div", "next-body"); // padded like every other card (3.0.1: the text touched the card's edge)
    body.append(el("div", "meta", "END OF THE ROAD"), el("h2", null, `You made it to ${e.long}`), el("p", null, "That's every stop in this direction. Turn around for the other side of the story."));
    card.append(body);
    return;
  }
  const { p, d } = x;
  if (shownNext !== p.id) {
    shownNext = p.id;
    card.className = "next " + p.cat; card.innerHTML = "";
    const ph = photo(p, "hero"); if (ph) card.append(ph);
    const body = el("div", "next-body");
    const meta = el("div", "meta");
    meta.append(el("span", null, CATS[p.cat]), el("span", null, detourShort(p) || exitName(p.st, p.ex)));
    const count = el("div", "count");
    count.append(el("span", "n"), el("small", "unit", "mi"), el("small", "eta"), el("span", "side"));
    const acts = el("div", "acts");
    const b1 = el("button"); b1.innerHTML = '<span aria-hidden="true">▶</span> Play'; b1.onclick = () => { voice.unlock(); markHeard(p.id); voice.say(announceText(p, Math.max(0, aheadOf(S.m, S.dir, p.m))), { now: true, id: p.id, chime: true }); };
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
    h.setAttribute("role", "button"); h.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); placeSheet(p); } };
    body.append(meta, count, h, el("p", null, p.text), acts);
    card.append(body);
  }
  card.querySelector(".n").textContent = d < 0.3 ? "NOW" : fmtMiles(d);
  card.querySelector(".unit").hidden = d < 0.3;
  const eta = card.querySelector(".eta");
  const mins = S.speed && S.speed > 15 && S.mode !== "manual" && !S.gpsStale ? d / S.speed * 60 : null;
  eta.textContent = mins != null && d >= 0.3 ? (mins < 1 ? "· under a min" : `· ${Math.round(mins)} min`) : "";
  const sw = sideWord(p, S.dir);
  const side = card.querySelector(".side");
  side.textContent = sw ? (sw === "left" ? "◀ LEFT" : "RIGHT ▶") : "";
  side.setAttribute("aria-label", sw ? `on the ${sw}` : "");
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
    const sd = el("span", "sd", sw === "left" ? "◀" : sw === "right" ? "▶" : "");
    if (sw) { sd.setAttribute("aria-label", `on the ${sw}`); sd.setAttribute("role", "img"); }
    li.append(b, sd);
    const det = detourShort(p);
    if (det) { li.classList.add("detour"); li.append(el("small", "det", det)); }
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
      t.append(el("b", null, `${Math.max(1, Math.round(s.d))} mi`), el("small", null, kind === "rest" ? (s.status === "closed" ? "Closed · " : "") + restName(s.name) : `${label} · ${exitName(s.st, s.ref)}`));
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
  const det = detourShort(p);
  sh.append(el("div", "meta", [CATS[p.cat], det || exitName(p.st, p.ex), sw && `on the ${sw}`, d != null && (d >= 0 ? `${fmtMiles(d)} mi ahead` : `${fmtMiles(-d)} mi behind`), S.stamps[p.id] && "stamped ✓"].filter(Boolean).join(" · ")));
  sh.append(el("p", "lead", p.text));
  if (p.more) sh.append(el("p", null, p.more));
  if (p.spot) sh.append(el("p", "spot", "I spy: " + p.spot));
  const acts = el("div", "acts");
  const h1 = el("button", "primary", "Hear it"); h1.onclick = () => { voice.unlock(); hear(p); };
  acts.append(h1);
  if (p.more) { const h2 = el("button", "secondary", "Tell me more"); h2.onclick = () => { voice.unlock(); tellMore(p); }; acts.append(h2); }
  // A turn-off place is stamped only when GPS gets within about half a mile of it, or with this button.
  if (det) {
    const went = el("button", "secondary went", S.stamps[p.id] ? "You went there ✓" : "I went there");
    went.type = "button"; went.disabled = !!S.stamps[p.id];
    went.onclick = () => {
      if (stampSelf(p)) toast(`${p.name} is in your passport.`);
      went.textContent = "You went there ✓"; went.disabled = true;
    };
    acts.append(went);
  }
  sh.append(acts);
  bus.emit("place:sheet", { place: p, sheet: sh, acts }); // modules may add buttons to `acts` (share.js adds Share)
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
  $("view-ahead").dataset.mode = aheadMode; // the Next stops boxes hide while the list itself is Gas & food (css)
  if (aheadMode === "stops") return renderStops(ol, m);
  $("aheadTitle").textContent = S.m == null ? "Every stop, south to north" : `Coming up ${S.dir === "N" ? "northbound" : "southbound"}`;
  const items = upcoming(m, S.m == null ? "N" : S.dir, listCats);
  const key = items.length + ":" + (items[0]?.p.id || "") + ":" + aheadLimit + ":" + Math.round(m) + [...listCats].join();
  if (ol.dataset.key === key) return;
  // the row the reader is looking at stays where it is when the list is rebuilt (3.0.1: passed rows used to vanish
  // above it and the text jumped up a row every mile; iPhone Safari has no scroll anchoring)
  let anchor = null;
  if (tab === "ahead" && window.scrollY > 0) for (const li of ol.querySelectorAll("li.row[data-id]")) { const r = li.getBoundingClientRect(); if (r.bottom > 80) { anchor = { id: li.dataset.id, top: r.top }; break; } }
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
    li.dataset.id = p.id;
    const dd = el("div", "d", d < 0.3 ? "now" : Math.round(d)); if (d >= 0.3) dd.append(el("small", null, "mi"));
    const body = el("div", "body");
    const sw = sideWord(p, S.dir);
    body.append(el("div", "m", [CATS[p.cat], detourShort(p) || exitName(p.st, p.ex), sw && (sw === "left" ? "◀ left" : "right ▶")].filter(Boolean).join(" · ")),
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
  if (anchor) { const li = ol.querySelector(`li[data-id="${CSS.escape(anchor.id)}"]`); if (li) window.scrollBy(0, li.getBoundingClientRect().top - anchor.top); }
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
      body.append(el("div", "m", "Rest area"), el("b", null, restName(x.s.name)));
      if (REST_NOTE[x.s.status]) body.append(el("p", "rest-status", REST_NOTE[x.s.status]));
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
$("driveFeedback").onclick = () => { bus.emit("trouble", { why: "feedback" }); if (api.feedback && api.feedback.open) api.feedback.open(); };
setGlance(store.get("glance", false));
$("startGps").onclick = startGps;
$("startDemo").onclick = startDemo;
$("stopTrip").onclick = () => stopAll(false);
$("aheadLink").onclick = () => go("ahead");
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
  // an online voice says so: its words go to Google or Microsoft (privacy.html, Spoken narration)
  for (const v of vs) { const o = el("option", null, v.natural ? "I-5 Buddy (natural voice)" : `${v.name} (${v.lang})${voice.online(v) ? " (online)" : ""}`); o.value = v.voiceURI; sel.append(o); }
  sel.value = settings.voice || (vs[0]?.voiceURI ?? "");
  $("rate").value = settings.rate; $("rateOut").textContent = (+settings.rate).toFixed(2).replace(/0$/, "") + "×";
  $("lead").value = settings.lead; $("leadOut").textContent = settings.lead + " mi";
  document.querySelectorAll("[data-chat]").forEach(b => b.setAttribute("aria-pressed", b.dataset.chat === settings.chat));
  $("chatHint").textContent = { low: "Only things you can see and the big history.", normal: "Every landmark in the categories you pick.", high: "Everything, plus longer stories on quiet stretches." }[settings.chat];
  $("autoStories").checked = settings.autoStories;
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
$("autoStories").onchange = e => { settings.autoStories = e.target.checked; saveSettings(); };
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
// Settings > About: the app's own version (3.0.1), and in the iPhone app a Rate row that opens the App Store's review
// page when tapped (Apple's way for a button; the automatic ask is review.js, through Apple's own prompt).
export const APP_VERSION = "3.0.9";
$("appVersion").textContent = `I-5 Buddy ${APP_VERSION}${native.NATIVE ? " for iPhone" : ""}`;
if (native.NATIVE) {
  const a = el("a", "secondary rate-open", "Rate I-5 Buddy");
  a.href = "https://apps.apple.com/app/id6834991531?action=write-review"; a.target = "_blank"; a.rel = "noopener";
  $("rateRow").append(a, el("small", "hint", "A rating in the App Store helps other drivers find it."));
  $("rateRow").hidden = false;
}

/* ---------- install, and the iPhone app ---------- */
// Chrome and Edge offer to install the app with a beforeinstallprompt event; index.html keeps it in window.__i5Install
// (it can come before this module runs). While there is one, an Install app button shows in the welcome card and in
// Settings. iPhone and iPad have no such offer: there the welcome card offers the iPhone app instead (below), and
// Settings says how to add the page to the Home Screen (in an app's own browser, such as Instagram's, Share has no Add
// to Home Screen, so it says to open the page in Safari). The install offer goes away once the app is installed or is
// running as the installed app. Nothing is stored or sent anywhere.
//
// The iPhone app (on the App Store since 2026-11-15): in a browser on an iPhone or iPad (Safari, Chrome, an app's own
// browser, where Safari's App Store banner never shows, or the page added to the Home Screen), the welcome card, right
// under the headline, and Settings > About show Apple's "Download on the App Store" badge and "Get the iPhone app",
// one plain link to the app's App Store page. The badge is Apple's artwork, unmodified (icons/app-store-badge.svg,
// cached with the app), never under 40 px tall, with a quarter of its height clear around it (app.css). Never inside
// the iPhone app itself.
const APP_STORE = "https://apps.apple.com/us/app/i-5-buddy/id6834991531";
const APPLE_TM = "Apple, the Apple logo and iPhone are trademarks of Apple Inc., registered in the U.S. and other countries and regions. App Store is a service mark of Apple Inc.";
const APP_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];
let installedHere = false; // the browser said "appinstalled" in this tab, or the person accepted its install dialog
let asking = false;        // the browser's install dialog is open
const runningInstalled = () => navigator.standalone === true || APP_MODES.some(m => matchMedia(`(display-mode: ${m})`).matches);
// read when needed, not once at load (tools/e2e.html and tools/test-getapp.html try iPhones, iPads and in-app browsers)
const onIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1); // iPadOS says Macintosh
const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|GSA\/|Snapchat|Pinterest|Line\/|musical_ly|TikTok|Twitter/.test(navigator.userAgent);
const ICON_INSTALL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v7.2l3.3-3.3 1.4 1.4L12 15l-5.7-5.7 1.4-1.4 3.3 3.3V4ZM5 17h2v2h10v-2h2v4H5v-4Z" fill="currentColor"/></svg>';
const markBusy = (b, busy) => busy ? b.setAttribute("aria-disabled", "true") : b.removeAttribute("aria-disabled");
/** "Get the iPhone app": Apple's badge and a short line, one link to the App Store page (a new tab, like every other
    outside link here, so a drive in this tab carries on). */
function appStoreLink() {
  const a = el("a", "get-app");
  a.href = APP_STORE; a.target = "_blank"; a.rel = "noopener";
  const img = el("img", "get-app-badge");
  img.src = "icons/app-store-badge.svg"; img.alt = "Download on the App Store"; img.width = 132; img.height = 44;
  const t = el("span", "get-app-text");
  t.append(el("b", null, "Get the iPhone app"), " ", el("small", null, "Free, with every story and photo built in."));
  a.append(img, t);
  return a;
}
/** Settings > About, first row: the same link and Apple's trademark line, on an iPhone or iPad only. */
function updateAppRow(show) {
  const row = $("appRow");
  if (!row) return;
  if (show && !row.firstChild) row.append(appStoreLink(), el("small", "hint", APPLE_TM));
  row.hidden = !show;
}
function updateInstall() {
  if (native.NATIVE) { // the iPhone app is installed already: no Install app row, no Add to Home Screen tip, no badge
    $("installRow").hidden = true;
    updateAppRow(false);
    const s = document.querySelector("#nextCard .welcome-install");
    if (s) s.hidden = true;
    return;
  }
  const installed = installedHere || runningInstalled();
  const offer = installed ? null : window.__i5Install || null;
  const busy = asking && !installed;
  const iphone = onIOS(), ios = !installed && iphone, inApp = ios && inAppBrowser();
  updateAppRow(iphone);
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
    // an iPhone or iPad (even with the page on the Home Screen) gets the iPhone app; it never has an install offer
    const want = offer || busy ? "offer" : iphone ? "store" : "";
    if (slot.dataset.show !== want) {
      slot.dataset.show = want; slot.innerHTML = "";
      if (want === "offer") {
        const b = el("button", "secondary install-btn"); b.type = "button";
        b.innerHTML = ICON_INSTALL; b.append("Install app"); b.onclick = installApp;
        slot.append(b);
      } else if (want === "store") slot.append(appStoreLink());
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
  const r = await savePhotos(urls, (done, total) => { $("offlineText").textContent = `Saving photos… ${done} of ${total}`; });
  // only what was really saved counts (3.0.1: it used to say "All 273 photos saved" with none saved)
  $("offlineText").textContent = r.error ? "Couldn't save photos. Try again with a better connection."
    : r.ok === urls.length ? `All ${urls.length} photos saved for offline use.`
    : `Saved ${r.ok} of ${urls.length} photos. Try again with a better connection for the rest.`;
  btn.disabled = false;
};
/** Save photos in the photo cache, 8 at a time, each within 15 s. Resolves {ok, failed} ({error} without a cache). */
async function savePhotos(urls, onProgress) {
  let done = 0, ok = 0, failed = 0;
  try {
    const cache = await caches.open("i5b-photos");
    for (let i = 0; i < urls.length; i += 8) {
      await Promise.all(urls.slice(i, i + 8).map(async u => {
        try {
          if (await cache.match(u)) ok++;
          else {
            const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000);
            try { const r = await fetch(u, { signal: ac.signal }); if (r.ok) { await cache.put(u, r); ok++; } else failed++; } finally { clearTimeout(t); }
          }
        } catch { failed++; }
        done++;
      }));
      try { onProgress && onProgress(done, urls.length); } catch {}
    }
  } catch { return { ok, failed, error: true }; }
  // ask the browser not to clear the offline copy, the photos and the passport when the phone runs low on space
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  return { ok, failed };
}
// The installed app on Wi-Fi (Android reports the connection type): save the photos once, quietly, so a drive through
// a dead zone has them too (3.0.1; a fresh install had no photos offline and nothing said so).
(async () => {
  try {
    if (native.NATIVE || !("caches" in window) || store.get("photosAuto", false)) return;
    if (!runningInstalled()) return;
    const conn = navigator.connection;
    if (!conn || conn.type !== "wifi" || conn.saveData) return;
    const urls = [...new Set(PLACES.filter(p => p.img).map(p => p.img.f))];
    const r = await savePhotos(urls);
    if (!r.error && r.ok === urls.length) store.set("photosAuto", true);
  } catch {}
})();
/* ---------- 3.0: everyone moves to the natural voice once (Settings > Voice still lists the device's voices) ---------- */
if (!store.get("voice3", false)) {
  if (settings.voice && !String(settings.voice).startsWith("buddy:")) { settings.voice = ""; saveSettings(); }
  store.set("voice3", true);
}

/* ---------- the natural voice for offline (the website; the iPhone app carries every clip) ---------- */
function updateSaveVoice() {
  const b = $("saveVoice");
  if (!b || native.NATIVE) return;
  const info = voice.offline ? voice.offline.info() : { ready: false };
  b.hidden = !info.ready || !voice.natural() || !("caches" in window);
  if (!info.saving) b.textContent = info.mb ? `Save the voice for offline (${info.mb} MB)` : "Save the voice for offline";
}
bus.on("voices", updateSaveVoice);
bus.on("settings", updateSaveVoice);
$("saveVoice").onclick = async () => {
  const b = $("saveVoice");
  b.disabled = true;
  const r = await voice.offline.save((done, total) => { $("offlineText").textContent = `Saving the voice… ${done} of ${total} clips`; });
  $("offlineText").textContent = r.none ? "This browser can't save the voice for offline use."
    : r.failed ? `Saved ${r.ok} of ${r.ok + r.failed} voice clips. Try again with a better connection for the rest.`
    : "The voice is saved. Narration sounds the same in dead zones.";
  b.disabled = false;
};
updateSaveVoice();
if (native.NATIVE) { // the iPhone app carries every file, photos and the voice included
  $("savePhotos").hidden = true;
  $("saveVoice").hidden = true;
  $("offlineText").textContent = `Everything is on this phone, photos and the voice included. Live road info${native.VOICE ? ", voice commands" : ""}, routes and the 3D map need a connection.`;
}

/* ---------- what's new in 3.0.7: once, for people who used the app before (also in the iPhone app after its update) ---------- */
// A new id shows the card once more to everyone who saw the 3.0 one ("3.0.0-voice-gps"). The Ask Buddy line and title
// need voice commands (speech recognition, and not turned off in the iPhone app: the same test as listen.js init).
const NEW_ID = "3.0.7-ask-buddy";
export const WHATS_NEW = {
  title: "New in I-5 Buddy 3.0.7: ask about the places you pass",
  titleNoMic: "New in I-5 Buddy 3.0.7: calmer directions and clearer words",
  ask: "Ask about the places you pass: tap the mic and say “how tall is Mount Shasta?” The answers are saved on your phone.",
  items: [
    "Calmer turn-by-turn directions: “Rerouting” once when you leave the route, and the arrival only when you get there.",
    "Stories step aside for turns, chain controls and road alerts.",
    "Rest areas that Caltrans lists as closed are called out, with the next open one on your side.",
    "Better photos, and clearer spoken distances, times and numbers.",
  ],
};
function whatsNew() {
  const box = $("whatsNew");
  if (!box) return;
  const seen = store.get("whatsNew", null);
  if (!RETURNING) { if (seen !== NEW_ID) store.set("whatsNew", NEW_ID); box.hidden = true; return; } // a first visit: never
  if (seen === NEW_ID) { box.hidden = true; return; }
  const done = () => { store.set("whatsNew", NEW_ID); box.hidden = true; box.textContent = ""; };
  const card = el("article", "whats-new");
  card.setAttribute("aria-labelledby", "wnTitle");
  const mic = !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !(native.NATIVE && native.VOICE === false);
  const h = el("h2", null, mic ? WHATS_NEW.title : WHATS_NEW.titleNoMic);
  h.id = "wnTitle";
  const list = el("ul", "wn-list");
  for (const t of mic ? [WHATS_NEW.ask, ...WHATS_NEW.items] : WHATS_NEW.items) list.append(el("li", null, t));
  const acts = el("div", "acts");
  const ok = el("button", "primary", "Got it"); ok.type = "button";
  ok.onclick = () => { done(); ($("nextCard").querySelector("h2") || $("startGps")).focus?.({ preventScroll: true }); };
  acts.append(ok);
  card.append(el("div", "meta", "WHAT'S NEW"), h, list, acts);
  box.textContent = ""; box.append(card); box.hidden = false;
  place(S.mode);
}
// Parked, it sits above the next card so it is on the first screen; on the move (GPS or demo) it steps below the
// next card and the mission card, so the landmark coming up stays where the driver expects it.
function place(mode) {
  const box = $("whatsNew"), next = $("nextCard"), after = $("missionCard") || next;
  if (!box || !next || box.hidden) return;
  if (mode !== "gps" && mode !== "demo") { if (box.nextElementSibling !== next) next.before(box); }
  else if (after.nextElementSibling !== box) after.after(box);
}
bus.on("mode", place);
whatsNew();

/* ---------- the iPhone app: is a newer version in the App Store? (at most once a day; nothing about the person is sent) ---------- */
if (native.NATIVE) {
  native.storeUpdate().then(u => {
    const row = $("storeUpdate");
    if (!u || !row) return;
    row.textContent = "";
    const a = el("a", null, "Open the App Store");
    a.href = u.url; a.target = "_blank"; a.rel = "noopener";
    const later = el("button", "link", "Not now"); later.type = "button";
    later.onclick = () => { native.storeUpdateLater(u.version); row.hidden = true; };
    row.append(el("span", null, "An update is ready in the App Store."), a, later);
    row.hidden = false;
  }).catch(() => {});
}

/* ---------- service worker ---------- */
// Not in the iPhone app: it ships every file and updates through the App Store (and WKWebView has no service worker here).
if ("serviceWorker" in navigator && location.protocol !== "file:" && !native.NATIVE) {
  // the page had a worker before this load: a later controllerchange it did not ask for is an update from another tab
  const hadController = !!navigator.serviceWorker.controller;
  let showUpdate = () => {};
  navigator.serviceWorker.register("sw.js").then(reg => {
    // while GPS runs, the bar waits: it would cover the header, and Reload stops the drive (3.0.1)
    let pending = false;
    const show = () => { if (S.mode === "gps") { pending = true; return; } $("updateBar").hidden = false; };
    showUpdate = show;
    // a bar already showing when GPS starts (Start GPS, or the drive resuming by itself) steps aside until the drive ends
    bus.on("mode", m => {
      if (m === "gps") { if (!$("updateBar").hidden) { $("updateBar").hidden = true; pending = true; } }
      else if (pending) { pending = false; $("updateBar").hidden = false; }
    });
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
  // Another tab's Reload activates the new version for this page too (its old files are gone from the cache): offer the
  // reload here as well (held back while GPS runs), so this page doesn't keep running old code next to new files.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (userAskedUpdate) { if (!reloaded) { reloaded = true; location.reload(); } }
    else if (hadController) showUpdate();
  });
}

/* ---------- modules (each is optional: if one fails, the rest still work) ---------- */
export const api = {
  S, settings, saveSettings, bus, store, voice, narrator, data, geo, native, APP_VERSION,
  ui: { $, el, toast, go, openSheet, closeSheet, photo, placeSheet, queueRender },
  setPosition, setMode, startDemo, startGps, stopAll,
};
window.I5BUDDY = { api, locate: geo.locate, coordAt: geo.coordAt }; // for tools/test.html and the E2E harness

/* ---------- a drive cut off by a restart (3.0.1) ---------- */
// The page reloading (a discarded tab, iOS restarting the app's web view, Reload for an update) used to end the drive
// silently: GPS off, nothing said, until someone tapped Start GPS. A drive that was running in the last 45 minutes is
// offered back with one big button (a tap also lets the voice start).
(function resumeOffer() {
  const d = store.get("drive", null);
  if (!d) return;
  if (!(Date.now() - d.t < RESUME_MS) || S.m == null) { store.del("drive"); return; }
  S.resumable = true;
  $("startGps").textContent = "Resume drive";
  showNotice("resume", { title: "Pick up where you left off?", text: "Your drive stopped when I-5 Buddy restarted. Tap Resume drive and I'll carry on.", acts: [] });
  autoResume();
})();
// 3.0.6: when location is already allowed, GPS picks the drive back up by itself after a restart instead of sitting at
// "Paused" (a real report). A web page still needs one tap before it may talk: the first tap anywhere gives it.
async function autoResume() {
  await new Promise(r => setTimeout(r, 1500)); // after the modules (trip, nav, live) are listening
  let ok = !!native.NATIVE;
  try { if (!ok && navigator.permissions) ok = (await navigator.permissions.query({ name: "geolocation" })).state === "granted"; } catch {}
  if (!ok || !S.resumable || S.mode !== "off") return;
  startGps();
  toast("Back on GPS. Tap anywhere so I can talk again.", 6000);
  document.addEventListener("pointerdown", () => voice.unlock(), { once: true, capture: true });
}

applyTheme();
render();
for (const name of ["live", "map", "play", "trip", "listen", "roadahead", "feedback", "share", "ride", "missions", "nav", "review"]) {
  import(`./${name}.js`).then(mod => {
    try { mod.init(api); } catch (e) { console.error(`[${name}] init failed`, e); }
  }).catch(e => console.warn(`[${name}] not loaded`, e?.message || e));
}
