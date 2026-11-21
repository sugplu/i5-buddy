// I-5 Buddy's words in English and Spanish (3.1.0).
//
// Every word the app shows or says comes from t("key") (or t("key", {name: value}) for a sentence with blanks):
// i18n/en.json is the source, i18n/es.json has the same keys, and a key the Spanish file leaves empty falls back to
// English, one key at a time. index.html marks its words with data-i18n="key" (text), data-i18n-html="key" (markup) and
// data-i18n-attr="aria-label:key;title:key" (attributes); applyDom() swaps them in Spanish, and English pages are left
// exactly as written. The language is picked once per page load: switching it in Settings saves it and reloads.
//
//   Which language: ?lang=es or ?lang=en in the address (the Spanish pages on i5.dominares.org/es/ link to the app
//   with it), else the saved choice (store "lang"), else, on the first run only, the phone's language (es* = Spanish)
//   when the Spanish words are ready (READY_SHARE of the keys filled); the first run saves what it picked (a Spanish phone
//   that got English because the Spanish words were not there yet is asked again on its next start).
//
// Spanish mode also loads data/i5.es.js (window.I5DATA_ES, written by tools/build.py next to data/i5.js from the
// *_es fields of the content files; not in sw.js SHELL, the service worker keeps it once fetched) and lays its
// Spanish names and stories over the road data (localizeData, called by data.js), keeping the English in `en` on each
// changed item for the code that still needs it (Ask Buddy listens and answers in English in this build).
//
// Numbers and times: loc(orig) is the locale argument for toLocaleString / toLocaleDateString / toLocaleTimeString,
// `orig` (exactly what the call used before 3.1.0) in English and the Spanish locales in Spanish. Miles stay miles.
//
// Tests: a page that sets window.__BUDDY_I18N__ = {es: {key: "..."}, data: {places: {...}}} around the app has those
// Spanish words and stories laid over es.json and data/i5.es.js (tools/test-i18n.html); nothing else changes.
import { store } from "./store.js";

export const LANGS = ["en", "es"];
/** The locales Intl uses for Spanish: Spanish as written in the United States, then Mexico, then any Spanish. */
export const ES_LOCALES = ["es-US", "es-MX", "es"];
/** The share of Spanish keys that must be filled before a phone set to Spanish starts in Spanish by itself. */
export const READY_SHARE = 0.9;

const TEST = (() => { try { return window.top.__BUDDY_I18N__ || null; } catch { return null; } })();
const BASE = (() => { try { return new URL("../", import.meta.url); } catch { return null; } })();

async function loadJSON(path) {
  if (!BASE) return {};
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => { try { ac && ac.abort(); } catch {} }, 15000);
  try {
    const r = await fetch(new URL(path, BASE).href, ac ? { signal: ac.signal } : undefined);
    const j = r.ok ? await r.json() : {};
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch { return {}; } finally { clearTimeout(timer); }
}
function loadScript(path, ms) {
  return new Promise(resolve => {
    if (!BASE || typeof document === "undefined") return resolve(false);
    const s = document.createElement("script");
    s.src = new URL(path, BASE).href;
    const timer = setTimeout(() => resolve(false), ms);
    s.onload = () => { clearTimeout(timer); resolve(true); };
    s.onerror = () => { clearTimeout(timer); resolve(false); };
    (document.head || document.documentElement).append(s);
  });
}
const filled = d => Object.values(d).filter(v => typeof v === "string" && v.trim()).length;

/** The language asked for in the address (?lang=es), or null. */
function asked() {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    const l = q && q.toLowerCase().slice(0, 2);
    return LANGS.includes(l) ? l : null;
  } catch { return null; }
}
const phoneSpanish = () => {
  try { return /^es\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || ""); } catch { return false; }
};

let lang = asked();
if (lang) store.set("lang", lang);
else {
  const saved = store.get("lang", null);
  if (LANGS.includes(saved)) lang = saved;
}
// both dictionaries at once (they are in sw.js SHELL, so an installed app reads them from its own copy)
const [EN, ES0] = await Promise.all([loadJSON("i18n/en.json"), lang === "es" || (!lang && phoneSpanish()) ? loadJSON("i18n/es.json") : {}]);
let ES = ES0;
if (TEST && TEST.es && typeof TEST.es === "object") ES = { ...ES, ...TEST.es };
/** How much of the Spanish dictionary is filled (0 to 1). */
export const ES_SHARE = Object.keys(EN).length ? Math.min(1, filled(ES) / Object.keys(EN).length) : 0;
if (!lang) {
  // the first run: the phone's language, saved. A phone set to Spanish starts in Spanish once the Spanish words are there;
  // until then it gets English without saving it, so the first start after they arrive still picks Spanish by itself.
  if (phoneSpanish()) {
    lang = ES_SHARE >= READY_SHARE ? "es" : "en";
    if (lang === "es") store.set("lang", lang);
  } else {
    lang = "en";
    store.set("lang", lang);
  }
}
/** The language of this page load: "en" or "es". */
export const LANG = lang;
export const IS_ES = LANG === "es";
const DICT = IS_ES ? ES : {};
try { document.documentElement.lang = LANG; } catch {}

/** The words for key in this page's language, with {name} blanks filled from vars. A key Spanish leaves empty falls
    back to English; a key English does not have shows itself (tools/test-i18n.html?s=keys catches it). */
export function t(key, vars) {
  const own = DICT[key];
  let s = typeof own === "string" && own.trim() ? own : EN[key];
  if (typeof s !== "string") s = String(key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  return s;
}
/** The English words for key, whatever the language (for code that must stay English: Ask Buddy, voice clips). */
export function en(key, vars) {
  let s = EN[key];
  if (typeof s !== "string") s = String(key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  return s;
}
/** True when this language has its own words for key (English always does). */
export const has = key => !IS_ES || (typeof DICT[key] === "string" && !!DICT[key].trim());
/** The locale argument for Intl: what the call used before (orig) in English, the Spanish locales in Spanish. */
export const loc = orig => (IS_ES ? ES_LOCALES : orig);
/** The Intl locale list for this language (for new code; English: the browser's own, like the old calls). */
export const LOCALE = IS_ES ? ES_LOCALES : undefined;
/** Capitalise the first letter (any language). */
export const cap = s => (s ? String(s).charAt(0).toLocaleUpperCase(IS_ES ? ES_LOCALES : undefined) + String(s).slice(1) : "");

/** Switch the language: saved, then the app starts again in it (a drive is offered back after the restart). */
export function setLang(l) {
  if (!LANGS.includes(l)) return false;
  store.set("lang", l);
  if (l === LANG) return false;
  try {
    // ?lang= in the address would win over the choice just made
    const u = new URL(location.href);
    if (u.searchParams.has("lang")) { u.searchParams.delete("lang"); history.replaceState(history.state, "", u.href); }
  } catch {}
  try { location.reload(); } catch {}
  return true;
}

/** Put the Spanish words into index.html's marked elements (nothing happens in English, or for a key Spanish lacks). */
export function applyDom(root = document) {
  if (!IS_ES || !root || !root.querySelectorAll) return;
  const own = k => (typeof DICT[k] === "string" && DICT[k].trim() ? DICT[k] : null);
  for (const el of root.querySelectorAll("[data-i18n]")) { const v = own(el.dataset.i18n); if (v != null) el.textContent = v; }
  for (const el of root.querySelectorAll("[data-i18n-html]")) { const v = own(el.dataset.i18nHtml); if (v != null) el.innerHTML = v; }
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of String(el.dataset.i18nAttr).split(";")) {
      const i = pair.indexOf(":");
      if (i < 1) continue;
      const v = own(pair.slice(i + 1).trim());
      if (v != null) el.setAttribute(pair.slice(0, i).trim(), v);
    }
  }
}

/* ---------- the Spanish road data ---------- */

let ESDATA = null;
if (IS_ES) {
  // ?v= the data's own version: a copy of another build's Spanish file in the browser's cache is never used
  let v = "";
  try { v = window.I5DATA && window.I5DATA.version ? "?v=" + encodeURIComponent(window.I5DATA.version) : ""; } catch {}
  // At most 5 s: on a stalled connection the app starts with the English stories rather than a blank screen (the 3.0.1
  // offline rule); the request carries on and the service worker keeps the file for the next start.
  if (!(TEST && TEST.skipData)) await loadScript("data/i5.es.js" + v, 5000);
  try { ESDATA = window.I5DATA_ES && typeof window.I5DATA_ES === "object" ? window.I5DATA_ES : null; } catch { ESDATA = null; }
  if (TEST && TEST.data && typeof TEST.data === "object") ESDATA = merge(ESDATA || {}, TEST.data);
}
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? merge(a[k], v) : v;
  return out;
}
const str = v => (typeof v === "string" && v.trim() ? v : null);
/** Lay the Spanish names and stories over the road data (data.js calls it once, before anything reads the data).
    Each changed item keeps its English in `en`. Returns what it did: {places, zones, trivia, missions} counts. */
export function localizeData(D) {
  const done = { places: 0, zones: 0, trivia: 0, missions: 0, dests: 0 };
  if (!IS_ES || !D || !ESDATA) return done;
  const X = ESDATA;
  // an overlay from another build (an old cached copy) is not used: its stories may belong to other places
  if (X.version && D.version && X.version !== D.version && !(TEST && TEST.data)) return done;
  const lay = (item, o, keys) => {
    if (!item || !o) return false;
    let any = false;
    for (const k of keys) {
      const v = k === "seasons" || k === "choices" ? o[k] : str(o[k]);
      if (v == null || (k === "seasons" && typeof v !== "object") || (k === "choices" && !(Array.isArray(v) && v.length === (item.choices || []).length && v.every(str)))) continue;
      if (!item.en) Object.defineProperty(item, "en", { value: {}, enumerable: false, configurable: true });
      if (!(k in item.en)) item.en[k] = item[k];
      item[k] = k === "seasons" ? { ...(item.seasons || {}), ...Object.fromEntries(Object.entries(v).filter(([, s]) => str(s))) } : v;
      any = true;
    }
    return any;
  };
  if (X.ends && typeof X.ends === "object" && D.ends) {
    for (const side of ["S", "N"]) if (X.ends[side] && D.ends[side]) lay(D.ends[side], X.ends[side], ["short", "long"]);
  }
  const P = X.places || {};
  for (const p of D.places || []) {
    const o = P[p.id];
    // kids text: the Spanish one in Spanish mode, never the English one
    if (p.kids && !(o && str(o.kids))) { if (!p.en) Object.defineProperty(p, "en", { value: {}, enumerable: false, configurable: true }); p.en.kids = p.kids; delete p.kids; }
    if (!o) continue;
    if (lay(p, o, ["name", "text", "more", "spot", "pc", "kids"])) done.places++;
    if (str(o.alt) && p.img) p.img = { ...p.img, alt_local: o.alt };
  }
  const Z = X.zones || {};
  (D.zones || []).forEach((z, i) => { if (lay(z, Z[i], ["label", "text", "seasons"])) done.zones++; });
  const T = X.trivia || {};
  (D.trivia || []).forEach((q, i) => { if (lay(q, T[i], ["q", "choices", "why"])) done.trivia++; });
  const M = X.missions || {};
  for (const m of D.missions || []) { if (lay(m, M[m.n], ["name", "text", "more", "visit", "status", "people", "founder"])) done.missions++; }
  const DS = X.dests || {};
  (D.dests || []).forEach((d, i) => { if (lay(d, DS[i], ["name"])) done.dests++; });
  if (X.postcards && typeof X.postcards === "object" && D.postcards) {
    for (const [k, v] of Object.entries(X.postcards)) if (Array.isArray(v) && v.length && v.every(str)) D.postcards[k] = v;
  }
  return done;
}
/** Is the Spanish road data loaded (any Spanish story at all)? */
export const hasSpanishData = () => !!ESDATA;

export const i18n = { LANG, LANGS, IS_ES, ES_SHARE, READY_SHARE, t, en, has, loc, cap, setLang, applyDom, localizeData };
