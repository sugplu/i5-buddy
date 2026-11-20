// Simulated time and speech for the road tests (tools/transcript.html, tools/gps-bank.js). Plain script: window.I5Sim.
// installClock(win, startMs): inside the app window Date.now(), performance.now(), setTimeout/setInterval and
//   requestAnimationFrame run on a clock that only moves when the test calls clk.advance(ms), which runs every timer that
//   comes due, in order, with a real macrotask yield after each so promises settle. A whole drive takes seconds.
// installSpeech(win, onSpeak): the silent speech engine "speaks" each utterance for about 13 characters a second of
//   simulated time (the real app's pacing: the queue backs up behind long stories). Nothing is ever heard.
(function () {
'use strict';
const mc = new MessageChannel(); // a real macrotask yield without the 4 ms timer clamp
const yieldReal = () => new Promise(r => { mc.port1.onmessage = () => r(); mc.port2.postMessage(0); });

/** Simulated time inside the app window. */
function installClock(win, startMs) {
  const st = { now: startMs, t0: startMs, timers: new Map(), seq: 1, fired: 0 };
  const add = (fn, ms, args, every) => {
    const id = st.seq++;
    ms = Math.max(0, +ms || 0);
    st.timers.set(id, { at: st.now + ms, fn, args, every: every ? Math.max(1, ms) : 0, id });
    return id;
  };
  win.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  win.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  win.clearTimeout = win.clearInterval = id => { st.timers.delete(id); };
  win.requestAnimationFrame = fn => add(() => fn(st.now - st.t0), 16, [], false);
  win.cancelAnimationFrame = id => { st.timers.delete(id); };
  win.Date.now = () => st.now;
  win.performance.now = () => st.now - st.t0;
  /** Move simulated time forward by ms, running every timer that comes due, in order. */
  st.advance = async ms => {
    const to = st.now + ms;
    for (;;) {
      let best = null;
      for (const t of st.timers.values()) if (t.at <= to && (!best || t.at < best.at || (t.at === best.at && t.id < best.id))) best = t;
      if (!best) break;
      st.now = Math.max(st.now, best.at);
      if (best.every) best.at = st.now + best.every; else st.timers.delete(best.id);
      st.fired++;
      try { if (typeof best.fn === "function") best.fn(...best.args); } catch (e) { try { win.reportError(e); } catch {} }
      await yieldReal();
    }
    st.now = to;
    await yieldReal();
  };
  return st;
}

/** The speech engine: records what is said and "speaks" it for 13 characters a second of simulated time. */
function installSpeech(win, onSpeak) {
  const engine = win.speechSynthesis; // js/voice.js's silent engine (it is what window.speechSynthesis returns)
  let q = [], cur = null, timer = 0, paused = false, stalled = false, held = null;
  const fire = (u, type, error) => { const h = u && u["on" + type]; if (typeof h === "function") { try { h.call(u, { type, utterance: u, error }); } catch (e) { try { win.reportError(e); } catch {} } } };
  const start = () => {
    if (cur || paused || !q.length) return;
    const u = cur = q.shift();
    onSpeak(String(u.text == null ? "" : u.text));
    const ms = 300 + String(u.text || "").length / 13 * 1000 / Math.max(0.5, +u.rate || 1);
    fire(u, "start");
    timer = win.setTimeout(() => { if (cur !== u) return; if (stalled) { held = u; return; } cur = null; fire(u, "end"); start(); }, ms);
  };
  const def = (k, d) => Object.defineProperty(engine, k, { configurable: true, ...d });
  def("speaking", { get: () => !!cur });
  def("pending", { get: () => q.length > 0 });
  def("paused", { get: () => paused });
  def("speak", { value: u => { if (!u) return; q.push(u); start(); } });
  def("cancel", { value: () => {
    const c = cur, waiting = q; q = []; cur = null; win.clearTimeout(timer);
    if (c) win.setTimeout(() => fire(c, "error", "interrupted"), 0);
    for (const u of waiting) win.setTimeout(() => fire(u, "error", "canceled"), 0);
  } });
  def("pause", { value: () => { paused = true; } });
  def("resume", { value: () => { paused = false; win.setTimeout(start, 0); } });
  // A phone call (or Siri, a Bluetooth change): the engine stops reporting that anything ended. setStall(false) lets the
  // utterance that was in progress end (the app's own watchdog may already have cancelled it).
  return { setStall(on) { stalled = !!on; if (!stalled && held && cur === held) { const u = held; held = null; cur = null; fire(u, "end"); start(); } else if (!stalled) held = null; } };
}


/** Called by tools/sim-boot.html, the first thing in a fresh app window and before any of the app's own scripts: the clock,
    the speech engine and the geolocation permission are in place at load, so the app's own setInterval()s (GPS-lost check,
    trip timers) run on simulated time too. The test sets I5Sim.next = {startMs, permission} first and reads I5Sim.last. */
function bootInto(win) {
  const eng = { getVoices() { return []; }, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(win, "speechSynthesis", { configurable: true, get: () => eng });
  const next = window.I5Sim.next || {};
  const clk = installClock(win, next.startMs || Date.now());
  const sp = installSpeech(win, () => {});
  if (next.permission) { try { win.navigator.permissions.query = async () => ({ state: next.permission }); } catch {} }
  win.__simBootN = (window.I5Sim.n = (window.I5Sim.n || 0) + 1);
  window.I5Sim.last = { clk, sp };
}
window.I5Sim = { installClock, installSpeech, yieldReal, bootInto };
})();
