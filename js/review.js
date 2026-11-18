// The App Store rating prompt (3.0.1). iPhone app only. It owns no markup.
//
// Apple's own prompt (native.requestReview: SKStoreReviewController / AppStore.requestReview) is asked for at a quiet,
// happy moment, never from a button (the button is Settings > About > Rate I-5 Buddy, which opens the App Store page)
// and never with an app-made "Enjoying it?" question first (guideline 5.6.1). Apple decides whether the sheet shows (at
// most 3 times in 365 days) and never says.
//
// When (every rule must hold):
// - Earned: a real GPS trip with 20+ miles on I-5 and 5+ landmarks actually spoken, with no location trouble this
//   session (location refused or off, Precise Location off, GPS lost for a while) and Send feedback not opened; or a
//   demo drive of 3+ minutes with 4+ landmarks spoken, on a later day than the app's first use.
// - The moment: just after End trip (the car stopped: last speed under 5 mph), or the end of that demo, after 2 quiet
//   seconds: nothing spoken or queued, no sheet open, the page visible. Never while a trip runs.
// - Caps: once per app version, 120+ days since the last ask, at most 2 asks in any 365 days.
//
// Saved (store "review"): {first: day the app was first used, asks: [times], v: last version asked}.

const DAY = 864e5;
const TRIP_MI = 20, TRIP_SPOKEN = 5, DEMO_MS = 3 * 60e3, DEMO_SPOKEN = 4;
const GAP_DAYS = 120, PER_YEAR = 2, QUIET_MS = 2000;

let api = null, rec = null, trouble = false, spoken = new Set(), miles = 0, lastM = null, timer = 0;

function save() { try { api.store.set("review", rec); } catch {} }
function load() {
  rec = (api.store.get("review", null)) || {};
  if (!Array.isArray(rec.asks)) rec.asks = [];
  if (!rec.first) { rec.first = new Date().toISOString().slice(0, 10); save(); }
}

/** Every rule about when, given the facts. Pure (tests call it). */
export function mayAsk({ native, version, asks = [], lastVersion = null, now = Date.now(), trouble = false }) {
  if (!native || trouble) return false;
  if (lastVersion && lastVersion === version) return false;
  const recent = asks.filter(t => now - t < 365 * DAY);
  if (recent.length >= PER_YEAR) return false;
  if (asks.length && now - Math.max(...asks) < GAP_DAYS * DAY) return false;
  return true;
}
/** Did this trip or demo earn it? Pure. */
export function earned({ mode, miles = 0, spoken = 0, ms = 0, firstDay = null, today = null }) {
  if (mode === "gps") return miles >= TRIP_MI && spoken >= TRIP_SPOKEN;
  if (mode === "demo") return ms >= DEMO_MS && spoken >= DEMO_SPOKEN && !!firstDay && !!today && today > firstDay;
  return false;
}

function quiet() {
  const v = api.voice;
  if (v.isSpeaking() || v.queued().length) return false;
  if (document.hidden) return false;
  if (document.querySelector(".sheet:not([hidden]), .nav-sheet:not([hidden]), .nv-doc:not([hidden])")) return false;
  if (api.S.mode !== "off") return false;
  return true;
}
function askSoon() {
  clearTimeout(timer);
  let waited = 0;
  const tick = () => {
    if (!quiet()) { waited = 0; if ((tick.n = (tick.n || 0) + 1) > 30) return; timer = setTimeout(tick, 1000); return; }
    waited += 1000;
    if (waited < QUIET_MS) { timer = setTimeout(tick, 1000); return; }
    const version = (api.APP_VERSION || "");
    if (!mayAsk({ native: api.native.NATIVE, version, asks: rec.asks, lastVersion: rec.v, trouble })) return;
    rec.asks.push(Date.now()); rec.v = version; save();
    api.native.requestReview();
  };
  timer = setTimeout(tick, 1000);
}

function resetTrip() { spoken = new Set(); miles = 0; lastM = null; }

export function init(a) {
  api = a;
  if (!api.native || !api.native.NATIVE) return; // the website and the Android app: nothing here
  load();
  const { bus } = api;
  bus.on("mode", m => { if (m === "gps" || m === "demo") resetTrip(); });
  bus.on("speaking", s => { if (s && s.id && (api.S.mode === "gps" || api.S.mode === "demo") && api.data.placeById(s.id)) spoken.add(s.id); });
  bus.on("pos", e => {
    if (!e || api.S.mode !== "gps" || e.offRoute) { lastM = null; return; }
    if (lastM != null && !e.jumped && e.m != null) miles += Math.abs(e.m - lastM);
    lastM = e.m;
  });
  bus.on("trouble", () => { trouble = true; });
  bus.on("trip:end", e => {
    if (!e || e.mode !== "gps") return;
    if (e.speed != null && e.speed >= 5) return; // ended while moving (a passenger): not now
    if (earned({ mode: "gps", miles, spoken: spoken.size })) askSoon();
  });
  bus.on("demo:end", e => {
    const today = new Date().toISOString().slice(0, 10);
    if (earned({ mode: "demo", ms: e && e.ms, spoken: e && e.places, firstDay: rec.first, today })) askSoon();
  });
}

export const _test = { mayAsk, earned };
