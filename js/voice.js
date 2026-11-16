// Speech: a priority queue in front of speechSynthesis, plus a soft chime made with Web Audio.
//
// Rules:
// - One item speaks at a time. Higher prio first; items asked for "now" go to the very front.
// - say({now:true}) interrupts what is speaking and drops queued low-priority items, but keeps urgent ones
//   (prio >= 2: chain controls, severe weather). An urgent item that gets interrupted is re-queued after.
// - hold(true) pauses everything (used while the microphone listens); nothing is lost, the current item is
//   re-queued and replays after hold(false).
// - stop() is the user's "be quiet": it clears everything, including a chime that is still ringing.
// - Silent tests: with ?silent=1 in the address, or window.top.__BUDDY_SILENT__ set by the test page around the app,
//   nothing is ever heard (see silentSynth below). Without the flag nothing here changes.
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
  const record = text => {
    text = String(text == null ? "" : text);
    if (!text.trim()) return;
    const wins = [window];
    try { if (window.top !== window) wins.push(window.top); } catch {}
    for (const w of wins) { try { (w.__BUDDY_SPOKEN__ = w.__BUDDY_SPOKEN__ || []).push(text); } catch {} }
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
let voices = [];
let queue = [];        // [{text, id, prio, front, check, chime, onstart, onend, resolve, seq}]
let current = null;
let last = null;       // last item spoken (for "repeat")
let held = false;
let ctx = null;        // AudioContext
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
const isOnline = v => !!v && v.localService === false;
function loadVoices() {
  if (!synth) return;
  // The device's own voices first: with no voice picked in Settings, pickVoice() takes voices[0], so narration stays on
  // the device unless the person picks an online voice or the browser has no other (privacy.html says so).
  voices = synth.getVoices().filter(v => /^en/i.test(v.lang))
    .sort((a, b) => isOnline(a) - isOnline(b) || rankVoice(a) - rankVoice(b) || a.name.localeCompare(b.name));
  bus.emit("voices", voices);
}
if (synth) { loadVoices(); synth.addEventListener?.("voiceschanged", loadVoices); }

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
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
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
    o.onended = () => { chimeNodes = chimeNodes.filter(n => n !== node); };
  });
  return new Promise(r => setTimeout(r, 160 * notes.length + 260));
}
function stopChime() {
  for (const n of chimeNodes) { try { n.g.gain.cancelScheduledValues(0); n.g.gain.value = 0; n.o.stop(); } catch {} }
  chimeNodes = [];
}

function speakChunks(item) {
  return new Promise(resolve => {
    const parts = chunks(item.text);
    let i = 0, done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const next = () => {
      if (current !== item || i >= parts.length) return finish(); // interrupted, or finished
      const u = new SpeechSynthesisUtterance(parts[i++]);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
      u.rate = settings.rate || 1;
      u.onend = next;
      u.onerror = e => { if (e.error === "interrupted" || e.error === "canceled") finish(); else next(); };
      synth.speak(u);
    };
    next();
  });
}

/** Take the current item off the air without resolving it. Returns it. */
function interruptCurrent() {
  const c = current;
  if (!c) return null;
  current = null;
  clearInterval(keepAlive);
  stopChime();
  synth && synth.cancel();
  bus.emit("speaking", null);
  return c;
}

async function pump() {
  if (held || current || !queue.length || !synth) return;
  queue.sort((a, b) => (b.front ? 1 : 0) - (a.front ? 1 : 0) || b.prio - a.prio || a.seq - b.seq);
  const item = queue.shift();
  if (item.check && !item.check()) { item.resolve(false); return pump(); }
  current = item;
  last = item;
  bus.emit("speaking", { id: item.id, text: item.text });
  try { item.onstart && item.onstart(); } catch {}
  if (item.chime && settings.chime) {
    await chime(item.chime === true ? "soft" : item.chime);
    if (current !== item) return; // stopped or interrupted while the chime rang; whoever did it owns the item now
  }
  // Desktop Chrome stalls long utterances after ~15 s; nudge it while speaking. Never on phones:
  // on Android pause() cancels speech outright, and iOS doesn't need it (chunks are short anyway).
  clearInterval(keepAlive);
  if (NEEDS_NUDGE) keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10000);
  await speakChunks(item);
  if (current !== item) return; // interrupted mid-speech; the interrupter already cleaned up
  clearInterval(keepAlive);
  current = null;
  try { item.onend && item.onend(); } catch {}
  item.resolve(true);
  bus.emit("speaking", null);
  setTimeout(pump, 250);
}

export const voice = {
  available: !!synth,
  list: () => voices,          // English voices, the device's own before online ones
  online: isOnline,            // online(v): true when the browser sends this voice's words to its maker
  /**
   * Queue text. opts: {id, prio (0 low .. 3 urgent), now (interrupt and go first), chime (true|"alert"|"success"|false),
   * check (fn -> still relevant? checked right before speaking), onstart, onend}. Resolves true if it was spoken.
   */
  say(text, opts = {}) {
    if (!synth || !text) return Promise.resolve(false);
    return new Promise(resolve => {
      const item = { text, id: opts.id, prio: opts.prio ?? 1, front: !!opts.now, check: opts.check, chime: opts.chime ?? false,
        onstart: opts.onstart, onend: opts.onend, resolve, seq: seq++ };
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
      queue.push(item);
      setTimeout(pump, 0);
    });
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
  repeat() { if (last) voice.say(last.text, { now: true, id: last.id }); },
  chime,
  /** Call from a tap: iOS only allows audio that starts inside a user gesture. */
  unlock() {
    audio();
    if (synth && !synth.speaking && !current) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); }
  },
};
