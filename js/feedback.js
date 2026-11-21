// I-5 Buddy feedback (module). Owns #feedbackRow (Settings > About: a "Send feedback" button) and #feedbackSheet.
//
//   The form    Name (optional), Email (required), Message (required, up to 2000 characters, with a counter) and a hidden
//               "website" field that people never see or fill (a honeypot for bots). Plain words on top: what we do with it,
//               and beside "We use your email only to reply to you." a Privacy link to the notice (privacy.html, new tab).
//   Sending     Only on Send: POST /api/feedback {name, email, message, version, website} (i5.dominares.org, or the same
//               address from anywhere else; CORS is open). 10-second patience; the sheet says "Sending", then thanks, or
//               shows the server's own words and keeps the text. Offline: Send is off and says why.
//   On the phone  Name and email are remembered for next time (after a message goes out); an unsent draft is kept until it
//               is sent. All through api.store (this phone only).
// The app version comes from the service worker's VERSION line (read from sw.js, normally from its cache), else a constant.

import { t, loc } from "./i18n.js";
const FALLBACK_VERSION = "3.1.0";   // keep next to sw.js's VERSION; used only if sw.js cannot be read
const PRIVACY_URL = "privacy.html"; // the privacy notice, beside index.html (cached with the app shell)
const MAX_NAME = 80, MAX_EMAIL = 120, MAX_MSG = 2000;
const SEND_TIMEOUT = 15e3;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let api = null, ui = {}, store = null;
let sheet = null, form = null, opener = null;
let version = FALLBACK_VERSION, versionAsked = false;
let sending = false, saveTimer = 0;

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
function warn(e) { try { console.warn("[feedback]", (e && e.message) || e); } catch {} }
const offline = () => navigator.onLine === false;
function feedbackUrl() {
  let host = "";
  try { host = location.hostname; } catch {}
  return host === "i5.dominares.org" ? "/api/feedback" : "https://i5.dominares.org/api/feedback";
}

/** The version in sw.js: `const VERSION = "i5b-v2.5.3"` -> "2.5.3". One quiet read, normally from the worker's cache. */
async function readVersion() {
  if (versionAsked) return;
  versionAsked = true;
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch("sw.js", { signal: ac.signal });
    clearTimeout(t);
    const m = r.ok && /VERSION\s*=\s*"i5b-v([\w.-]{1,30})"/.exec(await r.text());
    if (m) version = m[1];
  } catch { /* the constant stays */ }
}

/** What to tell the person about a field: "" when it is fine. Pure. */
function validate({ name, email, message }) {
  const out = {};
  if (String(name || "").trim().length > MAX_NAME) out.name = t("feedback.please_keep_your_name_under_max_name", { MAX_NAME });
  // the email is optional (3.0.1): only for people who want a reply
  const e = String(email || "").trim();
  if (e && (e.length > MAX_EMAIL || !EMAIL_RX.test(e))) out.email = t("feedback.that_email_doesnt_look_right_check_it");
  const m = String(message || "").trim();
  if (!m) out.message = t("feedback.please_write_a_message");
  else if (m.length > MAX_MSG) out.message = t("feedback.please_keep_your_message_under_max_msg", { MAX_MSG: MAX_MSG.toLocaleString(loc("en-US")) });
  return out;
}
/** Where this copy runs (3.0.1), so the owner can tell the apps apart in HQ: "ios" (the iPhone app), "android" (the Google
    Play app: Chrome opens it with an android-app:// referrer, remembered for later launches), "pwa" (installed from a
    browser) or "web". */
export function platform() {
  try { if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform()) return "ios"; } catch {}
  try {
    if (/^android-app:\/\//.test(document.referrer || "")) { try { localStorage.setItem("i5b:twa", "true"); } catch {} return "android"; }
    if (localStorage.getItem("i5b:twa") === "true") return "android";
  } catch {}
  try { if (navigator.standalone === true || matchMedia("(display-mode: standalone)").matches) return "pwa"; } catch {}
  return "web";
}
/** The JSON that goes to the server. Pure. */
function payload({ name, email, message, website }, ver, where = "") {
  return { name: String(name || "").trim().slice(0, MAX_NAME), email: String(email || "").trim().slice(0, MAX_EMAIL), message: String(message || "").trim().slice(0, MAX_MSG),
    version: (String(ver || FALLBACK_VERSION) + (where ? " " + where : "")).slice(0, 40), website: String(website || "") };
}

/* ---------- the row in Settings ---------- */
function buildRow() {
  const row = document.getElementById("feedbackRow");
  if (!row) return;
  row.replaceChildren();
  row.classList.add("fb-row");
  const b = btn("secondary fb-open", t("feedback.send_feedback"), () => openSheet(b));
  b.setAttribute("aria-haspopup", "dialog");
  row.append(b, el("small", "hint", t("feedback.tell_us_what_you_think_we_read_every")));
}

/* ---------- the sheet ---------- */
function ensureSheet() {
  if (sheet && sheet.isConnected) return sheet;
  sheet = document.getElementById("feedbackSheet");
  if (!sheet) {
    sheet = el("aside", "sheet");
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", t("feedback.send_feedback"));
    (document.querySelector(".app") || document.body).append(sheet);
  }
  return sheet;
}
function close() {
  if (ui.closeSheet) ui.closeSheet(); else if (sheet) sheet.hidden = true;
  try { if (opener && opener.isConnected) opener.focus({ preventScroll: true }); } catch {}
}
function field(id, label, note) {
  const wrap = el("div", "fb-field");
  const l = el("label", null, label);
  l.htmlFor = id;
  if (note) l.append(" ", el("span", "fb-note", note));
  const err = el("p", "fb-err");
  err.id = id + "Err"; err.hidden = true;
  return { wrap, l, err };
}
function openSheet(from) {
  const sh = ensureSheet();
  opener = from || document.activeElement;
  readVersion();
  const draft = store.get("feedback:draft", null) || {};
  const who = store.get("feedback:who", null) || {};
  const str = v => (typeof v === "string" ? v : "");
  sh.replaceChildren();
  sh.classList.add("fb-sheet");
  const head = el("div", "sheet-head");
  head.append(el("b", null, t("feedback.send_feedback")), btn("link", t("feedback.close"), close));
  sh.append(head);

  const f = el("form", "fb-form");
  f.noValidate = true;
  f.setAttribute("aria-label", t("feedback.send_feedback"));
  f.append(el("p", "fb-lead", t("feedback.tell_us_what_you_think_we_read_every")));

  const n = field("fbName", t("feedback.name"), t("feedback.optional"));
  const name = el("input"); name.id = "fbName"; name.name = "name"; name.type = "text"; name.maxLength = MAX_NAME; name.autocomplete = "name";
  name.value = str(draft.name) || str(who.name);
  n.wrap.append(n.l, name, n.err);

  const e = field("fbEmail", t("feedback.email"), t("feedback.optional"));
  const email = el("input"); email.id = "fbEmail"; email.name = "email"; email.type = "email"; email.maxLength = MAX_EMAIL;
  email.autocomplete = "email"; email.inputMode = "email"; email.setAttribute("autocapitalize", "none"); email.setAttribute("spellcheck", "false");
  email.setAttribute("aria-describedby", "fbEmailHint fbEmailErr");
  email.value = str(draft.email) || str(who.email);
  const eh = el("p", "fb-hint", t("feedback.only_if_you_want_a_reply_we_use_it_for"));
  eh.id = "fbEmailHint";
  // the whole notice, beside the promise: a new tab, so the form (and a drive in progress) stay as they are
  const pv = el("a", "fb-privacy", t("feedback.privacy"));
  pv.href = PRIVACY_URL; pv.target = "_blank"; pv.rel = "noopener";
  const ehRow = el("div", "fb-hint-row");
  ehRow.append(eh, pv);
  e.wrap.append(e.l, email, ehRow, e.err);

  const m = field("fbMsg", t("feedback.message"));
  const msg = el("textarea"); msg.id = "fbMsg"; msg.name = "message"; msg.required = true; msg.rows = 6; msg.maxLength = MAX_MSG;
  msg.setAttribute("aria-describedby", "fbCount fbMsgErr");
  msg.value = str(draft.message).slice(0, MAX_MSG);
  const count = el("p", "fb-count");
  count.id = "fbCount";
  m.wrap.append(m.l, msg, count, m.err);

  // the honeypot: people never see it, tab to it or hear it; a bot that fills every field gives itself away
  const hp = el("div", "fb-hp");
  hp.setAttribute("aria-hidden", "true");
  const hpl = el("label", null, t("feedback.leave_this_field_empty"));
  hpl.htmlFor = "fbWebsite";
  const site = el("input"); site.id = "fbWebsite"; site.name = "website"; site.type = "text"; site.tabIndex = -1; site.autocomplete = "off"; site.value = "";
  hp.append(hpl, site);

  const status = el("p", "fb-status");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const send = el("button", "primary fb-send", t("feedback.send"));
  send.type = "submit";
  f.append(n.wrap, e.wrap, m.wrap, hp, status, send, el("p", "fine fb-ver", api && api.native && api.native.NATIVE
    ? t("feedback.your_message_includes_the_app_version")
    : t("feedback.your_message_includes_the_app_version_2")));
  sh.append(f);

  form = { f, name, email, msg, site, count, status, send, errs: { name: n.err, email: e.err, message: m.err }, state: "idle" };
  for (const x of [name, email, msg]) x.addEventListener("input", () => { clearErrs(); paint(); saveDraft(); });
  f.addEventListener("submit", ev => { ev.preventDefault(); submit(); });
  paint();
  if (ui.openSheet) ui.openSheet(sh); else sh.hidden = false;
}

function clearErrs() {
  if (!form) return;
  for (const [k, p] of Object.entries(form.errs)) {
    p.hidden = true; p.textContent = "";
    const inp = k === "message" ? form.msg : form[k];
    inp.removeAttribute("aria-invalid");
  }
}
function showErrs(errs) {
  let first = null;
  for (const k of ["name", "email", "message"]) {
    if (!errs[k]) continue;
    const p = form.errs[k], inp = k === "message" ? form.msg : form[k];
    p.textContent = errs[k]; p.hidden = false;
    inp.setAttribute("aria-invalid", "true");
    if (!first) first = inp;
  }
  if (first) { try { first.focus(); } catch {} }
}
/** Counter, Send button and status line for the current state. */
function paint() {
  if (!form) return;
  const len = form.msg.value.length;
  form.count.textContent = `${len.toLocaleString(loc("en-US"))} / ${MAX_MSG.toLocaleString(loc("en-US"))}`;
  form.count.classList.toggle("near", len > MAX_MSG - 100);
  const off = offline();
  form.send.disabled = off || sending;
  form.send.textContent = sending ? t("feedback.sending") : t("feedback.send");
  form.f.setAttribute("aria-busy", String(sending));
  if (sending) setStatus(t("feedback.sending"), "");
  else if (off) setStatus(t("feedback.youre_offline_connect_to_send"), "off");
  else if (form.state === "error") { /* the error words stay until the next try */ }
  else setStatus("", "");
}
function setStatus(text, kind) {
  if (!form) return;
  if (form.status.textContent !== text) form.status.textContent = text;
  form.status.dataset.kind = kind;
  form.status.hidden = !text;
}
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!form) return;
    const d = { name: form.name.value, email: form.email.value, message: form.msg.value };
    if (d.name || d.email || d.message) store.set("feedback:draft", d); else store.del("feedback:draft");
  }, 300);
}

async function submit() {
  if (!form || sending) return;
  const vals = { name: form.name.value, email: form.email.value, message: form.msg.value, website: form.site.value };
  clearErrs();
  const errs = validate(vals);
  if (Object.keys(errs).length) { form.state = "invalid"; setStatus("", ""); showErrs(errs); return; }
  if (offline()) { paint(); return; }
  await readVersion();
  sending = true; form.state = "sending"; paint();
  const f = form;
  let result;
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), SEND_TIMEOUT);
  try {
    const r = await fetch(feedbackUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(vals, version, platform())), signal: ac.signal });
    let j = null;
    try { j = await r.json(); } catch {}
    if (r.ok && j && j.ok === true) result = { ok: true };
    else {
      const words = j && typeof j.error === "string" ? j.error.replace(/\s+/g, " ").trim().slice(0, 240) : "";
      result = { ok: false, text: words || (r.status === 429 ? t("feedback.too_many_messages_right_now_please_try") : t("feedback.that_didnt_go_through_please_try_again")) };
    }
  } catch (e) {
    result = { ok: false, text: e && e.name === "AbortError" ? t("feedback.that_took_too_long_check_your") : t("feedback.that_didnt_go_through_check_your") };
  } finally { clearTimeout(timer); }
  sending = false;
  // The message is gone whichever form is showing: the sheet may have been closed and reopened while it was on its way,
  // which builds a new form (filled from the saved draft). So the side effects of a success never depend on `f`.
  if (result.ok) {
    store.set("feedback:who", { name: String(vals.name).trim().slice(0, MAX_NAME), email: String(vals.email).trim().slice(0, MAX_EMAIL) });
    store.del("feedback:draft");
    clearTimeout(saveTimer);
  }
  const cur = form;                             // the form on screen now: `f`, or the one built by a reopen
  if (!cur) return;
  // a reopened form that still holds what was sent is that message; one the person has since changed is something new
  const same = cur === f || cur.msg.value.trim() === String(vals.message).trim();
  if (result.ok) {
    if (same) done();
    else { cur.state = "idle"; paint(); saveDraft(); }   // keep the new text, and save it again (the draft was just deleted)
  } else {
    cur.state = same ? "error" : "idle"; paint();
    if (same) { setStatus(result.text, "error"); cur.status.hidden = false; }
  }
}
function done() {
  const sh = ensureSheet();
  form = null;
  const box = el("div", "fb-done");
  box.setAttribute("role", "status");
  box.append(el("b", null, t("feedback.thanks")), el("p", null, t("feedback.your_message_is_on_its_way_to_the")));
  const old = sh.querySelector(".fb-form");
  if (old) old.replaceWith(box); else sh.append(box);
  const b = btn("primary", t("feedback.done"), close);
  box.append(b);
  try { b.focus({ preventScroll: true }); } catch {}
}

export function init(a) {
  try {
    api = a || {};
    ui = api.ui || {};
    store = api.store || { get: (k, f) => f, set() {}, del() {} };
    buildRow();
    window.addEventListener("online", paint);
    window.addEventListener("offline", paint);
    api.feedback = { open: () => openSheet(document.querySelector(".fb-open")), version: () => version };
  } catch (e) { warn(e); }
}

export const _test = { validate, payload, feedbackUrl, platform, MAX_MSG, PRIVACY_URL };
