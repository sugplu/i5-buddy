// I-5 Buddy: the 3D terrain map. map.js imports this lazily and only when the user taps "3D" on the Map tab; nothing
// here (and none of MapLibre, vendor/maplibre/) is loaded at start-up or cached with the app shell.
//
//   open(api, host, {onExit, onFail}) -> Promise<boolean>   true once the first map picture has arrived; false when 3D cannot
//                                                   run (this browser is too old, no WebGL, the script or style failed, no
//                                                   tiles within 12 s). onFail(reason) runs just before a false: "browser"
//                                                   (too old for MapLibre) or "connection" (anything else)
//   close()                                         remove the MapLibre map (map.remove()) and everything around it
//
// What it draws: OpenFreeMap's "liberty" basemap, Mapzen/AWS Terrarium terrain (exaggeration 1.4) with a hillshade, the
// I-5 line with a glow, landmark pins (thinned out when zoomed far out; tap one for its details), and the ride (ride.js)
// standing on a ground marker that points the way you are heading. The camera tilts 60 degrees and follows the car; a drag
// stops following ("Follow me" brings it back). "Fly the road" glides the camera along the next 30 miles.
//
// Every failure is quiet: the caller shows a friendly note and goes back to the 2D map. Tests run with the network blocked,
// so there this always ends in that fallback.

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DEM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];
export const ATTRIBUTION = "© OpenStreetMap contributors, OpenFreeMap · Terrain: Mapzen/AWS Terrain Tiles";
const FIRST_TILE_MS = 12000;     // no picture by then: give up
const LIB_MS = 12000;            // the MapLibre script itself
const PITCH = 60, ZOOM = 11.8, EXAGGERATION = 1.4;
const FLY_MILES = 30, FLY_MS = 26000;
const MOVING_MPH = 3;
// 3.0: more to do in 3D
const CHASE = { pitch: 74, zoom: 15.6 };          // the chase camera: low behind the car, 3D buildings in view
const EXAG = [[1, "Real"], [1.4, "Bold"], [2.3, "Dramatic"]];   // the Mountains button cycles these
const PHOTO_MIN_ZOOM = 10.2, PHOTO_MAX = 12;       // photo pins near the middle of the view, from this zoom
const TOUR_STOPS = 8, ORBIT_DEG_S = 9;

const warn = e => { try { console.warn("[map3d]", e && e.message ? e.message : e); } catch {} };
const num = Number.isFinite;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const BASE = new URL("../", import.meta.url);

let cur = null;                  // the open session, if any

/* ---------- loading MapLibre, only now ---------- */
let libPromise = null;
function loadLib() {
  if (typeof window !== "undefined" && window.maplibregl) return Promise.resolve(window.maplibregl);
  if (libPromise) return libPromise;
  const css = el("link"); css.rel = "stylesheet"; css.href = new URL("vendor/maplibre/maplibre-gl.css", BASE).href;
  const css2 = el("link"); css2.rel = "stylesheet"; css2.href = new URL("css/map3d.css", BASE).href;
  document.head.append(css, css2);
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
/** MapLibre 5 calls Object.hasOwn and Array.prototype.at without a fallback, in the page and in its worker (so a polyfill in
    the page would not help). Both arrived in iOS 15.4 and Chrome 93; on iOS 15.0 to 15.3 the 3D map could never start. */
export function browserTooOld() {
  return typeof Object.hasOwn !== "function" || typeof [].at !== "function";
}
function webglOK() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

/* ---------- colours from the app's tokens (MapLibre paint cannot read CSS variables) ---------- */
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => (cs.getPropertyValue(n) || "").trim() || f;
  const light = document.documentElement.dataset.theme === "light";
  return {
    light,
    bg: v("--bg", "#101412"), fg: v("--fg", "#eef2ee"), accent: v("--accent", "#f2c230"), signFg: v("--sign-fg", "#ffffff"),
    danger: v("--danger", "#e5484d"),
    cats: {
      farm: v("--farm", "#a9c93c"), hist: v("--hist", "#ec9150"), nature: v("--nature", "#52bdd0"),
      town: v("--town", "#d9cfb9"), stop: v("--stop", "#b496ec"), odd: v("--odd", "#f26fa6"),
    },
  };
}

/* ---------- landmark pins, thinned by zoom ---------- */
// Tier t shows from zoom MINZ[t]; two pins in the same tier are at least SEP[t] corridor miles apart. Things you can see
// from the road come first, so they win the room.
const MINZ = [7.5, 9.5, 11, 12.5], SEP = [30, 10, 3, 0];
function pinFeatures(api) {
  const d = api.data || {};
  const places = (Array.isArray(d.PLACES) ? d.PLACES : []).filter(p => p && p.id != null);
  const order = places.slice().sort((a, b) => (b.vis ? 1 : 0) - (a.vis ? 1 : 0) || (a.m || 0) - (b.m || 0));
  const taken = MINZ.map(() => []);
  const out = [];
  for (const p of order) {
    let c = num(p.lat) && num(p.lon) ? [p.lat, p.lon] : null;
    if (!c) { try { c = api.geo.coordAt(p.m); } catch {} }
    if (!c || !num(c[0]) || !num(c[1])) continue;
    let tier = MINZ.length - 1;
    for (let t = 0; t < MINZ.length; t++) {
      if (SEP[t] === 0 || taken[t].every(m => Math.abs(m - p.m) >= SEP[t])) { tier = t; break; }
    }
    for (let t = tier; t < MINZ.length; t++) taken[t].push(p.m);
    out.push({ type: "Feature", id: out.length, properties: { id: p.id, n: shorten(p.name), cat: p.cat || "town", tier }, geometry: { type: "Point", coordinates: [c[1], c[0]] } });
  }
  return out;
}
function shorten(name) {
  const s = String(name || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return s.length > 26 ? s.slice(0, 25).trimEnd() + "…" : s;
}

/* ---------- open ---------- */
export async function open(api, host, opts = {}) {
  close();
  // before anything is loaded: say plainly that the browser is too old, instead of blaming the connection
  if (browserTooOld()) { try { opts.onFail && opts.onFail("browser"); } catch {} return false; }
  const ses = cur = { api, host, opts, alive: true, off: [], timers: [], raf: 0, map: null, follow: true, flying: null, face: null, sprite: null, tiles: 0, done: false,
    photos: new Map(), bells: [], chase: false, exag: 1, tour: null, orbit: null, card: null, cardPlace: null };
  try {
    if (!webglOK()) return giveUp(ses);
    host.classList.add("mp3d");
    ses.status = el("p", "mp3d-status", "Loading the 3D map…");
    ses.status.setAttribute("role", "status");
    host.append(ses.status);
    const lib = await loadLib();
    if (!ses.alive) return false;
    const ok = await start(ses, lib);
    if (!ses.alive) return false;
    if (!ok) return giveUp(ses);
    if (ses.status) { ses.status.remove(); ses.status = null; }
    return true;
  } catch (e) {
    warn(e);
    return giveUp(ses);
  }
}
function giveUp(ses) { if (cur === ses) close(); return false; }

/** The live MapLibre map, or null. For tests and screenshots. */
export function mapObject() { return cur && cur.map; }

/** Remove the map and everything around it. Safe to call at any time, including twice. */
export function close() {
  const ses = cur;
  cur = null;
  if (!ses) return;
  ses.alive = false;
  cancelAnimationFrame(ses.raf);
  try { endTour(ses, false); } catch {}
  try { stopOrbit(ses); } catch {}
  for (const t of ses.timers) clearTimeout(t);
  clearTimeout(ses.pinT);
  for (const f of ses.off) { try { f(); } catch {} }
  try { if (ses.sprite) ses.sprite.remove(); } catch {}
  try { if (ses.pad) ses.pad.remove(); } catch {}
  for (const mk of ses.photos.values()) { try { mk.remove(); } catch {} }
  ses.photos.clear();
  for (const mk of ses.bells) { try { mk.remove(); } catch {} }
  ses.bells = [];
  try { if (ses.map) ses.map.remove(); } catch (e) { warn(e); }
  try { ses.host.textContent = ""; ses.host.classList.remove("mp3d"); } catch {}
  ses.map = null;
}

/* ---------- the map ---------- */
function start(ses, lib) {
  const { api, host } = ses;
  const T = tokens();
  const S = () => api.S || {};
  const coordAt = m => { try { const c = api.geo.coordAt(m); return c && num(c[0]) && num(c[1]) ? c : null; } catch { return null; } };
  const roadBearing = (m, dir) => { try { const b = api.geo.bearingAt(m); return num(b) ? (b + (dir === "S" ? 180 : 0)) % 360 : 0; } catch { return 0; } };
  const MAXM = num(api.data && api.data.MAX_M) ? api.data.MAX_M : 797;
  const curM = () => { const m = S().m; return num(m) ? clamp(m, 0, MAXM) : null; };
  const heading = () => {
    const st = S();
    if (st.mode === "gps" && num(st.heading)) return st.heading;
    const m = curM();
    return m == null ? 0 : roadBearing(m, st.dir);
  };

  // where to look first: the car, else the middle of the road
  const m0 = curM() ?? Math.round(MAXM * 0.4);
  const c0 = coordAt(m0) || [36.5, -119.8];

  const stage = el("div", "mp3d-map");
  host.append(stage);
  let map;
  try {
    map = ses.map = new lib.Map({
      container: stage, style: STYLE_URL, center: [c0[1], c0[0]], zoom: ZOOM, pitch: PITCH, bearing: heading(), maxPitch: 80, minZoom: 4,
      attributionControl: false, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 0, cooperativeGestures: false,
    });
  } catch (e) { warn(e); return Promise.resolve(false); }

  // The first answer: a picture arrived (true), or it cannot (false). Single failed tiles are normal on the road and are
  // ignored; only a style that cannot load, a lost graphics context or twelve silent seconds end it.
  let settle = null;
  const answer = new Promise(res => { settle = v => { if (!ses.done) { ses.done = true; res(v); } }; });
  const afterOpen = reason => { if (ses.alive && ses.done && ses.opts.onExit) ses.opts.onExit(reason); };
  let styleOk = false;
  map.on("error", e => {
    // never log the raw error: a blocked fetch is a TypeError and would read as a crash
    if (!styleOk && !(e && (e.tile || e.sourceId))) { warn("style failed"); settle(false); }
  });
  map.on("styledata", () => { styleOk = true; });
  map.on("data", e => {
    if (e && e.dataType === "source" && e.tile) { ses.tiles++; settle(true); }
  });
  const timer = setTimeout(() => { if (!ses.tiles) { warn("no tiles in time"); settle(false); } }, FIRST_TILE_MS);
  ses.timers.push(timer);
  try {
    const cv = map.getCanvas();
    cv.addEventListener("webglcontextlost", e => { e.preventDefault(); settle(false); afterOpen("lost"); });
  } catch {}

  ses.lib = lib;
  map.on("style.load", () => {
    try { addScene(map, T, api, ses); } catch (e) { warn(e); }
    try { addMore(map, T, api, ses); } catch (e) { warn(e); }
  });

  // the ride and its ground marker
  buildRide(ses, lib, map, T, coordAt, heading);

  // camera: follow the car; a drag stops it
  const ui = buildUi(ses, map, T);
  const stopFollow = e => { if (e && e.originalEvent && !ses.flying) { ses.follow = false; ui.sync(); } };
  map.on("dragstart", stopFollow);
  map.on("rotatestart", stopFollow);
  map.on("pitchstart", e => { if (e && e.originalEvent && !ses.flying) { /* tilting keeps following */ } });
  map.on("rotate", () => ses.faceUpdate && ses.faceUpdate());

  const onPos = e => {
    ses.moveRide && ses.moveRide();
    if (ses.follow && !ses.flying) followCamera(!!(e && e.jumped));
  };
  const followCamera = jump => {
    const m = curM(), c = m == null ? null : coordAt(m);
    if (!c || !ses.map) return;
    const st = S(), moving = num(st.speed) && st.speed >= MOVING_MPH;
    // the chase camera sits low behind the car (the car near the bottom, the road and its buildings ahead)
    const camera = { center: [c[1], c[0]], padding: { top: Math.round(stage.clientHeight * (ses.chase ? 0.5 : 0.34)), bottom: 0, left: 0, right: 0 } };
    if (ses.chase) { camera.pitch = CHASE.pitch; if (jump) camera.zoom = CHASE.zoom; }
    if (jump || moving || ses.bearingDirty || ses.chase) { camera.bearing = heading(); ses.bearingDirty = false; }
    if (jump || reduced()) map.jumpTo(camera);
    else map.easeTo({ ...camera, duration: 900, easing: t => t });
  };
  ses.followCamera = followCamera;
  try { ses.off.push(api.bus.on("pos", onPos)); } catch {}
  try { ses.off.push(api.bus.on("ride", () => ses.rebuildRide && ses.rebuildRide())); } catch {}
  try { ses.off.push(api.bus.on("ride:state", () => ses.rideState && ses.rideState())); } catch {}
  map.once("load", () => { if (ses.follow) followCamera(true); });

  // fly the road / follow me / stop
  ui.onFollow = () => {
    ses.follow = true; ui.sync();
    ses.bearingDirty = true;
    stopOrbit(ses); hideCard(ses);
    const m = curM(), c = m == null ? null : coordAt(m);
    if (!c) return;
    map.easeTo({ center: [c[1], c[0]], bearing: heading(), pitch: ses.chase ? CHASE.pitch : PITCH, zoom: ses.chase ? CHASE.zoom : Math.max(map.getZoom(), ZOOM - 0.5), duration: reduced() ? 0 : 1200,
      padding: { top: Math.round(stage.clientHeight * (ses.chase ? 0.5 : 0.34)), bottom: 0, left: 0, right: 0 } });
  };
  ui.onFly = () => { endTour(ses, false); hideCard(ses); flyRoad(ses, map, ui, coordAt, roadBearing, curM, MAXM); };
  ui.onStop = () => { if (ses.tour) endTour(ses, true); else stopFly(ses, ui, true); };
  ui.onTour = () => startTour(ses);
  ui.onChase = () => { ses.chase = !ses.chase; endTour(ses, false); stopFly(ses, ui, false); ui.onFollow(); ui.sync(); };
  ui.onMountains = () => {
    ses.exag = (ses.exag + 1) % EXAG.length;
    try { map.setTerrain({ source: "dem", exaggeration: EXAG[ses.exag][0] }); } catch (e) { warn(e); }
    ui.sync();
    try { api.ui.toast(["Mountains at their real height.", "Mountains a little taller, so they read on a phone.", "Dramatic mountains: more than twice their height."][ses.exag], 2500); } catch {}
  };
  // a compass that also shows the tilt; tap it to face north
  try { map.addControl(new lib.NavigationControl({ showZoom: false, visualizePitch: true }), "top-left"); } catch (e) { warn(e); }
  // photo pins near the middle of the view, and the mission bells once you are close enough
  map.on("moveend", () => { clearTimeout(ses.pinT); ses.pinT = setTimeout(() => { try { refreshPins(ses); } catch (e) { warn(e); } }, 140); });
  map.on("zoom", () => host.classList.toggle("mp3d-near", map.getZoom() >= 8.5));
  // touching the map stops an orbit
  for (const ev of ["dragstart", "rotatestart", "pitchstart", "zoomstart"]) map.on(ev, e => { if (e && e.originalEvent) stopOrbit(ses); });
  return answer;
}

/* ---------- night: the basemap is a daytime style, so its own colours are darkened (MapLibre has no dark switch) ---------- */
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;
function nightify(map) {
  let ctx = null;
  try { const c = document.createElement("canvas"); c.width = c.height = 1; ctx = c.getContext("2d", { willReadFrequently: true }); } catch {}
  if (!ctx) return;
  const cache = new Map();
  const rgb = str => {
    let v = cache.get(str);
    if (v) return v;
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = str; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    cache.set(str, v = [d[0], d[1], d[2], d[3] / 255]);
    return v;
  };
  const toCss = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.round(a * 1000) / 1000})`;
  const dark = str => {                 // pull toward a deep green-black, keep some of the hue
    const [r, g, b, a] = rgb(str), t = 0.7, base = [12, 20, 17];
    return toCss([0, 1, 2].map(i => Math.round([r, g, b][i] * (1 - t) + base[i] * t)), a);
  };
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

/* ---------- the scene: terrain, hillshade, sky, the road, the pins ---------- */
function addScene(map, T, api, ses) {
  if (!T.light) nightify(map);
  const layers = map.getStyle().layers || [];
  const firstSymbol = (layers.find(l => l.type === "symbol") || {}).id;

  map.addSource("dem", { type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 15 });
  map.addSource("dem-shade", { type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 15 });
  map.setTerrain({ source: "dem", exaggeration: EXAGGERATION });
  map.addLayer({
    id: "hillshade", type: "hillshade", source: "dem-shade",
    paint: { "hillshade-exaggeration": T.light ? 0.45 : 0.6, "hillshade-shadow-color": T.light ? "#4d5a4f" : "#05090a", "hillshade-highlight-color": T.light ? "#ffffff" : "#8fa59a", "hillshade-accent-color": T.light ? "#6d7c70" : "#0d1512" },
  }, firstSymbol);
  try {
    map.setSky(T.light
      ? { "sky-color": "#86c4f0", "sky-horizon-blend": 0.6, "horizon-color": "#f1f6f7", "horizon-fog-blend": 0.7, "fog-color": "#e9eef0", "fog-ground-blend": 0.35, "atmosphere-blend": 0.6 }
      : { "sky-color": "#0a1a3a", "sky-horizon-blend": 0.55, "horizon-color": "#31446e", "horizon-fog-blend": 0.7, "fog-color": "#1b2740", "fog-ground-blend": 0.4, "atmosphere-blend": 0.5 });
  } catch (e) { warn(e); }

  // the road
  const route = (Array.isArray(api.data && api.data.ROUTE) ? api.data.ROUTE : []).filter(r => Array.isArray(r) && num(r[1]) && num(r[2])).map(r => [r[2], r[1]]);
  if (route.length > 1) {
    map.addSource("i5", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } } });
    const line = { "line-cap": "round", "line-join": "round" };
    map.addLayer({ id: "i5-glow", type: "line", source: "i5", layout: line, paint: { "line-color": T.accent, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 7, 12, 22], "line-blur": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 12], "line-opacity": 0.5 } }, firstSymbol);
    map.addLayer({ id: "i5-casing", type: "line", source: "i5", layout: line, paint: { "line-color": T.light ? "#3a2f0a" : "#1a1405", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 9] } }, firstSymbol);
    map.addLayer({ id: "i5-line", type: "line", source: "i5", layout: line, paint: { "line-color": T.accent, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.4, 12, 5.4] } }, firstSymbol);
  }

  // landmark pins
  const feats = pinFeatures(api);
  if (feats.length) {
    map.addSource("pins", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    const colour = ["match", ["get", "cat"], "farm", T.cats.farm, "hist", T.cats.hist, "nature", T.cats.nature, "town", T.cats.town, "stop", T.cats.stop, "odd", T.cats.odd, T.cats.town];
    MINZ.forEach((z, t) => {
      map.addLayer({
        id: "pins-" + t, type: "circle", source: "pins", minzoom: z, filter: ["==", ["get", "tier"], t],
        paint: {
          "circle-color": colour, "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3.5, 12, 6, 15, 8.5],
          "circle-stroke-color": T.signFg, "circle-stroke-width": 1.8, "circle-pitch-alignment": "viewport",
        },
      });
    });
    map.addLayer({
      id: "pin-labels", type: "symbol", source: "pins", minzoom: 10.5, filter: ["<=", ["get", "tier"], 2],
      layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.15], "text-anchor": "top", "text-max-width": 8, "symbol-sort-key": ["get", "tier"] },
      paint: { "text-color": T.light ? "#16211a" : "#f2f6f2", "text-halo-color": T.light ? "rgba(255,255,255,.92)" : "rgba(8,12,10,.92)", "text-halo-width": 1.6 },
    });
    const pinLayers = MINZ.map((_, t) => "pins-" + t);
    const pick = e => {
      const r = 18, p = e.point;
      const f = map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: pinLayers.filter(id => map.getLayer(id)) });
      if (!f.length) return;
      const place = api.data.placeById ? api.data.placeById(f[0].properties.id) : (api.data.PLACES || []).find(x => x.id === f[0].properties.id);
      if (place) selectPlace(ses, place);
    };
    map.on("click", pick);
    map.on("mousemove", e => {
      const p = e.point, r = 12;
      const f = map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: pinLayers.filter(id => map.getLayer(id)) });
      map.getCanvas().style.cursor = f.length ? "pointer" : "";
    });
  }
}

/* ---------- the ride: an upright sprite on a ground marker that points the way ---------- */
function buildRide(ses, lib, map, T, coordAt, heading) {
  const api = ses.api, S = () => api.S || {};
  const padEl = el("div", "mp3d-pad");
  padEl.innerHTML = '<svg viewBox="-32 -32 64 64" aria-hidden="true"><circle r="22" class="pad-glow"/><circle r="12" class="pad-ring"/><path d="M0 -29 9 -13 0 -17.5 -9 -13Z" class="pad-arrow"/></svg>';
  const spriteEl = el("div", "mp3d-sprite");
  ses.pad = new lib.Marker({ element: padEl, rotationAlignment: "map", pitchAlignment: "map", anchor: "center" }).setLngLat([0, 0]);
  ses.sprite = new lib.Marker({ element: spriteEl, rotationAlignment: "viewport", pitchAlignment: "viewport", anchor: "bottom", offset: [0, 7] }).setLngLat([0, 0]);
  let placed = false, faceKey = "";

  const rideApi = () => { const r = api.ride; return r && typeof r.svg === "function" ? r : null; };
  ses.faceUpdate = () => {
    const ra = rideApi();
    const rel = (heading() - map.getBearing()) * Math.PI / 180, dx = Math.sin(rel);
    const face = Math.abs(dx) > 0.25 ? (dx > 0 ? "right" : "left") : (S().dir === "S" ? "left" : "right");
    if (face !== ses.face || !spriteEl.firstChild) { ses.face = face; draw(ra, face); }
  };
  const draw = (ra, face) => {
    spriteEl.textContent = "";
    if (ra) {
      try { spriteEl.append(ra.svg({ size: 82, facing: face, label: "Your ride" })); } catch (e) { warn(e); }
    }
    if (!spriteEl.firstChild) spriteEl.append(el("span", "mp3d-dot"));
    ses.rideState();
  };
  ses.rebuildRide = () => draw(rideApi(), ses.face || "right");
  ses.rideState = () => {
    let st = "idle";
    try { const ra = rideApi(); if (ra && ra.state) st = ra.state(); } catch {}
    for (const c of ["moving", "idle", "sleepy"]) spriteEl.classList.toggle("ride-" + c, st === c);
  };
  ses.moveRide = () => {
    const m = S().m, top = num(api.data && api.data.MAX_M) ? api.data.MAX_M : 797, c = num(m) ? coordAt(clamp(m, 0, top)) : null;
    if (!c) { try { ses.pad.remove(); ses.sprite.remove(); } catch {} placed = false; return; }
    ses.pad.setLngLat([c[1], c[0]]); ses.sprite.setLngLat([c[1], c[0]]);
    if (!placed) { ses.pad.addTo(map); ses.sprite.addTo(map); placed = true; }
    ses.pad.setRotation(heading());
    ses.faceUpdate();
  };
  ses.moveRide();
}

/* ---------- buttons: Follow me, Fly the road, Stop, and the attribution ---------- */
function buildUi(ses, map, T) {
  const host = ses.host;
  const box = el("div", "mp3d-ui");
  const mk = (cls, label, icon) => {
    const b = el("button", "mp3d-btn " + cls);
    b.type = "button";
    if (icon) b.innerHTML = icon;
    b.append(label);
    return b;
  };
  const tour = mk("tour", "Landmark tour", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7Zm0 4.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z" fill="currentColor"/></svg>');
  const fly = mk("fly", "Fly the road", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12 21 4l-5 16-4.2-6.3L3 12Z" fill="currentColor"/></svg>');
  const chase = mk("chase", "Chase cam", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14l-2-6.5A2 2 0 0 0 15.1 9H8.9A2 2 0 0 0 7 10.5L5 17Zm1 1.5a1.5 1.5 0 1 0 3 0Zm9 0a1.5 1.5 0 1 0 3 0ZM12 2l3 4H9l3-4Z" fill="currentColor"/></svg>');
  const peaks = mk("peaks", "Mountains", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20 9 7l4 7 2.5-4L22 20H2Z" fill="currentColor"/></svg>');
  const stop = mk("stop", "Stop", '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>');
  const follow = mk("follow", "Follow me", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.8 20.5 12 16.8l7.2 3.7L12 2.5Z" fill="currentColor"/></svg>');
  stop.hidden = true; follow.hidden = true;
  const label = (b, text) => { const last = b.lastChild; if (last && last.nodeType === 3) last.textContent = text; };
  box.append(follow, tour, fly, chase, peaks, stop);
  const at = el("p", "mp3d-attrib");
  const a1 = el("a", null, "OpenStreetMap"); a1.href = "https://www.openstreetmap.org/copyright";
  const a2 = el("a", null, "OpenFreeMap"); a2.href = "https://openfreemap.org";
  const a3 = el("a", null, "Mapzen/AWS Terrain Tiles"); a3.href = "https://registry.opendata.aws/terrain-tiles/";
  for (const a of [a1, a2, a3]) { a.target = "_blank"; a.rel = "noopener"; }
  at.append("© ", a1, " contributors, ", a2, " · Terrain: ", a3);
  host.append(box, at);
  const ui = {
    onFollow() {}, onFly() {}, onStop() {}, onTour() {}, onChase() {}, onMountains() {},
    sync() {
      const busy = !!ses.flying || !!ses.tour;
      follow.hidden = ses.follow || busy; fly.hidden = busy; tour.hidden = busy; stop.hidden = !busy;
      label(stop, ses.tour ? "End tour" : "Stop");
      label(chase, ses.chase ? "Overview" : "Chase cam");
      chase.setAttribute("aria-pressed", String(!!ses.chase));
      label(peaks, "Mountains: " + EXAG[ses.exag][1]);
      box.classList.toggle("carded", !!ses.cardPlace && !ses.tour);
    },
  };
  follow.addEventListener("click", () => ui.onFollow());
  fly.addEventListener("click", () => ui.onFly());
  stop.addEventListener("click", () => ui.onStop());
  tour.addEventListener("click", () => ui.onTour());
  chase.addEventListener("click", () => ui.onChase());
  peaks.addEventListener("click", () => ui.onMountains());
  queueMicrotask(() => ui.sync());
  ses.ui = ui;
  return ui;
}

/* ---------- fly the road: the camera glides along the next 30 miles ---------- */
function flyRoad(ses, map, ui, coordAt, roadBearing, curM, MAXM) {
  if (ses.flying) return;
  const api = ses.api, st = api.S || {};
  const dir = st.dir === "S" ? -1 : 1, d = dir < 0 ? "S" : "N";
  const m0 = curM() ?? 0;
  const m1 = clamp(m0 + dir * FLY_MILES, 0, MAXM);
  if (Math.abs(m1 - m0) < 1 || !coordAt(m1)) { try { api.ui.toast("That is the end of the road."); } catch {} return; }
  ses.follow = false;
  if (reduced()) {
    // no animation: jump to the stretch ahead and let the user look around
    const c = coordAt(m1);
    map.jumpTo({ center: [c[1], c[0]], bearing: roadBearing(m1, d), pitch: PITCH, zoom: ZOOM - 0.5, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    ui.sync();
    return;
  }
  const fly = ses.flying = { t0: 0, bearing: map.getBearing() };
  ui.sync();
  map.stop();
  map.setPadding({ top: Math.round(ses.host.clientHeight * 0.3), bottom: 0, left: 0, right: 0 });
  const smooth = t => t * t * (3 - 2 * t);
  const tick = ts => {
    if (ses.flying !== fly || !ses.alive) return;
    if (!fly.t0) fly.t0 = ts;
    const t = clamp((ts - fly.t0) / FLY_MS, 0, 1), e = 0.55 * t + 0.45 * smooth(t);
    const m = m0 + (m1 - m0) * e, c = coordAt(m);
    if (c) {
      const want = roadBearing(clamp(m + dir * 0.9, 0, MAXM), d);
      const diff = ((want - fly.bearing + 540) % 360) - 180;
      fly.bearing = (fly.bearing + diff * 0.06 + 360) % 360;
      map.jumpTo({ center: [c[1], c[0]], bearing: fly.bearing, pitch: 63, zoom: 12.3 });
    }
    if (t < 1) ses.raf = requestAnimationFrame(tick); else stopFly(ses, ui, false);
  };
  // dragging the map takes over
  const grab = e => { if (e && e.originalEvent) stopFly(ses, ui, false); };
  fly.grab = grab;
  map.on("dragstart", grab);
  ses.raf = requestAnimationFrame(tick);
}
function stopFly(ses, ui, back) {
  const fly = ses.flying;
  if (!fly) return;
  ses.flying = null;
  cancelAnimationFrame(ses.raf);
  try { if (fly.grab && ses.map) ses.map.off("dragstart", fly.grab); } catch {}
  try { if (ses.map) ses.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } catch {}
  ui.sync();
  if (back) ui.onFollow();      // Stop flies back to the car and follows it again
}

/* ================================================================ 3.0: more to do in 3D ================================================================
   3D buildings, live traffic, mission bells and the real sun on the scene; photo pins near the middle of the view; a
   landmark card (Hear it, Orbit, Details, Navigate here, Previous and Next); a narrated landmark tour that flies from stop
   to stop and circles each one while I-5 Buddy tells its story; the chase camera; and the Mountains button. */

function placeCoord(api, p) {
  if (num(p.lat) && num(p.lon)) return [p.lat, p.lon];
  try { const c = api.geo.coordAt(p.m); return c && num(c[0]) && num(c[1]) ? c : null; } catch { return null; }
}

function addMore(map, T, api, ses) {
  const layers = map.getStyle().layers || [];
  const firstSymbol = (layers.find(l => l.type === "symbol") || {}).id;
  // buildings: raise OpenFreeMap's flat building shapes when the style has no 3D buildings of its own
  if (!layers.some(l => l.type === "fill-extrusion")) {
    const b = layers.find(l => l["source-layer"] === "building" && l.source);
    if (b) {
      map.addLayer({
        id: "mp3d-buildings", type: "fill-extrusion", source: b.source, "source-layer": "building", minzoom: 13.5,
        paint: {
          "fill-extrusion-color": T.light ? "#d6d0c6" : "#2b3531",
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 14.6, 0.9],
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 7],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
        },
      }, firstSymbol);
    }
  }
  // live traffic from the Drive screen's list (only when live info is on and fresh)
  map.addSource("mp3d-traffic", { type: "geojson", data: trafficData(api, T) });
  map.addLayer({ id: "mp3d-traffic-halo", type: "circle", source: "mp3d-traffic", minzoom: 6,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 8, 13, 17], "circle-color": ["get", "c"], "circle-opacity": 0.28 } });
  map.addLayer({ id: "mp3d-traffic", type: "circle", source: "mp3d-traffic", minzoom: 6,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 13, 7.5], "circle-color": ["get", "c"], "circle-stroke-color": T.signFg, "circle-stroke-width": 1.8 } });
  try { ses.off.push(api.bus.on("traffic", () => { try { const s = map.getSource("mp3d-traffic"); if (s) s.setData(trafficData(api, T)); } catch {} })); } catch {}
  map.on("click", "mp3d-traffic", e => { const f = e.features && e.features[0]; if (f) { try { api.ui.toast(f.properties.t, 6000); } catch {} } });
  addBells(map, api, ses);
  applySun(map, T, ses);
  const sunT = setInterval(() => applySun(map, T, ses), 300000);
  ses.timers.push(sunT);
  setTimeout(() => { try { refreshPins(ses); } catch (e) { warn(e); } }, 400);
}

function trafficData(api, T) {
  let list = [];
  try { list = (api.live && typeof api.live.traffic === "function" && api.live.traffic()) || []; } catch {}
  const features = [];
  for (const x of list) {
    if (!x || !num(x.lat) || !num(x.lon) || x.old) continue;
    const bad = x.kind === "crash" || (x.kind === "closure" && !/ramp/i.test(String(x.title || "")));
    features.push({ type: "Feature", properties: { c: bad ? T.danger : T.accent, t: [x.title, x.detail].filter(Boolean).join(": ").slice(0, 220) },
      geometry: { type: "Point", coordinates: [x.lon, x.lat] } });
  }
  return { type: "FeatureCollection", features };
}

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6a1.5 1.5 0 0 1 1.5 1.5v.6A6.1 6.1 0 0 1 18 10.6v4.3l1.9 2.4H4.1L6 14.9v-4.3a6.1 6.1 0 0 1 4.5-5.9v-.6A1.5 1.5 0 0 1 12 2.6Zm-2.4 15.9h4.8a2.4 2.4 0 0 1-4.8 0Z" fill="currentColor"/></svg>';
function addBells(map, api, ses) {
  const list = api.data && Array.isArray(api.data.MISSIONS) ? api.data.MISSIONS : [];
  let stamps = {};
  try { stamps = (api.missions && typeof api.missions.stamps === "function" && api.missions.stamps()) || {}; } catch {}
  for (const m of list) {
    if (!num(m.lat) || !num(m.lon)) continue;
    const got = !!stamps[String(m.n)];
    const b = el("button", "mp3d-bell" + (got ? " got" : ""));
    b.type = "button";
    b.innerHTML = BELL;
    b.setAttribute("aria-label", `${m.name}${got ? ", stamped in your passport" : ""}`);
    b.addEventListener("click", e => { e.stopPropagation(); try { if (api.missions && api.missions.open) api.missions.open(m.n); } catch (er) { warn(er); } });
    try { const mk = new ses.lib.Marker({ element: b, anchor: "bottom" }).setLngLat([m.lon, m.lat]).addTo(map); mk._i5 = [m.lat, m.lon]; ses.bells.push(mk); } catch (e) { warn(e); }
  }
  // only the bells near the middle of the view: in a tilted view the far ones would line up along the horizon
  const near = () => {
    let c;
    try { c = map.getCenter(); } catch { return; }
    for (const mk of ses.bells) {
      const [la, lo] = mk._i5, dy = (la - c.lat) * 69, dx = (lo - c.lng) * 69 * Math.cos(c.lat * Math.PI / 180);
      try { mk.getElement().hidden = Math.hypot(dx, dy) > 30; } catch {}
    }
  };
  map.on("moveend", near);
  near();
}

/** The sun's height and compass direction in degrees (NOAA's short formulas; within a degree or so). */
export function sunPos(lat, lon, date = new Date()) {
  const rad = Math.PI / 180;
  const d = date / 864e5 - 10957.5;                                   // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * rad;                         // mean anomaly
  const q = 280.459 + 0.98564736 * d;                                 // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * rad - ra;                             // hour angle
  const la = lat * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { alt: alt / rad, az: ((az / rad) % 360 + 360) % 360 };
}
/** Light the hills (and the buildings) from where the sun really is; a warm horizon at dawn and dusk. */
function applySun(map, T, ses) {
  if (!ses.alive || !map) return;
  let c;
  try { c = map.getCenter(); } catch { return; }
  const s = sunPos(c.lat, c.lng);
  const up = s.alt > 0;
  try {
    map.setPaintProperty("hillshade", "hillshade-illumination-anchor", "map");
    map.setPaintProperty("hillshade", "hillshade-illumination-direction", Math.round(up ? s.az : 315));
  } catch {}
  try { map.setLight({ anchor: "map", position: [1.2, Math.round(up ? s.az : 210), clamp(90 - s.alt, 12, 80)], intensity: up ? 0.5 : 0.22, color: up && s.alt < 10 ? "#ffd2a1" : "#ffffff" }); } catch {}
  const golden = s.alt > -5 && s.alt < 7;
  try {
    if (golden) map.setSky(T.light
      ? { "sky-color": "#7fb6e6", "sky-horizon-blend": 0.7, "horizon-color": "#f7b37a", "horizon-fog-blend": 0.75, "fog-color": "#f2d2b8", "fog-ground-blend": 0.35, "atmosphere-blend": 0.7 }
      : { "sky-color": "#14204a", "sky-horizon-blend": 0.65, "horizon-color": "#b8613c", "horizon-fog-blend": 0.75, "fog-color": "#3a2a3a", "fog-ground-blend": 0.4, "atmosphere-blend": 0.6 });
  } catch {}
  ses.sun = s;
}

/* ---------- photo pins: the landmarks nearest the middle of the view stand up as round photos ---------- */
function refreshPins(ses) {
  const { map, api } = ses;
  if (!map || !ses.alive || !ses.lib) return;
  const want = new Map();
  if (map.getZoom() >= PHOTO_MIN_ZOOM) {
    const b = map.getBounds(), ctr = map.project(map.getCenter());
    const cands = [];
    for (const p of (api.data && api.data.PLACES) || []) {
      const c = placeCoord(api, p);
      if (!c || !b.contains([c[1], c[0]])) continue;
      const pt = map.project([c[1], c[0]]);
      cands.push({ p, c, d: Math.hypot(pt.x - ctr.x, pt.y - ctr.y) - (p.img ? 90 : 0) - (p.vis ? 40 : 0) });
    }
    cands.sort((x, y) => x.d - y.d);
    for (const x of cands.slice(0, PHOTO_MAX)) want.set(x.p.id, x);
  }
  for (const [id, mk] of ses.photos) if (!want.has(id)) { try { mk.remove(); } catch {} ses.photos.delete(id); }
  for (const [id, x] of want) {
    if (ses.photos.has(id)) continue;
    const btn = el("button", "mp3d-ph cat-" + (x.p.cat || "town"));
    btn.type = "button";
    btn.setAttribute("aria-label", x.p.name);
    const icon = () => { btn.textContent = ""; btn.append(el("span", "mp3d-ph-i", (api.data.CAT_ICON && api.data.CAT_ICON[x.p.cat]) || "\u{1F4CD}")); };
    if (x.p.img && x.p.img.f) {
      const im = el("img");
      im.alt = ""; im.decoding = "async"; im.draggable = false;
      im.onerror = icon;
      im.src = new URL(x.p.img.f, BASE).href;
      btn.append(im);
    } else icon();
    btn.addEventListener("click", e => { e.stopPropagation(); selectPlace(ses, x.p); });
    try { ses.photos.set(id, new ses.lib.Marker({ element: btn, anchor: "bottom", offset: [0, -4] }).setLngLat([x.c[1], x.c[0]]).addTo(map)); } catch (e) { warn(e); }
  }
}

/* ---------- the landmark card ---------- */
function sideText(api, p) {
  try { const w = api.narrator && api.narrator.whereWords ? api.narrator.whereWords(p) : ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; } catch { return ""; }
}
function firstWords(api, text, max = 230) {
  const units = api.voice && api.voice.speechUnits ? api.voice.speechUnits(text) : [String(text || "")];
  let out = "";
  for (const u of units) { if (out && (out + " " + u).length > max) break; out = out ? out + " " + u : u; }
  return out.length > max + 60 ? out.slice(0, max).trimEnd() + "…" : out;
}
function neighbour(api, p, step) {
  const list = ((api.data && api.data.PLACES) || []).filter(x => placeCoord(api, x));
  const i = list.findIndex(x => x.id === p.id);
  const dir = (api.S && api.S.dir) === "S" ? -1 : 1;
  return i < 0 ? null : list[i + step * dir] || null;
}
function selectPlace(ses, p, opts = {}) {
  const { map, api } = ses;
  if (!map || !p) return;
  const c = placeCoord(api, p);
  if (!c) return;
  if (!opts.tour) endTour(ses, false);
  stopFly(ses, ses.ui, false);
  stopOrbit(ses);
  ses.follow = false;
  showCard(ses, p, opts);
  // looking down at about 50 degrees, so a ridge in front never hides the place
  const cam = { center: [c[1], c[0]], zoom: Math.max(Math.min(map.getZoom(), 15.2), 13.8), pitch: 50, bearing: map.getBearing(),
    padding: { top: 30, bottom: Math.round(ses.host.clientHeight * 0.42), left: 0, right: 0 } };
  if (reduced()) map.jumpTo(cam); else map.flyTo({ ...cam, duration: opts.tour ? 4200 : 1700, curve: 1.45, essential: true });
}
function showCard(ses, p, opts = {}) {
  const api = ses.api;
  hideCard(ses, true);
  const card = ses.card = el("section", "mp3d-card");
  card.setAttribute("aria-label", p.name);
  const top = el("div", "mp3d-card-top");
  if (p.img && p.img.f) {
    const im = el("img", "mp3d-card-img");
    im.alt = p.img.alt && !/^[\w-]+$/.test(p.img.alt) ? p.img.alt : "";
    im.src = new URL(p.img.f, BASE).href;
    im.onerror = () => im.remove();
    top.append(im);
  }
  const head = el("div", "mp3d-card-head");
  head.append(el("h3", null, p.name));
  const meta = [];
  try { if (api.data.exitName && p.ex) meta.push(api.data.exitName(p.st, p.ex)); else if (num(p.m)) meta.push(`Mile ${Math.round(p.m)}`); } catch { if (num(p.m)) meta.push(`Mile ${Math.round(p.m)}`); }
  const side = p.detour && api.data.detourShort ? api.data.detourShort(p) : sideText(api, p);
  if (side) meta.push(side);
  if (api.data.CATS && api.data.CATS[p.cat]) meta.push(api.data.CATS[p.cat]);
  head.append(el("p", "mp3d-card-meta", meta.join(" · ")));
  const x = el("button", "mp3d-card-x");
  x.type = "button"; x.setAttribute("aria-label", "Close"); x.textContent = "×";
  x.addEventListener("click", () => { endTour(ses, false); hideCard(ses); });
  top.append(head, x);
  card.append(top, el("p", "mp3d-card-text", firstWords(api, p.text, 170)));
  if (p.img && p.img.by) card.append(el("p", "mp3d-card-credit", `Photo: ${p.img.by}${p.img.lic ? ", " + p.img.lic : ""}`));
  const acts = el("div", "mp3d-card-acts");
  const b = (cls, text, fn) => { const bt = el("button", "mp3d-cbtn " + cls, text); bt.type = "button"; bt.addEventListener("click", fn); acts.append(bt); return bt; };
  if (opts.tour) {
    const t = ses.tour;
    b("pause", t && t.paused ? "Resume" : "Pause", () => toggleTourPause(ses));
    b("next", t && t.i >= t.list.length - 1 ? "Finish" : "Next stop", () => { if (ses.tour) { stopTourVoice(ses); tourStep(ses, 1); } });
    card.append(el("p", "mp3d-card-step", t ? `Stop ${t.i + 1} of ${t.list.length}` : ""));
  } else {
    b("hear", "Hear it", () => { try { api.voice.unlock(); api.narrator.hear(p); } catch (e) { warn(e); } });
    b("orbit", "Orbit", () => { const c = placeCoord(api, p); if (c) startOrbit(ses, [c[1], c[0]]); });
    b("more", "Details", () => { try { api.ui.placeSheet(p); } catch (e) { warn(e); } });
    if (api.nav && typeof api.nav.preview === "function") {
      b("go", "Navigate here", () => { const c = placeCoord(api, p); if (c) { try { api.nav.preview({ id: p.id, name: p.name, lat: c[0], lon: c[1], m: p.m, kind: "place" }); } catch (e) { warn(e); } } });
    }
    // Before and Next ride in the card's top row, beside the close button
    const prev = neighbour(api, p, -1), next = neighbour(api, p, 1);
    const arrow = (cls, text, label, q) => { const bt = el("button", "mp3d-card-arrow " + cls, text); bt.type = "button"; bt.setAttribute("aria-label", label); bt.addEventListener("click", () => selectPlace(ses, q)); return bt; };
    if (prev) top.insertBefore(arrow("prev", "‹", "The landmark before: " + prev.name, prev), x);
    if (next) top.insertBefore(arrow("next", "›", "The next landmark: " + next.name, next), x);
  }
  card.append(acts);
  ses.host.append(card);
  ses.cardPlace = p;
  ses.ui && ses.ui.sync();
}
function hideCard(ses, quiet) {
  if (ses.card) { try { ses.card.remove(); } catch {} }
  ses.card = null; ses.cardPlace = null;
  if (!quiet && ses.ui) ses.ui.sync();
}

/* ---------- the landmark tour: fly to each stop ahead, circle it, and hear its story ---------- */
function tourList(ses) {
  const api = ses.api, st = api.S || {};
  let m = num(st.m) ? st.m : null;
  if (m == null) { try { const c = ses.map.getCenter(); const h = api.geo.locate(c.lat, c.lng); if (h && num(h.m) && h.dist < 25) m = h.m; } catch {} }
  if (m == null) m = 0;
  const dir = st.dir === "S" ? -1 : 1;
  const ahead = ((api.data && api.data.PLACES) || []).filter(p => !p.detour && placeCoord(api, p))
    .map(p => ({ p, d: (p.m - m) * dir })).filter(x => x.d > -0.3).sort((a, b) => a.d - b.d);
  const out = [];
  for (const x of ahead) {
    if (out.length >= TOUR_STOPS) break;
    if (out.length && Math.abs(x.p.m - out[out.length - 1].m) < 2) continue;
    if (!x.p.vis && !x.p.img) continue;         // stops worth a look: you can see it, or there is a photo
    out.push(x.p);
  }
  return out;
}
function startTour(ses) {
  if (ses.tour || !ses.map) return;
  stopFly(ses, ses.ui, false);
  const list = tourList(ses);
  if (!list.length) { try { ses.api.ui.toast("There are no landmarks ahead for a tour."); } catch {} return; }
  try { ses.api.voice.unlock(); } catch {}
  ses.tour = { list, i: -1, paused: false, run: 0 };
  ses.follow = false;
  ses.ui && ses.ui.sync();
  tourStep(ses, 1);
}
function stopTourVoice(ses) {
  try { const v = ses.api.voice; if (String(v.currentId() || "").startsWith("tour:")) v.stop(); } catch {}
}
function toggleTourPause(ses) {
  const t = ses.tour;
  if (!t) return;
  t.paused = !t.paused;
  if (t.paused) { t.run++; stopTourVoice(ses); stopOrbit(ses); showCard(ses, t.list[t.i], { tour: true }); }
  else tourStep(ses, 0);
}
function tourStep(ses, delta) {
  const t = ses.tour;
  if (!t || !ses.alive) return;
  t.i += delta;
  if (t.i >= t.list.length) { endTour(ses, false); try { ses.api.ui.toast("That's the end of the tour."); } catch {} return; }
  if (t.i < 0) t.i = 0;
  t.paused = false;
  const run = ++t.run, p = t.list[t.i], api = ses.api;
  selectPlace(ses, p, { tour: true });
  const alive = () => ses.tour === t && t.run === run && !t.paused && ses.alive;
  const later = (fn, ms) => { const id = setTimeout(() => { if (alive()) fn(); }, ms); ses.timers.push(id); };
  let spoke = false;
  const speak = () => {
    if (spoke || !alive()) return;
    spoke = true;
    const c = placeCoord(api, p);
    if (c) startOrbit(ses, [c[1], c[0]], ORBIT_DEG_S * 0.6);
    const t0 = Date.now();
    let said = null;
    try { said = api.voice.say(`${p.name}. ${p.text}`, { id: "tour:" + p.id, now: true, prio: 2 }); } catch {}
    const onDone = () => later(() => tourStep(ses, 1), Date.now() - t0 < 1500 ? 7000 : 1400);   // no voice: give the eyes 7 s
    if (said && typeof said.then === "function") said.then(onDone, onDone); else onDone();
  };
  ses.map.once("moveend", () => later(speak, 250));
  later(speak, 4800);
}
function endTour(ses, back) {
  if (!ses.tour) return;
  ses.tour = null;
  stopOrbit(ses);
  stopTourVoice(ses);
  hideCard(ses);
  if (ses.ui) { ses.ui.sync(); if (back) ses.ui.onFollow(); }
}

/* ---------- orbit: circle a point slowly; any touch stops it ---------- */
function startOrbit(ses, center, degPerSec = ORBIT_DEG_S) {
  stopOrbit(ses);
  if (reduced() || !ses.map) return;
  const map = ses.map, o = ses.orbit = { last: 0, raf: 0 };
  const tick = ts => {
    if (ses.orbit !== o || !ses.alive) return;
    if (o.last) {
      const dt = Math.min(0.1, (ts - o.last) / 1000);
      try { map.jumpTo({ bearing: (map.getBearing() + degPerSec * dt + 360) % 360, center }); } catch {}
    }
    o.last = ts;
    o.raf = requestAnimationFrame(tick);
  };
  o.raf = requestAnimationFrame(tick);
}
function stopOrbit(ses) {
  const o = ses.orbit;
  if (!o) return;
  ses.orbit = null;
  cancelAnimationFrame(o.raf);
}
