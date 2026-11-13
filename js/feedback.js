// I-5 Buddy feedback (module). Owns #feedbackRow (Settings > About: a "Send feedback" button) and #feedbackSheet.
//
//   The form    Name (optional), Email (required), Message (required, up to 2000 characters, with a counter) and a hidden
//               "website" field that people never see or fill (a honeypot for bots). Plain words on top: what we do with it.
//   Sending     Only on Send: POST /api/feedback {name, email, message, version, website} (i5.dominares.org, or the same
//               address from anywhere else; CORS is open). 10-second patience; the sheet says "Sending", then thanks, or
//               shows the server's own words and keeps the text. Offline: Send is off and says why.
//   On the phone  Name and email are remembered for next time (after a message goes out); an unsent draft is kept until it
//               is sent. All through api.store (this phone only).
// The app version comes from the service worker's VERSION line (read from sw.js, normally from its cache), else a constant.

const FALLBACK_VERSION = "2.5.0";   // keep next to sw.js's VERSION; used only if sw.js cannot be read
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

/** The version in sw.js: `const VERSION = "i5b-v2.5.0"` -> "2.5.0". One quiet read, normally from the worker's cache. */
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
  if (String(name || "").trim().length > MAX_NAME) out.name = `Please keep your name under ${MAX_NAME} characters.`;
  const e = String(email || "").trim();
  if (!e) out.email = "Please add your email so we can reply.";
  else if (e.length > MAX_EMAIL || !EMAIL_RX.test(e)) out.email = "That email doesn't look right. Check it and try again.";
  const m = String(message || "").trim();
  if (!m) out.message = "Please write a message.";
  else if (m.length > MAX_MSG) out.message = `Please keep your message under ${MAX_MSG.toLocaleString("en-US")} characters.`;
  return out;
}
/** The JSON that goes to the server. Pure. */
function payload({ name, email, message, website }, ver) {
  return { name: String(name || "").trim().slice(0, MAX_NAME), email: String(email || "").trim().slice(0, MAX_EMAIL), message: String(message || "").trim().slice(0, MAX_MSG),
    version: String(ver || FALLBACK_VERSION).slice(0, 40), website: String(website || "") };
}

/* ---------- the row in Settings ---------- */
function buildRow() {
  const row = document.getElementById("feedbackRow");
  if (!row) return;
  row.replaceChildren();
  row.classList.add("fb-row");
  const b = btn("secondary fb-open", "Send feedback", () => openSheet(b));
  b.setAttribute("aria-haspopup", "dialog");
  row.append(b, el("small", "hint", "Tell us what you think. We read every message."));
}

/* ---------- the sheet ---------- */
function ensureSheet() {
  if (sheet && sheet.isConnected) return sheet;
  sheet = document.getElementById("feedbackSheet");
  if (!sheet) {
    sheet = el("aside", "sheet");
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Send feedback");
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
  head.append(el("b", null, "Send feedback"), btn("link", "Close", close));
  sh.append(head);

  const f = el("form", "fb-form");
  f.noValidate = true;
  f.setAttribute("aria-label", "Send feedback");
  f.append(el("p", "fb-lead", "Tell us what you think. We read every message."));

  const n = field("fbName", "Name", "(optional)");
  const name = el("input"); name.id = "fbName"; name.name = "name"; name.type = "text"; name.maxLength = MAX_NAME; name.autocomplete = "name";
  name.value = str(draft.name) || str(who.name);
  n.wrap.append(n.l, name, n.err);

  const e = field("fbEmail", "Email");
  const email = el("input"); email.id = "fbEmail"; email.name = "email"; email.type = "email"; email.required = true; email.maxLength = MAX_EMAIL;
  email.autocomplete = "email"; email.inputMode = "email"; email.setAttribute("autocapitalize", "none"); email.setAttribute("spellcheck", "false");
  email.setAttribute("aria-describedby", "fbEmailHint fbEmailErr");
  email.value = str(draft.email) || str(who.email);
  const eh = el("p", "fb-hint", "We use your email only to reply to you.");
  eh.id = "fbEmailHint";
  e.wrap.append(e.l, email, eh, e.err);

  const m = field("fbMsg", "Message");
  const msg = el("textarea"); msg.id = "fbMsg"; msg.name = "message"; msg.required = true; msg.rows = 6; msg.maxLength = MAX_MSG;
  msg.setAttribute("aria-describedby", "fbCount fbMsgErr");
  msg.value = str(draft.message).slice(0, MAX_MSG);
  const count = el("p", "fb-count");
  count.id = "fbCount";
  m.wrap.append(m.l, msg, count, m.err);

  // the honeypot: people never see it, tab to it or hear it; a bot that fills every field gives itself away
  const hp = el("div", "fb-hp");
  hp.setAttribute("aria-hidden", "true");
  const hpl = el("label", null, "Leave this field empty");
  hpl.htmlFor = "fbWebsite";
  const site = el("input"); site.id = "fbWebsite"; site.name = "website"; site.type = "text"; site.tabIndex = -1; site.autocomplete = "off"; site.value = "";
  hp.append(hpl, site);

  const status = el("p", "fb-status");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const send = el("button", "primary fb-send", "Send");
  send.type = "submit";
  f.append(n.wrap, e.wrap, m.wrap, hp, status, send, el("p", "fine fb-ver", `Your message includes the app version, so we know what you're using.`));
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
  form.count.textContent = `${len.toLocaleString("en-US")} / ${MAX_MSG.toLocaleString("en-US")}`;
  form.count.classList.toggle("near", len > MAX_MSG - 100);
  const off = offline();
  form.send.disabled = off || sending;
  form.send.textContent = sending ? "Sending…" : "Send";
  form.f.setAttribute("aria-busy", String(sending));
  if (sending) setStatus("Sending…", "");
  else if (off) setStatus("You're offline. Connect to send.", "off");
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
    const r = await fetch(feedbackUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(vals, version)), signal: ac.signal });
    let j = null;
    try { j = await r.json(); } catch {}
    if (r.ok && j && j.ok === true) result = { ok: true };
    else {
      const words = j && typeof j.error === "string" ? j.error.replace(/\s+/g, " ").trim().slice(0, 240) : "";
      result = { ok: false, text: words || (r.status === 429 ? "Too many messages right now. Please try again in a little while." : "That didn't go through. Please try again.") };
    }
  } catch (e) {
    result = { ok: false, text: e && e.name === "AbortError" ? "That took too long. Check your connection and try again." : "That didn't go through. Check your connection and try again." };
  } finally { clearTimeout(timer); }
  sending = false;
  if (form !== f) return;                       // the sheet was rebuilt meanwhile
  if (result.ok) {
    store.set("feedback:who", { name: String(vals.name).trim().slice(0, MAX_NAME), email: String(vals.email).trim().slice(0, MAX_EMAIL) });
    store.del("feedback:draft");
    clearTimeout(saveTimer);
    done();
  } else {
    form.state = "error"; paint();
    setStatus(result.text, "error");
    form.status.hidden = false;
  }
}
function done() {
  const sh = ensureSheet();
  form = null;
  const box = el("div", "fb-done");
  box.setAttribute("role", "status");
  box.append(el("b", null, "Thanks."), el("p", null, "Your message is on its way to the Dominares team."));
  const old = sh.querySelector(".fb-form");
  if (old) old.replaceWith(box); else sh.append(box);
  const b = btn("primary", "Done", close);
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

export const _test = { validate, payload, feedbackUrl, MAX_MSG };
