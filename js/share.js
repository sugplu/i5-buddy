// I-5 Buddy sharing (module). Owns the header button #shareBtn, the sheet #shareSheet, the "Share" button it adds to
// every place sheet (via the "place:sheet" bus event) and the #place=<id> deep links.
//
//   Share I-5 Buddy   The header button uses the phone's own share sheet (Web Share). Without it, or when it fails
//                     (anything but the user cancelling), #shareSheet opens: copy the link, "Invite a friend" with a ready
//                     message and Text message, Email and Copy buttons.
//   Share one place   A "Share" button on a place's details sheet shares {name, one short line, #place=<id> link}.
//   Deep links        https://i5.dominares.org/#place=<id> opens that place's sheet once (on load and on hashchange),
//                     then the hash is removed so a reload or a share of the page address does not open it again.
// Nothing is sent anywhere by this module: sharing hands text to the phone's own share or message apps.

const SITE = "https://i5.dominares.org/";
const TITLE = "I-5 Buddy";
const TEXT = "I-5 Buddy: a free narrated guide to I-5 in California.";
const INVITE = `I'm using I-5 Buddy on my drive. It tells you about the places you pass on I-5. It's free: ${SITE}`;
const ICON = "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .24.04.47.09.7L8.04 9.81A3 3 0 1 0 6 15c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08Z";

let api = null, ui = {}, data = {}, bus = null;
let sheet = null, lastOpener = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, onclick) {
  const b = el("button", cls, text);
  b.type = "button";
  if (onclick) b.addEventListener("click", onclick);
  return b;
}
function icon(cls) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
  if (cls) s.setAttribute("class", cls);
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", ICON); p.setAttribute("fill", "currentColor");
  s.append(p);
  return s;
}
function toast(t) { try { ui.toast && ui.toast(t); } catch {} }
function warn(e) { try { console.warn("[share]", (e && e.message) || e); } catch {} }

/* ---------- what gets shared ---------- */
const placeLink = p => `${SITE}#place=${encodeURIComponent(p.id)}`;
// A period after one of these, or after a lone capital letter (an initial: "J. B. Lankershim", "B.F. Sisk Dam"), does not end a sentence.
const ABBREVIATIONS = ["Dr", "St", "Mt", "Ft", "Jr", "Sr", "Mr", "Mrs", "Ms", "No", "U.S", "Gov", "Gen", "Lt", "Col", "Capt", "Sgt", "Rev", "Sen", "Rep", "Co", "vs", "v"];
/** The first sentence of `t` (text with single spaces): up to the first period or question mark that really ends one.
    A period does not end it when the word before it is an abbreviation or a lone capital initial, or when the next
    character does not start a sentence (a capital letter, a digit, an opening quote or bracket). No regex lookbehind
    (iOS 15.0 to 15.3 cannot parse one). With no real end, the whole text. Pure. */
function firstSentence(t) {
  const rx = /[.?](?=\s|$)/g;
  let m;
  while ((m = rx.exec(t))) {
    const i = m.index, end = i + 1;
    if (t[i] === "?") return t.slice(0, end);
    const word = t.slice(0, i).split(" ").pop().replace(/^["'\u201c\u2018(\[]+/, "");
    if (/^(?:[A-Z]\.)*[A-Z]$/.test(word) || ABBREVIATIONS.indexOf(word) >= 0) continue;
    const next = t.slice(end).replace(/^\s+/, "");
    if (!next) return t.slice(0, end);
    if (/^["'\u201c\u2018(\[]*[A-Z0-9]/.test(next)) return t.slice(0, end);
  }
  return t;
}
/** One short line about a place: its first sentence, at most about 140 characters. */
function placeLine(p) {
  const t = String(p.text || "").replace(/\s+/g, " ").trim();
  if (!t) return "A stop on I-5 in California.";
  let s = firstSentence(t);
  if (s.length > 140) { s = s.slice(0, 140).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "") + "…"; }
  return s;
}
const appData = () => ({ title: TITLE, text: TEXT, url: SITE });
const placeData = p => ({ title: p.name, text: placeLine(p), url: placeLink(p) });

/** Web Share. "shared", "cancelled" (the user closed it: do nothing more), or "none" (missing or failed: use our sheet). */
async function nativeShare(d) {
  if (typeof navigator.share !== "function") return "none";
  try {
    if (typeof navigator.canShare === "function" && !navigator.canShare(d)) return "none";
    await navigator.share(d);
    return "shared";
  } catch (e) {
    return e && e.name === "AbortError" ? "cancelled" : "none";
  }
}
async function shareApp() {
  const r = await nativeShare(appData());
  if (r === "none") openSheet(appSheet());
  return r;
}
async function sharePlace(p) {
  const r = await nativeShare(placeData(p));
  if (r === "none") openSheet(placeSheet(p));
  return r;
}

/* ---------- copy ---------- */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try { // older iPhones and pages without clipboard permission
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.setAttribute("aria-hidden", "true");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.append(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch { return false; }
}
async function copyWithToast(text, done) {
  const ok = await copyText(text);
  toast(ok ? done : "Couldn't copy. Press and hold the text to copy it.");
  return ok;
}

/* ---------- the fallback sheet ---------- */
function appSheet() {
  return { heading: "Share I-5 Buddy", linkLabel: "Link to I-5 Buddy", link: SITE, linkShown: "i5.dominares.org", invite: "Invite a friend", message: INVITE, subject: "I-5 Buddy, a free guide for your drive on I-5" };
}
function placeSheet(p) {
  const line = placeLine(p), url = placeLink(p);
  return { heading: `Share ${p.name}`, linkLabel: `Link to ${p.name}`, link: url, linkShown: url.replace(/^https:\/\//, ""), invite: "Send it to a friend",
    message: `${p.name}, on I-5 in California. ${line} ${url}`, subject: `${p.name} on I-5` };
}
function ensureSheet() {
  if (sheet && sheet.isConnected) return sheet;
  sheet = document.getElementById("shareSheet");
  if (!sheet) {
    sheet = el("aside", "sheet");
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Share");
    (document.querySelector(".app") || document.body).append(sheet);
  }
  return sheet;
}
/** Build the sheet's contents for `o` (see appSheet) and open it. */
function openSheet(o) {
  const sh = ensureSheet();
  lastOpener = document.activeElement;
  sh.replaceChildren();
  sh.classList.add("share-sheet");
  sh.setAttribute("aria-label", o.heading);
  const head = el("div", "sheet-head");
  head.append(el("b", null, o.heading), btn("link", "Close", () => close()));
  sh.append(head);

  const linkSec = el("section", "sh-sec");
  linkSec.append(el("h3", "sub", "Link"));
  const box = el("div", "sh-link");
  const shown = el("span", "sh-url", o.linkShown);
  shown.setAttribute("aria-label", o.linkLabel);
  box.append(shown, btn("primary sh-copy", "Copy link", () => copyWithToast(o.link, "Link copied")));
  linkSec.append(box);
  sh.append(linkSec);

  const inv = el("section", "sh-sec");
  inv.append(el("h3", "sub", o.invite));
  const q = el("p", "sh-msg", o.message);
  q.id = "shareMsg";
  inv.append(q);
  const acts = el("div", "sh-acts");
  const sms = el("a", "secondary sh-btn", "Text message");
  sms.href = `sms:?&body=${encodeURIComponent(o.message)}`;
  const mail = el("a", "secondary sh-btn", "Email");
  mail.href = `mailto:?subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.message)}`;
  acts.append(sms, mail, btn("secondary sh-btn", "Copy message", () => copyWithToast(o.message, "Message copied")));
  inv.append(acts);
  sh.append(inv);
  sh.append(el("p", "fine", "This hands the words to your own messages or email app. Nothing is sent from I-5 Buddy."));
  if (ui.openSheet) ui.openSheet(sh); else sh.hidden = false;
}
function close() {
  if (ui.closeSheet) ui.closeSheet(); else if (sheet) sheet.hidden = true;
  try { if (lastOpener && lastOpener.isConnected) lastOpener.focus({ preventScroll: true }); } catch {}
}

/* ---------- a Share button on each place sheet ---------- */
function onPlaceSheet(e) {
  try {
    if (!e || !e.place || !e.acts) return;
    const b = btn("secondary share-act", "", () => { sharePlace(e.place); });
    b.append(icon("share-ic"), document.createTextNode("Share"));
    b.setAttribute("aria-label", `Share ${e.place.name}`);
    e.acts.append(b);
  } catch (err) { warn(err); }
}

/* ---------- #place=<id> deep links ---------- */
/** The place id in a hash like "#place=ca309-kettleman", or null. */
function placeIdFromHash(h) {
  const m = /^#place=([^&]+)/.exec(String(h || ""));
  if (!m) return null;
  try { const id = decodeURIComponent(m[1]); return /^[\w.~-]{1,80}$/.test(id) ? id : null; } catch { return null; }
}
function clearHash() {
  try { history.replaceState(null, "", location.pathname + location.search); return; } catch {}
  try { location.hash = ""; } catch {}
}
/** Open the place named in the address (if there is one and the road data has it), then drop the hash. */
function openFromHash() {
  try {
    const id = placeIdFromHash(location.hash);
    if (!id) return false;
    const p = data.placeById && data.placeById(id);
    if (!p || !ui.placeSheet) return false;
    clearHash();
    ui.placeSheet(p);
    return true;
  } catch (e) { warn(e); return false; }
}

export function init(a) {
  try {
    api = a || {};
    ui = api.ui || {}; data = api.data || {}; bus = api.bus;
    const b = document.getElementById("shareBtn");
    if (b) {
      b.replaceChildren(icon());
      b.hidden = false;
      b.addEventListener("click", () => { shareApp(); });
    }
    if (bus) bus.on("place:sheet", onPlaceSheet);
    window.addEventListener("hashchange", () => { openFromHash(); });
    api.share = { shareApp, sharePlace, openFromHash, placeLine, placeLink, placeIdFromHash };
    openFromHash();
  } catch (e) { warn(e); }
}

export const _test = { firstSentence, ABBREVIATIONS, placeLine, placeLink, placeIdFromHash, appData, placeData, INVITE };
