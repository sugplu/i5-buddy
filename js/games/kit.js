// Shared helpers for the Play tab and its games (js/play.js and js/games/*.js). Pure: no api, no storage, no state.

/** Wrap fn so an error is logged and never thrown into the app. */
export function safe(fn, label) {
  return (...args) => {
    try { return fn(...args); } catch (e) { console.error(`[play] ${label || "error"}`, e); }
  };
}
/** h("div", {class: "x", onclick: fn, "aria-label": "y"}, child, "text", [more]) */
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style") e.setAttribute("style", v);
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : String(v));
    }
  }
  add(e, kids);
  return e;
}
export function add(parent, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(parent, k);
    else parent.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return parent;
}
const SVGNS = "http://www.w3.org/2000/svg";
export function svg(viewBox, inner, cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  if (cls) s.setAttribute("class", cls);
  s.innerHTML = inner;
  return s;
}
export const ICON = {
  eye: '<path d="M12 5C6.5 5 2.6 9.2 1.3 12c1.3 2.8 5.2 7 10.7 7s9.4-4.2 10.7-7C21.4 9.2 17.5 5 12 5Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" fill="currentColor"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z" fill="currentColor"/>',
  mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" fill="currentColor"/>',
  check: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4-9.6 9.6Z" fill="currentColor"/>',
  cross: '<path d="M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9 4.9-4.9Z" fill="currentColor"/>',
  shuffle: '<path d="M17 3l4 4-4 4V8h-2.6l-3 3.6-1.3-1.6L13.5 6H17V3Zm0 10 4 4-4 4v-3h-3.5l-8-9.6H3V6h3.4l8 9.6H17V13ZM3 16h2.5l2.6-3.1 1.3 1.6L6.4 18H3v-2Z" fill="currentColor"/>',
  next: '<path d="M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z" fill="currentColor"/>',
  back: '<path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12l6.6-6.6Z" fill="currentColor"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z" fill="currentColor"/>',
  minus: '<path d="M19 13H5v-2h14v2Z" fill="currentColor"/>',
  undo: '<path d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.96 7.96 0 0 1 12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.67 17.19 8 12.5 8Z" fill="currentColor"/>',
  users: '<path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" fill="currentColor"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7Z" fill="currentColor"/>',
  star: '<path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27Z" fill="currentColor"/>',
  grid: '<path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z" fill="currentColor"/>',
  list: '<path d="M3 5h2v2H3V5Zm4 0h14v2H7V5ZM3 11h2v2H3v-2Zm4 0h14v2H7v-2ZM3 17h2v2H3v-2Zm4 0h14v2H7v-2Z" fill="currentColor"/>',
  search: '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z" fill="currentColor"/>',
  up: '<path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8Z" fill="currentColor"/>',
  down: '<path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8Z" fill="currentColor"/>',
  info: '<path d="M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" fill="currentColor"/>',
};
export const icon = (name, cls) => svg("0 0 24 24", ICON[name] || "", cls || "pl-ic");

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** True when the person asked their device for less motion (JS-driven animation checks this; CSS is switched off in app.css). */
export function reduced() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { return false; }
}
/** Count a number up (or down) inside an element over `ms`, ending on exactly `to`. fmt(n) gives the text. Returns a cancel function. */
export function countUp(el, from, to, ms, fmt) {
  const f = fmt || (v => String(Math.round(v)));
  if (!el) return () => {};
  if (reduced() || ms <= 0 || from === to) { el.textContent = f(to); return () => {}; }
  const t0 = performance.now();
  let raf = 0, done = false;
  const step = now => {
    if (done) return;
    const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
    el.textContent = f(t >= 1 ? to : from + (to - from) * e);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  el.textContent = f(from);
  raf = requestAnimationFrame(step);
  // animation frames can be throttled (hidden iframe, low-power mode): always land on the real number
  const guard = setTimeout(() => { if (!done) { done = true; cancelAnimationFrame(raf); el.textContent = f(to); } }, ms + 120);
  return () => { done = true; cancelAnimationFrame(raf); clearTimeout(guard); };
}

// A period after one of these, or after a lone capital letter (an initial), does not end a sentence.
const ABBREVIATIONS = ["Dr", "St", "Mt", "Ft", "Jr", "Sr", "Mr", "Mrs", "Ms", "No", "U.S", "Gov", "Gen", "Lt", "Col", "Capt", "Sgt", "Rev", "Sen", "Rep", "Co", "vs", "v"];
/** The first sentence of `t`: up to the first period or question mark that really ends one. No regex lookbehind (iOS 15.0 to 15.3). */
export function firstSentence(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const rx = /[.?](?=\s|$)/g;
  let m;
  while ((m = rx.exec(t))) {
    const i = m.index, end = i + 1;
    if (t[i] === "?") return t.slice(0, end);
    const word = t.slice(0, i).split(" ").pop().replace(/^["'“‘(\[]+/, "");
    if (/^(?:[A-Z]\.)*[A-Z]$/.test(word) || ABBREVIATIONS.indexOf(word) >= 0) continue;
    const next = t.slice(end).replace(/^\s+/, "");
    if (!next) return t.slice(0, end);
    if (/^["'“‘(\[]*[A-Z0-9]/.test(next)) return t.slice(0, end);
  }
  return t;
}
/** "Chula Vista, the old Lemon Capital" -> "Chula Vista". */
export function shortName(p) {
  const n = String(p && p.name || "").trim();
  const i = n.indexOf(",");
  return (i > 2 ? n.slice(0, i) : n).trim();
}
/** "Nov 16" in the phone's language. */
export function fmtDate(ms) {
  try { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; }
}
export const thousands = n => { try { return Math.round(n).toLocaleString("en-US"); } catch { return String(Math.round(n)); } };
const GENERIC = new Set("the and for with from that this near old new big little mount river lake creek valley park county city town road rest area north south east west bridge hills hill canyon springs station field fields country".split(" "));
/** Words that make a name recognizable (for keeping look-alike answers out of one question). */
export function sigWords(name) {
  return new Set((String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z]{4,}/g) || []).filter(w => !GENERIC.has(w)));
}
export function sameish(a, b) {
  const x = sigWords(a), y = sigWords(b);
  for (const w of x) if (y.has(w)) return true;
  return String(a).toLowerCase() === String(b).toLowerCase();
}
/** The token colors a player or a game can wear: [id, name, css variable, text color variable]. All from app.css. */
export const COLORS = [
  ["gold", "Yellow", "--accent", "--accent-fg"],
  ["green", "Green", "--ok", "--on-cat"],
  ["blue", "Blue", "--st-wa", "--on-cat"],
  ["orange", "Orange", "--hist", "--on-cat"],
  ["pink", "Pink", "--odd", "--on-cat"],
  ["purple", "Purple", "--stop", "--on-cat"],
  ["lime", "Lime", "--farm", "--on-cat"],
  ["red", "Red", "--danger", "--on-cat"],
];
export const colorStyle = id => {
  const c = COLORS.find(x => x[0] === id) || COLORS[0];
  return `--pc:var(${c[2]});--pt:var(${c[3]})`;
};
