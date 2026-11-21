// I-5 Buddy sharing (module). Owns the header button #shareBtn (hidden by css below 380 px wide), the "Share I-5 Buddy" button
// in #shareRow (Settings > About, every width), the sheet #shareSheet, the "Share" button it adds to every place sheet (via
// the "place:sheet" bus event) and the #place=<id> deep links.
//
//   Share I-5 Buddy   The header button uses the phone's own share sheet (Web Share). Without it, or when it fails
//                     (anything but the user cancelling), #shareSheet opens: copy the link, "Invite a friend" with a ready
//                     message and Text message, Email and Copy buttons. The link is i5.dominares.org/get (get/index.html):
//                     on an iPhone or iPad it opens the App Store at once; on Android and computers it shows how to use
//                     the web app (one tap to open it).
//   Share one place   A "Share" button on a place's details sheet shares {name, one short line, #place=<id> link}.
//   Deep links        https://i5.dominares.org/#place=<id> opens that place's sheet once (on load and on hashchange),
//                     then the hash is removed so a reload or a share of the page address does not open it again.
// Nothing is sent anywhere by this module: sharing hands text to the phone's own share or message apps.

import { t } from "./i18n.js";
import * as i18n from "./i18n.js";
const SITE = "https://i5.dominares.org/";
// Sharing the app itself: the /get link takes an iPhone or iPad straight to the App Store (the iPhone app, in one tap
// from the message), and shows anyone else the web app. Place links stay on the web app (#place=<id>).
const GET = "https://i5.dominares.org/get";
const TITLE = "I-5 Buddy";
const TEXT = t("share.i_5_buddy_a_free_narrated_guide_to_i_5");
const INVITE = t("share.im_using_i_5_buddy_on_my_drive_it", { GET });
// the iPhone app talks to passengers: "on our road trip", not "on my drive"
const INVITE_APP = t("share.im_using_i_5_buddy_on_our_road_trip_it", { GET });
const inviteText = () => (api && api.native && api.native.NATIVE ? INVITE_APP : INVITE);
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
  if (!t) return i18n.t("share.a_stop_on_i_5_in_california");
  let s = firstSentence(t);
  if (s.length > 140) { s = s.slice(0, 140).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "") + "…"; }
  return s;
}
const appData = () => ({ title: TITLE, text: TEXT, url: GET });
/** The line a place share carries: its postcard line (places[].pc from tools/postcards.json, at most 60 characters,
    checked against the place's own text), else its first sentence. */
function shareLine(p) {
  const pc = String((p && p.pc) || "").replace(/\s+/g, " ").trim();
  return pc && pc.length <= 60 ? pc : placeLine(p);
}
const placeData = p => ({ title: p.name, text: shareLine(p), url: placeLink(p) });

/** Web Share. "shared", "cancelled" (the user closed it, or a share was already open: do nothing more), "busy" (a share of ours
    is still open: a second tap does nothing) or "none" (missing or failed: use our sheet). */
let sharing = 0, shareAt = 0, shareSeq = 0;   // sharing: the token of the Web Share a tap opened, while it is still open
const SHARE_LOCK_MS = 60e3;                   // a share promise that never settles must not lock the buttons for good
async function nativeShare(d) {
  if (typeof navigator.share !== "function") return "none";
  if (sharing && Date.now() - shareAt < SHARE_LOCK_MS) return "busy";
  const tok = ++shareSeq;
  try {
    if (typeof navigator.canShare === "function" && !navigator.canShare(d)) return "none";
    sharing = tok; shareAt = Date.now();
    await navigator.share(d);
    return "shared";
  } catch (e) {
    // AbortError: the person closed the share sheet. InvalidStateError: a share was already open (a double tap).
    return e && (e.name === "AbortError" || e.name === "InvalidStateError") ? "cancelled" : "none";
  } finally { if (sharing === tok) sharing = 0; }
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
  toast(ok ? done : t("share.couldnt_copy_press_and_hold_the_text"));
  return ok;
}

/* ---------- the fallback sheet ---------- */
function appSheet() {
  return { heading: t("share.share_i_5_buddy"), linkLabel: t("share.link_to_i_5_buddy"), link: GET, linkShown: "i5.dominares.org/get", invite: t("share.invite_a_friend"), message: inviteText(), subject: t("share.i_5_buddy_a_free_guide_for_your_drive") };
}
function placeSheet(p) {
  const line = shareLine(p), url = placeLink(p);
  return { heading: t("share.share_name", { name: p.name }), linkLabel: t("share.link_to_name", { name: p.name }), link: url, linkShown: url.replace(/^https:\/\//, ""), invite: t("share.send_it_to_a_friend"),
    message: t("share.name_on_i_5_in_california_line_url", { name: p.name, line, url }), subject: t("share.name_on_i_5", { name: p.name }) };
}
function ensureSheet() {
  if (sheet && sheet.isConnected) return sheet;
  sheet = document.getElementById("shareSheet");
  if (!sheet) {
    sheet = el("aside", "sheet");
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", t("share.share"));
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
  head.append(el("b", null, o.heading), btn("link", t("share.close"), () => close()));
  sh.append(head);

  const linkSec = el("section", "sh-sec");
  linkSec.append(el("h3", "sub", t("share.link")));
  const box = el("div", "sh-link");
  const shown = el("span", "sh-url", o.linkShown);
  shown.setAttribute("aria-label", o.linkLabel);
  box.append(shown, btn("primary sh-copy", t("share.copy_link"), () => copyWithToast(o.link, t("share.link_copied"))));
  linkSec.append(box);
  sh.append(linkSec);

  const inv = el("section", "sh-sec");
  inv.append(el("h3", "sub", o.invite));
  const q = el("p", "sh-msg", o.message);
  q.id = "shareMsg";
  inv.append(q);
  const acts = el("div", "sh-acts");
  const sms = el("a", "secondary sh-btn", t("share.text_message"));
  sms.href = `sms:?&body=${encodeURIComponent(o.message)}`;
  const mail = el("a", "secondary sh-btn", t("share.email"));
  mail.href = `mailto:?subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.message)}`;
  acts.append(sms, mail, btn("secondary sh-btn", t("share.copy_message"), () => copyWithToast(o.message, t("share.message_copied"))));
  inv.append(acts);
  sh.append(inv);
  sh.append(el("p", "fine", t("share.this_hands_the_words_to_your_own")));
  if (ui.openSheet) ui.openSheet(sh); else sh.hidden = false;
}
function close() {
  if (ui.closeSheet) ui.closeSheet(); else if (sheet) sheet.hidden = true;
  try { if (lastOpener && lastOpener.isConnected) lastOpener.focus({ preventScroll: true }); } catch {}
}

/* ---------- the row in Settings > About ---------- */
function buildRow() {
  const row = document.getElementById("shareRow");
  if (!row) return;
  row.replaceChildren();
  row.classList.add("sh-row");
  const b = btn("secondary share-act sh-open", "", () => { shareApp(); });
  b.append(icon("share-ic"), document.createTextNode(t("share.share_i_5_buddy")));
  row.append(b);
}

/* ---------- a Share button on each place sheet ---------- */
function onPlaceSheet(e) {
  try {
    if (!e || !e.place || !e.acts) return;
    const b = btn("secondary share-act", "", () => { sharePlace(e.place); });
    b.append(icon("share-ic"), document.createTextNode(t("share.share")));
    b.setAttribute("aria-label", t("share.share_name", { name: e.place.name }));
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
    buildRow();
    if (bus) bus.on("place:sheet", onPlaceSheet);
    window.addEventListener("hashchange", () => { openFromHash(); });
    api.share = { shareApp, sharePlace, openFromHash, placeLine, shareLine, placeLink, placeIdFromHash };
    openFromHash();
  } catch (e) { warn(e); }
}

export const _test = { firstSentence, ABBREVIATIONS, placeLine, shareLine, placeLink, placeIdFromHash, appData, placeData, INVITE, INVITE_APP, inviteText, GET, TEXT, appSheet };
