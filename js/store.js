// Saved settings, live trip state and a tiny event bus. Everything stays on the phone.
const PREFIX = "i5b:";

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode or full */ }
  },
  del(key) { try { localStorage.removeItem(PREFIX + key); } catch {} },
};

const handlers = new Map();
export const bus = {
  on(evt, fn) { if (!handlers.has(evt)) handlers.set(evt, new Set()); handlers.get(evt).add(fn); return () => bus.off(evt, fn); },
  off(evt, fn) { handlers.get(evt)?.delete(fn); },
  emit(evt, data) {
    for (const fn of [...(handlers.get(evt) || [])]) {
      try { fn(data); } catch (e) { console.error(`[bus] ${evt}`, e); }
    }
  },
};

const ALL_CATS = ["farm", "hist", "nature", "town", "stop", "odd"];
const defaults = {
  narr: true,            // speak landmarks
  zoneNarr: true,        // describe the landscape as it changes
  chat: "normal",        // "low" (big things only) | "normal" | "high" (everything, plus deep dives on long empty stretches)
  lead: 2,               // minimum heads-up distance in miles
  rate: 1,               // speech rate
  voice: "",             // voiceURI
  cats: ALL_CATS,        // categories to narrate
  kid: false,            // kid mode: I-spy prompts and simpler extras
  chime: true,           // soft chime before each announcement
  live: null,            // live road info: null = not asked yet, true/false
  theme: "auto",         // "auto" (day/night by the sun) | "dark" | "light"
};

const saved = store.get("settings", {});
export const settings = { ...defaults, ...saved, cats: new Set(saved.cats || defaults.cats) };
export function saveSettings() {
  store.set("settings", { ...settings, cats: [...settings.cats] });
  bus.emit("settings", settings);
}

// Live state of the trip. Mutated by main.js / narrator.js; everyone else reads it.
export const S = {
  mode: "off",                 // "off" | "gps" | "demo" | "manual"
  m: store.get("m", null),     // corridor mile (miles from the Mexico border along I-5), or null
  dir: store.get("dir", "N"),  // "N" = toward Canada, "S" = toward Mexico
  speed: null,                 // mph
  heading: null,               // degrees from GPS, if any
  lat: null, lon: null,        // last GPS fix
  offRoute: false,
  accuracy: null,              // GPS accuracy in meters
  stamps: store.get("stamps", {}), // place id -> first time collected (ms)
  dest: store.get("dest", null),   // {name, m} or null
};
export function saveStamps() { store.set("stamps", S.stamps); }
