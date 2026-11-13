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
  const ses = cur = { api, host, opts, alive: true, off: [], timers: [], raf: 0, map: null, follow: true, flying: null, face: null, sprite: null, tiles: 0, done: false };
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
  for (const t of ses.timers) clearTimeout(t);
  for (const f of ses.off) { try { f(); } catch {} }
  try { if (ses.sprite) ses.sprite.remove(); } catch {}
  try { if (ses.pad) ses.pad.remove(); } catch {}
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

  map.on("style.load", () => { try { addScene(map, T, api, ses); } catch (e) { warn(e); } });

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
    const camera = { center: [c[1], c[0]], padding: { top: Math.round(stage.clientHeight * 0.34), bottom: 0, left: 0, right: 0 } };
    if (jump || moving || ses.bearingDirty) { camera.bearing = heading(); ses.bearingDirty = false; }
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
    const m = curM(), c = m == null ? null : coordAt(m);
    if (!c) return;
    map.easeTo({ center: [c[1], c[0]], bearing: heading(), pitch: PITCH, zoom: Math.max(map.getZoom(), ZOOM - 0.5), duration: reduced() ? 0 : 1200,
      padding: { top: Math.round(stage.clientHeight * 0.34), bottom: 0, left: 0, right: 0 } });
  };
  ui.onFly = () => flyRoad(ses, map, ui, coordAt, roadBearing, curM, MAXM);
  ui.onStop = () => stopFly(ses, ui, true);
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
      if (place && api.ui && api.ui.placeSheet) api.ui.placeSheet(place);
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
  const fly = mk("fly", "Fly the road", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12 21 4l-5 16-4.2-6.3L3 12Z" fill="currentColor"/></svg>');
  const stop = mk("stop", "Stop", '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>');
  const follow = mk("follow", "Follow me", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.8 20.5 12 16.8l7.2 3.7L12 2.5Z" fill="currentColor"/></svg>');
  stop.hidden = true; follow.hidden = true;
  box.append(follow, fly, stop);
  const at = el("p", "mp3d-attrib");
  const a1 = el("a", null, "OpenStreetMap"); a1.href = "https://www.openstreetmap.org/copyright";
  const a2 = el("a", null, "OpenFreeMap"); a2.href = "https://openfreemap.org";
  const a3 = el("a", null, "Mapzen/AWS Terrain Tiles"); a3.href = "https://registry.opendata.aws/terrain-tiles/";
  for (const a of [a1, a2, a3]) { a.target = "_blank"; a.rel = "noopener"; }
  at.append("© ", a1, " contributors, ", a2, " · Terrain: ", a3);
  host.append(box, at);
  const ui = {
    onFollow() {}, onFly() {}, onStop() {},
    sync() { follow.hidden = ses.follow || !!ses.flying; fly.hidden = !!ses.flying; stop.hidden = !ses.flying; },
  };
  follow.addEventListener("click", () => ui.onFollow());
  fly.addEventListener("click", () => ui.onFly());
  stop.addEventListener("click", () => ui.onStop());
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
