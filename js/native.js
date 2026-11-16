// I-5 Buddy inside the iPhone app (the App Store build: this same web app, bundled into a Capacitor shell).
//
// Capacitor adds window.Capacitor before any page script runs, with the native plugins the app includes (Geolocation,
// KeepAwake, StatusBar) under window.Capacitor.Plugins. In a browser there is no window.Capacitor: NATIVE is false and
// every helper below does nothing, so the web app works exactly as it always has.
//
//   NATIVE                true inside the iPhone app
//   VOICE                 voice commands in the iPhone app. false hides the microphone and "Answer by voice" there, the
//                         same as a web view without speech recognition (set it false if they fail on a real iPhone)
//   init(hooks)           once at start (main.js): the app's own styles (no text selection or page bounce), pages such
//                         as privacy.html shown inside the app, About without links to other products
//   openDoc(file, from, hash)  show a page that ships with the app (privacy.html, support.html) in a sheet inside the app:
//                         works offline, and a drive in progress carries on underneath. Parts marked data-web-only
//                         (support.html's "Get the app") are left out.
//   safetyFirst(go)       the first Start GPS in the app shows the safety line in a sheet; its Start GPS button runs go()
//   onMode(mode)          the safety line on top of the Drive tab while GPS runs (main.js setMode)
//   geolocation()         inside the app, a navigator.geolocation stand-in backed by the phone's own location service:
//                         the app asks once, in its own words, instead of the web view adding its own "localhost would like
//                         to use your current location" prompt at every launch. null in a browser.
//   keepAwake(on)         keep the screen on during a trip (the app has no background mode: a locked phone stops
//                         narration). Resolves false without the native plugin, so main.js uses the Wake Lock API instead.
//   statusBar(theme)      status bar text that stays readable on the page: "light" theme -> dark text, else light text
//   locationOffText(err)  what to say when location is off for the app (the browser wording talks about site settings)
//   micOffText(code)      the same for the microphone and speech recognition (listen.js)
//   storeUpdate()         the iPhone app only, at most once a day: asks Apple's public App Store lookup
//                         (itunes.apple.com/lookup?id=6834991531) for the app's current version, 10 s timeout, quiet on
//                         failure. Resolves {version, url} when the App Store has a newer version than this app (and the
//                         person has not tapped Not now for that version), else null. storeUpdateLater(v): Not now.
// Nothing here sends anything about the person: the App Store lookup asks only for the app's own public listing.

const cap = typeof window !== "undefined" ? window.Capacitor : undefined;
export const NATIVE = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
export const VOICE = true;

const SITE = "https://i5.dominares.org/";
export const SAFETY = "Set it up before you drive. Narration is hands-free; leave the screen to passengers.";
export const INDEPENDENT = "I-5 Buddy is independent and not affiliated with Caltrans, the California Highway Patrol or the National Weather Service.";

/** The native plugin `name` (its methods return promises), or null: in a browser, or in an app built without it. */
function plugin(name) {
  if (!NATIVE) return null;
  try {
    const p = cap.Plugins && cap.Plugins[name];
    if (!p) return null;
    return typeof cap.isPluginAvailable !== "function" || cap.isPluginAvailable(name) ? p : null;
  } catch { return null; }
}
/** obj[method](...args) as a promise, whether the method returns a promise, a plain value or throws. */
function call(obj, method, ...args) {
  try { return Promise.resolve(obj[method](...args)); } catch (e) { return Promise.reject(e); }
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- the app's own page: styles, pages inside the app, About ---------- */
// main.js hands over its store and sheet helpers, so the safety sheet behaves like every other sheet.
let hooks = { store: null, toast: null, openSheet: null, closeSheet: null }, started = false;

// No text selection, callouts or image drags outside the form fields (a web page has them, an app doesn't), and no
// rubber-band bounce of the whole page. The text people may want to copy (share messages, the trip summary) stays
// selectable. Then the in-app page viewer and the safety lines.
const CSS = `
html,body{overscroll-behavior:none}
body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
img,a{-webkit-user-drag:none}
input,textarea,select,[contenteditable]:not([contenteditable="false"]),.sh-url,.sh-msg,.trip-share-txt,.nv-doc-body{-webkit-user-select:text;user-select:text}
input,textarea{-webkit-touch-callout:default}
.nv-doc{position:fixed;inset:0;z-index:24;display:flex;flex-direction:column;background:var(--bg);color:var(--fg)}
.nv-doc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:1.15rem;background:var(--surface);border-bottom:1px solid var(--line);
  padding:calc(4px + env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) 4px max(16px,env(safe-area-inset-left,0px))}
.nv-doc-head .link{min-height:44px;min-width:44px}
.nv-doc-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  padding:14px max(16px,env(safe-area-inset-right,0px)) calc(28px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.nv-doc-body>div{padding:0;margin:0 auto;max-width:680px}
.nv-doc-wait{color:var(--muted);text-align:center;margin:40px 0}
.nv-safety-top{margin:0 0 10px;padding:8px 12px;border-radius:10px;background:var(--surface);border-left:4px solid var(--accent);color:var(--fg-2);font-size:.8rem;line-height:1.35;font-weight:700}
.nv-safety .nv-safety-line{margin:0;font-size:1.05rem;font-weight:800;line-height:1.35}
.nv-safety p{margin:0}
`;

export function init(h = {}) {
  if (!NATIVE || started) return;
  started = true;
  hooks = Object.assign(hooks, h);
  const st = el("style"); st.id = "nativeCss"; st.textContent = CSS; document.head.append(st);
  document.documentElement.classList.add("ios-app");
  document.addEventListener("click", onLinkClick, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && docEl && !docEl.hidden) { e.stopPropagation(); closeDoc(); } }, true);
  adaptAbout();
}

/** About in the app: "Made by Dominares" as plain words, without the links to dominares.org (a store for developer
    tools) and to Lina (a product for businesses); a reviewer or a passenger who taps them would leave the app for
    things it has nothing to do with. Then a line that the app is independent of the agencies whose data it shows. */
function adaptAbout() {
  const fam = document.querySelector("#settings .family");
  if (!fam) return;
  for (const a of fam.querySelectorAll(".also-from")) a.remove();
  const mb = fam.querySelector("a.made-by");
  if (mb) {
    const d = el("div", mb.className);
    d.append(...mb.childNodes);
    for (const s of d.querySelectorAll("small")) s.remove();
    mb.replaceWith(d);
  }
  if (!document.querySelector(".nv-indep")) fam.after(el("p", "fine nv-indep", INDEPENDENT));
}

/** A link to one of the app's own pages: {file, hash}, {home: true} for the start page, or null for anything else
    (other sites, mail and message links, blob: pictures). Compares scheme and host, not origin: for capacitor:// the
    URL API's origin is "null". */
function pageOf(href) {
  if (!href) return null;
  let u;
  try { u = new URL(href, document.baseURI); } catch { return null; }
  if (u.protocol !== location.protocol || u.host !== location.host) return null;
  const file = decodeURIComponent(u.pathname.replace(/^.*\//, ""));
  if (file === "" || file === "index.html") return { home: true };
  return /^[\w-]+\.html$/i.test(file) ? { file, hash: u.hash } : null;
}
// A tap on a link to privacy.html (Settings > About, the feedback form, the Drive tab, the welcome card) or another
// page of the app. In a browser these open a new tab. In the app a new-window link goes to iOS, which can't open the
// app's own capacitor://localhost address, so nothing would happen; a same-window link would replace the app (and end
// a trip) with no way back. So the page opens in a sheet inside the app. Links to other sites, mail and messages keep
// going to iOS (Safari, Mail, Messages), inside the sheet too.
function onLinkClick(e) {
  if (e.defaultPrevented || e.button) return;
  const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
  if (!a || a.hasAttribute("download")) return;
  const href = a.getAttribute("href") || "";
  if (href.startsWith("#")) {         // a jump within a page shown in the sheet (privacy.html's "In the iPhone app")
    if (docEl && !docEl.hidden && docEl.contains(a)) {
      e.preventDefault();
      let t = null;
      try { t = href.length > 1 && docBody.querySelector("#" + CSS.escape(decodeURIComponent(href.slice(1)))); } catch {}
      if (t) t.scrollIntoView({ block: "start" });
    }
    return;
  }
  const pg = pageOf(href);
  if (!pg) return;
  if (pg.home) {                      // "Back to the app" inside a page shown in the sheet: close the sheet
    if (docEl && !docEl.hidden && docEl.contains(a)) { e.preventDefault(); closeDoc(); }
    return;
  }
  e.preventDefault();
  openDoc(pg.file, a, pg.hash);
}

let docEl = null, docBody = null, docTitle = null, docFrom = null, docSeq = 0;
const docStyled = new Set();
function buildDoc() {
  if (docEl) return;
  docEl = el("div", "nv-doc");
  docEl.hidden = true;
  docEl.setAttribute("role", "dialog"); docEl.setAttribute("aria-modal", "true"); docEl.setAttribute("aria-labelledby", "nvDocTitle");
  const head = el("div", "nv-doc-head");
  docTitle = el("b"); docTitle.id = "nvDocTitle";
  const done = el("button", "link nv-doc-done", "Done"); done.type = "button"; done.addEventListener("click", () => closeDoc());
  head.append(docTitle, done);
  docBody = el("div", "nv-doc-body");
  docEl.append(head, docBody);
  document.body.append(docEl);
}
/** A page's own styles, once per page, minus any rule for html, body, :root or * (those would restyle the app). */
function addDocStyles(file, doc) {
  if (docStyled.has(file)) return;
  docStyled.add(file);
  for (const s of doc.querySelectorAll("style")) {
    const st = el("style"); st.dataset.page = file; st.textContent = s.textContent;
    document.head.append(st);
    try {
      const rules = st.sheet.cssRules;
      for (let i = rules.length - 1; i >= 0; i--) {
        const sel = rules[i].selectorText;
        if (sel && /(^|,)\s*(html|body|:root|\*)(?![\w-])/i.test(sel)) st.sheet.deleteRule(i);
      }
    } catch {}
  }
}
/** Show `file` (a page that ships with the app, like privacy.html) in a sheet over the app. Resolves true once shown.
    If the app's copy can't be read, the same page on the website opens in Safari instead. */
export async function openDoc(file, from, hash = "") {
  if (!NATIVE) return false;
  buildDoc();
  const seq = ++docSeq;
  if (from && !docEl.contains(from)) docFrom = from;   // the focus goes back there on Done
  docTitle.textContent = "I-5 Buddy";
  docBody.replaceChildren(el("p", "nv-doc-wait", "Opening…"));
  docEl.hidden = false;
  let doc = null;
  try {
    const r = await fetch(file);
    if (!r.ok) throw new Error("HTTP " + r.status);
    doc = new DOMParser().parseFromString(await r.text(), "text/html");
  } catch {
    doc = null;
  }
  if (seq !== docSeq) return false;
  if (!doc) {
    closeDoc();
    window.open(SITE + file, "_blank");                // Capacitor hands other sites to Safari
    return false;
  }
  addDocStyles(file, doc);
  const main = doc.querySelector("main") || doc.body;
  const shell = main.parentElement && main.parentElement !== doc.body ? main.parentElement.className : "";
  const wrap = el("div", shell || null);
  wrap.append(document.importNode(main, true));
  for (const s of wrap.querySelectorAll("script")) s.remove();
  // parts of a page for the website only (support.html's "Get the app": the App Store badge and Google Play)
  for (const n of wrap.querySelectorAll("[data-web-only]")) n.remove();
  const h1 = wrap.querySelector("h1");
  docTitle.textContent = (h1 && h1.textContent.trim()) || (doc.title || "").split(" · ")[0].trim() || "I-5 Buddy";
  docBody.replaceChildren(wrap);
  docBody.scrollTop = 0;
  if (hash && hash.length > 1) {
    try { const t = docBody.querySelector("#" + CSS.escape(decodeURIComponent(hash.slice(1)))); if (t) t.scrollIntoView({ block: "start" }); } catch {}
  }
  try { docEl.querySelector(".nv-doc-done").focus({ preventScroll: true }); } catch {}
  return true;
}
export function closeDoc() {
  docSeq++;
  if (!docEl || docEl.hidden) return;
  docEl.hidden = true;
  docBody.replaceChildren();
  const f = docFrom; docFrom = null;
  try { if (f && document.contains(f)) f.focus({ preventScroll: true }); } catch {}
}

/* ---------- driving safety ---------- */
const SAFE_KEY = "safetySeen";
function seen() {
  try { return hooks.store ? !!hooks.store.get(SAFE_KEY, false) : localStorage.getItem("i5b:" + SAFE_KEY) === "true"; } catch { return false; }
}
function markSeen() {
  try { if (hooks.store) hooks.store.set(SAFE_KEY, true); else localStorage.setItem("i5b:" + SAFE_KEY, "true"); } catch {}
}
let safeSheet = null;
/** The first Start GPS in the app: the safety line in a sheet, before anything starts. Its Start GPS button runs go()
    (a new tap, so the voice can start); Not now closes it. Returns true when the sheet took over the tap. */
export function safetyFirst(go) {
  if (!NATIVE || seen()) return false;
  if (!safeSheet) {
    safeSheet = el("aside", "sheet nv-safety");
    safeSheet.hidden = true;
    safeSheet.setAttribute("role", "dialog"); safeSheet.setAttribute("aria-modal", "true"); safeSheet.setAttribute("aria-labelledby", "nvSafetyTitle");
    const head = el("div", "sheet-head");
    const t = el("b", null, "Before you drive"); t.id = "nvSafetyTitle";
    head.append(t);
    const row = el("div", "controls");
    const yes = el("button", "primary", "Start GPS"); yes.type = "button";
    const no = el("button", "secondary", "Not now"); no.type = "button";
    row.append(yes, no);
    safeSheet.append(head, el("p", "nv-safety-line", SAFETY),
      el("p", "hint", "I-5 Buddy speaks up before each landmark, so the driver never needs the screen. Choose your settings now, while you're parked."), row);
    (document.querySelector(".app") || document.body).append(safeSheet);
    no.addEventListener("click", () => closeSafety());
    yes.addEventListener("click", () => { markSeen(); closeSafety(); safeSheet.__go && safeSheet.__go(); });
  }
  safeSheet.__go = go;
  if (hooks.openSheet) hooks.openSheet(safeSheet);
  else safeSheet.hidden = false;
  return true;
}
function closeSafety() {
  if (hooks.closeSheet) hooks.closeSheet();
  if (safeSheet) safeSheet.hidden = true;
}
let topLine = null;
/** While GPS runs in the app, the safety line sits on top of the Drive tab (not only at its foot). */
export function onMode(mode) {
  if (!NATIVE) return;
  if (!topLine) {
    const view = document.getElementById("view-drive");
    if (!view) return;
    topLine = el("p", "nv-safety-top", SAFETY);
    topLine.setAttribute("role", "note");
    topLine.hidden = true;
    view.prepend(topLine);
  }
  topLine.hidden = mode !== "gps";
}

/* ---------- location ---------- */
// The W3C GeolocationPositionError codes main.js reads.
const DENIED = 1, UNAVAILABLE = 2, TIMEOUT = 3;
// The plugin's own timeout covers only the first fix, and when it runs out the plugin drops every watch it has. So it
// gets a long one (a backstop only), and the browser's behaviour comes from a timer here: no fix for `timeout` ms
// reports TIMEOUT and the watch carries on. If the plugin gives up anyway, the watch starts again.
const FIRST_FIX_BACKSTOP_MS = 10 * 60e3;
const RESTART_MS = 1000;

function geoError(code, message, reason) {
  return { code, message: String(message || ""), reason: reason || "", PERMISSION_DENIED: DENIED, POSITION_UNAVAILABLE: UNAVAILABLE, TIMEOUT };
}
const isGeoError = e => !!(e && typeof e.code === "number" && e.PERMISSION_DENIED === DENIED);
/** A plugin error -> the browser's shape. The plugin's codes: OS-PLUG-GLOC-0002 no position, 0003 permission denied,
    0007 Location Services off, 0008 restricted (Screen Time), 0010 no first fix in time. Pure. */
export function fromPluginError(e) {
  if (isGeoError(e)) return e;
  const code = String((e && e.code) || ""), msg = (e && e.message) || String(e || "");
  if (/0003$/.test(code)) return geoError(DENIED, msg, "denied");
  if (/0007$/.test(code)) return geoError(DENIED, msg, "services-off");
  if (/0008$/.test(code)) return geoError(DENIED, msg, "restricted");
  if (/0010$/.test(code)) return geoError(TIMEOUT, msg, "timeout");
  return geoError(UNAVAILABLE, msg, "unavailable");
}
/** A plugin position -> what navigator.geolocation hands out, or null for a fix iOS marks invalid (negative accuracy).
    heading is the direction of travel (Core Location's course): the plugin's own "heading" prefers the compass, which
    says where the phone points, not where the car is going. Speed and course are null when iOS has none. Pure. */
export function fromPluginPosition(p) {
  const c = (p && p.coords) || {};
  const num = v => (typeof v === "number" && isFinite(v) ? v : null);
  const lat = num(c.latitude), lon = num(c.longitude), acc = num(c.accuracy);
  if (lat == null || lon == null || (acc != null && acc < 0)) return null;
  const speed = num(c.speed), course = num(c.course), ts = num(p && p.timestamp);
  return {
    timestamp: ts != null ? ts : Date.now(),
    coords: {
      latitude: lat, longitude: lon, accuracy: acc,
      altitude: num(c.altitude), altitudeAccuracy: num(c.altitudeAccuracy),
      speed: speed != null && speed >= 0 ? speed : null,
      heading: course != null && course >= 0 ? course : null,
    },
  };
}

let geoApi = null;
export function geolocation() {
  if (geoApi) return geoApi;
  const G = plugin("Geolocation");
  if (!G) return null;
  let nextId = 0;
  const watches = new Map(); // our watch id -> {alive, cb (the plugin's callback id), run, timer, ok, fail, o}

  async function permitted() {
    let st;
    try { st = await call(G, "checkPermissions"); } catch (e) { throw fromPluginError(e); }
    if (st && st.location === "granted") return;
    if (!st || st.location === "prompt" || st.location === "prompt-with-rationale") {
      try { st = await call(G, "requestPermissions", { permissions: ["location"] }); } catch (e) { throw fromPluginError(e); }
    }
    if (!st || st.location !== "granted") throw geoError(DENIED, "Location permission was denied.", "denied");
  }
  function report(w, e) {
    if (w.alive && typeof w.fail === "function") { try { w.fail(e); } catch (err) { console.error(err); } }
  }
  function tick(w) {
    clearTimeout(w.timer);
    const t = +w.o.timeout;
    if (w.alive && t > 0 && isFinite(t)) w.timer = setTimeout(() => { report(w, geoError(TIMEOUT, "No position yet.", "timeout")); tick(w); }, t);
  }
  function arm(w) {
    if (!w.alive) return;
    const run = ++w.run;
    call(G, "watchPosition", { enableHighAccuracy: !!w.o.enableHighAccuracy, timeout: FIRST_FIX_BACKSTOP_MS }, (pos, err) => {
      if (!w.alive || w.run !== run) return;
      if (err) {
        const e = fromPluginError(err);
        if (e.reason === "timeout") { w.cb = null; report(w, e); setTimeout(() => arm(w), RESTART_MS); } // the plugin dropped it
        else report(w, e);
        return;
      }
      const p = fromPluginPosition(pos);
      if (!p) return;
      tick(w);
      try { w.ok(p); } catch (e2) { console.error(e2); }
    }).then(id => {
      if (w.alive && w.run === run) w.cb = id;
      else if (id != null) call(G, "clearWatch", { id }).catch(() => {});
    }, e => report(w, fromPluginError(e)));
    tick(w);
  }
  geoApi = {
    watchPosition(ok, fail, o) {
      const w = { id: ++nextId, alive: true, cb: null, run: 0, timer: 0, ok, fail, o: o || {} };
      watches.set(w.id, w);
      permitted().then(() => arm(w), e => report(w, fromPluginError(e)));
      return w.id;
    },
    clearWatch(id) {
      const w = watches.get(id);
      if (!w) return;
      watches.delete(id);
      w.alive = false;
      clearTimeout(w.timer);
      if (w.cb != null) call(G, "clearWatch", { id: w.cb }).catch(() => {});
      w.cb = null;
    },
    getCurrentPosition(ok, fail, o) {
      const t = +((o && o.timeout) || 0);
      permitted()
        .then(() => call(G, "getCurrentPosition", { enableHighAccuracy: !!(o && o.enableHighAccuracy), timeout: t > 0 ? t : 30000 }))
        .then(pos => {
          const p = fromPluginPosition(pos);
          if (!p) throw geoError(UNAVAILABLE, "No position.", "unavailable");
          ok(p);
        })
        .catch(e => { if (typeof fail === "function") fail(fromPluginError(e)); });
    },
  };
  return geoApi;
}

/** Words for a location error inside the app (err from geolocation() above). */
export function locationOffText(err) {
  const r = err && err.reason;
  if (r === "services-off") return "Location Services are off on this iPhone. Turn them on in Settings, Privacy & Security, Location Services.";
  if (r === "restricted") return "Location is restricted on this iPhone (Screen Time). You can still take a demo drive.";
  return "Location is off for I-5 Buddy. In the Settings app, open I-5 Buddy (under Apps), tap Location and choose While Using the App.";
}

/** Words for a blocked microphone or speech recognition inside the app (listen.js error codes). */
export function micOffText(code) {
  if (code === "service-not-allowed") {
    return "Voice commands need Speech Recognition. In the Settings app, open I-5 Buddy (under Apps) and turn on Speech Recognition, and check that Dictation is on (General, Keyboard). Then close and reopen the app.";
  }
  return "To use voice commands, open the Settings app, open I-5 Buddy (under Apps) and turn on Microphone. Then close and reopen the app.";
}

/* ---------- screen and status bar ---------- */
export async function keepAwake(on) {
  const K = plugin("KeepAwake");
  if (!K) return false;
  try { await call(K, on ? "keepAwake" : "allowSleep"); return true; } catch { return false; }
}

let barStyle = "";
export function statusBar(theme) {
  const B = plugin("StatusBar");
  const style = theme === "light" ? "LIGHT" : "DARK"; // Capacitor: LIGHT = dark text for light pages, DARK = light text
  if (!B || style === barStyle) return;
  barStyle = style;
  call(B, "setStyle", { style }).catch(() => { barStyle = ""; });
}

/* ---------- a newer version in the App Store? ---------- */
const STORE_ID = "6834991531";
const STORE_URL = "https://apps.apple.com/us/app/i-5-buddy/id" + STORE_ID;
const LOOKUP = "https://itunes.apple.com/lookup?id=" + STORE_ID;
const DAY = 24 * 3600e3;
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem("i5b:" + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("i5b:" + k, JSON.stringify(v)); } catch {} },
};
/** "2.10.1" > "2.9" (missing parts count as 0). */
export function newer(a, b) {
  const pa = String(a || "").split(".").map(n => parseInt(n, 10) || 0), pb = String(b || "").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
/** This app's own version: sw.js's VERSION line (the iPhone app's MARKETING_VERSION is kept equal to it). */
async function ownVersion() {
  try {
    const r = await fetch("sw.js", { cache: "no-store" });
    const m = r.ok && /VERSION\s*=\s*"i5b-v([\w.-]{1,30})"/.exec(await r.text());
    if (m) return m[1];
  } catch {}
  return "2.6.1";
}
/** The App Store's version of the app, or null. Native HTTP when the shell has it (no CORS), else fetch. 10 s, quiet. */
async function lookup() {
  const http = plugin("CapacitorHttp");
  const parse = d => {
    try { const j = typeof d === "string" ? JSON.parse(d) : d; const v = j && j.results && j.results[0] && j.results[0].version; return typeof v === "string" && /^\d+(\.\d+){0,3}$/.test(v) ? v : null; } catch { return null; }
  };
  const timeout = new Promise(res => setTimeout(() => res(null), 10000));
  const ask = (async () => {
    if (http && typeof http.get === "function") {
      try { const r = await http.get({ url: LOOKUP, connectTimeout: 10000, readTimeout: 10000 }); if (r && r.status === 200) return parse(r.data); } catch {}
    }
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const t = setTimeout(() => ac && ac.abort(), 10000);
    try { const r = await fetch(LOOKUP, { cache: "no-store", credentials: "omit", signal: ac ? ac.signal : undefined }); return r.ok ? parse(await r.json()) : null; }
    catch { return null; } finally { clearTimeout(t); }
  })();
  return Promise.race([ask, timeout]);
}
export async function storeUpdate(force = false) {
  if (!NATIVE) return null;
  try {
    const mine = await ownVersion();
    let c = ls.get("storeCheck");
    if (force || !c || typeof c.t !== "number" || Date.now() - c.t > DAY || c.t > Date.now()) {
      const v = await lookup();
      c = { t: Date.now(), v: v || (c && c.v) || null };
      ls.set("storeCheck", c);
    }
    if (!c.v || !newer(c.v, mine) || ls.get("storeLater") === c.v) return null;
    return { version: c.v, url: STORE_URL };
  } catch { return null; }
}
export function storeUpdateLater(v) { ls.set("storeLater", v); }
