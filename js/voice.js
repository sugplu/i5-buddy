// Speech: a priority queue in front of I-5 Buddy's own recorded voice (clips) and speechSynthesis, plus a soft chime
// made with Web Audio.
//
// Rules:
// - One item speaks at a time. Higher prio first; items asked for "now" go to the very front.
// - say({now:true}) interrupts what is speaking and drops queued low-priority items, but keeps urgent ones
//   (prio >= 2: chain controls, severe weather, navigation). An urgent item that gets interrupted is re-queued after.
// - hold(true) pauses everything (used while the microphone listens); nothing is lost, the current item is
//   re-queued and replays after hold(false).
// - stop() is the user's "be quiet": it clears everything, including a chime that is still ringing.
// - Silent tests: with ?silent=1 in the address, or window.top.__BUDDY_SILENT__ set by the test page around the app,
//   nothing is ever heard (see silentSynth below). Without the flag nothing here changes.
//
// The natural voice (3.0): every sentence the app can say was recorded ahead of time (tools/voice/; voice "Asteria",
// Deepgram Aura-2 on Dominares' Cloudflare account, picked by ear by Joseph on 2026-11-17). speechUnits(text) cuts a line into units (sentences, and the lead
// before a colon, "In about 2 miles, on your right:"); unitKey(unit) names the clip; voice/<id>/index.json lists every
// clip there is. When the natural voice is on and EVERY unit of an item has a clip, the clips are decoded, joined with
// short pauses into one recording and played on one <audio> element (so the speed setting keeps the pitch, and an
// iPhone's silent switch doesn't mute it); otherwise the item is read by the device's own voice, the way it always was.
// A caller may pass `units` (an array of fixed phrases whose concatenation is the text: navigation prompts) so a
// sentence built from parts can still use clips.
import { settings, bus } from "./store.js";

const SILENT = (() => {
  try { if (/[?&]silent=1(&|$)/.test(location.search)) return true; } catch {}
  try { if (window.top.__BUDDY_SILENT__ === true) return true; } catch {}
  return false;
})();
const synth = SILENT ? silentSynth(window.speechSynthesis || null) : window.speechSynthesis || null;

/** The speech engine for silent tests. It records what would have been spoken in window.__BUDDY_SPOKEN__ (and in the
    top window's, when reachable) and plays each utterance for about 15 ms a word (at most 1.5 s): start, then end, with
    speaking, pending and paused like the real engine, so the queue below runs as usual. A test page that brings its own
    fake engine (its own object, or the browser's with speak() swapped) keeps it: that one is silent already, and the
    page checks what it was given. This engine is also what window.speechSynthesis returns from now on, so a page that
    swaps that object's insides after the app has started (test-play.html, test-listen.html) swaps this one's. */
function silentSynth(real) {
  try {
    const SS = window.SpeechSynthesis;
    if (real && (typeof SS !== "function" || !(real instanceof SS) || real.speak !== SS.prototype.speak)) return real;
  } catch {}
  if (typeof window.SpeechSynthesisUtterance !== "function") window.SpeechSynthesisUtterance = function (t) { this.text = String(t == null ? "" : t); };
  let q = [], cur = null, timer = 0, paused = false, left = 0, since = 0;
  const later = fn => setTimeout(fn, 0);
  const fire = (u, type, error) => {
    const h = u && u["on" + type];
    if (typeof h !== "function") return;
    try { h.call(u, { type, utterance: u, error, charIndex: 0, elapsedTime: 0, name: "" }); }
    catch (e) { try { window.reportError(e); } catch {} }
  };
  const play = u => {
    since = performance.now();
    clearTimeout(timer);
    timer = setTimeout(() => { if (cur !== u) return; cur = null; fire(u, "end"); next(); }, left);
  };
  const next = () => {
    if (cur || paused || !q.length) return;
    const u = cur = q.shift();
    left = Math.min(1500, 15 * Math.max(1, String(u.text == null ? "" : u.text).trim().split(/\s+/).length));
    since = performance.now();
    fire(u, "start");
    if (cur === u && !paused) play(u);
  };
  const engine = {
    get speaking() { return !!cur; },
    get pending() { return q.length > 0; },
    get paused() { return paused; },
    speak(u) { if (!u) return; record(u.text); q.push(u); later(next); },
    cancel() {
      const c = cur, waiting = q;
      q = []; cur = null; clearTimeout(timer);
      if (c) later(() => fire(c, "error", "interrupted"));
      for (const u of waiting) later(() => fire(u, "error", "canceled"));
    },
    pause() {
      if (paused) return;
      paused = true;
      const c = cur;
      if (c) { clearTimeout(timer); left = Math.max(0, left - (performance.now() - since)); later(() => fire(c, "pause")); }
    },
    resume() {
      if (!paused) return;
      paused = false;
      const c = cur;
      if (c) { play(c); later(() => fire(c, "resume")); } else later(next);
    },
    getVoices() { try { return real ? real.getVoices() : []; } catch { return []; } },
    addEventListener(...a) { try { real && real.addEventListener(...a); } catch {} },
    removeEventListener(...a) { try { real && real.removeEventListener(...a); } catch {} },
  };
  try { Object.defineProperty(window, "speechSynthesis", { configurable: true, get: () => engine }); } catch {}
  return engine;
}
/** What a silent test hears: the text goes to window.__BUDDY_SPOKEN__ (and the top window's). */
function record(text) {
  text = String(text == null ? "" : text);
  if (!text.trim()) return;
  const wins = [window];
  try { if (window.top !== window) wins.push(window.top); } catch {}
  for (const w of wins) { try { (w.__BUDDY_SPOKEN__ = w.__BUDDY_SPOKEN__ || []).push(text); } catch {} }
}

/* ---------- speech units and clip names (tools/voice/units.html lists every unit the app can say with these) ---------- */

// A period after one of these words, or after a lone initial ("J. B. Lankershim", "B.F. Sisk"), does not end a sentence.
const ABBR = new Set(["mt", "st", "ft", "dr", "mr", "mrs", "ms", "jr", "sr", "no", "vs", "etc", "ave", "blvd", "hwy", "rd", "co",
  "inc", "ltd", "gen", "gov", "lt", "capt", "sgt", "rev", "prof", "u.s", "a.m", "p.m", "approx", "est", "sen", "rep", "col", "maj"]);
const norm = t => String(t == null ? "" : t).replace(/\s+/g, " ").trim();
/** Cut a line into the units the natural voice has clips for: sentences, and the lead before ": ". Deterministic, and
    the same function lists the units when the clips are made, so a line and its clips always agree. */
export function speechUnits(text) {
  const s = norm(text);
  if (!s) return [];
  const out = [];
  const re = /([.!?]+["'’”)\]]*|:)(\s+|$)/g;
  let start = 0, m;
  while ((m = re.exec(s))) {
    const end = m.index + m[1].length;
    if (m[1] !== ":") {
      if (m[1][0] === "." && !/[!?]/.test(m[1])) {
        const w = (s.slice(start, m.index).match(/([A-Za-z.]+)$/) || [])[1] || "";
        if (ABBR.has(w.toLowerCase()) || /^[A-Z]$/.test(w) || /^([A-Za-z]\.)+[A-Za-z]$/.test(w)) continue;
      }
      const next = s[re.lastIndex];
      if (next && !/[A-Z0-9"'“‘(\[¿¡]/.test(next)) continue;
    } else if (!m[2]) continue; // a colon at the very end stays with its text
    out.push(s.slice(start, end).trim());
    start = re.lastIndex;
  }
  if (start < s.length) out.push(s.slice(start).trim());
  return out.filter(Boolean);
}
/** cyrb53: a fast 53-bit string hash (public domain). */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** The clip name of a unit: 14 hex digits. */
export function unitKey(unit) { return cyrb53(norm(unit)).toString(16).padStart(14, "0"); }

/* ---------- the natural voice ---------- */

const VOICE_ID = "asteria";
const VOICE_CACHE = "i5b-voice-" + VOICE_ID;   // sw.js keeps this cache across versions
export const NATURAL_URI = "buddy:" + VOICE_ID;
const NATURAL = { name: "I-5 Buddy voice", voiceURI: NATURAL_URI, lang: "en-US", localService: true, default: true, natural: true };
let VBASE = null;
// 3.1: who speaks while the page is hidden (the iPhone app with the screen locked): native.js's playInBackground,
// handed in by main.js (voice.setBackground). null in a browser, where nothing can talk in the background.
let bgSpeak = null, bgHush = null;
try { VBASE = new URL("../voice/" + VOICE_ID + "/", import.meta.url); } catch {}
const CLIPTEST = () => { try { return window.top.__BUDDY_CLIPTEST__ || null; } catch { return null; } };
let manifest = null, manifestP = null, manifestTried = 0;
const raw = new Map();   // clip key -> Promise<ArrayBuffer> (compressed; most recent last)
const RAW_MAX = 400;

function fetchT(url, ms) {
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const t = setTimeout(() => { try { ac && ac.abort(); } catch {} }, ms);
  return fetch(url, ac ? { signal: ac.signal } : undefined).finally(() => clearTimeout(t));
}
/** voice/<id>/index.json: {v, voice, n, bytes, keys: "<14 hex digits per clip, back to back>"} */
function useManifest(j) {
  if (!j || typeof j.keys !== "string" || j.keys.length % 14 !== 0) return null;
  const set = new Set();
  for (let i = 0; i < j.keys.length; i += 14) set.add(j.keys.slice(i, i + 14));
  manifest = { n: set.size, bytes: +j.bytes || 0, has: set };
  bus.emit("voices", voices);
  return manifest;
}
function loadManifest() {
  if (manifest) return Promise.resolve(manifest);
  if (manifestP) return manifestP;
  const test = CLIPTEST();
  if (test && test.manifest) return Promise.resolve(useManifest(test.manifest));
  if (!VBASE || (SILENT && !test) || Date.now() - manifestTried < 60000) return Promise.resolve(null);
  manifestTried = Date.now();
  manifestP = fetchT(new URL("index.json", VBASE).href, 15000)
    .then(r => (r.ok ? r.json() : null))
    .then(useManifest)
    .catch(() => null)
    .finally(() => { manifestP = null; });
  return manifestP;
}
const naturalPicked = () => !settings.voice || settings.voice === NATURAL_URI;
// The iPhone app carries the clips for everything except the long stories ("Tell me more"); those come from the website
// the first time and are kept by the web view's cache, so they still play when the app's own copy is missing.
const VREMOTE = (() => { try { return location.protocol === "capacitor:" ? new URL("https://i5.dominares.org/voice/" + VOICE_ID + "/") : null; } catch { return null; } })();
function clipUrl(k, base = VBASE) { return new URL(k.slice(0, 2) + "/" + k + ".m4a", base).href; }
function fetchClip(k) {
  let p = raw.get(k);
  if (p) { raw.delete(k); raw.set(k, p); return p; }
  const test = CLIPTEST();
  const get = base => fetchT(clipUrl(k, base), 15000).then(r => { if (!r.ok) throw new Error("clip " + r.status); return r.arrayBuffer(); });
  p = test && test.fetch ? new Promise(res => res(test.fetch(k)))
    : new Promise(res => res(get(VBASE))).catch(e => { if (VREMOTE) return get(VREMOTE); throw e; });
  p.catch(() => raw.delete(k));
  raw.set(k, p);
  while (raw.size > RAW_MAX) raw.delete(raw.keys().next().value);
  return p;
}
/** The units and clip names of an item when the natural voice can say all of it, else null. */
function clipPlan(item) {
  if (!naturalPicked() || !manifest || (SILENT && !CLIPTEST())) return null;
  const units = Array.isArray(item.units) && item.units.length ? item.units.map(norm).filter(Boolean) : speechUnits(item.text);
  if (!units.length) return null;
  const keys = units.map(unitKey);
  return keys.every(k => manifest.has.has(k)) ? { units, keys } : null;
}
/** Start downloading an item's clips (on queueing, so they are ready by the time it speaks). */
function warm(item) {
  try {
    const plan = clipPlan(item);
    if (plan) for (const k of plan.keys) fetchClip(k).catch(() => {});
  } catch { /* a clip that can't be fetched is read by the device voice */ }
}

// Decoding: an OfflineAudioContext at the clips' own rate (24 kHz) decodes without waking the audio hardware.
let decoder = null;
function decodeCtx() {
  if (decoder) return decoder;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  try { if (OAC) decoder = new OAC(1, 24000, 24000); } catch { decoder = null; }
  return decoder || audio();
}
function decode(ab) {
  const test = CLIPTEST();
  if (test && test.decode) return Promise.resolve(test.decode(ab));
  const dc = decodeCtx();
  if (!dc) return Promise.reject(new Error("no decoder"));
  return new Promise((res, rej) => {
    let p;
    try { p = dc.decodeAudioData(ab.slice(0), res, rej); } catch (e) { rej(e); return; }
    if (p && typeof p.then === "function") p.then(res, rej);
  });
}
/** Pause after a unit: a full stop after a sentence, a short breath after a colon or a comma. */
function gapAfter(u) {
  const c = u.replace(/["'’”)\]]+$/, "").slice(-1);
  return c === "." || c === "!" || c === "?" ? 0.28 : c === ":" ? 0.16 : c === "," ? 0.09 : 0.05;
}
/** One mono 16-bit WAV from the decoded units and their pauses. */
function wav(parts, rate) {
  let n = 0;
  for (const p of parts) n += p.length;
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const p of parts) for (let i = 0; i < p.length; i++, o += 2) { const s = p[i] > 1 ? 1 : p[i] < -1 ? -1 : p[i]; v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}
/** Decode an item's clips and join them. Resolves {blob, seconds}, or null when anything is missing in time. */
async function render(plan, ms = 4500) {
  const timeout = new Promise(r => setTimeout(() => r(null), ms));
  const work = (async () => {
    const bufs = await Promise.all(plan.keys.map(k => fetchClip(k).then(decode)));
    const rate = bufs[0].sampleRate || 24000;
    const parts = [new Float32Array(Math.round(rate * 0.04))];
    bufs.forEach((b, i) => {
      parts.push(b.getChannelData(0));
      if (i < bufs.length - 1) parts.push(new Float32Array(Math.round(rate * gapAfter(plan.units[i]))));
    });
    parts.push(new Float32Array(Math.round(rate * 0.06)));
    let n = 0;
    for (const p of parts) n += p.length;
    const test = CLIPTEST();
    return { blob: test ? null : wav(parts, rate), seconds: n / rate };
  })().catch(() => null);
  return Promise.race([work, timeout]);
}

// One <audio> element plays every recording: a tap unlocks it once (iOS), and later plays need no tap.
let player = null, playerUnlocked = false, playing = null;
function getPlayer() {
  if (player) return player;
  try { player = new Audio(); player.preload = "auto"; player.setAttribute("playsinline", ""); } catch { player = null; }
  return player;
}
let silentUrl = null;
function unlockPlayer() {
  if (SILENT || playerUnlocked) return;
  const p = getPlayer();
  if (!p || playing) return;
  try {
    // a tenth of a second of silence, played inside the tap
    if (!silentUrl) silentUrl = URL.createObjectURL(wav([new Float32Array(2400)], 24000));
    p.src = silentUrl;
    const r = p.play();
    if (r && typeof r.then === "function") r.then(() => { playerUnlocked = true; }, () => {});
    else playerUnlocked = true;
  } catch {}
}
/** Play an item's recording. Resolves "done", "stopped" (interrupted) or "failed" (the caller falls back). */
function playRecording(item, rec) {
  return new Promise(resolve => {
    const test = CLIPTEST();
    const rate = Math.max(0.6, Math.min(1.6, +settings.rate || 1));
    let settled = false, url = null, guard = 0;
    const finish = how => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (playing && playing.item === item) playing = null;
      if (url) { try { URL.revokeObjectURL(url); } catch {} }
      resolve(how);
    };
    playing = { item, stop: () => { try { if (!test) { player.pause(); player.removeAttribute("src"); player.load(); } } catch {} finish("stopped"); } };
    if (test) {
      // the clip test: nothing is heard; it lasts as long as the real recording would, sped up 20 times
      record(item.text);
      try { test.played && test.played({ id: item.id, text: item.text, units: item.units || null, seconds: rec.seconds }); } catch {}
      guard = setTimeout(() => finish("done"), Math.max(5, rec.seconds * 1000 / rate / 20));
      return;
    }
    const p = getPlayer();
    if (!p || !rec.blob) return finish("failed");
    try {
      url = URL.createObjectURL(rec.blob);
      p.onended = () => finish("done");
      p.onerror = () => finish("failed");
      p.src = url;
      p.playbackRate = rate;
      try { p.preservesPitch = true; p.webkitPreservesPitch = true; } catch {}
      const r = p.play();
      if (r && typeof r.then === "function") r.catch(() => finish("failed"));
      // if "ended" never comes (a background tab, a stalled element), move on anyway
      guard = setTimeout(() => finish("done"), (rec.seconds / rate) * 1000 + 4000);
    } catch { finish("failed"); }
  });
}

/* ---------- the device's voices ---------- */

let voices = [];
let queue = [];        // [{text, units, id, prio, front, check, chime, onstart, onend, resolve, seq}]
let current = null;
let last = null;       // last item spoken (for "repeat")
let held = false;
let ctx = null;        // AudioContext (the chime)
let keepAlive = null;
let chimeNodes = [];
let seq = 0;
const UA = navigator.userAgent || "";
const NEEDS_NUDGE = /Chrome\//.test(UA) && !/Android|Mobile|CriOS|Edg\//.test(UA);

function rankVoice(v) {
  if (/(premium|enhanced|natural|neural)/i.test(v.name)) return 0;
  if (/(samantha|ava|allison|evan|zoe|nicky|aaron|google us english|microsoft aria|microsoft jenny)/i.test(v.name)) return 1;
  if (/^en[-_]US/i.test(v.lang)) return 2;
  return 3;
}
/** An online voice: the browser sends the words to its maker's speech service (on a computer, Chrome's "Google …"
    voices and Edge's "… Online (Natural)" ones). The words can say where you are ("near mile 309, heading north"). */
const isOnline = v => !!v && !v.natural && v.localService === false;
/** Joke and robot voices that phones and Macs list next to the real ones (Apple's Albert, Bad News, Bahh, Zarvox and
    the like, its old MacinTalk voices, and the Eloquence set: Eddy, Flo, Grandma...). Picked by mistake they made
    I-5 Buddy sound "freaky" (Joseph, 2026-11-18), so Settings and narration leave them out (3.0.2). */
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|princess|pipe organ|fred|junior|kathy|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const isNovelty = v => NOVELTY.test(String(v.name || "").trim()) || /eloquence/i.test(String(v.voiceURI || ""));
/** How many device voices Settings offers (the best ones by rankVoice); a long list of near-identical voices was a wall. */
const MAX_VOICES = 8;
function loadVoices() {
  if (!synth) return;
  // The device's own voices first: with the natural voice off and no voice picked, pickVoice() takes the first one, so
  // narration stays on the device unless the person picks an online voice or the browser has no other (privacy.html).
  voices = synth.getVoices().filter(v => /^en/i.test(v.lang) && !isNovelty(v))
    .sort((a, b) => isOnline(a) - isOnline(b) || rankVoice(a) - rankVoice(b) || a.name.localeCompare(b.name))
    .slice(0, MAX_VOICES);
  bus.emit("voices", voices);
}
if (synth) { loadVoices(); synth.addEventListener?.("voiceschanged", loadVoices); }

/** The device voice for an item: the one picked in Settings, else the first (a device voice). */
function pickVoice() {
  return voices.find(v => v.voiceURI === settings.voice) || voices[0] || null;
}

/** Split long text into sentence chunks (Chrome cuts off long utterances; iOS stutters). */
function chunks(text) {
  const parts = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const out = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > 220 && cur) { out.push(cur.trim()); cur = ""; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function audio() {
  if (SILENT) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  clearTimeout(sleepT);
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
// The chime's audio context sleeps a few seconds after the last chime (3.0.1): a running one keeps the phone's audio
// hardware awake all trip for nothing. audio() wakes it again (a context unlocked by a tap once can resume without one).
let sleepT = 0;
function sleepSoon(ms = 3000) {
  clearTimeout(sleepT);
  sleepT = setTimeout(() => { try { if (ctx && ctx.state === "running" && !chimeNodes.length) ctx.suspend().catch(() => {}); } catch {} }, ms);
}

/** Soft bell tones, like a tour-bus PA. kind: "soft" | "alert" | "success". Resolves when it has rung. */
function chime(kind = "soft") {
  const notes = kind === "alert" ? [880, 660, 880] : kind === "success" ? [523.25, 659.25, 783.99] : [659.25, 880];
  if (SILENT) return new Promise(r => setTimeout(r, 160 * notes.length + 260)); // rings just as long, without a sound
  const ac = audio();
  if (!ac) return Promise.resolve();
  const t0 = ac.currentTime + 0.02;
  notes.forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.value = f;
    const t = t0 + i * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + 1);
    const node = { o, g };
    chimeNodes.push(node);
    o.onended = () => { chimeNodes = chimeNodes.filter(n => n !== node); if (!chimeNodes.length) sleepSoon(); };
  });
  return new Promise(r => setTimeout(r, 160 * notes.length + 260));
}
function stopChime() {
  for (const n of chimeNodes) { try { n.g.gain.cancelScheduledValues(0); n.g.gain.value = 0; n.o.stop(); } catch {} }
  chimeNodes = [];
}

/** The longest a chunk may take before the watchdog moves on: about 12 characters a second at the chosen rate, plus
    4 seconds to start. */
export function chunkLimitMs(text, rate = 1) {
  return Math.round((String(text || "").length / 12 / Math.max(0.5, +rate || 1) + 4) * 1000);
}
function speakChunks(item) {
  if (!synth) return Promise.resolve();
  return new Promise(resolve => {
    const parts = chunks(item.text);
    let i = 0, done = false, dog = 0;
    const finish = () => { clearTimeout(dog); if (!done) { done = true; resolve(); } };
    const next = () => {
      clearTimeout(dog);
      if (current !== item || i >= parts.length) return finish(); // interrupted, or finished
      const text = parts[i++];
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
      u.rate = settings.rate || 1;
      let over = false;
      const go = () => { if (over) return; over = true; clearTimeout(dog); next(); };
      u.onend = go;
      u.onerror = e => { if (over) return; if (e.error === "interrupted" || e.error === "canceled") { over = true; finish(); } else go(); };
      // Watchdog (3.0.1): speech engines can lose the "end" of an utterance (a phone call, Siri, a Bluetooth change, the
      // app going to the background, a garbage-collected utterance in Chrome). Without this the queue waited for it
      // forever and nothing more was said for the rest of the drive. Past its time, cancel it and carry on.
      dog = setTimeout(() => {
        if (over || current !== item) return;
        over = true;
        u.onend = u.onerror = null;
        try { synth.cancel(); } catch {}
        setTimeout(next, 150); // a speak() right after cancel() can be dropped (Safari)
      }, chunkLimitMs(text, u.rate));
      synth.speak(u);
    };
    next();
  });
}
// Back from the background, or from a call: a paused engine is resumed (iOS can leave it paused).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !synth) return;
  try { if (synth.paused) synth.resume(); } catch {}
});

/** Take the current item off the air without resolving it. Returns it. */
function interruptCurrent() {
  const c = current;
  if (!c) return null;
  current = null;
  if (c.bg && bgHush) { try { bgHush(); } catch {} }   // the phone was speaking it (screen off): stop it there too
  clearInterval(keepAlive);
  stopChime();
  if (playing && playing.item === c) playing.stop();
  synth && synth.cancel();
  bus.emit("speaking", null);
  return c;
}

async function pump() {
  if (held || current || !queue.length || (!synth && !manifest)) return;
  queue.sort((a, b) => (b.front ? 1 : 0) - (a.front ? 1 : 0) || b.prio - a.prio || a.seq - b.seq);
  const item = queue.shift();
  if (item.check && !item.check()) { item.resolve(false); return pump(); }
  // fresh (3.0.4): the words worked out again right before speaking, so a heads-up that waited behind a long story
  // says "in about a mile" instead of the "2 miles" it was queued with
  if (item.fresh) { try { const t = item.fresh(); if (t && t !== item.text) { item.text = t; item.units = undefined; } } catch {} }
  current = item;
  last = item;
  bus.emit("speaking", { id: item.id, text: item.text });
  try { item.onstart && item.onstart(); } catch {}
  const plan = clipPlan(item);
  if (bgSpeak && document.visibilityState === "hidden") {
    // the screen is off: the phone plays the clips itself (no chime: it would need the web view's audio too)
    let ok = false;
    item.bg = true;
    try { ok = await bgSpeak(plan ? plan.keys : null, item.text); } catch { ok = false; }
    if (current !== item) return;
    current = null;
    try { item.onend && item.onend(); } catch {}
    item.resolve(ok);
    bus.emit("speaking", null);
    setTimeout(pump, 250);
    return;
  }
  const rec = plan ? render(plan) : null;   // decoding runs while the chime rings
  if (item.chime && settings.chime) {
    await chime(item.chime === true ? "soft" : item.chime);
    if (current !== item) return; // stopped or interrupted while the chime rang; whoever did it owns the item now
  }
  let spoken = false;
  if (rec) {
    const r = await rec;
    if (current !== item) return;
    if (r) {
      const how = await playRecording(item, r);
      if (current !== item) return; // interrupted mid-speech; the interrupter already cleaned up
      spoken = how === "done";
    }
  }
  if (!spoken) {
    // Desktop Chrome stalls long utterances after ~15 s; nudge it while speaking. Never on phones:
    // on Android pause() cancels speech outright, and iOS doesn't need it (chunks are short anyway).
    clearInterval(keepAlive);
    if (NEEDS_NUDGE && synth) keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10000);
    await speakChunks(item);
    if (current !== item) return; // interrupted mid-speech; the interrupter already cleaned up
  }
  clearInterval(keepAlive);
  current = null;
  try { item.onend && item.onend(); } catch {}
  item.resolve(true);
  bus.emit("speaking", null);
  setTimeout(pump, 250);
}

/* ---------- saving the voice for offline (the website; the iPhone app carries every clip) ---------- */

let saving = null;
function clipKeysAll() { return manifest ? [...manifest.has] : []; }
const offline = {
  /** {ready, clips, mb, saving, done} */
  info() {
    const n = clipKeysAll().length;
    return { ready: !!manifest, clips: n, mb: manifest && manifest.bytes ? Math.round(manifest.bytes / 1048576) : null,
      saving: !!saving, done: saving ? saving.done : 0 };
  },
  /** Download every clip into the voice's offline cache (sw.js serves clips from it first). onProgress(done, total).
      Resolves {ok, failed}; {ok: 0, failed: 0, none: true} when there is nothing to save or no cache. */
  async save(onProgress) {
    if (saving) return saving.promise;
    await loadManifest();
    const keys = clipKeysAll();
    if (!keys.length || !("caches" in window)) return { ok: 0, failed: 0, none: true };
    saving = { done: 0 };
    saving.promise = (async () => {
      let ok = 0, failed = 0, i = 0;
      let cache = null;
      try { cache = await caches.open(VOICE_CACHE); } catch { saving = null; return { ok: 0, failed: keys.length }; }
      const worker = async () => {
        while (i < keys.length && saving) {
          const url = clipUrl(keys[i++]);
          try {
            if (await cache.match(url)) ok++;
            else { const r = await fetchT(url, 20000); if (r.ok) { await cache.put(url, r); ok++; } else failed++; }
          } catch { failed++; }
          if (saving) { saving.done++; try { onProgress && onProgress(saving.done, keys.length); } catch {} }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      saving = null;
      return { ok, failed };
    })();
    return saving.promise;
  },
  /** How many clips are in the offline cache already. */
  async saved() {
    if (!("caches" in window) || !manifest) return 0;
    try { const c = await caches.open(VOICE_CACHE); return (await c.keys()).filter(r => /\/voice\/.+\.m4a$/.test(r.url)).length; } catch { return 0; }
  },
  cancel() { saving = null; },
};

export const voice = {
  /** 3.1: fn(keys, text) -> Promise<boolean> that speaks while the page is hidden (the iPhone app, screen locked). */
  setBackground(fn, hush) { bgSpeak = typeof fn === "function" ? fn : null; bgHush = typeof hush === "function" ? hush : null; },
  get available() { return !!synth || !!manifest; },
  /** English voices: I-5 Buddy's own voice first, then the device's own, then online ones. */
  list: () => (VBASE && !(SILENT && !CLIPTEST()) ? [NATURAL, ...voices] : voices),
  online: isOnline,            // online(v): true when the browser sends this voice's words to its maker
  /** True when the natural voice is picked and its clip list has loaded. */
  natural: () => naturalPicked() && !!manifest,
  /**
   * Queue text. opts: {id, prio (0 low .. 3 urgent), now (interrupt and go first), chime (true|"alert"|"success"|false),
   * units (fixed phrases whose concatenation is the text), check (fn -> still relevant? checked right before speaking),
   * onstart, onend}. Resolves true if it was spoken.
   */
  say(text, opts = {}) {
    if ((!synth && !manifest) || !text) return Promise.resolve(false);
    if (!manifest) loadManifest();
    return new Promise(resolve => {
      const item = { text, units: opts.units, id: opts.id, prio: opts.prio ?? 1, front: !!opts.now, check: opts.check, fresh: opts.fresh, chime: opts.chime ?? false,
        onstart: opts.onstart, onend: opts.onend, interruptible: !!opts.interruptible, resolve, seq: seq++ };
      if (opts.now && held) {
        // while held (microphone open) nothing is dropped: the reply just goes to the front
        for (const q of queue) q.front = false;
      } else if (opts.now) {
        // drop queued chatter, keep urgent items; interrupt what's speaking (urgent items get re-queued)
        const keep = [];
        for (const q of queue) { if (q.prio >= 2) keep.push(q); else q.resolve(false); }
        queue = keep;
        for (const q of queue) q.front = false;
        {
          const c = interruptCurrent();
          if (c) {
            if (c.prio >= 2 && c.id !== item.id) { c.front = false; queue.push(c); }
            else { try { c.onend && c.onend(); } catch {} c.resolve(false); }
          }
        }
      } else if (opts.id && (queue.some(q => q.id === opts.id) || current?.id === opts.id)) {
        return resolve(false); // already queued or speaking
      }
      // Autoplay can make a landmark several minutes long. A navigation instruction or road alert must
      // be heard immediately; drop that story rather than speaking a stale turn after it finishes.
      if (!held && current?.interruptible && item.prio >= 2 && item.prio > current.prio) {
        const c = interruptCurrent();
        if (c) { try { c.onend && c.onend(); } catch {} c.resolve(false); }
      }
      queue.push(item);
      warm(item);
      setTimeout(pump, 0);
    });
  },
  /** Fetch the clips for text (or an array of units) ahead of time, e.g. a route's prompts. */
  prefetch(textOrUnits) {
    if (!manifest) { loadManifest(); return; }
    const units = Array.isArray(textOrUnits) ? textOrUnits : speechUnits(textOrUnits);
    warm({ text: units.join(" "), units });
  },
  /** The user's "be quiet": stop speaking, forget the queue, silence the chime. */
  stop() {
    for (const q of queue) q.resolve(false);
    queue = [];
    const c = interruptCurrent();
    if (c) { try { c.onend && c.onend(); } catch {} c.resolve(false); }
  },
  /** Pause all speech (e.g. while the microphone listens). Nothing is lost: the current item replays after. */
  hold(on) {
    if (on) {
      held = true;
      const c = interruptCurrent();
      if (c) { c.front = true; c.seq = -1; queue.unshift(c); }
    } else {
      held = false;
      setTimeout(pump, 0);
    }
  },
  isHeld: () => held,
  /** Drop queued items whose check() now fails (e.g. you already drove past). */
  prune() { queue = queue.filter(q => { const ok = !q.check || q.check(); if (!ok) q.resolve(false); return ok; }); },
  isSpeaking: () => !!current,
  currentId: () => current?.id ?? null,
  queued: () => queue.map(q => q.id),
  repeat() { if (last) voice.say(last.text, { now: true, id: last.id, units: last.units }); },
  chime,
  offline,
  speechUnits,
  unitKey,
  /** Call from a tap: iOS only allows audio that starts inside a user gesture. */
  unlock() {
    if (audio()) sleepSoon(5000);
    unlockPlayer();
    if (synth && !synth.speaking && !current) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); }
    loadManifest();
  },
};
loadManifest();
